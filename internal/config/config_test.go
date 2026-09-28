package config_test

import (
	"errors"
	"testing"

	. "github.com/starquake/voidmarch/internal/config"
)

func envFunc(env map[string]string) func(string) string {
	return func(key string) string { return env[key] }
}

func TestParse_Defaults(t *testing.T) {
	t.Parallel()

	cfg, err := Parse(envFunc(nil))
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}

	if got, want := cfg.AppEnvironment, AppEnvironmentProduction; got != want {
		t.Errorf("cfg.AppEnvironment = %q, want %q", got, want)
	}
	if got, want := cfg.Port, PortDefault; got != want {
		t.Errorf("cfg.Port = %q, want %q", got, want)
	}
	if got, want := cfg.IsProduction(), true; got != want {
		t.Errorf("cfg.IsProduction() = %t, want %t", got, want)
	}
	if got, want := cfg.Addr(), ":8080"; got != want {
		t.Errorf("cfg.Addr() = %q, want %q", got, want)
	}
	if got, want := cfg.PoolStart, PoolStartDefault; got != want {
		t.Errorf("cfg.PoolStart = %d, want %d", got, want)
	}
}

func TestParse_Values(t *testing.T) {
	t.Parallel()

	cfg, err := Parse(envFunc(map[string]string{
		"APP_ENV":    "development",
		"HOST":       "127.0.0.1",
		"PORT":       "9000",
		"WEB_DIR":    "internal/web/static",
		"WIRE_LOG":   "true",
		"POOL_START": "0",
	}))
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}

	if got, want := cfg.IsProduction(), false; got != want {
		t.Errorf("cfg.IsProduction() = %t, want %t", got, want)
	}
	if got, want := cfg.Addr(), "127.0.0.1:9000"; got != want {
		t.Errorf("cfg.Addr() = %q, want %q", got, want)
	}
	if got, want := cfg.WebDir, "internal/web/static"; got != want {
		t.Errorf("cfg.WebDir = %q, want %q", got, want)
	}
	if got, want := cfg.WireLog, true; got != want {
		t.Errorf("cfg.WireLog = %t, want %t", got, want)
	}
	if got, want := cfg.PoolStart, 0; got != want {
		t.Errorf("cfg.PoolStart = %d, want %d", got, want)
	}
}

func TestParse_Errors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		env  map[string]string
		want error
	}{
		{
			name: "unknown app env",
			env:  map[string]string{"APP_ENV": "staging"},
			want: ErrInvalidAppEnv,
		},
		{name: "port not a number", env: map[string]string{"PORT": "http"}, want: ErrInvalidPort},
		{name: "port negative", env: map[string]string{"PORT": "-1"}, want: ErrInvalidPort},
		{name: "port too large", env: map[string]string{"PORT": "65536"}, want: ErrInvalidPort},
		{
			name: "web dir in production",
			env:  map[string]string{"WEB_DIR": "web"},
			want: ErrWebDirNotAllowed,
		},
		{
			name: "wire log not a boolean",
			env:  map[string]string{"WIRE_LOG": "loud"},
			want: ErrInvalidWireLog,
		},
		{name: "pool start not a number", env: map[string]string{"POOL_START": "many"}, want: ErrInvalidPoolStart},
		{name: "pool start negative", env: map[string]string{"POOL_START": "-1"}, want: ErrInvalidPoolStart},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			_, err := Parse(envFunc(tc.env))
			if got, want := err, tc.want; !errors.Is(got, want) {
				t.Errorf("Parse() error = %v, want %v", got, want)
			}
		})
	}
}
