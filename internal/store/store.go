// Package store opens the SQLite database that keeps players and the hangar
// across restarts (docs/design.md, section 9).
package store

import (
	"context"
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"net/url"
	"path"
	"slices"
	"strconv"
	"strings"
	"time"

	// The pure Go SQLite driver keeps the build cgo-free (#6, decision 16).
	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"

	queries "github.com/starquake/voidmarch/internal/db"
)

//go:embed migrations/*.sql
var migrations embed.FS

const (
	// walAttempts and walRetryDelay bound how long Open waits for another
	// server to finish setting up the same file.
	walAttempts   = 100
	walRetryDelay = 20 * time.Millisecond
	// primaryCode masks an extended SQLite result code down to its primary one.
	primaryCode = 0xff
)

var (
	// ErrNewerSchema is returned for a database written by a newer server.
	ErrNewerSchema = errors.New("the database is from a newer version")
	// ErrMigrationOrder is returned when the migration files skip a number.
	ErrMigrationOrder = errors.New("migrations out of order")
)

// Open opens the database file, creating it if needed, and brings its
// schema up to date.
func Open(ctx context.Context, file string) (*sql.DB, error) {
	// Immediate transactions take the write lock up front, so two servers
	// migrating one file take turns.
	query := url.Values{"_txlock": {"immediate"}}
	for _, pragma := range []string{"busy_timeout(5000)", "foreign_keys(1)"} {
		query.Add("_pragma", pragma)
	}
	// The path is escaped: SQLite reads the name as a URI, where # and ?
	// would cut it (#105).
	escaped := (&url.URL{Path: file}).EscapedPath()
	db, err := sql.Open("sqlite", "file:"+escaped+"?"+query.Encode())
	if err != nil {
		return nil, fmt.Errorf("error opening database %s: %w", file, err)
	}
	// One connection serializes writes, which SQLite would do anyway.
	db.SetMaxOpenConns(1)

	if err = migrate(ctx, db); err != nil {
		_ = db.Close()

		return nil, fmt.Errorf("error migrating database %s: %w", file, err)
	}
	if err = useWAL(ctx, db); err != nil {
		_ = db.Close()

		return nil, fmt.Errorf("error setting up database %s: %w", file, err)
	}

	return db, nil
}

// useWAL switches the file to write-ahead logging, which it then keeps. The
// switch doesn't wait out busy_timeout while another server holds the file
// (pinned by TestOpen_ConcurrentOpensMigrateOnce), so it retries.
func useWAL(ctx context.Context, db *sql.DB) error {
	var err error
	for range walAttempts {
		if _, err = db.ExecContext(ctx, "PRAGMA journal_mode = WAL"); !isBusy(err) {
			break
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("error waiting for the database: %w", ctx.Err())
		case <-time.After(walRetryDelay):
		}
	}
	if err != nil {
		return fmt.Errorf("error switching to WAL: %w", err)
	}

	return nil
}

// isBusy reports whether err is SQLite's "database is locked".
func isBusy(err error) bool {
	var sqliteErr *sqlite.Error

	return errors.As(err, &sqliteErr) && sqliteErr.Code()&primaryCode == sqlite3.SQLITE_BUSY
}

// migrate applies the migrations newer than the database's user_version, one
// transaction each. The version is read inside the transaction, so a
// migration another connection just applied is never applied twice.
func migrate(ctx context.Context, db *sql.DB) error {
	files, err := fs.Glob(migrations, "migrations/*.sql")
	if err != nil {
		return fmt.Errorf("error listing migrations: %w", err)
	}
	slices.Sort(files)

	for {
		done, err := step(ctx, db, files)
		if err != nil {
			return err
		}
		if done {
			return nil
		}
	}
}

// step applies the next migration, and reports true when none is left.
func step(ctx context.Context, db *sql.DB, files []string) (bool, error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return false, fmt.Errorf("error starting migration: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var version int
	if err = tx.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return false, fmt.Errorf("error reading schema version: %w", err)
	}
	if version > len(files) {
		return false, fmt.Errorf(
			"%w: schema %d, this server knows %d",
			ErrNewerSchema,
			version,
			len(files),
		)
	}
	if version == len(files) {
		return true, nil
	}

	file := files[version]
	if n, _, _ := strings.Cut(path.Base(file), "_"); n != fmt.Sprintf("%03d", version+1) {
		return false, fmt.Errorf("%w: %s, expected %03d", ErrMigrationOrder, file, version+1)
	}
	script, err := migrations.ReadFile(file)
	if err != nil {
		return false, fmt.Errorf("error reading %s: %w", file, err)
	}
	if _, err = tx.ExecContext(ctx, string(script)); err != nil {
		return false, fmt.Errorf("error applying %s: %w", file, err)
	}
	// PRAGMA takes no parameters; the version is a number we computed.
	if _, err = tx.ExecContext(ctx, "PRAGMA user_version = "+strconv.Itoa(version+1)); err != nil {
		return false, fmt.Errorf("error recording %s: %w", file, err)
	}
	if err = tx.Commit(); err != nil {
		return false, fmt.Errorf("error committing %s: %w", file, err)
	}

	return false, nil
}

// Hangar returns the saved hangar count, and false on a fresh database.
func Hangar(ctx context.Context, conn *sql.DB) (int, bool, error) {
	ships, err := queries.New(conn).Hangar(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("error reading hangar: %w", err)
	}

	return int(ships), true, nil
}

