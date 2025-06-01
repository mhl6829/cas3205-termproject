package main

import (
	"encoding/json"
	"log"
	"sync"
	"time"
)

// RoomState는 방의 현재 상태를 나타냅니다.
type RoomState string

const (
	RoomStateWaiting   RoomState = "waiting"   // 플레이어 대기 중
	RoomStateCountdown RoomState = "countdown" // 게임 시작 카운트다운 중
	RoomStatePlaying   RoomState = "playing"   // 게임 진행 중
	RoomStateFinished  RoomState = "finished"  // 게임 종료 후 결과 표시 또는 대기방 복귀 준비
)

const (
	defaultMaxPlayers = 4
	gameEndDelay      = 5 * time.Second // 게임 종료 후 대기방으로 돌아가기 전 지연 시간
)

// Room은 게임 세션을 관리합니다.
type Room struct {
	id         string
	server     *Server
	owner      *Client
	clients    map[*Client]bool
	maxPlayers int
	state      RoomState
	game       *Game
	mutex      sync.RWMutex // clients 맵 및 기타 공유 데이터 접근 제어

	// 채널
	register      chan *Client  // 방에 참여하는 클라이언트
	unregister    chan *Client  // 방에서 나가는 클라이언트
	clientMessage chan *Message // 방 내부 클라이언트로부터 오는 메시지 (레디, 게임 액션 등)
	broadcast     chan []byte   // 방 전체에 브로드캐스트할 메시지
	stop          chan struct{} // 방 고루틴을 중지시키기 위한 채널
}

// NewRoom은 새 Room 인스턴스를 생성하고 실행합니다.
func NewRoom(id string, owner *Client, server *Server, maxPlayers int) *Room {
	if maxPlayers <= 0 {
		maxPlayers = defaultMaxPlayers
	}
	if id == "" {
		id = GenerateRandomRoomID()
	}

	room := &Room{
		id:            id,
		server:        server,
		owner:         owner, // 방 생성자가 초기 방장
		clients:       make(map[*Client]bool),
		maxPlayers:    maxPlayers,
		state:         RoomStateWaiting,
		game:          nil, // 게임은 시작 시점에 생성
		register:      make(chan *Client, 1),
		unregister:    make(chan *Client, 1),
		clientMessage: make(chan *Message, 1), // 버퍼를 줄 수도 있음
		broadcast:     make(chan []byte, 256),
		stop:          make(chan struct{}, 1),
	}

	// 방장도 clients 맵에 추가
	room.clients[owner] = true
	owner.room = room // Client 객체에도 Room 정보 업데이트
	owner.isOwner = true
	owner.isReady = false // 방장은 기본적으로 레디 상태가 아님 (게임 시작 버튼을 눌러야 하므로)

	go room.run()
	log.Printf("Room %s created by %s (Nick: %s). Max players: %d", room.id, owner.id, owner.nickname, room.maxPlayers)
	return room
}

// run은 Room의 메인 이벤트 루프입니다.
// 클라이언트 등록/해제, 메시지 처리, 상태 변경 등을 관리합니다.
func (r *Room) run() {
	log.Printf("Room %s event loop started.", r.id)
	defer func() {
		log.Printf("Room %s event loop stopped.", r.id)
		// 이 방에 남아있는 모든 클라이언트에게 방이 닫혔음을 알리거나 로비로 이동시키는 로직 추가 가능
		r.cleanupRoomResources()
		r.server.removeRoom <- r.id // 서버에 방 제거 알림
	}()

	for {
		select {
		case client := <-r.register:
			r.handleClientRegister(client)

		case client := <-r.unregister:
			r.handleClientUnregister(client)
			if len(r.clients) == 0 && r.state != RoomStatePlaying { // 게임 중이 아닐 때 모든 플레이어가 나가면 방 닫기
				log.Printf("Room %s is empty and not in game, closing.", r.id)
				return // run() 함수 종료 -> defer 실행
			}

		case message := <-r.clientMessage:
			r.handleClientMessage(message)

		case messageBytes := <-r.broadcast:
			r.broadcastToClients(messageBytes)

		case <-r.stop: // 방을 명시적으로 멈추라는 신호 (예: 서버 종료 시)
			return // run() 함수 종료 -> defer 실행
		}
	}
}

