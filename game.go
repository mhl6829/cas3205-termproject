package main

import (
	"fmt"
	"log"
	"math" // For Sin and Cos in movement
	"sync"
	"time"
)

const (
	gameFPS             = 30
	gameTickRate        = time.Second / gameFPS
	countdownSeconds    = 5
	defaultGameDuration = 180 * time.Second // 기본 게임 시간 3분
	playerSpeed         = 0.5               // 캐릭터 이동 속도 (단위/틱)

	// 맵 설정
	mapSize     = 40.0 // 맵 크기 (40x40)
	mapBoundary = 20.0 // 맵 경계 (±20)

	// 망치 설정
	hammerRange     = 3.0             // 망치의 공격 범위
	hammerDamage    = 1               // 망치 한 번 때릴 때 데미지
	maxPlayerHealth = 3               // 플레이어 최대 체력
	respawnDelay    = 3 * time.Second // 죽고 부활까지 걸리는 시간

	// TODO: 추후 구현 예정
	// hammerCooldown     = 1 * time.Second  // 망치 공격 쿨다운 (1초에 한 번)
	// hammerAnimDuration = 0.5 * time.Second // 망치 애니메이션 지속 시간

	// 총알 설정 (주석처리됨)
	// bulletSpeed = 1
)

// TODO: 주석처리된 총알 시스템 - 나중에 사용할 수도 있음
/*
// Bullet은 총알의 상태를 나타냅니다.
type Bullet struct {
	ID         string  `json:"id"`
	X          float64 `json:"x"`
	Z          float64 `json:"z"`
	DirectionX float64 `json:"direction_x"`
	DirectionZ float64 `json:"direction_z"`
	ShooterID  string  `json:"shooter_id"`
	Color      string  `json:"color"` // 발사한 플레이어의 색상
	CreatedAt  time.Time
}
*/

// HammerAttack는 망치 공격 정보를 나타냅니다.
type HammerAttack struct {
	ID         string    `json:"id"`
	AttackerID string    `json:"attacker_id"`
	X          float64   `json:"x"`
	Z          float64   `json:"z"`
	DirectionX float64   `json:"direction_x"`
	DirectionZ float64   `json:"direction_z"`
	CreatedAt  time.Time `json:"created_at"`
	HitTime    time.Time `json:"hit_time"` // 실제 타격 판정 시간 (생성 후 0.5초)
	Color      string    `json:"color"`    // 공격자의 색상
}

// Game은 실제 게임 로직과 상태를 관리합니다.
type Game struct {
	room    *Room
	players map[*Client]*PlayerState
	// bullets       map[string]*Bullet // 주석처리: 총알 관리
	hammerAttacks map[string]*HammerAttack // 망치 공격 관리
	gameState     interface{}
	startTime     time.Time
	duration      time.Duration
	ticker        *time.Ticker
	isRunning     bool
	quit          chan struct{}
	mutex         sync.RWMutex
	// bulletCounter int // 주석처리: 총알 ID 생성용
	attackCounter int // 망치 공격 ID 생성용
}

// PlayerState는 게임 내 플레이어의 상태를 나타냅니다.
type PlayerState struct {
	ID    string
	X     float64 `json:"x"`
	Y     float64 `json:"y"` // In this example, Y is vertical (height). For a top-down game, it might be fixed or unused for XZ movement.
	Z     float64 `json:"z"`
	Yaw   float64 `json:"yaw"`
	Pitch float64 `json:"pitch"`
	Score int     `json:"score"`
	Asset string  `json:"asset"` // 사용할 3D 모델 에셋

	// 체력 시스템
	Health      int       `json:"health"`       // 현재 체력
	MaxHealth   int       `json:"max_health"`   // 최대 체력
	IsAlive     bool      `json:"is_alive"`     // 생존 상태
	DeathTime   time.Time `json:"death_time"`   // 죽은 시간 (부활 계산용)
	RespawnTime time.Time `json:"respawn_time"` // 부활 시간

	// 애니메이션 관련 (추후 구현 예정)
	CurrentAnimation string    `json:"current_animation,omitempty"` // 현재 재생 중인 애니메이션
	AnimationStart   time.Time `json:"animation_start,omitempty"`   // 애니메이션 시작 시간

	// Movement intentions (set by HandlePlayerAction, used by updateGameState)
	MoveForward float64 // -1 for backward, 1 for forward, 0 for no longitudinal movement
	MoveStrafe  float64 // -1 for left, 1 for right, 0 for no lateral movement

	LastActionTime time.Time
	LastAttackTime time.Time // 마지막 공격 시간 (공격 중 이동 제한용)
	IsConnected    bool
}

