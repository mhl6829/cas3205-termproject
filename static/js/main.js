import { assetManager } from './asset-manager.js';
import { uiManager } from './ui-manager.js';
import { InputHandler } from './input-handler.js';
import { characterPreview } from './character-preview.js';

/**
 * 메인 진입점 - 앱 초기화
 */
document.addEventListener("DOMContentLoaded", async () => {
  // 에셋 로드
  try {
    await assetManager.loadAllAssets();
  } catch (error) {
    console.error('에셋 로딩 실패:', error);
    alert('에셋 로딩 실패!');
    return
  }
  
  // 입력 핸들러 초기화
  window.inputHandler = new InputHandler();
  
  // 초기 UI 설정
  characterPreview.init();
  uiManager.showMainUISection(uiManager.initialSetupSection);
  
  console.log("앱 초기화 완료!");
}); 