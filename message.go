package main

import "time"

// MessageType은 웹소켓 메시지의 유형을 나타냅니다.
type MessageType string

const (
	// 클라이언트 -> 서버 메시지 타입
	MessageTypeSetNicknameColor    MessageType = "set_nickname_color"
	MessageTypeCreateRoom          MessageType = "create_room"
	MessageTypeJoinRoom            MessageType = "join_room"
	MessageTypeListRooms           MessageType = "list_rooms"
	MessageTypeLeaveRoom           MessageType = "leave_room"
	MessageTypeReadyToggle         MessageType = "ready_toggle"
	MessageTypeStartGame           MessageType = "start_game"            // 방장만 전송
	MessageTypePlayerAction        MessageType = "player_action"         // 게임 중 클라이언트 입력
	MessageTypeGameLoadingComplete MessageType = "game_loading_complete" // 클라이언트가 게임 로딩 완료 알림

	// 서버 -> 클라이언트 메시지 타입
	MessageTypeError              MessageType = "error"
	MessageTypeUserIDAssigned     MessageType = "user_id_assigned" // 연결 시 클라이언트에게 고유 ID 할당 알림
	MessageTypeRoomCreated        MessageType = "room_created"
	MessageTypeRoomJoined         MessageType = "room_joined"
	MessageTypeRoomListUpdated    MessageType = "room_list_updated"
	MessageTypePlayerJoined       MessageType = "player_joined" // 기존 방 멤버에게 새 멤버 알림
	MessageTypePlayerLeft         MessageType = "player_left"
	MessageTypePlayerReadyChanged MessageType = "player_ready_changed"
	MessageTypeGameInitData       MessageType = "game_init_data" // 게임 시작 시 초기화 데이터
	MessageTypeGameCountdown      MessageType = "game_countdown"
	MessageTypeGameStarted        MessageType = "game_started"
	MessageTypeGameStateUpdate    MessageType = "game_state_update"
	MessageTypeGameEnded          MessageType = "game_ended"
	MessageTypeRoomStateUpdated   MessageType = "room_state_updated" // 방 상태 변경 알림 (예: 게임 후 대기방으로)
)

// Message는 클라이언트와 서버 간에 주고받는 기본 메시지 구조입니다.
type Message struct {
	Type    MessageType `json:"type"`
	Payload interface{} `json:"payload,omitempty"` // 실제 데이터, omitempty는 nil일 경우 생략
	Sender  *Client     `json:"-"`                 // 메시지를 보낸 클라이언트 (서버 내부용, JSON에는 포함 안 됨)
}

// --- 페이로드 구조체 정의 ---

// SetNicknameColorPayload는 닉네임과 색상 설정을 위한 페이로드입니다.
type SetNicknameColorPayload struct {
	Nickname  string `json:"nickname"`
	Color     string `json:"color"`
	Character string `json:"character"`
}

// CreateRoomPayload는 방 생성시 추가 옵션이 필요할 경우 사용합니다. (현재는 비어있음)
type CreateRoomPayload struct {
	// 예: RoomName string `json:"room_name"`
}

// JoinRoomPayload는 방 참가를 위한 페이로드입니다.
type JoinRoomPayload struct {
	RoomID string `json:"room_id"`
}

// PlayerActionPayload는 플레이어의 게임 내 액션을 위한 페이로드입니다.
type PlayerActionPayload struct {
	ActionType string      `json:"action_type"` // "key_input", "mouse_move" 등
	Data       interface{} `json:"data"`        // 예: {"key": "W", "pressed": true} 또는 {"yaw": 0.5, "pitch": -0.2}
}

// ErrorPayload는 에러 메시지를 위한 페이로드입니다.
type ErrorPayload struct {
	Message string `json:"message"`
}

// UserIDAssignedPayload는 클라이언트에게 ID 할당 시 사용합니다.
type UserIDAssignedPayload struct {
	UserID string `json:"user_id"`
}

// RoomInfo는 방 목록이나 방 정보 전달 시 사용되는 구조체입니다.
type RoomInfo struct {
	ID             string       `json:"id"`
	OwnerID        string       `json:"owner_id"`
	Players        []PlayerInfo `json:"players"`
	MaxPlayers     int          `json:"max_players"`
	State          RoomState    `json:"state"` // RoomState는 room.go에 정의 예정
	CurrentPlayers int          `json:"current_players"`
	// Name string `json:"name,omitempty"` // 방 이름 (선택적)
}

// PlayerInfo는 플레이어의 기본 정보를 나타냅니다.
type PlayerInfo struct {
	ID       string `json:"id"`
	Nickname string `json:"nickname"`
	Color    string `json:"color"`
	Asset    string `json:"asset,omitempty"` // 사용할 3D 모델 에셋 (예: "bunny.glb")
	IsReady  bool   `json:"is_ready"`
	IsOwner  bool   `json:"is_owner"`
}

// RoomListPayload는 방 목록을 전달하기 위한 페이로드입니다.
type RoomListPayload struct {
	Rooms []RoomListItem `json:"rooms"`
}

