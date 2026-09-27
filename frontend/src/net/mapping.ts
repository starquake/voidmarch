import { create } from '@bufbuild/protobuf';

import {
  Engine,
  Shield,
  ShipStateSchema,
  Weapon,
  type ShipState,
} from '../gen/voidmarch/v1/messages_pb.js';
import { DAMAGE_STATES, DEFAULT_LOADOUT, type EngineId, type Loadout, type ShieldId, type WeaponId } from '../sim/loadout.ts';
import type { Ship } from '../sim/ship.ts';

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
  };
}
