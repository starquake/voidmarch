import type { EnemyKind } from '../sim/enemies.ts';

/** A Support Ship's repair line (#184): from it to the ship it repairs, both as drawn. */
export interface RepairLine {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

/** An enemy as the repairs need it: its kind, where it's drawn this frame, if anywhere, and the enemy it repairs, 0 for none. */
export interface RepairingEnemy {
  kind: EnemyKind;
  drawn: { x: number; y: number } | undefined;
  repairing: number;
}

/** The kinds whose shield shows while they're repaired (#188); a boss's shows its own charge. */
export const REPAIR_SHIELD_KINDS: readonly EnemyKind[] = ['scout', 'fighter', 'bomber', 'torpedo'];

/** A repair whose two ships are both drawn this frame. */
interface DrawnRepair {
  line: RepairLine;
  targetId: number;
  targetKind: EnemyKind;
}

/** Every repair among enemies, by id, whose repairing ship and target are both drawn this frame. */
function drawnRepairs(enemies: ReadonlyMap<number, RepairingEnemy>): DrawnRepair[] {
  const repairs: DrawnRepair[] = [];
  for (const e of enemies.values()) {
    const target = e.repairing === 0 ? undefined : enemies.get(e.repairing);
    if (e.drawn !== undefined && target?.drawn !== undefined) {
      repairs.push({
        line: { fromX: e.drawn.x, fromY: e.drawn.y, toX: target.drawn.x, toY: target.drawn.y },
        targetId: e.repairing,
        targetKind: target.kind,
      });
    }
  }

  return repairs;
}

/** The repair lines among enemies, by id: one for each repairing ship drawn this frame whose target is drawn too. */
export function repairLines(enemies: ReadonlyMap<number, RepairingEnemy>): RepairLine[] {
  return drawnRepairs(enemies).map((r) => r.line);
}

/** The small ships whose shield shows this frame (#188): each one a repair line runs to. */
export function repairShields(enemies: ReadonlyMap<number, RepairingEnemy>): Set<number> {
  return new Set(drawnRepairs(enemies).flatMap((r) => (REPAIR_SHIELD_KINDS.includes(r.targetKind) ? [r.targetId] : [])));
}