// RoomListItem은 방 목록의 각 항목을 나타냅니다.
type RoomListItem struct {
	ID             string    `json:"id"`
	CurrentPlayers int       `json:"current_players"`
	MaxPlayers     int       `json:"max_players"`
	State          RoomState `json:"state"`
	// Name string `json:"name,omitempty"`
}

// GameCountdownPayload는 게임 카운트다운 시 남은 시간을 전달합니다.
type GameCountdownPayload struct {
	SecondsLeft int `json:"seconds_left"`
}

// GameStateUpdatePayload는 게임 중 상태 업데이트를 위해 사용됩니다.
type GameStateUpdatePayload struct {
	Players   []PlayerStateInfo `json:"players"`
	TimeLeft  int               `json:"time_left"`                     // 초 단위
	GameState interface{}       `json:"game_specific_state,omitempty"` // 게임별 추가 상태
}

// PlayerStateInfo는 게임 상태 업데이트 시 플레이어의 상세 정보를 나타냅니다.
type PlayerStateInfo struct {
	ID       string  `json:"id"`
	Nickname string  `json:"nickname"`
	Color    string  `json:"color"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	Z        float64 `json:"z"`
	Yaw      float64 `json:"yaw"`
	Pitch    float64 `json:"pitch"`
	Score    int     `json:"score"`
	Asset    string  `json:"asset,omitempty"` // 사용할 3D 모델 에셋

	// 체력 시스템
	Health       int  `json:"health"`        // 현재 체력
	MaxHealth    int  `json:"max_health"`    // 최대 체력
	IsAlive      bool `json:"is_alive"`      // 생존 상태
	IsInvincible bool `json:"is_invincible"` // 무적 상태

	// 애니메이션 시스템 (추후 구현 예정)
	CurrentAnimation string `json:"current_animation,omitempty"` // 현재 재생 중인 애니메이션 클립
}

// GameEndedPayload는 게임 종료 시 최종 결과를 전달합니다.
type GameEndedPayload struct {
	FinalScores []PlayerScore `json:"final_scores"`
	Reason      string        `json:"reason,omitempty"` // 예: "time_up", "owner_left"
}

// PlayerScore는 게임 종료 시 플레이어의 최종 점수를 나타냅니다.
type PlayerScore struct {
	PlayerID string `json:"player_id"`
	Nickname string `json:"nickname"`
	Score    int    `json:"score"`
}

// PlayerJoinedPayload는 새로운 플레이어가 방에 참여했음을 알리는 페이로드입니다.
// 기존 방 멤버들에게 전송됩니다.
type PlayerJoinedPayload struct {
	PlayerInfo PlayerInfo `json:"player_info"` // 새로 참여한 플레이어의 정보
}

// PlayerLeftPayload는 플레이어가 방을 나갔을 때 사용됩니다.
type PlayerLeftPayload struct {
	PlayerID   string `json:"player_id"`
	NewOwnerID string `json:"new_owner_id,omitempty"` // 방장이 나갔을 경우 새 방장 ID
}

// PlayerReadyChangedPayload는 플레이어의 준비 상태 변경을 알립니다.
type PlayerReadyChangedPayload struct {
	PlayerID string `json:"player_id"`
	IsReady  bool   `json:"is_ready"`
}

// RoomStateUpdatedPayload는 방의 상태가 변경되었음을 알립니다. (예: 게임 종료 후 대기방으로)
type RoomStateUpdatedPayload struct {
	RoomID   string       `json:"room_id"`
	NewState RoomState    `json:"new_state"`
	Players  []PlayerInfo `json:"players"` // 업데이트된 플레이어 목록 (레디 상태 초기화 등)
}

// TimestampedMessage는 메시지에 타임스탬프를 추가할 때 사용할 수 있습니다. (선택적)
type TimestampedMessage struct {
	Message
	Timestamp time.Time `json:"timestamp"`
}

// OutgoingMessage는 서버가 클라이언트에게 보낼 메시지를 래핑합니다.
// 클라이언트에게 Sender 정보를 보낼 필요가 없으므로 별도 구조체를 사용하거나,
// 전송 시점에 Marshal 하면서 Sender 필드를 제외할 수 있습니다.
// 여기서는 간단히 Message 구조체를 그대로 사용하고, 전송 시 Sender는 nil로 설정합니다.

// GameInitDataPayload는 게임 시작 시 클라이언트에게 전송되는 초기화 데이터입니다.
type GameInitDataPayload struct {
	Players    []PlayerStateInfo `json:"players"`     // 모든 플레이어의 초기 상태
	MapData    interface{}       `json:"map_data"`    // 맵 관련 데이터 (선택적)
	GameConfig interface{}       `json:"game_config"` // 게임 설정 (선택적)
}

// GameLoadingCompletePayload는 클라이언트가 게임 로딩을 완료했을 때 전송합니다.
type GameLoadingCompletePayload struct {
	PlayerID string `json:"player_id"`
}
