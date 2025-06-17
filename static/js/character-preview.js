import * as THREE from 'three';

/**
 * 캐릭터 미리보기 모듈
 */
class CharacterPreview {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.currentModel = null;
    this.mixer = null;
    this.clock = new THREE.Clock();
    this.animationId = null;
    this.currentCharacter = 'onion';
  }

  /**
   * 미리보기 초기화
   */
  init() {    
    // Three.js 씬 초기화
    this.initScene();
    
    // 이벤트 리스너 등록
    this.setupEventListeners();
    
    // 기본 캐릭터 로드
    this.loadCharacter(this.currentCharacter);
    
    // 애니메이션 루프 시작
    this.animate();
  }

  /**
   * Three.js 씬 초기화
   */
  initScene() {
    // Scene 생성
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xffffff);
    
    // Camera 설정
    this.camera = new THREE.PerspectiveCamera(
      50,
      1,
      0.1,
      1000
    );
    this.camera.position.set(0, 3, 5);
    this.camera.lookAt(0, 2, 0);
    
    // Renderer 설정
    const canvas = document.getElementById('character-preview-canvas');
    this.renderer = new THREE.WebGLRenderer({ 
      canvas: canvas,
      antialias: true,
      alpha: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(300, 300);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    
    // 조명 설정
    const ambientLight = new THREE.AmbientLight(0xffffff, 1);
    this.scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
    directionalLight.position.set(5, 5, 5);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 512;
    directionalLight.shadow.mapSize.height = 512;
    directionalLight.shadow.bias = -0.005;
    this.scene.add(directionalLight);
    
  }

  /**
   * 캐릭터 모델 로드
   */
  loadCharacter(characterName) {
    // 기존 모델 제거
    if (this.currentModel) {
      this.scene.remove(this.currentModel);
      if (this.mixer) {
        this.mixer.stopAllAction();
        this.mixer = null;
      }
    }
    
    // 새 모델 로드
    const modelName = `${characterName}.glb`;
    const model = window.assetManager.createInstance(modelName);
    
    if (model) {
      this.currentModel = model;
      this.currentModel.scale.set(1, 1, 1);
      this.currentModel.position.set(0, 0, 0);
      
      // 그림자 설정
      this.currentModel.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          
          // 현재 선택된 색상 적용
          if (child.material && child.material.name === 'hammer_head') {
            child.material = child.material.clone();
            const colorInput = document.getElementById('color');
            if (colorInput && colorInput.value) {
              child.material.color.setHex(parseInt(colorInput.value.replace("#", "0x")));
            }
          }
        }
      });
      
      // 애니메이션 설정
      if (model.animations && model.animations.length > 0) {
        this.mixer = new THREE.AnimationMixer(model);
        
        // idle 애니메이션
        const idleAnimation = model.animations.find(clip => clip.name === 'idle') || model.animations[0];
        if (idleAnimation) {
          const action = this.mixer.clipAction(idleAnimation);
          action.play();
        }
      }
      
      this.scene.add(this.currentModel);
      this.currentCharacter = characterName;
    }
  }

  /**
   * 이벤트 리스너 설정
   */
  setupEventListeners() {
    // 캐릭터 선택 버튼 이벤트
    const characterButtons = document.querySelectorAll('.character-option');
    characterButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        const character = button.getAttribute('data-character');
        this.loadCharacter(character);
      });
    });
    
    // 색상 선택 이벤트
    const colorButtons = document.querySelectorAll('.color-option');
    colorButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        const color = button.getAttribute('data-color');
        this.updateCharacterColor(color);
      });
    });
  }

  /**
   * 캐릭터 색상 업데이트
   */
  updateCharacterColor(color) {
    if (this.currentModel) {
      this.currentModel.traverse((child) => {
        if (child.isMesh && child.material && child.material.name === 'hammer_head') {
          child.material.color.setHex(parseInt(color.replace("#", "0x")));
        }
      });
    }
  }

  /**
   * 애니메이션 루프
   */
  animate() {
    this.animationId = requestAnimationFrame(this.animate.bind(this));
    
    const delta = this.clock.getDelta();
    
    // 애니메이션 업데이트
    if (this.mixer) {
      this.mixer.update(delta);
    }
    
    // 모델 회전 (미리보기 효과)
    if (this.currentModel) {
      this.currentModel.rotation.y += delta * 0.5;
    }
    
    // 렌더링
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * 정리
   */
  dispose() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    
    if (this.mixer) {
      this.mixer.stopAllAction();
    }
    
    if (this.renderer) {
      this.renderer.dispose();
    }
    
  }
}

// 전역 인스턴스 생성
const characterPreview = new CharacterPreview();
window.characterPreview = characterPreview;

export { characterPreview }; 