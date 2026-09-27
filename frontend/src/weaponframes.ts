/** When a weapon sheet's frames happen, from the Void Main Ship pack. */
export interface WeaponTiming {
  frames: number;
  /** Frames where a shot leaves, in firing order through one cycle; frame 0 is at rest. */
  releaseFrames: readonly number[];
  /** Playback speed after a release. */
  releaseFps: number;
}

/** A pause after which a part-played cycle snaps back to rest, e.g. pods reload. */
const HOLD_SECONDS = 0.6;

interface Segment {
  start: number;
  end: number;
  startedAt: number;
  fps: number;
  /** After the last frame: back to rest now (true), or hold until the next release (false). */
  ends: boolean;
}

/**
 * Picks the weapon sprite's frame so the art matches the shots: charging frames
 * play during a charge, and each shot jumps to its own release frame, so the
 * auto cannon flashes left then right and the rocket pods empty one by one.
 */
export class WeaponAnimator {
  private readonly timing: WeaponTiming;
  private segment: Segment | undefined;
  private salvo = 0;

  constructor(timing: WeaponTiming) {
    this.timing = timing;
  }

  /** Plays the frames before the first release over the charge time. */
  charge(now: number, seconds: number): void {
    const first = this.timing.releaseFrames[0] ?? 0;
    this.segment = { start: 0, end: first - 1, startedAt: now, fps: first / seconds, ends: false };
  }

  /**
   * Jumps to the next release frame fired from muzzle. Cycles with more
   * release frames than muzzles (rocket pods) pick the next one on that side.
   */
  release(now: number, muzzle: number, muzzles: number): void {
    const count = this.timing.releaseFrames.length;
    let index = this.salvo % count;
    for (let tries = 0; tries < count && index % muzzles !== muzzle % muzzles; tries++) {
      index = (index + 1) % count;
    }
    const last = index === count - 1;
    const start = this.timing.releaseFrames[index] ?? 0;
    const next = this.timing.releaseFrames[index + 1];
    this.segment = {
      start,
      end: last || next === undefined ? this.timing.frames - 1 : next - 1,
      startedAt: now,
      fps: this.timing.releaseFps,
      ends: last,
    };
    this.salvo = last ? 0 : index + 1;
  }

  /** Back to rest, e.g. after switching weapons. */
  reset(): void {
    this.segment = undefined;
    this.salvo = 0;
  }

  frame(now: number): number {
    const segment = this.segment;
    if (segment === undefined) {
      return 0;
    }
    const elapsed = now - segment.startedAt;
    const frame = segment.start + Math.floor(elapsed * segment.fps);
    if (frame <= segment.end) {
      return Math.max(segment.start, frame);
    }
    const heldFor = elapsed - (segment.end - segment.start + 1) / segment.fps;
    if (segment.ends || heldFor > HOLD_SECONDS) {
      this.reset();

      return 0;
    }

    return segment.end;
  }
}
