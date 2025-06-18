import * as THREE from 'three';
import { stateManager } from './state-manager.js';

/**
 * Three.js 3D 게임 렌더링 모듈
 */
class GameRenderer {
  constructor() {
    // Three.js 관련 변수들
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.gameFloor = null;
    this.raycaster = null;
    // 플레이어 메시 관리용
    this.playerMeshes = new Map();
    // 플레이어 오버레이 관리용
    this.playerOverlays = new Map();
    // 플레이어 Halo 관리용
    this.playerHalos = new Map();
    this.animationFrameId = null;
    this.mouse = new THREE.Vector2();
    
    // 플레이어별 목표 위치 (서버에서 받은 최신 값 관리용, 다음 프레임에 lerp)
    this.playerTargetPositions = new Map();
    // 플레이어 lerp 속도 (position과 yaw 보간)
    this.lerpSpeed = 0.2;
    
    // 맵 설정
    this.MAP_SIZE = 40;
    this.MAP_BOUNDARY = this.MAP_SIZE / 2;
    
    // 클라이언트 마지막 공격 시간
    this.lastAttackTime = 0; 
    // 공격이 끝났는지 체크
    this.hasAttackEnded = false;
    
    // 시간 체크
    this.lastFrameTime = 0;
    this.clock = new THREE.Clock();

    // 무적 상태 관리용
    this.invincibleFlashState = new Map();


    // 게임 환경 변수 (클라이언트 view 제어용, 수정해도 서버에 반영 x)
    this.hammerDuration = 500;
    this.respawnDuration = 500;
    this.deathDuration = 3000;
    this.hitDuration = 500;
  }

  initThreeJS() {
    if (this.scene) return;

    // 씬 생성
    this.scene = new THREE.Scene();
    // 배경색 설정
    this.scene.background = new THREE.Color(0x87ceeb);

    // 레이캐스터 생성 (포인터 위치로 평면 상 좌표 추적, yaw 계산에 필요)
    this.raycaster = new THREE.Raycaster();

    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(60, aspect, 1, 1000);
    // 카메라 초기화
    this.camera.position.set(0, 25, 30);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    // 설정 안 하면 맥에서 흐릿하게 나옴
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    
    // 그림자 활성화
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;


    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // 이거 켜야 색깔 예쁘게 나옴
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 2;
    
    const gameCanvasContainer = document.getElementById("game-canvas-container");
    gameCanvasContainer.innerHTML = "";
    gameCanvasContainer.appendChild(this.renderer.domElement);

    // Ambient Light
    const ambientLight = new THREE.AmbientLight(0xffffff, 1);
    this.scene.add(ambientLight);
    
    // Dir Light
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1); // 더 밝은 방향광
    directionalLight.position.set(30, 50, 20);
    
    // Dir Light 그림자 설정
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 500;
    directionalLight.shadow.camera.left = -50;
    directionalLight.shadow.camera.right = 50;
    directionalLight.shadow.camera.top = 50;
    directionalLight.shadow.camera.bottom = -50;
    directionalLight.shadow.bias = -0.001;
    this.scene.add(directionalLight);
    
    const mapModel = window.assetManager.createInstance('map.glb');
    if (mapModel) {
      this.gameFloor = mapModel;
      this.gameFloor.position.y = 0;
      this.gameFloor.receiveShadow = true;
      
      // 맵의 모든 메시에 그림자 설정
      this.gameFloor.traverse((child) => {
        if (child.isMesh) {
          child.receiveShadow = true;
          child.castShadow = true;
        }
      });
      
      this.scene.add(this.gameFloor);
    }


    // 기존 플레이어들의 메시 생성
    this.playerMeshes.clear();
    stateManager.getAllPlayers().forEach((playerInfo) => {
      this.createOrUpdatePlayerMesh(playerInfo.id, {
        ...playerInfo
      });
    });

    // 이벤트 리스너 등록
    window.addEventListener("resize", this.onWindowResize.bind(this), false);
    
