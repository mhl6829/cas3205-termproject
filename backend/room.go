package backend

import (
	"encoding/json"
	"log"
	"sync"
	"time"
)

type RoomState string

const (
	RoomStateWaiting  RoomState = "waiting"  // 대기 중
	RoomStatePlaying  RoomState = "playing"  // 게임 진행 중
	RoomStateFinished RoomState = "finished" // 게임 종료 후 결과 표시 또는 대기방 복귀 준비
)

const (
	defaultMaxPlayers = 4
	gameEndDelay      = 10 * time.Second // 대기방 자동 이동 지연 시간
)

// Room은 게임 세션을 관리합니다.
type Room struct {
	id             string
	server         *Server
	owner          *Client
	clients        map[*Client]bool
	maxPlayers     int
	state          RoomState
	game           *Game
	mutex          sync.RWMutex
	loadingClients map[string]bool

	// 채널
	register      chan *Client  // 방에 참여하는 클라이언트
	unregister    chan *Client  // 방에서 나가는 클라이언트
	clientMessage chan *Message // 방 내부 클라이언트로부터 오는 메세지
	broadcast     chan []byte   // 방 전체에 브로드캐스트
	stop          chan struct{} // 방 고루틴을 중지
}

// 방 생성
func NewRoom(id string, owner *Client, server *Server, maxPlayers int) *Room {
	if maxPlayers <= 0 {
		maxPlayers = defaultMaxPlayers
	}
	if id == "" {
		id = GenerateRandomRoomID()
	}

	room := &Room{
		id:         id,
		server:     server,
		owner:      owner, // 방 생성자가 초기 방장
		clients:    make(map[*Client]bool),
		maxPlayers: maxPlayers,
		state:      RoomStateWaiting,
		game:       nil, // 게임은 시작 시점에 생성
		// 밑에 블로킹 루프때문에 버퍼 줘야함
		// TODO: 이 부분 Best Practice 찾아보기
		register:       make(chan *Client, 1),
		unregister:     make(chan *Client, 1),
		clientMessage:  make(chan *Message, 1),
		broadcast:      make(chan []byte, 256),
		stop:           make(chan struct{}, 1),
		loadingClients: make(map[string]bool),
	}

	// 방장 추가
	room.clients[owner] = true
	owner.room = room
	owner.isOwner = true
	owner.isReady = false

	// 방 루프 실행
	go room.run()
	log.Printf("Room %s created by %s (Nick: %s). Max players: %d", room.id, owner.id, owner.nickname, room.maxPlayers)
	return room
}

// Room 메인 루프
func (r *Room) run() {
	log.Printf("Room %s event loop started.", r.id)
	defer func() {
		log.Printf("Room %s event loop stopped.", r.id)
		r.cleanupRoomResources()
		// 서버에 방 제거 알림
		r.server.removeRoom <- r.id
	}()

	for {
		select {
		case client := <-r.register:
			r.handleClientRegister(client)

		case client := <-r.unregister:
			r.handleClientUnregister(client)
			if len(r.clients) == 0 && r.state != RoomStatePlaying {
				// 게임 중이 아닐 때 모든 플레이어가 나가면 방 제거
				log.Printf("Room %s is empty and not in game, closing.", r.id)
				return
			}

		case message := <-r.clientMessage:
			r.handleClientMessage(message)

		case messageBytes := <-r.broadcast:
			r.broadcastToClients(messageBytes)

		case <-r.stop:
			return
		}
	}
}

func (r *Room) handleClientRegister(client *Client) {
	r.mutex.Lock()

	if len(r.clients) >= r.maxPlayers {
		// 방이 꽉 찼을 시
		log.Printf("Room %s is full. Cannot register client %s (Nick: %s).", r.id, client.id, client.nickname)
		errorMsg := Message{Type: MessageTypeError, Payload: ErrorPayload{Message: "Room is full."}}
		payloadBytes, _ := json.Marshal(errorMsg)
		client.send <- payloadBytes
		return
	}

	r.clients[client] = true
	client.room = r // Client 객체에 Room 정보 설정
	client.isReady = false
	client.isOwner = (client == r.owner) // 방장 여부 확인

	r.mutex.Unlock()

	log.Printf("Client %s (Nick: %s) registered to room %s. Current players: %d/%d", client.id, client.nickname, r.id, len(r.clients), r.maxPlayers)

	// 새 클라이언트에게 방 정보 전송
	r.sendRoomInfoToClient(client)

	// 기존 클라이언트들에게 새 플레이어 입장 알림
	playerJoinedPayload := PlayerJoinedPayload{
		PlayerInfo: r.getPlayerInfo(client),
	}
	msg := Message{Type: MessageTypePlayerJoined, Payload: playerJoinedPayload}
	// 자신을 제외하고 브로드캐스트
	r.broadcastMessage(msg, client)

	// 서버에 방 상태 변경 알림 (플레이어 수 변경)
	r.server.broadcastRoomUpdate()
}

