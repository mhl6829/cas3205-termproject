/**
 * GLB 에셋 로딩 및 관리 모듈
 */
class AssetManager {
  constructor() {
    this.gltfLoader = new THREE.GLTFLoader();
    this.loadedAssets = new Map(); // 로드된 에셋 저장
    this.totalAssets = 0;
    this.loadedCount = 0;
    
    // 로딩 UI 요소들
    this.loadingScreen = document.getElementById('loading-screen');
    this.loadingProgressBar = document.getElementById('loading-progress-bar');
    this.loadingStatus = document.getElementById('loading-status');
    this.loadingPercentage = document.getElementById('loading-percentage');
  }

  /**
   * assets 폴더의 모든 GLB 파일 로드
   * @returns {Promise} 모든 에셋 로드 완료 프로미스
   */
  async loadAllAssets() {
    // 로드할 에셋 목록 (실제로는 서버에서 목록을 받아올 수도 있음)
    const assetList = [
      'bunny.glb',
      'onion.glb',
      'map.glb'
      // 추가 에셋들...
    ];

    this.totalAssets = assetList.length;
    this.showLoadingScreen();

    const loadPromises = assetList.map(assetName => this.loadAsset(assetName));
    
    try {
      await Promise.all(loadPromises);
      console.log('모든 에셋 로드 완료!');
      this.hideLoadingScreen();
    } catch (error) {
      console.error('에셋 로드 중 오류 발생:', error);
      this.loadingStatus.textContent = '에셋 로드 중 오류가 발생했습니다.';
    }
  }

  /**
   * 개별 GLB 파일 로드
   * @param {string} assetName - 에셋 파일명
   * @returns {Promise} 에셋 로드 프로미스
   */
  loadAsset(assetName) {
    return new Promise((resolve, reject) => {
      const assetPath = `assets/${assetName}`;
      
      this.gltfLoader.load(
        assetPath,
        (gltf) => {
          // 로드된 모델 저장
          this.loadedAssets.set(assetName, gltf);
          this.loadedCount++;
          this.updateLoadingProgress();
          
          console.log(`에셋 로드 완료: ${assetName}`);
          resolve(gltf);
        },
        (xhr) => {
          // 개별 파일 로딩 진행률 (선택사항)
          if (xhr.lengthComputable) {
            const percentComplete = (xhr.loaded / xhr.total) * 100;
            console.log(`${assetName}: ${Math.round(percentComplete)}% 로드됨`);
          }
        },
        (error) => {
          console.error(`에셋 로드 실패: ${assetName}`, error);
          this.loadedCount++; // 실패해도 카운트 증가
          this.updateLoadingProgress();
          reject(error);
        }
      );
    });
  }

  /**
   * 로드된 에셋 가져오기
   * @param {string} assetName - 에셋 파일명
   * @returns {Object} GLTF 객체
   */
  getAsset(assetName) {
    return this.loadedAssets.get(assetName);
  }

  /**
   * 로드된 모델의 복제본 생성
   * @param {string} assetName - 에셋 파일명
   * @returns {THREE.Object3D} 복제된 3D 객체
   */
  createInstance(assetName) {
    const asset = this.getAsset(assetName);
    if (!asset) {
      console.error(`에셋을 찾을 수 없음: ${assetName}`);
      return null;
    }
    
    // 모델 복제
    const instance = asset.scene.clone();
    
    // 애니메이션이 있는 경우 복제
    if (asset.animations && Array.isArray(asset.animations) && asset.animations.length > 0) {
      instance.animations = asset.animations;
    }
    
    return instance;
  }

  /**
   * 로딩 화면 표시
   */
  showLoadingScreen() {
    this.loadingScreen.classList.remove('hidden');
    this.updateLoadingProgress();
  }

  /**
   * 로딩 화면 숨기기
   */
  hideLoadingScreen() {
    setTimeout(() => {
      this.loadingScreen.classList.add('hidden');
    }, 500); // 부드러운 전환을 위한 딜레이
  }

  /**
   * 로딩 진행률 업데이트
   */
  updateLoadingProgress() {
    const progress = this.totalAssets > 0 ? (this.loadedCount / this.totalAssets) * 100 : 0;
    
    this.loadingProgressBar.style.width = `${progress}%`;
    this.loadingPercentage.textContent = `${Math.round(progress)}%`;
    
    if (this.loadedCount === this.totalAssets) {
      this.loadingStatus.textContent = '로딩 완료!';
    } else {
      this.loadingStatus.textContent = `에셋을 불러오는 중... (${this.loadedCount}/${this.totalAssets})`;
    }
  }
}

// 전역 인스턴스 생성
window.assetManager = new AssetManager(); 