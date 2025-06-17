package main

import (
	"cas3205/backend"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	port := flag.String("port", "8080", "Port to listen on")
	flag.Parse()

	log.SetFlags(log.LstdFlags | log.Lshortfile)

	// 서버 인스턴스 생성
	server := backend.NewServer()

	// 웹소켓 핸들러 등록
	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		backend.ServeWs(server, w, r)
	})

	// 정적 파일 서빙
	fs := http.FileServer(http.Dir("./static"))
	http.Handle("/", fs)

	addr := ":" + *port
	log.Printf("Game server starting on %s", addr)

	go func() {
		if err := http.ListenAndServe(addr, nil); err != nil {
			log.Fatalf("ListenAndServe: %v", err)
		}
	}()

	log.Printf("WebSocket endpoint available at ws://localhost%s/ws", addr)

	// Graceful Shutdown
	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, syscall.SIGINT, syscall.SIGTERM)
	<-shutdown
	log.Println("Server gracefully stopped.")
}
