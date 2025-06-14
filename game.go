package main

import (
	"fmt"
	"log"
	"math"
	"sync"
	"time"
)

const (
	gameFPS             = 30
	gameTickRate        = time.Second / gameFPS
	countdownSeconds    = 5
	defaultGameDuration = 180 * time.Second
	playerSpeed         = 0.5

	// 맵 설정
	mapSize     = 40.0 // 맵 크기 (40x40)
	mapBoundary = 20.0 // 맵 경계 (±20)

	// 망치 설정
	hammerRange     = 3.0             // 망치의 공격 범위
	hammerDamage    = 1               // 망치 한 번 때릴 때 데미지
	maxPlayerHealth = 3               // 플레이어 최대 체력
	respawnDelay    = 3 * time.Second // 죽고 부활까지 걸리는 시간

	hammerCooldown     = 500 * time.Millisecond  // 망치 공격 쿨다운
	hammerDuration     = 500 * time.Millisecond  // 망치 애니메이션 지속 시간
	hitDuration        = 1000 * time.Millisecond // 맞기 애니메이션 지속 시간
	deathDuration      = 3000 * time.Millisecond // 죽음 애니메이션 지속 시간
	respawnDuration    = 500 * time.Millisecond  // 부활 애니메이션 지속 시간
	invincibleDuration = 2000 * time.Millisecond // 무적 상태 지속 시간
)

// 망치 공격 정보
type HammerAttack struct {
	ID         string    `json:"id"`
	AttackerID string    `json:"attacker_id"`
	X          float64   `json:"x"`
	Z          float64   `json:"z"`
	DirectionX float64   `json:"direction_x"`
	DirectionZ float64   `json:"direction_z"`
	CreatedAt  time.Time `json:"created_at"`
	HitTime    time.Time `json:"hit_time"` // 실제 타격 판정 시간
	Color      string    `json:"color"`
}

// 게임 상태
type Game struct {
	room          *Room
	players       map[*Client]*PlayerState
	hammerAttacks map[string]*HammerAttack // 망치 공격 관리
	startTime     time.Time
	duration      time.Duration
	ticker        *time.Ticker
	isReady       bool
	isRunning     bool
	quit          chan struct{}
	mutex         sync.RWMutex
	attackCounter int // 망치 공격 ID 생성용
}

