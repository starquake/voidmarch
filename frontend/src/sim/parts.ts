/** Parts as players see them: their names, tiers and colors (#77). */
import { DEFAULT_LOADOUT, ENGINES, SHIELDS, TIER_NAMES, WEAPONS, type EngineId, type ShieldId, type WeaponId } from './rules.gen.ts';
import { TIER_COLORS } from './tuning.ts';
import type { Loadout } from '../simwasm.ts';

/** Any weapon, engine or shield; their ids don't overlap. */
export type PartId = WeaponId | EngineId | ShieldId;

/** The parts a player owns, each at its tier (0 plain to MAX_TIER). */
export type Unlocks = ReadonlyMap<PartId, number>;

/** Every part, weapons, then engines, then shields, as the Go sim lists them. */
export const PARTS: readonly PartId[] = [...WEAPONS, ...ENGINES, ...SHIELDS];

/** Each part's name, as the packs call them. */
export const PART_NAMES: Readonly<Record<PartId, string>> = {
  autoCannon: 'Auto Cannon',
  rockets: 'Rockets',
  bigSpaceGun: 'Big Space Gun',
  zapper: 'Zapper',
  base: 'Base Engine',
  bigPulse: 'Big Pulse Engine',
  burst: 'Burst Engine',
  supercharged: 'Supercharged Engine',
  front: 'Front Shield',
  frontAndSide: 'Front and Side Shield',
  round: 'Round Shield',
  invincibility: 'Invincibility Shield',
};

/** What each part does, in a few words, for the gauge's drop-up (#191). */
export const PART_HINTS: Readonly<Record<PartId, string>> = {
  autoCannon: 'steady and precise',
  rockets: 'seek the nearest enemy',
  bigSpaceGun: 'charges, then bursts into shards',
  zapper: 'a zigzag beam that pierces',
  base: 'balanced',
  bigPulse: 'fast, but drifts',
  burst: 'snappy, but slow',
  supercharged: 'quick and fast',
  front: '3 charges, the front',
  frontAndSide: '2 charges, front and sides',
  round: '1 charge, all round',
  invincibility: '3 charges all round, slow to recharge',
};

/** The parts a slot's drop-up offers (#191): the ones this player owns, or every part where anything goes. */
export function ownedParts<T extends PartId>(parts: readonly T[], unlocks: Unlocks | undefined): T[] {
  return unlocks === undefined ? [...parts] : parts.filter((p) => unlocks.has(p));
}

/** A part's name with its tier before it: "Mega Zapper", or "Zapper" when plain. */
export function partLabel(part: PartId, tier: number): string {
  const name = TIER_NAMES[tier] ?? '';

  return name === '' ? PART_NAMES[part] : `${name} ${PART_NAMES[part]}`;
}

/** A tier's color as 0xRRGGBB, or undefined for plain. */
export const tierColor = (tier: number): number | undefined => TIER_COLORS[tier];

/** A tier's color as CSS, white for plain. */
export function tierCss(tier: number): string {
  const color = tierColor(tier);

  return color === undefined ? '#d8f8ff' : `#${color.toString(16).padStart(6, '0')}`;
}

/**
 * The tier collecting part would give this player: 0 to unlock it, one up
 * for a part they own, and undefined when they have it at every tier.
 */
export function tierFromPickup(unlocks: Unlocks, part: PartId): number | undefined {
  const tier = unlocks.get(part);
  if (tier === undefined) {
    return 0;
  }

  return tier + 1 < TIER_NAMES.length ? tier + 1 : undefined;
}

/** The loadout with each part at the tier this player owns it at. */
export function withTiers(loadout: Readonly<Loadout>, unlocks: Unlocks): Loadout {
  return {
    ...loadout,
    weaponTier: unlocks.get(loadout.weapon) ?? 0,
    engineTier: unlocks.get(loadout.engine) ?? 0,
    shieldTier: unlocks.get(loadout.shield) ?? 0,
  };
}

/** The default parts, plain: what every player owns from the start. */
export const defaultUnlocks = (): Map<PartId, number> =>
  new Map<PartId, number>([
    [DEFAULT_LOADOUT.weapon, 0],
    [DEFAULT_LOADOUT.engine, 0],
    [DEFAULT_LOADOUT.shield, 0],
  ]);

/**
 * The part a slot's key fits next (#191): the next one this player owns,
 * wrapping round, or the next of every part when unlocks is undefined (a
 * development server, or playing alone).
 */
export function nextPart<T extends PartId>(parts: readonly T[], current: T, unlocks: Unlocks | undefined): T {
  const choices = unlocks === undefined ? parts : parts.filter((p) => p === current || unlocks.has(p));
  const next = choices[(choices.indexOf(current) + 1) % choices.length];

  return next ?? current;
}
