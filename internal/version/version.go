// Package version exposes the build stamp: release version, commit and build
// date.
//
// The values are set with -ldflags "-X
// github.com/starquake/voidmarch/internal/version.Version=..." (and .Commit,
// .Date). Without them, the commit falls back to the VCS revision Go stamps
// into a build from a checkout.
package version

import (
	"runtime/debug"
	"strings"
)

const shortCommitLen = 7

// Version, Commit and Date are set at link time with -ldflags.
//
//nolint:gochecknoglobals // set once at link time via -ldflags, never mutated at runtime.
var (
	Version string
	Commit  string
	Date    string
)

// Release returns the stamped release version, or "dev" for an unstamped build.
func Release() string {
	if Version != "" {
		return Version
	}

	return "dev"
}

// CommitLabel returns the short commit, or "unknown" when no source has one.
func CommitLabel() string {
	if Commit != "" {
		return shorten(Commit)
	}

	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "unknown"
	}
	if c := commitFromSettings(info.Settings); c != "" {
		return c
	}

	return "unknown"
}

// commitFromSettings returns the short vcs.revision, with "-dirty" when
// vcs.modified is set, or "" when the build has no revision.
func commitFromSettings(settings []debug.BuildSetting) string {
	var revision, modified string
	for _, s := range settings {
		switch s.Key {
		case "vcs.revision":
			revision = s.Value
		case "vcs.modified":
			modified = s.Value
		default:
		}
	}
	if revision == "" {
		return ""
	}

	short := shorten(revision)
	if modified == "true" {
		short += "-dirty"
	}

	return short
}

// shorten truncates a commit to shortCommitLen characters, keeping a trailing
// "-dirty" marker.
func shorten(commit string) string {
	suffix := ""
	if rest, found := strings.CutSuffix(commit, "-dirty"); found {
		commit, suffix = rest, "-dirty"
	}
	if len(commit) > shortCommitLen {
		commit = commit[:shortCommitLen]
	}

	return commit + suffix
}
