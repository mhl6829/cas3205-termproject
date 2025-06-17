package backend

import "time"

type MessageType string

const (
	// From Client To Server
	MessageTypeSetNicknameColor    MessageType = "set_nickname_color"
	MessageTypeCreateRoom          MessageType = "create_room"
	MessageTypeJoinRoom            MessageType = "join_room"
	MessageTypeListRooms           MessageType = "list_rooms"
	MessageTypeLeaveRoom           MessageType = "leave_room"
	MessageTypeReadyToggle         MessageType = "ready_toggle"
	MessageTypeStartGame           MessageType = "start_game"
	MessageTypePlayerAction        MessageType = "player_action"
	MessageTypeGameLoadingComplete MessageType = "game_loading_complete"

	// From Server To Client
	MessageTypeError              MessageType = "error"
	MessageTypeUserIDAssigned     MessageType = "user_id_assigned"
	MessageTypeRoomCreated        MessageType = "room_created"
	MessageTypeRoomJoined         MessageType = "room_joined"
	MessageTypeRoomListUpdated    MessageType = "room_list_updated"
	MessageTypePlayerJoined       MessageType = "player_joined"
	MessageTypePlayerLeft         MessageType = "player_left"
	MessageTypePlayerReadyChanged MessageType = "player_ready_changed"
	MessageTypeGameInitData       MessageType = "game_init_data"
	MessageTypeGameCountdown      MessageType = "game_countdown"
	MessageTypeGameStarted        MessageType = "game_started"
	MessageTypeGameStateUpdate    MessageType = "game_state_update"
	MessageTypeGameEnded          MessageType = "game_ended"
	MessageTypeRoomStateUpdated   MessageType = "room_state_updated"
)

// 기본 Message 타입
type Message struct {
	Type    MessageType `json:"type"`
	Payload interface{} `json:"payload,omitempty"`
	Sender  *Client     `json:"-"`
}

// PAYLOADS

// 초기 설정
type SetNicknameColorPayload struct {
	Nickname  string `json:"nickname"`
	Color     string `json:"color"`
	Character string `json:"character"`
}

// 방 생성
type CreateRoomPayload struct {
}

// 방 참가
type JoinRoomPayload struct {
	RoomID string `json:"room_id"`
}

// 플레이어 액션
type PlayerActionPayload struct {
	ActionType string      `json:"action_type"`
	Data       interface{} `json:"data"`
}

// 에러 Payload
type ErrorPayload struct {
	Message string `json:"message"`
}

// 유저 ID 할당
type UserIDAssignedPayload struct {
	UserID string `json:"user_id"`
}

// 방 정보
type RoomInfo struct {
	ID             string       `json:"id"`
	OwnerID        string       `json:"owner_id"`
	Players        []PlayerInfo `json:"players"`
	MaxPlayers     int          `json:"max_players"`
	State          RoomState    `json:"state"`
	CurrentPlayers int          `json:"current_players"`
}

// 대기실에서 플레이어 상태
type PlayerInfo struct {
	ID        string `json:"id"`
	Nickname  string `json:"nickname"`
	Color     string `json:"color"`
	Character string `json:"character,omitempty"`
	Asset     string `json:"asset,omitempty"`
	IsReady   bool   `json:"is_ready"`
	IsOwner   bool   `json:"is_owner"`
}

// 방 리스트
type RoomListPayload struct {
	Rooms []RoomListItem `json:"rooms"`
}

// 방 리스트 정보
type RoomListItem struct {
	ID             string    `json:"id"`
	CurrentPlayers int       `json:"current_players"`
	MaxPlayers     int       `json:"max_players"`
	State          RoomState `json:"state"`
}

// 게임 시작 카운트다운
type GameCountdownPayload struct {
	SecondsLeft int `json:"seconds_left"`
}

// 게임 상태 업데이트
type GameStateUpdatePayload struct {
	Players   []PlayerStateInfo `json:"players"`
	TimeLeft  int               `json:"time_left"`
	GameState interface{}       `json:"game_specific_state,omitempty"`
}

// 게임 진행 중 플레이어 상태
type PlayerStateInfo struct {
	ID               string  `json:"id"`
	Nickname         string  `json:"nickname"`
	Color            string  `json:"color"`
	X                float64 `json:"x"`
	Y                float64 `json:"y"`
	Z                float64 `json:"z"`
	Yaw              float64 `json:"yaw"`
	Pitch            float64 `json:"pitch"`
	Score            int     `json:"score"`
	Asset            string  `json:"asset,omitempty"`
	CurrentAnimation string  `json:"current_animation,omitempty"`
	Health           int     `json:"health"`
	MaxHealth        int     `json:"max_health"`
	IsAlive          bool    `json:"is_alive"`
	IsInvincible     bool    `json:"is_invincible"`
}

// 게임 종료 결과
type GameEndedPayload struct {
	FinalScores []PlayerScore `json:"final_scores"`
	Reason      string        `json:"reason,omitempty"`
}

// 스코어
type PlayerScore struct {
	PlayerID string `json:"player_id"`
	Nickname string `json:"nickname"`
	Score    int    `json:"score"`
}

// 새로운 Player 참여
type PlayerJoinedPayload struct {
	PlayerInfo PlayerInfo `json:"player_info"`
}

// Player 방 나감
type PlayerLeftPayload struct {
	PlayerID   string `json:"player_id"`
	NewOwnerID string `json:"new_owner_id,omitempty"` // 방장이 나갔을 경우 새 방장 ID
}

// Player 준비 상태 변경
type PlayerReadyChangedPayload struct {
	PlayerID string `json:"player_id"`
	IsReady  bool   `json:"is_ready"`
}

// Room 상태 변경
type RoomStateUpdatedPayload struct {
	RoomID   string       `json:"room_id"`
	NewState RoomState    `json:"new_state"`
	Players  []PlayerInfo `json:"players"`
}

// 메세지 타임스탬프 (추후 추가)
type TimestampedMessage struct {
	Message
	Timestamp time.Time `json:"timestamp"`
}

// 게임 시작시 init data
type GameInitDataPayload struct {
	Players    []PlayerStateInfo `json:"players"`     // 모든 플레이어의 초기 상태
	MapData    interface{}       `json:"map_data"`    // 맵 관련 데이터 (추후 추가)
	GameConfig interface{}       `json:"game_config"` // 게임 설정 (추후 추가)
}

// 게임 로딩 완료
type GameLoadingCompletePayload struct {
	PlayerID string `json:"player_id"`
}
