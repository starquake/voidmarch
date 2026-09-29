// Package config parses the server configuration from environment variables.
package config

import (
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
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

// DBPathDefault is the database file when DB_PATH is unset: beside the
// working directory, so a development server keeps its players too.
const DBPathDefault = "voidmarch.db"

const maxPort = 65535

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
	// ErrInvalidDBPath is returned when DB_PATH is in a directory that doesn't exist.
	ErrInvalidDBPath = errors.New("invalid DB_PATH")
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
}

// Parse reads the configuration through getenv, applying defaults for unset
// variables.
func Parse(getenv func(string) string) (*Config, error) {
	c := &Config{
		AppEnvironment: AppEnvironmentProduction,
		Port:           PortDefault,
		PoolStart:      PoolStartDefault,
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

	if val := getenv("POOL_START"); val != "" {
		n, err := strconv.Atoi(val)
		if err != nil || n < 0 {
			return nil, fmt.Errorf(invalidValue, ErrInvalidPoolStart, val)
		}
		c.PoolStart = n
	}

	dbPath, err := parseDBPath(getenv("DB_PATH"))
	if err != nil {
		return nil, err
	}
	c.DBPath = dbPath

	return c, nil
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
