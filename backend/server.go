package backend

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
)

type Server struct {
	clients      map[string]*Client
	rooms        map[string]*Room
	nextClientID int64
	mutex        sync.RWMutex

	// 채널
	register           chan *Client  // 새로운 클라이언트 등록
	unregister         chan *Client  // 클라이언트 등록 해제
	createRoom         chan *Client  // 방 생성 요청
	joinRoom           chan *Message // 방 참가 요청
	listRooms          chan *Client  // 방 목록 요청
	removeRoom         chan string   // 방 제거
	routeClientMessage chan *Message // 서버 처리 채널
}

// 서버 인스턴스 생성
func NewServer() *Server {
	s := &Server{
		clients:            make(map[string]*Client, 1),
		rooms:              make(map[string]*Room, 1),
		nextClientID:       1,
		register:           make(chan *Client, 1),
		unregister:         make(chan *Client, 1),
		createRoom:         make(chan *Client, 1),
		joinRoom:           make(chan *Message, 1),
		listRooms:          make(chan *Client, 1),
		removeRoom:         make(chan string, 1),
		routeClientMessage: make(chan *Message, 256),
	}
	go s.run()
	return s
}

// 서버 메인 루프
func (s *Server) run() {
	for {
		select {
		case client := <-s.register:
			// 클라이언트 등록 처리
			s.handleClientRegister(client)
		case client := <-s.unregister:
			// 클라이언트 해제 처리
			s.handleClientUnregister(client)
		case client := <-s.createRoom:
			// 방 생성 처리
			s.handleCreateRoom(client)
		case msg := <-s.joinRoom:
			// 방 참가 처리
			s.handleJoinRoom(msg)
		case client := <-s.listRooms:
			// 방 목록 처리
			s.handleListRooms(client)
		case roomID := <-s.removeRoom:
			// 방 나가기 처리
			s.handleRemoveRoom(roomID)
		case msg := <-s.routeClientMessage:
			// Client.readPump에서 라우팅된 메시지
			s.handleRoutedMessage(msg)
		}
	}
}

// 클라이언트 등록 처리
func (s *Server) handleClientRegister(client *Client) {
	s.mutex.Lock()
	s.clients[client.id] = client
	s.mutex.Unlock()
	log.Printf("Server: Client %s (Nick: %s) registered. Total clients: %d", client.id, client.nickname, len(s.clients))

	// 방 리스트 전송
	s.sendRoomListToClient(client)
}

// 클라이언트 해제 처리
func (s *Server) handleClientUnregister(client *Client) {
	s.mutex.Lock()
	// Room의 unregister 로직 처리 후
	if _, ok := s.clients[client.id]; ok {
		delete(s.clients, client.id)
		log.Printf("Server: Client %s (Nick: %s) unregistered. Total clients: %d", client.id, client.nickname, len(s.clients))
		// 마지막 클라이언트일 경우 방 제거는 Room 에서 처리 후 넘어옴
	}
	s.mutex.Unlock()
}

func (s *Server) handleCreateRoom(owner *Client) {
	// 이미 방에 속해있을 경우
	// 아마도 타이밍 이슈로 인한 케이스
	if owner.room != nil {
		log.Printf("Server: Client %s (Nick: %s) tried to create room but already in room %s.", owner.id, owner.nickname, owner.room.id)
		errorMsg := Message{Type: MessageTypeError, Payload: ErrorPayload{Message: "이미 다른 방에 참여중입니다."}}
		payloadBytes, _ := json.Marshal(errorMsg)
		owner.send <- payloadBytes
		return
	}

	roomID := GenerateRandomRoomID()

	s.mutex.Lock()

	for _, exists := s.rooms[roomID]; exists; _, exists = s.rooms[roomID] {
		roomID = GenerateRandomRoomID()
	}

	room := NewRoom(roomID, owner, s, defaultMaxPlayers)
	s.rooms[roomID] = room

	s.mutex.Unlock()

	log.Printf("Server: Room %s created by %s (Nick: %s). Total rooms: %d", room.id, owner.id, owner.nickname, len(s.rooms))

	// 방 생성자에게 방 정보 전송
	createdMsgPayload := RoomInfo{
		ID:             room.id,
		OwnerID:        owner.id,
		Players:        []PlayerInfo{room.getPlayerInfo(owner)},
		MaxPlayers:     room.maxPlayers,
		State:          room.state,
		CurrentPlayers: 1,
	}
	createdMsg := Message{Type: MessageTypeRoomCreated, Payload: createdMsgPayload}
	payloadBytes, _ := json.Marshal(createdMsg)
	owner.send <- payloadBytes

	// 모든 클라이언트에게 방 목록 Broadcast
	s.broadcastRoomUpdateToAll()
}

