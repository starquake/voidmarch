import { normalize } from './math.ts';

/** Ship-relative: W thrusts toward the aim. Screen-relative: W moves up the screen. */
export const CONTROL_MODES = ['ship', 'screen'] as const;
export type ControlMode = (typeof CONTROL_MODES)[number];

/** Raw controls for one tick: WASD, the pointer in world space, and the fire button; a touch stick gives an analog move instead of the keys (#180). */
export interface InputSnapshot {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  moveX?: number;
  moveY?: number;
  pointerX: number;
  pointerY: number;
  fire: boolean;
}

/** What the ship is told to do for one tick. move is unit length or zero. */
export interface ShipCommand {
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  fire: boolean;
}

/** Turns held keys, or an analog stick capped at full length, into a movement, so diagonals are no faster. */
export function toCommand(input: InputSnapshot): ShipCommand {
  const move =
    input.moveX === undefined || input.moveY === undefined
      ? normalize(Number(input.right) - Number(input.left), Number(input.down) - Number(input.up))
      : capped(input.moveX, input.moveY);

  return { moveX: move.x, moveY: move.y, aimX: input.pointerX, aimY: input.pointerY, fire: input.fire };
}

/** x, y shortened to length 1 when longer. */
function capped(x: number, y: number): { x: number; y: number } {
  const length = Math.hypot(x, y);

  return length > 1 ? { x: x / length, y: y / length } : { x, y };
}
