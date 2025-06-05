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
    this.bulletMeshes = new Map(); // 총알 메시들
    this.playerOverlays = new Map(); // 플레이어 오버레이 (체력바, 닉네임)
    this.animationFrameId = null;
    this.mouse = new THREE.Vector2();
    
    // Interpolation을 위한 변수들
    this.playerTargetPositions = new Map(); // 플레이어별 목표 위치
    this.bulletTargetPositions = new Map(); // 총알별 목표 위치
    this.lerpSpeed = 0.2; // 플레이어 lerp 속도 (0.1 ~ 0.3 사이가 적당)
    this.bulletLerpSpeed = 0.4; // 총알 lerp 속도 (빠르게 움직이므로 더 높게)
    
    // 맵 설정 (화면에 맞는 크기로 조정)
    this.MAP_SIZE = 40; // 40x40으로 축소
    this.MAP_BOUNDARY = this.MAP_SIZE / 2; // ±20 범위
    
    // 공격 상태 추적
    this.lastAttackTime = 0; // 마지막 공격 시간
    this.hasAttackEnded = false; // 공격이 끝났는지 추적
    
    // 성능 최적화를 위한 시간 추적
    this.lastFrameTime = 0;
    this.clock = new THREE.Clock();
  }

  initThreeJS() {
    if (this.scene) return;

    this.scene = new THREE.Scene();
    // 밝고 귀여운 하늘 파스텔 배경색으로 변경
    this.scene.background = new THREE.Color(0xF8FAFC); // 매우 밝은 블루그레이
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


    this.renderer.outputColorSpace = THREE.SRGBColorSpace; // 또는 이전 버전: renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; // 다양한 톤 매핑 옵션 시도 가능 (Linear, Reinhard 등)
    this.renderer.toneMappingExposure = 1.2; // 노출 값. 0.5 ~ 2.0 사이에서 조절해보세요.
    
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
    } else {
      // map.glb 로드 실패 시 기본 plane 사용 (fallback)
      const floorGeometry = new THREE.PlaneGeometry(this.MAP_SIZE, this.MAP_SIZE, 10, 10);
      const floorMaterial = new THREE.MeshStandardMaterial({ 
        color: 0xFCE7F3, // 밝은 핑크
        roughness: 0.8,
        metalness: 0.1,
        flatShading: true
      });
      this.gameFloor = new THREE.Mesh(floorGeometry, floorMaterial);
      this.gameFloor.rotation.x = -Math.PI / 2;
      this.gameFloor.position.y = 0;
      this.gameFloor.receiveShadow = true; // 바닥이 그림자를 받도록 설정
      this.scene.add(this.gameFloor);
    }


    // 기존 플레이어들의 메시 생성
    this.playerMeshes.clear();
    this.bulletMeshes.clear();
    stateManager.getAllPlayers().forEach((playerInfo) => {
      this.createOrUpdatePlayerMesh(playerInfo.id, playerInfo.color, {
        x: 0, y: 0, z: 0, score: 0, yaw: 0, pitch: 0
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
          
          // 서버에 망치 공격 요청 (기존: 총 발사 요청)
          window.websocketManager.sendMessage("player_action", {
            action_type: "click", // 기존: "shoot"에서 "click"으로 변경
            data: {
              direction: direction,
              start_position: {
                x: playerPos.x,
                z: playerPos.z
              }
            }
          });
          
          // 공격 시간 기록 (클라이언트에서도 회전 제한용)
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

  createOrUpdatePlayerMesh(playerId, playerColor, playerData) {
    let playerMesh = this.playerMeshes.get(playerId);
    const CUBE_SIZE = 2;
    
    if (!playerMesh) {
      // asset 정보가 있고 로드된 경우 GLB 모델 사용, 없으면 기본 큐브 사용
      const assetName = playerData.asset || 'onion.glb';
      const model = window.assetManager.createInstance(assetName);
      
      if (model) {
        // GLB 모델 사용
        playerMesh = model;
        
        // 모델 크기 조정 (bunny 모델에 맞게 스케일 조정)
        playerMesh.scale.set(2, 2, 2); // 필요에 따라 조정
        
        // 모델의 모든 메시에 색상 적용
        playerMesh.traverse((child) => {
          if (child.isMesh) {
            // 기존 재질의 색상 변경
            /*
            if (child.material) {
              // 재질 복제 (다른 플레이어와 재질 공유 방지)
              child.material = child.material.clone();
              child.material.color = new THREE.Color(playerColor);
            }
              */
            
            // 그림자 설정
            child.castShadow = true;
            child.receiveShadow = true;
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

            console.log(playerMesh.animations)
            
            // 기본 idle 애니메이션 시작 (있는 경우)
            if (playerMesh.animations && playerMesh.animations['idle']) {
              playerMesh.currentAction = playerMesh.animations['idle'];
              playerMesh.currentAction.play();
            }
          }
        }
      } else {
        // GLB 로드 실패 시 기본 큐브 사용
        const geometry = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
        const material = new THREE.MeshStandardMaterial({ color: playerColor });
        playerMesh = new THREE.Mesh(geometry, material);
        
        // 그림자 설정
        playerMesh.castShadow = true;
        playerMesh.receiveShadow = true;
      }
      
      this.scene.add(playerMesh);
      this.playerMeshes.set(playerId, playerMesh);
      
      // 초기 위치 설정 (첫 생성 시에는 바로 설정)
      const clampedX = Math.max(-this.MAP_BOUNDARY + 1, Math.min(this.MAP_BOUNDARY - 1, playerData.x));
      const clampedZ = Math.max(-this.MAP_BOUNDARY + 1, Math.min(this.MAP_BOUNDARY - 1, playerData.z));
      
      const yPosition = model ? 0 : (CUBE_SIZE / 2 + this.gameFloor.position.y);
      
      playerMesh.position.set(
        clampedX,
        yPosition,
        clampedZ
      );
    }

    // 죽은 플레이어는 화면에서 숨기기 (자기 자신 포함)
    if (playerData.is_alive === false) {
      playerMesh.visible = false;
      // 죽은 플레이어의 목표 위치는 업데이트하지 않음
      // 단, 자기 자신이면 카메라는 계속 따라가도록 위치는 업데이트
      if (playerId !== stateManager.getClientId()) {
        return;
      }
    } else {
      playerMesh.visible = true;
    }

    // 애니메이션 클립 처리
    this.handlePlayerAnimation(playerMesh, playerData.current_animation);

    // 플레이어 목표 위치를 맵 경계 내로 제한하여 저장
    const clampedX = Math.max(-this.MAP_BOUNDARY + 1, Math.min(this.MAP_BOUNDARY - 1, playerData.x));
    const clampedZ = Math.max(-this.MAP_BOUNDARY + 1, Math.min(this.MAP_BOUNDARY - 1, playerData.z));
    
    // GLB 모델인지 큐브인지에 따라 Y 위치 조정
    const isGLBModel = playerData.asset && window.assetManager.getAsset(playerData.asset);
    const yPosition = isGLBModel ? 0 : (CUBE_SIZE / 2 + this.gameFloor.position.y);
    
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

    if (playerMesh.currentAnimationName === animationName) {
      return;
    }

    // idle시 일단 정지
    if (playerMesh.currentAction && animationName === 'idle') {
      playerMesh.currentAction.stop();
      playerMesh.currentAnimationName = 'idle';
      return;
    }

    // 이전 애니메이션 정지
    if (playerMesh.currentAction) {
      playerMesh.currentAction.fadeOut(0.1); // 더 빠른 전환
    }

    // 새 애니메이션 재생
    if (playerMesh.animations[animationName]) {
      playerMesh.currentAction = playerMesh.animations[animationName];
      playerMesh.currentAction.reset().fadeIn(0.1).play(); // 더 빠른 전환
      playerMesh.currentAnimationName = animationName;
      
      // 특정 애니메이션은 한 번만 재생
      if (['hammer_attack', 'death', 'respawn'].includes(animationName)) {
        playerMesh.currentAction.setLoop(THREE.LoopOnce);
        playerMesh.currentAction.clampWhenFinished = false; // 끝나면 초기화되도록 변경
        
        // 애니메이션 종료 이벤트 리스너 추가
        const onFinished = () => {
          playerMesh.currentAnimationName = null; // 애니메이션 이름 초기화
          playerMesh.currentAction.getMixer().removeEventListener('finished', onFinished);
          
          // idle 애니메이션으로 전환 (있는 경우)
          if (playerMesh.animations['idle'] && animationName !== 'death') {
            playerMesh.currentAction = playerMesh.animations['idle'];
            playerMesh.currentAction.reset().play();
            playerMesh.currentAnimationName = 'idle';
            playerMesh.currentAction.setLoop(THREE.LoopRepeat);
          }
        };
        
        playerMesh.currentAction.getMixer().addEventListener('finished', onFinished);
      } else {
        playerMesh.currentAction.setLoop(THREE.LoopRepeat);
      }
      
      console.log(`Playing animation: ${animationName} for player`);
    }
  }

  createOrUpdateBulletMesh(bulletId, bulletData) {
    let bulletMesh = this.bulletMeshes.get(bulletId);
    
    if (!bulletMesh) {
      // 총알을 sphere로 생성
      const geometry = new THREE.SphereGeometry(0.5, 16, 16);
      const bulletColor = bulletData.color || '#FFFFFF'; // 서버에서 오는 색상 사용, 기본값은 흰색
      const material = new THREE.MeshStandardMaterial({ 
        color: bulletColor,
      });
      bulletMesh = new THREE.Mesh(geometry, material);
      
      // 총알도 그림자 생성
      bulletMesh.castShadow = true;
      
      this.scene.add(bulletMesh);
      this.bulletMeshes.set(bulletId, bulletMesh);
      
      // 초기 위치 설정 (첫 생성 시에는 바로 설정)
      bulletMesh.position.set(
        bulletData.x,
        1, // 지면 위 1 단위
        bulletData.z
      );
    }

    // 총알 목표 위치 저장 (lerp에서 사용)
    this.bulletTargetPositions.set(bulletId, {
      x: bulletData.x,
      y: 1, // 지면 위 1 단위
      z: bulletData.z
    });
  }

  removeBulletMesh(bulletId) {
    const bulletMesh = this.bulletMeshes.get(bulletId);
    if (bulletMesh) {
      this.scene.remove(bulletMesh);
      if (bulletMesh.geometry) bulletMesh.geometry.dispose();
      if (bulletMesh.material) bulletMesh.material.dispose();
      this.bulletMeshes.delete(bulletId);
      
      // 총알 목표 위치 데이터도 제거
      this.bulletTargetPositions.delete(bulletId);
    }
  }

  updatePlayerMeshes(playersData) {
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
      }
    });

    // 플레이어 메시 업데이트
    playersData.forEach((pData) => {
      const playerInfo = stateManager.getPlayer(pData.id);
      if (playerInfo) {
        this.createOrUpdatePlayerMesh(pData.id, playerInfo.color, pData);
        this.updatePlayerOverlay(pData.id, pData, playerInfo);
      } else {
        // 플레이어 정보가 아직 없을 경우 기본 색상으로 생성
        this.createOrUpdatePlayerMesh(pData.id, "#CCCCCC", pData);
        this.updatePlayerOverlay(pData.id, pData, { nickname: pData.id.substring(0, 6), color: "#CCCCCC" });
      }
    });
  }

  updateBulletMeshes(bulletsData) {
    if (!bulletsData) {
      // 총알 데이터가 없으면 모든 총알 제거
      this.bulletMeshes.forEach((mesh, id) => {
        this.removeBulletMesh(id);
      });
      return;
    }
    
    const currentBulletIdsFromServer = new Set(bulletsData.map((b) => b.id));
    
    // 서버에서 오지 않은 총알 메시 제거
    this.bulletMeshes.forEach((mesh, id) => {
      if (!currentBulletIdsFromServer.has(id)) {
        this.removeBulletMesh(id);
      }
    });

    // 총알 메시 업데이트
    bulletsData.forEach((bData) => {
      this.createOrUpdateBulletMesh(bData.id, bData);
    });
  }

  animateThreeJS() {
    this.animationFrameId = requestAnimationFrame(this.animateThreeJS.bind(this));
    
    if (!this.renderer || !this.scene || !this.camera) return;

    const deltaTime = this.clock.getDelta();
    
    // 공격 종료 체크
    this.checkAttackEnd();

    // 플레이어 위치 interpolation (lerp) 적용
    this.playerMeshes.forEach((mesh, playerId) => {
      const targetPos = this.playerTargetPositions.get(playerId);
      if (targetPos) {
        // 위치 lerp
        mesh.position.x = this.lerp(mesh.position.x, targetPos.x, this.lerpSpeed);
        mesh.position.y = this.lerp(mesh.position.y, targetPos.y, this.lerpSpeed);
        mesh.position.z = this.lerp(mesh.position.z, targetPos.z, this.lerpSpeed);
        
        // 회전 lerp (자신의 플레이어는 마우스 입력을 즉시 반영)
        if (playerId === stateManager.getClientId()) {
          mesh.rotation.y = stateManager.getPlayerYaw();
        } else {
          mesh.rotation.y = this.lerpAngle(mesh.rotation.y, targetPos.yaw, this.lerpSpeed);
        }
      }
      
      // 애니메이션 믹서 업데이트 (끊김 방지를 위해 deltaTime 조정)
      if (mesh.mixer && typeof mesh.mixer.update === 'function') {
        // deltaTime을 안정적인 범위로 제한 (끊김 방지)
        const clampedDeltaTime = Math.min(Math.max(deltaTime, 0.001), 0.033); // 1ms ~ 33ms (30fps 최소)
        mesh.mixer.update(clampedDeltaTime);
      }
    });

    // 총알 위치 interpolation (lerp) 적용
    this.bulletMeshes.forEach((mesh, bulletId) => {
      const targetPos = this.bulletTargetPositions.get(bulletId);
      if (targetPos) {
        // 총알 위치 lerp (빠른 속도로)
        mesh.position.x = this.lerp(mesh.position.x, targetPos.x, this.bulletLerpSpeed);
        mesh.position.y = this.lerp(mesh.position.y, targetPos.y, this.bulletLerpSpeed);
        mesh.position.z = this.lerp(mesh.position.z, targetPos.z, this.bulletLerpSpeed);
      }
    });

    // 플레이어 오버레이 위치 업데이트
    this.playerOverlays.forEach((overlayData, playerId) => {
      const mesh = this.playerMeshes.get(playerId);
      if (mesh && this.camera) {
        // 3D 위치를 2D 스크린 좌표로 변환
        const meshPosition = mesh.position.clone();
        meshPosition.y += 8; // 캐릭터 머리 위로 올리기

        const screenPosition = meshPosition.project(this.camera);
        const x = (screenPosition.x * 0.5 + 0.5) * window.innerWidth;
        const y = (screenPosition.y * -0.5 + 0.5) * window.innerHeight;

        // 화면 범위 체크
        if (screenPosition.z > 1 || x < 0 || x > window.innerWidth || y < 0 || y > window.innerHeight) {
          overlayData.element.style.display = "none";
        } else {
          overlayData.element.style.left = `${x}px`;
          overlayData.element.style.top = `${y}px`;
        }
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
      if (now - this.lastAttackTime < 1000) {
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

        // 유의미한 변화가 있을 때만 업데이트
        if (Math.abs(newYaw - stateManager.getPlayerYaw()) > 0.01) {
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

      // 총알 메시 정리
      this.bulletMeshes.forEach((mesh) => {
        this.scene.remove(mesh);
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) mesh.material.dispose();
      });
      this.bulletMeshes.clear();
      this.bulletTargetPositions.clear(); // 총알 목표 위치 데이터도 정리

      // 플레이어 오버레이 정리
      this.playerOverlays.forEach((overlayData) => {
        overlayData.element.remove();
      });
      this.playerOverlays.clear();

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
    const attackDuration = 1000; // 1초
    
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

    // 죽은 플레이어는 오버레이도 숨기기 (가장 먼저 체크)
    if (!playerData.is_alive) {
      overlayData.element.style.display = "none";
      return;
    }

    const mesh = this.playerMeshes.get(playerId);
    if (!mesh || !this.camera) {
      overlayData.element.style.display = "none";
      return;
    }

    // 살아있는 플레이어는 오버레이 표시
    overlayData.element.style.display = "block";

    // 3D 위치를 2D 스크린 좌표로 변환
    const meshPosition = mesh.position.clone();
    meshPosition.y += 3; // 캐릭터 머리 위로 올리기

    const screenPosition = meshPosition.project(this.camera);
    const x = (screenPosition.x * 0.5 + 0.5) * window.innerWidth;
    const y = (screenPosition.y * -0.5 + 0.5) * window.innerHeight;

    // 화면 범위 체크
    if (screenPosition.z > 1 || x < 0 || x > window.innerWidth || y < 0 || y > window.innerHeight) {
      overlayData.element.style.display = "none";
      return;
    }

    // 위치 업데이트
    overlayData.element.style.left = `${x}px`;
    overlayData.element.style.top = `${y}px`;

    // 체력바 업데이트
    const health = playerData.health || 3;
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
window.gameRenderer = new GameRenderer(); 