func (s *Server) handleJoinRoom(msg *Message) {
	client := msg.Sender

	var joinPayload JoinRoomPayload
	payloadBytes, _ := json.Marshal(msg.Payload)
	if err := json.Unmarshal(payloadBytes, &joinPayload); err != nil {
		log.Printf("Server: Failed to parse join room payload from %s: %v", client.id, err)
		errorMsg := Message{Type: MessageTypeError, Payload: ErrorPayload{Message: "잘못된 방 참가 요청입니다."}}
		responseBytes, _ := json.Marshal(errorMsg)
		client.send <- responseBytes
		return
	}
	roomID := joinPayload.RoomID

	s.mutex.RLock()
	room, ok := s.rooms[roomID]
	s.mutex.RUnlock()

	if !ok {
		log.Printf("Server: Client %s (Nick: %s) tried to join non-existent room %s.", client.id, client.nickname, roomID)
		errorMsg := Message{Type: MessageTypeError, Payload: ErrorPayload{Message: "존재하지 않는 방입니다."}}
		payloadBytes, _ := json.Marshal(errorMsg)
		client.send <- payloadBytes
		return
	}

	// 이미 방에 속해있을 경우
	if client.room != nil && client.room.id != roomID {
		log.Printf("Server: Client %s (Nick: %s) tried to join room %s but already in room %s.", client.id, client.nickname, roomID, client.room.id)
		errorMsg := Message{Type: MessageTypeError, Payload: ErrorPayload{Message: "이미 다른 방에 참여중입니다. 먼저 해당 방에서 나가주세요."}}
		payloadBytes, _ := json.Marshal(errorMsg)
		client.send <- payloadBytes
		return
	}

	// 이미 해당 방에 들어가 있을 경우
	if client.room != nil && client.room.id == roomID {
		log.Printf("Server: Client %s (Nick: %s) tried to join room %s but is already in it.", client.id, client.nickname, roomID)
		room.sendRoomInfoToClient(client)
		return
	}

	// Room의 register 채널로 클라이언트 전달하여 방 참여 처리
	room.register <- client
}

func (s *Server) handleListRooms(client *Client) {
	s.sendRoomListToClient(client)
}

func (s *Server) sendRoomListToClient(client *Client) {
	s.mutex.RLock()

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

// 방 전체 목록 모든 유저들에게 Broadcast
func (s *Server) broadcastRoomUpdateToAll() {
	s.mutex.RLock()

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
		if client.room == nil {
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

// 방 전체 목록 로비에 있는 유저들에게 Broadcast
// TODO: 추후 구현, 현배는 일단 전체 Broadcast
func (s *Server) broadcastRoomUpdate() {
	s.broadcastRoomUpdateToAll()
}

// 방 제거
func (s *Server) handleRemoveRoom(roomID string) {
	s.mutex.Lock()
	delete(s.rooms, roomID)
	s.mutex.Unlock()
	log.Printf("Server: Room %s removed. Total rooms: %d", roomID, len(s.rooms))

	s.broadcastRoomUpdateToAll()
}

// 연결 확인
func (s *Server) isClientConnected(clientID string) bool {
	s.mutex.RLock()
	_, ok := s.clients[clientID]
	s.mutex.RUnlock()
	return ok
}

// Client.readPump에서 1차 라우팅 후 넘어온 메시지 처리
func (s *Server) handleRoutedMessage(msg *Message) {
	client := msg.Sender

	switch msg.Type {
	case MessageTypeCreateRoom:
		s.handleCreateRoom(client)
	case MessageTypeJoinRoom:
		s.handleJoinRoom(msg)
	case MessageTypeListRooms:
		s.handleListRooms(client)
	case MessageTypeSetNicknameColor:
		s.handleSetNicknameColor(msg)
	default:
		log.Printf("Server: Received unhandled routed message type %s from %s (Nick: %s)", msg.Type, client.id, client.nickname)
	}
}

// 클라이언트 초기 정보 설정
func (s *Server) handleSetNicknameColor(msg *Message) {
	client := msg.Sender
	var payload SetNicknameColorPayload
	payloadBytes, _ := json.Marshal(msg.Payload)
	if err := json.Unmarshal(payloadBytes, &payload); err != nil {
		log.Printf("Server: Failed to parse set nickname/color payload from %s: %v", client.id, err)
		return
	}

	// 클라이언트 정보 업데이트
	s.mutex.Lock()
	oldNickname := client.nickname
	client.nickname = payload.Nickname
	client.color = payload.Color
	client.character = payload.Character
	s.mutex.Unlock()

	log.Printf("Server: Client %s updated profile. Nickname: %s -> %s, Color: %s, Character: %s", client.id, oldNickname, client.nickname, client.color, client.character)

	// 방에 이미 들어가있다면 방의 멤버에게 모두 Broadcast
	// 현재는 불가능한 케이스이지만 추후 방에서 캐릭터 변경 가능할 시 추가
	if client.room != nil {
		client.room.broadcastRoomState()
		log.Printf("Server: Notified room %s about profile update for %s", client.room.id, client.id)
	}
}

// Websocket Upgrader
var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		origin := r.Header.Get("Origin")
		// 개발용 localhost이거나 배포용 도메인일 경우 허용
		return origin == "http://localhost:8080" || origin == "https://cas3205.myeonghoonlee.cloud"
	},
}

func ServeWs(server *Server, w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ServeWs: Failed to upgrade connection: %v", err)
		return
	}
	log.Printf("ServeWs: Client connected from %s", conn.RemoteAddr().String())

	// 클라이언트 ID 생성
	clientID := GenerateUniqueID()

	client := NewClient(server, conn, clientID)
	// 서버의 register 채널로 Client 전달
	server.register <- client

	// 클라이언트에게 ID 할당 및 기본 정보 전송
	client.sendInfoToClient()

	// 클라이언트 Reader, Writer 실행
	go client.writePump()
	// 블로킹
	go client.readPump()
}
