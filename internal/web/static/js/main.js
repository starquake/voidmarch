// src/main.ts
import Phaser6 from "./vendor/phaser.js";

// src/display.ts
function deviceSize(cssWidth, cssHeight, devicePixelRatio) {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  return {
    width: Math.max(1, Math.floor(cssWidth * dpr)),
    height: Math.max(1, Math.floor(cssHeight * dpr)),
    zoom: 1 / dpr,
    dpr
  };
}

// src/name.ts
var MAX_NAME_LENGTH = 16;
var NAME = /^[\p{L}\p{N} _-]+$/u;
function nameProblem(raw) {
  const name = raw.trim();
  if (name === "") {
    return "Pick a name first.";
  }
  if (Array.from(name).length > MAX_NAME_LENGTH) {
    return `A name is at most ${MAX_NAME_LENGTH} characters.`;
  }
  if (!NAME.test(name)) {
    return "Use letters, digits, spaces, - or _.";
  }
  return void 0;
}
async function register(name, fetcher = fetch) {
  const response = await fetcher("/api/players", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.trim() })
  });
  const body = await response.json();
  if (!response.ok || body.token === void 0) {
    throw new RegisterError(body.error ?? `The server said ${response.status}.`);
  }
  return body.token;
}
var RegisterError = class extends Error {
  name = "RegisterError";
};
function askName() {
  const form = document.querySelector("#name-form");
  const input = document.querySelector("#name");
  const error = document.querySelector("#name-error");
  const alone = document.querySelector("#play-alone");
  if (form === null || input === null || error === null || alone === null) {
    return Promise.resolve(void 0);
  }
  form.hidden = false;
  input.focus();
  return new Promise((resolve) => {
    const done = (token) => {
      form.hidden = true;
      resolve(token);
    };
    alone.addEventListener("click", () => {
      done(void 0);
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const problem = nameProblem(input.value);
      if (problem !== void 0) {
        error.textContent = problem;
        return;
      }
      error.textContent = "";
      register(input.value).then(done).catch((err) => {
        error.textContent = err instanceof RegisterError ? err.message : "Can't reach the server. Try again, or play alone for now.";
        alone.hidden = false;
      });
    });
  });
}

// src/scenes/boot.ts
import Phaser from "./vendor/phaser.js";

// src/sounds.ts
var AUDIO = "/static/audio";
var both = (key, path) => ({ key, urls: [`${AUDIO}/${path}.ogg`, `${AUDIO}/${path}.mp3`] });
var SHOT_SOUNDS = {
  autoCannon: ["sfx-auto-cannon-0", "sfx-auto-cannon-1", "sfx-auto-cannon-2"],
  rockets: ["sfx-rocket-launch"],
  bigSpaceGun: ["sfx-big-space-gun-0", "sfx-big-space-gun-1"],
  zapper: ["sfx-zapper-0", "sfx-zapper-1", "sfx-zapper-2"]
};
var EXPIRE_SOUNDS = {
  rockets: "sfx-rocket-blast",
  bigSpaceGun: "sfx-big-blast"
};
var CHARGE_SOUNDS = {
  bigSpaceGun: "sfx-charge"
};
var ENGINE_LOOPS = {
  base: "sfx-engine-base",
  bigPulse: "sfx-engine-big-pulse",
  burst: "sfx-engine-burst",
  supercharged: "sfx-engine-supercharged"
};
var SHIELD_SOUND = "sfx-shield";
var ENEMY_EXPLOSION_SOUND = "sfx-enemy-explosion";
var ENEMY_SHOT_SOUND = "sfx-enemy-shot";
var PART_SWITCH_SOUND = "sfx-part-switch";
var MUSIC = ["music-explorer-theme-1", "music-explorer-theme-2"];
function effectFiles() {
  const files = [
    ...[0, 1, 2].map((i) => both(`sfx-auto-cannon-${i}`, `sfx/auto-cannon-${i}`)),
    ...[0, 1, 2].map((i) => both(`sfx-zapper-${i}`, `sfx/zapper-${i}`)),
    ...[0, 1].map((i) => both(`sfx-big-space-gun-${i}`, `sfx/big-space-gun-${i}`)),
    both("sfx-rocket-launch", "sfx/rocket-launch"),
    both("sfx-rocket-blast", "sfx/rocket-blast"),
    both("sfx-big-blast", "sfx/big-blast"),
    both("sfx-charge", "sfx/charge"),
    both(ENEMY_EXPLOSION_SOUND, "sfx/enemy-explosion"),
    both(ENEMY_SHOT_SOUND, "sfx/enemy-shot"),
    both(SHIELD_SOUND, "sfx/shield"),
    both(PART_SWITCH_SOUND, "sfx/part-switch"),
    both("sfx-engine-base", "sfx/engine-base"),
    both("sfx-engine-big-pulse", "sfx/engine-big-pulse"),
    both("sfx-engine-burst", "sfx/engine-burst"),
    both("sfx-engine-supercharged", "sfx/engine-supercharged")
  ];
  return files;
}
function musicFiles() {
  return MUSIC.map((key) => both(key, `music/${key.replace(/^music-/, "")}`));
}

// src/sim/loadout.ts
var WEAPONS = ["autoCannon", "rockets", "bigSpaceGun", "zapper"];
var ENGINES = ["base", "bigPulse", "burst", "supercharged"];
var SHIELDS = ["front", "frontAndSide", "round", "invincibility"];
var DAMAGE_STATES = ["fullHealth", "slightDamage", "damaged", "veryDamaged"];
var DEFAULT_LOADOUT = { weapon: "autoCannon", engine: "base", shield: "front" };
function nextInCycle(list, current) {
  const next = list[(list.indexOf(current) + 1) % list.length];
  if (next === void 0) {
    throw new Error("nextInCycle: empty list");
  }
  return next;
}

// src/sim/tuning.ts
var TICK_RATE = 60;
var TICK_SECONDS = 1 / TICK_RATE;
var MAX_TICKS_PER_FRAME = 5;
var VIEW_WIDTH = 640;
var VIEW_HEIGHT = 360;
var WORLD_HALF_SIZE = 2e3;
var WORLD_EDGE_BAND = 200;
var WORLD_EDGE_PUSH = 1400;
var ROTATION_SNAP_STEPS = 16;
var ASTEROID_SEED = 20260927;
var ASTEROID_COUNT = 60;
var ASTEROID_CLEAR_RADIUS = 260;
var ENGINE_STATS = {
  base: { acceleration: 900, maxSpeed: 220, drag: 3.5 },
  bigPulse: { acceleration: 520, maxSpeed: 300, drag: 1.2 },
  burst: { acceleration: 1700, maxSpeed: 185, drag: 7 },
  supercharged: { acceleration: 1200, maxSpeed: 270, drag: 2 }
};
var STRAIGHT = { amplitude: 0, frequency: 0 };
var WEAPON_STATS = {
  autoCannon: {
    interval: 0.13,
    charge: 0,
    speed: 520,
    acceleration: 0,
    maxSpeed: 520,
    lifetime: 0.9,
    damage: 1,
    muzzles: [
      { forward: 9, right: -10.5 },
      { forward: 9, right: 10.5 }
    ],
    alternate: true,
    zigzag: STRAIGHT,
    shake: 0
  },
  rockets: {
    interval: 0.32,
    charge: 0,
    speed: 140,
    acceleration: 900,
    maxSpeed: 560,
    lifetime: 1.5,
    damage: 4,
    muzzles: [
      { forward: 7, right: -12 },
      { forward: 7, right: 12 }
    ],
    alternate: true,
    zigzag: STRAIGHT,
    shake: 0
  },
  bigSpaceGun: {
    interval: 0.9,
    charge: 0.45,
    speed: 300,
    acceleration: 0,
    maxSpeed: 300,
    lifetime: 2,
    damage: 12,
    muzzles: [{ forward: 16, right: 0 }],
    alternate: false,
    zigzag: STRAIGHT,
    shake: 6e-3
  },
  zapper: {
    interval: 0.24,
    charge: 0.1,
    speed: 430,
    acceleration: 0,
    maxSpeed: 430,
    lifetime: 0.75,
    damage: 2,
    muzzles: [
      { forward: 15, right: -11 },
      { forward: 15, right: 11 }
    ],
    alternate: false,
    zigzag: { amplitude: 7, frequency: 5 },
    shake: 0
  }
};
var SHIELD_STATS = {
  front: { coverage: Math.PI * 0.5, strength: 3, recharge: 5 },
  frontAndSide: { coverage: Math.PI, strength: 2, recharge: 5 },
  round: { coverage: Math.PI * 2, strength: 1, recharge: 3 },
  invincibility: { coverage: Math.PI * 2, strength: 3, recharge: 12 }
};
var ENEMY_BULLET_STATS = {
  klaedBullet: { speed: 110, acceleration: 0, maxSpeed: 110, lifetime: 3.2, zigzag: STRAIGHT },
  klaedBigBullet: { speed: 130, acceleration: 0, maxSpeed: 130, lifetime: 3, zigzag: STRAIGHT }
};
var ENEMY_AIM_JITTER = 0.08;
var ENEMY_MUZZLE = 14;
var ENEMY_VOLLEY_RANGE = 800;
var ENEMY_SOUND_RANGE = 400;
var SHIP_RADIUS = 12;
var SHOT_RADIUS = 3;

