package store_test

import (
	"errors"
	"path/filepath"
	"slices"
	"sync"
	"testing"
	"time"

	. "github.com/starquake/voidmarch/internal/store"
)

func TestOpen_MigratesAFreshFile(t *testing.T) {
	t.Parallel()

	db, err := Open(t.Context(), filepath.Join(t.TempDir(), "voidmarch.db"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer func() { _ = db.Close() }()

	var version int
	if err = db.QueryRowContext(t.Context(), "PRAGMA user_version").Scan(&version); err != nil {
		t.Fatalf("reading user_version: %v", err)
	}
	if got, want := version, 2; got != want {
		t.Errorf("user_version = %d, want %d", got, want)
	}
	var mode string
	if err = db.QueryRowContext(t.Context(), "PRAGMA journal_mode").Scan(&mode); err != nil {
		t.Fatalf("reading journal_mode: %v", err)
	}
	if got, want := mode, "wal"; got != want {
		t.Errorf("journal_mode = %q, want %q", got, want)
	}
	for _, table := range []string{"players", "unlocks", "hangar", "cleared_sectors"} {
		var n int
		row := db.QueryRowContext(t.Context(), "SELECT count(*) FROM "+table)
		if err = row.Scan(&n); err != nil {
			t.Errorf("table %s: %v", table, err)
		}
	}
}

func TestOpen_ReopeningKeepsRowsAndMigratesNothing(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), "voidmarch.db")
	db, err := Open(t.Context(), path)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	if err = SaveHangar(t.Context(), db, 4); err != nil {
		t.Fatalf("SaveHangar() error = %v", err)
	}
	_ = db.Close()

	db, err = Open(t.Context(), path)
	if err != nil {
		t.Fatalf("Open() again error = %v", err)
	}
	defer func() { _ = db.Close() }()
	ships, ok, err := Hangar(t.Context(), db)
	if err != nil {
		t.Fatalf("Hangar() error = %v", err)
	}
	if !ok || ships != 4 {
		t.Errorf("Hangar() = %d, %t, want 4, true", ships, ok)
	}
}

func TestOpen_ConcurrentOpensMigrateOnce(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), "voidmarch.db")
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() {
			db, err := Open(t.Context(), path)
			if err != nil {
				t.Errorf("Open() error = %v", err)

				return
			}
			_ = db.Close()
		})
	}
	wg.Wait()
}

func TestOpen_RefusesANewerSchema(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), "voidmarch.db")
	db, err := Open(t.Context(), path)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	if _, err = db.ExecContext(t.Context(), "PRAGMA user_version = 99"); err != nil {
		t.Fatalf("setting user_version: %v", err)
	}
	_ = db.Close()

	if _, err = Open(t.Context(), path); !errors.Is(err, ErrNewerSchema) {
		t.Errorf("Open() error = %v, want %v", err, ErrNewerSchema)
	}
}

func TestOpen_MissingDirectory(t *testing.T) {
	t.Parallel()

	if _, err := Open(t.Context(), filepath.Join(t.TempDir(), "nope", "voidmarch.db")); err == nil {
		t.Error("Open() in a missing directory error = nil, want an error")
	}
}

func TestHangar(t *testing.T) {
	t.Parallel()

	db, err := Open(t.Context(), filepath.Join(t.TempDir(), "voidmarch.db"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer func() { _ = db.Close() }()

	_, ok, err := Hangar(t.Context(), db)
	if err != nil || ok {
		t.Errorf("Hangar() on a fresh file = _, %t, %v, want false, nil", ok, err)
	}
	for _, ships := range []int{3, 0, 7} {
		if err = SaveHangar(t.Context(), db, ships); err != nil {
			t.Fatalf("SaveHangar(%d) error = %v", ships, err)
		}
		got, ok, err := Hangar(t.Context(), db)
		if err != nil || !ok || got != ships {
			t.Errorf("Hangar() = %d, %t, %v, want %d, true, nil", got, ok, err, ships)
		}
	}
}

func TestClearedSectors(t *testing.T) {
	t.Parallel()

	db, err := Open(t.Context(), filepath.Join(t.TempDir(), "voidmarch.db"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer func() { _ = db.Close() }()

	names, err := ClearedSectors(t.Context(), db)
	if err != nil || len(names) != 0 {
		t.Errorf("ClearedSectors() on a fresh file = %v, %v, want none", names, err)
	}
	at := time.Unix(1_790_000_000, 0)
	for _, name := range []string{"E3", "C3", "E3"} {
		if err = ClearSector(t.Context(), db, name, at); err != nil {
			t.Fatalf("ClearSector(%s) error = %v", name, err)
		}
	}
	names, err = ClearedSectors(t.Context(), db)
	if err != nil || !slices.Equal(names, []string{"C3", "E3"}) {
		t.Errorf("ClearedSectors() = %v, %v, want [C3 E3]", names, err)
	}
}
