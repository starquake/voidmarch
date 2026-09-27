// Package config parses the server configuration from environment variables.
package config

import (
	"errors"
	"fmt"
	"net"
	"strconv"
)

// Application environments accepted in APP_ENV.
const (
	AppEnvironmentDevelopment = "development"
	AppEnvironmentProduction  = "production"
)

// PortDefault is the TCP port the server listens on when PORT is unset.
const PortDefault = "8080"

const maxPort = 65535

var (
	// ErrInvalidAppEnv is returned when APP_ENV holds an unknown environment.
	ErrInvalidAppEnv = errors.New("invalid APP_ENV")
	// ErrInvalidPort is returned when PORT is not a number between 0 and 65535.
	ErrInvalidPort = errors.New("invalid PORT")
	// ErrInvalidWireLog is returned when WIRE_LOG is not a boolean.
	ErrInvalidWireLog = errors.New("invalid WIRE_LOG")
	// ErrWebDirNotAllowed is returned when WEB_DIR is set outside development.
	ErrWebDirNotAllowed = errors.New("WEB_DIR is only allowed when APP_ENV=development")
)

// Config is the server configuration.
type Config struct {
	// AppEnvironment is development or production. Unset means production, so a
	// forgotten variable never enables development-only behaviour.
	AppEnvironment string
	Host           string
	Port           string
	// WebDir serves the web client from disk instead of the embedded copy, so
	// edits show without a rebuild. Development only.
	WebDir string
	// WireLog logs every WebSocket message, decoded. Noisy; for debugging.
	WireLog bool
}

// Parse reads the configuration through getenv, applying defaults for unset
// variables.
func Parse(getenv func(string) string) (*Config, error) {
	c := &Config{
		AppEnvironment: AppEnvironmentProduction,
		Port:           PortDefault,
	}

	if val := getenv("APP_ENV"); val != "" {
		if val != AppEnvironmentDevelopment && val != AppEnvironmentProduction {
			return nil, fmt.Errorf("%w: %q", ErrInvalidAppEnv, val)
		}
		c.AppEnvironment = val
	}

	c.Host = getenv("HOST")

	if val := getenv("PORT"); val != "" {
		port, err := strconv.Atoi(val)
		if err != nil || port < 0 || port > maxPort {
			return nil, fmt.Errorf("%w: %q", ErrInvalidPort, val)
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
			return nil, fmt.Errorf("%w: %q", ErrInvalidWireLog, val)
		}
		c.WireLog = wireLog
	}

	return c, nil
}

// IsProduction reports whether the server runs in production.
func (c *Config) IsProduction() bool {
	return c.AppEnvironment == AppEnvironmentProduction
}

// Addr returns the host:port address to listen on.
func (c *Config) Addr() string {
	return net.JoinHostPort(c.Host, c.Port)
}
