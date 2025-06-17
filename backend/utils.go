package backend

import (
	"crypto/rand"
	"fmt"
	"io"
	"log"
	"math/big"
	"time"
)

const (
	roomIDLength    = 6
	roomIDChars     = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	defaultClientID = "ANONYMOUS"
)

// 랜덤 방 ID 생성
func GenerateRandomRoomID() string {
	bytes := make([]byte, roomIDLength)
	if _, err := io.ReadFull(rand.Reader, bytes); err != nil {
		log.Printf("Error generating random bytes for Room ID: %v. Falling back to less random method.", err)
		for i := range bytes {
			num, _ := rand.Int(rand.Reader, big.NewInt(int64(len(roomIDChars))))
			bytes[i] = roomIDChars[num.Int64()]
		}
		return string(bytes)
	}

	for i, b := range bytes {
		bytes[i] = roomIDChars[b%byte(len(roomIDChars))]
	}
	return string(bytes)
}

// 클라이언트 ID 생성
func GenerateUniqueID() string {
	return fmt.Sprintf("%d", time.Now().UnixNano())
}