    const gameCanvasContainer2 = document.getElementById("game-canvas-container");
    gameCanvasContainer2.addEventListener("mousemove", this.handleCanvasMouseMove.bind(this), false);
    gameCanvasContainer2.addEventListener("click", this.handleCanvasClick.bind(this), false);
  }

  handleCanvasClick(event) {
    if (uiManager.mainUiContainer.classList.contains("hidden") &&
        this.scene && this.camera && this.gameFloor && stateManager.getClientId()) {
      
      const canvasBounds = this.renderer.domElement.getBoundingClientRect();
      const mouseX = ((event.clientX - canvasBounds.left) / canvasBounds.width) * 2 - 1;
      const mouseY = -((event.clientY - canvasBounds.top) / canvasBounds.height) * 2 + 1;

      this.raycaster.setFromCamera(new THREE.Vector2(mouseX, mouseY), this.camera);
      const intersects = this.raycaster.intersectObject(this.gameFloor, true);

      const myMesh = this.playerMeshes.get(stateManager.getClientId());
      if (myMesh) {
        let targetPoint;
        
        if (intersects.length > 0) {
          targetPoint = intersects[0].point;
        } else {
          const planeY = this.gameFloor.position.y;
          const rayOrigin = this.camera.position;
          const rayDirection = new THREE.Vector3(mouseX, mouseY, 0.5).unproject(this.camera).sub(rayOrigin).normalize();
          
          const t = (planeY - rayOrigin.y) / rayDirection.y;
          targetPoint = rayOrigin.clone().add(rayDirection.multiplyScalar(t));
        }
        
        const playerPos = myMesh.position;
        const direction = {
          x: targetPoint.x - playerPos.x,
          z: targetPoint.z - playerPos.z
        };
        
        // 방향 벡터 정규화
        const magnitude = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
        if (magnitude > 0) {
          direction.x /= magnitude;
          direction.z /= magnitude;
          
          window.websocketManager.sendMessage("player_action", {
            action_type: "click",
            data: {
              direction: direction,
              start_position: {
                x: playerPos.x,
                z: playerPos.z
              }
            }
          });
          
          // 공격 시간 기록 (플레이어 회전 제한용)
          // TODO: 좀 더 나은 방법 없나...
          this.lastAttackTime = Date.now();
          this.hasAttackEnded = false;
        }
      }
    }
  }

  onWindowResize() {
    if (this.camera && this.renderer) {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
  }

  createOrUpdatePlayerMesh(playerId, playerData) {
    let playerMesh = this.playerMeshes.get(playerId);
    
    if (!playerMesh) {
      const model = window.assetManager.createInstance(playerData.asset);
      
      if (model) {
        playerMesh = model;
        playerMesh.scale.set(2, 2, 2);
        
        playerMesh.traverse((child) => {
          if (child.isMesh) {
            if (child.material) {
              if (child.material.name === 'hammer_head') {
                child.material.color.setHex(parseInt(playerData.color.replace("#", "0x"))); 
              }
            }
            
            // 그림자 설정
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
        
        // 니메이션 믹서 설정
        if (model.animations) {
          
          let animationClips = [];
        
          if (Array.isArray(model.animations)) {
            animationClips = model.animations;
          } else if (typeof model.animations === 'object') {
            animationClips = Object.values(model.animations);
          }
          
          if (animationClips.length > 0) {
            playerMesh.mixer = new THREE.AnimationMixer(model);
            playerMesh.animations = {};
            
            // 모든 애니메이션 클립을 저장
            animationClips.forEach((clip) => {
              if (clip && clip.name) {
                playerMesh.animations[clip.name] = playerMesh.mixer.clipAction(clip);
              }
            });
            
            // idle 애니메이션 시작
            if (playerMesh.animations && playerMesh.animations['idle']) {
              playerMesh.currentAction = playerMesh.animations['idle'];
              playerMesh.currentAction.play();
            }
          }
        }
      }
      
      this.scene.add(playerMesh);
      this.playerMeshes.set(playerId, playerMesh);
      
      // 로컬 플레이어인 경우 Halo추가
      if (playerId === stateManager.getClientId()) {
        this.createPlayerHalo(playerId, playerData.color);
      }
      
      // 초기 위치 설정 (어차피 서버에서 받아옴)
      const clampedX = Math.max(-this.MAP_BOUNDARY + 1, Math.min(this.MAP_BOUNDARY - 1, playerData.x));
      const clampedZ = Math.max(-this.MAP_BOUNDARY + 1, Math.min(this.MAP_BOUNDARY - 1, playerData.z));
      
      const yPosition = 0;
      
      playerMesh.position.set(
        clampedX,
        yPosition,
        clampedZ
      );
    }

    // 플레이어 표시
    playerMesh.visible = true;

    // 애니메이션 클립 처리
    this.handlePlayerAnimation(playerMesh, playerData.current_animation);

    // Target 위치 저장 (어차피 서버에서 받아옴, 임의 값)
    const clampedX = Math.max(-this.MAP_BOUNDARY + 1, Math.min(this.MAP_BOUNDARY - 1, playerData.x));
    const clampedZ = Math.max(-this.MAP_BOUNDARY + 1, Math.min(this.MAP_BOUNDARY - 1, playerData.z));
    const yPosition = 0
    
    // 목표 위치 저장 (lerp에서 사용)
    this.playerTargetPositions.set(playerId, {
      x: clampedX,
      y: yPosition,
      z: clampedZ,
      yaw: playerData.yaw !== undefined ? playerData.yaw : 0
    });
  }

  handlePlayerAnimation(playerMesh, animationName) {
    if (!playerMesh || !playerMesh.mixer || !playerMesh.animations || !animationName) {
      return;
    }

    // 진행중인 애니메이션과 같으면
    if (playerMesh.currentAnimationName === animationName) {
      return;
    }

    // 이전 애니메이션 정지
    if (playerMesh.currentAction) {
      playerMesh.currentAction.fadeOut(0.2);
    }

    // 새 애니메이션 재생
    if (playerMesh.animations[animationName]) {
      playerMesh.currentAction = playerMesh.animations[animationName];
      playerMesh.currentAction.reset().fadeIn(0.2).play();
      playerMesh.currentAnimationName = animationName;
      
      // 일회성 애니메이션은 한 번만 재생
      if (['hammer_attack', 'death', 'respawn', 'hit'].includes(animationName)) {
        playerMesh.currentAction.setLoop(THREE.LoopOnce);
        playerMesh.currentAction.clampWhenFinished = true;
      } else {
        playerMesh.currentAction.setLoop(THREE.LoopRepeat);
      }
    }
  }

  createPlayerHalo(playerId, playerColor) {
    // 이미 할로가 있으면 제거
    this.removePlayerHalo(playerId);

    const haloGeometry = new THREE.RingGeometry(2, 2.4, 32);
    
    // 색상 파싱
    let colorHex;
    try {
      colorHex = parseInt(playerColor.replace("#", "0x"));
      if (isNaN(colorHex)) {
        colorHex = 0xffffff;
      }
    } catch (e) {
      colorHex = 0xffffff;
    }
    
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide
    });
    
    const haloMesh = new THREE.Mesh(haloGeometry, haloMaterial);
    
    
    haloMesh.rotation.x = -Math.PI / 2;
    haloMesh.position.y = 0.1;
    
    haloMesh.userData = {
      originalOpacity: 0.5,
      originalColor: colorHex,
      pulseTime: 0
    };
    
    this.scene.add(haloMesh);
    this.playerHalos.set(playerId, haloMesh);
  }

  removePlayerHalo(playerId) {
    const halo = this.playerHalos.get(playerId);
    if (halo) {
      this.scene.remove(halo);
      if (halo.geometry) halo.geometry.dispose();
      if (halo.material) halo.material.dispose();
      this.playerHalos.delete(playerId);
    }
  }

  updatePlayerMeshes() {
    const playersData = Array.from(stateManager.getAllPlayers().values());

    // 플레이어 메시 업데이트
    playersData.forEach((pData) => {
      const playerInfo = stateManager.getPlayer(pData.id);
      this.createOrUpdatePlayerMesh(pData.id, pData);
      this.updatePlayerOverlay(pData.id, pData, playerInfo);
    });
  }

  animateThreeJS() {
    this.animationFrameId = requestAnimationFrame(this.animateThreeJS.bind(this));
    
    if (!this.renderer || !this.scene || !this.camera) return;

    const deltaTime = this.clock.getDelta();
    
    // 공격 종료 체크
    this.checkAttackEnd();

    stateManager.getAllPlayers().forEach((player) => {
      const mesh = this.playerMeshes.get(player.id);
      if (!mesh) return;

      // 플레이어 위치 및 회전 보간
      const targetPos = this.playerTargetPositions.get(player.id);
      if (targetPos) {
        mesh.position.lerp(targetPos, this.lerpSpeed);

        // 죽었을 때는 yaw 반영하지 않음
        if (mesh.currentAnimationName != 'death') {
          const targetYaw = (player.id === stateManager.getClientId()) 
                          ? stateManager.getPlayerYaw() 
                          : targetPos.yaw;
          mesh.rotation.y = this.lerpAngle(mesh.rotation.y, targetYaw, this.lerpSpeed);
        }
      }
      
      // 애니메이션 업데이트
      if (mesh.mixer) {
        const clampedDeltaTime = Math.min(deltaTime, 0.033);
        mesh.mixer.update(clampedDeltaTime);
      }

      // Halo 업데이트
      // TODO: 함수 분리
      const halo = this.playerHalos.get(player.id);
      if (halo && halo.material && halo.userData) {
        // 위치 업데이트
        halo.position.x = mesh.position.x;
        halo.position.z = mesh.position.z;
        
        // 애니메이션
        halo.userData.pulseTime += deltaTime * 2
        const pulseOpacity = halo.userData.originalOpacity + Math.sin(halo.userData.pulseTime * 2) * 0.3;
        halo.material.opacity = Math.max(0.2, Math.min(0.8, pulseOpacity));
        
      }

      // 무적 상태 깜빡임 효과 처리
      // TODO: 함수 분리
      const flashInterval = 0.25;
      if (!this.invincibleFlashState.has(player.id)) {
        this.invincibleFlashState.set(player.id, { timer: 0, isWhite: false });
      }
      const flashState = this.invincibleFlashState.get(player.id);
      let targetEmissive = 0x000000;

      if (player.is_invincible) {
        flashState.timer += deltaTime;
        if (flashState.timer >= flashInterval) {
          flashState.isWhite = !flashState.isWhite; 
          flashState.timer %= flashInterval;      
        }
        if (flashState.isWhite) {
          targetEmissive = 0x444444;
        }
      } else {
        // 무적 아니면 상태 초기화
        flashState.timer = 0;
        flashState.isWhite = false;
      }
      
      
      mesh.traverse((child) => {
        if (child.isMesh && child.material) {
          if (child.material.emissive.getHex() !== targetEmissive) {
            child.material.emissive.setHex(targetEmissive);
          }
        }
      });
    });

    
    // 플레이어 오버레이 위치 업데이트
    this.playerOverlays.forEach((overlayData, playerId) => {
      const mesh = this.playerMeshes.get(playerId);
      if (mesh && this.camera) {
        const meshPosition = mesh.position.clone();
        meshPosition.y += 8;
        const screenPosition = meshPosition.project(this.camera);
        const x = (screenPosition.x * 0.5 + 0.5) * window.innerWidth;
        const y = (screenPosition.y * -0.5 + 0.5) * window.innerHeight;
        overlayData.element.style.left = `${x}px`;
        overlayData.element.style.top = `${y}px`;
      }
    });
    

    this.renderer.render(this.scene, this.camera);
  }

  // 위치 선형 보간
  lerp(start, end, factor) {
    return start + (end - start) * factor;
  }

  // 각도 선형 보간
  lerpAngle(start, end, factor) {
    let diff = end - start;
    
    // 각도 차이가 π보다 크면 반대 방향으로
    if (diff > Math.PI) {
      diff -= 2 * Math.PI;
    } else if (diff < -Math.PI) {
      diff += 2 * Math.PI;
    }
    
    return start + diff * factor;
  }

  // yaw까지 서버 정보로 업데이트 하면 반응이 너무 느림
  // yaw는 로컬 값이 우선으로 적용
  // remote 플레이어들만 서버 정보로 yaw 업데이트
  handleCanvasMouseMove(event) {
    if (uiManager.mainUiContainer.classList.contains("hidden") &&
        this.scene && this.camera && this.gameFloor && stateManager.getClientId()) {
      
      const canvasBounds = this.renderer.domElement.getBoundingClientRect();

      this.mouse.x = ((event.clientX - canvasBounds.left) / canvasBounds.width) * 2 - 1;
      this.mouse.y = -((event.clientY - canvasBounds.top) / canvasBounds.height) * 2 + 1;

      // 공격 중에는 회전 안 함
      const now = Date.now();
      if (now - this.lastAttackTime < 500) {
        // 포인터 위치만 업데이트
        const customCrosshair = document.getElementById("custom-crosshair");
        customCrosshair.style.left = `${event.clientX}px`;
        customCrosshair.style.top = `${event.clientY}px`;
        return;
      }

      this.raycaster.setFromCamera(this.mouse, this.camera);
      const intersects = this.raycaster.intersectObject(this.gameFloor, true);

      const myMesh = this.playerMeshes.get(stateManager.getClientId());
      if (myMesh) {
        let intersectionPoint;
        
        if (intersects.length > 0) {
          intersectionPoint = intersects[0].point;
        } else {
          const planeY = this.gameFloor.position.y;
          const rayOrigin = this.camera.position;
          const rayDirection = new THREE.Vector3(this.mouse.x, this.mouse.y, 0.5).unproject(this.camera).sub(rayOrigin).normalize();
          
          const t = (planeY - rayOrigin.y) / rayDirection.y;
          intersectionPoint = rayOrigin.clone().add(rayDirection.multiplyScalar(t));
        }

        const dx = intersectionPoint.x - myMesh.position.x;
        const dz = intersectionPoint.z - myMesh.position.z;
        const newYaw = Math.atan2(dx, dz);

        const currentYaw = stateManager.getPlayerYaw();
        let diff = newYaw - currentYaw;
        if (diff > Math.PI) diff -= 2 * Math.PI;
        if (diff < -Math.PI) diff += 2 * Math.PI;

        if (Math.abs(diff) > 0.01) {
          stateManager.setPlayerYaw(newYaw);
          window.websocketManager.sendMessage("player_action", {
            action_type: "look",
            data: { yaw: newYaw, pitch: 0 },
          });
        }
      }

      // 포인터 위치 업데이트
      const customCrosshair = document.getElementById("custom-crosshair");
      customCrosshair.style.left = `${event.clientX}px`;
      customCrosshair.style.top = `${event.clientY}px`;
    }
  }

  exitGameView() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    // 플레이어 메시 정리
    if (this.scene) {
      this.playerMeshes.forEach((mesh) => {
        this.scene.remove(mesh);
        
        // 애니메이션 믹서 정리
        if (mesh.mixer && typeof mesh.mixer.stopAllAction === 'function') {
          mesh.mixer.stopAllAction();
          mesh.mixer = null;
        }
        
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((material) => {
              if (material.map) material.map.dispose();
              material.dispose();
            });
          } else {
            if (mesh.material.map) mesh.material.map.dispose();
            mesh.material.dispose();
          }
        }
      });
      this.playerMeshes.clear();
      this.playerTargetPositions.clear();

      // 플레이어 오버레이 정리
      this.playerOverlays.forEach((overlayData) => {
        overlayData.element.remove();
      });
      this.playerOverlays.clear();

      // Halo 정리
      this.playerHalos.forEach((halo) => {
        this.scene.remove(halo);
        if (halo.geometry) halo.geometry.dispose();
        if (halo.material) halo.material.dispose();
      });
      this.playerHalos.clear();

      // 씬의 모든 오브젝트 제거
      while (this.scene.children.length > 0) {
        const object = this.scene.children[0];
        this.scene.remove(object);
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          if (Array.isArray(object.material)) {
            object.material.forEach((material) => {
              if (material.map) material.map.dispose();
              material.dispose();
            });
          } else {
            if (object.material.map) object.material.map.dispose();
            object.material.dispose();
          }
        }
      }
    }

    // 렌더러 정리
    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement && this.renderer.domElement.parentElement) {
        this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
      }
      this.renderer = null;
    }

    // 변수 초기화
    this.scene = null;
    this.camera = null;
  }

  checkAttackEnd() {
    const now = Date.now();
    const attackDuration = 500;
    
    // 공격이 진행 중이고 이제 끝났을 때
    if (this.lastAttackTime > 0 && !this.hasAttackEnded && now - this.lastAttackTime >= attackDuration) {
      this.hasAttackEnded = true;
      
      // 현재 키보드 상태 전송
      // 공격 끝났을 때 누르고 있는 키 반영하기 위함
      if (window.inputHandler) {
        window.inputHandler.sendMovementInput();
      }
    }
  }

  createPlayerOverlay(playerId, playerInfo) {
    const overlayContainer = document.getElementById("player-overlays");
    if (!overlayContainer) return null;

    const overlay = document.createElement("div");
    overlay.className = "player-overlay";
    overlay.style.display = "block";

    // 닉네임
    const nameDiv = document.createElement("div");
    nameDiv.className = "player-name";
    nameDiv.textContent = playerInfo.nickname;
    nameDiv.style.color = playerInfo.color;
    nameDiv.style.borderColor = playerInfo.color;

    // 체력바
    const healthBarContainer = document.createElement("div");
    healthBarContainer.className = "player-health-bar";

    const healthFill = document.createElement("div");
    healthFill.className = "player-health-fill";
    healthFill.style.width = "100%";

    healthBarContainer.appendChild(healthFill);
    overlay.appendChild(nameDiv);
    overlay.appendChild(healthBarContainer);
    overlayContainer.appendChild(overlay);

    this.playerOverlays.set(playerId, {
      element: overlay,
      nameDiv: nameDiv,
      healthFill: healthFill
    });

    return this.playerOverlays.get(playerId);
  }

  updatePlayerOverlay(playerId, playerData, playerInfo) {
    let overlayData = this.playerOverlays.get(playerId);
    if (!overlayData && playerInfo) {
      overlayData = this.createPlayerOverlay(playerId, playerInfo);
    }

    if (!overlayData) return;

    // 체력바 업데이트
    const health = playerData.health;
    const maxHealth = playerData.max_health || 3;
    const healthPercentage = maxHealth > 0 ? (health / maxHealth) * 100 : 0;

    overlayData.healthFill.style.width = `${healthPercentage}%`;

    // 색상 변경
    overlayData.healthFill.className = "player-health-fill";
    if (healthPercentage <= 33) {
      overlayData.healthFill.classList.add("low");
    } else if (healthPercentage <= 66) {
      overlayData.healthFill.classList.add("medium");
    }

    // 살아있는 플레이어는 오버레이 표시
    overlayData.element.style.display = "block";
  }

  removePlayerOverlay(playerId) {
    const overlayData = this.playerOverlays.get(playerId);
    if (overlayData) {
      overlayData.element.remove();
      this.playerOverlays.delete(playerId);
    }
  }
}

// 전역 인스턴스 생성
const gameRenderer = new GameRenderer();
window.gameRenderer = gameRenderer;

export { GameRenderer, gameRenderer }; 