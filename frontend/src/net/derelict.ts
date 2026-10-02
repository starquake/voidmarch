import { DERELICT_HOLD_RADIUS } from '../sim/rules.gen.ts';

/** A derelict's label (#52): DERELICT and the time left before it drifts off, as m:ss. */
export function derelictLabel(goneTick: number, tick: number, tickRate: number): string {
  const seconds = Math.max(0, Math.ceil((goneTick - tick) / tickRate));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;

  return `DERELICT ${String(m)}:${String(s).padStart(2, '0')}`;
}

/** A held derelict's label (#114): who holds it, as far as the client sees, until they're gone. */
export function heldLabel(holders: number): string {
  return holders > 0 ? `DERELICT · HELD BY ${String(holders)}` : 'DERELICT · HELD';
}

/** How many of the enemies are near enough to hold a derelict at (x, y). */
export function holders(x: number, y: number, enemies: readonly { x: number; y: number }[]): number {
  return enemies.filter((e) => Math.hypot(e.x - x, e.y - y) < DERELICT_HOLD_RADIUS).length;
}

/** The HUD notice for a rescue: who did it, and the hangar now, or that it's full and the ship didn't join. */
export function rescueNotice(name: string, hangar: number, docked: boolean): string {
  return docked ? `${name} rescued a ship · hangar ${String(hangar)}` : `${name} rescued a ship · the hangar is full`;
}