func (r *Room) handleClientRegister(client *Client) {
	r.mutex.Lock()

	if len(r.clients) >= r.maxPlayers {
		log.Printf("Room %s is full. Cannot register client %s (Nick: %s).", r.id, client.id, client.nickname)
		// 클라이언트에게 방이 꽉 찼다는 메시지 전송
		errorMsg := Message{Type: MessageTypeError, Payload: ErrorPayload{Message: "Room is full."}}
		payloadBytes, _ := json.Marshal(errorMsg)
		client.send <- payloadBytes
		// 클라이언트를 방에 실제로 추가하지 않고, Client의 room 필드도 nil로 유지
		return
	}

	r.clients[client] = true
	client.room = r                      // Client 객체에 Room 정보 설정
	client.isReady = false               // 새로 들어온 클라이언트는 기본적으로 레디 안됨
	client.isOwner = (client == r.owner) // 방장 여부 확인

	r.mutex.Unlock()

	log.Printf("Client %s (Nick: %s) registered to room %s. Current players: %d/%d", client.id, client.nickname, r.id, len(r.clients), r.maxPlayers)

	// 새 클라이언트에게 현재 방 정보 전송
	r.sendRoomInfoToClient(client)

	// 기존 클라이언트들에게 새 플레이어 입장 알림
	playerJoinedPayload := PlayerJoinedPayload{
		PlayerInfo: r.getPlayerInfo(client),
	}
	msg := Message{Type: MessageTypePlayerJoined, Payload: playerJoinedPayload}
	r.broadcastMessage(msg, client) // 자신을 제외하고 브로드캐스트

	// 서버에 방 상태 변경 알림 (플레이어 수 변경)
	r.server.broadcastRoomUpdate()
}

func (r *Room) handleClientUnregister(client *Client) {
	r.mutex.Lock()
	// client.room = nil // 여기서 nil로 설정하면, 게임 종료 후 재입장 시 문제 발생 가능성.
	// 연결 끊김 시 client.readPump()에서 처리하고, 여기서는 맵에서만 제거.
	// 게임 종료 후 명시적으로 나갈 때 client.room = nil 처리.

	wasOwner := (client == r.owner)
	delete(r.clients, client)
	log.Printf("Client %s (Nick: %s) unregistered from room %s. Remaining players: %d", client.id, client.nickname, r.id, len(r.clients))

	// 클라이언트가 방을 나갔음을 다른 클라이언트에게 알림
	playerLeftPayload := PlayerLeftPayload{PlayerID: client.id}

	if len(r.clients) == 0 {
		if r.state == RoomStatePlaying && r.game != nil {
			// 게임 중에 모든 플레이어가 나가면 (마지막 플레이어가 나감) 게임 즉시 종료 시도
			log.Printf("Last player %s left room %s during game. Attempting to end game.", client.id, r.id)
			r.mutex.Unlock()                          // Lock 해제 후 게임 종료 함수 호출 (데드락 방지)
			r.game.StopGame("owner_left_or_all_left") // 또는 다른 이유
			return                                    // handleClientUnregister 종료
		}
		// 게임 중이 아니면, run() 루프에서 방 닫힘 처리됨
		r.mutex.Unlock()
		// 서버에 방 상태 변경 알림 (플레이어 수 변경)
		r.server.broadcastRoomUpdate()
		return
	}

	// 방장이 나갔을 경우 새 방장 선임
	if wasOwner {
		var newOwner *Client
		// 남아있는 클라이언트 중 한 명을 새 방장으로 (예: 가장 먼저 들어온 순)
		// 실제로는 더 정교한 로직이 필요할 수 있음 (예: Set에서 순서 보장 안됨)
		// 여기서는 남아있는 클라이언트 중 임의의 한명을 선택 (맵 순회는 순서 보장X)
		for c := range r.clients {
			newOwner = c
			break
		}
		if newOwner != nil {
			r.owner = newOwner
			newOwner.isOwner = true
			log.Printf("New owner of room %s is %s (Nick: %s)", r.id, newOwner.id, newOwner.nickname)
			playerLeftPayload.NewOwnerID = newOwner.id
			// 새 방장에게 방장 알림 (PlayerInfo 업데이트를 통해 전달 가능)
			// 또는 별도 메시지
		} else {
			// 이 경우는 모든 클라이언트가 나간 경우로, 위에서 처리됨
			log.Printf("Room %s: Owner left, but no other clients to assign ownership.", r.id)
		}
	}
	r.mutex.Unlock() // Lock 해제 후 브로드캐스트

	msg := Message{Type: MessageTypePlayerLeft, Payload: playerLeftPayload}
	r.broadcastMessage(msg, nil) // 모든 잔류 멤버에게 알림

	// 서버에 방 상태 변경 알림
	r.server.broadcastRoomUpdate()
}

