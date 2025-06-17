import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

/**
 * GLB 에셋 로딩 및 관리 모듈
 */
class AssetManager {
  constructor() {
    this.gltfLoader = new GLTFLoader();
    this.loadedAssets = new Map();
    this.totalAssets = 0;
    this.loadedCount = 0;

    this.loadingScreen = document.getElementById("loading-screen");
    this.loadingProgressBar = document.getElementById("loading-progress-bar");
    this.loadingStatus = document.getElementById("loading-status");
    this.loadingPercentage = document.getElementById("loading-percentage");
  }

  /**
   * assets 폴더의 모든 GLB 파일 로드
   * @returns {Promise}
   */
  async loadAllAssets(callback) {
    const assetList = [
      "paprika.glb",
      "onion.glb",
      "tomato.glb",
      "potato.glb",
      "map.glb",
    ];

    this.totalAssets = assetList.length;
    this.showLoadingScreen();

    const loadPromises = assetList.map((assetName) =>
      this.loadAsset(assetName)
    );

    try {
      await Promise.all(loadPromises);
      this.hideLoadingScreen(callback);
    } catch (error) {
      console.error("에셋 로드 중 오류 발생:", error);
      this.loadingStatus.textContent = "에셋 로드 중 오류가 발생했습니다.";
    }
  }

  /**
   * 개별 GLB 파일 로드
   * @param {string} assetName
   * @returns {Promise}
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
          resolve(gltf);
        },
        (xhr) => {
          // 로그용
          if (xhr.lengthComputable) {
            const percentComplete = (xhr.loaded / xhr.total) * 100;
          }
        },
        (error) => {
          console.error(`에셋 로드 실패: ${assetName}`, error);
          this.loadedCount++;
          this.updateLoadingProgress();
          reject(error);
        }
      );
    });
  }

  /**
   * 로드된 에셋 가져오기
   * @param {string} assetName
   * @returns {Object}
   */
  getAsset(assetName) {
    return this.loadedAssets.get(assetName);
  }

  /**
   * 모델 복제
   * @param {string} assetName
   * @returns {THREE.Object3D}
   */
  createInstance(assetName) {
    const asset = this.getAsset(assetName);
    if (!asset) {
      console.error(`에셋을 찾을 수 없음: ${assetName}`);
      return null;
    }

    // 모델 복제
    const instance = SkeletonUtils.clone(asset.scene);

    // 애니메이션이 복제
    if (
      asset.animations &&
      Array.isArray(asset.animations) &&
      asset.animations.length > 0
    ) {
      instance.animations = asset.animations;
    }

    instance.traverse((node) => {
      if (node.isMesh && node.material) {
        node.material = node.material.clone();
      }
    });

    return instance;
  }

  /**
   * 로딩 화면 표시
   */
  showLoadingScreen() {
    this.loadingScreen.classList.remove("hidden");
    this.updateLoadingProgress();
  }

  /**
   * 로딩 화면 숨기기
   */
  hideLoadingScreen(callback) {
    setTimeout(() => {
      this.loadingStatus.textContent = "메인 메뉴를 불러오는 중입니다...";
    }, 500);
    setTimeout(() => {
      this.loadingScreen.classList.add("hidden");
      callback();
    }, 1500);
  }

  /**
   * 로딩 진행률 업데이트
   */
  updateLoadingProgress() {
    const progress =
      this.totalAssets > 0 ? (this.loadedCount / this.totalAssets) * 100 : 0;

    this.loadingProgressBar.style.width = `${progress}%`;
    this.loadingPercentage.textContent = `${Math.round(progress)}%`;

    if (this.loadedCount === this.totalAssets) {
      this.loadingStatus.textContent = "로딩 완료!";
    } else {
      this.loadingStatus.textContent = `에셋을 불러오는 중... (${this.loadedCount}/${this.totalAssets})`;
    }
  }
}

// 전역 인스턴스 생성
const assetManager = new AssetManager();
window.assetManager = assetManager;

export { AssetManager, assetManager };
