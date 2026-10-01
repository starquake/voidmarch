// Package config parses the server configuration from environment variables.
package config

import (
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"slices"
	"strconv"

	"github.com/starquake/voidmarch/internal/request"
	"github.com/starquake/voidmarch/internal/world"
)

// Application environments accepted in APP_ENV.
const (
	AppEnvironmentDevelopment = "development"
	AppEnvironmentProduction  = "production"
)

// PortDefault is the TCP port the server listens on when PORT is unset.
const PortDefault = "8080"

// PoolStartDefault is how many companion ships the hangar holds at start when
// POOL_START is unset, until fights can be won (see #49).
const PoolStartDefault = 3

// RegisterLimitDefault is how many names one address may register a minute
// when REGISTER_LIMIT is unset (#19): more than a full server, since friends
// on one network share an address (pinned by TestPlayers_AFullServerOnOneNetwork).
const RegisterLimitDefault = 20

// DBPathDefault is the database file when DB_PATH is unset: beside the
// working directory, so a development server keeps its players too.
const DBPathDefault = "voidmarch.db"

const maxPort = 65535

// float64Bits is the precision DROP_CHANCE parses at.
const float64Bits = 64

// invalidValue wraps an Err sentinel with the value that failed.
const invalidValue = "%w: %q"

var (
	// ErrInvalidAppEnv is returned when APP_ENV holds an unknown environment.
	ErrInvalidAppEnv = errors.New("invalid APP_ENV")
	// ErrInvalidPort is returned when PORT is not a number between 0 and 65535.
	ErrInvalidPort = errors.New("invalid PORT")
	// ErrInvalidWireLog is returned when WIRE_LOG is not a boolean.
	ErrInvalidWireLog = errors.New("invalid WIRE_LOG")
	// ErrInvalidPoolStart is returned when POOL_START is not a non-negative number.
	ErrInvalidPoolStart = errors.New("invalid POOL_START")
	// ErrInvalidRegisterLimit is returned when REGISTER_LIMIT is not a
	// non-negative number.
	ErrInvalidRegisterLimit = errors.New("invalid REGISTER_LIMIT")
	// ErrInvalidTrustedProxyIPs is returned when TRUSTED_PROXY_IPS is not a
	// comma-separated CIDR list.
	ErrInvalidTrustedProxyIPs = errors.New("invalid TRUSTED_PROXY_IPS")
	// ErrInvalidDBPath is returned when DB_PATH is in a directory that doesn't exist.
	ErrInvalidDBPath = errors.New("invalid DB_PATH")
	// ErrUnknownMap is returned when MAP names no embedded map.
	ErrUnknownMap = errors.New("unknown MAP")
	// ErrInvalidDropChance is returned when DROP_CHANCE is not a number from 0 to 1.
	ErrInvalidDropChance = errors.New("invalid DROP_CHANCE")
	// ErrDropChanceNotAllowed is returned when DROP_CHANCE is set outside development.
	ErrDropChanceNotAllowed = errors.New("DROP_CHANCE is only allowed when APP_ENV=development")
	// ErrWebDirNotAllowed is returned when WEB_DIR is set outside development.
	ErrWebDirNotAllowed = errors.New("WEB_DIR is only allowed when APP_ENV=development")
)

// Config is the server configuration.
type Config struct {
	// AppEnvironment is development or production. Unset means production, so a
	// forgotten variable never enables development-only behavior.
	AppEnvironment string
	Host           string
	Port           string
	// WebDir serves the web client from disk instead of the embedded copy, so
	// edits show without a rebuild. Development only.
	WebDir string
	// WireLog logs every WebSocket message, decoded. Noisy; for debugging.
	WireLog bool
	// PoolStart is how many companion ships the shared hangar holds on a fresh
	// database; after that the saved count wins.
	PoolStart int
	// DBPath is the SQLite file that keeps players and the hangar.
	DBPath string
	// RegisterLimit is how many names one address may register a minute; 0
	// lifts the limit.
	RegisterLimit int
	// Map names the game map the world is laid out from (#89).
	Map string
	// DropChance, when set, is every kill's chance to drop a part instead of
	// its kind's. Development only, for E2E.
	DropChance *float64
	// TrustedProxyCIDRs are the reverse proxies whose X-Forwarded-For names
	// the client's address. Empty, the default, trusts nobody's.
	TrustedProxyCIDRs []*net.IPNet
}

