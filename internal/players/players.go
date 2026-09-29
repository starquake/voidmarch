// Package players keeps who is who: a name chosen on first visit and the
// token the browser keeps, in the database (see #76).
package players

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	// MaxNameLength is the longest name, in characters.
	MaxNameLength = 16
	idBytes       = 8
	tokenBytes    = 16
)

// ErrInvalidName is returned for an empty, too long or oddly spelled name.
var ErrInvalidName = errors.New("a name is 1 to 16 letters, digits, spaces, - or _")

// Player is someone who has picked a name.
type Player struct {
	ID   string
	Name string
}

// Store holds the players in the database. It is safe for concurrent use.
type Store struct {
	db  *sql.DB
	now func() time.Time
}

// Option configures a Store.
type Option func(*Store)

// WithClock sets the store's clock, for tests.
func WithClock(now func() time.Time) Option {
	return func(s *Store) { s.now = now }
}

// NewStore returns a store on db, which store.Open has migrated.
func NewStore(db *sql.DB, opts ...Option) *Store {
	s := &Store{db: db, now: time.Now}
	for _, opt := range opts {
		opt(s)
	}

	return s
}

// Register adds a player with the given name and returns them with their
// token. Surrounding spaces are trimmed.
func (s *Store) Register(ctx context.Context, name string) (Player, string, error) {
	name = strings.TrimSpace(name)
	if err := validateName(name); err != nil {
		return Player{}, "", err
	}

	player := Player{ID: randomHex(idBytes), Name: name}
	token := randomHex(tokenBytes)
	_, err := s.db.ExecContext(ctx,
		"INSERT INTO players (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)",
		player.ID, player.Name, hashToken(token), s.now().Unix(),
	)
	if err != nil {
		return Player{}, "", fmt.Errorf("error registering player: %w", err)
	}

	return player, token, nil
}

// ByToken returns the player a token belongs to, and false for a token nobody
// has.
func (s *Store) ByToken(ctx context.Context, token string) (Player, bool, error) {
	var player Player
	err := s.db.QueryRowContext(ctx,
		"SELECT id, name FROM players WHERE token_hash = ?", hashToken(token),
	).Scan(&player.ID, &player.Name)
	if errors.Is(err, sql.ErrNoRows) {
		return Player{}, false, nil
	}
	if err != nil {
		return Player{}, false, fmt.Errorf("error finding player: %w", err)
	}

	return player, true, nil
}

// Touch records that the player connected now.
func (s *Store) Touch(ctx context.Context, id string) error {
	_, err := s.db.ExecContext(ctx,
		"UPDATE players SET last_seen_at = ? WHERE id = ?", s.now().Unix(), id,
	)
	if err != nil {
		return fmt.Errorf("error touching player %s: %w", id, err)
	}

	return nil
}

// hashToken is what the database keeps of a token, so a copy of the file
// can't sign anyone in.
func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))

	return hex.EncodeToString(sum[:])
}

func validateName(name string) error {
	if name == "" || utf8.RuneCountInString(name) > MaxNameLength {
		return fmt.Errorf("%w: got %d characters", ErrInvalidName, utf8.RuneCountInString(name))
	}
	for _, r := range name {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != ' ' && r != '-' && r != '_' {
			return fmt.Errorf("%w: %q is not allowed", ErrInvalidName, r)
		}
	}

	return nil
}

// randomHex returns n random bytes as hex. [crypto/rand.Read] never fails on
// the platforms Go supports, and panics rather than return short.
func randomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)

	return hex.EncodeToString(b)
}
