package auth

import (
	"os"
	"testing"
)

func TestMain(m *testing.M) {
	SetTestHashParams()
	os.Exit(m.Run())
}