// Parse reads the configuration through getenv, applying defaults for unset
// variables.
func Parse(getenv func(string) string) (*Config, error) {
	c := &Config{
		AppEnvironment: AppEnvironmentProduction,
		Port:           PortDefault,
		PoolStart:      PoolStartDefault,
		RegisterLimit:  RegisterLimitDefault,
	}

	if val := getenv("APP_ENV"); val != "" {
		if val != AppEnvironmentDevelopment && val != AppEnvironmentProduction {
			return nil, fmt.Errorf(invalidValue, ErrInvalidAppEnv, val)
		}
		c.AppEnvironment = val
	}

	c.Host = getenv("HOST")

	if val := getenv("PORT"); val != "" {
		port, err := strconv.Atoi(val)
		if err != nil || port < 0 || port > maxPort {
			return nil, fmt.Errorf(invalidValue, ErrInvalidPort, val)
		}
		c.Port = val
	}

	if val := getenv("WEB_DIR"); val != "" {
		if c.AppEnvironment != AppEnvironmentDevelopment {
			return nil, ErrWebDirNotAllowed
		}
		c.WebDir = val
	}

	if val := getenv("WIRE_LOG"); val != "" {
		wireLog, err := strconv.ParseBool(val)
		if err != nil {
			return nil, fmt.Errorf(invalidValue, ErrInvalidWireLog, val)
		}
		c.WireLog = wireLog
	}

	err := parseCount(getenv("POOL_START"), ErrInvalidPoolStart, &c.PoolStart)
	if err != nil {
		return nil, err
	}
	err = parseCount(getenv("REGISTER_LIMIT"), ErrInvalidRegisterLimit, &c.RegisterLimit)
	if err != nil {
		return nil, err
	}

	if c.Map, err = parseMap(getenv("MAP")); err != nil {
		return nil, err
	}

	if c.DropChance, err = parseDropChance(getenv("DROP_CHANCE"), c.AppEnvironment); err != nil {
		return nil, err
	}

	c.TrustedProxyCIDRs, err = request.ParseTrustedProxyCIDRs(getenv("TRUSTED_PROXY_IPS"))
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidTrustedProxyIPs, err)
	}

	dbPath, err := parseDBPath(getenv("DB_PATH"))
	if err != nil {
		return nil, err
	}
	c.DBPath = dbPath

	return c, nil
}

// parseCount sets *n from val, a non-negative number, unless val is empty.
func parseCount(val string, invalid error, n *int) error {
	if val == "" {
		return nil
	}
	parsed, err := strconv.Atoi(val)
	if err != nil || parsed < 0 {
		return fmt.Errorf(invalidValue, invalid, val)
	}
	*n = parsed

	return nil
}

// parseMap is MAP, an embedded map's name, or the default map.
func parseMap(val string) (string, error) {
	if val == "" {
		return world.Default, nil
	}
	if !slices.Contains(world.Names(), val) {
		return "", fmt.Errorf("%w: %q, have %v", ErrUnknownMap, val, world.Names())
	}

	return val, nil
}

// parseDropChance is DROP_CHANCE, nil when unset.
func parseDropChance(val, appEnv string) (*float64, error) {
	if val == "" {
		return nil, nil //nolint:nilnil // unset is no override, not an error.
	}
	if appEnv != AppEnvironmentDevelopment {
		return nil, ErrDropChanceNotAllowed
	}
	chance, err := strconv.ParseFloat(val, float64Bits)
	if err != nil || chance < 0 || chance > 1 {
		return nil, fmt.Errorf(invalidValue, ErrInvalidDropChance, val)
	}

	return &chance, nil
}

// parseDBPath is DB_PATH, or the default, in a directory that exists.
func parseDBPath(val string) (string, error) {
	if val == "" {
		val = DBPathDefault
	}
	if info, err := os.Stat(filepath.Dir(val)); err != nil || !info.IsDir() {
		return "", fmt.Errorf(invalidValue, ErrInvalidDBPath, val)
	}

	return val, nil
}

// IsProduction reports whether the server runs in production.
func (c *Config) IsProduction() bool {
	return c.AppEnvironment == AppEnvironmentProduction
}

// Addr returns the host:port address to listen on.
func (c *Config) Addr() string {
	return net.JoinHostPort(c.Host, c.Port)
}
