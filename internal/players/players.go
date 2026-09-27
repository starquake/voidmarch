// Package players keeps who is who: a name chosen on first visit and the
// token the browser keeps. It is in memory until persistence arrives with
// unlocks (see #6); tokens keep their format then.
package players

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
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

// Store holds the players by token. It is safe for concurrent use.
type Store struct {
	mu      sync.RWMutex
	byToken map[string]Player
}

// NewStore returns an empty store.
func NewStore() *Store {
	return &Store{byToken: make(map[string]Player)}
}

// Register adds a player with the given name and returns them with their
// token. Surrounding spaces are trimmed.
func (s *Store) Register(name string) (Player, string, error) {
	name = strings.TrimSpace(name)
	if err := validateName(name); err != nil {
		return Player{}, "", err
	}

	player := Player{ID: randomHex(idBytes), Name: name}
	token := randomHex(tokenBytes)

	s.mu.Lock()
	defer s.mu.Unlock()
	s.byToken[token] = player

	return player, token, nil
}

// ByToken returns the player a token belongs to.
func (s *Store) ByToken(token string) (Player, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	player, ok := s.byToken[token]

	return player, ok
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
