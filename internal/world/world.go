// Package world loads the game map: where things are in the shared world
// (#89). The maps are JSON, embedded in the binary; the server loads one and
// tests load their own.
package world

import (
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"path"
	"slices"
	"strings"

	"github.com/starquake/voidmarch/internal/sim"
)

//go:embed maps/*.json
var maps embed.FS

// Default is the map a server loads when none is named.
const Default = "frontier"

var (
	// ErrUnknownMap is returned for a map name no embedded map has.
	ErrUnknownMap = errors.New("unknown map")
	// ErrInvalidMap is returned for a map whose contents don't make sense.
	ErrInvalidMap = errors.New("invalid map")
)

// Map is what's in the world's sectors (#99); the grid itself is the sim's.
type Map struct {
	Name string `json:"name"`
	// Bosses are the encounter bosses, each in the middle of its sector.
	Bosses []Boss `json:"bosses"`
	// Garrisons override the size of a sector's garrison, by sector name.
	Garrisons map[string]int `json:"garrisons,omitempty"`
	// Field caps how many of a garrison fight at once; 0 leaves the hub's.
	Field int `json:"field,omitempty"`
	// NoEvents keeps world events away (#102), for a map whose tests share
	// one server.
	NoEvents bool `json:"noEvents,omitempty"`
	// Derelicts are where a derelict ship always waits to be rescued: a new
	// one comes as soon as the last is rescued or gone (#52).
	Derelicts []Spot `json:"derelicts,omitempty"`
}

// Spot is a place on the map.
type Spot struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// Boss is an encounter boss and the sector it holds.
type Boss struct {
	// Kind is the enemy class, such as "frigate".
	Kind   string `json:"kind"`
	Sector string `json:"sector"`
}

// Names lists the embedded maps, sorted.
func Names() []string {
	// The pattern is a constant, so Glob's one error, ErrBadPattern, can't happen.
	files, _ := fs.Glob(maps, "maps/*.json")
	names := make([]string, 0, len(files))
	for _, f := range files {
		names = append(names, strings.TrimSuffix(path.Base(f), ".json"))
	}
	slices.Sort(names)

	return names
}

// Load reads the embedded map name.
func Load(name string) (*Map, error) {
	if !slices.Contains(Names(), name) {
		return nil, fmt.Errorf("%w: %q, have %v", ErrUnknownMap, name, Names())
	}
	data, err := maps.ReadFile("maps/" + name + ".json")
	if err != nil {
		return nil, fmt.Errorf("error reading map %s: %w", name, err)
	}

	return Parse(data)
}

// Parse reads a map from JSON and checks it.
func Parse(data []byte) (*Map, error) {
	var m Map
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidMap, err)
	}
	if m.Name == "" {
		return nil, fmt.Errorf("%w: no name", ErrInvalidMap)
	}
	for i, b := range m.Bosses {
		if b.Kind == "" {
			return nil, fmt.Errorf("%w: boss %d has no kind", ErrInvalidMap, i)
		}
		if _, ok := sim.ParseSector(b.Sector); !ok {
			return nil, fmt.Errorf("%w: boss %d is in sector %q", ErrInvalidMap, i, b.Sector)
		}
	}
	if m.Field < 0 {
		return nil, fmt.Errorf("%w: a field of %d", ErrInvalidMap, m.Field)
	}
	for name, size := range m.Garrisons {
		if _, ok := sim.ParseSector(name); !ok || size < 0 {
			return nil, fmt.Errorf("%w: garrison of %d in sector %q", ErrInvalidMap, size, name)
		}
	}

	return &m, nil
}

// BossSectors are the sectors holding a boss of kind.
func (m *Map) BossSectors(kind string) []sim.Sector {
	var out []sim.Sector
	for _, b := range m.Bosses {
		if s, ok := sim.ParseSector(b.Sector); ok && b.Kind == kind {
			out = append(out, s)
		}
	}

	return out
}

// GarrisonSize is the base size of a sector's garrison: the map's own, or
// the sim's for its ring.
func (m *Map) GarrisonSize(s sim.Sector) int {
	if size, ok := m.Garrisons[s.Name()]; ok {
		return size
	}

	return sim.GarrisonSize(s.Ring())
}