func (r *Room) handleClientMessage(msg *Message) {
	// 메시지를 보낸 클라이언트가 이 방에 속해있는지, 또는 적절한 권한이 있는지 확인하는 것이 좋음
	// msg.Sender는 client.readPump에서 설정됨
	if _, ok := r.clients[msg.Sender]; !ok && msg.Type != MessageTypePlayerAction { // 게임중 액션은 게임 객체가 sender를 다시 확인할 수 있음
		log.Printf("Room %s: Received message type %s from client %s (Nick: %s) not in this room. Ignored.",
			r.id, msg.Type, msg.Sender.id, msg.Sender.nickname)
		return
	}

	log.Printf("Room %s received message from %s (Nick: %s): Type %s", r.id, msg.Sender.id, msg.Sender.nickname, msg.Type)

	switch msg.Type {
	case MessageTypeReadyToggle:
		r.handleReadyToggle(msg.Sender)
	case MessageTypeStartGame:
		r.handleStartGameRequest(msg.Sender)
	case MessageTypePlayerAction:
		if r.state == RoomStatePlaying && r.game != nil {
			r.game.HandlePlayerAction(msg)
		} else {
			log.Printf("Room %s: PlayerAction from %s (Nick: %s) received but game is not running or nil.", r.id, msg.Sender.id, msg.Sender.nickname)
		}
	case MessageTypeLeaveRoom: // 클라이언트가 명시적으로 방을 나가는 경우
		r.mutex.Lock()
		client := msg.Sender
		client.room = nil // Client 객체에서 Room 정보 제거
		client.isOwner = false
		client.isReady = false

		r.mutex.Unlock()       // unregister 처리 전에 client.room을 nil로 설정
		r.unregister <- client // unregister 채널을 통해 표준 절차로 처리
	default:
		log.Printf("Room %s: Received unhandled message type %s from %s (Nick: %s)", r.id, msg.Type, msg.Sender.id, msg.Sender.nickname)
	}
}

func (r *Room) handleReadyToggle(client *Client) {
	r.mutex.Lock()
	if r.state != RoomStateWaiting {
		log.Printf("Room %s: Client %s (Nick: %s) tried to toggle ready but room state is %s.", r.id, client.id, client.nickname, r.state)
		r.mutex.Unlock()
		// 에러 메시지 전송 가능
		return
	}
	client.isReady = !client.isReady
	log.Printf("Room %s: Client %s (Nick: %s) ready status: %t", r.id, client.id, client.nickname, client.isReady)
	r.mutex.Unlock() // 브로드캐스트 전에 Lock 해제

	payload := PlayerReadyChangedPayload{
		PlayerID: client.id,
		IsReady:  client.isReady,
	}
	msg := Message{Type: MessageTypePlayerReadyChanged, Payload: payload}
	r.broadcastMessage(msg, nil)
}

