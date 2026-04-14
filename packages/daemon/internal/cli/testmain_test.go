package cli

import (
	"os"
	"testing"

	"github.com/riokulabs/rioku/internal/auth"
)

func TestMain(m *testing.M) {
	auth.SetTestHashParams()
	os.Exit(m.Run())
}
