package game

import (
	"github.com/starquake/voidmarch/internal/sim"
)

// WithClearedSectors starts the hub with these sectors cleared, as saved
// (#99); names off the grid are ignored.
func WithClearedSectors(names []string) HubOption {
	return func(o *hubOptions) {
		o.cleared = append(o.cleared, names...)
	}
}

// WithSaveSector saves each sector the hub clears, by name, off the tick
// goroutine and in order with the other saves.
func WithSaveSector(save func(name string)) HubOption {
	return func(o *hubOptions) {
		o.saveSector = save
	}
}

// clearedSet is the cleared sectors among names.
func clearedSet(names []string) map[sim.Sector]bool {
	out := make(map[sim.Sector]bool, len(names))
	for _, name := range names {
		if s, ok := sim.ParseSector(name); ok {
			out[s] = true
		}
	}

	return out
}