func (r *Room) handleStartGameRequest(client *Client) {
	r.mutex.Lock()
	if client != r.owner {
		log.Printf("Room %s: Start game request from non-owner %s (Nick: %s). Denied.", r.id, client.id, client.nickname)
		// 에러 메시지 전송 가능
		r.mutex.Unlock()
		return
	}
	if r.state != RoomStateWaiting {
		log.Printf("Room %s: Start game request while room state is %s. Denied.", r.id, r.state)
		r.mutex.Unlock()
		return
	}

	canStart := true
	if len(r.clients) < 1 { // 최소 플레이어 수 (예: 1명 또는 2명) 설정 가능
		canStart = false
		log.Printf("Room %s: Not enough players to start. Current: %d", r.id, len(r.clients))
	} else {
		for c := range r.clients {
			if !c.isReady && c != r.owner { // 방장은 레디 안해도 시작 가능하게 하거나, 레디해야만 가능하게 할 수 있음. 여기서는 방장 제외.
				canStart = false
				log.Printf("Room %s: Client %s (Nick: %s) is not ready. Cannot start game.", r.id, c.id, c.nickname)
				break
			}
		}
	}

	if !canStart {
		log.Printf("Room %s: Cannot start game. Not all players are ready or not enough players.", r.id)
		// 에러 메시지 전송 가능 (예: "모든 플레이어가 준비되지 않았습니다.")
		errorMsg := Message{Type: MessageTypeError, Payload: ErrorPayload{Message: "모든 플레이어가 준비되지 않았거나, 플레이어 수가 부족합니다."}}
		payloadBytes, _ := json.Marshal(errorMsg)
		client.send <- payloadBytes // 요청한 방장에게만 전송
		r.mutex.Unlock()
		return
	}

	log.Printf("Room %s: All players ready. Owner %s (Nick: %s) started the game.", r.id, client.id, client.nickname)
	r.state = RoomStateCountdown
	r.mutex.Unlock() // Game 객체 생성 및 시작 전에 Lock 해제

	// Game 객체 생성 및 시작
	// r.game = NewGame(r, r.getGamePlayers()) // getGamePlayers는 []*Client를 반환
	playerClients := make([]*Client, 0, len(r.clients))
	r.mutex.RLock() // clients 맵 읽기 위해 RLock
	for c := range r.clients {
		playerClients = append(playerClients, c)
	}
	r.mutex.RUnlock()

	r.game = NewGame(r, playerClients) // game.go 에 NewGame 정의 예정
	go r.game.Start()                  // 게임 로직은 자체 고루틴에서 실행될 수 있음 (카운트다운, 게임루프 등)

	// 방 상태 변경 브로드캐스트
	r.broadcastRoomState()
	// 서버에 방 상태 변경 알림
	r.server.broadcastRoomUpdate()
}

// broadcastToClients는 방 안의 모든 클라이언트에게 메시지를 전송합니다.
func (r *Room) broadcastToClients(messageBytes []byte) {
	r.mutex.RLock() // clients 맵 읽기 위해 RLock
	for client := range r.clients {
		select {
		case client.send <- messageBytes:
		default:
			// 클라이언트의 send 채널이 꽉 찼거나 닫혔을 경우.
			// 이 경우 해당 클라이언트는 메시지를 받지 못할 수 있음.
			// client.readPump/writePump에서 연결 종료 처리가 이루어짐.
			log.Printf("Room %s: Client %s (Nick: %s) send channel full or closed. Message not sent.", r.id, client.id, client.nickname)
			// 여기서 직접 클라이언트를 제거하는 것은 복잡성을 증가시킬 수 있으므로,
			// readPump/writePump의 연결 종료 로직에 의존하는 것이 일반적.
		}
	}
	r.mutex.RUnlock()
}

// broadcastMessage는 특정 클라이언트를 제외하고 방 전체에 메시지를 보냅니다.
// exclude 클라이언트가 nil이면 모두에게 보냅니다.
func (r *Room) broadcastMessage(msg Message, exclude *Client) {
	payloadBytes, err := json.Marshal(msg)
	if err != nil {
		log.Printf("Room %s: Error marshalling broadcast message type %s: %v", r.id, msg.Type, err)
		return
	}

	r.mutex.RLock()
	for client := range r.clients {
		if client == exclude {
			continue
		}
		select {
		case client.send <- payloadBytes:
		default:
			log.Printf("Room %s: Client %s (Nick: %s) send channel full or closed for broadcast. Message type %s not sent.", r.id, client.id, client.nickname, msg.Type)
		}
	}
	r.mutex.RUnlock()
}

