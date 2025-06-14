package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

// Server는 모든 클라이언트 연결과 방을 관리하는 중앙 허브 역할을 합니다.
type Server struct {
	clients      map[string]*Client // clientID를 키로 사용
	rooms        map[string]*Room   // roomID를 키로 사용
	nextClientID int64              // 간단한 클라이언트 ID 생성용 (실제로는 UUID 권장)
	mutex        sync.RWMutex       // clients와 rooms 맵 동시 접근 제어

	// 채널
	register           chan *Client  // 새로운 클라이언트 등록
	unregister         chan *Client  // 클라이언트 등록 해제
	createRoom         chan *Client  // 방 생성 요청 (방을 만들 클라이언트)
	joinRoom           chan *Message // 방 참가 요청 (메시지 안에 roomID와 sender Client 포함)
	listRooms          chan *Client  // 방 목록 요청 (요청한 클라이언트)
	removeRoom         chan string   // 방 제거 알림 (Room ID)
	routeClientMessage chan *Message // Client로부터 받은 메시지를 서버 레벨에서 처리하기 위한 채널
}

// NewServer는 새 Server 인스턴스를 생성하고 실행합니다.
func NewServer() *Server {
	s := &Server{
		clients:            make(map[string]*Client, 1),
		rooms:              make(map[string]*Room, 1),
		nextClientID:       1,
		register:           make(chan *Client, 1),
		unregister:         make(chan *Client, 1),
		createRoom:         make(chan *Client, 1),
		joinRoom:           make(chan *Message, 1), // Message 타입으로 변경
		listRooms:          make(chan *Client, 1),
		removeRoom:         make(chan string, 1),
		routeClientMessage: make(chan *Message, 256), // 버퍼 있는 채널
	}
	go s.run()
	return s
}

// run은 Server의 메인 이벤트 루프입니다.
func (s *Server) run() {
	for {
		select {
		case client := <-s.register:

			s.handleClientRegister(client)

		case client := <-s.unregister:

			s.handleClientUnregister(client)

		case client := <-s.createRoom: // client.go에서 직접 이 채널로 보냈다고 가정

			s.handleCreateRoom(client)

		case msg := <-s.joinRoom: // client.go에서 routeClientMessage를 통해 오거나, 직접 이 채널로 올 수 있음

			s.handleJoinRoom(msg) // msg에 RoomID와 Sender Client 정보 포함

		case client := <-s.listRooms: // client.go에서 routeClientMessage를 통해 오거나, 직접 이 채널로 올 수 있음

			s.handleListRooms(client)

		case roomID := <-s.removeRoom: // Room.run()의 defer에서 호출
			s.handleRemoveRoom(roomID)

		case msg := <-s.routeClientMessage: // Client.readPump에서 라우팅된 메시지

			s.handleRoutedMessage(msg)
		}
	}
}

func (s *Server) handleClientRegister(client *Client) {
	s.mutex.Lock()
	s.clients[client.id] = client
	s.mutex.Unlock()
	log.Printf("Server: Client %s (Nick: %s) registered. Total clients: %d", client.id, client.nickname, len(s.clients))

	// 클라이언트에게 ID 할당 알림 (client.go의 sendInfoToClient 호출은 client 생성 시점으로 이동)
	// client.sendInfoToClient() // client.go에서 NewClient 후 호출되도록 하는 것이 더 적절할 수 있음

	// 클라이언트에게 현재 방 목록 즉시 전송
	s.sendRoomListToClient(client)
}

func (s *Server) handleClientUnregister(client *Client) {
	s.mutex.Lock()
	// Client가 어떤 Room에 속해있었다면, Room의 unregister 로직이 먼저 처리되었을 것.
	// 여기서는 Server의 clients 맵에서만 제거.
	if _, ok := s.clients[client.id]; ok {
		delete(s.clients, client.id)
		log.Printf("Server: Client %s (Nick: %s) unregistered. Total clients: %d", client.id, client.nickname, len(s.clients))

		// 만약 이 클라이언트가 어떤 방의 유일한 멤버였고, 해당 방이 닫혔다면,
		// s.removeRoom 채널을 통해 이미 처리되었을 것.
		// 여기서는 추가적인 방 정리 작업은 필요 없을 수 있음.
	}
	s.mutex.Unlock()
}

