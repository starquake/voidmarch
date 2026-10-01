package game

import (
	"github.com/starquake/voidmarch/internal/world"
)

// frigateSpot is where the map puts a Frigate (#89).
type frigateSpot struct {
	at point
}

// WithMap lays the world out from m: where its bosses sit (#89).
func WithMap(m *world.Map) HubOption {
	return func(o *hubOptions) {
		o.worldMap = m
	}
}

// frigateSpots are m's Frigate spots, free from the start; none without a map.
func frigateSpots(m *world.Map) []frigateSpot {
	if m == nil {
		return nil
	}
	var out []frigateSpot
	for _, s := range m.Spots("frigate") {
		out = append(out, frigateSpot{at: point{x: s[0], y: s[1]}})
	}

	return out
}
