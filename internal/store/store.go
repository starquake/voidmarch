// Package store opens the SQLite database that keeps players and the hangar
// across restarts (docs/design.md, section 10).
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

	// The pure Go SQLite driver keeps the build cgo-free (#6, decision 16).
	_ "modernc.org/sqlite"
)

//go:embed migrations/*.sql
var migrations embed.FS

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
	for _, pragma := range []string{"journal_mode(WAL)", "busy_timeout(5000)", "foreign_keys(1)"} {
		query.Add("_pragma", pragma)
	}
	db, err := sql.Open("sqlite", "file:"+file+"?"+query.Encode())
	if err != nil {
		return nil, fmt.Errorf("error opening database %s: %w", file, err)
	}
	// One connection serializes writes, which SQLite would do anyway.
	db.SetMaxOpenConns(1)

	if err = migrate(ctx, db); err != nil {
		_ = db.Close()

		return nil, fmt.Errorf("error migrating database %s: %w", file, err)
	}

	return db, nil
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
func Hangar(ctx context.Context, db *sql.DB) (int, bool, error) {
	var ships int
	err := db.QueryRowContext(ctx, "SELECT ships FROM hangar WHERE id = 1").Scan(&ships)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("error reading hangar: %w", err)
	}

	return ships, true, nil
}

// SaveHangar saves the hangar count.
func SaveHangar(ctx context.Context, db *sql.DB, ships int) error {
	_, err := db.ExecContext(
		ctx,
		"INSERT INTO hangar (id, ships) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET ships = excluded.ships",
		ships,
	)
	if err != nil {
		return fmt.Errorf("error saving hangar: %w", err)
	}

	return nil
}