func (s *Server) handleCreateRoom(owner *Client) {
	// 이미 방에 속해있다면 새로 만들 수 없음 (선택적 정책)
	if owner.room != nil {
		log.Printf("Server: Client %s (Nick: %s) tried to create room but already in room %s.", owner.id, owner.nickname, owner.room.id)
		errorMsg := Message{Type: MessageTypeError, Payload: ErrorPayload{Message: "이미 다른 방에 참여중입니다."}}
		payloadBytes, _ := json.Marshal(errorMsg)
		owner.send <- payloadBytes
		return
	}

	roomID := GenerateRandomRoomID()
	// 생성된 ID가 이미 사용 중인지 확인 (매우 낮은 확률이지만)

	s.mutex.Lock() // rooms 맵에 접근하기 위함

	for _, exists := s.rooms[roomID]; exists; _, exists = s.rooms[roomID] {
		roomID = GenerateRandomRoomID()
	}

	// Room 생성 (NewRoom 내부에서 owner.room 설정 및 clients에 owner 추가)
	// NewRoom은 자체 고루틴에서 room.run()을 실행
	room := NewRoom(roomID, owner, s, defaultMaxPlayers)
	s.rooms[roomID] = room

	// unlock
	s.mutex.Unlock()

	log.Printf("Server: Room %s created by %s (Nick: %s). Total rooms: %d", room.id, owner.id, owner.nickname, len(s.rooms))

	// 방 생성자에게 방 생성 완료 및 정보 전송
	// NewRoom -> room.handleClientRegister -> room.sendRoomInfoToClient 에서 처리되므로 중복 필요 X
	// 대신, 방 생성 완료 메시지만 따로 보낼 수 있음
	createdMsgPayload := RoomInfo{
		ID:             room.id,
		OwnerID:        owner.id,
		Players:        []PlayerInfo{room.getPlayerInfo(owner)}, // room.getPlayerInfo는 Room의 메서드
		MaxPlayers:     room.maxPlayers,
		State:          room.state,
		CurrentPlayers: 1,
	}
	createdMsg := Message{Type: MessageTypeRoomCreated, Payload: createdMsgPayload}
	payloadBytes, _ := json.Marshal(createdMsg)
	owner.send <- payloadBytes

	// 모든 클라이언트에게 방 목록 업데이트 브로드캐스트
	s.broadcastRoomUpdateToAll()
}

func (s *Server) handleJoinRoom(msg *Message) {
	client := msg.Sender

	// 페이로드 파싱
	var joinPayload JoinRoomPayload
	payloadBytes, _ := json.Marshal(msg.Payload) // msg.Payload가 map[string]interface{} 일 수 있음
	if err := json.Unmarshal(payloadBytes, &joinPayload); err != nil {
		log.Printf("Server: Failed to parse join room payload from %s: %v", client.id, err)
		errorMsg := Message{Type: MessageTypeError, Payload: ErrorPayload{Message: "잘못된 방 참가 요청입니다."}}
		responseBytes, _ := json.Marshal(errorMsg)
		client.send <- responseBytes
		return
	}
	roomID := joinPayload.RoomID

	s.mutex.RLock() // rooms 맵 읽기
	room, ok := s.rooms[roomID]
	s.mutex.RUnlock()

	if !ok {
		log.Printf("Server: Client %s (Nick: %s) tried to join non-existent room %s.", client.id, client.nickname, roomID)
		errorMsg := Message{Type: MessageTypeError, Payload: ErrorPayload{Message: "존재하지 않는 방입니다."}}
		payloadBytes, _ := json.Marshal(errorMsg)
		client.send <- payloadBytes
		return
	}

	// 이미 다른 방에 있다면 참가 불가 (선택적 정책)
	if client.room != nil && client.room.id != roomID {
		log.Printf("Server: Client %s (Nick: %s) tried to join room %s but already in room %s.", client.id, client.nickname, roomID, client.room.id)
		errorMsg := Message{Type: MessageTypeError, Payload: ErrorPayload{Message: "이미 다른 방에 참여중입니다. 먼저 해당 방에서 나가주세요."}}
		payloadBytes, _ := json.Marshal(errorMsg)
		client.send <- payloadBytes
		return
	}
	if client.room != nil && client.room.id == roomID { // 이미 해당 방에 있는 경우
		log.Printf("Server: Client %s (Nick: %s) tried to join room %s but is already in it.", client.id, client.nickname, roomID)
		room.sendRoomInfoToClient(client) // 현재 방 정보 다시 전송
		return
	}

	// Room의 register 채널로 클라이언트 전달하여 방 참여 처리
	// 이 과정은 Room의 고루틴에서 안전하게 처리됨 (최대 인원 확인 등)
	room.register <- client
	// Room.handleClientRegister에서 RoomInfo 전송 및 PlayerJoined 브로드캐스트가 일어남
	// 여기서 추가적인 성공 메시지를 보낼 필요는 없을 수 있음.
	// 방 목록 업데이트는 Room.handleClientRegister에서 s.broadcastRoomUpdate() 호출로 처리됨.
}