// src/sprites.ts
var ASSETS = "/static/assets";
var still = (key, url, size) => ({
  key,
  url,
  frameWidth: size,
  frameHeight: size,
  frames: 1,
  fps: 0,
  loop: false
});
var KLAED_FILES = {
  scout: { engine: 10, weapons: 6, destruction: 10 },
  fighter: { engine: 10, weapons: 6, destruction: 9 }
};
var BULLET_FRAMES = {
  bullet: { width: 4, frames: 4 },
  "big-bullet": { width: 8, frames: 4 }
};
var strip = (key, url, size, frames, fps, loop = true) => ({
  key,
  url,
  frameWidth: size,
  frameHeight: size,
  frames,
  fps,
  loop
});
var WEAPON_FILES = {
  // Frame 1 flashes the left barrel, frame 2 the right, then smoke.
  autoCannon: {
    weapon: "weapon-auto-cannon",
    projectile: "projectile-auto-cannon",
    frames: 7,
    projectileFrames: 4,
    releaseFrames: [1, 2],
    releaseFps: 16
  },
  // Two pods of three; a rocket leaves every second frame, left pod first.
  rockets: {
    weapon: "weapon-rockets",
    projectile: "projectile-rocket",
    frames: 17,
    projectileFrames: 3,
    releaseFrames: [2, 4, 6, 8, 10, 12],
    releaseFps: 2 / WEAPON_STATS.rockets.interval
  },
  // Frames 0-6 glow up while charging; the recoil starts on frame 7.
  bigSpaceGun: {
    weapon: "weapon-big-space-gun",
    projectile: "projectile-big-space-gun",
    frames: 12,
    projectileFrames: 10,
    releaseFrames: [7],
    releaseFps: 12
  },
  // The prongs light up over frames 2-7 and discharge after.
  zapper: {
    weapon: "weapon-zapper",
    projectile: "projectile-zapper",
    frames: 14,
    projectileFrames: 8,
    releaseFrames: [7],
    releaseFps: 30
  }
};
function weaponTiming(id) {
  const f = WEAPON_FILES[id];
  return { frames: f.frames, releaseFrames: f.releaseFrames, releaseFps: f.releaseFps };
}
var ENGINE_FILES = {
  base: { file: "engine-base", idle: 3, powering: 4 },
  bigPulse: { file: "engine-big-pulse", idle: 4, powering: 4 },
  burst: { file: "engine-burst", idle: 7, powering: 6 },
  supercharged: { file: "engine-supercharged", idle: 4, powering: 4 }
};
var SHIELD_FILES = {
  front: { file: "shield-front", frames: 10 },
  frontAndSide: { file: "shield-front-and-side", frames: 6 },
  round: { file: "shield-round", frames: 12 },
  invincibility: { file: "shield-invincibility", frames: 10 }
};
var HULL_FILES = {
  fullHealth: "hull-full-health",
  slightDamage: "hull-slight-damage",
  damaged: "hull-damaged",
  veryDamaged: "hull-very-damaged"
};
var keys = {
  hull: (state) => `hull-${state}`,
  engine: (id) => `engine-${id}`,
  flameIdle: (id) => `flame-${id}-idle`,
  flamePowering: (id) => `flame-${id}-powering`,
  shield: (id) => `shield-${id}`,
  weapon: (id) => `weapon-${id}`,
  projectile: (id) => `projectile-${id}`,
  background: ["background-void", "background-stars", "background-big-stars"],
  planet: "planet",
  asteroid: "asteroid",
  enemyBase: (kind) => `klaed-${kind}-base`,
  enemyEngine: (kind) => `klaed-${kind}-engine`,
  enemyWeapons: (kind) => `klaed-${kind}-weapons`,
  enemyDestruction: (kind) => `klaed-${kind}-destruction`,
  enemyBullet: (id) => id === "klaedBullet" ? "klaed-bullet" : "klaed-big-bullet"
};
function sheets() {
  const ship = `${ASSETS}/mainship`;
  const env = `${ASSETS}/environment`;
  const klaed = `${ASSETS}/klaed`;
  return [
    ...DAMAGE_STATES.map((s) => still(keys.hull(s), `${ship}/${HULL_FILES[s]}.png`, 48)),
    ...ENGINES.flatMap((id) => {
      const f = ENGINE_FILES[id];
      return [
        still(keys.engine(id), `${ship}/${f.file}.png`, 48),
        strip(keys.flameIdle(id), `${ship}/${f.file}-idle.png`, 48, f.idle, 10),
        strip(keys.flamePowering(id), `${ship}/${f.file}-powering.png`, 48, f.powering, 14)
      ];
    }),
    ...SHIELDS.map((id) => strip(keys.shield(id), `${ship}/${SHIELD_FILES[id].file}.png`, 64, SHIELD_FILES[id].frames, 12)),
    ...WEAPONS.flatMap((id) => {
      const f = WEAPON_FILES[id];
      return [
        // Frames are picked by WeaponAnimator, so no Phaser animation.
        strip(keys.weapon(id), `${ship}/${f.weapon}.png`, 48, f.frames, 0, false),
        strip(keys.projectile(id), `${ship}/${f.projectile}.png`, 32, f.projectileFrames, 12)
      ];
    }),
    ...keys.background.map((key) => ({
      key,
      url: `${env}/${key}.png`,
      frameWidth: 640,
      frameHeight: 360,
      frames: 9,
      fps: 6,
      loop: true
    })),
    strip(keys.planet, `${env}/planet-earth-like.png`, 96, 77, 8),
    still(keys.asteroid, `${env}/asteroid.png`, 96),
    ...["scout", "fighter"].flatMap((kind) => {
      const f = KLAED_FILES[kind];
      return [
        still(keys.enemyBase(kind), `${klaed}/${kind}-base.png`, 64),
        strip(keys.enemyEngine(kind), `${klaed}/${kind}-engine.png`, 64, f.engine, 12),
        strip(keys.enemyWeapons(kind), `${klaed}/${kind}-weapons.png`, 64, f.weapons, 18, false),
        strip(keys.enemyDestruction(kind), `${klaed}/${kind}-destruction.png`, 64, f.destruction, 14, false)
      ];
    }),
    ...Object.entries(BULLET_FRAMES).map(([name, f]) => ({
      key: `klaed-${name}`,
      url: `${klaed}/${name}.png`,
      frameWidth: f.width,
      frameHeight: 16,
      frames: f.frames,
      fps: 12,
      loop: true
    }))
  ];
}

// src/scenes/boot.ts
var BootScene = class extends Phaser.Scene {
  constructor() {
    super("boot");
  }
  preload() {
    for (const sheet of sheets()) {
      this.load.spritesheet(sheet.key, sheet.url, {
        frameWidth: sheet.frameWidth,
        frameHeight: sheet.frameHeight
      });
    }
    for (const sound of effectFiles()) {
      this.load.audio(sound.key, sound.urls);
    }
  }
  create() {
    for (const sheet of sheets()) {
      if (sheet.fps > 0) {
        this.anims.create({
          key: sheet.key,
          frames: this.anims.generateFrameNumbers(sheet.key, { start: 0, end: sheet.frames - 1 }),
          frameRate: sheet.fps,
          repeat: sheet.loop ? -1 : 0
        });
      }
    }
    this.scene.start("sandbox");
  }
};

// src/scenes/sandbox.ts
import Phaser5 from "./vendor/phaser.js";

// src/debug.ts
function publishDebugState(state) {
  window.voidmarch = state;
}

// src/net/codec.ts
import { fromBinary, fromJsonString, toBinary, toJsonString } from "./vendor/protobuf.js";

// src/gen/voidmarch/v1/messages_pb.js
import { enumDesc, fileDesc, messageDesc, tsEnum } from "./vendor/protobuf-codegenv2.js";
var file_voidmarch_v1_messages = /* @__PURE__ */ fileDesc("Cht2b2lkbWFyY2gvdjEvbWVzc2FnZXMucHJvdG8SDHZvaWRtYXJjaC52MSJ7CgdMb2Fkb3V0EiQKBndlYXBvbhgBIAEoDjIULnZvaWRtYXJjaC52MS5XZWFwb24SJAoGZW5naW5lGAIgASgOMhQudm9pZG1hcmNoLnYxLkVuZ2luZRIkCgZzaGllbGQYAyABKA4yFC52b2lkbWFyY2gudjEuU2hpZWxkIpMBCglTaGlwU3RhdGUSCQoBeBgBIAEoAhIJCgF5GAIgASgCEgoKAnZ4GAMgASgCEgoKAnZ5GAQgASgCEg0KBWFuZ2xlGAUgASgCEhEKCXRocnVzdGluZxgGIAEoCBImCgdsb2Fkb3V0GAcgASgLMhUudm9pZG1hcmNoLnYxLkxvYWRvdXQSDgoGZGFtYWdlGAggASgNIhYKBUhlbGxvEg0KBXRva2VuGAEgASgJInIKCVNob3RGaXJlZBIKCgJpZBgBIAEoDRIkCgZ3ZWFwb24YAiABKA4yFC52b2lkbWFyY2gudjEuV2VhcG9uEg4KBm11enpsZRgDIAEoDRIJCgF4GAQgASgCEgkKAXkYBSABKAISDQoFYW5nbGUYBiABKAIiOAoDSGl0EhAKCGVuZW15X2lkGAEgASgNEg8KB3Nob3RfaWQYAiABKA0SDgoGZGFtYWdlGAMgASgNIrIBCg1DbGllbnRNZXNzYWdlEiQKBWhlbGxvGAEgASgLMhMudm9pZG1hcmNoLnYxLkhlbGxvSAASKAoFc3RhdGUYAiABKAsyFy52b2lkbWFyY2gudjEuU2hpcFN0YXRlSAASJwoEc2hvdBgDIAEoCzIXLnZvaWRtYXJjaC52MS5TaG90RmlyZWRIABIgCgNoaXQYBCABKAsyES52b2lkbWFyY2gudjEuSGl0SABCBgoEa2luZCJvCgdXZWxjb21lEhEKCXBsYXllcl9pZBgBIAEoCRIOCgZjb2xvdXIYAiABKA0SDwoHc3Bhd25feBgDIAEoAhIPCgdzcGF3bl95GAQgASgCEgwKBHRpY2sYBSABKA0SEQoJdGlja19yYXRlGAYgASgNImkKDlBsYXllclNuYXBzaG90EhEKCXBsYXllcl9pZBgBIAEoCRIMCgRuYW1lGAIgASgJEg4KBmNvbG91chgDIAEoDRImCgVzdGF0ZRgEIAEoCzIXLnZvaWRtYXJjaC52MS5TaGlwU3RhdGUiagoKRW5lbXlTdGF0ZRIQCghlbmVteV9pZBgBIAEoDRIlCgRraW5kGAIgASgOMhcudm9pZG1hcmNoLnYxLkVuZW15S2luZBIJCgF4GAMgASgCEgkKAXkYBCABKAISDQoFYW5nbGUYBSABKAIicgoIU25hcHNob3QSDAoEdGljaxgBIAEoDRItCgdwbGF5ZXJzGAIgAygLMhwudm9pZG1hcmNoLnYxLlBsYXllclNuYXBzaG90EikKB2VuZW1pZXMYAyADKAsyGC52b2lkbWFyY2gudjEuRW5lbXlTdGF0ZSKaAQoKRW5lbXlGaXJlZBIQCghlbmVteV9pZBgBIAEoDRIlCgRraW5kGAIgASgOMhcudm9pZG1hcmNoLnYxLkVuZW15S2luZBIMCgR0aWNrGAMgASgNEgwKBHNlZWQYBCABKA0SCQoBeBgFIAEoAhIJCgF5GAYgASgCEg0KBWFuZ2xlGAcgASgCEhIKCndhcm5fdGlja3MYCCABKA0igwEKDkVuZW15RGVzdHJveWVkEhAKCGVuZW15X2lkGAEgASgNEiUKBGtpbmQYAiABKA4yFy52b2lkbWFyY2gudjEuRW5lbXlLaW5kEhQKDGJ5X3BsYXllcl9pZBgDIAEoCRIMCgR0aWNrGAQgASgNEgkKAXgYBSABKAISCQoBeRgGIAEoAiI9CglTaG90RW5kZWQSEQoJcGxheWVyX2lkGAEgASgJEg8KB3Nob3RfaWQYAiABKA0SDAoEdGljaxgDIAEoDSJUCgpSZW1vdGVTaG90EhEKCXBsYXllcl9pZBgBIAEoCRIMCgR0aWNrGAIgASgNEiUKBHNob3QYAyABKAsyFy52b2lkbWFyY2gudjEuU2hvdEZpcmVkIh8KClBsYXllckxlZnQSEQoJcGxheWVyX2lkGAEgASgJIgYKBEZ1bGwi/gIKDVNlcnZlck1lc3NhZ2USKAoHd2VsY29tZRgBIAEoCzIVLnZvaWRtYXJjaC52MS5XZWxjb21lSAASKgoIc25hcHNob3QYAiABKAsyFi52b2lkbWFyY2gudjEuU25hcHNob3RIABIoCgRzaG90GAMgASgLMhgudm9pZG1hcmNoLnYxLlJlbW90ZVNob3RIABIoCgRsZWZ0GAQgASgLMhgudm9pZG1hcmNoLnYxLlBsYXllckxlZnRIABIiCgRmdWxsGAUgASgLMhIudm9pZG1hcmNoLnYxLkZ1bGxIABIvCgtlbmVteV9maXJlZBgGIAEoCzIYLnZvaWRtYXJjaC52MS5FbmVteUZpcmVkSAASNwoPZW5lbXlfZGVzdHJveWVkGAcgASgLMhwudm9pZG1hcmNoLnYxLkVuZW15RGVzdHJveWVkSAASLQoKc2hvdF9lbmRlZBgIIAEoCzIXLnZvaWRtYXJjaC52MS5TaG90RW5kZWRIAEIGCgRraW5kKnkKBldlYXBvbhIWChJXRUFQT05fVU5TUEVDSUZJRUQQABIWChJXRUFQT05fQVVUT19DQU5OT04QARISCg5XRUFQT05fUk9DS0VUUxACEhgKFFdFQVBPTl9CSUdfU1BBQ0VfR1VOEAMSEQoNV0VBUE9OX1pBUFBFUhAEKnIKBkVuZ2luZRIWChJFTkdJTkVfVU5TUEVDSUZJRUQQABIPCgtFTkdJTkVfQkFTRRABEhQKEEVOR0lORV9CSUdfUFVMU0UQAhIQCgxFTkdJTkVfQlVSU1QQAxIXChNFTkdJTkVfU1VQRVJDSEFSR0VEEAQqeQoGU2hpZWxkEhYKElNISUVMRF9VTlNQRUNJRklFRBAAEhAKDFNISUVMRF9GUk9OVBABEhkKFVNISUVMRF9GUk9OVF9BTkRfU0lERRACEhAKDFNISUVMRF9ST1VORBADEhgKFFNISUVMRF9JTlZJTkNJQklMSVRZEAQqVQoJRW5lbXlLaW5kEhoKFkVORU1ZX0tJTkRfVU5TUEVDSUZJRUQQABIUChBFTkVNWV9LSU5EX1NDT1VUEAESFgoSRU5FTVlfS0lORF9GSUdIVEVSEAJCRlpEZ2l0aHViLmNvbS9zdGFycXVha2Uvdm9pZG1hcmNoL2ludGVybmFsL2dlbi92b2lkbWFyY2gvdjE7dm9pZG1hcmNodjFiBnByb3RvMw");
var ShipStateSchema = /* @__PURE__ */ messageDesc(file_voidmarch_v1_messages, 1);
var ClientMessageSchema = /* @__PURE__ */ messageDesc(file_voidmarch_v1_messages, 5);
var ServerMessageSchema = /* @__PURE__ */ messageDesc(file_voidmarch_v1_messages, 16);
var WeaponSchema = /* @__PURE__ */ enumDesc(file_voidmarch_v1_messages, 0);
var Weapon = /* @__PURE__ */ tsEnum(WeaponSchema);
var EngineSchema = /* @__PURE__ */ enumDesc(file_voidmarch_v1_messages, 1);
var Engine = /* @__PURE__ */ tsEnum(EngineSchema);
var ShieldSchema = /* @__PURE__ */ enumDesc(file_voidmarch_v1_messages, 2);
var Shield = /* @__PURE__ */ tsEnum(ShieldSchema);
var EnemyKindSchema = /* @__PURE__ */ enumDesc(file_voidmarch_v1_messages, 3);
var EnemyKind = /* @__PURE__ */ tsEnum(EnemyKindSchema);

