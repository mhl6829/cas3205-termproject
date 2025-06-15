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
    this.playerMeshes = new Map();
    this.playerOverlays = new Map(); // 플레이어 오버레이 (체력바, 닉네임)
    this.playerHalos = new Map(); // 플레이어 할로/링 (현재 플레이어 표시용)
    this.animationFrameId = null;
    this.mouse = new THREE.Vector2();
    
    // Interpolation을 위한 변수들
    this.playerTargetPositions = new Map(); // 플레이어별 목표 위치
    this.lerpSpeed = 0.2; // 플레이어 lerp 속도 (0.1 ~ 0.3 사이가 적당)
    
    // 맵 설정 (화면에 맞는 크기로 조정)
    this.MAP_SIZE = 40; // 40x40으로 축소
    this.MAP_BOUNDARY = this.MAP_SIZE / 2; // ±20 범위
    
    // 공격 상태 추적
    this.lastAttackTime = 0; // 마지막 공격 시간
    this.hasAttackEnded = false; // 공격이 끝났는지 추적
    
    // 성능 최적화를 위한 시간 추적
    this.lastFrameTime = 0;
    this.clock = new THREE.Clock();

    this.invincibleFlashState = new Map();


    // 게임 환경 변수 (클라이언트 view 제어용, 수정해도 서버에 반영되지 않음)
    this.hammerDuration = 500;
    this.respawnDuration = 500;
    this.deathDuration = 3000;
    this.hitDuration = 500;
  }

  initThreeJS() {
    if (this.scene) return;

    this.scene = new THREE.Scene();
    // 밝고 귀여운 하늘 파스텔 배경색으로 변경
    this.scene.background = new THREE.Color(0x87ceeb); // 매우 밝은 블루그레이
    this.raycaster = new THREE.Raycaster();

    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(60, aspect, 1, 1000);
    // 카메라 위치를 맵 전체가 보이도록 조정
    this.camera.position.set(0, 25, 30);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // 픽셀 비율 제한으로 성능 향상
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    
    // 그림자 활성화
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;


    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 2;
    
    const gameCanvasContainer = document.getElementById("game-canvas-container");
    gameCanvasContainer.innerHTML = "";
    gameCanvasContainer.appendChild(this.renderer.domElement);

    // 조명 설정 - 훨씬 더 밝고 다양한 조명
    // 환경광을 더 밝게
    const ambientLight = new THREE.AmbientLight(0xffffff, 1); // 환경광 대폭 증가
    this.scene.add(ambientLight);
    
    // 주 방향광
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1); // 더 밝은 방향광
    directionalLight.position.set(30, 50, 20);
    
    // 그림자 설정
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 500;
    directionalLight.shadow.camera.left = -50;
    directionalLight.shadow.camera.right = 50;
    directionalLight.shadow.camera.top = 50;
    directionalLight.shadow.camera.bottom = -50;
    // directionalLight.shadow.bias = -0.005;
    // directionalLight.shadow.normalBias = 0.05;
    
    this.scene.add(directionalLight);
    
    // 중앙 상단에 추가 조명
    const topLight = new THREE.PointLight(0xffffff, 0.5, 80);
    topLight.position.set(0, 40, 0);
    this.scene.add(topLight);

    // 바닥 생성 - map.glb 사용
    const mapModel = window.assetManager.createInstance('map.glb');
    if (mapModel) {
      // GLB 맵 모델 사용
      this.gameFloor = mapModel;
      this.gameFloor.position.y = 0;
      this.gameFloor.receiveShadow = true; // 맵이 그림자를 받도록 설정
      
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
      console.log(playerInfo.color);
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
          // 바닥과 교차하는 경우 그 지점을 사용
          targetPoint = intersects[0].point;
        } else {
          // 바닥 밖을 클릭한 경우, 가상의 평면(y=0)과의 교차점 계산
          const planeY = this.gameFloor.position.y;
          const rayOrigin = this.camera.position;
          const rayDirection = new THREE.Vector3(mouseX, mouseY, 0.5).unproject(this.camera).sub(rayOrigin).normalize();
          
          // y = planeY 평면과의 교차점 계산
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
          
          // 공격 시간 기록 (클라이언트 회전 제한)
          this.lastAttackTime = Date.now();
          this.hasAttackEnded = false; // 새 공격 시작
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
        // GLB 모델 사용
        playerMesh = model;
        // 모델 크기 조정
        playerMesh.scale.set(2, 2, 2);
        
        // 모델의 모든 메시에 색상 적용
        playerMesh.traverse((child) => {
          if (child.isMesh) {
            if (child.material) {
              // 재질 복제 (다른 플레이어와 재질 공유 방지)
              child.material = child.material.clone();
              console.log(playerData.color);
              if (child.material.name === 'hammer_head') {
                child.material.color.setHex(parseInt(playerData.color.replace("#", "0x"))); 
              }
            }
            
            // 그림자 설정
            child.castShadow = true;
            child.receiveShadow = true;

            // 투명도 설정
            child.material.transparent = true;
          }
        });
        
        // GLB 모델의 애니메이션 믹서 설정
        if (model.animations) {
          
          let animationClips = [];
          
          // 배열인 경우와 객체인 경우 모두 처리
          if (Array.isArray(model.animations)) {
            animationClips = model.animations;
          } else if (typeof model.animations === 'object') {
            // 객체인 경우 values()를 사용하여 배열로 변환
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
            
            // 기본 idle 애니메이션 시작 (있는 경우)
            if (playerMesh.animations && playerMesh.animations['idle']) {
              playerMesh.currentAction = playerMesh.animations['idle'];
              playerMesh.currentAction.play();
            }
          }
        }
      }
      
      this.scene.add(playerMesh);
      this.playerMeshes.set(playerId, playerMesh);
      
      // 현재 플레이어인 경우 할로(링) 추가
      if (playerId === stateManager.getClientId()) {
        this.createPlayerHalo(playerId, playerData.color);
      }
      
      // 초기 위치 설정 (첫 생성 시에는 바로 설정)
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

    // 플레이어 목표 위치를 맵 경계 내로 제한하여 저장
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
    // GLB 모델이 아니거나 애니메이션이 없으면 무시
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
      
      // 특정 애니메이션은 한 번만 재생
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
    
    // 링 지오메트리 생성 (내부 반지름, 외부 반지름, 세그먼트)
    const haloGeometry = new THREE.RingGeometry(2, 2.4, 32);
    
    // 색상 파싱을 안전하게 처리
    let colorHex;
    try {
      colorHex = parseInt(playerColor.replace("#", "0x"));
      if (isNaN(colorHex)) {
        colorHex = 0xffffff; // 기본 흰색
      }
    } catch (e) {
      colorHex = 0xffffff; // 기본 흰색
    }
    
    // 할로 재질 생성 - MeshBasicMaterial로 단순하게
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide
    });
    
    const haloMesh = new THREE.Mesh(haloGeometry, haloMaterial);
    
    // 할로를 바닥에 위치시키고 수평으로 배치
    haloMesh.rotation.x = -Math.PI / 2; // 90도 회전하여 바닥에 평행하게
    haloMesh.position.y = 0.1; // 바닥보다 살짝 위에
    
    // 애니메이션을 위한 초기값 설정
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
    const currentPlayerIdsFromServer = new Set(playersData.map((p) => p.id));
    
    // 서버에서 오지 않은 플레이어 메시 제거
    this.playerMeshes.forEach((mesh, id) => {
      if (!currentPlayerIdsFromServer.has(id)) {
        this.scene.remove(mesh);
        
        // 애니메이션 믹서 정리
        if (mesh.mixer && typeof mesh.mixer.stopAllAction === 'function') {
          mesh.mixer.stopAllAction();
          mesh.mixer = null;
        }
        
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) mesh.material.dispose();
        this.playerMeshes.delete(id);
        
        // 목표 위치 데이터도 제거
        this.playerTargetPositions.delete(id);
        
        // 오버레이도 제거
        this.removePlayerOverlay(id);
        
        // 할로도 제거
        this.removePlayerHalo(id);
      }
    });

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
    const flashInterval = 0.25; // 0.25초 깜빡임 간격

    // 공격 종료 체크
    this.checkAttackEnd();

    // 모든 플레이어에 대한 업데이트를 한 번의 루프로 처리
    stateManager.getAllPlayers().forEach((player) => {
      const mesh = this.playerMeshes.get(player.id);
      if (!mesh) return;

      // 1. 플레이어 위치 및 회전 Lerp 적용
      const targetPos = this.playerTargetPositions.get(player.id);
      if (targetPos) {
        mesh.position.lerp(targetPos, this.lerpSpeed);
        
        const targetYaw = (player.id === stateManager.getClientId()) 
                          ? stateManager.getPlayerYaw() 
                          : targetPos.yaw;
        mesh.rotation.y = this.lerpAngle(mesh.rotation.y, targetYaw, this.lerpSpeed);
      }
      
      // 2. 애니메이션 믹서 업데이트
      if (mesh.mixer) {
        const clampedDeltaTime = Math.min(deltaTime, 0.033);
        mesh.mixer.update(clampedDeltaTime);
      }

      // 2.5. 할로 위치 및 애니메이션 업데이트
      const halo = this.playerHalos.get(player.id);
      if (halo && halo.material && halo.userData) {
        // 할로를 플레이어 위치에 맞춰 이동
        halo.position.x = mesh.position.x;
        halo.position.z = mesh.position.z;
        
        // 펄스 애니메이션
        halo.userData.pulseTime += deltaTime * 2; // 펄스 속도
        // 투명도 펄스
        const pulseOpacity = halo.userData.originalOpacity + Math.sin(halo.userData.pulseTime * 2) * 0.3;
        halo.material.opacity = Math.max(0.2, Math.min(0.8, pulseOpacity));
        
      }

      // 3. 무적 상태 깜빡임 효과 처리
      // 플레이어별 깜빡임 상태를 가져오거나 초기화
      if (!this.invincibleFlashState.has(player.id)) {
        this.invincibleFlashState.set(player.id, { timer: 0, isWhite: false });
      }
      const flashState = this.invincibleFlashState.get(player.id);
      let targetEmissive = 0x000000; // 기본 emissive 색상

      if (player.is_invincible) {
        flashState.timer += deltaTime;
        if (flashState.timer >= flashInterval) {
          flashState.isWhite = !flashState.isWhite; // 상태 반전
          flashState.timer %= flashInterval;      // 타이머를 간격 내로 유지
        }
        if (flashState.isWhite) {
          targetEmissive = 0x444444;
        }
      } else {
        // 무적이 아니면 상태 초기화
        flashState.timer = 0;
        flashState.isWhite = false;
      }
      
      // 재질(material) 업데이트s
      mesh.traverse((child) => {
        if (child.isMesh && child.material) {
          // emissive 색상이 목표 색상과 다를 때만 업데이트
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
        meshPosition.y += 8; // 캐릭터 머리 위
        const screenPosition = meshPosition.project(this.camera);
        const x = (screenPosition.x * 0.5 + 0.5) * window.innerWidth;
        const y = (screenPosition.y * -0.5 + 0.5) * window.innerHeight;
        overlayData.element.style.left = `${x}px`;
        overlayData.element.style.top = `${y}px`;
      }
    });
    

    this.renderer.render(this.scene, this.camera);
  }

  // Linear interpolation 함수
  lerp(start, end, factor) {
    return start + (end - start) * factor;
  }

  // 각도 interpolation 함수 (순환 특성 고려)
  lerpAngle(start, end, factor) {
    let diff = end - start;
    
    // 각도 차이가 π보다 크면 반대 방향으로 회전
    if (diff > Math.PI) {
      diff -= 2 * Math.PI;
    } else if (diff < -Math.PI) {
      diff += 2 * Math.PI;
    }
    
    return start + diff * factor;
  }

  handleCanvasMouseMove(event) {
    if (uiManager.mainUiContainer.classList.contains("hidden") &&
        this.scene && this.camera && this.gameFloor && stateManager.getClientId()) {
      
      const canvasBounds = this.renderer.domElement.getBoundingClientRect();

      this.mouse.x = ((event.clientX - canvasBounds.left) / canvasBounds.width) * 2 - 1;
      this.mouse.y = -((event.clientY - canvasBounds.top) / canvasBounds.height) * 2 + 1;

      // 공격 중에는 회전하지 않음 (1초간)
      const now = Date.now();
      if (now - this.lastAttackTime < 500) {
        // 커스텀 크로스헤어 위치만 업데이트
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
          // 바닥과 교차하는 경우 그 지점을 사용
          intersectionPoint = intersects[0].point;
        } else {
          // 바닥 밖을 마우스가 지날 때도 가상의 평면과의 교차점 계산
          const planeY = this.gameFloor.position.y;
          const rayOrigin = this.camera.position;
          const rayDirection = new THREE.Vector3(this.mouse.x, this.mouse.y, 0.5).unproject(this.camera).sub(rayOrigin).normalize();
          
          // y = planeY 평면과의 교차점 계산
          const t = (planeY - rayOrigin.y) / rayDirection.y;
          intersectionPoint = rayOrigin.clone().add(rayDirection.multiplyScalar(t));
        }

        const dx = intersectionPoint.x - myMesh.position.x;
        const dz = intersectionPoint.z - myMesh.position.z;
        const newYaw = Math.atan2(dx, dz);

        // 유의미한 변화가 있을 때만 업데이트 (최단 경로 고려)
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

      // 커스텀 크로스헤어 위치 업데이트
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
      this.playerTargetPositions.clear(); // 목표 위치 데이터도 정리

      // 플레이어 오버레이 정리
      this.playerOverlays.forEach((overlayData) => {
        overlayData.element.remove();
      });
      this.playerOverlays.clear();

      // 플레이어 할로 정리
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
    const attackDuration = 500; // 1초
    
    // 공격이 진행 중이고 이제 끝났을 때
    if (this.lastAttackTime > 0 && !this.hasAttackEnded && now - this.lastAttackTime >= attackDuration) {
      this.hasAttackEnded = true;
      
      // 현재 키보드 상태를 서버에 전송
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

    // 체력바 컨테이너
    const healthBarContainer = document.createElement("div");
    healthBarContainer.className = "player-health-bar";

    // 체력바 채우기
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

    // 체력에 따른 색상 변경
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