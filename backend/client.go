package backend

import (
	"encoding/json"
	"log"
	"time"

	"github.com/gorilla/websocket"
)

const (
	// wait interval
	writeWait = 10 * time.Second
	// pong interval
	pongWait = 60 * time.Second
	// ping interval
	pingPeriod = (pongWait * 9) / 10
	// 최대 메세지 크기
	maxMessageSize = 1024 * 4 // 4KB
)

type Client struct {
	id     string
	server *Server
	conn   *websocket.Conn
	send   chan []byte

	room      *Room
	nickname  string
	color     string
	character string
	isReady   bool
	isOwner   bool
}

func NewClient(server *Server, conn *websocket.Conn, clientID string) *Client {
	if clientID == "" {
		clientID = GenerateUniqueID()
	}
	return &Client{
		id:        clientID,
		server:    server,
		conn:      conn,
		send:      make(chan []byte, 256),
		nickname:  defaultClientID,
		color:     "#FFFFFF",
		character: "onion",
	}
}

// Client Message Reader
// 연결마다 고루틴 생성
func (c *Client) readPump() {
	defer func() {
		// Room에 있으면 unregister
		if c.room != nil {
			c.room.unregister <- c
		}
		// Server에서도 unregister
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
		// Unhandled error
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("Client %s (Nick: %s) unexpected websocket error: %v", c.id, c.nickname, err)
			} else {
				log.Printf("Client %s (Nick: %s) websocket error (likely closed): %v", c.id, c.nickname, err)
			}
			// 루프 종료
			// defer 실행
			break
		}

		// 로그용
		// log.Printf("Received raw message from %s: %s", c.id, string(rawMessage))

		var msg Message
		if err := json.Unmarshal(rawMessage, &msg); err != nil {
			log.Printf("Client %s (Nick: %s) sent invalid JSON: %v. Raw: %s", c.id, c.nickname, err, string(rawMessage))

			errorMsg := Message{
				Type:    MessageTypeError,
				Payload: ErrorPayload{Message: "Invalid JSON format."},
			}

			// TODO: Marshalling 에러 처리
			payloadBytes, _ := json.Marshal(errorMsg)
			c.send <- payloadBytes
			continue
		}

		// Sender 정보 추가
		msg.Sender = c

		// 메시지 라우팅
		// 1. 초기 설정 (닉네임, 색상)
		// 2. 방 관련 요청 (생성, 참가, 나가기, 레디 등) -> Room 또는 Server의 방 관리 로직으로
		// 3. 게임 중 액션 -> 현재 속한 Room의 Game 객체로

		if c.room != nil && c.room.game != nil && (msg.Type == MessageTypeGameLoadingComplete || msg.Type == MessageTypePlayerAction) {
			// 게임 진행중이면 room의 clientMessage 채널이 처리
			c.room.clientMessage <- &msg
		} else if msg.Type == MessageTypeCreateRoom ||
			msg.Type == MessageTypeJoinRoom ||
			msg.Type == MessageTypeListRooms {
			// 방 생성, 참가, 목록 조회는 Server가 처리
			c.server.routeClientMessage <- &msg
		} else if msg.Type == MessageTypeLeaveRoom ||
			msg.Type == MessageTypeReadyToggle ||
			msg.Type == MessageTypeStartGame {
			// 방 나가기, 준비, 게임 시작은 현재 Client가 속한 room의 clientMessage 채널이 처리
			if c.room != nil {
				log.Println("Room client message received")
				c.room.clientMessage <- &msg
			} else {
				log.Printf("Client %s (Nick: %s) sent room-specific message %s without being in a room.", c.id, c.nickname, msg.Type)
				// 에러 응답
			}
		} else if msg.Type == MessageTypeSetNicknameColor {
			// 닉네임/색상 설정은 Server가 처리하여 Client 객체에 반영
			c.server.routeClientMessage <- &msg
		} else {
			log.Printf("Client %s (Nick: %s) sent unhandled message type: %s", c.id, c.nickname, msg.Type)
			// 에러 응답
		}
	}
}

// Client Message Writer
// 연결마다 고루틴 생성
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
		log.Printf("Client %s (Nick: %s) writePump stopped.", c.id, c.nickname)
	}()

	for {
		select {
		case messageBytes, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// send 채널 닫혔을 시 close 처리
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
				return
			}

			if err := w.Close(); err != nil {
				log.Printf("Client %s (Nick: %s) error closing writer: %v", c.id, c.nickname, err)
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))

			// Ping 실패시
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				log.Printf("Client %s (Nick: %s) error sending ping: %v", c.id, c.nickname, err)
				return
			}
		}
	}
}

// 클라이언트 정보 전송
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

	if c.send != nil {
		c.send <- payloadBytes
	} else {
		log.Printf("Warning: send channel for client %s is nil when trying to send user ID.", c.id)
	}
}