// src/net/codec.ts
function wireFormatFrom(search) {
  return new URLSearchParams(search).get("wire") === "json" ? "json" : "binary";
}
function encodeClient(message, format) {
  return format === "json" ? toJsonString(ClientMessageSchema, message) : toBinary(ClientMessageSchema, message);
}
function decodeServer(data) {
  if (typeof data === "string") {
    return fromJsonString(ServerMessageSchema, data);
  }
  return fromBinary(ServerMessageSchema, data instanceof Uint8Array ? data : new Uint8Array(data));
}

// src/sim/math.ts
var TAU = Math.PI * 2;
function wrapAngle(angle) {
  return angle - TAU * Math.floor((angle + Math.PI) / TAU);
}
function snapAngle(angle, steps) {
  if (steps <= 0) {
    return wrapAngle(angle);
  }
  const step = TAU / steps;
  return wrapAngle(Math.round(angle / step) * step);
}
function normalize(x, y) {
  const length = Math.hypot(x, y);
  if (length === 0) {
    return { x: 0, y: 0 };
  }
  return { x: x / length, y: y / length };
}
function rotateOffset(forward, right, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: forward * cos - right * sin, y: forward * sin + right * cos };
}
function triangleWave(phase) {
  const shifted = phase - 0.25;
  return 1 - 4 * Math.abs(Math.round(shifted) - shifted);
}
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = state + 1831565813 >>> 0;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// src/sim/input.ts
var CONTROL_MODES = ["ship", "screen"];
function toCommand(input) {
  const move = normalize(Number(input.right) - Number(input.left), Number(input.down) - Number(input.up));
  return { moveX: move.x, moveY: move.y, aimX: input.pointerX, aimY: input.pointerY, fire: input.fire };
}
function relativeTo(cmd, angle) {
  const move = rotateOffset(-cmd.moveY, cmd.moveX, angle);
  return { ...cmd, moveX: move.x, moveY: move.y };
}

// src/settings.ts
var CONTROL_MODE_KEY = "voidmarch.controlMode";
function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    return void 0;
  }
}
function loadControlMode(store = browserStorage()) {
  try {
    const saved = store?.getItem(CONTROL_MODE_KEY);
    return CONTROL_MODES.find((mode) => mode === saved) ?? "ship";
  } catch {
    return "ship";
  }
}
function saveControlMode(mode, store = browserStorage()) {
  try {
    store?.setItem(CONTROL_MODE_KEY, mode);
  } catch {
  }
}
var AUDIO_KEY = "voidmarch.audio";
var DEFAULT_AUDIO = { muted: false, music: true };
function loadAudioSettings(store = browserStorage()) {
  try {
    const parsed = JSON.parse(store?.getItem(AUDIO_KEY) ?? "null");
    if (typeof parsed !== "object" || parsed === null) {
      return { ...DEFAULT_AUDIO };
    }
    const saved = parsed;
    return {
      muted: typeof saved.muted === "boolean" ? saved.muted : DEFAULT_AUDIO.muted,
      music: typeof saved.music === "boolean" ? saved.music : DEFAULT_AUDIO.music
    };
  } catch {
    return { ...DEFAULT_AUDIO };
  }
}
function saveAudioSettings(settings, store = browserStorage()) {
  try {
    store?.setItem(AUDIO_KEY, JSON.stringify(settings));
  } catch {
  }
}
var TOKEN_KEY = "voidmarch.token";
function loadToken(store = browserStorage()) {
  try {
    return store?.getItem(TOKEN_KEY) ?? void 0;
  } catch {
    return void 0;
  }
}
function saveToken(token, store = browserStorage()) {
  try {
    store?.setItem(TOKEN_KEY, token);
  } catch {
  }
}
function clearToken(store = browserStorage()) {
  try {
    store?.removeItem(TOKEN_KEY);
  } catch {
  }
}

// src/sim/projectiles.ts
function isWeapon(kind) {
  return WEAPONS.includes(kind);
}
function projectileStats(kind) {
  return isWeapon(kind) ? WEAPON_STATS[kind] : ENEMY_BULLET_STATS[kind];
}
function travelled(stats, age) {
  if (stats.acceleration <= 0) {
    return stats.speed * age;
  }
  const rampTime = Math.max(0, (stats.maxSpeed - stats.speed) / stats.acceleration);
  if (age <= rampTime) {
    return stats.speed * age + 0.5 * stats.acceleration * age * age;
  }
  const ramp = stats.speed * rampTime + 0.5 * stats.acceleration * rampTime * rampTime;
  return ramp + stats.maxSpeed * (age - rampTime);
}
function positionAt(p, age) {
  const stats = projectileStats(p.kind);
  const lateral = stats.zigzag.amplitude * triangleWave(age * stats.zigzag.frequency);
  const offset = rotateOffset(travelled(stats, age), lateral, p.angle);
  return { x: p.originX + offset.x, y: p.originY + offset.y };
}
function place(p) {
  const { x, y } = positionAt(p, p.age);
  p.x = x;
  p.y = y;
}
var ProjectilePool = class {
  items;
  next = 0;
  lastShotId = 0;
  constructor(capacity) {
    this.items = Array.from({ length: capacity }, () => ({
      active: false,
      kind: WEAPONS[0],
      faction: "own",
      owner: "",
      shotId: 0,
      originX: 0,
      originY: 0,
      angle: 0,
      age: 0,
      x: 0,
      y: 0
    }));
  }
  get activeCount() {
    return this.items.reduce((n, p) => n + Number(p.active), 0);
  }
  spawn(shot, options = {}) {
    let chosen;
    for (let i = 0; i < this.items.length && chosen === void 0; i++) {
      const candidate = this.items[(this.next + i) % this.items.length];
      if (candidate !== void 0 && !candidate.active) {
        chosen = candidate;
        this.next = (this.next + i + 1) % this.items.length;
      }
    }
    chosen ??= this.oldest();
    chosen.active = true;
    chosen.kind = shot.kind;
    chosen.faction = options.faction ?? "own";
    chosen.owner = options.owner ?? "";
    chosen.shotId = options.shotId ?? ++this.lastShotId;
    chosen.originX = shot.x;
    chosen.originY = shot.y;
    chosen.angle = shot.angle;
    chosen.age = options.ageSeconds ?? 0;
    place(chosen);
    return chosen;
  }
  /** Ends every projectile of a faction: the server's are gone once offline. */
  clear(faction) {
    for (const p of this.items) {
      if (p.faction === faction) {
        p.active = false;
      }
    }
  }
  /** Ends a remote player's shot that hit something, and returns it. */
  end(owner, shotId) {
    const p = this.items.find((q) => q.active && q.faction === "remote" && q.owner === owner && q.shotId === shotId);
    if (p !== void 0) {
      p.active = false;
    }
    return p;
  }
  /** Ages every projectile by dt and returns those that expired this tick. */
  step(dt, inBounds) {
    const expired = [];
    for (const p of this.items) {
      if (!p.active) {
        continue;
      }
      p.age += dt;
      place(p);
      if (p.age >= projectileStats(p.kind).lifetime || !inBounds(p.x, p.y)) {
        p.active = false;
        expired.push(p);
      }
    }
    return expired;
  }
  oldest() {
    let oldest = this.items[0];
    for (const p of this.items) {
      if (oldest === void 0 || p.age > oldest.age) {
        oldest = p;
      }
    }
    if (oldest === void 0) {
      throw new Error("ProjectilePool: zero capacity");
    }
    return oldest;
  }
};

// src/sim/ship.ts
function createShip(x, y, loadout = DEFAULT_LOADOUT) {
  return {
    x,
    y,
    vx: 0,
    vy: 0,
    angle: -Math.PI / 2,
    thrusting: false,
    loadout: { ...loadout },
    damage: 0,
    cooldown: 0,
    charging: 0,
    nextMuzzle: 0,
    rotationSnap: 0
  };
}
function stepShip(ship, cmd, dt) {
  const engine = ENGINE_STATS[ship.loadout.engine];
  ship.thrusting = cmd.moveX !== 0 || cmd.moveY !== 0;
  ship.vx += cmd.moveX * engine.acceleration * dt;
  ship.vy += cmd.moveY * engine.acceleration * dt;
  const keep = Math.exp(-engine.drag * dt);
  ship.vx *= keep;
  ship.vy *= keep;
  const speed = Math.hypot(ship.vx, ship.vy);
  if (speed > engine.maxSpeed) {
    ship.vx *= engine.maxSpeed / speed;
    ship.vy *= engine.maxSpeed / speed;
  }
  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;
  const dx = cmd.aimX - ship.x;
  const dy = cmd.aimY - ship.y;
  if (dx !== 0 || dy !== 0) {
    ship.angle = snapAngle(Math.atan2(dy, dx), ship.rotationSnap);
  }
}