// NewGame은 새 Game 인스턴스를 생성합니다.
func NewGame(room *Room, gamePlayers []*Client) *Game {
	g := &Game{
		room:    room,
		players: make(map[*Client]*PlayerState),
		// bullets:       make(map[string]*Bullet), // 주석처리
		hammerAttacks: make(map[string]*HammerAttack),
		duration:      defaultGameDuration,
		quit:          make(chan struct{}),
		isRunning:     false,
		// bulletCounter: 0, // 주석처리
		attackCounter: 0,
	}

	for _, client := range gamePlayers {
		g.players[client] = &PlayerState{
			ID: client.id,
			X:  0, Y: 0, Z: 0, // Initial position
			Yaw: 0, Pitch: 0,
			Score:            0,
			Asset:            "bunny.glb", // 기본 3D 모델 에셋
			Health:           maxPlayerHealth,
			MaxHealth:        maxPlayerHealth,
			IsAlive:          true,
			IsConnected:      true,
			MoveForward:      0, // Initialize movement intentions
			MoveStrafe:       0,
			CurrentAnimation: "idle", // 기본 애니메이션
			AnimationStart:   time.Now(),
		}
	}
	return g
}

// Start는 게임을 시작합니다 (카운트다운 후 게임 루프 실행).
func (g *Game) Start() {
	log.Printf("Game in Room %s: Starting countdown...", g.room.id)
	g.isRunning = true

	for i := countdownSeconds; i > 0; i-- {
		countdownPayload := GameCountdownPayload{SecondsLeft: i}
		msg := Message{Type: MessageTypeGameCountdown, Payload: countdownPayload}
		g.room.broadcastMessage(msg, nil)
		time.Sleep(time.Second)
	}

	g.startTime = time.Now()
	// Update Room state only after acquiring the Room's lock
	g.room.mutex.Lock()
	g.room.state = RoomStatePlaying
	g.room.mutex.Unlock()

	startMsg := Message{Type: MessageTypeGameStarted, Payload: nil}
	g.room.broadcastMessage(startMsg, nil)
	g.room.server.broadcastRoomUpdate()

	log.Printf("Game in Room %s: Started! Duration: %v", g.room.id, g.duration)

	g.ticker = time.NewTicker(gameTickRate)
	go g.gameLoop()
}

