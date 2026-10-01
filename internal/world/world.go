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

// Map is a world's layout.
type Map struct {
	Name string `json:"name"`
	// Bosses are where encounter bosses sit, one per spot.
	Bosses []Boss `json:"bosses"`
	// Derelicts are where a derelict ship always waits to be rescued: a new
	// one comes as soon as the last is rescued or gone (#52).
	Derelicts []Spot `json:"derelicts,omitempty"`
}

// Spot is a place on the map.
type Spot struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// Boss is an encounter boss's spot.
type Boss struct {
	// Kind is the enemy class, such as "frigate".
	Kind string  `json:"kind"`
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
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
	}

	return &m, nil
}

// Spots are the positions of the bosses of kind.
func (m *Map) Spots(kind string) [][2]float64 {
	var out [][2]float64
	for _, b := range m.Bosses {
		if b.Kind == kind {
			out = append(out, [2]float64{b.X, b.Y})
		}
	}

	return out
}
