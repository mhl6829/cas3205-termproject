/**
 * UI 관리 및 화면 전환 모듈
 */
class UIManager {
  constructor() {
    this.initUIElements();
    this.initEventListeners();
  }

  initUIElements() {
    // UI 요소 참조들
    this.mainUiContainer = document.getElementById("main-ui-container");
    this.initialSetupSection = document.getElementById("initial-setup-section");
    this.lobbySection = document.getElementById("lobby-section");
    this.waitingRoomSection = document.getElementById("waiting-room-section");
    this.gameResultSection = document.getElementById("game-result-section");
    
    // 게임 관련 UI 요소들
    this.gameCanvasContainer = document.getElementById("game-canvas-container");
    this.gameHudTopLeft = document.getElementById("game-hud-top-left");
    this.gameHudTopRight = document.getElementById("game-hud-top-right");
    this.gameTimeLeftEl = document.getElementById("game-time-left");
    this.gameCountdownOverlay = document.getElementById("game-countdown-overlay");
    this.customCrosshair = document.getElementById("custom-crosshair");
    this.playerOverlays = document.getElementById("player-overlays");
    
    // 체력 관련 UI 요소들
    this.healthBar = document.getElementById("health-bar");
    this.healthText = document.getElementById("health-text");
    this.respawnTimer = document.getElementById("respawn-timer");
    this.respawnCountdown = document.getElementById("respawn-countdown");
    
    // 폼 요소들
    this.nicknameInput = document.getElementById("nickname");
    this.colorInput = document.getElementById("color");
    this.characterInput = document.getElementById("character");
    this.joinRoomCodeInput = document.getElementById("join-room-code");
    
    // 버튼들
    this.setProfileButton = document.getElementById("set-profile-button");
    this.createRoomButton = document.getElementById("create-room-button");
    this.listRoomsButton = document.getElementById("list-rooms-button");
    this.joinRoomButton = document.getElementById("join-room-button");
    this.readyButton = document.getElementById("ready-button");
    this.startGameButton = document.getElementById("start-game-button");
    this.leaveRoomButton = document.getElementById("leave-room-button");
    this.backToWaitingRoomButton = document.getElementById("back-to-waiting-room-button");
    
    // 표시 요소들
    this.roomListEl = document.getElementById("room-list");
    this.roomIdDisplay = document.getElementById("room-id-display");
    this.playerListEl = document.getElementById("player-list");
    this.currentPlayersEl = document.getElementById("current-players");
    this.maxPlayersEl = document.getElementById("max-players");
    this.gameResultDisplay = document.getElementById("game-result-display");
  }

