package config_test

import (
	"errors"
	"path/filepath"
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
	if got, want := cfg.DBPath, DBPathDefault; got != want {
		t.Errorf("cfg.DBPath = %q, want %q", got, want)
	}
	if got, want := cfg.RegisterLimit, RegisterLimitDefault; got != want {
		t.Errorf("cfg.RegisterLimit = %d, want %d", got, want)
	}
	if cfg.DropChance != nil {
		t.Errorf("cfg.DropChance = %v, want unset", *cfg.DropChance)
	}
}

func TestParse_Values(t *testing.T) {
	t.Parallel()

	dbPath := filepath.Join(t.TempDir(), "players.db")
	cfg, err := Parse(envFunc(map[string]string{
		"APP_ENV":           "development",
		"HOST":              "127.0.0.1",
		"PORT":              "9000",
		"WEB_DIR":           "internal/web/static",
		"WIRE_LOG":          "true",
		"POOL_START":        "0",
		"DB_PATH":           dbPath,
		"REGISTER_LIMIT":    "0",
		"TRUSTED_PROXY_IPS": "10.0.0.0/8, 127.0.0.1/32",
		"DROP_CHANCE":       "1",
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
	if got, want := cfg.DBPath, dbPath; got != want {
		t.Errorf("cfg.DBPath = %q, want %q", got, want)
	}
	if got, want := cfg.RegisterLimit, 0; got != want {
		t.Errorf("cfg.RegisterLimit = %d, want %d", got, want)
	}
	if got, want := len(cfg.TrustedProxyCIDRs), 2; got != want {
		t.Errorf("len(cfg.TrustedProxyCIDRs) = %d, want %d", got, want)
	}
	if cfg.DropChance == nil || *cfg.DropChance != 1 {
		t.Errorf("cfg.DropChance = %v, want 1", cfg.DropChance)
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
		{
			name: "pool start not a number",
			env:  map[string]string{"POOL_START": "many"},
			want: ErrInvalidPoolStart,
		},
		{
			name: "pool start negative",
			env:  map[string]string{"POOL_START": "-1"},
			want: ErrInvalidPoolStart,
		},
		{
			name: "register limit not a number",
			env:  map[string]string{"REGISTER_LIMIT": "lots"},
			want: ErrInvalidRegisterLimit,
		},
		{
			name: "register limit negative",
			env:  map[string]string{"REGISTER_LIMIT": "-1"},
			want: ErrInvalidRegisterLimit,
		},
		{
			name: "drop chance in production",
			env:  map[string]string{"DROP_CHANCE": "1"},
			want: ErrDropChanceNotAllowed,
		},
		{
			name: "drop chance above 1",
			env:  map[string]string{"APP_ENV": "development", "DROP_CHANCE": "2"},
			want: ErrInvalidDropChance,
		},
		{
			name: "drop chance not a number",
			env:  map[string]string{"APP_ENV": "development", "DROP_CHANCE": "always"},
			want: ErrInvalidDropChance,
		},
		{
			name: "trusted proxy not a CIDR",
			env:  map[string]string{"TRUSTED_PROXY_IPS": "10.0.0.1"},
			want: ErrInvalidTrustedProxyIPs,
		},
		{
			name: "db path in a missing directory",
			env:  map[string]string{"DB_PATH": "/no/such/dir/voidmarch.db"},
			want: ErrInvalidDBPath,
		},
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