// gameLoop는 주기적으로 게임 상태를 업데이트하고 브로드캐스트합니다.
func (g *Game) gameLoop() {
	defer func() {
		if g.ticker != nil {
			g.ticker.Stop()
		}
		g.isRunning = false
		log.Printf("Game in Room %s: Gameloop stopped.", g.room.id)
	}()

	for {
		select {
		case <-g.ticker.C:
			if !g.isRunning {
				return
			}
			g.updateGameState()
			g.broadcastGameState()

			if time.Since(g.startTime) >= g.duration {
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

// updateGameState는 게임 로직을 실행하여 상태를 업데이트합니다.
func (g *Game) updateGameState() {
	g.mutex.Lock() // Lock for mutating player states

	// 1. 플레이어 업데이트
	for _, ps := range g.players {
		if !ps.IsConnected {
			continue // 연결 끊긴 플레이어는 업데이트하지 않음 (명세: 멈춘 상태로 진행)
		}

		// 부활 처리
		if !ps.IsAlive && time.Since(ps.DeathTime) >= respawnDelay {
			ps.Health = ps.MaxHealth
			ps.IsAlive = true
			ps.RespawnTime = time.Now()
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
		if ps.CurrentAnimation != "" && ps.CurrentAnimation != "idle" && ps.CurrentAnimation != "walk" {
			animationDuration := 2 * time.Second // 기본 애니메이션 지속시간
			if ps.CurrentAnimation == "hammer_attack" {
				animationDuration = 1000 * time.Millisecond // 망치 공격은 0.5초
			} else if ps.CurrentAnimation == "death" {
				animationDuration = 1 * time.Second // 죽음 애니메이션은 1초
			} else if ps.CurrentAnimation == "respawn" {
				animationDuration = 1 * time.Second // 부활 애니메이션은 1초
			}

			if time.Since(ps.AnimationStart) >= animationDuration {
				// 이동 중이면 walk, 아니면 idle
				if ps.MoveForward != 0 || ps.MoveStrafe != 0 {
					ps.CurrentAnimation = "walk"
				} else {
					ps.CurrentAnimation = "idle"
				}
				ps.AnimationStart = time.Now()
			}
		}

		// 죽은 플레이어는 이동하지 않음
		if !ps.IsAlive {
			continue
		}

		// 공격 중에는 이동하지 않음 (1초간)
		if time.Since(ps.LastAttackTime) < 1*time.Second {
			continue
		}

		// 이동 처리 (MoveForward와 MoveStrafe 값을 사용)
		var deltaX, deltaZ float64

		// 전후 이동 (Z축 방향, Yaw에 따라 X, Z 성분으로 분해)
		if ps.MoveForward != 0 {
			deltaX += ps.MoveForward * math.Sin(ps.Yaw)
			deltaZ += ps.MoveForward * math.Cos(ps.Yaw)
		}

		// 좌우 이동 (X축 방향, Yaw에 따라 X, Z 성분으로 분해)
		if ps.MoveStrafe != 0 {
			deltaX += ps.MoveStrafe * math.Cos(ps.Yaw)
			deltaZ -= ps.MoveStrafe * math.Sin(ps.Yaw)
		}

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
				ps.CurrentAnimation = "walk"
				ps.AnimationStart = time.Now()
			}
		} else {
			// 이동하지 않을 때는 idle 애니메이션 (다른 애니메이션이 재생 중이 아닐 때만)
			if ps.CurrentAnimation == "walk" {
				ps.CurrentAnimation = "idle"
				ps.AnimationStart = time.Now()
			}
		}

		if deltaX != 0 || deltaZ != 0 {
			// log.Printf("Player %s moved to (%.2f, %.2f)", ps.ID, ps.X, ps.Z)
		}
	}

	// 2. 망치 공격 처리
	g.updateHammerAttacks()

	// 주석처리: 총알 업데이트
	// g.updateBullets()

	g.mutex.Unlock()
}

// updateHammerAttacks는 망치 공격들을 처리하고 플레이어 충돌을 확인합니다.
func (g *Game) updateHammerAttacks() {
	toDelete := make([]string, 0)
	now := time.Now()

	for attackID, attack := range g.hammerAttacks {
		// 0.5초가 지나지 않았으면 아직 판정하지 않음
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

// checkHammerPlayerCollision는 망치 공격과 플레이어의 충돌을 확인합니다.
func (g *Game) checkHammerPlayerCollision(attack *HammerAttack) []string {
	hitPlayers := make([]string, 0)

	// 망치 공격 위치 계산 (공격자 위치에서 바라보는 방향으로 hammerRange만큼 앞)
	attackX := attack.X + attack.DirectionX*hammerRange
	attackZ := attack.Z + attack.DirectionZ*hammerRange

	for _, ps := range g.players {
		if !ps.IsConnected || !ps.IsAlive {
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

// 주석처리: 기존 총알 시스템
/*
// updateBullets는 총알들의 위치를 업데이트하고 충돌을 확인합니다.
func (g *Game) updateBullets() {
	toDelete := make([]string, 0)

	for bulletID, bullet := range g.bullets {
		// 총알 이동
		bullet.X += bullet.DirectionX * bulletSpeed
		bullet.Z += bullet.DirectionZ * bulletSpeed

		// 맵 경계 확인 (총알이 맵 밖으로 나가면 제거)
		if bullet.X < -mapBoundary || bullet.X > mapBoundary ||
			bullet.Z < -mapBoundary || bullet.Z > mapBoundary {
			toDelete = append(toDelete, bulletID)
			continue
		}

		// 플레이어와의 충돌 확인
		hitPlayerID := g.checkBulletPlayerCollision(bullet)
		if hitPlayerID != "" && hitPlayerID != bullet.ShooterID {
			// 충돌 처리: 쏜 플레이어에게 점수 추가
			for _, ps := range g.players {
				if ps.ID == bullet.ShooterID {
					ps.Score++
					log.Printf("Player %s hit player %s! Score: %d", bullet.ShooterID, hitPlayerID, ps.Score)
					break
				}
			}
			toDelete = append(toDelete, bulletID)
		}
	}

	// 제거할 총알들 삭제
	for _, bulletID := range toDelete {
		delete(g.bullets, bulletID)
	}
}

// checkBulletPlayerCollision는 총알과 플레이어의 충돌을 확인합니다.
func (g *Game) checkBulletPlayerCollision(bullet *Bullet) string {
	const collisionDistance = 1.5 // 충돌 거리

	for _, ps := range g.players {
		if !ps.IsConnected {
			continue
		}

		dx := bullet.X - ps.X
		dz := bullet.Z - ps.Z
		distance := math.Sqrt(dx*dx + dz*dz)

		if distance <= collisionDistance {
			return ps.ID
		}
	}
	return ""
}
*/

// broadcastGameState는 현재 게임 상태를 모든 클라이언트에게 전송합니다.
func (g *Game) broadcastGameState() {
	g.mutex.RLock()
	defer g.mutex.RUnlock()

	playerStatesInfo := make([]PlayerStateInfo, 0, len(g.players))
	for client, ps := range g.players {
		// 연결 끊긴 플레이어도 명세에 따라 상태는 계속 전송
		playerStatesInfo = append(playerStatesInfo, PlayerStateInfo{
			ID:               client.id,
			X:                ps.X,
			Y:                ps.Y,
			Z:                ps.Z,
			Yaw:              ps.Yaw,
			Pitch:            ps.Pitch,
			Score:            ps.Score,
			Asset:            ps.Asset,  // PlayerState에서 asset 정보 가져옴
			Health:           ps.Health, // 체력 정보 추가
			MaxHealth:        ps.MaxHealth,
			IsAlive:          ps.IsAlive,
			CurrentAnimation: ps.CurrentAnimation, // 애니메이션 정보
		})
	}

	// 주석처리: 총알 정보를 망치 공격 정보로 변경 (현재는 빈 배열로 전송)
	// 망치 공격은 즉시 처리되므로 클라이언트에게 별도로 전송할 필요 없음
	bulletsInfo := make([]BulletInfo, 0)
	// 주석처리: 기존 총알 정보 생성 로직
	/*
		bulletsInfo := make([]BulletInfo, 0, len(g.hammerAttacks))
		for _, attack := range g.hammerAttacks {
			bulletsInfo = append(bulletsInfo, BulletInfo{
				ID:    attack.ID,
				X:     attack.X,
				Z:     attack.Z,
				Color: attack.Color,
			})
		}
	*/

	timeLeft := 0
	if g.isRunning && g.startTime.Unix() > 0 { // 게임 시작 후 startTime이 유효할 때만 계산
		timeLeft = int(g.duration.Seconds() - time.Since(g.startTime).Seconds())
		if timeLeft < 0 {
			timeLeft = 0
		}
	}

	gameStatePayload := GameStateUpdatePayload{
		Players:  playerStatesInfo,
		Bullets:  bulletsInfo,
		TimeLeft: timeLeft,
	}
	msg := Message{Type: MessageTypeGameStateUpdate, Payload: gameStatePayload}
	g.room.broadcastMessage(msg, nil)
}

// HandlePlayerAction은 클라이언트로부터 받은 게임 액션을 처리합니다.
func (g *Game) HandlePlayerAction(msg *Message) {
	if !g.isRunning {
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
		if time.Since(playerState.LastAttackTime) < 1*time.Second {
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
		// 공격 중에는 이동 의향을 받지 않음 (1초간)
		if time.Since(playerState.LastAttackTime) < 1*time.Second {
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

	case "click": // 클라이언트에서 보낸 'click' 액션 (망치 공격) - 기존 'shoot'에서 변경
		// 공격 쿨다운 체크 (1초)
		if time.Since(playerState.LastAttackTime) < 1*time.Second {
			return
		}

		if directionData, ok := actionData["direction"].(map[string]interface{}); ok {
			if dirX, okX := directionData["x"].(float64); okX {
				if dirZ, okZ := directionData["z"].(float64); okZ {
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
						HitTime:    time.Now().Add(500 * time.Millisecond), // 0.5초 후 타격 판정
						Color:      client.color,
					}

					g.hammerAttacks[attackID] = attack

					// 공격 시간 기록
					playerState.LastAttackTime = time.Now()

					// 공격 중에는 이동 중지
					playerState.MoveForward = 0
					playerState.MoveStrafe = 0

					// TODO: 추후 애니메이션 구현 시 사용
					playerState.CurrentAnimation = "hammer_attack"
					playerState.AnimationStart = time.Now()

					log.Printf("Player %s performed hammer attack %s at direction (%.2f, %.2f)", client.id, attackID, dirX, dirZ)
				}
			}
		}

	// 주석처리: 기존 shoot 케이스
	/*
		case "shoot": // 클라이언트에서 보낸 'shoot' 액션 (총 발사)
			if directionData, ok := actionData["direction"].(map[string]interface{}); ok {
				if dirX, okX := directionData["x"].(float64); okX {
					if dirZ, okZ := directionData["z"].(float64); okZ {
						// 총알 생성
						g.bulletCounter++
						bulletID := fmt.Sprintf("bullet_%s_%d", client.id, g.bulletCounter)

						bullet := &Bullet{
							ID:         bulletID,
							X:          playerState.X,
							Z:          playerState.Z,
							DirectionX: dirX,
							DirectionZ: dirZ,
							ShooterID:  client.id,
							Color:      client.color,
							CreatedAt:  time.Now(),
						}

						g.bullets[bulletID] = bullet
						log.Printf("Player %s shot bullet %s at direction (%.2f, %.2f)", client.id, bulletID, dirX, dirZ)
					}
				}
			}
	*/

	default:
		log.Printf("Game in Room %s: Unknown player action type '%s' from %s", g.room.id, actionType, client.id)
	}
	playerState.LastActionTime = time.Now()
}

// StopGame은 게임을 중지하고 결과를 처리합니다.
func (g *Game) StopGame(reason string) {
	g.mutex.Lock() // Lock for reading/writing g.isRunning and g.quit
	if !g.isRunning {
		g.mutex.Unlock()
		return // 이미 중지되었거나 중지 중
	}
	g.isRunning = false // 새로운 업데이트나 액션 처리를 막음

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

// UpdatePlayerConnectionState는 Room에서 플레이어 연결 상태 변경 시 호출됩니다.
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
