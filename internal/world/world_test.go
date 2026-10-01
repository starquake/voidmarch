package world_test

import (
	"errors"
	"slices"
	"testing"

	"github.com/starquake/voidmarch/internal/sim"
	. "github.com/starquake/voidmarch/internal/world"
)

func TestLoad_TheEmbeddedMaps(t *testing.T) {
	t.Parallel()

	if got, want := Names(), []string{"e2e", "frontier"}; !slices.Equal(got, want) {
		t.Errorf("Names() = %v, want %v", got, want)
	}
	for _, name := range Names() {
		m, err := Load(name)
		if err != nil {
			t.Fatalf("Load(%q) error = %v", name, err)
		}
		if len(m.BossSectors("frigate")) == 0 {
			t.Errorf("%s has no Frigate", name)
		}
	}
	if _, err := Load(Default); err != nil {
		t.Errorf("the default map doesn't load: %v", err)
	}
}

func TestLoad_OnlyTheTestMapHasADerelict(t *testing.T) {
	t.Parallel()

	for name, want := range map[string]int{"e2e": 1, "frontier": 0} {
		m, err := Load(name)
		if err != nil {
			t.Fatalf("Load(%q) error = %v", name, err)
		}
		if got := len(m.Derelicts); got != want {
			t.Errorf("%s has %d derelict spots, want %d", name, got, want)
		}
	}
}

func TestLoad_UnknownMap(t *testing.T) {
	t.Parallel()

	if _, err := Load("atlantis"); !errors.Is(err, ErrUnknownMap) {
		t.Errorf("Load(atlantis) error = %v, want %v", err, ErrUnknownMap)
	}
}

func TestParse(t *testing.T) {
	t.Parallel()

	m, err := Parse([]byte(`{"name":"t",
		"bosses":[{"kind":"frigate","sector":"C3"},{"kind":"other","sector":"E5"}],
		"garrisons":{"E4":2}}`))
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if got := m.BossSectors("frigate"); len(got) != 1 || got[0].Name() != "C3" {
		t.Errorf("BossSectors(frigate) = %v, want [C3]", got)
	}
	e4, _ := sim.ParseSector("E4")
	c3, _ := sim.ParseSector("C3")
	if m.GarrisonSize(e4) != 2 || m.GarrisonSize(c3) != sim.GarrisonSize(1) {
		t.Errorf("garrisons E4 %d and C3 %d, want the map's 2 and ring 1's %d",
			m.GarrisonSize(e4), m.GarrisonSize(c3), sim.GarrisonSize(1))
	}
	for _, bad := range []string{
		`{`,
		`{"bosses":[]}`,
		`{"name":"t","bosses":[{"sector":"C3"}]}`,
		`{"name":"t","bosses":[{"kind":"frigate","sector":"Z9"}]}`,
		`{"name":"t","garrisons":{"Q1":2}}`,
		`{"name":"t","garrisons":{"C3":-1}}`,
		`{"name":"t","field":-1}`,
	} {
		if _, err = Parse([]byte(bad)); !errors.Is(err, ErrInvalidMap) {
			t.Errorf("Parse(%s) error = %v, want %v", bad, err, ErrInvalidMap)
		}
	}
}