func (r *Room) handleClientUnregister(client *Client) {
	r.mutex.Lock()

	wasOwner := (client == r.owner)
	delete(r.clients, client)
	log.Printf("Client %s (Nick: %s) unregistered from room %s. Remaining players: %d", client.id, client.nickname, r.id, len(r.clients))

	// 클라이언트가 방을 나갔음을 다른 클라이언트에게 알림
	playerLeftPayload := PlayerLeftPayload{PlayerID: client.id}

	if len(r.clients) == 0 {
		if r.state == RoomStatePlaying && r.game != nil {
			// 게임 중에 모든 플레이어가 나가면 (마지막 플레이어가 나감) 게임 즉시 종료 시도
			log.Printf("Last player %s left room %s during game. Attempting to end game.", client.id, r.id)
			r.mutex.Unlock() // Lock 해제 후 게임 종료 함수 호출
			r.game.StopGame("owner_left_or_all_left")
			return
		}
		// 게임 중이 아니면 run() 루프에서 방 닫힘 처리됨
		r.mutex.Unlock()
		// 서버에 방 상태 변경 알림 (플레이어 수 변경)
		r.server.broadcastRoomUpdate()
		return
	}

	// 방장이 나갔을 경우 새 방장 뽑기
	if wasOwner {
		var newOwner *Client
		// 남아있는 클라이언트 중 한 명을 새 방장으로
		for c := range r.clients {
			newOwner = c
			break
		}
		if newOwner != nil {
			r.owner = newOwner
			newOwner.isOwner = true
			log.Printf("New owner of room %s is %s (Nick: %s)", r.id, newOwner.id, newOwner.nickname)
			playerLeftPayload.NewOwnerID = newOwner.id
			// 새 방장에게 방장 알림
		} else {
			// 모든 클라이언트가 나간 경우
			log.Printf("Room %s: Owner left, but no other clients to assign ownership.", r.id)
		}
	}
	r.mutex.Unlock() // Lock 해제 후 브로드캐스트

	msg := Message{Type: MessageTypePlayerLeft, Payload: playerLeftPayload}
	r.broadcastMessage(msg, nil)

	// 서버에 방 상태 변경 알림
	r.server.broadcastRoomUpdate()
}

func (r *Room) handleClientMessage(msg *Message) {
	// 방에 없는 클라이언트 메세지 처리
	if _, ok := r.clients[msg.Sender]; !ok && msg.Type != MessageTypePlayerAction {
		log.Printf("Room %s: Received message type %s from client %s (Nick: %s) not in this room. Ignored.",
			r.id, msg.Type, msg.Sender.id, msg.Sender.nickname)
		return
	}

	log.Printf("Room %s received message from %s (Nick: %s): Type %s", r.id, msg.Sender.id, msg.Sender.nickname, msg.Type)

	switch msg.Type {
	case MessageTypeReadyToggle:
		// 준비 처리
		r.handleReadyToggle(msg.Sender)
	case MessageTypeStartGame:
		// 게임 시작 처리
		r.handleStartGameRequest(msg.Sender)
	case MessageTypePlayerAction:
		// 게임 진행중일 때 플레이어 액션 처리
		if r.state == RoomStatePlaying && r.game != nil {
			r.game.HandlePlayerAction(msg)
		} else {
			log.Printf("Room %s: PlayerAction from %s (Nick: %s) received but game is not running or nil.", r.id, msg.Sender.id, msg.Sender.nickname)
		}
	case MessageTypeLeaveRoom:
		// 방 나가기 처리
		r.mutex.Lock()
		client := msg.Sender
		client.room = nil
		client.isOwner = false
		client.isReady = false

		r.mutex.Unlock()
		// 이 부분 채널 버퍼 처리 안 하면 막힘
		r.unregister <- client
	case MessageTypeGameLoadingComplete:
		r.handleGameLoadingComplete(msg.Sender)
	default:
		log.Printf("Room %s: Received unhandled message type %s from %s (Nick: %s)", r.id, msg.Type, msg.Sender.id, msg.Sender.nickname)
	}
}