// src/sim/weapons.ts
function stepWeapon(ship, fire, dt) {
  const stats = WEAPON_STATS[ship.loadout.weapon];
  const step = { chargeStarted: false, shots: [] };
  ship.cooldown -= dt;
  if (ship.charging > 0) {
    ship.charging -= dt;
    if (ship.charging <= 0) {
      ship.charging = 0;
      fireVolley(ship, stats, step.shots);
    }
    return step;
  }
  if (!fire) {
    ship.cooldown = Math.max(ship.cooldown, 0);
    return step;
  }
  while (ship.cooldown <= 0) {
    ship.cooldown += stats.interval;
    if (stats.charge > 0) {
      ship.charging = stats.charge;
      step.chargeStarted = true;
      break;
    }
    fireVolley(ship, stats, step.shots);
  }
  return step;
}
function fireVolley(ship, stats, shots) {
  const muzzles = stats.alternate ? [ship.nextMuzzle % stats.muzzles.length] : stats.muzzles.map((_, i) => i);
  ship.nextMuzzle = (ship.nextMuzzle + 1) % stats.muzzles.length;
  for (const index of muzzles) {
    const muzzle = stats.muzzles[index];
    if (muzzle === void 0) {
      continue;
    }
    const offset = rotateOffset(muzzle.forward, muzzle.right, ship.angle);
    shots.push({
      weapon: ship.loadout.weapon,
      muzzle: index,
      x: ship.x + offset.x,
      y: ship.y + offset.y,
      angle: ship.angle
    });
  }
}

// src/sim/world.ts
var PROJECTILE_MARGIN = 64;
function applyWorldEdge(ship, dt) {
  const inner = WORLD_HALF_SIZE - WORLD_EDGE_BAND;
  for (const axis of ["x", "y"]) {
    const v = axis === "x" ? "vx" : "vy";
    const distance = Math.abs(ship[axis]);
    if (distance > inner) {
      const depth = Math.min(1, (distance - inner) / WORLD_EDGE_BAND);
      ship[v] -= Math.sign(ship[axis]) * depth * WORLD_EDGE_PUSH * dt;
    }
    if (distance > WORLD_HALF_SIZE) {
      ship[axis] = Math.sign(ship[axis]) * WORLD_HALF_SIZE;
      if (Math.sign(ship[v]) === Math.sign(ship[axis])) {
        ship[v] = 0;
      }
    }
  }
}
function projectileInBounds(x, y) {
  const limit = WORLD_HALF_SIZE + PROJECTILE_MARGIN;
  return Math.abs(x) <= limit && Math.abs(y) <= limit;
}
function asteroidField(seed = ASTEROID_SEED, count = ASTEROID_COUNT) {
  const random = seededRandom(seed);
  const field = [];
  const span = WORLD_HALF_SIZE - WORLD_EDGE_BAND;
  while (field.length < count) {
    const x = (random() * 2 - 1) * span;
    const y = (random() * 2 - 1) * span;
    const rotation = Math.floor(random() * 4) * (Math.PI / 2);
    const flip = random() < 0.5;
    if (Math.hypot(x, y) >= ASTEROID_CLEAR_RADIUS) {
      field.push({ x, y, rotation, flip });
    }
  }
  return field;
}

// src/sim/sandbox.ts
var PROJECTILE_CAPACITY = 256;
var Sandbox = class {
  ship = createShip(0, 160);
  projectiles = new ProjectilePool(PROJECTILE_CAPACITY);
  /** Ship position before the last tick, for smooth drawing between ticks. */
  previous = { x: this.ship.x, y: this.ship.y };
  /** How WASD maps to movement; ship-relative unless the player switched. */
  controlMode = "ship";
  accumulator = 0;
  /** How far the display is between the last two ticks, from 0 to 1. */
  get alpha() {
    return this.accumulator / TICK_SECONDS;
  }
  /** Runs as many fixed ticks as frameSeconds covers, using the same input for each. */
  advance(frameSeconds, input) {
    const events = { ticks: 0, charges: [], shots: [], expired: [] };
    this.accumulator = Math.min(this.accumulator + frameSeconds, TICK_SECONDS * MAX_TICKS_PER_FRAME);
    const cmd = toCommand(input);
    while (this.accumulator >= TICK_SECONDS) {
      this.accumulator -= TICK_SECONDS;
      this.tick(cmd, events);
    }
    return events;
  }
  tick(screenCmd, events) {
    this.previous.x = this.ship.x;
    this.previous.y = this.ship.y;
    const cmd = this.controlMode === "ship" ? relativeTo(screenCmd, this.ship.angle) : screenCmd;
    stepShip(this.ship, cmd, TICK_SECONDS);
    applyWorldEdge(this.ship, TICK_SECONDS);
    const weapon = stepWeapon(this.ship, cmd.fire, TICK_SECONDS);
    if (weapon.chargeStarted) {
      events.charges.push(this.ship.loadout.weapon);
    }
    for (const shot of weapon.shots) {
      const p = this.projectiles.spawn({ kind: shot.weapon, x: shot.x, y: shot.y, angle: shot.angle });
      events.shots.push({ ...shot, id: p.shotId });
    }
    for (const p of this.projectiles.step(TICK_SECONDS, projectileInBounds)) {
      events.expired.push({ kind: p.kind, faction: p.faction, x: p.x, y: p.y });
    }
    events.ticks++;
  }
};

// src/sim/zoom.ts
var MIN_ZOOM = 2;
function integerZoom(viewportWidth, viewportHeight, targetWidth, targetHeight) {
  const fit = Math.floor(Math.min(viewportWidth / targetWidth, viewportHeight / targetHeight));
  return Math.max(MIN_ZOOM, fit);
}

