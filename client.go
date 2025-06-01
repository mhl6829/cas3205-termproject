package main

import (
	"encoding/json"
	"log"
	"time"

	"github.com/gorilla/websocket"
)

const (
	// 클라이언트가 메시지를 보내기 위해 대기하는 최대 시간
	writeWait = 10 * time.Second
	// 서버로부터 다음 pong 메시지를 기다리는 최대 시간
	pongWait = 60 * time.Second
	// 이 간격으로 클라이언트에게 ping 메시지 전송 (pongWait보다 작아야 함)
	pingPeriod = (pongWait * 9) / 10
	// 클라이언트로부터 허용되는 최대 메시지 크기
	maxMessageSize = 1024 * 4 // 4KB
)

// Client는 서버와 클라이언트 간의 웹소켓 연결 중간자입니다.
type Client struct {
	id     string
	server *Server
	conn   *websocket.Conn
	send   chan []byte // 클라이언트에게 보낼 메시지를 담는 버퍼 채널

	// 방 관련 정보 (Client가 직접 Room을 참조하도록 변경)
	room     *Room
	nickname string
	color    string
	isReady  bool
	isOwner  bool

	// 게임 내 상태 (Game 객체에서 주로 관리되지만, Client에서도 참조 가능)
	// playerState *PlayerState // 필요시 PlayerState 구조체 정의 후 사용
}

// NewClient는 새 Client 인스턴스를 생성합니다.
func NewClient(server *Server, conn *websocket.Conn, clientID string) *Client {
	if clientID == "" {
		clientID = GenerateUniqueID() // utils.go 에 정의된 함수
	}
	return &Client{
		id:     clientID,
		server: server,
		conn:   conn,
		send:   make(chan []byte, 256), // 버퍼 크기 조절 가능
		// 초기값 설정
		nickname: defaultClientID, // utils.go 에 정의된 상수
		color:    "#FFFFFF",       // 기본 색상
	}
}

// readPump는 클라이언트에서 오는 메시지를 서버로 전달합니다.
// 각 연결마다 고루틴으로 실행됩니다.
func (c *Client) readPump() {
	defer func() {
		// 이 Client가 어떤 Room에 속해있다면, Room에게 unregister를 알림
		if c.room != nil {
			// Room의 unregister 채널로 Client 객체 자체를 보내거나, ID를 보낼 수 있음
			// 여기서는 Client 객체를 보내 Room에서 추가 작업(예: owner 변경)을 용이하게 함
			c.room.unregister <- c
		}
		// Server에게도 unregister를 알림
		c.server.unregister <- c
		c.conn.Close()
		log.Printf("Client %s (Nick: %s) disconnected and cleaned up from readPump.", c.id, c.nickname)
	}()

	c.conn.SetReadLimit(maxMessageSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, rawMessage, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("Client %s (Nick: %s) unexpected websocket error: %v", c.id, c.nickname, err)
			} else {
				log.Printf("Client %s (Nick: %s) websocket error (likely closed): %v", c.id, c.nickname, err)
			}
			break // 루프 종료 -> defer 실행
		}

		log.Printf("Received raw message from %s: %s", c.id, string(rawMessage))

		var msg Message
		if err := json.Unmarshal(rawMessage, &msg); err != nil {
			log.Printf("Client %s (Nick: %s) sent invalid JSON: %v. Raw: %s", c.id, c.nickname, err, string(rawMessage))
			// 에러 메시지를 클라이언트에게 보낼 수도 있음
			errorMsg := Message{
				Type:    MessageTypeError,
				Payload: ErrorPayload{Message: "Invalid JSON format."},
			}
			payloadBytes, _ := json.Marshal(errorMsg) // 실제로는 Marshal 에러 처리 필요
			c.send <- payloadBytes
			continue
		}
		msg.Sender = c // 메시지에 발신자 정보 추가

		// 메시지 라우팅
		// 1. 초기 설정 (닉네임, 색상)
		// 2. 방 관련 요청 (생성, 참가, 나가기, 레디 등) -> Room 또는 Server의 방 관리 로직으로
		// 3. 게임 중 액션 -> 현재 속한 Room의 Game 객체로

		if c.room != nil && c.room.game != nil && c.room.game.isRunning &&
			(msg.Type == MessageTypePlayerAction) {
			// 게임이 진행 중이고, 플레이어 액션 메시지라면 Room의 게임 메시지 처리 채널로 전달

			c.room.clientMessage <- &msg // 포인터로 전달
		} else if msg.Type == MessageTypeCreateRoom ||
			msg.Type == MessageTypeJoinRoom ||
			msg.Type == MessageTypeListRooms {
			// 방 생성, 참가, 목록 조회는 Server가 처리
			c.server.routeClientMessage <- &msg
		} else if msg.Type == MessageTypeLeaveRoom ||
			msg.Type == MessageTypeReadyToggle ||
			msg.Type == MessageTypeStartGame {
			// 방 나가기, 레디, 게임 시작은 현재 Client가 속한 Room이 처리
			if c.room != nil {
				log.Println("Room client message received")
				c.room.clientMessage <- &msg
			} else {
				log.Printf("Client %s (Nick: %s) sent room-specific message %s without being in a room.", c.id, c.nickname, msg.Type)
				// 에러 응답
			}
		} else if msg.Type == MessageTypeSetNicknameColor {
			// 닉네임/색상 설정은 Server가 처리하여 Client 객체에 반영하고, 필요시 Room에 알림
			c.server.routeClientMessage <- &msg
		} else {
			log.Printf("Client %s (Nick: %s) sent unhandled message type: %s", c.id, c.nickname, msg.Type)
			// 에러 응답
		}
	}
}

