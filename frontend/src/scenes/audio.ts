import Phaser from 'phaser';

import { engineMix, nextVariant, shotDetune } from '../mix.ts';
import type { AudioSettings } from '../settings.ts';
import type { EngineId, WeaponId } from '../sim/loadout.ts';
import type { FrameEvents } from '../sim/sandbox.ts';
import { isWeapon } from '../sim/projectiles.ts';
import type { Ship } from '../sim/ship.ts';
import { ENGINE_STATS, WEAPON_STATS } from '../sim/tuning.ts';
import {
  CHARGE_SOUNDS,
  ENEMY_EXPLOSION_SOUND,
  ENEMY_SHOT_SOUND,
  ENGINE_LOOPS,
  EXPIRE_SOUNDS,
  MUSIC,
  PART_SWITCH_SOUND,
  SHIELD_SOUND,
  SHOT_SOUNDS,
  musicFiles,
} from '../sounds.ts';

type Sound = Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound | Phaser.Sound.NoAudioSound;

const SHOT_VOLUME = 0.35;
/** Other players' shots, relative to your own. */
const REMOTE_SHOT_VOLUME = 0.5;
const ENEMY_SHOT_VOLUME = 0.15;
/** Enemy shots sound lower than yours, in cents. */
const ENEMY_SHOT_DETUNE = -600;
const CHARGE_VOLUME = 0.3;
/** Pitches the charge above the shield sound it shares a source with. */
const CHARGE_DETUNE = 300;
const EXPIRE_VOLUME = 0.3;
const UI_VOLUME = 0.3;
const MUSIC_VOLUME = 0.3;

/** Plays the ship's sounds and the music, driven by the sim's frame events. */
export class ShipAudio {
  private engine: Sound | undefined;
  private engineId: EngineId | undefined;
  private music: Sound | undefined;
  private musicIndex = 0;
  private musicLoaded = false;
  private shots = 0;
  private readonly scene: Phaser.Scene;
  private readonly settings: AudioSettings;

  constructor(scene: Phaser.Scene, settings: AudioSettings) {
    this.scene = scene;
    this.settings = settings;
    scene.sound.mute = settings.muted;
    scene.sound.pauseOnBlur = true;
    this.loadMusic();
  }

  /** Whether the music has finished loading. */
  get musicReady(): boolean {
    return this.musicLoaded;
  }

  /** Which sound backend Phaser picked for this browser. */
  get backend(): string {
    const sound = this.scene.sound;
    if (sound instanceof Phaser.Sound.WebAudioSoundManager) {
      return 'webaudio';
    }

    return sound instanceof Phaser.Sound.HTML5AudioSoundManager ? 'html5' : 'none';
  }

  /** The key of the playing track, or null. */
  get playingMusic(): string | null {
    return this.music?.isPlaying === true ? this.music.key : null;
  }

  /** Swaps the engine loop to match the fitted engine. */
  setEngine(id: EngineId): void {
    if (id === this.engineId) {
      return;
    }
    this.engine?.destroy();
    this.engineId = id;
    this.engine = this.scene.sound.add(ENGINE_LOOPS[id], { loop: true, volume: 0 });
    this.engine.play();
  }

  update(ship: Ship, events: FrameEvents): void {
    if (this.engine !== undefined) {
      const mix = engineMix(Math.hypot(ship.vx, ship.vy), ENGINE_STATS[ship.loadout.engine].maxSpeed, ship.thrusting);
      this.engine.setVolume(mix.volume);
      this.engine.setRate(mix.rate);
    }
    for (const weapon of events.charges) {
      const key = CHARGE_SOUNDS[weapon];
      if (key !== undefined) {
        this.scene.sound.play(key, { volume: CHARGE_VOLUME, detune: CHARGE_DETUNE });
      }
    }
    const volleys = new Set<string>();
    for (const shot of events.shots) {
      // Weapons that fire every muzzle at once (the zapper's two prongs) get one sound per volley.
      const volley = WEAPON_STATS[shot.weapon].alternate ? `${shot.weapon}-${shot.muzzle}-${volleys.size}` : shot.weapon;
      if (volleys.has(volley)) {
        continue;
      }
      volleys.add(volley);
      const key = nextVariant(SHOT_SOUNDS[shot.weapon], this.shots++);
      if (key !== undefined) {
        this.scene.sound.play(key, { volume: SHOT_VOLUME, detune: shotDetune(Math.random) });
      }
    }
    for (const expired of events.expired) {
      const key = isWeapon(expired.kind) ? EXPIRE_SOUNDS[expired.kind] : undefined;
      if (key !== undefined) {
        this.scene.sound.play(key, { volume: EXPIRE_VOLUME, detune: shotDetune(Math.random) });
      }
    }
  }

  /** Another player's shot: the same sound, quieter. */
  remoteShot(weapon: WeaponId): void {
    const key = nextVariant(SHOT_SOUNDS[weapon], this.shots++);
    if (key !== undefined) {
      this.scene.sound.play(key, { volume: SHOT_VOLUME * REMOTE_SHOT_VOLUME, detune: shotDetune(Math.random) });
    }
  }

  /** An enemy's shot: the auto cannon, lower and quieter. */
  enemyShot(): void {
    this.scene.sound.play(ENEMY_SHOT_SOUND, { volume: ENEMY_SHOT_VOLUME, detune: ENEMY_SHOT_DETUNE + shotDetune(Math.random) });
  }

  enemyDestroyed(): void {
    this.scene.sound.play(ENEMY_EXPLOSION_SOUND, { volume: EXPIRE_VOLUME, detune: shotDetune(Math.random) });
  }

  shieldSwitched(): void {
    this.scene.sound.play(SHIELD_SOUND, { volume: UI_VOLUME });
  }

  partSwitched(): void {
    this.scene.sound.play(PART_SWITCH_SOUND, { volume: UI_VOLUME });
  }

  toggleMute(): void {
    this.settings.muted = !this.settings.muted;
    this.scene.sound.mute = this.settings.muted;
  }

  toggleMusic(): void {
    this.settings.music = !this.settings.music;
    if (this.settings.music) {
      this.playMusic();
    } else {
      this.music?.stop();
    }
  }

  /** Loads the music after the game has started, so it never delays the first frame. */
  private loadMusic(): void {
    const loader = this.scene.load;
    for (const file of musicFiles()) {
      loader.audio(file.key, file.urls);
    }
    loader.once(Phaser.Loader.Events.COMPLETE, () => {
      this.musicLoaded = true;
      this.playMusic();
    });
    loader.start();
  }

  private playMusic(): void {
    if (!this.musicLoaded || !this.settings.music || this.music?.isPlaying === true) {
      return;
    }
    // Browsers keep audio locked until the first click or key press.
    if (this.scene.sound.locked) {
      this.scene.sound.once(Phaser.Sound.Events.UNLOCKED, () => {
        this.playMusic();
      });

      return;
    }
    const key = MUSIC[this.musicIndex % MUSIC.length] ?? MUSIC[0];
    this.music?.destroy();
    this.music = this.scene.sound.add(key, { volume: MUSIC_VOLUME });
    this.music.once(Phaser.Sound.Events.COMPLETE, () => {
      this.musicIndex++;
      this.playMusic();
    });
    this.music.play();
  }
}