// 플레이어 준비 처리
func (r *Room) handleReadyToggle(client *Client) {
	r.mutex.Lock()
	if r.state != RoomStateWaiting && r.state != RoomStateFinished {
		log.Printf("Room %s: Client %s (Nick: %s) tried to toggle ready but room state is %s.", r.id, client.id, client.nickname, r.state)
		r.mutex.Unlock()
		return
	}
	client.isReady = !client.isReady
	log.Printf("Room %s: Client %s (Nick: %s) ready status: %t", r.id, client.id, client.nickname, client.isReady)
	r.mutex.Unlock()

	payload := PlayerReadyChangedPayload{
		PlayerID: client.id,
		IsReady:  client.isReady,
	}
	msg := Message{Type: MessageTypePlayerReadyChanged, Payload: payload}
	r.broadcastMessage(msg, nil)
}

// 게임 시작 처리
func (r *Room) handleStartGameRequest(client *Client) {
	r.mutex.Lock()
	if client != r.owner {
		log.Printf("Room %s: Start game request from non-owner %s (Nick: %s). Denied.", r.id, client.id, client.nickname)
		r.mutex.Unlock()
		return
	}
	if r.state == RoomStateFinished {
		errorMsg := Message{Type: MessageTypeError, Payload: ErrorPayload{Message: "아직 모든 플레이어가 대기실로 돌아오지 않았습니다."}}
		payloadBytes, _ := json.Marshal(errorMsg)
		// 방장에게만 전송
		client.send <- payloadBytes
		r.mutex.Unlock()
		return
	}
	if r.state != RoomStateWaiting {
		log.Printf("Room %s: Start game request while room state is %s. Denied.", r.id, r.state)
		r.mutex.Unlock()
		return
	}

	canStart := true
	errorMsg := ""
	if len(r.clients) < 2 {
		canStart = false
		errorMsg = "플레이어 수가 부족합니다."
		log.Printf("Room %s: Not enough players to start. Current: %d", r.id, len(r.clients))
	} else {
		for c := range r.clients {
			// 방장은 레디 아니어도 가능
			if !c.isReady && c != r.owner {
				canStart = false
				errorMsg = "모든 플레이어가 준비되지 않았습니다."
				log.Printf("Room %s: Client %s (Nick: %s) is not ready. Cannot start game.", r.id, c.id, c.nickname)
				break
			}
		}
	}

	if !canStart {
		errorMsg := Message{Type: MessageTypeError, Payload: ErrorPayload{Message: errorMsg}}
		payloadBytes, _ := json.Marshal(errorMsg)
		// 방장에게만 전송
		client.send <- payloadBytes
		r.mutex.Unlock()
		return
	}

	log.Printf("Room %s: All players ready. Owner %s (Nick: %s) started the game.", r.id, client.id, client.nickname)
	r.state = RoomStatePlaying

	// 로딩 상태 초기화
	r.loadingClients = make(map[string]bool)
	for c := range r.clients {
		r.loadingClients[c.id] = false
	}

	r.mutex.Unlock()

	// Game 객체 생성
	playerClients := make([]*Client, 0, len(r.clients))
	r.mutex.RLock()
	for c := range r.clients {
		playerClients = append(playerClients, c)
	}
	r.mutex.RUnlock()

	r.game = NewGame(r, playerClients)

	// 게임 초기화 데이터 전송
	r.sendGameInitData()

	// 방 상태 변경 브로드캐스트
	r.broadcastRoomState()

	// 서버에 방 상태 변경 알림
	r.server.broadcastRoomUpdate()

	// 게임 준비 상태 시작
	r.game.Ready()
}

// 방 Broadcast
func (r *Room) broadcastToClients(messageBytes []byte) {
	r.mutex.RLock()
	for client := range r.clients {
		select {
		case client.send <- messageBytes:
		default:
			log.Printf("Room %s: Client %s (Nick: %s) send channel full or closed. Message not sent.", r.id, client.id, client.nickname)
		}
	}
	r.mutex.RUnlock()
}

// Exclude 제외 Broadcast
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

// 방 정보 전송
func (r *Room) sendRoomInfoToClient(client *Client) {
	r.mutex.RLock()

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
	msg := Message{Type: MessageTypeRoomJoined, Payload: roomInfoPayload}
	payloadBytes, err := json.Marshal(msg)
	if err != nil {
		log.Printf("Room %s: Error marshalling room info for client %s: %v", r.id, client.id, err)
		r.mutex.RUnlock()
		return
	}
	r.mutex.RUnlock()
	client.send <- payloadBytes
}

