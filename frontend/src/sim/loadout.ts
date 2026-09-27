/** Weapons in the order the debug key cycles them. */
export const WEAPONS = ['autoCannon', 'rockets', 'bigSpaceGun', 'zapper'] as const;
/** Engines in the order the debug key cycles them. */
export const ENGINES = ['base', 'bigPulse', 'burst', 'supercharged'] as const;
/** Shields in the order the debug key cycles them. */
export const SHIELDS = ['front', 'frontAndSide', 'round', 'invincibility'] as const;
/** Hull sprites from full health to downed; the index is the hits taken. */
export const DAMAGE_STATES = ['fullHealth', 'slightDamage', 'damaged', 'veryDamaged'] as const;

export type WeaponId = (typeof WEAPONS)[number];
export type EngineId = (typeof ENGINES)[number];
export type ShieldId = (typeof SHIELDS)[number];
export type DamageState = (typeof DAMAGE_STATES)[number];

/** One part per slot; see docs/design.md, "Loadout". */
export interface Loadout {
  weapon: WeaponId;
  engine: EngineId;
  shield: ShieldId;
}

/** The parts every new player starts with. */
export const DEFAULT_LOADOUT: Readonly<Loadout> = { weapon: 'autoCannon', engine: 'base', shield: 'front' };

/** Returns the entry after current in list, wrapping around. */
export function nextInCycle<T>(list: readonly T[], current: T): T {
  const next = list[(list.indexOf(current) + 1) % list.length];
  if (next === undefined) {
    throw new Error('nextInCycle: empty list');
  }

  return next;
}
