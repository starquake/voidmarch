import { normalize, rotateOffset } from './math.ts';

/** Ship-relative: W thrusts toward the aim. Screen-relative: W moves up the screen. */
export const CONTROL_MODES = ['ship', 'screen'] as const;
export type ControlMode = (typeof CONTROL_MODES)[number];

/** Raw controls for one tick: WASD, the pointer in world space, and the fire button. */
export interface InputSnapshot {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
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

/** Turns held keys into a movement direction, so diagonals are no faster. */
export function toCommand(input: InputSnapshot): ShipCommand {
  const move = normalize(Number(input.right) - Number(input.left), Number(input.down) - Number(input.up));

  return { moveX: move.x, moveY: move.y, aimX: input.pointerX, aimY: input.pointerY, fire: input.fire };
}

/**
 * Turns a screen-relative move into one relative to a ship facing angle:
 * up becomes forward and right becomes the ship's right.
 */
export function relativeTo(cmd: ShipCommand, angle: number): ShipCommand {
  const move = rotateOffset(-cmd.moveY, cmd.moveX, angle);

  return { ...cmd, moveX: move.x, moveY: move.y };
}
