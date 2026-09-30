package sim

import (
	"slices"
)

// Tier is a part's upgrade: plain, then Super, Mega and Hyper (#6, decision 5).
type Tier int

// The tiers, plain first.
const (
	TierPlain Tier = iota
	TierSuper
	TierMega
	TierHyper
)

// Boost is the factor a tier multiplies a part's own strength by.
func (t Tier) Boost() float64 {
	return 1 + TierBoost*float64(t)
}

// Name is the tier's word before a part's name; empty for plain.
func (t Tier) Name() string {
	switch t {
	case TierSuper:
		return "Super"
	case TierMega:
		return "Mega"
	case TierHyper:
		return "Hyper"
	case TierPlain:
		fallthrough
	default:
		return ""
	}
}

// WeaponStatsAt is a weapon's stats at a tier: it fires faster.
func WeaponStatsAt(id WeaponID, tier Tier) WeaponStats {
	stats := WeaponStatsOf(id)
	stats.Interval /= tier.Boost()

	return stats
}

// EngineStatsAt is an engine's stats at a tier: it accelerates harder.
func EngineStatsAt(id EngineID, tier Tier) EngineStats {
	stats := EngineStatsOf(id)
	stats.Acceleration *= tier.Boost()

	return stats
}

// ShieldStatsAt is a shield's stats at a tier: it recharges faster.
func ShieldStatsAt(id ShieldID, tier Tier) ShieldStats {
	stats := ShieldStatsOf(id)
	stats.Recharge /= tier.Boost()

	return stats
}

// Part is any weapon, engine or shield; their ids don't overlap.
type Part string

// Parts lists every part, weapons, then engines, then shields.
func Parts() []Part {
	parts := make([]Part, 0, len(Weapons())+len(Engines())+len(Shields()))
	for _, w := range Weapons() {
		parts = append(parts, Part(w))
	}
	for _, e := range Engines() {
		parts = append(parts, Part(e))
	}
	for _, s := range Shields() {
		parts = append(parts, Part(s))
	}

	return parts
}

// Unlocks are the parts a player owns, each at its tier.
type Unlocks map[Part]Tier

// DefaultUnlocks are a new player's parts: the default loadout, plain.
func DefaultUnlocks() Unlocks {
	l := DefaultLoadout()

	return Unlocks{Part(l.Weapon): TierPlain, Part(l.Engine): TierPlain, Part(l.Shield): TierPlain}
}

// Lacks reports whether the player doesn't own part yet.
func (u Unlocks) Lacks(part Part) bool {
	_, owned := u[part]

	return !owned
}

// CanUse reports whether collecting part would change anything: the player
// lacks it or can raise its tier.
func (u Unlocks) CanUse(part Part) bool {
	tier, owned := u[part]

	return !owned || tier < TierHyper
}

// Grant unlocks part, or raises its tier, and reports whether it changed.
func (u Unlocks) Grant(part Part) bool {
	tier, owned := u[part]
	switch {
	case !owned:
		u[part] = TierPlain
	case tier < TierHyper:
		u[part] = tier + 1
	default:
		return false
	}

	return true
}

// Level is how far a player has come: a point for each part owned and each
// tier above plain.
func (u Unlocks) Level() int {
	level := 0
	for _, tier := range u {
		level += 1 + int(tier)
	}

	return level
}

// Behind reports whether a player is below the average level of their
// squadmates, which makes drops near them likelier (#6, decision 14).
func Behind(player Unlocks, squadmates []Unlocks) bool {
	if len(squadmates) == 0 {
		return false
	}
	total := 0
	for _, u := range squadmates {
		total += u.Level()
	}

	return float64(player.Level()) < float64(total)/float64(len(squadmates))
}

// DropChance is the chance a kill of kind drops a part, before catch-up.
func DropChance(kind EnemyKind) float64 {
	switch kind {
	case EnemyFighter:
		return FighterDropChance
	case EnemyScout:
		fallthrough
	default:
		return ScoutDropChance
	}
}

// DropFor rolls a kill's drop at chance (DropChance for its kind), pure and
// seeded. nearby are the players within DropReach, behind those of them
// below their squadron. The chance doubles when anyone is behind, and the part is one a player behind can
// use, else one a nearby player lacks, else one a nearby player can raise.
// No part anyone nearby can use means no drop.
func DropFor(nearby, behind []Unlocks, chance float64, seed uint32) (Part, bool) {
	r := NewRandom(seed)
	if len(behind) > 0 {
		chance *= CatchUpDrops
	}
	if r.Next() >= chance {
		return "", false
	}
	candidates := partsWhere(behind, Unlocks.CanUse)
	if len(candidates) == 0 {
		candidates = partsWhere(nearby, Unlocks.Lacks)
	}
	if len(candidates) == 0 {
		candidates = partsWhere(nearby, Unlocks.CanUse)
	}
	if len(candidates) == 0 {
		return "", false
	}

	return candidates[int(r.Next()*float64(len(candidates)))], true
}

// partsWhere lists the parts, in Parts order, that ok holds for with any of
// players.
func partsWhere(players []Unlocks, ok func(Unlocks, Part) bool) []Part {
	var out []Part
	for _, p := range Parts() {
		if slices.ContainsFunc(players, func(u Unlocks) bool { return ok(u, p) }) {
			out = append(out, p)
		}
	}

	return out
}
