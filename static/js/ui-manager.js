import { generateNickname } from './nickname-generator.js';
/**
 * UI 관리 및 화면 전환 모듈
 */
class UIManager {
  constructor() {
    this.initUIElements();
    this.initEventListeners();
    this.autoReturnTimer = null;
    this.autoReturnCanceled = false;
  }

  initUIElements() {
    // UI 요소 참조들
    this.mainUiContainer = document.getElementById("main-ui-container");
    this.mainMenuHeader = document.getElementById("main-menu-header");
    this.mainMenuSection = document.getElementById("main-menu-section");
    this.howToPlaySection = document.getElementById("how-to-play-section");
    this.creditSection = document.getElementById("credit-section");
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
    this.startGameMenuButton = document.getElementById("start-game-menu-button");
    this.howToPlayButton = document.getElementById("how-to-play-button");
    this.creditButton = document.getElementById("credit-button");
    this.backToMainMenuFromHowButton = document.getElementById("back-to-main-menu-from-how");
    this.backToMainMenuFromCreditButton = document.getElementById("back-to-main-menu-from-credit");
    this.setProfileButton = document.getElementById("set-profile-button");
    this.createRoomButton = document.getElementById("create-room-button");
    this.listRoomsButton = document.getElementById("list-rooms-button");
    this.joinRoomButton = document.getElementById("join-room-button");
    this.readyButton = document.getElementById("ready-button");
    this.startGameButton = document.getElementById("start-game-button");
    this.leaveRoomButton = document.getElementById("leave-room-button");
    this.backToWaitingRoomButton = document.getElementById("back-to-waiting-room-button");
    this.randomNicknameBtn = document.getElementById('random-nickname-btn');
    
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

    // 기본 닉네임
    this.nicknameInput.value = generateNickname();

    // 메인 메뉴 버튼들
    this.startGameMenuButton.addEventListener("click", () => {
      this.showMainUISection(uiManager.mainMenuHeader);
      this.showMainUISection(this.initialSetupSection);
      
      // 캐릭터 미리보기 초기화
      if (window.characterPreview) {
        window.characterPreview.init();
      }
    });

    this.howToPlayButton.addEventListener("click", () => {
      this.showMainUISection(this.howToPlaySection);
    });

    this.creditButton.addEventListener("click", () => {
      this.showMainUISection(this.creditSection);
    });

    this.backToMainMenuFromHowButton.addEventListener("click", () => {
      this.showMainUISection(this.mainMenuSection);
    });

    this.backToMainMenuFromCreditButton.addEventListener("click", () => {
      this.showMainUISection(this.mainMenuSection);
    });

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

      // 캐릭터 데이터로 접속
      // TODO: 다른 모듈에서 처리 해야함
      window.websocketManager.connect(this.nicknameInput.value, this.colorInput.value, this.characterInput.value);
    });

    // 랜덤 닉네임 버튼
    this.randomNicknameBtn.addEventListener('click', () => {
      this.randomNicknameBtn.style.transform = 'scale(0.9)';
      setTimeout(() => {
        this.randomNicknameBtn.style.transform = 'scale(1)';
      }, 100);
      
      this.nicknameInput.value = generateNickname();
      this.nicknameInput.focus();
      this.nicknameInput.select();
      setTimeout(() => {
        this.nicknameInput.blur();
      }, 500);
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
      this.autoReturnCanceled = false;
      this.stopAutoReturnTimer();
      
      // 즉시 대기실로 이동 (서버 응답 기다리지 않음)
      if (stateManager.getCurrentRoomId()) {
        // 현재 방 정보 가져오기
        const currentRoomInfo = stateManager.getRoomInfo();
        if (currentRoomInfo) {
          // 즉시 대기실 UI 업데이트
          this.updateWaitingRoomUI();

          // 즉시 대기실 화면으로 전환
          this.showMainUISection(this.waitingRoomSection);
          logger.logMessage("대기방으로 돌아갑니다.");
        } else {
          // 방 정보가 없으면 로비로
          this.showMainUISection(this.lobbySection);
          window.websocketManager.sendMessage("list_rooms", {});
          logger.logMessage("로비로 돌아갑니다.");
        }
      } else {
        // 방에 없으면 로비로
        this.showMainUISection(this.lobbySection);
        window.websocketManager.sendMessage("list_rooms", {});
        logger.logMessage("로비로 돌아갑니다.");
      }
    });
  }

  startAutoReturnTimer(seconds) {
    this.autoReturnCanceled = false;
    
    // 기존 타이머 정리
    this.stopAutoReturnTimer();
    
    let countdown = seconds;
    const self = this;
    
    // 타이머 표시 요소 생성
    const timerElement = document.createElement("div");
    timerElement.id = "auto-return-timer";
    timerElement.className = "text-center mt-4 text-gray-500 text-sm";
    
    // 취소 버튼 생성
    const cancelButton = document.createElement("button");
    cancelButton.textContent = "취소";
    cancelButton.className = "text-blue-500 underline hover:text-blue-700 ml-2";
    
    // 이벤트 리스너로 등록
    cancelButton.addEventListener("click", function() {
      self.autoReturnCanceled = true;
      self.stopAutoReturnTimer();
    });
    
    // 초기 텍스트 설정
    const textNode = document.createTextNode(countdown + "초 후 자동으로 대기실로 돌아갑니다. ");
    timerElement.appendChild(textNode);
    timerElement.appendChild(cancelButton);
    
    // 대기실로 돌아가기 버튼 아래에 추가
    this.gameResultSection.appendChild(timerElement);
    
    // 카운트다운
    this.autoReturnTimer = setInterval(function() {

      if (self.autoReturnCanceled) {
        self.stopAutoReturnTimer();
        return;
      }

      countdown--;
      if (countdown <= 0) {
        self.stopAutoReturnTimer();
        self.showMainUISection(self.waitingRoomSection);
        logger.logMessage("자동으로 대기방으로 돌아갑니다.");
      } else {
        timerElement.childNodes[0].textContent = countdown + "초 후 자동으로 대기실로 돌아갑니다. ";
      }
    }, 1000);
  }

  // 타이머 중지 함수
  stopAutoReturnTimer() {
    // 타이머 중지
    if (this.autoReturnTimer) {
      clearInterval(this.autoReturnTimer);
      this.autoReturnTimer = null;
    }
    
    // 타이머 요소 제거
    const timerElements = document.querySelectorAll("#auto-return-timer");
    for (let i = 0; i < timerElements.length; i++) {
      timerElements[i].remove();
    }
  }

  cancelAutoReturn() {
    this.stopAutoReturnTimer();
  }

  clearAutoReturnTimer() {
    this.stopAutoReturnTimer();
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

    this.mainMenuSection.classList.add("hidden");
    this.howToPlaySection.classList.add("hidden");
    this.creditSection.classList.add("hidden");
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
    
    // 마우스 커서 숨기고 포인터 보이기
    document.body.style.cursor = "none";
    document.getElementById("custom-crosshair").classList.remove("hidden");
  }

  exitGameView() {
    document.getElementById("game-canvas-container").classList.add("hidden");
    document.getElementById("game-hud-top-left").classList.add("hidden");
    document.getElementById("game-hud-top-right").classList.add("hidden");
    document.getElementById("game-countdown-overlay").classList.add("hidden");
    document.getElementById("player-overlays").classList.add("hidden");
    
    // 마우스 커서 다시 보이게 하고 포인터 숨기기
    document.body.style.cursor = "default";
    document.getElementById("custom-crosshair").classList.add("hidden");
    this.mainUiContainer.classList.remove("hidden");
  }

  updateRoomList(rooms) {
    this.roomListEl.innerHTML = "";
    
    if (rooms && rooms.length > 0) {
      rooms.forEach((room) => {
        const roomItem = document.createElement("div");
        roomItem.className = "p-3 mb-2 rounded-md hover:bg-slate-300 flex justify-between items-center cursor-pointer";
        roomItem.innerHTML = `<span><strong class="font-mono text-sky-400">${room.id}</strong> (${room.current_players}/${room.max_players}) - <span class="capitalize">${room.state}</span></span>`;
        
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

  updateWaitingRoomUI() {
    const roomInfo = stateManager.getRoomInfo();
    this.roomIdDisplay.textContent = roomInfo.room_id;

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
    this.readyButton.textContent = isReady ? "준비 취소" : "준비";
    this.readyButton.classList.toggle("bg-yellow-500", isReady);
    this.readyButton.classList.toggle("text-slate-900", isReady);
    this.readyButton.classList.toggle("hover:bg-yellow-600", isReady);
    this.readyButton.classList.toggle("border-yellow-600", isReady);
    this.readyButton.classList.toggle("bg-green-500", !isReady);
    this.readyButton.classList.toggle("text-white", !isReady);
    this.readyButton.classList.toggle("hover:bg-green-600", !isReady);
    this.readyButton.classList.toggle("border-green-600", !isReady);
  }

  renderPlayerList() {
    this.playerListEl.innerHTML = "";
    
    // 캐릭터 이모지
    const characterEmojis = {
      'onion': '🧅',
      'tomato': '🍅',
      'potato': '🥔',
      'paprika': '🫑'
    };
    
    stateManager.getAllPlayers().forEach((player) => {
      const playerItem = document.createElement("div");
      playerItem.className = "player-list-item border-slate-700 flex items-center justify-between";

      const playerInfo = document.createElement("div");
      playerInfo.className = "flex items-center";
      
      const characterEmoji = characterEmojis[player.character] || '👤';
      const colorPreview = `<div class="player-color-preview" style="background-color: ${player.color};"></div>`;
      playerInfo.innerHTML = `${colorPreview} <span class="text-lg mr-1">${characterEmoji}</span> <span class="truncate max-w-[120px] sm:max-w-none">${player.nickname}</span>`;

      const playerStatus = document.createElement("div");
      playerStatus.className = "flex items-center space-x-2";

      let statusContent = '';
      if (player.id === stateManager.getClientId()) {
        statusContent += '<span class="px-2 py-0.5 text-xs font-semibold bg-yellow-600 text-yellow-100 rounded-full">나</span>';
      }
      
      if (player.is_owner) {
        statusContent += '<span class="px-2 py-0.5 text-xs font-semibold bg-purple-600 text-purple-100 rounded-full">방장</span>';
      } else {
        if (player.is_ready) {
          statusContent += `<span class="px-2 py-0.5 text-xs font-semibold bg-green-600 text-green-100 rounded-full">준비</span>`;
        }  
      }
      
      
      playerStatus.innerHTML = statusContent;

      playerItem.appendChild(playerInfo);
      playerItem.appendChild(playerStatus);

      this.playerListEl.appendChild(playerItem);
    });
  }

  updatePlayerCountInRoom() {
    this.currentPlayersEl.textContent = stateManager.getPlayerCount();
  }

  updateGameResultUI(resultPayload) {
    this.gameResultDisplay.innerHTML = `<h3 class="text-2xl font-bold mb-4 text-center">🏆 게임 결과</h3>`;
    
    const scoreList = document.createElement("div");
    scoreList.className = "space-y-2";
    
    if (resultPayload.final_scores && resultPayload.final_scores.length > 0) {
      resultPayload.final_scores.sort((a, b) => b.score - a.score);
      
      let currentRank = 1;
      let previousScore = null;
      let sameRankCount = 0;
      
      resultPayload.final_scores.forEach((score, index) => {
        // 이전 점수와 같으면 같은 순위 유지
        if (previousScore !== null && score.score === previousScore) {
          sameRankCount++;
        } else {
          // 점수가 다르면 순위 갱신 (동점자 수만큼 건너뛰기)
          currentRank = index + 1;
          sameRankCount = 0;
        }
        
        const listItem = document.createElement("div");
        listItem.className = "p-3 rounded-lg flex items-center justify-between transition-all";
        
        let rankIcon = '';
        let rankColorClass = '';
        let bgColorClass = 'bg-slate-700';
        
        if (currentRank === 1) {
          rankIcon = '👑';
          rankColorClass = 'text-yellow-400 font-bold';
          bgColorClass = 'bg-gradient-to-r from-yellow-800/30 to-yellow-600/20 border border-yellow-600/30';
        } else if (currentRank === 2) {
          rankIcon = '🥈';
          rankColorClass = 'text-gray-300 font-semibold';
          bgColorClass = 'bg-gradient-to-r from-gray-700/30 to-gray-600/20 border border-gray-500/30';
        } else if (currentRank === 3) {
          rankIcon = '🥉';
          rankColorClass = 'text-orange-400 font-semibold';
          bgColorClass = 'bg-gradient-to-r from-orange-800/30 to-orange-600/20 border border-orange-600/30';
        }
        
        listItem.className += ` ${bgColorClass}`;
        
        
        const leftSection = document.createElement("div");
        leftSection.className = "flex items-center gap-3";
        
        const rankDiv = document.createElement("div");
        rankDiv.className = `text-2xl font-bold ${rankColorClass} min-w-[40px] text-center`;
        rankDiv.style.textShadow = '0 0 3px #000, 0 0 3px #000, 0 0 3px #000, 0 0 3px #000';
        rankDiv.innerHTML = `${currentRank}<span class="text-sm">위</span>`;
        
        const playerDiv = document.createElement("div");
        playerDiv.className = "flex items-center gap-2";
        
        const nameSpan = document.createElement("span");
        nameSpan.className = currentRank <= 3 ? "font-medium text-white" : "text-gray-200";
        nameSpan.style.textShadow = '0 0 3px #000, 0 0 3px #000, 0 0 3px #000, 0 0 3px #000';
        nameSpan.textContent = score.nickname || score.player_id.substring(0, 6);
        playerDiv.appendChild(nameSpan);
        
        if (rankIcon) {
          const iconSpan = document.createElement("span");
          iconSpan.className = "text-xl";
          iconSpan.textContent = rankIcon;
          playerDiv.appendChild(iconSpan);
        }
        
        leftSection.appendChild(rankDiv);
        leftSection.appendChild(playerDiv);
        
        
        const scoreDiv = document.createElement("div");
        scoreDiv.className = `text-xl font-bold ${currentRank <= 3 ? rankColorClass : 'text-white'}`;
        scoreDiv.style.textShadow = '0 0 3px #000, 0 0 3px #000, 0 0 3px #000, 0 0 3px #000';
        scoreDiv.textContent = `${score.score}점`;
        
        listItem.appendChild(leftSection);
        listItem.appendChild(scoreDiv);
        
        scoreList.appendChild(listItem);
        previousScore = score.score;
      });
    } else {
      scoreList.innerHTML = '<div class="p-4 bg-slate-700 rounded-lg text-center text-gray-400">점수 정보가 없습니다.</div>';
    }
    
    this.gameResultDisplay.appendChild(scoreList);
  }

  updateHudPlayerInfo() {
    // 플레이어 점수 목록
    const playerListContainer = this.gameHudTopLeft.querySelector('.player-scores-list') || document.createElement("div");
    if (!this.gameHudTopLeft.querySelector('.player-scores-list')) {
      playerListContainer.className = "player-scores-list";
      this.gameHudTopLeft.appendChild(playerListContainer);
    }
    
    playerListContainer.innerHTML = "";
    const ul = document.createElement("ul");

    // 캐릭터와 이모지
    // TODO: PlayerInfo와 게임 내 PlayerState 정보가 달라서 따로 매핑
    // 왜 이렇게 짰냐... 수정 필요
    const characterEmojis = {
      'onion.glb': '🧅',
      'tomato.glb': '🍅',
      'potato.glb': '🥔',
      'paprika.glb': '🫑'
    };

    const playersPayload = Array.from(stateManager.getAllPlayers().values());
    
    playersPayload.sort((a, b) => b.score == a.score ? b.id - a.id : b.score - a.score);
    
    playersPayload.forEach((p) => {
      const playerOnMap = stateManager.getPlayer(p.id);
      const nickname = playerOnMap ? playerOnMap.nickname : p.id.substring(0, 6);
      const color = playerOnMap ? playerOnMap.color : "#FFFFFF";
      const character = playerOnMap ? playerOnMap.asset : null;
      const characterEmoji = characterEmojis[character] || '👤';
      const isSelf = p.id === stateManager.getClientId();

      const li = document.createElement("li");
      li.style.marginBottom = "0.25rem";
      li.className = isSelf ? "font-bold text-yellow-300" : "text-slate-200";
      li.innerHTML = `<div class="flex items-center">
                        <span style="width:12px; height:12px; background-color:${color}; border-radius:50%; margin-right:5px; border:1px solid #fff;"></span>
                        <span style="margin-right:3px;">${characterEmoji}</span>
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
    // 시간 형식 변환
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    this.gameTimeLeftEl.textContent = formattedTime;
  }

  showGameCountdown(text) {
    this.gameCountdownOverlay.classList.remove("hidden");
    this.gameCountdownOverlay.textContent = text;
  }

  hideGameCountdown() {
    this.gameCountdownOverlay.classList.add("hidden");
  }

setupColorSelection() {
  document.querySelectorAll('.game-color-option').forEach(button => {
    button.addEventListener('click', () => {
      // 모든 색상 버튼의 선택 상태 제거
      document.querySelectorAll('.game-color-option').forEach(btn => {
        btn.classList.remove('selected');
      });
      
      // 클릭된 버튼을 선택 상태로 변경
      button.classList.add('selected');
      
      // hidden input에 색상 값 설정
      this.colorInput.value = button.dataset.color;
      
      // 캐릭터 프리뷰 색상 업데이트
      if (window.characterPreview && window.characterPreview.updateCharacterColor) {
        window.characterPreview.updateCharacterColor(button.dataset.color);
      }
    });
  });

  // 기본 색상
  const defaultColorButton = document.querySelector('.game-color-option[data-color="#e17055"]');
  if (defaultColorButton) {
    defaultColorButton.classList.add('selected');
    this.colorInput.value = "#e17055";
  }
}

setupCharacterSelection() {
  // 캐릭터 선택 슬롯들
  document.querySelectorAll('.character-slot').forEach(slot => {
    slot.addEventListener('click', () => {
      // 모든 캐릭터 슬롯의 선택 해제
      document.querySelectorAll('.character-slot').forEach(s => s.classList.remove('selected'));
      
      // 클릭된 슬롯 선택
      slot.classList.add('selected');
      
      // hidden input에 캐릭터 값 설정
      this.characterInput.value = slot.dataset.character;
      
      // 프리뷰 업데이트
      const emoji = slot.querySelector('.character-emoji').textContent;
      const previewPlaceholder = document.getElementById('preview-placeholder');
      if (previewPlaceholder) {
        previewPlaceholder.textContent = emoji;
      }
      
      if (window.characterPreview && window.characterPreview.loadCharacter) {
        window.characterPreview.loadCharacter(slot.dataset.character);
      }
    });
  });

  // 기본 캐릭터 선택 상태 설정
  const defaultCharacterSlot = document.querySelector('.character-slot[data-character="onion"]');
  if (defaultCharacterSlot) {
    defaultCharacterSlot.classList.add('selected');
  }
}
}

// 전역 인스턴스 생성
const uiManager = new UIManager();
window.uiManager = uiManager;

export { UIManager, uiManager }; 