package main

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
	defaultClientID = "ANONYMOUS" // 초기 또는 식별 불가 클라이언트용
)

// GenerateRandomRoomID는 지정된 길이의 랜덤 문자열 방 코드를 생성합니다.
// 대문자와 숫자로 구성됩니다.
func GenerateRandomRoomID() string {
	// time.Sleep(time.Microsecond * 100) // 엔트로피 증가를 위한 짧은 지연 (필요에 따라)
	// crypto/rand 를 사용하여 보안에 더 안전한 난수 생성
	// math/rand 는 시드 기반이라 예측 가능성이 있습니다.
	// Seed math/rand if you were to use it: rand.Seed(time.Now().UnixNano())

	bytes := make([]byte, roomIDLength)
	if _, err := io.ReadFull(rand.Reader, bytes); err != nil {
		// 이 에러는 심각한 시스템 문제일 수 있으므로 패닉 또는 강력한 로깅 필요
		log.Printf("Error generating random bytes for Room ID: %v. Falling back to less random method.", err)
		// Fallback (덜 안전하지만 작동은 함)
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

// GenerateUniqueID는 (단순화된) 고유 ID를 생성합니다.
// 실제 프로덕션에서는 UUID 등을 사용하는 것이 좋습니다.
func GenerateUniqueID() string {
	// 간단하게 현재 시간을 나노초로 표현한 것을 사용합니다.
	// 동시 요청이 매우 많을 경우 충돌 가능성이 있지만, 예제에서는 이 정도로 합니다.
	// 더 강력한 ID가 필요하면 github.com/google/uuid 와 같은 라이브러리를 사용하세요.
	return fmt.Sprintf("%d", time.Now().UnixNano())
}