// src/weaponframes.ts
var HOLD_SECONDS = 0.6;
var WeaponAnimator = class {
  timing;
  segment;
  salvo = 0;
  constructor(timing) {
    this.timing = timing;
  }
  /** Plays the frames before the first release over the charge time. */
  charge(now2, seconds) {
    const first = this.timing.releaseFrames[0] ?? 0;
    this.segment = { start: 0, end: first - 1, startedAt: now2, fps: first / seconds, ends: false };
  }
  /**
   * Jumps to the next release frame fired from muzzle. Cycles with more
   * release frames than muzzles (rocket pods) pick the next one on that side.
   */
  release(now2, muzzle, muzzles) {
    const count = this.timing.releaseFrames.length;
    let index = this.salvo % count;
    for (let tries = 0; tries < count && index % muzzles !== muzzle % muzzles; tries++) {
      index = (index + 1) % count;
    }
    const last = index === count - 1;
    const start2 = this.timing.releaseFrames[index] ?? 0;
    const next = this.timing.releaseFrames[index + 1];
    this.segment = {
      start: start2,
      end: last || next === void 0 ? this.timing.frames - 1 : next - 1,
      startedAt: now2,
      fps: this.timing.releaseFps,
      ends: last
    };
    this.salvo = last ? 0 : index + 1;
  }
  /** Back to rest, e.g. after switching weapons. */
  reset() {
    this.segment = void 0;
    this.salvo = 0;
  }
  frame(now2) {
    const segment = this.segment;
    if (segment === void 0) {
      return 0;
    }
    const elapsed = now2 - segment.startedAt;
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
};

// src/scenes/audio.ts
import Phaser2 from "./vendor/phaser.js";

// src/mix.ts
var ENGINE_IDLE_VOLUME = 0.12;
var ENGINE_THRUST_VOLUME = 0.32;
var ENGINE_MIN_RATE = 0.85;
var ENGINE_RATE_RANGE = 0.35;
function engineMix(speed, maxSpeed, thrusting) {
  const fraction = maxSpeed > 0 ? Math.min(1, Math.max(0, speed / maxSpeed)) : 0;
  return {
    volume: thrusting ? ENGINE_THRUST_VOLUME : ENGINE_IDLE_VOLUME + (ENGINE_THRUST_VOLUME - ENGINE_IDLE_VOLUME) * fraction * 0.5,
    rate: ENGINE_MIN_RATE + ENGINE_RATE_RANGE * fraction
  };
}
function nextVariant(variants, counter) {
  if (variants.length === 0) {
    return void 0;
  }
  return variants[counter % variants.length];
}
var DETUNE_CENTS = 80;
function shotDetune(random) {
  return (random() * 2 - 1) * DETUNE_CENTS;
}

// src/scenes/audio.ts
var SHOT_VOLUME = 0.35;
var REMOTE_SHOT_VOLUME = 0.5;
var ENEMY_SHOT_VOLUME = 0.15;
var ENEMY_SHOT_DETUNE = -300;
var CHARGE_VOLUME = 0.3;
var CHARGE_DETUNE = 300;
var EXPIRE_VOLUME = 0.3;
var UI_VOLUME = 0.3;
var MUSIC_VOLUME = 0.3;
var ShipAudio = class {
  engine;
  engineId;
  music;
  musicIndex = 0;
  musicLoaded = false;
  shots = 0;
  scene;
  settings;
  constructor(scene, settings) {
    this.scene = scene;
    this.settings = settings;
    scene.sound.mute = settings.muted;
    scene.sound.pauseOnBlur = true;
    this.loadMusic();
  }
  /** Whether the music has finished loading. */
  get musicReady() {
    return this.musicLoaded;
  }
  /** Which sound backend Phaser picked for this browser. */
  get backend() {
    const sound = this.scene.sound;
    if (sound instanceof Phaser2.Sound.WebAudioSoundManager) {
      return "webaudio";
    }
    return sound instanceof Phaser2.Sound.HTML5AudioSoundManager ? "html5" : "none";
  }
  /** The key of the playing track, or null. */
  get playingMusic() {
    return this.music?.isPlaying === true ? this.music.key : null;
  }
  /** Swaps the engine loop to match the fitted engine. */
  setEngine(id) {
    if (id === this.engineId) {
      return;
    }
    this.engine?.destroy();
    this.engineId = id;
    this.engine = this.scene.sound.add(ENGINE_LOOPS[id], { loop: true, volume: 0 });
    this.engine.play();
  }
  update(ship, events) {
    if (this.engine !== void 0) {
      const mix = engineMix(Math.hypot(ship.vx, ship.vy), ENGINE_STATS[ship.loadout.engine].maxSpeed, ship.thrusting);
      this.engine.setVolume(mix.volume);
      this.engine.setRate(mix.rate);
    }
    for (const weapon of events.charges) {
      const key = CHARGE_SOUNDS[weapon];
      if (key !== void 0) {
        this.scene.sound.play(key, { volume: CHARGE_VOLUME, detune: CHARGE_DETUNE });
      }
    }
    const volleys = /* @__PURE__ */ new Set();
    for (const shot of events.shots) {
      const volley = WEAPON_STATS[shot.weapon].alternate ? `${shot.weapon}-${shot.muzzle}-${volleys.size}` : shot.weapon;
      if (volleys.has(volley)) {
        continue;
      }
      volleys.add(volley);
      const key = nextVariant(SHOT_SOUNDS[shot.weapon], this.shots++);
      if (key !== void 0) {
        this.scene.sound.play(key, { volume: SHOT_VOLUME, detune: shotDetune(Math.random) });
      }
    }
    for (const expired of events.expired) {
      const key = isWeapon(expired.kind) ? EXPIRE_SOUNDS[expired.kind] : void 0;
      if (key !== void 0) {
        this.scene.sound.play(key, { volume: EXPIRE_VOLUME, detune: shotDetune(Math.random) });
      }
    }
  }
  /** Another player's shot: the same sound, quieter. */
  remoteShot(weapon) {
    const key = nextVariant(SHOT_SOUNDS[weapon], this.shots++);
    if (key !== void 0) {
      this.scene.sound.play(key, { volume: SHOT_VOLUME * REMOTE_SHOT_VOLUME, detune: shotDetune(Math.random) });
    }
  }
  /** An enemy's shot: their own laser, soft and a little low. */
  enemyShot() {
    this.scene.sound.play(ENEMY_SHOT_SOUND, { volume: ENEMY_SHOT_VOLUME, detune: ENEMY_SHOT_DETUNE + shotDetune(Math.random) });
  }
  enemyDestroyed() {
    this.scene.sound.play(ENEMY_EXPLOSION_SOUND, { volume: EXPIRE_VOLUME, detune: shotDetune(Math.random) });
  }
  shieldSwitched() {
    this.scene.sound.play(SHIELD_SOUND, { volume: UI_VOLUME });
  }
  partSwitched() {
    this.scene.sound.play(PART_SWITCH_SOUND, { volume: UI_VOLUME });
  }
  toggleMute() {
    this.settings.muted = !this.settings.muted;
    this.scene.sound.mute = this.settings.muted;
  }
  toggleMusic() {
    this.settings.music = !this.settings.music;
    if (this.settings.music) {
      this.playMusic();
    } else {
      this.music?.stop();
    }
  }
  /** Loads the music after the game has started, so it never delays the first frame. */
  loadMusic() {
    const loader = this.scene.load;
    for (const file of musicFiles()) {
      loader.audio(file.key, file.urls);
    }
    loader.once(Phaser2.Loader.Events.COMPLETE, () => {
      this.musicLoaded = true;
      this.playMusic();
    });
    loader.start();
  }
  playMusic() {
    if (!this.musicLoaded || !this.settings.music || this.music?.isPlaying === true) {
      return;
    }
    if (this.scene.sound.locked) {
      this.scene.sound.once(Phaser2.Sound.Events.UNLOCKED, () => {
        this.playMusic();
      });
      return;
    }
    const key = MUSIC[this.musicIndex % MUSIC.length] ?? MUSIC[0];
    this.music?.destroy();
    this.music = this.scene.sound.add(key, { volume: MUSIC_VOLUME });
    this.music.once(Phaser2.Sound.Events.COMPLETE, () => {
      this.musicIndex++;
      this.playMusic();
    });
    this.music.play();
  }
};

// src/net/clock.ts
var ServerClock = class _ServerClock {
  offset;
  ticksPerMs;
  constructor(tickRate) {
    this.ticksPerMs = tickRate / 1e3;
  }
  /** How far a stale estimate may fall back per report, in ticks. */
  static DRIFT = 0.05;
  /** Records that the server was at tick when a report arrived at nowMs. */
  observe(tick, nowMs) {
    const sample = tick - nowMs * this.ticksPerMs;
    this.offset = this.offset === void 0 ? sample : Math.max(sample, this.offset - _ServerClock.DRIFT);
  }
  /** The estimated server tick at nowMs, fractional; undefined before any report. */
  tickAt(nowMs) {
    return this.offset === void 0 ? void 0 : this.offset + nowMs * this.ticksPerMs;
  }
};

// src/net/connection.ts
import { create as create2 } from "./vendor/protobuf.js";

// src/net/mapping.ts
import { create } from "./vendor/protobuf.js";
var WEAPONS2 = {
  autoCannon: Weapon.AUTO_CANNON,
  rockets: Weapon.ROCKETS,
  bigSpaceGun: Weapon.BIG_SPACE_GUN,
  zapper: Weapon.ZAPPER
};
var ENGINES2 = {
  base: Engine.BASE,
  bigPulse: Engine.BIG_PULSE,
  burst: Engine.BURST,
  supercharged: Engine.SUPERCHARGED
};
var SHIELDS2 = {
  front: Shield.FRONT,
  frontAndSide: Shield.FRONT_AND_SIDE,
  round: Shield.ROUND,
  invincibility: Shield.INVINCIBILITY
};
function reverse(map) {
  return new Map(Object.entries(map).map(([k, v]) => [v, k]));
}
var WEAPON_IDS = reverse(WEAPONS2);
var ENGINE_IDS = reverse(ENGINES2);
var SHIELD_IDS = reverse(SHIELDS2);
var toWeapon = (id) => WEAPONS2[id];
var fromEnemyKind = (kind) => kind === EnemyKind.FIGHTER ? "fighter" : "scout";
var fromWeapon = (w) => WEAPON_IDS.get(w) ?? DEFAULT_LOADOUT.weapon;
function toShipState(ship) {
  return create(ShipStateSchema, {
    x: ship.x,
    y: ship.y,
    vx: ship.vx,
    vy: ship.vy,
    angle: ship.angle,
    thrusting: ship.thrusting,
    loadout: {
      weapon: WEAPONS2[ship.loadout.weapon],
      engine: ENGINES2[ship.loadout.engine],
      shield: SHIELDS2[ship.loadout.shield]
    },
    damage: ship.damage
  });
}
function fromShipState(state) {
  const loadout = state.loadout;
  return {
    x: state.x,
    y: state.y,
    angle: state.angle,
    thrusting: state.thrusting,
    loadout: {
      weapon: fromWeapon(loadout?.weapon ?? Weapon.UNSPECIFIED),
      engine: ENGINE_IDS.get(loadout?.engine ?? Engine.UNSPECIFIED) ?? DEFAULT_LOADOUT.engine,
      shield: SHIELD_IDS.get(loadout?.shield ?? Shield.UNSPECIFIED) ?? DEFAULT_LOADOUT.shield
    },
    damage: Math.min(state.damage, DAMAGE_STATES.length - 1)
  };
}

// src/net/connection.ts
var CLOSE_UNKNOWN_TOKEN = 4001;
var CLOSE_TRY_AGAIN_LATER = 1013;
var BACKOFF_MS = [1e3, 2e3, 4e3, 8e3];
var MAX_BACKOFF_MS = 1e4;
var FULL_RETRY_MS = 1e4;
var browserTimers = {
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (handle) => {
    window.clearTimeout(handle);
  }
};
var Connection = class {
  options;
  makeSocket;
  timers;
  socket;
  retry;
  attempts = 0;
  stopped = false;
  welcomed = false;
  stateIntervalMs = 50;
  lastStateAt = Number.NEGATIVE_INFINITY;
  constructor(options) {
    this.options = options;
    this.makeSocket = options.socket ?? ((url) => new WebSocket(url));
    this.timers = options.timers ?? browserTimers;
  }
  /** Whether the server has welcomed this connection and it is still open. */
  get connected() {
    return this.welcomed;
  }
  start() {
    this.stopped = false;
    this.open();
  }
  stop() {
    this.stopped = true;
    this.timers.clearTimeout(this.retry);
    this.socket?.close(1e3);
    this.socket = void 0;
    this.welcomed = false;
  }
  /** Sends the ship's state, at most at the server's tick rate. */
  sendState(ship, nowMs) {
    if (!this.welcomed || nowMs - this.lastStateAt < this.stateIntervalMs) {
      return;
    }
    this.lastStateAt = nowMs;
    this.send(create2(ClientMessageSchema, { kind: { case: "state", value: toShipState(ship) } }));
  }
  /** Sends a shot under its projectile-pool id, which a hit later reports. */
  sendShot(shot) {
    if (!this.welcomed) {
      return;
    }
    this.send(
      create2(ClientMessageSchema, {
        kind: {
          case: "shot",
          value: { id: shot.id, weapon: toWeapon(shot.weapon), muzzle: shot.muzzle, x: shot.x, y: shot.y, angle: shot.angle }
        }
      })
    );
  }
  /** Reports that one of our shots hit an enemy; the server trusts it. */
  sendHit(enemyId, shotId, damage) {
    if (!this.welcomed) {
      return;
    }
    this.send(create2(ClientMessageSchema, { kind: { case: "hit", value: { enemyId, shotId, damage } } }));
  }
  open() {
    const socket = this.makeSocket(this.options.url);
    socket.binaryType = "arraybuffer";
    socket.onopen = () => {
      this.send(create2(ClientMessageSchema, { kind: { case: "hello", value: { token: this.options.token } } }), socket);
    };
    socket.onmessage = (event) => {
      this.receive(event.data);
    };
    socket.onclose = (event) => {
      this.closed(socket, event.code);
    };
    this.socket = socket;
  }
  receive(data) {
    const message = decodeServer(data);
    const events = this.options.events;
    switch (message.kind.case) {
      case "welcome":
        this.welcomed = true;
        this.attempts = 0;
        if (message.kind.value.tickRate > 0) {
          this.stateIntervalMs = 1e3 / message.kind.value.tickRate;
        }
        events.welcome(message.kind.value);
        break;
      case "snapshot":
        events.snapshot(message.kind.value);
        break;
      case "shot":
        events.shot(message.kind.value);
        break;
      case "left":
        events.left(message.kind.value.playerId);
        break;
      case "full":
        events.full();
        break;
      case "enemyFired":
        events.enemyFired(message.kind.value);
        break;
      case "enemyDestroyed":
        events.enemyDestroyed(message.kind.value);
        break;
      case "shotEnded":
        events.shotEnded(message.kind.value);
        break;
      default:
    }
  }
  closed(socket, code) {
    if (socket !== this.socket) {
      return;
    }
    this.socket = void 0;
    this.welcomed = false;
    if (this.stopped) {
      return;
    }
    this.options.events.disconnected();
    if (code === CLOSE_UNKNOWN_TOKEN) {
      this.options.events.unknownToken();
      return;
    }
    const delay = code === CLOSE_TRY_AGAIN_LATER ? FULL_RETRY_MS : BACKOFF_MS[this.attempts] ?? MAX_BACKOFF_MS;
    this.attempts++;
    this.retry = this.timers.setTimeout(() => {
      this.open();
    }, delay);
  }
  send(message, socket = this.socket) {
    const data = encodeClient(message, this.options.format);
    socket?.send(typeof data === "string" ? data : data);
  }
};

// src/net/interpolation.ts
var INTERPOLATION_DELAY_TICKS = 2;
var MAX_SAMPLES = 32;
var StateBuffer = class {
  samples = [];
  push(tick, state) {
    const last = this.samples.at(-1);
    if (last !== void 0 && tick <= last.tick) {
      return;
    }
    this.samples.push({ tick, state });
    if (this.samples.length > MAX_SAMPLES) {
      this.samples.shift();
    }
  }
  get empty() {
    return this.samples.length === 0;
  }
  /** The state at a (fractional) tick, or undefined with no samples. */
  sample(tick) {
    const first = this.samples[0];
    const last = this.samples.at(-1);
    if (first === void 0 || last === void 0) {
      return void 0;
    }
    if (tick <= first.tick) {
      return first.state;
    }
    if (tick >= last.tick) {
      return last.state;
    }
    let i = this.samples.length - 1;
    while (i > 0 && (this.samples[i - 1]?.tick ?? 0) > tick) {
      i--;
    }
    const a = this.samples[i - 1];
    const b = this.samples[i];
    if (a === void 0 || b === void 0) {
      return last.state;
    }
    const t = (tick - a.tick) / (b.tick - a.tick);
    return {
      ...a.state,
      x: a.state.x + (b.state.x - a.state.x) * t,
      y: a.state.y + (b.state.y - a.state.y) * t,
      angle: wrapAngle(a.state.angle + wrapAngle(b.state.angle - a.state.angle) * t)
    };
  }
};

// src/net/remoteshots.ts
var TimedQueue = class {
  pending = [];
  tickRate;
  constructor(tickRate) {
    this.tickRate = tickRate;
  }
  add(tick, item) {
    this.pending.push({ tick, item });
  }
  /** Removes and returns what is at or before renderTick, with its age. */
  due(renderTick) {
    const due = [];
    this.pending = this.pending.filter((p) => {
      if (p.tick > renderTick) {
        return true;
      }
      due.push({ item: p.item, ageSeconds: (renderTick - p.tick) / this.tickRate });
      return false;
    });
    return due;
  }
};

// src/sim/enemies.ts
var ENEMY_BULLET = {
  scout: "klaedBullet",
  fighter: "klaedBigBullet"
};
var ENEMY_RADIUS = {
  scout: 11,
  fighter: 12
};

// src/sim/hits.ts
function hitTargetAlong(x0, y0, x1, y1, targets) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lengthSquared = dx * dx + dy * dy;
  let first;
  let firstAlong = Infinity;
  for (const t of targets) {
    const along = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((t.x - x0) * dx + (t.y - y0) * dy) / lengthSquared));
    if (Math.hypot(t.x - (x0 + along * dx), t.y - (y0 + along * dy)) <= t.radius + SHOT_RADIUS && along < firstAlong) {
      first = t;
      firstAlong = along;
    }
  }
  return first;
}

