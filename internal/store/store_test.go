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
	if got, want := version, 7; got != want {
		t.Errorf("user_version = %d, want %d", got, want)
	}
	var mode string
	if err = db.QueryRowContext(t.Context(), "PRAGMA journal_mode").Scan(&mode); err != nil {
		t.Fatalf("reading journal_mode: %v", err)
	}
	if got, want := mode, "wal"; got != want {
		t.Errorf("journal_mode = %q, want %q", got, want)
	}
	for _, table := range []string{"players", "unlocks", "hangar", "cleared_sectors", "frontier", "dreadnoughts"} {
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

func TestOpen_TheHexGridForgetsTheSquaresClears(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), "voidmarch.db")
	db, err := Open(t.Context(), path)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	if err = ClearSector(t.Context(), db, "G7", time.Unix(1, 0)); err != nil {
		t.Fatalf("ClearSector() error = %v", err)
	}
	// A version-2 file: without the tables migrations 004 onward add.
	_, err = db.ExecContext(
		t.Context(),
		"DROP TABLE frontier; DROP TABLE dreadnoughts; PRAGMA user_version = 2",
	)
	if err != nil {
		t.Fatalf("rolling the file back to version 2: %v", err)
	}
	_ = db.Close()

	db, err = Open(t.Context(), path)
	if err != nil {
		t.Fatalf("Open() again error = %v", err)
	}
	defer func() { _ = db.Close() }()
	names, err := ClearedSectors(t.Context(), db)
	if err != nil || len(names) != 0 {
		t.Errorf("ClearedSectors() after the hex migration = %v, %v, want none", names, err)
	}
}

func TestOpen_TheDreadnoughtsHealthBecomesAShare(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), "voidmarch.db")
	db, err := Open(t.Context(), path)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	// A version-5 file, with 150,000 of the old fixed 200,000 saved.
	_, err = db.ExecContext(t.Context(), `DROP TABLE dreadnoughts;
		CREATE TABLE dreadnought (
			id INTEGER PRIMARY KEY CHECK (id = 1), hp INTEGER NOT NULL, updated_at INTEGER NOT NULL
		) STRICT;
		INSERT INTO dreadnought (id, hp, updated_at) VALUES (1, 150000, 1700000000);
		PRAGMA user_version = 5`)
	if err != nil {
		t.Fatalf("rolling the file back to version 5: %v", err)
	}
	_ = db.Close()

	db, err = Open(t.Context(), path)
	if err != nil {
		t.Fatalf("Open() again error = %v", err)
	}
	defer func() { _ = db.Close() }()
	// Migrations 006 and 007 make it the Kla'ed Dreadnought's share.
	saved, err := Dreadnoughts(t.Context(), db)
	d, ok := saved["klaed"]
	if err != nil || !ok || d.Health != 0.75 || d.At.Unix() != 1_700_000_000 || len(saved) != 1 {
		t.Errorf(
			"Dreadnoughts() after the migrations = %+v, %v; want the Kla'ed one at 0.75",
			saved,
			err,
		)
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

func TestOpenRings(t *testing.T) {
	t.Parallel()

	db, err := Open(t.Context(), filepath.Join(t.TempDir(), "voidmarch.db"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer func() { _ = db.Close() }()

	rings, ok, err := OpenRings(t.Context(), db)
	if err != nil || ok {
		t.Errorf("OpenRings() on a fresh file = %d, %t, %v; want none saved", rings, ok, err)
	}
	for _, want := range []int{3, 1} {
		if err = SaveOpenRings(t.Context(), db, want); err != nil {
			t.Fatalf("SaveOpenRings(%d) error = %v", want, err)
		}
		rings, ok, err = OpenRings(t.Context(), db)
		if err != nil || !ok || rings != want {
			t.Errorf("OpenRings() = %d, %t, %v; want %d", rings, ok, err, want)
		}
	}
}

func TestDreadnoughts(t *testing.T) {
	t.Parallel()

	db, err := Open(t.Context(), filepath.Join(t.TempDir(), "voidmarch.db"))
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	defer func() { _ = db.Close() }()

	fresh, err := Dreadnoughts(t.Context(), db)
	if err != nil || len(fresh) != 0 {
		t.Errorf("Dreadnoughts() on a fresh file = %v, %v; want none saved", fresh, err)
	}
	at := time.Unix(1_700_000_000, 0)
	for faction, share := range map[string]float64{"klaed": 0.75, "nairan": 0.5} {
		if err = SaveDreadnoughtHealth(t.Context(), db, faction, share, at); err != nil {
			t.Fatalf("SaveDreadnoughtHealth(%s) error = %v", faction, err)
		}
	}
	if err = SaveDreadnoughtHealth(t.Context(), db, "nairan", 0.25, at); err != nil {
		t.Fatalf("SaveDreadnoughtHealth(nairan) again error = %v", err)
	}
	saved, err := Dreadnoughts(t.Context(), db)
	if err != nil || len(saved) != 2 || saved["klaed"].Health != 0.75 ||
		saved["nairan"].Health != 0.25 ||
		!saved["nairan"].At.Equal(at) {
		t.Errorf(
			"Dreadnoughts() = %+v, %v; want the Kla'ed one at 0.75 and the Nairan one at 0.25",
			saved,
			err,
		)
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
	if err = UnclearSector(t.Context(), db, "C3"); err != nil {
		t.Fatalf("UnclearSector(C3) error = %v", err)
	}
	names, err = ClearedSectors(t.Context(), db)
	if err != nil || !slices.Equal(names, []string{"E3"}) {
		t.Errorf("ClearedSectors() after unclearing C3 = %v, %v, want [E3]", names, err)
	}
}