  initEventListeners() {
    // 색상 선택 버튼 이벤트 리스너 등록
    this.setupColorSelection();
    // 캐릭터 선택 버튼 이벤트 리스너 등록
    this.setupCharacterSelection();

    // 프로필 설정 버튼
    this.setProfileButton.addEventListener("click", () => {
      if (!this.nicknameInput.value.trim()) {
        alert("닉네임을 입력해주세요.");
        return;
      }
      if (!this.colorInput.value.trim().match(/^#[0-9a-fA-F]{6}$/)) {
        alert("색상을 선택해주세요.");
        return;
      }
      if (!this.characterInput.value.trim()) {
        alert("캐릭터를 선택해주세요.");
        return;
      }
      // 캐릭터 미리보기 정리
      if (window.characterPreview) {
        window.characterPreview.dispose();
      }
      // WebSocket 연결 시작 - 다른 모듈에서 처리
      window.websocketManager.connect(this.nicknameInput.value, this.colorInput.value, this.characterInput.value);
    });

    // 로비 버튼들
    this.createRoomButton.addEventListener("click", () => {
      window.websocketManager.sendMessage("create_room", {});
    });

    this.listRoomsButton.addEventListener("click", () => {
      window.websocketManager.sendMessage("list_rooms", {});
    });

    this.joinRoomButton.addEventListener("click", () => {
      const code = this.joinRoomCodeInput.value.trim().toUpperCase();
      if (code.length === 6) {
        window.websocketManager.sendMessage("join_room", { room_id: code });
      } else {
        alert("방 코드는 6자리여야 합니다.");
      }
    });

    // 대기실 버튼들
    this.readyButton.addEventListener("click", () => {
      const newReadyState = stateManager.toggleReady();
      window.websocketManager.sendMessage("ready_toggle", {});
      this.updateReadyButtonState(newReadyState);
    });

    this.startGameButton.addEventListener("click", () => {
      window.websocketManager.sendMessage("start_game", {});
    });

    this.leaveRoomButton.addEventListener("click", () => {
      window.websocketManager.sendMessage("leave_room", {});
      window.gameRenderer.exitGameView();
      this.showMainUISection(this.lobbySection);
      stateManager.clearCurrentRoom();
      window.websocketManager.sendMessage("list_rooms", {});
    });

    // 게임 결과 버튼
    this.backToWaitingRoomButton.addEventListener("click", () => {
      this.showMainUISection(this.waitingRoomSection);
      logger.logMessage("대기방으로 돌아갑니다.");
    });
  }

  showMainUISection(section) {
    this.mainUiContainer.classList.remove("hidden");
    this.gameCanvasContainer.classList.add("hidden");
    this.gameHudTopLeft.classList.add("hidden");
    this.gameHudTopRight.classList.add("hidden");
    this.gameCountdownOverlay.classList.add("hidden");
    this.customCrosshair.classList.add("hidden");
    this.playerOverlays.classList.add("hidden");
    
    // UI 섹션으로 돌아갈 때 마우스 커서 다시 보이게 하기
    document.body.style.cursor = "default";

    this.initialSetupSection.classList.add("hidden");
    this.lobbySection.classList.add("hidden");
    this.waitingRoomSection.classList.add("hidden");
    this.gameResultSection.classList.add("hidden");
    
    if (section) section.classList.remove("hidden");
  }

  enterGameView() {
    this.mainUiContainer.classList.add("hidden");
    document.getElementById("game-canvas-container").classList.remove("hidden");
    document.getElementById("game-hud-top-left").classList.remove("hidden");
    document.getElementById("game-hud-top-right").classList.remove("hidden");
    document.getElementById("player-overlays").classList.remove("hidden");
    
    // 마우스 커서 숨기고 custom-crosshair 보이기
    document.body.style.cursor = "none";
    document.getElementById("custom-crosshair").classList.remove("hidden");
  }

  exitGameView() {
    document.getElementById("game-canvas-container").classList.add("hidden");
    document.getElementById("game-hud-top-left").classList.add("hidden");
    document.getElementById("game-hud-top-right").classList.add("hidden");
    document.getElementById("game-countdown-overlay").classList.add("hidden");
    document.getElementById("player-overlays").classList.add("hidden");
    
    // 마우스 커서 다시 보이게 하고 custom-crosshair 숨기기
    document.body.style.cursor = "default";
    document.getElementById("custom-crosshair").classList.add("hidden");
    this.mainUiContainer.classList.remove("hidden");
  }

  updateRoomList(rooms) {
    this.roomListEl.innerHTML = "";
    
    if (rooms && rooms.length > 0) {
      rooms.forEach((room) => {
        const roomItem = document.createElement("div");
        roomItem.className = "p-3 mb-2 border border-slate-700 rounded-md hover:bg-slate-600 flex justify-between items-center cursor-pointer";
        roomItem.innerHTML = `<span>ID: <strong class="font-mono text-sky-400">${room.id}</strong> (${room.current_players}/${room.max_players}) - <span class="capitalize">${room.state}</span></span>`;
        
        const joinBtn = document.createElement("button");
        joinBtn.textContent = "참가";
        joinBtn.className = "font-semibold py-1 px-3 rounded-md shadow-sm text-sm bg-indigo-500 hover:bg-indigo-600 text-white focus:ring-indigo-400 focus:outline-none focus:ring-2 focus:ring-opacity-75";
        
        if (room.state !== "waiting" || room.current_players >= room.max_players) {
          joinBtn.disabled = true;
          joinBtn.classList.add("opacity-50", "cursor-not-allowed", "hover:bg-indigo-500");
        }
        
        joinBtn.onclick = (e) => {
          e.stopPropagation();
          window.websocketManager.sendMessage("join_room", { room_id: room.id });
        };
        
        roomItem.appendChild(joinBtn);
        roomItem.onclick = () => {
          if (!joinBtn.disabled) {
            window.websocketManager.sendMessage("join_room", { room_id: room.id });
          }
        };
        
        this.roomListEl.appendChild(roomItem);
      });
    } else {
      this.roomListEl.innerHTML = '<p class="text-slate-400 text-center py-4">현재 생성된 방이 없습니다.</p>';
    }
  }

  updateWaitingRoomUI(roomInfo) {
    stateManager.setRoomInfo(roomInfo);
    this.roomIdDisplay.textContent = roomInfo.id;
    stateManager.updatePlayersFromArray(roomInfo.players);

    const ownerPlayer = roomInfo.players.find((p) => p.is_owner);
    if (ownerPlayer) {
      stateManager.setIsOwner(ownerPlayer.id === stateManager.getClientId());
      stateManager.getAllPlayers().forEach((p) => (p.is_owner = p.id === ownerPlayer.id));
    } else {
      stateManager.setIsOwner(false);
      stateManager.getAllPlayers().forEach((p) => (p.is_owner = false));
    }

    this.renderPlayerList();
    this.maxPlayersEl.textContent = roomInfo.max_players || 4;
    this.updatePlayerCountInRoom();
    this.updateReadyButton();

    const myInfo = stateManager.getPlayer(stateManager.getClientId());
    if (myInfo) {
      stateManager.setIsReady(myInfo.is_ready);
    } else {
      stateManager.setIsReady(false);
    }
    
    this.updateReadyButtonState(stateManager.getIsReady());
  }

  updateReadyButton() {
    if (stateManager.getIsOwner()) {
      this.readyButton.classList.add("hidden");
      this.startGameButton.classList.remove("hidden");
    } else {
      this.readyButton.classList.remove("hidden");
      this.startGameButton.classList.add("hidden");
    }
  }

  updateReadyButtonState(isReady) {
    this.readyButton.textContent = isReady ? "준비 완료" : "준비";
    this.readyButton.classList.toggle("bg-yellow-500", !isReady);
    this.readyButton.classList.toggle("text-slate-900", !isReady);
    this.readyButton.classList.toggle("hover:bg-yellow-600", !isReady);
    this.readyButton.classList.toggle("bg-green-500", isReady);
    this.readyButton.classList.toggle("text-white", isReady);
    this.readyButton.classList.toggle("hover:bg-green-600", isReady);
  }

  renderPlayerList() {
    this.playerListEl.innerHTML = "";
    
    stateManager.getAllPlayers().forEach((player) => {
      const playerItem = document.createElement("div");
      playerItem.className = "player-list-item text-slate-300 border-slate-700";
      
      const colorPreview = `<div class="player-color-preview" style="background-color: ${player.color};"></div>`;
      let content = `${colorPreview} <span class="truncate max-w-[120px] sm:max-w-none">${player.nickname}</span>`;
      
      if (player.is_owner) {
        content += ' <span class="ml-auto mr-1 px-2 py-0.5 text-xs font-semibold bg-purple-600 text-purple-100 rounded-full">방장</span>';
      }
      
      if (player.is_ready) {
        content += ` <span class="${player.is_owner ? "ml-1" : "ml-auto"} mr-1 px-2 py-0.5 text-xs font-semibold ${player.is_owner ? "bg-purple-600 text-purple-100" : "bg-green-600 text-green-100"} rounded-full">준비</span>`;
      }
      
      if (player.id === stateManager.getClientId()) {
        content += ' <span class="ml-1 text-xs text-sky-400">(나)</span>';
      }
      
      playerItem.innerHTML = content;
      this.playerListEl.appendChild(playerItem);
    });
  }

  updatePlayerCountInRoom() {
    this.currentPlayersEl.textContent = stateManager.getPlayerCount();
  }

  updateGameResultUI(resultPayload) {
    this.gameResultDisplay.innerHTML = `<h3 class="text-lg font-semibold mb-2">게임 결과 (사유: ${resultPayload.reason || "N/A"})</h3>`;
    
    const scoreList = document.createElement("ul");
    scoreList.className = "space-y-1";
    
    if (resultPayload.final_scores && resultPayload.final_scores.length > 0) {
      resultPayload.final_scores.sort((a, b) => b.score - a.score);
      resultPayload.final_scores.forEach((score, index) => {
        const listItem = document.createElement("li");
        listItem.className = `p-2 rounded ${index === 0 ? "bg-yellow-500 text-slate-900" : "bg-slate-600"}`;
        listItem.textContent = `${index + 1}. ${score.nickname || score.player_id.substring(0, 6)}: ${score.score}점`;
        scoreList.appendChild(listItem);
      });
    } else {
      scoreList.innerHTML = '<li class="p-2 bg-slate-600 rounded">점수 정보가 없습니다.</li>';
    }
    
    this.gameResultDisplay.appendChild(scoreList);
  }

  updateHudPlayerInfo() {
    // 플레이어 점수 목록만 표시 (체력바는 캐릭터 머리 위로 이동)
    const playerListContainer = this.gameHudTopLeft.querySelector('.player-scores-list') || document.createElement("div");
    if (!this.gameHudTopLeft.querySelector('.player-scores-list')) {
      playerListContainer.className = "player-scores-list";
      this.gameHudTopLeft.appendChild(playerListContainer);
    }
    
    playerListContainer.innerHTML = "";
    const ul = document.createElement("ul");

    const playersPayload = Array.from(stateManager.getAllPlayers().values());
    
    playersPayload.sort((a, b) => b.score == a.score ? b.id - a.id : b.score - a.score);
    
    playersPayload.forEach((p) => {
      const playerOnMap = stateManager.getPlayer(p.id);
      const nickname = playerOnMap ? playerOnMap.nickname : p.id.substring(0, 6);
      const color = playerOnMap ? playerOnMap.color : "#FFFFFF";
      const isSelf = p.id === stateManager.getClientId();

      const li = document.createElement("li");
      li.style.marginBottom = "0.25rem";
      li.className = isSelf ? "font-bold text-yellow-300" : "text-slate-200";
      li.innerHTML = `<div class="flex items-center">
                        <span style="width:12px; height:12px; background-color:${color}; border-radius:50%; margin-right:5px; border:1px solid #fff;"></span>
                        <span>${nickname}: ${p.score}점</span>
                      </div>`;
      ul.appendChild(li);
    });
    
    playerListContainer.appendChild(ul);
  }

  updateHealthBar(currentHealth, maxHealth, isAlive) {
    if (!this.healthBar || !this.healthText) return;
    
    const healthPercentage = maxHealth > 0 ? (currentHealth / maxHealth) * 100 : 0;
    
    this.healthBar.style.width = `${healthPercentage}%`;
    this.healthText.textContent = `${currentHealth}/${maxHealth}`;
    
    // 체력에 따른 색상 변경
    if (healthPercentage > 66) {
      this.healthBar.className = "bg-green-500 h-full rounded-full transition-all duration-300";
    } else if (healthPercentage > 33) {
      this.healthBar.className = "bg-yellow-500 h-full rounded-full transition-all duration-300";
    } else {
      this.healthBar.className = "bg-red-500 h-full rounded-full transition-all duration-300";
    }
    
    // 죽은 상태일 때 리스폰 타이머 표시
    if (!isAlive) {
      this.showRespawnTimer();
    } else {
      this.hideRespawnTimer();
    }
  }

  showRespawnTimer() {
    if (this.respawnTimer) {
      this.respawnTimer.classList.remove("hidden");
      this.startRespawnCountdown();
    }
  }

  hideRespawnTimer() {
    if (this.respawnTimer) {
      this.respawnTimer.classList.add("hidden");
    }
    if (this.respawnCountdownInterval) {
      clearInterval(this.respawnCountdownInterval);
      this.respawnCountdownInterval = null;
    }
  }

  startRespawnCountdown() {
    let countdown = 3;
    if (this.respawnCountdown) {
      this.respawnCountdown.textContent = countdown;
    }
    
    if (this.respawnCountdownInterval) {
      clearInterval(this.respawnCountdownInterval);
    }
    
    this.respawnCountdownInterval = setInterval(() => {
      countdown--;
      if (this.respawnCountdown) {
        this.respawnCountdown.textContent = countdown;
      }
      
      if (countdown <= 0) {
        this.hideRespawnTimer();
      }
    }, 1000);
  }

  updateGameTimeLeft(timeLeft) {
    this.gameTimeLeftEl.textContent = timeLeft;
  }

  showGameCountdown(text) {
    this.gameCountdownOverlay.classList.remove("hidden");
    this.gameCountdownOverlay.textContent = text;
  }

  hideGameCountdown() {
    this.gameCountdownOverlay.classList.add("hidden");
  }

  setupColorSelection() {
    // 색상 선택 버튼들
    document.querySelectorAll('.color-option').forEach(button => {
      button.addEventListener('click', () => {
        // 모든 색상 버튼의 선택 상태 제거
        document.querySelectorAll('.color-option').forEach(btn => {
          btn.classList.remove('selected');
        });
        
        // 클릭된 버튼을 선택 상태로 변경
        button.classList.add('selected');
        
        // hidden input에 색상 값 설정
        this.colorInput.value = button.dataset.color;
      });
    });

    // 기본 색상 선택 상태 설정 (새로운 기본 색상으로 변경)
    const defaultColorButton = document.querySelector('.color-option[data-color="#FF6B9D"]');
    if (defaultColorButton) {
      defaultColorButton.classList.add('selected');
    }
  }

  setupCharacterSelection() {
    // 캐릭터 선택 버튼들
    document.querySelectorAll('.character-option').forEach(button => {
      button.addEventListener('click', () => {
        // 모든 캐릭터 버튼의 선택 상태 제거
        document.querySelectorAll('.character-option').forEach(btn => {
          btn.classList.remove('selected');
        });
        
        // 클릭된 버튼을 선택 상태로 변경
        button.classList.add('selected');
        
        // hidden input에 캐릭터 값 설정
        this.characterInput.value = button.dataset.character;
      });
    });

    // 기본 캐릭터 선택 상태 설정
    const defaultCharacterButton = document.querySelector('.character-option[data-character="onion"]');
    if (defaultCharacterButton) {
      defaultCharacterButton.classList.add('selected');
    }
  }
}

// 전역 인스턴스 생성
const uiManager = new UIManager();
window.uiManager = uiManager;

export { UIManager, uiManager }; 