// src/sim/patterns.ts
function enemyPattern(kind, x, y, angle, seed) {
  const random = seededRandom(seed);
  const aim = angle + (random() * 2 - 1) * ENEMY_AIM_JITTER;
  const muzzle = rotateOffset(ENEMY_MUZZLE, 0, aim);
  return [{ kind: ENEMY_BULLET[kind], x: x + muzzle.x, y: y + muzzle.y, angle: aim }];
}

// src/scenes/enemyview.ts
import Phaser4 from "./vendor/phaser.js";

// src/scenes/shipview.ts
import Phaser3 from "./vendor/phaser.js";
var SPRITE_FACING = Math.PI / 2;
var HIT_FLASH_MS = 70;
var LABEL_OFFSET = 26;
var ShipView = class {
  root;
  weapon;
  engine;
  flame;
  hull;
  shield;
  label;
  loadout;
  thrusting = false;
  constructor(scene, layer, x, y) {
    this.engine = scene.add.image(0, 0, keys.engine("base"));
    this.flame = scene.add.sprite(0, 0, keys.flameIdle("base"));
    this.hull = scene.add.image(0, 0, keys.hull("fullHealth"));
    this.weapon = scene.add.sprite(0, 0, keys.weapon("autoCannon"), 0);
    this.shield = scene.add.sprite(0, 0, keys.shield("front"));
    this.root = scene.add.container(x, y, [this.engine, this.flame, this.hull, this.weapon, this.shield]);
    layer.add(this.root);
  }
  /** Shows a name under the ship in the player's colour (0xRRGGBB). */
  setLabel(scene, layer, name, colour, resolution) {
    this.label?.destroy();
    this.label = scene.add.text(this.root.x, this.root.y + LABEL_OFFSET, name, {
      fontFamily: "monospace",
      fontSize: "8px",
      color: `#${colour.toString(16).padStart(6, "0")}`,
      resolution
    }).setOrigin(0.5, 0).setShadow(1, 1, "#000000", 0);
    layer.add(this.label);
  }
  /** Fits the parts; unchanged parts keep their animation running. */
  setLoadout(loadout) {
    const old = this.loadout;
    if (old?.engine !== loadout.engine) {
      this.engine.setTexture(keys.engine(loadout.engine));
      this.flame.play(this.thrusting ? keys.flamePowering(loadout.engine) : keys.flameIdle(loadout.engine));
    }
    if (old?.weapon !== loadout.weapon) {
      this.weapon.setTexture(keys.weapon(loadout.weapon), 0);
    }
    if (old?.shield !== loadout.shield) {
      this.shield.play(keys.shield(loadout.shield));
    }
    this.loadout = { ...loadout };
  }
  setDamage(damage) {
    const state = DAMAGE_STATES[Math.min(Math.max(0, damage), DAMAGE_STATES.length - 1)] ?? "fullHealth";
    this.hull.setTexture(keys.hull(state));
  }
  setThrusting(thrusting) {
    this.thrusting = thrusting;
    const engine = this.loadout?.engine ?? "base";
    this.flame.play(thrusting ? keys.flamePowering(engine) : keys.flameIdle(engine), true);
  }
  /** Places the ship facing angle (0 is +x). */
  place(x, y, angle) {
    this.root.setPosition(x, y).setRotation(angle + SPRITE_FACING);
    this.label?.setPosition(x, y + LABEL_OFFSET);
  }
  /** A short white flash of the hull where an enemy bullet hit. */
  flash(scene) {
    this.hull.setTint(16777215).setTintMode(Phaser3.TintModes.FILL);
    scene.time.delayedCall(HIT_FLASH_MS, () => {
      this.hull.clearTint().setTintMode(Phaser3.TintModes.MULTIPLY);
    });
  }
  destroy() {
    this.root.destroy();
    this.label?.destroy();
  }
};

// src/scenes/enemyview.ts
var FLASH_MS = 70;
var EnemyView = class {
  kind;
  root;
  base;
  weapon;
  scene;
  constructor(scene, parent, kind) {
    this.scene = scene;
    this.kind = kind;
    const engine = scene.add.sprite(0, 0, keys.enemyEngine(kind)).play(keys.enemyEngine(kind));
    this.base = scene.add.image(0, 0, keys.enemyBase(kind));
    this.weapon = scene.add.sprite(0, 0, keys.enemyWeapons(kind), 0);
    this.weapon.on(Phaser4.Animations.Events.ANIMATION_COMPLETE, () => {
      this.weapon.setFrame(0);
    });
    this.root = scene.add.container(0, 0, [engine, this.base, this.weapon]);
    parent.add(this.root);
  }
  get x() {
    return this.root.x;
  }
  get y() {
    return this.root.y;
  }
  place(x, y, angle) {
    this.root.setPosition(x, y).setRotation(angle + SPRITE_FACING);
  }
  /** Plays the weapon animation: the telegraph before a volley leaves. */
  warn() {
    this.weapon.play(keys.enemyWeapons(this.kind));
  }
  /** A short white flash where a shot landed. */
  flash() {
    this.base.setTint(16777215).setTintMode(Phaser4.TintModes.FILL);
    this.scene.time.delayedCall(FLASH_MS, () => {
      this.base.clearTint().setTintMode(Phaser4.TintModes.MULTIPLY);
    });
  }
  /** Plays the pack's destruction animation in place of the ship, then goes. */
  destroy(explode) {
    if (!explode) {
      this.root.destroy();
      return;
    }
    const boom = this.scene.add.sprite(this.root.x, this.root.y, keys.enemyDestruction(this.kind)).setRotation(this.root.rotation);
    this.root.parentContainer.add(boom);
    this.root.destroy();
    boom.once(Phaser4.Animations.Events.ANIMATION_COMPLETE, () => {
      boom.destroy();
    });
    boom.play(keys.enemyDestruction(this.kind));
  }
};

