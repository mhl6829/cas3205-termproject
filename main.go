package main

import (
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	// 커맨드 라인 플래그로 포트 번호 설정 가능하게 (선택 사항)
	port := flag.String("port", "8080", "Port to listen on")
	flag.Parse()

	log.SetFlags(log.LstdFlags | log.Lshortfile) // 로그에 시간 및 파일명/줄번호 출력

	// 서버 인스턴스 생성
	server := NewServer() // server.go에 정의된 함수

	// 웹소켓 핸들러 등록
	// "/ws" 경로로 오는 모든 요청은 ServeWs 함수가 처리
	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		ServeWs(server, w, r) // server.go에 정의된 함수
	})

	fs := http.FileServer(http.Dir("./static"))
	http.Handle("/", fs)

	// HTTP 서버 시작
	addr := ":" + *port
	log.Printf("Game server starting on %s", addr)

	// 서버를 고루틴으로 실행하여 메인 스레드가 블로킹되지 않도록 함
	// (HTTP 서버 시작이 블로킹되므로, 별도 고루틴 불필요할 수도 있지만,
	//  만약 다른 초기화 작업이 있다면 유용)
	go func() {
		if err := http.ListenAndServe(addr, nil); err != nil {
			log.Fatalf("ListenAndServe: %v", err)
		}
	}()

	log.Printf("WebSocket endpoint available at ws://localhost%s/ws", addr)

	// 정상 종료(Graceful Shutdown) 처리
	// SIGINT (Ctrl+C) 또는 SIGTERM 신호를 받으면 서버를 정리하고 종료
	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, syscall.SIGINT, syscall.SIGTERM)
	<-shutdown // 신호 수신 대기

	log.Println("Shutting down server...")

	// 여기에 서버 정리 로직 추가 가능 (예: 모든 방에 종료 알림, 클라이언트 연결 종료 등)
	// Server 구조체에 Stop() 메서드를 만들고 호출할 수 있습니다.
	// s.Stop() // 예시

	// 현재는 각 Room과 Client의 defer에서 자체 정리 로직 수행

	log.Println("Server gracefully stopped.")
}