func (s *Server) handleListRooms(client *Client) {
	s.sendRoomListToClient(client)
}

func (s *Server) sendRoomListToClient(client *Client) {
	s.mutex.RLock() // rooms 맵 읽기

	roomListItems := make([]RoomListItem, 0, len(s.rooms))
	for _, room := range s.rooms {
		// Room의 mutex를 여기서 잡으면 데드락 위험이 있으므로, Room의 필드를 직접 읽거나,
		// Room에서 주기적으로 업데이트하는 정보를 활용.
		// 여기서는 Room의 필드를 직접 읽는다고 가정 (Room 내부에서 이 필드들은 적절히 동기화되어야 함)
		// Room의 clients 맵 길이는 Room의 Lock 안에서만 정확.
		// Room에 CurrentPlayers() 같은 메서드를 만들고 RLock으로 보호하는 것이 좋음.
		// 여기서는 Room의 mutex를 잡지 않고, Room 생성/소멸 시 Server가 관리하는 정보를 사용한다고 가정.
		// 또는, Room 객체 자체의 필드(state, maxPlayers 등)는 비교적 정적이므로 직접 읽어도 괜찮을 수 있음.
		// currentPlayers는 Room의 mutex를 잡고 가져와야 함.
		room.mutex.RLock()
		currentPlayers := len(room.clients)
		roomState := room.state
		room.mutex.RUnlock()

		roomListItems = append(roomListItems, RoomListItem{
			ID:             room.id,
			CurrentPlayers: currentPlayers,
			MaxPlayers:     room.maxPlayers,
			State:          roomState,
		})
	}

	// Lock 해제
	s.mutex.RUnlock()

	payload := RoomListPayload{Rooms: roomListItems}
	msg := Message{Type: MessageTypeRoomListUpdated, Payload: payload}

	responseBytes, err := json.Marshal(msg)
	if err != nil {
		log.Printf("Server: Error marshalling room list for client %s: %v", client.id, err)
		return
	}
	client.send <- responseBytes
	log.Printf("Server: Sent room list to client %s (Nick: %s). %d rooms.", client.id, client.nickname, len(roomListItems))
}

// broadcastRoomUpdateToAll은 모든 클라이언트에게 현재 방 목록을 다시 전송합니다.
// 방이 생성되거나, 인원이 변경되거나, 상태가 변경될 때 호출될 수 있습니다.
func (s *Server) broadcastRoomUpdateToAll() {
	s.mutex.RLock() // clients와 rooms 맵 읽기

	roomListItems := make([]RoomListItem, 0, len(s.rooms))
	for _, room := range s.rooms {
		room.mutex.RLock()
		currentPlayers := len(room.clients)
		roomState := room.state
		room.mutex.RUnlock()
		roomListItems = append(roomListItems, RoomListItem{
			ID:             room.id,
			CurrentPlayers: currentPlayers,
			MaxPlayers:     room.maxPlayers,
			State:          roomState,
		})
	}
	payload := RoomListPayload{Rooms: roomListItems}
	msg := Message{Type: MessageTypeRoomListUpdated, Payload: payload}

	responseBytes, err := json.Marshal(msg)
	if err != nil {
		log.Printf("Server: Error marshalling room list for broadcast: %v", err)
		return
	}

	for _, client := range s.clients {
		// 로비에 있는 클라이언트에게만 보내거나, 모든 클라이언트에게 보낼 수 있음.
		// 여기서는 모든 클라이언트에게 전송.
		if client.room == nil { // 로비에 있는 클라이언트에게만
			select {
			case client.send <- responseBytes:
			default:
				log.Printf("Server: Client %s send channel full during room list broadcast. Message not sent.", client.id)
			}
		}
	}

	s.mutex.RUnlock()

	log.Printf("Server: Broadcasted room list update to lobby clients. %d rooms.", len(roomListItems))
}

// broadcastRoomUpdate는 서버에 연결된 클라이언트 중 로비에 있는 클라이언트들에게 방 목록을 업데이트합니다.
// Room에서 플레이어 수나 상태 변경 시 호출합니다.
func (s *Server) broadcastRoomUpdate() {
	s.broadcastRoomUpdateToAll() // 현재는 모든 클라이언트(로비)에게 전송
}

func (s *Server) handleRemoveRoom(roomID string) {
	s.mutex.Lock()
	delete(s.rooms, roomID)
	s.mutex.Unlock()
	log.Printf("Server: Room %s removed. Total rooms: %d", roomID, len(s.rooms))

	// 모든 클라이언트에게 방 목록 업데이트 브로드캐스트
	s.broadcastRoomUpdateToAll()
}