// src/scenes/netplay.ts
var now = () => performance.now();
var NetPlay = class {
  status = "connecting";
  playerId;
  options;
  connection;
  remotes = /* @__PURE__ */ new Map();
  enemies = /* @__PURE__ */ new Map();
  enemyVolleys = new TimedQueue(20);
  enemyWarnings = new TimedQueue(20);
  destructions = new TimedQueue(20);
  shotEnds = new TimedQueue(20);
  latestSnapshot = 0;
  tickRate = 20;
  /** Enemies this player shot down, and enemy bullets that hit this ship. */
  enemiesDestroyed = 0;
  hitsTaken = 0;
  clock = new ServerClock(20);
  shots = new TimedQueue(20);
  spawned = false;
  constructor(options) {
    this.options = options;
    this.connection = new Connection({
      url: options.url,
      token: options.token,
      format: options.format,
      events: {
        welcome: (welcome) => {
          this.welcome(welcome);
        },
        snapshot: (snapshot) => {
          this.snapshot(snapshot);
        },
        shot: (remote) => {
          const shot = remote.shot;
          if (shot === void 0 || !this.remotes.has(remote.playerId)) {
            return;
          }
          this.shots.add(remote.tick, {
            from: remote.playerId,
            id: shot.id,
            shot: { weapon: fromWeapon(shot.weapon), muzzle: shot.muzzle, x: shot.x, y: shot.y, angle: shot.angle }
          });
        },
        left: (playerId) => {
          this.remove(playerId);
        },
        full: () => {
          this.status = "full";
        },
        unknownToken: () => {
          options.onUnknownToken();
        },
        disconnected: () => {
          if (this.status !== "full") {
            this.status = "offline";
          }
          for (const id of [...this.remotes.keys()]) {
            this.remove(id);
          }
          for (const [id, enemy] of this.enemies) {
            enemy.view.destroy(false);
            this.enemies.delete(id);
          }
          this.resetTimeline(this.tickRate);
          options.sim.projectiles.clear("remote");
          options.sim.projectiles.clear("enemy");
        },
        enemyFired: (fired) => {
          this.enemyFired(fired);
        },
        enemyDestroyed: (destroyed) => {
          const enemy = this.enemies.get(destroyed.enemyId);
          if (enemy !== void 0) {
            enemy.destroyedAt = destroyed.tick;
          }
          this.destructions.add(destroyed.tick, destroyed);
        },
        shotEnded: (ended) => {
          this.shotEnds.add(ended.tick, { owner: ended.playerId, shotId: ended.shotId });
        }
      }
    });
  }
  start() {
    this.connection.start();
  }
  stop() {
    this.connection.stop();
  }
  /** Other players, for the HUD and the E2E tests. */
  get others() {
    return [...this.remotes.entries()].map(([id, r]) => ({
      id,
      name: r.name,
      colour: r.colour,
      x: r.view.root.x,
      y: r.view.root.y
    }));
  }
  /** Enemies as drawn, for the E2E tests. */
  get enemyList() {
    return [...this.enemies.entries()].map(([id, e]) => ({ id, kind: e.view.kind, x: e.view.x, y: e.view.y }));
  }
  /**
   * Once a frame: send the local ship, draw the others and the enemies, spawn
   * their shots, and test hits. Returns where hits landed.
   */
  update(events) {
    const frame = { enemyHits: [], hitsOnMe: [] };
    const nowMs = now();
    this.connection.sendState(this.options.sim.ship, nowMs);
    for (const shot of events.shots) {
      this.connection.sendShot(shot);
    }
    const serverTick = this.clock.tickAt(nowMs);
    if (serverTick === void 0) {
      return frame;
    }
    const renderTick = serverTick - INTERPOLATION_DELAY_TICKS;
    const seconds = nowMs / 1e3;
    for (const remote of this.remotes.values()) {
      const ship = remote.buffer.sample(renderTick);
      if (ship === void 0) {
        continue;
      }
      if (ship.loadout.weapon !== remote.weapon) {
        remote.weapon = ship.loadout.weapon;
        remote.animator = new WeaponAnimator(weaponTiming(remote.weapon));
      }
      remote.view.setLoadout(ship.loadout);
      remote.view.setDamage(ship.damage);
      remote.view.setThrusting(ship.thrusting);
      remote.view.place(ship.x, ship.y, ship.angle);
      remote.view.weapon.setFrame(remote.animator.frame(seconds));
    }
    const volleys = /* @__PURE__ */ new Set();
    for (const { item: due, ageSeconds } of this.shots.due(renderTick)) {
      this.options.sim.projectiles.spawn(
        { kind: due.shot.weapon, x: due.shot.x, y: due.shot.y, angle: due.shot.angle },
        { ageSeconds, faction: "remote", owner: due.from, shotId: due.id }
      );
      const volley = WEAPON_STATS[due.shot.weapon].alternate ? void 0 : `${due.from}:${due.shot.weapon}`;
      if (volley === void 0 || !volleys.has(volley)) {
        this.options.audio.remoteShot(due.shot.weapon);
      }
      if (volley !== void 0) {
        volleys.add(volley);
      }
      const shooter = this.remotes.get(due.from);
      if (shooter !== void 0) {
        const stats = WEAPON_STATS[due.shot.weapon];
        shooter.animator.release(seconds, stats.alternate ? due.shot.muzzle : 0, stats.alternate ? stats.muzzles.length : 1);
      }
    }
    for (const { item: ended } of this.shotEnds.due(renderTick)) {
      this.options.sim.projectiles.end(ended.owner, ended.shotId);
    }
    this.drawEnemies(renderTick);
    this.testHits(frame, events.ticks * TICK_SECONDS);
    return frame;
  }
  drawEnemies(renderTick) {
    for (const enemy of this.enemies.values()) {
      const pose = enemy.buffer.sample(renderTick);
      if (pose !== void 0) {
        enemy.view.place(pose.x, pose.y, pose.angle);
      }
    }
    for (const { item: enemyId } of this.enemyWarnings.due(renderTick)) {
      this.enemies.get(enemyId)?.view.warn();
    }
    for (const { item: volley, ageSeconds } of this.enemyVolleys.due(renderTick)) {
      this.fireVolley(volley, ageSeconds);
    }
    for (const { item: destroyed } of this.destructions.due(renderTick)) {
      this.destroyEnemy(destroyed);
    }
    for (const [id, enemy] of this.enemies) {
      if (enemy.lastSeen < this.latestSnapshot && enemy.lastSeen < renderTick) {
        enemy.view.destroy(false);
        this.enemies.delete(id);
      }
    }
  }
  /**
   * Own shots against enemies as drawn, reported to the server (the design's
   * trust model); enemy bullets against the local ship, which only flash it
   * until health exists (#5). Each projectile is tested along the path it
   * flew during the frame's stepSeconds, so low frame rates don't skip hits.
   */
  testHits(frame, stepSeconds) {
    const targets = [...this.enemies.entries()].map(([id, e]) => ({
      id,
      x: e.view.x,
      y: e.view.y,
      radius: ENEMY_RADIUS[e.view.kind]
    }));
    const ship = this.options.sim.ship;
    const me = [{ id: "me", x: ship.x, y: ship.y, radius: SHIP_RADIUS }];
    for (const p of this.options.sim.projectiles.items) {
      if (!p.active || p.faction === "remote") {
        continue;
      }
      const from = positionAt(p, Math.max(0, p.age - stepSeconds));
      if (p.faction === "own" && isWeapon(p.kind)) {
        const target = hitTargetAlong(from.x, from.y, p.x, p.y, targets);
        if (target !== void 0) {
          p.active = false;
          this.connection.sendHit(target.id, p.shotId, WEAPON_STATS[p.kind].damage);
          this.enemies.get(target.id)?.view.flash();
          frame.enemyHits.push({ x: p.x, y: p.y });
        }
      } else if (p.faction === "enemy" && hitTargetAlong(from.x, from.y, p.x, p.y, me) !== void 0) {
        p.active = false;
        this.hitsTaken++;
        frame.hitsOnMe.push({ x: p.x, y: p.y });
      }
    }
  }
  /**
   * Spawns a volley's bullets from where the enemy is at its tick, unless it
   * was shot down first or is too far away to matter.
   */
  fireVolley(volley, ageSeconds) {
    const enemy = this.enemies.get(volley.enemyId);
    if (enemy === void 0 || enemy.destroyedAt !== void 0 && enemy.destroyedAt < volley.tick) {
      return;
    }
    const origin = enemy.buffer.sample(volley.tick) ?? volley;
    const ship = this.options.sim.ship;
    if (Math.hypot(origin.x - ship.x, origin.y - ship.y) > ENEMY_VOLLEY_RANGE) {
      return;
    }
    for (const bullet of enemyPattern(volley.kind, origin.x, origin.y, volley.angle, volley.seed)) {
      this.options.sim.projectiles.spawn(bullet, { ageSeconds, faction: "enemy", owner: String(volley.enemyId) });
    }
    this.options.audio.enemyShot();
  }
  enemyFired(fired) {
    this.enemyWarnings.add(fired.tick - fired.warnTicks, fired.enemyId);
    this.enemyVolleys.add(fired.tick, {
      enemyId: fired.enemyId,
      kind: fromEnemyKind(fired.kind),
      tick: fired.tick,
      seed: fired.seed,
      angle: fired.angle,
      x: fired.x,
      y: fired.y
    });
  }
  destroyEnemy(destroyed) {
    const enemy = this.enemies.get(destroyed.enemyId);
    if (enemy === void 0) {
      return;
    }
    this.enemies.delete(destroyed.enemyId);
    const ship = this.options.sim.ship;
    if (Math.hypot(enemy.view.x - ship.x, enemy.view.y - ship.y) <= ENEMY_SOUND_RANGE) {
      this.options.audio.enemyDestroyed();
    }
    enemy.view.destroy(true);
    if (destroyed.byPlayerId === this.playerId) {
      this.enemiesDestroyed++;
    }
  }
  welcome(welcome) {
    this.status = "online";
    this.playerId = welcome.playerId;
    this.clock = new ServerClock(welcome.tickRate);
    this.tickRate = welcome.tickRate;
    this.resetTimeline(welcome.tickRate);
    this.clock.observe(welcome.tick, now());
    if (!this.spawned) {
      this.spawned = true;
      const { ship, previous } = this.options.sim;
      ship.x = previous.x = welcome.spawnX;
      ship.y = previous.y = welcome.spawnY;
      ship.vx = 0;
      ship.vy = 0;
    }
  }
  /** Drops everything waiting for the delayed timeline. */
  resetTimeline(tickRate) {
    this.shots = new TimedQueue(tickRate);
    this.enemyVolleys = new TimedQueue(tickRate);
    this.enemyWarnings = new TimedQueue(tickRate);
    this.destructions = new TimedQueue(tickRate);
    this.shotEnds = new TimedQueue(tickRate);
  }
  snapshot(snapshot) {
    this.clock.observe(snapshot.tick, now());
    this.latestSnapshot = snapshot.tick;
    for (const player of snapshot.players) {
      if (player.state === void 0) {
        continue;
      }
      const remote = this.remotes.get(player.playerId) ?? this.add(player.playerId, player.name, player.colour);
      remote.buffer.push(snapshot.tick, fromShipState(player.state));
    }
    for (const state of snapshot.enemies) {
      let enemy = this.enemies.get(state.enemyId);
      if (enemy === void 0) {
        enemy = {
          view: new EnemyView(this.options.scene, this.options.ships, fromEnemyKind(state.kind)),
          buffer: new StateBuffer(),
          lastSeen: snapshot.tick,
          destroyedAt: void 0
        };
        this.enemies.set(state.enemyId, enemy);
      }
      enemy.lastSeen = snapshot.tick;
      enemy.buffer.push(snapshot.tick, { x: state.x, y: state.y, angle: state.angle });
    }
  }
  add(id, name, colour) {
    const { scene, ships } = this.options;
    const view = new ShipView(scene, ships, 0, 0);
    view.setLabel(scene, ships, name, colour, this.options.labelResolution());
    const remote = {
      view,
      buffer: new StateBuffer(),
      animator: new WeaponAnimator(weaponTiming("autoCannon")),
      weapon: "autoCannon",
      name,
      colour
    };
    this.remotes.set(id, remote);
    return remote;
  }
  remove(id) {
    this.remotes.get(id)?.view.destroy();
    this.remotes.delete(id);
  }
};

