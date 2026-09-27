package version_test

import (
	"runtime/debug"
	"testing"

	. "github.com/starquake/voidmarch/internal/version"
)

//nolint:paralleltest // mutates the package-level build stamp.
func TestRelease(t *testing.T) {
	old := Version
	t.Cleanup(func() { Version = old })

	Version = ""
	if got, want := Release(), "dev"; got != want {
		t.Errorf("Release() = %q, want %q", got, want)
	}

	Version = "0.1.0"
	if got, want := Release(), "0.1.0"; got != want {
		t.Errorf("Release() = %q, want %q", got, want)
	}
}

//nolint:paralleltest // mutates the package-level build stamp.
func TestCommitLabel(t *testing.T) {
	old := Commit
	t.Cleanup(func() { Commit = old })

	Commit = "0123456789abcdef-dirty"
	if got, want := CommitLabel(), "0123456-dirty"; got != want {
		t.Errorf("CommitLabel() = %q, want %q", got, want)
	}

	Commit = ""
	if got := CommitLabel(); got == "" {
		t.Error("CommitLabel() = \"\", want a commit or \"unknown\"")
	}
}

func TestCommitFromSettings(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		settings []debug.BuildSetting
		want     string
	}{
		{
			name:     "no revision",
			settings: []debug.BuildSetting{{Key: "GOOS", Value: "linux"}},
			want:     "",
		},
		{
			name: "clean",
			settings: []debug.BuildSetting{
				{Key: "vcs.revision", Value: "abcdef0123"},
				{Key: "vcs.modified", Value: "false"},
			},
			want: "abcdef0",
		},
		{
			name: "dirty",
			settings: []debug.BuildSetting{
				{Key: "vcs.revision", Value: "abcdef0123"},
				{Key: "vcs.modified", Value: "true"},
			},
			want: "abcdef0-dirty",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			if got, want := CommitFromSettings(tc.settings), tc.want; got != want {
				t.Errorf("CommitFromSettings() = %q, want %q", got, want)
			}
		})
	}
}

func TestShorten(t *testing.T) {
	t.Parallel()

	tests := []struct {
		in, want string
	}{
		{in: "abc", want: "abc"},
		{in: "0123456789", want: "0123456"},
		{in: "0123456789-dirty", want: "0123456-dirty"},
	}

	for _, tc := range tests {
		t.Run(tc.in, func(t *testing.T) {
			t.Parallel()

			if got, want := Shorten(tc.in), tc.want; got != want {
				t.Errorf("Shorten(%q) = %q, want %q", tc.in, got, want)
			}
		})
	}
}