// isClientConnected는 특정 ID의 클라이언트가 현재 서버에 연결되어 있는지 확인합니다.
// Room에서 게임 종료 후 연결 끊긴 클라이언트 정리 시 사용합니다.
func (s *Server) isClientConnected(clientID string) bool {
	s.mutex.RLock()
	_, ok := s.clients[clientID]
	s.mutex.RUnlock()
	return ok
}

func (s *Server) handleRoutedMessage(msg *Message) {
	// Client.readPump에서 1차 라우팅 후 넘어온 메시지 처리
	client := msg.Sender

	switch msg.Type {
	case MessageTypeCreateRoom:
		s.handleCreateRoom(client) // 방 생성 요청은 Client 객체만 필요
	case MessageTypeJoinRoom:
		s.handleJoinRoom(msg) // 방 참가 요청은 메시지 전체 필요 (RoomID 페이로드)
	case MessageTypeListRooms:
		s.handleListRooms(client)
	case MessageTypeSetNicknameColor:
		s.handleSetNicknameColor(msg)
	// 서버 레벨에서 처리할 다른 메시지 타입 추가 가능
	default:
		log.Printf("Server: Received unhandled routed message type %s from %s (Nick: %s)", msg.Type, client.id, client.nickname)
	}
}

func (s *Server) handleSetNicknameColor(msg *Message) {
	client := msg.Sender
	var payload SetNicknameColorPayload
	payloadBytes, _ := json.Marshal(msg.Payload)
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		log.Printf("Server: Failed to parse set nickname/color payload from %s: %v", client.id, err)
		// 에러 응답 전송 가능
		return
	}

	s.mutex.Lock() // Client 객체 정보 변경
	oldNickname := client.nickname
	client.nickname = payload.Nickname
	client.color = payload.Color
	client.character = payload.Character
	s.mutex.Unlock() // Client 정보 변경 후 Lock 해제

	log.Printf("Server: Client %s updated profile. Nickname: %s -> %s, Color: %s, Character: %s", client.id, oldNickname, client.nickname, client.color, client.character)

	// 만약 클라이언트가 방에 있다면, 방 내부 다른 클라이언트들에게도 이 변경사항을 알려야 함.
	// 이는 Room의 책임으로 넘기거나, 여기서 직접 Room에 알릴 수 있음.
	// 예: client.room이 nil이 아니면, client.room.broadcastPlayerProfileUpdate(client) 호출
	if client.room != nil {
		// Room에 있는 PlayerInfo를 업데이트해야 하므로, Room에게 알리거나
		// Room이 주기적으로 PlayerInfo를 동기화하도록 해야 함.
		// 간단하게는, PlayerInfo가 사용되는 시점에 Client 객체에서 직접 읽어오므로 별도 동기화 불필요할 수 있음.
		// 다만, 다른 클라이언트에게 "플레이어 정보 변경됨" 알림은 필요.
		// Room.broadcastRoomState() 또는 유사한 메서드를 호출하여 업데이트된 정보를 포함한 방 상태를 다시 브로드캐스트.
		// 또는 특정 플레이어 정보 변경 알림 메시지 타입을 새로 정의.
		// 여기서는 Room.broadcastRoomState()를 호출한다고 가정 (Room이 PlayerInfo를 다시 생성).
		client.room.broadcastRoomState()
		log.Printf("Server: Notified room %s about profile update for %s", client.room.id, client.id)
	}
}

// --- HTTP 핸들러 ---
var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		// 모든 Origin 허용 (개발 중). 프로덕션에서는 특정 Origin만 허용하도록 수정.
		// origin := r.Header.Get("Origin")
		// return origin == "http://localhost:3000" // 예시
		return true
	},
}

// ServeWs는 웹소켓 요청을 처리합니다.
func ServeWs(server *Server, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ServeWs: Failed to upgrade connection: %v", err)
		return
	}
	log.Printf("ServeWs: Client connected from %s", conn.RemoteAddr().String())

	// 클라이언트 ID 생성 (더 견고한 방식 사용 권장)
	// server.mutex.Lock() // nextClientID 접근 동기화
	// clientID := fmt.Sprintf("client-%d", server.nextClientID)
	// server.nextClientID++
	// server.mutex.Unlock()
	clientID := GenerateUniqueID() // utils.go의 함수 사용

	client := NewClient(server, conn, clientID)
	server.register <- client // 서버의 register 채널로 Client 전달

	// 클라이언트에게 ID 할당 및 기본 정보 전송
	client.sendInfoToClient()

	// 각 클라이언트에 대한 읽기/쓰기 고루틴 시작
	go client.writePump()
	go client.readPump() // 이 함수는 블로킹되므로 가장 마지막에 호출하거나, 이전 writePump처럼 go 키워드 사용
}
