/**
 * WebSocket 연결 및 메시지 처리 모듈
 */
class WebSocketManager {
  constructor() {
    // 현재 페이지의 호스트와 포트를 사용하여 WebSocket URL 생성
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host; // hostname:port 포함
    this.WS_URL = `${protocol}//${host}/ws`;
    
    this.ws = null;
    
    // console.log(`WebSocket URL: ${this.WS_URL}`);
  }

  connect(nickname, color) {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      logger.logMessage("이미 연결되어 있거나 연결 중입니다.");
      return;
    }

    this.ws = new WebSocket(this.WS_URL);
    logger.updateConnectionStatus("연결 시도 중...", true);

    this.ws.onopen = () => {
      logger.updateConnectionStatus("연결 성공!", true);
      logger.logMessage("서버에 연결되었습니다.", "success");
      this.sendMessage("set_nickname_color", { nickname, color });
      uiManager.showMainUISection(uiManager.lobbySection);
      this.sendMessage("list_rooms", {});
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.type !== "game_state_update") {
        logger.logMessage(`RCVD: ${message.type} - ${JSON.stringify(message.payload || {})}`);
      }
      this.handleServerMessage(message);
    };

    this.ws.onclose = () => {
      logger.updateConnectionStatus("연결 끊김.", false);
      logger.logMessage("서버와 연결이 끊어졌습니다.", "error");
      window.gameRenderer.exitGameView();
      uiManager.showMainUISection(uiManager.initialSetupSection);
      this.ws = null;
    };

    this.ws.onerror = (error) => {
      logger.updateConnectionStatus("연결 오류 발생!", false);
      logger.logMessage(`웹소켓 오류: ${error.message || "알 수 없는 오류"}`, "error");
      console.error("WebSocket Error: ", error);
      window.gameRenderer.exitGameView();
      this.ws = null;
    };
  }

  sendMessage(type, payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = { type, payload };
      this.ws.send(JSON.stringify(message));
    } else {
      logger.logMessage("웹소켓이 연결되지 않았습니다.", "error");
    }
  }

  handleServerMessage(message) {
    const { type, payload } = message;
    
    switch (type) {
      case "user_id_assigned":
        stateManager.setClientId(payload.user_id);
        logger.logMessage(`내 ID 할당됨: ${payload.user_id}`);
        break;

      case "room_list_updated":
        if (uiManager.mainUiContainer.classList.contains("hidden")) return;
        uiManager.updateRoomList(payload.rooms);
        break;

      case "room_created":
        stateManager.setCurrentRoom(payload.id);
        stateManager.setIsOwner(payload.owner_id === stateManager.getClientId());
        uiManager.updateWaitingRoomUI(payload);
        uiManager.showMainUISection(uiManager.waitingRoomSection);
        break;

      case "room_joined":
        stateManager.setCurrentRoom(payload.id);
        stateManager.setIsOwner(payload.owner_id === stateManager.getClientId());
        uiManager.updateWaitingRoomUI(payload);
        uiManager.showMainUISection(uiManager.waitingRoomSection);
        break;

      case "player_joined":
        if (stateManager.getCurrentRoomId()) {
          stateManager.addPlayer(payload.player_info.id, payload.player_info);
          
          if (!uiManager.mainUiContainer.classList.contains("hidden")) {
            uiManager.renderPlayerList();
            uiManager.updatePlayerCountInRoom();
          }
          
          if (window.gameRenderer.scene && window.gameRenderer.playerMeshes && 
              !window.gameRenderer.playerMeshes.has(payload.player_info.id) &&
              uiManager.mainUiContainer.classList.contains("hidden")) {
            window.gameRenderer.createOrUpdatePlayerMesh(
              payload.player_info.id,
              payload.player_info.color,
              { x: 0, y: 0, z: 0, score: 0, yaw: 0, pitch: 0 }
            );
          }
        }
        break;

      case "player_left":
        if (stateManager.getCurrentRoomId()) {
          const leftPlayerId = payload.player_id;
          const wasOwner = stateManager.getPlayer(leftPlayerId)?.is_owner;
          stateManager.removePlayer(leftPlayerId);

          if (window.gameRenderer.playerMeshes && window.gameRenderer.playerMeshes.has(leftPlayerId) && window.gameRenderer.scene) {
            const meshToRemove = window.gameRenderer.playerMeshes.get(leftPlayerId);
            window.gameRenderer.scene.remove(meshToRemove);
            if (meshToRemove.geometry) meshToRemove.geometry.dispose();
            if (meshToRemove.material) meshToRemove.material.dispose();
            window.gameRenderer.playerMeshes.delete(leftPlayerId);
          }

          if (!uiManager.mainUiContainer.classList.contains("hidden")) {
            if (payload.new_owner_id) {
              stateManager.getAllPlayers().forEach(p => (p.is_owner = p.id === payload.new_owner_id));
              stateManager.setIsOwner(payload.new_owner_id === stateManager.getClientId());
              
              if (stateManager.getIsOwner()) {
                logger.logMessage("당신이 새로운 방장이 되었습니다!");
              } else if (stateManager.getPlayer(payload.new_owner_id)) {
                logger.logMessage(`${stateManager.getPlayer(payload.new_owner_id).nickname}님이 새로운 방장이 되었습니다!`);
              }
            } else if (wasOwner && stateManager.getPlayerCount() > 0) {
              const nextOwner = stateManager.getAllPlayers().values().next().value;
              if (nextOwner) {
                stateManager.getPlayer(nextOwner.id).is_owner = true;
                stateManager.setIsOwner(nextOwner.id === stateManager.getClientId());
                logger.logMessage(`${nextOwner.nickname}님이 새로운 방장이 되었습니다! (자동 지정)`);
              }
            }
            
            uiManager.renderPlayerList();
            uiManager.updateReadyButton();
            uiManager.updatePlayerCountInRoom();
          }
        }
        break;

      case "player_ready_changed":
        if (stateManager.getCurrentRoomId() && 
            stateManager.getPlayer(payload.player_id) &&
            !uiManager.mainUiContainer.classList.contains("hidden")) {
          const player = stateManager.getPlayer(payload.player_id);
          if (player) player.is_ready = payload.is_ready;
          uiManager.renderPlayerList();
        }
        break;

      case "room_state_updated":
        if (payload.room_id === stateManager.getCurrentRoomId() &&
            !uiManager.mainUiContainer.classList.contains("hidden")) {
          uiManager.updateWaitingRoomUI({
            id: payload.room_id,
            players: payload.players,
            max_players: stateManager.getRoomInfo()?.max_players || payload.max_players || 4,
            state: payload.new_state,
          });
          
          if (payload.new_state === "waiting") {
            uiManager.showMainUISection(uiManager.waitingRoomSection);
          }
        }
        break;

      case "game_countdown":
        if (uiManager.mainUiContainer.classList.contains("hidden")) {
          uiManager.showGameCountdown(payload.seconds_left > 0 ? payload.seconds_left : "!");
        } else {
          uiManager.enterGameView();
          window.gameRenderer.initThreeJS();
          window.gameRenderer.animateThreeJS();
          uiManager.showGameCountdown(payload.seconds_left > 0 ? payload.seconds_left : "!");
        }
        break;

      case "game_started":
        if (!window.gameRenderer.scene && !window.gameRenderer.renderer) {
          uiManager.enterGameView();
          window.gameRenderer.initThreeJS();
          window.gameRenderer.animateThreeJS();
        }
        
        uiManager.showGameCountdown("게임 시작!");
        setTimeout(() => {
          if (uiManager.gameCountdownOverlay.textContent === "게임 시작!") {
            uiManager.hideGameCountdown();
          }
        }, 500);
        break;

      case "game_state_update":
        uiManager.updateGameTimeLeft(payload.time_left);
        uiManager.updateHudPlayerInfo(payload.players);
        window.gameRenderer.updatePlayerMeshes(payload.players);
        window.gameRenderer.updateBulletMeshes(payload?.bullets);
        break;

      case "game_ended":
        window.gameRenderer.exitGameView();
        // 총알들 완전히 정리
        window.gameRenderer.updateBulletMeshes(null);
        uiManager.updateGameResultUI(payload);
        uiManager.showMainUISection(uiManager.gameResultSection);
        break;

      case "error":
        alert(`서버 오류: ${payload.message}`);
        logger.logMessage(`서버 오류: ${payload.message}`, "error");
        break;

      default:
        logger.logMessage(`알 수 없는 메시지 타입: ${type}`);
    }
  }
}

// 전역 인스턴스 생성
window.websocketManager = new WebSocketManager(); 