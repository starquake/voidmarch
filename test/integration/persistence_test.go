package integration_test

import (
	"path/filepath"
	"testing"
)

func TestPersistence_ARestartKeepsPlayersAndTheFleet(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "voidmarch.db")
	baseURL, stop := runServer(t, map[string]string{"DB_PATH": dbPath, "POOL_START": "6"})
	token := registerPlayer(t, baseURL, "Sanne")
	p, before := joinAs(t, baseURL, token)
	_ = p.conn.CloseNow()
	stop()

	// The saved fleet wins over POOL_START, which only fills a fresh database.
	baseURL = startServer(t, map[string]string{"DB_PATH": dbPath, "POOL_START": "2"})
	_, after := joinAs(t, baseURL, token)

	if got, want := after.GetPlayerId(), before.GetPlayerId(); got != want {
		t.Errorf("player id after a restart = %q, want %q", got, want)
	}
	if got, want := after.GetName(), "Sanne"; got != want {
		t.Errorf("name after a restart = %q, want %q", got, want)
	}
	if got, want := after.GetSquadrons().GetHangar(), uint32(6); got != want {
		t.Errorf("hangar after a restart = %d, want %d", got, want)
	}
}
