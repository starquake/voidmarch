package sim

// WeaponID names a weapon from the Main Ship pack.
type WeaponID string

// The weapons, in the order the debug key cycles them.
const (
	WeaponAutoCannon  WeaponID = "autoCannon"
	WeaponRockets     WeaponID = "rockets"
	WeaponBigSpaceGun WeaponID = "bigSpaceGun"
	WeaponZapper      WeaponID = "zapper"
)

// EngineID names an engine from the Main Ship pack.
type EngineID string

// The engines, in the order the debug key cycles them.
const (
	EngineBase         EngineID = "base"
	EngineBigPulse     EngineID = "bigPulse"
	EngineBurst        EngineID = "burst"
	EngineSupercharged EngineID = "supercharged"
)

// ShieldID names a shield from the Main Ship pack.
type ShieldID string

// The shields, in the order the debug key cycles them.
const (
	ShieldFront         ShieldID = "front"
	ShieldFrontAndSide  ShieldID = "frontAndSide"
	ShieldRound         ShieldID = "round"
	ShieldInvincibility ShieldID = "invincibility"
)

// Weapons lists every weapon.
func Weapons() []WeaponID {
	return []WeaponID{WeaponAutoCannon, WeaponRockets, WeaponBigSpaceGun, WeaponZapper}
}

// Engines lists every engine.
func Engines() []EngineID {
	return []EngineID{EngineBase, EngineBigPulse, EngineBurst, EngineSupercharged}
}

// Shields lists every shield.
func Shields() []ShieldID {
	return []ShieldID{ShieldFront, ShieldFrontAndSide, ShieldRound, ShieldInvincibility}
}

// Loadout is one part per slot (docs/design.md, "Loadout"), each at its tier.
type Loadout struct {
	Weapon     WeaponID `json:"weapon"`
	Engine     EngineID `json:"engine"`
	Shield     ShieldID `json:"shield"`
	WeaponTier Tier     `json:"weaponTier,omitempty"`
	EngineTier Tier     `json:"engineTier,omitempty"`
	ShieldTier Tier     `json:"shieldTier,omitempty"`
}

// WeaponStats is the fitted weapon's stats at its tier.
func (l Loadout) WeaponStats() WeaponStats {
	return WeaponStatsAt(l.Weapon, l.WeaponTier)
}

// EngineStats is the fitted engine's stats at its tier.
func (l Loadout) EngineStats() EngineStats {
	return EngineStatsAt(l.Engine, l.EngineTier)
}

// ShieldStats is the fitted shield's stats at its tier.
func (l Loadout) ShieldStats() ShieldStats {
	return ShieldStatsAt(l.Shield, l.ShieldTier)
}

// DefaultLoadout is the parts every new player starts with.
func DefaultLoadout() Loadout {
	return Loadout{Weapon: WeaponAutoCannon, Engine: EngineBase, Shield: ShieldFront}
}
