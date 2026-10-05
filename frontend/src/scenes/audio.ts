import Phaser from 'phaser';

import { engineMix, nextVariant, randomVariant, shotDetune } from '../mix.ts';
import type { AudioSettings } from '../settings.ts';
import type { EngineId, WeaponId } from '../sim/loadout.ts';
import type { MusicPlace } from '../sim/music.ts';
import { isWeapon, type FrameEvents, type Ship } from '../simwasm.ts';
import { ENGINE_STATS, WEAPON_STATS } from '../sim/tuning.ts';
import {
  CHARGE_SOUNDS,
  ENEMY_EXPLOSION_SOUND,
  ENEMY_SHOT_SOUND,
  ENGINE_LOOPS,
  FIELD_ZAP_SOUNDS,
  EXPIRE_SOUNDS,
  PART_SWITCH_SOUND,
  SHIELD_SOUND,
  SHOT_SOUNDS,
  TELEPORT_SOUND,
  musicFiles,
  musicTrack,
} from '../sounds.ts';

type Sound = Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound | Phaser.Sound.NoAudioSound;

const SHOT_VOLUME = 0.35;
/** Other players' shots, relative to your own. */
const REMOTE_SHOT_VOLUME = 0.5;
const ENEMY_SHOT_VOLUME = 0.15;
/** Enemy shots sound a little lower, in cents. */
const ENEMY_SHOT_DETUNE = -300;
const CHARGE_VOLUME = 0.3;
/** Pitches the charge above the shield sound it shares a source with. */
const CHARGE_DETUNE = 300;
const EXPIRE_VOLUME = 0.3;
const UI_VOLUME = 0.3;
const TELEPORT_VOLUME = 0.3;
const MUSIC_VOLUME = 0.3;
/** How long one place's music takes to fade into the next's. */
const MUSIC_FADE_MS = 2000;

/** Plays the ship's sounds and the music, driven by the sim's frame events. */
export class ShipAudio {
  private engine: Sound | undefined;
  private engineId: EngineId | undefined;
  /** The track playing or fading in, and those fading out. */
  private music: Sound | undefined;
  private readonly fading = new Set<Sound>();
  private place: MusicPlace = 'home';
  private readonly turns: Record<MusicPlace, number> = { home: 0, dreadnought: 0, elsewhere: 0 };
  private awaitingUnlock = false;
  /** Whether the next track fades in: after a place change, not when one track follows another. */
  private fadeInNext = false;
  private musicLoaded = false;
  private shots = 0;
  private lastZap: string | undefined;
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

  /** The playing track's volume, 0 with none. */
  get musicVolume(): number {
    return this.music?.isPlaying === true ? this.music.volume : 0;
  }

  /** How many tracks are still fading out. */
  get fadingMusic(): number {
    return this.fading.size;
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

  /** An enemy's shot: their own laser, soft and a little low. */
  enemyShot(): void {
    this.scene.sound.play(ENEMY_SHOT_SOUND, { volume: ENEMY_SHOT_VOLUME, detune: ENEMY_SHOT_DETUNE + shotDetune(Math.random) });
  }

  enemyDestroyed(): void {
    this.scene.sound.play(ENEMY_EXPLOSION_SOUND, { volume: EXPIRE_VOLUME, detune: shotDetune(Math.random) });
  }

  /** A derelict teleporting away (#190). */
  teleported(): void {
    this.scene.sound.play(TELEPORT_SOUND, { volume: TELEPORT_VOLUME });
  }

  shieldSwitched(): void {
    this.scene.sound.play(SHIELD_SOUND, { volume: UI_VOLUME });
  }

  /** A force field zap (#127), at a volume from 0 to 1: a random one, never the last one again. */
  fieldZap(volume: number): void {
    const key = randomVariant(FIELD_ZAP_SOUNDS, this.lastZap, Math.random);
    this.lastZap = key;
    if (key !== undefined) {
      this.scene.sound.play(key, { volume });
    }
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
      this.stopMusic();
    }
  }

  /** Crossfades to the place's music when the ship moves to another place (#187). */
  setMusicPlace(place: MusicPlace): void {
    if (place === this.place) {
      return;
    }
    this.place = place;
    this.fadeInNext = true;
    if (this.music !== undefined) {
      this.fadeOut(this.music);
      this.music = undefined;
    }
    this.playMusic();
  }

  /** Loads the music after the game has started, so it never delays the first frame; each track plays once it's in. */
  private loadMusic(): void {
    const loader = this.scene.load;
    for (const file of musicFiles()) {
      loader.audio(file.key, file.urls);
    }
    const loaded = (): void => {
      this.playMusic();
    };
    loader.on(Phaser.Loader.Events.FILE_COMPLETE, loaded);
    loader.once(Phaser.Loader.Events.COMPLETE, () => {
      loader.off(Phaser.Loader.Events.FILE_COMPLETE, loaded);
      this.musicLoaded = true;
      this.playMusic();
    });
    loader.start();
  }

  private playMusic(): void {
    if (!this.settings.music || this.music !== undefined) {
      return;
    }
    // Browsers keep audio locked until the first click or key press.
    if (this.scene.sound.locked) {
      if (!this.awaitingUnlock) {
        this.awaitingUnlock = true;
        this.scene.sound.once(Phaser.Sound.Events.UNLOCKED, () => {
          this.awaitingUnlock = false;
          this.playMusic();
        });
      }

      return;
    }
    const place = this.place;
    const key = musicTrack(place, this.turns[place]);
    const fading = [...this.fading].find((sound) => sound.key === key);
    if (fading !== undefined) {
      this.fading.delete(fading);
      this.music = fading;
      this.fadeInNext = false;
      this.fadeTo(fading, MUSIC_VOLUME);

      return;
    }
    if (!this.scene.cache.audio.exists(key)) {
      return;
    }
    const music = this.scene.sound.add(key, { volume: this.fadeInNext ? 0 : MUSIC_VOLUME });
    music.once(Phaser.Sound.Events.COMPLETE, () => {
      this.discard(music);
      if (this.music === music) {
        this.music = undefined;
        this.turns[place]++;
        this.playMusic();
      }
    });
    this.music = music;
    music.play();
    if (this.fadeInNext) {
      this.fadeInNext = false;
      this.fadeTo(music, MUSIC_VOLUME);
    }
  }

  private fadeOut(music: Sound): void {
    this.fading.add(music);
    this.fadeTo(music, 0, () => {
      this.discard(music);
    });
  }

  private fadeTo(music: Sound, volume: number, done?: () => void): void {
    this.scene.tweens.killTweensOf(music);
    this.scene.tweens.add({ targets: music, volume, duration: MUSIC_FADE_MS, onComplete: () => done?.() });
  }

  /** Drops a track that has faded out, finished, or been switched off. */
  private discard(music: Sound): void {
    this.scene.tweens.killTweensOf(music);
    this.fading.delete(music);
    music.destroy();
  }

  private stopMusic(): void {
    for (const music of this.fading) {
      this.discard(music);
    }
    if (this.music !== undefined) {
      this.discard(this.music);
      this.music = undefined;
    }
  }
}
