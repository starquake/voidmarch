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
