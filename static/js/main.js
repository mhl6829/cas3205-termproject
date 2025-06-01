/**
 * 메인 진입점 - 앱 초기화
 */
document.addEventListener("DOMContentLoaded", async () => {
  // 에셋 로드
  try {
    await window.assetManager.loadAllAssets();
  } catch (error) {
    console.error('에셋 로딩 실패:', error);
    // 에셋 로딩 실패해도 게임은 진행 (기본 큐브 사용)
  }
  
  // 입력 핸들러 초기화
  window.inputHandler = new InputHandler();
  
  // 초기 UI 설정
  window.uiManager.showMainUISection(window.uiManager.initialSetupSection);
  
  console.log("앱 초기화 완료!");
}); 