// writePump는 클라이언트에게 메시지를 전송합니다.
// 각 연결마다 고루틴으로 실행됩니다.
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close() // readPump에서도 닫지만, 여기서도 확실히 닫음
		log.Printf("Client %s (Nick: %s) writePump stopped.", c.id, c.nickname)
	}()

	for {
		select {
		case messageBytes, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// 'send' 채널이 닫혔다는 것은 Client가 종료되었다는 의미
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				log.Printf("Client %s (Nick: %s) send channel closed.", c.id, c.nickname)
				return
			}

			w, err := c.conn.NextWriter(websocket.TextMessage)
			if err != nil {
				log.Printf("Client %s (Nick: %s) error getting next writer: %v", c.id, c.nickname, err)
				return
			}
			_, err = w.Write(messageBytes)
			if err != nil {
				log.Printf("Client %s (Nick: %s) error writing message: %v", c.id, c.nickname, err)
				// Write 에러 발생 시 클라이언트 연결 문제로 간주하고 루프 종료 가능
				return
			}

			// 버퍼에 쌓인 메시지가 있다면 한번에 전송 (최적화)
			// n := len(c.send)
			// for i := 0; i < n; i++ {
			// 	w.Write([]byte{'\n'}) // 메시지 구분자 (필요시)
			// 	w.Write(<-c.send)
			// }

			if err := w.Close(); err != nil {
				log.Printf("Client %s (Nick: %s) error closing writer: %v", c.id, c.nickname, err)
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				log.Printf("Client %s (Nick: %s) error sending ping: %v", c.id, c.nickname, err)
				return // Ping 실패는 연결 문제로 간주
			}
		}
	}
}

// sendInfoToClient는 클라이언트에게 기본 정보를 전송합니다. (예: ID 할당)
func (c *Client) sendInfoToClient() {
	msg := Message{
		Type:    MessageTypeUserIDAssigned,
		Payload: UserIDAssignedPayload{UserID: c.id},
	}
	payloadBytes, err := json.Marshal(msg)
	if err != nil {
		log.Printf("Error marshalling user ID assigned message for %s: %v", c.id, err)
		return
	}
	// c.send 채널이 초기화된 후에 호출되어야 함
	if c.send != nil {
		c.send <- payloadBytes
	} else {
		log.Printf("Warning: send channel for client %s is nil when trying to send user ID.", c.id)
	}
}