// sendRoomInfoToClient는 특정 클라이언트에게 현재 방의 전체 정보를 보냅니다.
func (r *Room) sendRoomInfoToClient(client *Client) {
	r.mutex.RLock() // player 정보 가져오기 위해

	playersInfo := make([]PlayerInfo, 0, len(r.clients))
	for c := range r.clients {
		playersInfo = append(playersInfo, r.getPlayerInfo(c))
	}

	roomInfoPayload := RoomInfo{
		ID:             r.id,
		OwnerID:        r.owner.id,
		Players:        playersInfo,
		MaxPlayers:     r.maxPlayers,
		State:          r.state,
		CurrentPlayers: len(r.clients),
	}
	msg := Message{Type: MessageTypeRoomJoined, Payload: roomInfoPayload} // 또는 MessageTypeRoomInfo
	payloadBytes, err := json.Marshal(msg)
	if err != nil {
		log.Printf("Room %s: Error marshalling room info for client %s: %v", r.id, client.id, err)
		r.mutex.RUnlock()
		return
	}
	r.mutex.RUnlock()
	client.send <- payloadBytes
}

// getPlayerInfo는 Client 객체로부터 PlayerInfo 구조체를 생성합니다.
// 이 함수는 Room의 mutex로 보호되는 컨텍스트에서 호출되어야 합니다. (또는 Client의 필드를 직접 읽음)
func (r *Room) getPlayerInfo(client *Client) PlayerInfo {
	// client의 필드 (nickname, color, isReady, isOwner)는 Client 객체에 의해 관리되거나,
	// Room이 Client를 등록/해제할 때 업데이트 됩니다. Room의 Lock 안에서 안전하게 접근 가능.
	playerInfo := PlayerInfo{
		ID:       client.id,
		Nickname: client.nickname,
		Color:    client.color,
		IsReady:  client.isReady,
		IsOwner:  client.isOwner,
	}

	// 게임이 진행 중이고 PlayerState가 있으면 asset 정보 포함
	if r.game != nil && r.game.players != nil {
		// game.players는 map[*Client]*PlayerState 타입
		if playerState, exists := r.game.players[client]; exists {
			playerInfo.Asset = playerState.Asset
		}
	}

	return playerInfo
}

// broadcastRoomState는 현재 방의 상태 (예: Waiting, Countdown, Playing, Finished)와
// 플레이어 목록 (레디 상태 포함)을 방의 모든 클라이언트에게 알립니다.
func (r *Room) broadcastRoomState() {
	r.mutex.RLock()

	playersInfo := make([]PlayerInfo, 0, len(r.clients))
	for c := range r.clients {
		playersInfo = append(playersInfo, r.getPlayerInfo(c))
	}

	payload := RoomStateUpdatedPayload{
		RoomID:   r.id,
		NewState: r.state,
		Players:  playersInfo,
	}
	msg := Message{Type: MessageTypeRoomStateUpdated, Payload: payload}

	r.mutex.RUnlock()

	r.broadcastMessage(msg, nil)
	log.Printf("Room %s: Broadcasted room state update. New state: %s", r.id, r.state)
}

