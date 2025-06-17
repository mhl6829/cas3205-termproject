/**
 * 키보드 및 마우스 입력 처리 모듈
 */
class InputHandler {
  constructor() {
    this.initEventListeners();
  }

  initEventListeners() {
    // 전역 이벤트 리스너
    document.addEventListener("keydown", this.handleKeyDown.bind(this));
    document.addEventListener("keyup", this.handleKeyUp.bind(this));
  }

  // 키 입력 표준화
  normalizeKey(event) {
    const code = event.code;
    if (code === "KeyW") return "w";
    if (code === "KeyA") return "a";
    if (code === "KeyS") return "s";
    if (code === "KeyD") return "d";
    if (code === "ArrowUp") return "arrowup";
    if (code === "ArrowDown") return "arrowdown";
    if (code === "ArrowLeft") return "arrowleft";
    if (code === "ArrowRight") return "arrowright";
    
    // 한글 키보드 지원을 위한 fallback
    const key = event.key.toLowerCase();
    
    // 한글 키보드에서 WASD 키 매핑
    if (key === "ㅈ") return "w";
    if (key === "ㅁ") return "a";
    if (key === "ㄴ") return "s";
    if (key === "ㅇ") return "d";
    
    // 기본 영어 키 및 화살표 키
    if (key === "w" || key === "a" || key === "s" || key === "d" ||
        key === "arrowup" || key === "arrowdown" || key === "arrowleft" || key === "arrowright") {
      return key;
    }
    
    return null;
  }

  handleKeyDown(event) {
    // 게임 중이고, 입력 필드에 포커스가 없을 때만 처리
    if (uiManager.mainUiContainer.classList.contains("hidden") &&
        document.activeElement.tagName !== "INPUT" &&
        document.activeElement.tagName !== "TEXTAREA") {
      
      let stateChanged = false;
      const normalizedKey = this.normalizeKey(event);
      
      if (normalizedKey === "w" || normalizedKey === "arrowup") {
        if (!stateManager.isKeyPressed("forward")) {
          stateManager.setKeyboardState("forward", true);
          stateChanged = true;
        }
      } else if (normalizedKey === "s" || normalizedKey === "arrowdown") {
        if (!stateManager.isKeyPressed("backward")) {
          stateManager.setKeyboardState("backward", true);
          stateChanged = true;
        }
      } else if (normalizedKey === "a" || normalizedKey === "arrowleft") {
        if (!stateManager.isKeyPressed("left")) {
          stateManager.setKeyboardState("left", true);
          stateChanged = true;
        }
      } else if (normalizedKey === "d" || normalizedKey === "arrowright") {
        if (!stateManager.isKeyPressed("right")) {
          stateManager.setKeyboardState("right", true);
          stateChanged = true;
        }
      } else {
        return;
      }

      if (stateChanged) {
        this.sendMovementInput();
      }
      event.preventDefault();
    }
  }

  handleKeyUp(event) {
    // 게임 중일 때만 처리
    if (uiManager.mainUiContainer.classList.contains("hidden")) {
      let stateChanged = false;
      const normalizedKey = this.normalizeKey(event);
      
      if (normalizedKey === "w" || normalizedKey === "arrowup") {
        if (stateManager.isKeyPressed("forward")) {
          stateManager.setKeyboardState("forward", false);
          stateChanged = true;
        }
      } else if (normalizedKey === "s" || normalizedKey === "arrowdown") {
        if (stateManager.isKeyPressed("backward")) {
          stateManager.setKeyboardState("backward", false);
          stateChanged = true;
        }
      } else if (normalizedKey === "a" || normalizedKey === "arrowleft") {
        if (stateManager.isKeyPressed("left")) {
          stateManager.setKeyboardState("left", false);
          stateChanged = true;
        }
      } else if (normalizedKey === "d" || normalizedKey === "arrowright") {
        if (stateManager.isKeyPressed("right")) {
          stateManager.setKeyboardState("right", false);
          stateChanged = true;
        }
      } else {
        return;
      }

      if (stateChanged) {
        this.sendMovementInput();
      }
      event.preventDefault();
    }
  }

  sendMovementInput() {
    const keyboardState = stateManager.getKeyboardState();
    const moveData = {
      forward: keyboardState.forward ? 1 : 0,
      backward: keyboardState.backward ? 1 : 0,
      left: keyboardState.left ? 1 : 0,
      right: keyboardState.right ? 1 : 0,
    };
    
    window.websocketManager.sendMessage("player_action", {
      action_type: "move",
      data: moveData,
    });
  }
}

// 전역 인스턴스 생성
const inputHandler = new InputHandler();
window.inputHandler = inputHandler;

export { InputHandler }; 