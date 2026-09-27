package players_test

import (
	"errors"
	"strings"
	"sync"
	"testing"

	. "github.com/starquake/voidmarch/internal/players"
)

func TestStore_Register(t *testing.T) {
	t.Parallel()

	store := NewStore()
	player, token, err := store.Register("  Sanne  ")
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

	found, ok := store.ByToken(token)
	if got, want := ok, true; got != want {
		t.Fatalf("ByToken() ok = %t, want %t", got, want)
	}
	if got, want := found, player; got != want {
		t.Errorf("ByToken() = %v, want %v", got, want)
	}
}

func TestStore_RegisterGivesDistinctPlayers(t *testing.T) {
	t.Parallel()

	store := NewStore()
	a, tokenA, err := store.Register("Mo")
	if err != nil {
		t.Fatalf("Register() error = %v", err)
	}
	b, tokenB, err := store.Register("Mo")
	if err != nil {
		t.Fatalf("Register() error = %v", err)
	}

	if a.ID == b.ID || tokenA == tokenB {
		t.Errorf("two registrations share an id or token: %v %q, %v %q", a, tokenA, b, tokenB)
	}
}

func TestStore_ByTokenUnknown(t *testing.T) {
	t.Parallel()

	if _, ok := NewStore().ByToken("nope"); ok {
		t.Error("ByToken(unknown) ok = true, want false")
	}
}

func TestStore_RegisterRejectsNames(t *testing.T) {
	t.Parallel()

	for _, name := range []string{"", "   ", strings.Repeat("x", MaxNameLength+1), "Mo!", "<b>", "San\tne"} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()

			_, _, err := NewStore().Register(name)
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

			if _, _, err := NewStore().Register(name); err != nil {
				t.Errorf("Register(%q) error = %v", name, err)
			}
		})
	}
}

func TestStore_ConcurrentUse(t *testing.T) {
	t.Parallel()

	store := NewStore()
	var wg sync.WaitGroup
	for range 50 {
		wg.Go(func() {
			_, token, err := store.Register("Mo")
			if err != nil {
				t.Errorf("Register() error = %v", err)

				return
			}
			if _, ok := store.ByToken(token); !ok {
				t.Error("ByToken() lost a registration")
			}
		})
	}
	wg.Wait()
}
