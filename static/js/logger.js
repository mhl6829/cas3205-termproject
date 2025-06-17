/**
 * 로그 관리 및 연결 상태 표시 모듈
 */
class Logger {
  constructor() {
    this.logMessagesEl = document.getElementById("log-messages");
    this.toggleLogButton = document.getElementById("toggle-log-button");
    this.closeLogButton = document.getElementById("close-log-button");
    this.logPanel = document.getElementById("log-panel");
    this.connectionStatusWrapper = document.getElementById("connection-status-indicator");
    this.connectionStatusEl = document.getElementById("connection-status");
    this.connectionStatusDot = document.getElementById("connection-status-dot");
    
    this.initEventListeners();
  }

  initEventListeners() {
    this.toggleLogButton.addEventListener("click", () => {
      this.logPanel.classList.toggle("hidden");
      if (!this.logPanel.classList.contains("hidden")) {
        this.logMessagesEl.scrollTop = this.logMessagesEl.scrollHeight;
        // 로그 패널 열릴 때 마우스 커서 보이게 하기
        this.previousCursorStyle = document.body.style.cursor;
        document.body.style.cursor = "default";
      } else {
        // 로그 패널이 닫힐 때 이전 커서 상태로 복원
        if (this.previousCursorStyle !== undefined) {
          document.body.style.cursor = this.previousCursorStyle;
        }
      }
    });

    this.closeLogButton.addEventListener("click", () => {
      this.logPanel.classList.add("hidden");
      // 로그 패널이 닫힐 때 이전 커서 상태로 복원
      if (this.previousCursorStyle !== undefined) {
        document.body.style.cursor = this.previousCursorStyle;
      }
    });
  }

  logMessage(message, type = "info") {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement("div");
    
    if (type === "error") {
      logEntry.innerHTML = `<span class="text-red-400">[${timestamp}] ${message}</span>`;
    } else if (type === "success") {
      logEntry.innerHTML = `<span class="text-green-400">[${timestamp}] ${message}</span>`;
    } else {
      logEntry.innerHTML = `<span class="text-slate-400">[${timestamp}]</span> ${message}`;
    }
    
    this.logMessagesEl.appendChild(logEntry);
    this.logMessagesEl.scrollTop = this.logMessagesEl.scrollHeight;
  }
  
  updateConnectionStatus(message, success = true) {
    this.connectionStatusEl.textContent = `${message}`;
    
    if (success) {
      this.connectionStatusDot.classList.remove(
        "bg-gray-500",
        "bg-red-500",
      );
      this.connectionStatusDot.classList.add("bg-green-500");
    } else if (message === "연결 끊김." || message.includes("오류")) {
      this.connectionStatusDot.classList.remove(
        "bg-gray-500",
        "bg-green-500",
      );
      this.connectionStatusDot.classList.add("bg-red-500");
    } else {
      this.connectionStatusDot.classList.remove("bg-red-500", "bg-green-500");
      this.connectionStatusDot.classList.add("bg-gray-500", "animate-pulse");
    }
  }
}

// 전역 인스턴스 생성
const logger = new Logger();
window.logger = logger;

export { Logger, logger }; 