// SaveHangar saves the hangar count.
func SaveHangar(ctx context.Context, conn *sql.DB, ships int) error {
	if err := queries.New(conn).SaveHangar(ctx, int64(ships)); err != nil {
		return fmt.Errorf("error saving hangar: %w", err)
	}

	return nil
}

// OpenRings returns how many rings around home are open (#123), and false
// before any was saved.
func OpenRings(ctx context.Context, conn *sql.DB) (int, bool, error) {
	rings, err := queries.New(conn).OpenRings(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("error reading open rings: %w", err)
	}

	return int(rings), true, nil
}

// SaveOpenRings saves how many rings around home are open.
func SaveOpenRings(ctx context.Context, conn *sql.DB, rings int) error {
	if err := queries.New(conn).SaveOpenRings(ctx, int64(rings)); err != nil {
		return fmt.Errorf("error saving open rings: %w", err)
	}

	return nil
}

// Season is when the season started, and when its finale fell: the zero
// time until it has (#153).
type Season struct {
	Started time.Time
	Won     time.Time
}

// CurrentSeason returns the season.
func CurrentSeason(ctx context.Context, conn *sql.DB) (Season, error) {
	row, err := queries.New(conn).Season(ctx)
	if err != nil {
		return Season{}, fmt.Errorf("error reading the season: %w", err)
	}
	s := Season{Started: time.Unix(row.StartedAt, 0)}
	if row.WonAt.Valid {
		s.Won = time.Unix(row.WonAt.Int64, 0)
	}

	return s, nil
}

// SaveSeasonWon saves that the season was won at, unless it was already.
func SaveSeasonWon(ctx context.Context, conn *sql.DB, at time.Time) error {
	won := sql.NullInt64{Int64: at.Unix(), Valid: true}
	if err := queries.New(conn).SaveSeasonWon(ctx, won); err != nil {
		return fmt.Errorf("error saving the season won: %w", err)
	}

	return nil
}

// NewSeason resets the world for a new season starting at, in one
// transaction (#10 decisions 5-7, #155): the frontier, the cleared sectors,
// the Dreadnoughts' health, the hangar, and every player's unlocks, loadout
// and stats. Players stay registered. What it deletes, the server reads as a
// fresh file's: ring 1 open, the Dreadnoughts whole, POOL_START ships.
func NewSeason(ctx context.Context, conn *sql.DB, at time.Time) error {
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("error starting the new season: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	q := queries.New(conn).WithTx(tx)
	for _, reset := range []func(context.Context) error{
		q.ForgetClearedSectors,
		q.ForgetFrontier,
		q.ForgetDreadnoughts,
		q.ForgetHangar,
		q.ForgetUnlocks,
		q.ForgetLoadouts,
		q.ForgetStats,
		func(c context.Context) error { return q.StartSeason(c, at.Unix()) },
	} {
		if err = reset(ctx); err != nil {
			return fmt.Errorf("error resetting for the new season: %w", err)
		}
	}
	if err = tx.Commit(); err != nil {
		return fmt.Errorf("error committing the new season: %w", err)
	}

	return nil
}

// SavedDreadnought is the share of a faction's Dreadnought's health left,
// from 0 to 1, and when it was saved (#132, #140).
type SavedDreadnought struct {
	Health float64
	At     time.Time
}

// Dreadnoughts returns each faction's Dreadnought's saved health, by
// faction name (#140); a faction never saved is missing.
func Dreadnoughts(ctx context.Context, conn *sql.DB) (map[string]SavedDreadnought, error) {
	rows, err := queries.New(conn).Dreadnoughts(ctx)
	if err != nil {
		return nil, fmt.Errorf("error reading the dreadnoughts: %w", err)
	}
	out := make(map[string]SavedDreadnought, len(rows))
	for _, row := range rows {
		out[row.Faction] = SavedDreadnought{Health: row.Health, At: time.Unix(row.UpdatedAt, 0)}
	}

	return out, nil
}

// SaveDreadnoughtHealth saves the share of a faction's Dreadnought's health
// left as of at.
func SaveDreadnoughtHealth(
	ctx context.Context,
	conn *sql.DB,
	faction string,
	health float64,
	at time.Time,
) error {
	params := queries.SaveDreadnoughtParams{Faction: faction, Health: health, UpdatedAt: at.Unix()}
	if err := queries.New(conn).SaveDreadnought(ctx, params); err != nil {
		return fmt.Errorf("error saving the dreadnought: %w", err)
	}

	return nil
}

// ClearedSectors returns the names of the cleared sectors (#99).
func ClearedSectors(ctx context.Context, conn *sql.DB) ([]string, error) {
	names, err := queries.New(conn).ClearedSectors(ctx)
	if err != nil {
		return nil, fmt.Errorf("error reading cleared sectors: %w", err)
	}

	return names, nil
}

// ClearSector saves a sector as cleared at the time given; clearing one
// already cleared keeps its first time.
func ClearSector(ctx context.Context, conn *sql.DB, name string, at time.Time) error {
	params := queries.ClearSectorParams{Name: name, ClearedAt: at.Unix()}
	if err := queries.New(conn).ClearSector(ctx, params); err != nil {
		return fmt.Errorf("error clearing sector %s: %w", name, err)
	}

	return nil
}

// UnclearSector forgets a sector was cleared, after the enemy took it back
// (#102).
func UnclearSector(ctx context.Context, conn *sql.DB, name string) error {
	if err := queries.New(conn).UnclearSector(ctx, name); err != nil {
		return fmt.Errorf("error unclearing sector %s: %w", name, err)
	}

	return nil
}
