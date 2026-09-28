import { create } from '@bufbuild/protobuf';

import {
  CompanionMode,
  CompanionOneShot,
  EnemyKind as WireEnemyKind,
  Engine,
  Shield,
  ShipStateSchema,
  Weapon,
  type ShipState,
} from '../gen/voidmarch/v1/messages_pb.js';
import type { Mode } from '../ordermenu.ts';
import type { OneShotOrder } from '../ordermenu.ts';
import type { EnemyKind } from '../sim/enemies.ts';
import { DAMAGE_STATES, DEFAULT_LOADOUT, type EngineId, type Loadout, type ShieldId, type WeaponId } from '../sim/loadout.ts';
import type { Ship } from '../simwasm.ts';

const WEAPONS: Readonly<Record<WeaponId, Weapon>> = {
  autoCannon: Weapon.AUTO_CANNON,
  rockets: Weapon.ROCKETS,
  bigSpaceGun: Weapon.BIG_SPACE_GUN,
  zapper: Weapon.ZAPPER,
};

const ENGINES: Readonly<Record<EngineId, Engine>> = {
  base: Engine.BASE,
  bigPulse: Engine.BIG_PULSE,
  burst: Engine.BURST,
  supercharged: Engine.SUPERCHARGED,
};

const SHIELDS: Readonly<Record<ShieldId, Shield>> = {
  front: Shield.FRONT,
  frontAndSide: Shield.FRONT_AND_SIDE,
  round: Shield.ROUND,
  invincibility: Shield.INVINCIBILITY,
};

function reverse<K extends string, V>(map: Readonly<Record<K, V>>): Map<V, K> {
  return new Map(Object.entries(map).map(([k, v]) => [v as V, k as K]));
}

const WEAPON_IDS = reverse(WEAPONS);
const ENGINE_IDS = reverse(ENGINES);
const SHIELD_IDS = reverse(SHIELDS);

export const toWeapon = (id: WeaponId): Weapon => WEAPONS[id];

/** The sim's enemy kind for a wire kind; anything unknown is drawn as a Scout. */
export const fromEnemyKind = (kind: WireEnemyKind): EnemyKind => (kind === WireEnemyKind.FIGHTER ? 'fighter' : 'scout');

/** The sim's weapon for a wire weapon; unknown values fall back to the default. */
export const fromWeapon = (w: Weapon): WeaponId => WEAPON_IDS.get(w) ?? DEFAULT_LOADOUT.weapon;

/** A remote ship as the scene draws it. */
export interface RemoteShip {
  x: number;
  y: number;
  angle: number;
  thrusting: boolean;
  loadout: Loadout;
  damage: number;
  shield: number;
}

/** The local ship as its wire state. */
export function toShipState(ship: Ship): ShipState {
  return create(ShipStateSchema, {
    x: ship.x,
    y: ship.y,
    vx: ship.vx,
    vy: ship.vy,
    angle: ship.angle,
    thrusting: ship.thrusting,
    loadout: {
      weapon: WEAPONS[ship.loadout.weapon],
      engine: ENGINES[ship.loadout.engine],
      shield: SHIELDS[ship.loadout.shield],
    },
    damage: ship.damage,
    shield: ship.shield,
  });
}

/** A wire state as a remote ship, with unknown parts shown as the defaults. */
export function fromShipState(state: ShipState): RemoteShip {
  const loadout = state.loadout;

  return {
    x: state.x,
    y: state.y,
    angle: state.angle,
    thrusting: state.thrusting,
    loadout: {
      weapon: fromWeapon(loadout?.weapon ?? Weapon.UNSPECIFIED),
      engine: ENGINE_IDS.get(loadout?.engine ?? Engine.UNSPECIFIED) ?? DEFAULT_LOADOUT.engine,
      shield: SHIELD_IDS.get(loadout?.shield ?? Shield.UNSPECIFIED) ?? DEFAULT_LOADOUT.shield,
    },
    damage: Math.min(state.damage, DAMAGE_STATES.length - 1),
    shield: state.shield,
  };
}

const MODES: Readonly<Record<Mode, CompanionMode>> = {
  escort: CompanionMode.ESCORT,
  attack: CompanionMode.ATTACK,
  guard: CompanionMode.GUARD,
  hold: CompanionMode.HOLD,
  stealth: CompanionMode.STEALTH,
};

/** The wire mode for a squadron order. */
export const toCompanionMode = (mode: Mode): CompanionMode => MODES[mode];

/** The mode on the wire, or undefined for none (a one-shot order). */
export const fromCompanionMode = (mode: CompanionMode): Mode | undefined =>
  (Object.keys(MODES) as Mode[]).find((m) => MODES[m] === mode);

const ONE_SHOTS: Readonly<Record<'focus' | 'regroup' | 'goHome', CompanionOneShot>> = {
  focus: CompanionOneShot.FOCUS,
  regroup: CompanionOneShot.REGROUP,
  goHome: CompanionOneShot.GO_HOME,
};

/** The wire one-shot for a squadron order. */
export const toCompanionOneShot = (oneShot: OneShotOrder): CompanionOneShot => ONE_SHOTS[oneShot];

/** The one-shot on the wire, or undefined for none (a mode order). */
export const fromCompanionOneShot = (
  oneShot: CompanionOneShot,
): OneShotOrder | undefined =>
  (Object.keys(ONE_SHOTS) as (keyof typeof ONE_SHOTS)[]).find((k) => ONE_SHOTS[k] === oneShot);
