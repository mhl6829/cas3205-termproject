/**
 * 클라이언트 상태 관리 모듈
 */
class StateManager {
  constructor() {
    // 클라이언트 상태 변수들
    this.clientId = null;
    this.currentRoomId = null;
    this.isOwner = false;
    this.isReady = false;
    this.currentPlayersMap = new Map();
    this.roomInfoFromServer = null; // 서버에서 받은 방 정보 저장용
    
    // 플레이어 입력 상태
    this.playerYaw = 0;
    this.keyboardState = {
      forward: false,
      backward: false,
      left: false,
      right: false,
    };
  }

  // Client ID 관리
  setClientId(id) {
    this.clientId = id;
  }

  getClientId() {
    return this.clientId;
  }

  // Room 관리
  setCurrentRoom(roomId) {
    this.currentRoomId = roomId;
  }

  getCurrentRoomId() {
    return this.currentRoomId;
  }

  clearCurrentRoom() {
    this.currentRoomId = null;
    this.isOwner = false;
    this.isReady = false;
    this.currentPlayersMap.clear();
    this.roomInfoFromServer = null;
  }

  // Owner 상태 관리
  setIsOwner(isOwner) {
    this.isOwner = isOwner;
  }

  getIsOwner() {
    return this.isOwner;
  }

  // Ready 상태 관리
  setIsReady(isReady) {
    this.isReady = isReady;
  }

  getIsReady() {
    return this.isReady;
  }

  toggleReady() {
    this.isReady = !this.isReady;
    return this.isReady;
  }

  // Players 관리
  addPlayer(playerId, playerInfo) {
    this.currentPlayersMap.set(playerId, playerInfo);
  }

  removePlayer(playerId) {
    this.currentPlayersMap.delete(playerId);
  }

  getPlayer(playerId) {
    return this.currentPlayersMap.get(playerId);
  }

  getAllPlayers() {
    return this.currentPlayersMap;
  }

  getPlayerCount() {
    return this.currentPlayersMap.size;
  }

  clearPlayers() {
    this.currentPlayersMap.clear();
  }

  updatePlayersFromArray(playersArray) {
    this.currentPlayersMap.clear();
    playersArray.forEach((p) => this.currentPlayersMap.set(p.id, p));
  }

  // Room Info 관리
  setRoomInfo(roomInfo) {
    this.roomInfoFromServer = roomInfo;
  }

  getRoomInfo() {
    return this.roomInfoFromServer;
  }

  // Player Input 상태 관리
  setPlayerYaw(yaw) {
    this.playerYaw = yaw;
  }

  getPlayerYaw() {
    return this.playerYaw;
  }

  setKeyboardState(key, value) {
    if (this.keyboardState.hasOwnProperty(key)) {
      this.keyboardState[key] = value;
    }
  }

  getKeyboardState() {
    return this.keyboardState;
  }

  isKeyPressed(key) {
    return this.keyboardState[key] || false;
  }

  // 유틸리티 메서드
  isInRoom() {
    return this.currentRoomId !== null;
  }

  isMyPlayer(playerId) {
    return this.clientId === playerId;
  }
}

// 전역 인스턴스 생성
window.stateManager = new StateManager(); 