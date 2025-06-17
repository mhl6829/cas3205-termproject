import { assetManager } from './asset-manager.js';

/**
 * 메인 진입점
 */
document.addEventListener("DOMContentLoaded", async () => {
  // 로딩 완료시 콜백
  const showMainUI = () => {
    // 메인 메뉴로 이동
    uiManager.showMainUISection(uiManager.mainMenuSection);
  };
  // 에셋 로드
  try {
    await assetManager.loadAllAssets(showMainUI);
  } catch (error) {
    alert('에셋 로딩 실패!');
    return
  }
}); 