// Client 객체로 PlayerInfo 조회
func (r *Room) getPlayerInfo(client *Client) PlayerInfo {
	playerInfo := PlayerInfo{
		ID:        client.id,
		Nickname:  client.nickname,
		Color:     client.color,
		Character: client.character,
		IsReady:   client.isReady,
		IsOwner:   client.isOwner,
	}

	// 게임이 진행 중이고 PlayerState가 있으면 asset 정보 포함
	if r.game != nil && r.game.players != nil {
		if playerState, exists := r.game.players[client]; exists {
			playerInfo.Asset = playerState.Asset
		}
	}

	return playerInfo
}

// 방 상태 Broadcast
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

// 방 제거 Clean up
func (r *Room) cleanupRoomResources() {
	log.Printf("Room %s: Cleaning up resources...", r.id)
	// 게임이 진행 중이었다면 게임 중지
	if r.game != nil && r.game.isReady {
		r.game.StopGame("room_closed")
	}
	r.game = nil

	r.mutex.Lock()

	for client := range r.clients {
		client.room = nil
		client.isOwner = false
		client.isReady = false
	}

	r.clients = make(map[*Client]bool)

	r.mutex.Unlock()
}

// 게임 종료 및 준비상태 초기화
func (r *Room) SetGameEnded() {
	r.mutex.Lock()
	r.state = RoomStateFinished
	r.game = nil
	r.loadingClients = make(map[string]bool)

	log.Printf("Room %s: Preparing for new game. Resetting player ready states.", r.id)
	for client := range r.clients {
		client.isReady = false
		if client.conn == nil || !r.server.isClientConnected(client.id) {
			log.Printf("Room %s: Removing disconnected client %s (Nick: %s) while preparing for new game.", r.id, client.id, client.nickname)
			delete(r.clients, client)

			defer r.server.broadcastRoomUpdate()
		}
	}
	r.mutex.Unlock()

	r.broadcastRoomState()
	r.server.broadcastRoomUpdate()
}

// 게임 종료 후 다음 게임 준비
func (r *Room) PrepareForNewGame() {
	r.mutex.Lock()
	r.state = RoomStateWaiting
	r.mutex.Unlock()

	// 변경된 방 상태와 플레이어 정보 Broadcast
	r.broadcastRoomState()
	r.server.broadcastRoomUpdate()
}

// 게임 초기 데이터 전송
func (r *Room) sendGameInitData() {
	if r.game == nil {
		log.Printf("Room %s: Cannot send game init data, game is nil", r.id)
		return
	}

	// 플레이어 init data
	playerStates := make([]PlayerStateInfo, 0, len(r.game.players))
	for client, playerState := range r.game.players {
		playerStates = append(playerStates, PlayerStateInfo{
			ID:        client.id,
			Color:     playerState.Color,
			X:         playerState.X,
			Y:         playerState.Y,
			Z:         playerState.Z,
			Yaw:       playerState.Yaw,
			Pitch:     playerState.Pitch,
			Score:     playerState.Score,
			Asset:     playerState.Asset,
			Health:    playerState.Health,
			MaxHealth: playerState.MaxHealth,
			IsAlive:   playerState.IsAlive,
		})
	}

	// 게임 init data
	initPayload := GameInitDataPayload{
		Players: playerStates,
		// MapData와 GameConfig 추후 추가
	}

	msg := Message{Type: MessageTypeGameInitData, Payload: initPayload}
	r.broadcastMessage(msg, nil)
	log.Printf("Room %s: Sent game initialization data to all clients", r.id)
}

// 게임 로딩 완료 처리
// Threejs scene 초기화 안 된 상태로 시작하면 늦게 접속한 플레이어는 카운트 다운 중간에 들어가는 문제 있음
// 로딩 완료 메세지 받고 전체 준비되었을 경우에 카운트다운 시작
func (r *Room) handleGameLoadingComplete(client *Client) {
	r.mutex.Lock()

	// 로딩 완료 상태 업데이트
	if _, exists := r.loadingClients[client.id]; exists {
		r.loadingClients[client.id] = true
		log.Printf("Room %s: Client %s (Nick: %s) completed game loading", r.id, client.id, client.nickname)
	}

	// 모든 클라이언트가 로딩을 완료했는지 확인
	allLoaded := true
	for _, loaded := range r.loadingClients {
		if !loaded {
			allLoaded = false
			break
		}
	}

	r.mutex.Unlock()

	// 모든 클라이언트 로딩 완료시 게임 시작
	if allLoaded {
		log.Printf("Room %s: All clients completed loading, starting game countdown", r.id)
		if r.game != nil {
			go r.game.Start() // 게임 메인 루프 시작
		}
	}
}
