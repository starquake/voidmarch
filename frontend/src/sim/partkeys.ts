/**
 * The part list a tap of 1, 2 or 3 shows (#259): it closes a while after the
 * last tap. A list only the pointer has used stays until it is closed.
 */
import { PART_LIST_IDLE_MS } from './tuning.ts';

/** Times the part list the keys showed; times are milliseconds on one clock. */
export class PartListTimer<S extends string> {
  private list: { slot: S; at: number } | undefined;

  /** A part key was tapped, and its slot's list is open. */
  tapped(slot: S, at: number): void {
    this.list = { slot, at };
  }

  /**
   * Every frame, with the slot whose list is open now: whether to close it.
   * A list the pointer closed or moved to another slot is forgotten.
   */
  due(at: number, open: S | undefined): boolean {
    const list = this.list;
    if (list === undefined || list.slot !== open) {
      this.list = undefined;

      return false;
    }
    if (at - list.at < PART_LIST_IDLE_MS) {
      return false;
    }
    this.list = undefined;

    return true;
  }
}