// 게임 내 플레이어의 상태
type PlayerState struct {
	Nickname string  `json:"nickname"`
	Color    string  `json:"color"`
	ID       string  `json:"id"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
	Z        float64 `json:"z"`
	Yaw      float64 `json:"yaw"`
	Pitch    float64 `json:"pitch"`
	Score    int     `json:"score"`
	Asset    string  `json:"asset"` // 사용할 3D 모델 에셋

	// 체력 시스템
	Health       int       `json:"health"`        // 현재 체력
	MaxHealth    int       `json:"max_health"`    // 최대 체력
	IsAlive      bool      `json:"is_alive"`      // 생존 상태
	IsInvincible bool      `json:"is_invincible"` // 무적 상태
	DeathTime    time.Time `json:"death_time"`    // 죽은 시간
	RespawnTime  time.Time `json:"respawn_time"`  // 부활 시간

	// 애니메이션 관련
	CurrentAnimation string    `json:"current_animation,omitempty"` // 현재 재생 중인 애니메이션
	AnimationStart   time.Time `json:"animation_start,omitempty"`   // 애니메이션 시작 시간

	// 키 방향
	MoveForward float64
	MoveStrafe  float64

	LastActionTime  time.Time
	LastAttackTime  time.Time // 마지막 공격 시간
	LastHitTime     time.Time // 마지막 피격 시간
	InvincibleUntil time.Time // 무적 상태 지속 시간
	IsConnected     bool
}

// NewGame은 새 Game 인스턴스를 생성합니다.
func NewGame(room *Room, gamePlayers []*Client) *Game {
	g := &Game{
		room:          room,
		players:       make(map[*Client]*PlayerState),
		hammerAttacks: make(map[string]*HammerAttack),
		duration:      defaultGameDuration,
		quit:          make(chan struct{}),
		isReady:       false,
		isRunning:     false,
		attackCounter: 0,
	}

	// 플레이어들을 원형으로 배치
	numPlayers := len(gamePlayers)
	angleStep := 2 * math.Pi / float64(numPlayers)
	spawnRadius := 10.0 // 중심에서 플레이어까지의 거리

	for i, client := range gamePlayers {
		angle := float64(i) * angleStep
		x := spawnRadius * math.Cos(angle)
		z := spawnRadius * math.Sin(angle)

		// 캐릭터에 따른 asset 설정
		assetFile := client.character + ".glb"

		g.players[client] = &PlayerState{
			Color:    client.color,
			Nickname: client.nickname,
			ID:       client.id,
			X:        x, Y: 0, Z: z, // 원형으로 분산된 위치
			Yaw:              -angle + math.Pi, // 중심을 바라보도록 설정
			Pitch:            0,
			Score:            0,
			Asset:            assetFile, // 캐릭터에 맞는 3D 모델 에셋
			Health:           maxPlayerHealth,
			MaxHealth:        maxPlayerHealth,
			IsAlive:          true,
			IsInvincible:     false,
			IsConnected:      true,
			MoveForward:      0, // Initialize movement intentions
			MoveStrafe:       0,
			CurrentAnimation: "idle", // 기본 애니메이션
			AnimationStart:   time.Now(),
		}

		log.Printf("Player %s (Nick: %s) spawned at position (%.2f, 0, %.2f) with yaw %.2f",
			client.id, client.nickname, x, z, g.players[client].Yaw)
	}
	return g
}

// 게임 준비 상태
func (g *Game) Ready() {
	log.Printf("Game in Room %s: Ready...", g.room.id)
	g.isReady = true
	// Update Room state only after acquiring the Room's lock
	g.room.mutex.Lock()
	g.room.state = RoomStatePlaying
	g.room.mutex.Unlock()

	g.ticker = time.NewTicker(gameTickRate)
	go g.gameLoop()
}

// 카운트다운 후 게임 루프 실행
func (g *Game) Start() {
	log.Printf("Game in Room %s: Starting countdown...", g.room.id)

	for i := countdownSeconds; i > 0; i-- {
		countdownPayload := GameCountdownPayload{SecondsLeft: i}
		msg := Message{Type: MessageTypeGameCountdown, Payload: countdownPayload}
		g.room.broadcastMessage(msg, nil)
		time.Sleep(time.Second)
	}

	g.startTime = time.Now()
	g.isRunning = true

	startMsg := Message{Type: MessageTypeGameStarted, Payload: nil}
	g.room.broadcastMessage(startMsg, nil)
	g.room.server.broadcastRoomUpdate()

	log.Printf("Game in Room %s: Started! Duration: %v", g.room.id, g.duration)
}

// 게임 상태를 업데이트 & 브로드캐스트
func (g *Game) gameLoop() {
	defer func() {
		if g.ticker != nil {
			g.ticker.Stop()
		}
		g.isReady = false
		log.Printf("Game in Room %s: Gameloop stopped.", g.room.id)
	}()

	for {
		select {
		case <-g.ticker.C:
			if !g.isReady {
				return
			}
			g.updateGameState()
			g.broadcastGameState()

			if g.isRunning && time.Since(g.startTime) >= g.duration {
				log.Printf("Game in Room %s: Time is up!", g.room.id)
				g.StopGame("time_up")
				return
			}

		case <-g.quit:
			log.Printf("Game in Room %s: Quit signal received, stopping gameloop.", g.room.id)
			return
		}
	}
}

// 상태를 업데이트
func (g *Game) updateGameState() {
	g.mutex.Lock() // Lock for mutating player states

	// 1. 플레이어 업데이트
	for _, ps := range g.players {
		if !ps.IsConnected {
			continue // 연결 끊긴 플레이어는 업데이트하지 않음
		}

		// 부활 처리
		if !ps.IsAlive && time.Since(ps.DeathTime) >= respawnDelay {
			ps.Health = ps.MaxHealth
			ps.IsAlive = true
			ps.RespawnTime = time.Now()
			// 부활 무적
			ps.IsInvincible = true
			ps.InvincibleUntil = time.Now().Add(invincibleDuration)
			// 리스폰 시 원점으로 이동
			ps.X = 0
			ps.Y = 0
			ps.Z = 0
			// 부활 애니메이션 클립 설정
			ps.CurrentAnimation = "respawn"
			ps.AnimationStart = time.Now()
			log.Printf("Player %s respawned with full health at origin (0,0,0)", ps.ID)
		}

		// 애니메이션 클립 자동 종료 (일정 시간 후 idle로 변경)
		if ps.CurrentAnimation != "" && ps.CurrentAnimation != "idle" && ps.CurrentAnimation != "walk_forward" {
			animationDuration := 2 * time.Second // 기본 애니메이션 지속시간
			if ps.CurrentAnimation == "hammer_attack" {
				animationDuration = hammerDuration
			} else if ps.CurrentAnimation == "death" {
				animationDuration = deathDuration
			} else if ps.CurrentAnimation == "respawn" {
				animationDuration = respawnDuration
			} else if ps.CurrentAnimation == "hit" {
				animationDuration = hitDuration
			}

			if time.Since(ps.AnimationStart) >= animationDuration {
				// 이동 중이면 walk, 아니면 idle
				if ps.MoveForward != 0 || ps.MoveStrafe != 0 {
					ps.CurrentAnimation = "walk_forward"
				} else {
					ps.CurrentAnimation = "idle"
				}
				ps.AnimationStart = time.Now()
			}
		}

		// 무적상태 처리
		if ps.IsInvincible {
			if time.Now().After(ps.InvincibleUntil) {
				ps.IsInvincible = false
			}
		}

		// 죽은 플레이어는 이동하지 않음
		if !ps.IsAlive {
			continue
		}

		// 공격 중에는 이동하지 않음 (1초간)
		if time.Since(ps.LastAttackTime) < hammerDuration {
			continue
		}

		// 피격시 이동하지 않음 (1초간)
		if time.Since(ps.LastHitTime) < hitDuration {
			continue
		}

		// 이동 처리 (맵 기준 절대적 이동)
		var deltaX, deltaZ float64

		// 전후 이동 (맵 기준 Z축 방향)
		// W(forward=1) = Z축 양의 방향, S(backward=-1) = Z축 음의 방향
		deltaZ = -ps.MoveForward

		// 좌우 이동 (맵 기준 X축 방향)
		// D(right=-1) = X축 음의 방향, A(left=1) = X축 양의 방향
		deltaX = -ps.MoveStrafe

		// 이동 벡터 정규화 (대각선 이동 시 속도가 빨라지는 것을 방지)
		if deltaX != 0 || deltaZ != 0 {
			magnitude := math.Sqrt(deltaX*deltaX + deltaZ*deltaZ)
			if magnitude > 0 {
				deltaX = (deltaX / magnitude) * playerSpeed
				deltaZ = (deltaZ / magnitude) * playerSpeed
			}
		}

		ps.X += deltaX
		ps.Z += deltaZ

		// 맵 경계 처리 (플레이어가 맵 밖으로 나가지 못하도록)
		ps.X = math.Max(-mapBoundary+1, math.Min(mapBoundary-1, ps.X))
		ps.Z = math.Max(-mapBoundary+1, math.Min(mapBoundary-1, ps.Z))

		// 이동 애니메이션 처리
		if deltaX != 0 || deltaZ != 0 {
			// 이동 중일 때는 걷기 애니메이션 (다른 애니메이션이 재생 중이 아닐 때만)
			if ps.CurrentAnimation == "idle" || ps.CurrentAnimation == "" {
				ps.CurrentAnimation = "walk_forward"
				ps.AnimationStart = time.Now()
			}
		} else {
			// 이동하지 않을 때는 idle 애니메이션 (다른 애니메이션이 재생 중이 아닐 때만)
			if ps.CurrentAnimation == "walk_forward" {
				ps.CurrentAnimation = "idle"
				ps.AnimationStart = time.Now()
			}
		}
	}

	// 2. 망치 공격 처리
	g.updateHammerAttacks()

	// 주석처리: 총알 업데이트
	// g.updateBullets()

	g.mutex.Unlock()
}

// 망치 공격들을 처리
func (g *Game) updateHammerAttacks() {
	toDelete := make([]string, 0)
	now := time.Now()

	for attackID, attack := range g.hammerAttacks {
		// 판정 시간 지나지 않았으면 아직 판정하지 않음
		if now.Before(attack.HitTime) {
			continue
		}

		// 공격 범위 내 플레이어들 확인
		hitPlayerIDs := g.checkHammerPlayerCollision(attack)

		for _, hitPlayerID := range hitPlayerIDs {
			if hitPlayerID != attack.AttackerID {
				// 피해 처리
				for _, ps := range g.players {
					if ps.ID == hitPlayerID && ps.IsAlive {
						ps.Health -= hammerDamage
						log.Printf("Player %s hit player %s with hammer! Damage: %d, Remaining health: %d",
							attack.AttackerID, hitPlayerID, hammerDamage, ps.Health)

						// 죽음 처리
						if ps.Health <= 0 {
							ps.Health = 0
							ps.IsAlive = false
							ps.LastHitTime = now
							ps.DeathTime = now
							// 죽을 때 애니메이션 클립 설정
							ps.CurrentAnimation = "death"
							ps.AnimationStart = now
							log.Printf("Player %s was killed by %s!", hitPlayerID, attack.AttackerID)

							// 킬한 플레이어에게만 점수 추가 (죽였을 때만 점수 획득)
							for _, attackerPs := range g.players {
								if attackerPs.ID == attack.AttackerID {
									attackerPs.Score++
									log.Printf("Player %s got a KILL! Score: %d", attack.AttackerID, attackerPs.Score)
									break
								}
							}
						} else {
							// 맞기 애니메이션 설정
							ps.CurrentAnimation = "hit"
							ps.AnimationStart = now
							ps.LastHitTime = now
							// 일시 무적처리
							ps.InvincibleUntil = now.Add(invincibleDuration)
							ps.IsInvincible = true
						}
						break
					}
				}
			}
		}

		// 타격 판정 후 제거
		toDelete = append(toDelete, attackID)
	}

	// 처리된 망치 공격들 삭제
	for _, attackID := range toDelete {
		delete(g.hammerAttacks, attackID)
	}
}

// 망치와 플레이어의 충돌을 확인
func (g *Game) checkHammerPlayerCollision(attack *HammerAttack) []string {
	hitPlayers := make([]string, 0)

	// 망치 공격 위치 계산 (공격자 위치에서 바라보는 방향으로 hammerRange만큼 앞)
	attackX := attack.X + attack.DirectionX*hammerRange
	attackZ := attack.Z + attack.DirectionZ*hammerRange

	for _, ps := range g.players {
		// 연결 끊긴 플레이어, 죽은 플레이어, 무적 상태 플레이어는 판정하지 않음
		if !ps.IsConnected || !ps.IsAlive || ps.IsInvincible {
			continue
		}

		// 플레이어와 망치 공격 지점 간의 거리 계산
		dx := attackX - ps.X
		dz := attackZ - ps.Z
		distance := math.Sqrt(dx*dx + dz*dz)

		// 망치 공격 범위 내에 있는지 확인
		if distance <= hammerRange {
			hitPlayers = append(hitPlayers, ps.ID)
		}
	}

	return hitPlayers
}

// 게임 상태 broadcast
func (g *Game) broadcastGameState() {
	g.mutex.RLock()
	defer g.mutex.RUnlock()

	playerStatesInfo := make([]PlayerStateInfo, 0, len(g.players))

	for _, ps := range g.players {

		playerStatesInfo = append(playerStatesInfo, PlayerStateInfo{
			ID:               ps.ID,
			Nickname:         ps.Nickname,
			Color:            ps.Color,
			X:                ps.X,
			Y:                ps.Y,
			Z:                ps.Z,
			Yaw:              ps.Yaw,
			Pitch:            ps.Pitch,
			Score:            ps.Score,
			Asset:            ps.Asset,
			Health:           ps.Health,
			MaxHealth:        ps.MaxHealth,
			IsAlive:          ps.IsAlive,
			IsInvincible:     ps.IsInvincible,
			CurrentAnimation: ps.CurrentAnimation,
		})
	}

	timeLeft := 0
	if g.isReady && g.startTime.Unix() > 0 {
		timeLeft = int(g.duration.Seconds() - time.Since(g.startTime).Seconds())
		if timeLeft < 0 {
			timeLeft = 0
		}
	}

	gameStatePayload := GameStateUpdatePayload{
		Players:  playerStatesInfo,
		TimeLeft: timeLeft,
	}

	msg := Message{Type: MessageTypeGameStateUpdate, Payload: gameStatePayload}
	g.room.broadcastMessage(msg, nil)
}

// 클라이언트 액션 처리
func (g *Game) HandlePlayerAction(msg *Message) {
	if !g.isReady {
		log.Printf("Game in Room %s: Received player action for client %s (Nick: %s) but game is not running. Ignored.", g.room.id, msg.Sender.id, msg.Sender.nickname)
		return
	}

	g.mutex.Lock() // Lock for writing to playerState
	defer g.mutex.Unlock()

	client := msg.Sender
	playerState, ok := g.players[client]
	if !ok || !playerState.IsConnected {
		log.Printf("Game in Room %s: Player action from unknown or disconnected client %s (Nick: %s). Ignored.", g.room.id, client.id, client.nickname)
		return
	}

	// 죽은 플레이어는 공격할 수 없음
	if !playerState.IsAlive {
		return
	}

	actionPayloadMap, ok := msg.Payload.(map[string]interface{})
	if !ok {
		log.Printf("Game in Room %s: Could not parse PlayerActionPayload (not a map) for client %s", g.room.id, client.id)
		return
	}

	actionType, _ := actionPayloadMap["action_type"].(string)
	actionData, dataOk := actionPayloadMap["data"].(map[string]interface{})
	if !dataOk {
		log.Printf("Game in Room %s: Could not parse PlayerActionPayload data (not a map) for client %s, type %s", g.room.id, client.id, actionType)
		return
	}

	switch actionType {
	case "look": // 클라이언트에서 보낸 'look' 액션 (yaw, pitch)
		// 공격 중에는 회전하지 않음 (1초간)
		if time.Since(playerState.LastAttackTime) < 500*time.Millisecond {
			return
		}

		if yawVal, ok := actionData["yaw"].(float64); ok {
			playerState.Yaw = yawVal
		}
		if pitchVal, ok := actionData["pitch"].(float64); ok {
			// Pitch 값 서버에서도 제한 가능 (클라이언트와 동일하게)
			playerState.Pitch = math.Max(-math.Pi/2, math.Min(math.Pi/2, pitchVal))
		}
	case "move": // 클라이언트에서 보낸 'move' 액션 (키보드 상태)
		// 대기중일때는 이동할 수 없음
		if !g.isRunning {
			return
		}

		// 공격 중에는 이동 의향을 받지 않음 (1초간)
		if time.Since(playerState.LastAttackTime) < hammerDuration {
			return
		}

		// 피격 중에는 이동 의향을 받지 않음 (1초간)
		if time.Since(playerState.LastHitTime) < hitDuration {
			return
		}

		playerState.MoveForward = 0
		playerState.MoveStrafe = 0

		if val, ok := actionData["forward"].(float64); ok && val == 1 {
			playerState.MoveForward = 1
		} else if val, ok := actionData["backward"].(float64); ok && val == 1 {
			playerState.MoveForward = -1
		}

		if val, ok := actionData["right"].(float64); ok && val == 1 {
			playerState.MoveStrafe = -1
		} else if val, ok := actionData["left"].(float64); ok && val == 1 {
			playerState.MoveStrafe = 1
		}

		// log.Printf("Player %s move intent: Fwd: %.0f, Str: %.0f", client.id, playerState.MoveForward, playerState.MoveStrafe)

	case "click": // 클라이언트에서 보낸 'click' 액션 (망치 공격)
		// 공격 쿨다운 체크 (1초)
		if time.Since(playerState.LastAttackTime) < hammerDuration {
			return
		}

		// 피격시 무시 (1초간)
		if time.Since(playerState.LastHitTime) < hitDuration {
			return
		}

		if directionData, ok := actionData["direction"].(map[string]interface{}); ok {
			if dirX, okX := directionData["x"].(float64); okX {
				if dirZ, okZ := directionData["z"].(float64); okZ {

					// 게임중일때만 실제 공격 생성
					if g.isRunning {
						// 망치 공격 생성
						g.attackCounter++
						attackID := fmt.Sprintf("hammer_%s_%d", client.id, g.attackCounter)

						attack := &HammerAttack{
							ID:         attackID,
							AttackerID: client.id,
							X:          playerState.X,
							Z:          playerState.Z,
							DirectionX: dirX,
							DirectionZ: dirZ,
							CreatedAt:  time.Now(),
							HitTime:    time.Now().Add(50 * time.Millisecond), // 0.05초 후 타격 판정
							Color:      client.color,
						}

						g.hammerAttacks[attackID] = attack

						log.Printf("Player %s performed hammer attack %s at direction (%.2f, %.2f)", client.id, attackID, dirX, dirZ)
					}

					// 공격 시간 기록
					playerState.LastAttackTime = time.Now()

					// 공격 중에는 이동 중지
					playerState.MoveForward = 0
					playerState.MoveStrafe = 0

					playerState.CurrentAnimation = "hammer_attack"
					playerState.AnimationStart = time.Now()

				}
			}
		}

	default:
		log.Printf("Game in Room %s: Unknown player action type '%s' from %s", g.room.id, actionType, client.id)
	}
	playerState.LastActionTime = time.Now()
}

// 게임 중지
func (g *Game) StopGame(reason string) {
	g.mutex.Lock() // Lock for reading/writing g.isReady and g.quit
	if !g.isReady {
		g.mutex.Unlock()
		return // 이미 중지되었거나 중지 중
	}
	g.isReady = false // 새로운 업데이트나 액션 처리를 막음

	// 망치 공격 모두 제거 (기존: 총알 모두 제거)
	g.hammerAttacks = make(map[string]*HammerAttack)

	// g.quit 채널을 닫아서 gameLoop 고루틴에 종료 신호를 보냄
	// 한 번만 닫아야 함 (double close panic 방지)
	if g.quit != nil {
		select {
		case <-g.quit: // 이미 닫혔다면 아무것도 안함
		default:
			close(g.quit)
		}
		// g.quit = nil // close 후 nil로 설정하여 다시 닫지 않도록 할 수 있으나, select로 이미 보호됨
	}
	g.mutex.Unlock() // Unlock before broadcasting or long operations

	log.Printf("Game in Room %s: Stopping game. Reason: %s", g.room.id, reason)

	// 게임 종료 메시지 브로드캐스트 (Lock 없이 playerStates 복사)
	finalScores := make([]PlayerScore, 0, len(g.players))
	g.mutex.RLock() // players 맵 읽기 위해 RLock
	for client, ps := range g.players {
		finalScores = append(finalScores, PlayerScore{
			PlayerID: client.id,
			Nickname: client.nickname,
			Score:    ps.Score,
		})
	}
	g.mutex.RUnlock()

	gameEndedPayload := GameEndedPayload{
		FinalScores: finalScores,
		Reason:      reason,
	}
	msg := Message{Type: MessageTypeGameEnded, Payload: gameEndedPayload}
	g.room.broadcastMessage(msg, nil) // This handles its own locking

	// Room 상태 변경 (Room의 Lock 사용)
	g.room.mutex.Lock()
	g.room.state = RoomStateFinished
	g.room.mutex.Unlock()

	g.room.broadcastRoomState() // This handles its own locking
	g.room.server.broadcastRoomUpdate()

	go func(room *Room) {
		time.Sleep(gameEndDelay)
		log.Printf("Game in Room %s: Delay finished. Preparing room for new game.", room.id)
		if room != nil { // Room 객체가 유효한지 확인
			room.PrepareForNewGame()
		}
	}(g.room)
}

// 플레이어 연결 상태 변경 처리
func (g *Game) UpdatePlayerConnectionState(client *Client, isConnected bool) {
	if g == nil {
		return
	}
	g.mutex.Lock()
	defer g.mutex.Unlock()

	if ps, ok := g.players[client]; ok {
		ps.IsConnected = isConnected
		if !isConnected {
			// 연결 끊긴 플레이어의 이동 의향 초기화
			ps.MoveForward = 0
			ps.MoveStrafe = 0
			log.Printf("Game in Room %s: Player %s (Nick: %s) connection state updated to DISCONNECTED. Movement reset.", g.room.id, client.id, client.nickname)
		} else {
			log.Printf("Game in Room %s: Player %s (Nick: %s) connection state updated to CONNECTED.", g.room.id, client.id, client.nickname)
		}
	}
}