// cleanupRoomResources는 방이 닫힐 때 필요한 정리 작업을 수행합니다.
func (r *Room) cleanupRoomResources() {
	log.Printf("Room %s: Cleaning up resources...", r.id)
	// 게임이 진행 중이었다면 게임 중지
	if r.game != nil && r.game.isRunning {
		r.game.StopGame("room_closed") // 게임에 종료 사유 전달
	}
	r.game = nil // 게임 객체 참조 해제

	// 채널 닫기 (주의: 이미 닫힌 채널에 보내면 패닉 발생)
	// 이 채널들은 run() 루프가 종료된 후에 닫는 것이 안전할 수 있지만,
	// 여기서는 run()의 defer에서 호출되므로 이 시점에 닫아도 괜찮을 수 있습니다.
	// 다만, 다른 고루틴이 여전히 이 채널에 쓰려고 한다면 문제가 될 수 있습니다.
	// stop 채널은 외부에서 닫거나, run()에서만 사용한다면 여기서 닫을 필요 없음.
	// close(r.register) // 더 이상 새로운 등록을 받지 않음
	// close(r.unregister)
	// close(r.clientMessage)
	// close(r.broadcast) // broadcast 채널은 run() 루프가 메시지를 소비하므로, 루프 종료 후 닫는 것이 안전

	// 남아있는 클라이언트들의 room 필드를 nil로 설정하고, 방에서 나갔음을 알림 (선택적)
	r.mutex.Lock()

	for client := range r.clients {
		client.room = nil
		client.isOwner = false
		client.isReady = false
		// 클라이언트에게 방이 닫혔다는 메시지를 보낼 수도 있음
		// 예: client.send <- ...
	}

	r.clients = make(map[*Client]bool) // 클라이언트 맵 비우기

	r.mutex.Unlock()
}

// PrepareForNewGame은 게임 종료 후 방을 다음 게임을 위해 초기화합니다.
// 모든 플레이어의 레디 상태를 해제하고, 방 상태를 Waiting으로 변경합니다.
func (r *Room) PrepareForNewGame() {
	r.mutex.Lock()
	r.state = RoomStateWaiting
	r.game = nil // 이전 게임 객체 참조 해제

	log.Printf("Room %s: Preparing for new game. Resetting player ready states.", r.id)
	for client := range r.clients {
		client.isReady = false
		// 클라이언트 연결이 끊긴 경우 (client.conn == nil 또는 유사한 플래그) 여기서 제거 처리
		// 요청사항: 게임중에 클라이언트 끊기면 게임에서 빼지 않고 멈춘 상태로 일단 그대로 진행 후
		// 게임 종료 후 다시 게임방으로 이동했을 때 제거처리
		if client.conn == nil || !r.server.isClientConnected(client.id) { // isClientConnected는 서버에 구현 필요
			log.Printf("Room %s: Removing disconnected client %s (Nick: %s) while preparing for new game.", r.id, client.id, client.nickname)
			// 여기서 바로 r.unregister를 호출하면 데드락 위험 (run 루프와 동시 접근)
			// 대신, 임시 목록에 추가했다가 Lock 해제 후 처리하거나, 클라이언트 맵에서 직접 제거
			delete(r.clients, client) // 맵에서 직접 제거
			// TODO: 이 클라이언트가 방장이었는지 확인하고, 필요시 새 방장 선임 로직 다시 호출
			// 이 부분은 handleClientUnregister와 로직이 중복될 수 있으므로 주의.
			// 혹은 unregister 채널을 사용하되, run 루프가 이 메시지를 처리할 수 있도록 해야함.
			// 지금은 단순하게 넘어감. 실제 구현 시 이 부분은 주의 깊게 처리해야 함.

			// 플레이어 떠남 메시지 브로드캐스트
			// playerLeftPayload := PlayerLeftPayload{PlayerID: client.id}
			// 만약 이 클라이언트가 방장이었고, 새 방장이 선임되어야 한다면 여기서 처리
			// ... (handleClientUnregister의 방장 교체 로직 참고)
			// msg := Message{Type: MessageTypePlayerLeft, Payload: playerLeftPayload}
			// 이 메시지를 r.broadcastMessage를 통해 보내야하는데, 현재 Lock 상태이므로 주의.
			// 임시 변수에 저장했다가 Lock 해제 후 전송하거나, 별도 고루틴으로 처리.
			// 지금은 단순하게 넘어감. 실제 구현 시 이 부분은 주의 깊게 처리해야 함.

			// 서버에 방 업데이트 알림도 필요
			defer r.server.broadcastRoomUpdate() // defer를 사용하여 Lock 해제 후 호출되도록
		}
	}
	r.mutex.Unlock()

	r.broadcastRoomState() // 변경된 방 상태와 플레이어 정보 (레디 해제) 브로드캐스트
	r.server.broadcastRoomUpdate()
}
