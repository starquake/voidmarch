package world_test

import (
	"errors"
	"slices"
	"testing"

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
		if got, want := len(m.Spots("frigate")), 1; got != want {
			t.Errorf("%s has %d Frigate spots, want %d", name, got, want)
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

	m, err := Parse(
		[]byte(
			`{"name":"t","bosses":[{"kind":"frigate","x":1,"y":2},{"kind":"other","x":3,"y":4}]}`,
		),
	)
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	if got := m.Spots("frigate"); len(got) != 1 || got[0] != [2]float64{1, 2} {
		t.Errorf("Spots(frigate) = %v, want [[1 2]]", got)
	}
	for _, bad := range []string{`{`, `{"bosses":[]}`, `{"name":"t","bosses":[{"x":1}]}`} {
		if _, err = Parse([]byte(bad)); !errors.Is(err, ErrInvalidMap) {
			t.Errorf("Parse(%s) error = %v, want %v", bad, err, ErrInvalidMap)
		}
	}
}
