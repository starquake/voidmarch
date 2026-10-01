/** A derelict's label (#52): DERELICT and the time left before it drifts off, as m:ss. */
export function derelictLabel(goneTick: number, tick: number, tickRate: number): string {
  const seconds = Math.max(0, Math.ceil((goneTick - tick) / tickRate));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;

  return `DERELICT ${String(m)}:${String(s).padStart(2, '0')}`;
}

/** The HUD notice for a rescue: who did it, and the hangar now, or that it's full and the ship didn't join. */
export function rescueNotice(name: string, hangar: number, docked: boolean): string {
  return docked ? `${name} rescued a ship · hangar ${String(hangar)}` : `${name} rescued a ship · the hangar is full`;
}
