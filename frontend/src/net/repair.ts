/** A Support Ship's repair line (#184): from it to the ship it repairs, both as drawn. */
export interface RepairLine {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

/** An enemy as the repair lines need it: where it's drawn this frame, if anywhere, and the enemy it repairs, 0 for none. */
export interface RepairingEnemy {
  drawn: { x: number; y: number } | undefined;
  repairing: number;
}

/** The repair lines among enemies, by id: one for each repairing ship drawn this frame whose target is drawn too. */
export function repairLines(enemies: ReadonlyMap<number, RepairingEnemy>): RepairLine[] {
  const lines: RepairLine[] = [];
  for (const e of enemies.values()) {
    const target = e.repairing === 0 ? undefined : enemies.get(e.repairing)?.drawn;
    if (e.drawn !== undefined && target !== undefined) {
      lines.push({ fromX: e.drawn.x, fromY: e.drawn.y, toX: target.x, toY: target.y });
    }
  }

  return lines;
}