// src/scenes/sandbox.ts
var PARALLAX = [0.05, 0.15, 0.3];
var BACKGROUND_FPS = 6;
var BACKGROUND_FRAMES = 9;
var CAMERA_LERP = 0.15;
var HUD_REFRESH_MS = 250;
var HIT_SPARKS = 5;
var HUD_FONT_PX = 12;
var HUD_MARGIN_PX = 8;
var SandboxScene = class extends Phaser5.Scene {
  sim = new Sandbox();
  world;
  backgrounds = [];
  backgroundFrame = 0;
  ships;
  ship;
  net;
  projectileSprites = [];
  muzzleFlash;
  puff;
  bloom;
  vignette;
  hudCamera;
  hud;
  moveKeys;
  damage = "fullHealth";
  effects = true;
  shotsFired = 0;
  hudUpdatedAt = 0;
  debug;
  weaponFrames = new WeaponAnimator(weaponTiming("autoCannon"));
  audioSettings;
  audio;
  constructor() {
    super("sandbox");
  }
  create() {
    this.sim.controlMode = loadControlMode();
    this.audioSettings = loadAudioSettings();
    this.audio = new ShipAudio(this, this.audioSettings);
    this.world = this.add.layer();
    this.createBackgrounds();
    this.createScenery();
    this.ships = this.add.container(0, 0);
    this.world.add(this.ships);
    this.ship = new ShipView(this, this.ships, this.sim.ship.x, this.sim.ship.y);
    this.createProjectiles();
    this.createParticles();
    this.createCameras();
    this.createInput();
    this.applyLoadout();
    this.resize();
    this.scale.on(Phaser5.Scale.Events.RESIZE, () => {
      this.resize();
    });
    this.startNetPlay();
    this.debug = {
      ready: true,
      scene: this.scene.key,
      ship: { x: 0, y: 0, angle: 0, thrusting: false },
      loadout: this.sim.ship.loadout,
      damage: this.damage,
      rotationSnap: 0,
      controlMode: this.sim.controlMode,
      effects: this.effects,
      projectiles: 0,
      shotsFired: 0,
      zoom: 1,
      fps: 0,
      weaponFrame: 0,
      audio: { muted: false, music: false, locked: true, backend: "none", musicLoaded: false, playingMusic: null },
      net: { status: "offline", playerId: void 0, others: [] },
      enemies: [],
      enemiesDestroyed: 0,
      hitsTaken: 0
    };
    this.publish();
  }
  update(time, deltaMs) {
    const events = this.sim.advance(deltaMs / 1e3, this.readInput());
    const net = this.net?.update(events);
    this.drawShip(events);
    if (net !== void 0) {
      this.showHits(net);
    }
    this.drawProjectiles();
    this.playEffects(events);
    this.audio.update(this.sim.ship, events);
    this.scrollBackgrounds(time);
    if (time - this.hudUpdatedAt > HUD_REFRESH_MS) {
      this.hudUpdatedAt = time;
      this.updateHud();
    }
    this.publish();
  }
  createBackgrounds() {
    this.backgrounds = keys.background.map((key, i) => {
      const sprite = this.add.tileSprite(0, 0, VIEW_WIDTH, VIEW_HEIGHT, key, 0).setScrollFactor(0);
      this.world.add(sprite);
      return { sprite, factor: PARALLAX[i] ?? 0 };
    });
  }
  createScenery() {
    for (const rock of asteroidField()) {
      this.world.add(this.add.image(rock.x, rock.y, keys.asteroid).setRotation(rock.rotation).setFlipX(rock.flip));
    }
    this.world.add(this.add.sprite(0, 0, keys.planet).play(keys.planet));
  }
  /** Plays with others once the player has a name; without one it stays single-player. */
  startNetPlay() {
    const token = this.registry.get("token") ?? loadToken();
    if (token === void 0) {
      return;
    }
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    this.net = new NetPlay({
      scene: this,
      ships: this.ships,
      sim: this.sim,
      audio: this.audio,
      url: `${scheme}://${window.location.host}/ws`,
      token,
      format: wireFormatFrom(window.location.search),
      labelResolution: () => this.cameras.main.zoom,
      onUnknownToken: () => {
        clearToken();
        window.location.reload();
      }
    });
    this.net.start();
    this.events.once(Phaser5.Scenes.Events.SHUTDOWN, () => this.net?.stop());
  }
  createProjectiles() {
    this.projectileSprites = this.sim.projectiles.items.map(() => {
      const sprite = this.add.sprite(0, 0, keys.projectile("autoCannon")).setVisible(false);
      this.world.add(sprite);
      return sprite;
    });
  }
  createParticles() {
    this.muzzleFlash = this.add.particles(0, 0, keys.projectile("bigSpaceGun"), {
      frame: [2, 3, 4],
      lifespan: 120,
      speed: { min: 10, max: 40 },
      scale: { start: 0.35, end: 0 },
      alpha: { start: 0.9, end: 0 },
      blendMode: Phaser5.BlendModes.ADD,
      emitting: false
    });
    this.puff = this.add.particles(0, 0, keys.projectile("bigSpaceGun"), {
      frame: [6, 7, 8],
      lifespan: 260,
      speed: { min: 15, max: 60 },
      scale: { start: 0.4, end: 0 },
      alpha: { start: 0.8, end: 0 },
      blendMode: Phaser5.BlendModes.ADD,
      emitting: false
    });
    this.world.add([this.muzzleFlash, this.puff]);
  }
  createCameras() {
    const main = this.cameras.main;
    main.setBackgroundColor("#05030a");
    main.startFollow(this.ship.root, true, CAMERA_LERP, CAMERA_LERP);
    main.setRoundPixels(true);
    this.bloom = Phaser5.Actions.AddEffectBloom(main, { threshold: 0.55, blurRadius: 3, blendAmount: 0.6 })[0]?.parallelFilters;
    this.vignette = main.filters.external.addVignette(0.5, 0.5, 0.9, 0.35);
    this.hud = this.add.text(8, 8, "", { fontFamily: "monospace", fontSize: "12px", color: "#d8f8ff" }).setShadow(1, 1, "#000000", 0);
    main.ignore(this.hud);
    this.hudCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.hudCamera.ignore(this.world);
  }
  createInput() {
    const keyboard = this.input.keyboard;
    if (keyboard === null) {
      throw new Error("keyboard input is disabled");
    }
    const codes = Phaser5.Input.Keyboard.KeyCodes;
    this.moveKeys = {
      up: keyboard.addKey(codes.W),
      down: keyboard.addKey(codes.S),
      left: keyboard.addKey(codes.A),
      right: keyboard.addKey(codes.D)
    };
    this.input.mouse?.disableContextMenu();
    const onKeyDown = (event) => {
      if (!event.repeat) {
        this.handleDebugKey(event.code);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    this.events.once(Phaser5.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener("keydown", onKeyDown);
    });
  }
  handleDebugKey(code) {
    const ship = this.sim.ship;
    switch (code) {
      case "Digit1":
        ship.loadout.weapon = nextInCycle(WEAPONS, ship.loadout.weapon);
        ship.cooldown = 0;
        ship.nextMuzzle = 0;
        this.applyLoadout();
        this.audio.partSwitched();
        break;
      case "Digit2":
        ship.loadout.engine = nextInCycle(ENGINES, ship.loadout.engine);
        this.applyLoadout();
        this.audio.partSwitched();
        break;
      case "Digit3":
        ship.loadout.shield = nextInCycle(SHIELDS, ship.loadout.shield);
        this.applyLoadout();
        this.audio.shieldSwitched();
        break;
      case "KeyM":
        this.audio.toggleMute();
        saveAudioSettings(this.audioSettings);
        this.updateHud();
        break;
      case "KeyN":
        this.audio.toggleMusic();
        saveAudioSettings(this.audioSettings);
        this.updateHud();
        break;
      case "KeyH":
        this.damage = nextInCycle(DAMAGE_STATES, this.damage);
        ship.damage = DAMAGE_STATES.indexOf(this.damage);
        this.ship.setDamage(ship.damage);
        break;
      case "KeyC":
        this.sim.controlMode = nextInCycle(CONTROL_MODES, this.sim.controlMode);
        saveControlMode(this.sim.controlMode);
        this.updateHud();
        break;
      case "KeyR":
        ship.rotationSnap = ship.rotationSnap === 0 ? ROTATION_SNAP_STEPS : 0;
        this.updateHud();
        break;
      case "KeyF":
        this.effects = !this.effects;
        if (this.bloom !== void 0) {
          this.bloom.active = this.effects;
        }
        if (this.vignette !== void 0) {
          this.vignette.active = this.effects;
        }
        this.updateHud();
        break;
      default:
    }
  }
  applyLoadout() {
    const { weapon, engine } = this.sim.ship.loadout;
    this.ship.setLoadout(this.sim.ship.loadout);
    this.weaponFrames = new WeaponAnimator(weaponTiming(weapon));
    this.audio.setEngine(engine);
    this.updateHud();
  }
  resize() {
    const { width, height } = this.scale;
    const zoom = integerZoom(width, height, VIEW_WIDTH, VIEW_HEIGHT);
    this.cameras.main.setZoom(zoom);
    this.hudCamera.setSize(width, height);
    const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
    this.hud.setFontSize(HUD_FONT_PX * dpr).setPosition(HUD_MARGIN_PX * dpr, HUD_MARGIN_PX * dpr);
    for (const { sprite } of this.backgrounds) {
      sprite.setPosition(width / 2, height / 2).setSize(Math.ceil(width / zoom), Math.ceil(height / zoom));
    }
  }
  readInput() {
    const pointer = this.input.activePointer;
    const aim = pointer.positionToCamera(this.cameras.main);
    return {
      up: this.moveKeys.up.isDown,
      down: this.moveKeys.down.isDown,
      left: this.moveKeys.left.isDown,
      right: this.moveKeys.right.isDown,
      pointerX: aim.x,
      pointerY: aim.y,
      fire: pointer.leftButtonDown()
    };
  }
  drawShip(events) {
    const { ship, previous, alpha } = this.sim;
    this.ship.place(previous.x + (ship.x - previous.x) * alpha, previous.y + (ship.y - previous.y) * alpha, ship.angle);
    this.ship.setThrusting(ship.thrusting);
    this.animateWeapon(events);
  }
  animateWeapon(events) {
    const now2 = this.time.now / 1e3;
    const stats = WEAPON_STATS[this.sim.ship.loadout.weapon];
    if (events.charges.length > 0) {
      this.weaponFrames.charge(now2, stats.charge);
    }
    if (stats.alternate) {
      for (const shot of events.shots) {
        this.weaponFrames.release(now2, shot.muzzle, stats.muzzles.length);
      }
    } else if (events.shots.length > 0) {
      this.weaponFrames.release(now2, 0, 1);
    }
    this.ship.weapon.setFrame(this.weaponFrames.frame(now2));
  }
  drawProjectiles() {
    this.sim.projectiles.items.forEach((p, i) => {
      const sprite = this.projectileSprites[i];
      if (sprite === void 0) {
        return;
      }
      sprite.setVisible(p.active);
      if (!p.active) {
        return;
      }
      sprite.setPosition(p.x, p.y).setRotation(p.angle + SPRITE_FACING);
      sprite.play(isWeapon(p.kind) ? keys.projectile(p.kind) : keys.enemyBullet(p.kind), true);
    });
  }
  playEffects(events) {
    this.shotsFired += events.shots.length;
    if (!this.effects) {
      return;
    }
    for (const shot of events.shots) {
      this.muzzleFlash.explode(3, shot.x, shot.y);
      const shake = WEAPON_STATS[shot.weapon].shake;
      if (shake > 0) {
        this.cameras.main.shake(120, shake);
      }
    }
    for (const p of events.expired) {
      this.puff.explode(4, p.x, p.y);
    }
  }
  /** Sparks where shots land; a hull flash when an enemy bullet hits us. */
  showHits(net) {
    for (const hit of net.enemyHits) {
      this.puff.explode(HIT_SPARKS, hit.x, hit.y);
    }
    for (const hit of net.hitsOnMe) {
      this.puff.explode(HIT_SPARKS, hit.x, hit.y);
    }
    if (net.hitsOnMe.length > 0) {
      this.ship.flash(this);
    }
  }
  /** Scrolls each layer at its parallax factor; TileSprites cannot play animations, so frames step here. */
  scrollBackgrounds(time) {
    const camera = this.cameras.main;
    const frame = Math.floor(time / 1e3 * BACKGROUND_FPS) % BACKGROUND_FRAMES;
    const frameChanged = frame !== this.backgroundFrame;
    this.backgroundFrame = frame;
    for (const { sprite, factor } of this.backgrounds) {
      sprite.setTilePosition(camera.scrollX * factor, camera.scrollY * factor);
      if (frameChanged) {
        sprite.setFrame(frame);
      }
    }
  }
  updateHud() {
    const { loadout, rotationSnap } = this.sim.ship;
    this.hud.setText([
      `weapon ${loadout.weapon}  engine ${loadout.engine}  shield ${loadout.shield}  hull ${this.damage}`,
      `controls ${this.sim.controlMode === "ship" ? "ship-relative" : "screen-relative"}  rotation ${rotationSnap === 0 ? "free" : `${rotationSnap} directions`}  effects ${this.effects ? "on" : "off"}  sound ${this.audioSettings.muted ? "off" : "on"}  music ${this.audioSettings.music ? "on" : "off"}  ${Math.round(this.game.loop.actualFps)} fps`,
      "WASD move \xB7 mouse aim \xB7 hold left button to fire \xB7 C controls \xB7 M sound \xB7 N music \xB7 1/2/3 parts \xB7 H hull \xB7 R rotation \xB7 F effects",
      this.netStatus()
    ]);
  }
  netStatus() {
    const net = this.net;
    if (net === void 0) {
      return "playing alone";
    }
    switch (net.status) {
      case "online": {
        const count = net.others.length;
        return `online \xB7 ${count === 0 ? "nobody else here yet" : `${count} other${count === 1 ? "" : "s"} here`}`;
      }
      case "full":
        return "the frontier is full, try again soon";
      case "offline":
        return "offline \xB7 reconnecting";
      default:
        return "connecting";
    }
  }
  publish() {
    const { ship, projectiles } = this.sim;
    this.debug.ship.x = ship.x;
    this.debug.ship.y = ship.y;
    this.debug.ship.angle = ship.angle;
    this.debug.ship.thrusting = ship.thrusting;
    this.debug.damage = this.damage;
    this.debug.rotationSnap = ship.rotationSnap;
    this.debug.controlMode = this.sim.controlMode;
    this.debug.effects = this.effects;
    this.debug.projectiles = projectiles.activeCount;
    this.debug.shotsFired = this.shotsFired;
    this.debug.zoom = this.cameras.main.zoom;
    this.debug.fps = this.game.loop.actualFps;
    this.debug.weaponFrame = Number(this.ship.weapon.frame.name);
    this.debug.audio.muted = this.audioSettings.muted;
    this.debug.audio.music = this.audioSettings.music;
    this.debug.audio.locked = this.sound.locked;
    this.debug.audio.playingMusic = this.audio.playingMusic;
    this.debug.audio.backend = this.audio.backend;
    this.debug.audio.musicLoaded = this.audio.musicReady;
    this.debug.net.status = this.net?.status ?? "offline";
    this.debug.net.playerId = this.net?.playerId;
    this.debug.net.others = this.net?.others ?? [];
    this.debug.enemies = this.net?.enemyList ?? [];
    this.debug.enemiesDestroyed = this.net?.enemiesDestroyed ?? 0;
    this.debug.hitsTaken = this.net?.hitsTaken ?? 0;
    publishDebugState(this.debug);
  }
};

// src/main.ts
async function start() {
  let token = loadToken();
  if (token === void 0) {
    token = await askName();
    if (token !== void 0) {
      saveToken(token);
    }
  }
  const size = deviceSize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
  const game = new Phaser6.Game({
    type: Phaser6.AUTO,
    parent: "game",
    backgroundColor: "#05030a",
    pixelArt: true,
    roundPixels: true,
    banner: false,
    // Sized in device pixels and shown at CSS size, so pixel art stays even
    // at any display scaling (see display.ts).
    scale: {
      mode: Phaser6.Scale.NONE,
      width: size.width,
      height: size.height,
      zoom: size.zoom
    },
    scene: [BootScene, SandboxScene],
    callbacks: {
      // The registry carries the token even where the browser refuses storage.
      preBoot: (game2) => {
        game2.registry.set("token", token);
      }
    }
  });
  fitToWindow(game);
}
function fitToWindow(game) {
  const fit = () => {
    const size = deviceSize(window.innerWidth, window.innerHeight, window.devicePixelRatio);
    game.scale.setZoom(size.zoom);
    game.scale.resize(size.width, size.height);
  };
  window.addEventListener("resize", fit);
  const watchRatio = () => {
    window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
      "change",
      () => {
        fit();
        watchRatio();
      },
      { once: true }
    );
  };
  watchRatio();
}
void start();
