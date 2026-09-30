package players_test

import (
	"errors"
	"maps"
	"strings"
	"sync"
	"testing"
	"time"

	. "github.com/starquake/voidmarch/internal/players"
	"github.com/starquake/voidmarch/internal/sim"
	"github.com/starquake/voidmarch/internal/testutil"
)

// newStore is a store on a fresh temporary database.
func newStore(t *testing.T) *Store {
	t.Helper()

	return NewStore(testutil.OpenDB(t))
}

func TestStore_Register(t *testing.T) {
	t.Parallel()

	store := newStore(t)
	player, token, err := store.Register(t.Context(), "  Sanne  ")
	if err != nil {
		t.Fatalf("Register() error = %v", err)
	}

	if got, want := player.Name, "Sanne"; got != want {
		t.Errorf("player.Name = %q, want %q", got, want)
	}
	if got, want := len(token), 32; got != want {
		t.Errorf("len(token) = %d, want %d", got, want)
	}
	if player.ID == "" {
		t.Error("player.ID is empty")
	}

	found, ok, err := store.ByToken(t.Context(), token)
	if err != nil {
		t.Fatalf("ByToken() error = %v", err)
	}
	if got, want := ok, true; got != want {
		t.Fatalf("ByToken() ok = %t, want %t", got, want)
	}
	if found.ID != player.ID || found.Name != player.Name || len(found.Unlocks) != 0 {
		t.Errorf("ByToken() = %+v, want %+v with no unlocks yet", found, player)
	}
}

func TestStore_SaveUnlock(t *testing.T) {
	t.Parallel()

	store := newStore(t)
	player, token, err := store.Register(t.Context(), "Mo")
	if err != nil {
		t.Fatalf("Register() error = %v", err)
	}
	zapper := sim.Part(sim.WeaponZapper)
	for _, tier := range []sim.Tier{sim.TierPlain, sim.TierMega} {
		if err = store.SaveUnlock(t.Context(), player.ID, zapper, tier); err != nil {
			t.Fatalf("SaveUnlock(%v) error = %v", tier, err)
		}
	}

	found, _, err := store.ByToken(t.Context(), token)
	if err != nil {
		t.Fatalf("ByToken() error = %v", err)
	}
	if got, want := found.Unlocks, (sim.Unlocks{zapper: sim.TierMega}); !maps.Equal(got, want) {
		t.Errorf("ByToken().Unlocks = %v, want %v", got, want)
	}
}

func TestStore_RegisterGivesDistinctPlayers(t *testing.T) {
	t.Parallel()

	store := newStore(t)
	a, tokenA, err := store.Register(t.Context(), "Mo")
	if err != nil {
		t.Fatalf("Register() error = %v", err)
	}
	b, tokenB, err := store.Register(t.Context(), "Mo")
	if err != nil {
		t.Fatalf("Register() error = %v", err)
	}

	if a.ID == b.ID || tokenA == tokenB {
		t.Errorf("two registrations share an id or token: %v %q, %v %q", a, tokenA, b, tokenB)
	}
}

func TestStore_ByTokenUnknown(t *testing.T) {
	t.Parallel()

	_, ok, err := newStore(t).ByToken(t.Context(), "nope")
	if err != nil || ok {
		t.Errorf("ByToken(unknown) = _, %t, %v, want false, nil", ok, err)
	}
}

func TestStore_RegisterRejectsNames(t *testing.T) {
	t.Parallel()

	for _, name := range []string{"", "   ", strings.Repeat("x", MaxNameLength+1), "Mo!", "<b>", "San\tne"} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			_, _, err := newStore(t).Register(t.Context(), name)
			if got, want := err, ErrInvalidName; !errors.Is(got, want) {
				t.Errorf("Register(%q) error = %v, want %v", name, got, want)
			}
		})
	}
}

func TestStore_RegisterAcceptsNames(t *testing.T) {
	t.Parallel()

	for _, name := range []string{"Mo", "Joost-2", "space_pilot", "Zo\u00eb", strings.Repeat("x", MaxNameLength)} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			if _, _, err := newStore(t).Register(t.Context(), name); err != nil {
				t.Errorf("Register(%q) error = %v", name, err)
			}
		})
	}
}

func TestStore_ConcurrentUse(t *testing.T) {
	t.Parallel()

	store := newStore(t)
	var wg sync.WaitGroup
	for range 50 {
		wg.Go(func() {
			_, token, err := store.Register(t.Context(), "Mo")
			if err != nil {
				t.Errorf("Register() error = %v", err)

				return
			}
			if _, ok, err := store.ByToken(t.Context(), token); err != nil || !ok {
				t.Errorf("ByToken() = _, %t, %v, lost a registration", ok, err)
			}
		})
	}
	wg.Wait()
}

func TestStore_KeepsOnlyATokenHash(t *testing.T) {
	t.Parallel()

	db := testutil.OpenDB(t)
	_, token, err := NewStore(db).Register(t.Context(), "Mo")
	if err != nil {
		t.Fatalf("Register() error = %v", err)
	}

	var n int
	row := db.QueryRowContext(
		t.Context(),
		"SELECT count(*) FROM players WHERE token_hash = ?",
		token,
	)
	if err = row.Scan(&n); err != nil {
		t.Fatalf("counting: %v", err)
	}
	if n != 0 {
		t.Error("the database holds the token itself")
	}
}

func TestStore_Touch(t *testing.T) {
	t.Parallel()

	db := testutil.OpenDB(t)
	at := time.Date(2026, 9, 29, 12, 0, 0, 0, time.UTC)
	store := NewStore(db, WithClock(func() time.Time { return at }))
	player, _, err := store.Register(t.Context(), "Mo")
	if err != nil {
		t.Fatalf("Register() error = %v", err)
	}
	if err = store.Touch(t.Context(), player.ID); err != nil {
		t.Fatalf("Touch() error = %v", err)
	}

	var seen int64
	row := db.QueryRowContext(
		t.Context(),
		"SELECT last_seen_at FROM players WHERE id = ?",
		player.ID,
	)
	if err = row.Scan(&seen); err != nil {
		t.Fatalf("reading last_seen_at: %v", err)
	}
	if got, want := seen, at.Unix(); got != want {
		t.Errorf("last_seen_at = %d, want %d", got, want)
	}
}

func TestStore_Expire(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 9, 29, 12, 0, 0, 0, time.UTC)
	store := NewStore(testutil.OpenDB(t), WithClock(func() time.Time { return now }))
	register := func(name string) (Player, string) {
		t.Helper()
		player, token, err := store.Register(t.Context(), name)
		if err != nil {
			t.Fatalf("Register(%q) error = %v", name, err)
		}

		return player, token
	}
	_, unused := register("Unused")
	played, playedToken := register("Played")
	if err := store.Touch(t.Context(), played.ID); err != nil {
		t.Fatalf("Touch() error = %v", err)
	}
	now = now.Add(UnusedLifetime - time.Second)
	_, fresh := register("Fresh")

	now = now.Add(time.Second)
	n, err := store.Expire(t.Context())
	if err != nil {
		t.Fatalf("Expire() error = %v", err)
	}
	if got, want := n, 1; got != want {
		t.Errorf("Expire() = %d, want %d", got, want)
	}
	for token, want := range map[string]bool{unused: false, playedToken: true, fresh: true} {
		_, ok, err := store.ByToken(t.Context(), token)
		if err != nil || ok != want {
			t.Errorf("ByToken() after Expire = _, %t, %v, want %t, nil", ok, err, want)
		}
	}
}
