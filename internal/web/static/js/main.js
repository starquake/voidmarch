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

// src/sim/rules.gen.ts
var WEAPONS = ["autoCannon", "rockets", "bigSpaceGun", "zapper"];
var ENGINES = ["base", "bigPulse", "burst", "supercharged"];
var SHIELDS = ["front", "frontAndSide", "round", "invincibility"];
var ENEMY_KINDS = ["scout", "fighter"];
var PROJECTILE_KINDS = ["autoCannon", "rockets", "bigSpaceGun", "zapper", "klaedBullet", "klaedBigBullet"];
var FACTIONS = ["own", "remote", "enemy"];
var DEFAULT_LOADOUT = { weapon: "autoCannon", engine: "base", shield: "front" };
var TICK_RATE = 60;
var TICK_SECONDS = 1 / TICK_RATE;
var WORLD_HALF_SIZE = 2e3;
var WORLD_EDGE_BAND = 200;
var SAFE_ZONE_RADIUS = 300;
var SHIP_RADIUS = 12;
var ENGINE_STATS = {
  base: { acceleration: 900, maxSpeed: 220, drag: 3.5 },
  bigPulse: { acceleration: 520, maxSpeed: 300, drag: 1.2 },
  burst: { acceleration: 1700, maxSpeed: 185, drag: 7 },
  supercharged: { acceleration: 1200, maxSpeed: 270, drag: 2 }
};
var WEAPON_STATS = {
  autoCannon: {
    interval: 0.13,
    charge: 0,
    damage: 1,
    speed: 520,
    lifetime: 0.9,
    muzzles: [{ forward: 9, right: -10.5 }, { forward: 9, right: 10.5 }],
    alternate: true,
    shake: 0
  },
  rockets: {
    interval: 0.32,
    charge: 0,
    damage: 4,
    speed: 140,
    lifetime: 1.5,
    muzzles: [{ forward: 7, right: -12 }, { forward: 7, right: 12 }],
    alternate: true,
    shake: 0
  },
  bigSpaceGun: {
    interval: 0.9,
    charge: 0.45,
    damage: 12,
    speed: 300,
    lifetime: 2,
    muzzles: [{ forward: 16, right: 0 }],
    alternate: false,
    shake: 6e-3
  },
  zapper: {
    interval: 0.24,
    charge: 0.1,
    damage: 2,
    speed: 430,
    lifetime: 0.75,
    muzzles: [{ forward: 15, right: -11 }, { forward: 15, right: 11 }],
    alternate: false,
    shake: 0
  }
};
var ENEMY_RADIUS = {
  scout: 11,
  fighter: 12
};
var LAYOUT = {
  ticks: 0,
  alpha: 1,
  shipX: 2,
  shipY: 3,
  shipVX: 4,
  shipVY: 5,
  shipAngle: 6,
  shipThrusting: 7,
  shipCooldown: 8,
  shipCharging: 9,
  shipNextMuzzle: 10,
  shipDamage: 11,
  shipRotationSnap: 12,
  shipWeapon: 13,
  shipEngine: 14,
  shipShield: 15,
  previousX: 16,
  previousY: 17,
  shots: 18,
  charges: 19,
  expired: 20,
  projectileCapacity: 256,
  poolOffset: 21,
  projectileSize: 8,
  projectileActive: 0,
  projectileKind: 1,
  projectileFaction: 2,
  projectileX: 3,
  projectileY: 4,
  projectileAngle: 5,
  projectileAge: 6,
  projectileShotId: 7,
  shotsOffset: 2069,
  shotSize: 6,
  shotId: 0,
  shotWeapon: 1,
  shotMuzzle: 2,
  shotX: 3,
  shotY: 4,
  shotAngle: 5,
  chargesOffset: 2129,
  expiredOffset: 2134,
  expiredSize: 4,
  expiredKind: 0,
  expiredFaction: 1,
  expiredX: 2,
  expiredY: 3,
  stateSize: 3158,
  maxTargets: 128
};

// src/sim/loadout.ts
var DAMAGE_STATES = ["fullHealth", "slightDamage", "damaged", "veryDamaged"];
function nextInCycle(list, current) {
  const next = list[(list.indexOf(current) + 1) % list.length];
  if (next === void 0) {
    throw new Error("nextInCycle: empty list");
  }
  return next;
}

// src/sim/tuning.ts
var VIEW_WIDTH = 640;
var VIEW_HEIGHT = 360;
var ROTATION_SNAP_STEPS = 16;
var ASTEROID_SEED = 20260927;
var ASTEROID_COUNT = 60;
var ASTEROID_CLEAR_RADIUS = 260;
var ENEMY_VOLLEY_RANGE = 800;
var ENEMY_SOUND_RANGE = 400;
var ENEMY_FIRE_GLOW_COLOUR = 4172031;
var ENEMY_FIRE_GLOW_STRENGTH = 6;
var ENEMY_FIRE_GLOW_QUALITY = 3;
var ENEMY_FIRE_GLOW_DISTANCE = 4;

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
var BULLET_VARIANT = "blue";
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
      url: `${klaed}/${name}-${BULLET_VARIANT}.png`,
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
var file_voidmarch_v1_messages = /* @__PURE__ */ fileDesc("Cht2b2lkbWFyY2gvdjEvbWVzc2FnZXMucHJvdG8SDHZvaWRtYXJjaC52MSJ7CgdMb2Fkb3V0EiQKBndlYXBvbhgBIAEoDjIULnZvaWRtYXJjaC52MS5XZWFwb24SJAoGZW5naW5lGAIgASgOMhQudm9pZG1hcmNoLnYxLkVuZ2luZRIkCgZzaGllbGQYAyABKA4yFC52b2lkbWFyY2gudjEuU2hpZWxkIpMBCglTaGlwU3RhdGUSCQoBeBgBIAEoAhIJCgF5GAIgASgCEgoKAnZ4GAMgASgCEgoKAnZ5GAQgASgCEg0KBWFuZ2xlGAUgASgCEhEKCXRocnVzdGluZxgGIAEoCBImCgdsb2Fkb3V0GAcgASgLMhUudm9pZG1hcmNoLnYxLkxvYWRvdXQSDgoGZGFtYWdlGAggASgNIhYKBUhlbGxvEg0KBXRva2VuGAEgASgJIoUBCglTaG90RmlyZWQSCgoCaWQYASABKA0SJAoGd2VhcG9uGAIgASgOMhQudm9pZG1hcmNoLnYxLldlYXBvbhIOCgZtdXp6bGUYAyABKA0SCQoBeBgEIAEoAhIJCgF5GAUgASgCEg0KBWFuZ2xlGAYgASgCEhEKCWNvbXBhbmlvbhgHIAEoDSJPCgNIaXQSEAoIZW5lbXlfaWQYASABKA0SDwoHc2hvdF9pZBgCIAEoDRIOCgZkYW1hZ2UYAyABKA0SFQoJY29tcGFuaW9uGAQgASgNQgIYASIICgZTdW1tb24iTwoOQ29tcGFuaW9uU3RhdGUSEQoJY29tcGFuaW9uGAEgASgNEiYKBXN0YXRlGAIgASgLMhcudm9pZG1hcmNoLnYxLlNoaXBTdGF0ZToCGAEiHgoOQ2hvb3NlU3F1YWRyb24SDAoEbmFtZRgBIAEoCSKaAQoNU3F1YWRyb25PcmRlchIpCgRtb2RlGAEgASgOMhsudm9pZG1hcmNoLnYxLkNvbXBhbmlvbk1vZGUSMAoIb25lX3Nob3QYAiABKA4yHi52b2lkbWFyY2gudjEuQ29tcGFuaW9uT25lU2hvdBIJCgF4GAMgASgCEgkKAXkYBCABKAISFgoOZm9jdXNfZW5lbXlfaWQYBSABKA0iHAoHRGlzbWlzcxIRCgljb21wYW5pb24YASABKA0iqwMKDUNsaWVudE1lc3NhZ2USJAoFaGVsbG8YASABKAsyEy52b2lkbWFyY2gudjEuSGVsbG9IABIoCgVzdGF0ZRgCIAEoCzIXLnZvaWRtYXJjaC52MS5TaGlwU3RhdGVIABInCgRzaG90GAMgASgLMhcudm9pZG1hcmNoLnYxLlNob3RGaXJlZEgAEiAKA2hpdBgEIAEoCzIRLnZvaWRtYXJjaC52MS5IaXRIABImCgZzdW1tb24YBSABKAsyFC52b2lkbWFyY2gudjEuU3VtbW9uSAASNQoJY29tcGFuaW9uGAYgASgLMhwudm9pZG1hcmNoLnYxLkNvbXBhbmlvblN0YXRlQgIYAUgAEigKB2Rpc21pc3MYByABKAsyFS52b2lkbWFyY2gudjEuRGlzbWlzc0gAEjcKD2Nob29zZV9zcXVhZHJvbhgIIAEoCzIcLnZvaWRtYXJjaC52MS5DaG9vc2VTcXVhZHJvbkgAEjUKDnNxdWFkcm9uX29yZGVyGAkgASgLMhsudm9pZG1hcmNoLnYxLlNxdWFkcm9uT3JkZXJIAEIGCgRraW5kIv8BCgdXZWxjb21lEhEKCXBsYXllcl9pZBgBIAEoCRIOCgZjb2xvdXIYAiABKA0SDwoHc3Bhd25feBgDIAEoAhIPCgdzcGF3bl95GAQgASgCEgwKBHRpY2sYBSABKA0SEQoJdGlja19yYXRlGAYgASgNEhcKD2NvbXBhbmlvbl9saW1pdBgHIAEoDRIMCgRuYW1lGAkgASgJEhIKCmNvbXBhbmlvbnMYCiADKA0SKgoJc3F1YWRyb25zGAsgASgLMhcudm9pZG1hcmNoLnYxLlNxdWFkcm9ucxIQCghzcXVhZHJvbhgMIAEoCUoECAgQCVIPc3VtbW9uX2FueXdoZXJlIo0BCg5QbGF5ZXJTbmFwc2hvdBIRCglwbGF5ZXJfaWQYASABKAkSDAoEbmFtZRgCIAEoCRIOCgZjb2xvdXIYAyABKA0SJgoFc3RhdGUYBCABKAsyFy52b2lkbWFyY2gudjEuU2hpcFN0YXRlEhAKCG93bmVyX2lkGAUgASgJEhAKCHNxdWFkcm9uGAYgASgJIkUKDlNxdWFkcm9uTWVtYmVyEhEKCXBsYXllcl9pZBgBIAEoCRIMCgRuYW1lGAIgASgJEhIKCmNvbXBhbmlvbnMYAyABKA0idgoMU3F1YWRyb25JbmZvEgwKBG5hbWUYASABKAkSLQoHbWVtYmVycxgCIAMoCzIcLnZvaWRtYXJjaC52MS5TcXVhZHJvbk1lbWJlchIpCgRtb2RlGAMgASgOMhsudm9pZG1hcmNoLnYxLkNvbXBhbmlvbk1vZGUiXQoJU3F1YWRyb25zEi0KCXNxdWFkcm9ucxgBIAMoCzIaLnZvaWRtYXJjaC52MS5TcXVhZHJvbkluZm8SEQoJbmV4dF9uYW1lGAIgASgJEg4KBmhhbmdhchgDIAEoDSJyCg5TcXVhZHJvbkpvaW5lZBIMCgRuYW1lGAEgASgJEikKBG1vZGUYAiABKA4yGy52b2lkbWFyY2gudjEuQ29tcGFuaW9uTW9kZRIRCgl0b29rX292ZXIYAyABKAgSCQoBeBgEIAEoAhIJCgF5GAUgASgCIiEKD1NxdWFkcm9uUmVmdXNlZBIOCgZyZWFzb24YASABKAkiXgoPU3F1YWRyb25PcmRlcmVkEhEKCXBsYXllcl9pZBgBIAEoCRIMCgRuYW1lGAIgASgJEioKBW9yZGVyGAMgASgLMhsudm9pZG1hcmNoLnYxLlNxdWFkcm9uT3JkZXIiagoKRW5lbXlTdGF0ZRIQCghlbmVteV9pZBgBIAEoDRIlCgRraW5kGAIgASgOMhcudm9pZG1hcmNoLnYxLkVuZW15S2luZBIJCgF4GAMgASgCEgkKAXkYBCABKAISDQoFYW5nbGUYBSABKAIicgoIU25hcHNob3QSDAoEdGljaxgBIAEoDRItCgdwbGF5ZXJzGAIgAygLMhwudm9pZG1hcmNoLnYxLlBsYXllclNuYXBzaG90EikKB2VuZW1pZXMYAyADKAsyGC52b2lkbWFyY2gudjEuRW5lbXlTdGF0ZSKaAQoKRW5lbXlGaXJlZBIQCghlbmVteV9pZBgBIAEoDRIlCgRraW5kGAIgASgOMhcudm9pZG1hcmNoLnYxLkVuZW15S2luZBIMCgR0aWNrGAMgASgNEgwKBHNlZWQYBCABKA0SCQoBeBgFIAEoAhIJCgF5GAYgASgCEg0KBWFuZ2xlGAcgASgCEhIKCndhcm5fdGlja3MYCCABKA0igwEKDkVuZW15RGVzdHJveWVkEhAKCGVuZW15X2lkGAEgASgNEiUKBGtpbmQYAiABKA4yFy52b2lkbWFyY2gudjEuRW5lbXlLaW5kEhQKDGJ5X3BsYXllcl9pZBgDIAEoCRIMCgR0aWNrGAQgASgNEgkKAXgYBSABKAISCQoBeRgGIAEoAiI9CglTaG90RW5kZWQSEQoJcGxheWVyX2lkGAEgASgJEg8KB3Nob3RfaWQYAiABKA0SDAoEdGljaxgDIAEoDSJUCgpSZW1vdGVTaG90EhEKCXBsYXllcl9pZBgBIAEoCRIMCgR0aWNrGAIgASgNEiUKBHNob3QYAyABKAsyFy52b2lkbWFyY2gudjEuU2hvdEZpcmVkIh8KClBsYXllckxlZnQSEQoJcGxheWVyX2lkGAEgASgJIjsKEENvbXBhbmlvbkdyYW50ZWQSEQoJY29tcGFuaW9uGAEgASgNEgkKAXgYAiABKAISCQoBeRgDIAEoAiIiChBDb21wYW5pb25SZWZ1c2VkEg4KBnJlYXNvbhgBIAEoCSI5ChJDb21wYW5pb25EaXNtaXNzZWQSEQoJY29tcGFuaW9uGAEgASgNEhAKCHRha2VuX2J5GAIgASgJIgYKBEZ1bGwilgYKDVNlcnZlck1lc3NhZ2USKAoHd2VsY29tZRgBIAEoCzIVLnZvaWRtYXJjaC52MS5XZWxjb21lSAASKgoIc25hcHNob3QYAiABKAsyFi52b2lkbWFyY2gudjEuU25hcHNob3RIABIoCgRzaG90GAMgASgLMhgudm9pZG1hcmNoLnYxLlJlbW90ZVNob3RIABIoCgRsZWZ0GAQgASgLMhgudm9pZG1hcmNoLnYxLlBsYXllckxlZnRIABIiCgRmdWxsGAUgASgLMhIudm9pZG1hcmNoLnYxLkZ1bGxIABIvCgtlbmVteV9maXJlZBgGIAEoCzIYLnZvaWRtYXJjaC52MS5FbmVteUZpcmVkSAASNwoPZW5lbXlfZGVzdHJveWVkGAcgASgLMhwudm9pZG1hcmNoLnYxLkVuZW15RGVzdHJveWVkSAASLQoKc2hvdF9lbmRlZBgIIAEoCzIXLnZvaWRtYXJjaC52MS5TaG90RW5kZWRIABI7ChFjb21wYW5pb25fZ3JhbnRlZBgJIAEoCzIeLnZvaWRtYXJjaC52MS5Db21wYW5pb25HcmFudGVkSAASOwoRY29tcGFuaW9uX3JlZnVzZWQYCiABKAsyHi52b2lkbWFyY2gudjEuQ29tcGFuaW9uUmVmdXNlZEgAEj8KE2NvbXBhbmlvbl9kaXNtaXNzZWQYCyABKAsyIC52b2lkbWFyY2gudjEuQ29tcGFuaW9uRGlzbWlzc2VkSAASLAoJc3F1YWRyb25zGAwgASgLMhcudm9pZG1hcmNoLnYxLlNxdWFkcm9uc0gAEjcKD3NxdWFkcm9uX2pvaW5lZBgNIAEoCzIcLnZvaWRtYXJjaC52MS5TcXVhZHJvbkpvaW5lZEgAEjkKEHNxdWFkcm9uX3JlZnVzZWQYDiABKAsyHS52b2lkbWFyY2gudjEuU3F1YWRyb25SZWZ1c2VkSAASOQoQc3F1YWRyb25fb3JkZXJlZBgPIAEoCzIdLnZvaWRtYXJjaC52MS5TcXVhZHJvbk9yZGVyZWRIAEIGCgRraW5kKnkKBldlYXBvbhIWChJXRUFQT05fVU5TUEVDSUZJRUQQABIWChJXRUFQT05fQVVUT19DQU5OT04QARISCg5XRUFQT05fUk9DS0VUUxACEhgKFFdFQVBPTl9CSUdfU1BBQ0VfR1VOEAMSEQoNV0VBUE9OX1pBUFBFUhAEKnIKBkVuZ2luZRIWChJFTkdJTkVfVU5TUEVDSUZJRUQQABIPCgtFTkdJTkVfQkFTRRABEhQKEEVOR0lORV9CSUdfUFVMU0UQAhIQCgxFTkdJTkVfQlVSU1QQAxIXChNFTkdJTkVfU1VQRVJDSEFSR0VEEAQqeQoGU2hpZWxkEhYKElNISUVMRF9VTlNQRUNJRklFRBAAEhAKDFNISUVMRF9GUk9OVBABEhkKFVNISUVMRF9GUk9OVF9BTkRfU0lERRACEhAKDFNISUVMRF9ST1VORBADEhgKFFNISUVMRF9JTlZJTkNJQklMSVRZEAQqVQoJRW5lbXlLaW5kEhoKFkVORU1ZX0tJTkRfVU5TUEVDSUZJRUQQABIUChBFTkVNWV9LSU5EX1NDT1VUEAESFgoSRU5FTVlfS0lORF9GSUdIVEVSEAIqtAEKDUNvbXBhbmlvbk1vZGUSHgoaQ09NUEFOSU9OX01PREVfVU5TUEVDSUZJRUQQABIZChVDT01QQU5JT05fTU9ERV9FU0NPUlQQARIZChVDT01QQU5JT05fTU9ERV9BVFRBQ0sQAhIYChRDT01QQU5JT05fTU9ERV9HVUFSRBADEhcKE0NPTVBBTklPTl9NT0RFX0hPTEQQBBIaChZDT01QQU5JT05fTU9ERV9TVEVBTFRIEAUqlAEKEENvbXBhbmlvbk9uZVNob3QSIgoeQ09NUEFOSU9OX09ORV9TSE9UX1VOU1BFQ0lGSUVEEAASHAoYQ09NUEFOSU9OX09ORV9TSE9UX0ZPQ1VTEAESHgoaQ09NUEFOSU9OX09ORV9TSE9UX1JFR1JPVVAQAhIeChpDT01QQU5JT05fT05FX1NIT1RfR09fSE9NRRADQkZaRGdpdGh1Yi5jb20vc3RhcnF1YWtlL3ZvaWRtYXJjaC9pbnRlcm5hbC9nZW4vdm9pZG1hcmNoL3YxO3ZvaWRtYXJjaHYxYgZwcm90bzM");
var ShipStateSchema = /* @__PURE__ */ messageDesc(file_voidmarch_v1_messages, 1);
var ClientMessageSchema = /* @__PURE__ */ messageDesc(file_voidmarch_v1_messages, 10);
var ServerMessageSchema = /* @__PURE__ */ messageDesc(file_voidmarch_v1_messages, 30);
var WeaponSchema = /* @__PURE__ */ enumDesc(file_voidmarch_v1_messages, 0);
var Weapon = /* @__PURE__ */ tsEnum(WeaponSchema);
var EngineSchema = /* @__PURE__ */ enumDesc(file_voidmarch_v1_messages, 1);
var Engine = /* @__PURE__ */ tsEnum(EngineSchema);
var ShieldSchema = /* @__PURE__ */ enumDesc(file_voidmarch_v1_messages, 2);
var Shield = /* @__PURE__ */ tsEnum(ShieldSchema);
var EnemyKindSchema = /* @__PURE__ */ enumDesc(file_voidmarch_v1_messages, 3);
var EnemyKind = /* @__PURE__ */ tsEnum(EnemyKindSchema);
var CompanionModeSchema = /* @__PURE__ */ enumDesc(file_voidmarch_v1_messages, 4);
var CompanionMode = /* @__PURE__ */ tsEnum(CompanionModeSchema);
var CompanionOneShotSchema = /* @__PURE__ */ enumDesc(file_voidmarch_v1_messages, 5);
var CompanionOneShot = /* @__PURE__ */ tsEnum(CompanionOneShotSchema);

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
var MODES = {
  escort: CompanionMode.ESCORT,
  attack: CompanionMode.ATTACK,
  guard: CompanionMode.GUARD,
  hold: CompanionMode.HOLD,
  stealth: CompanionMode.STEALTH
};
var toCompanionMode = (mode) => MODES[mode];
var fromCompanionMode = (mode) => Object.keys(MODES).find((m) => MODES[m] === mode);
var ONE_SHOTS = {
  focus: CompanionOneShot.FOCUS,
  regroup: CompanionOneShot.REGROUP,
  goHome: CompanionOneShot.GO_HOME
};
var toCompanionOneShot = (oneShot) => ONE_SHOTS[oneShot];
var fromCompanionOneShot = (oneShot) => Object.keys(ONE_SHOTS).find((k) => ONE_SHOTS[k] === oneShot);

// src/sim/math.ts
var TAU = Math.PI * 2;
function wrapAngle(angle) {
  return angle - TAU * Math.floor((angle + Math.PI) / TAU);
}
function normalize(x, y) {
  const length = Math.hypot(x, y);
  if (length === 0) {
    return { x: 0, y: 0 };
  }
  return { x: x / length, y: y / length };
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

// src/ordermenu.ts
var ORDER_ITEMS = [
  { kind: "mode", mode: "escort", label: "Escort" },
  { kind: "mode", mode: "attack", label: "Attack" },
  { kind: "mode", mode: "guard", label: "Guard" },
  { kind: "mode", mode: "hold", label: "Hold here" },
  { kind: "mode", mode: "stealth", label: "Stealth" },
  { kind: "oneShot", oneShot: "focus", label: "Focus" },
  { kind: "oneShot", oneShot: "regroup", label: "Regroup" },
  { kind: "oneShot", oneShot: "goHome", label: "Go home" }
];
var RING_ASPECT = 1;
function itemPosition(index, radius, count = ORDER_ITEMS.length) {
  const angle = -Math.PI / 2 + index * TAU / count;
  return { x: Math.cos(angle) * radius * RING_ASPECT, y: Math.sin(angle) * radius };
}
function pickItem(dx, dy, deadZone, count = ORDER_ITEMS.length) {
  const x = dx / RING_ASPECT;
  if (Math.hypot(x, dy) < deadZone) {
    return void 0;
  }
  const fromTop = Math.atan2(dy, x) + Math.PI / 2;
  return (Math.round(fromTop * count / TAU) % count + count) % count;
}
var FOCUS_PICK_RADIUS = 30;
var FOCUS_WIDE_RADIUS = 120;
var FOCUS_LAST_HIT_MS = 3e3;
function nearestWithin(items, x, y, radius) {
  let best;
  let bestDistance = radius;
  for (const item of items) {
    const d = Math.hypot(item.x - x, item.y - y);
    if (d <= bestDistance) {
      best = item;
      bestDistance = d;
    }
  }
  return best;
}
function chooseFocus(enemies, x, y, lastHit, nowMs) {
  const under = nearestWithin(enemies, x, y, FOCUS_PICK_RADIUS);
  if (under !== void 0) {
    return under.id;
  }
  if (lastHit !== void 0 && nowMs - lastHit.atMs <= FOCUS_LAST_HIT_MS && enemies.some((e) => e.id === lastHit.id)) {
    return lastHit.id;
  }
  return nearestWithin(enemies, x, y, FOCUS_WIDE_RADIUS)?.id;
}

// src/sim/input.ts
var CONTROL_MODES = ["ship", "screen"];
function toCommand(input) {
  const move = normalize(Number(input.right) - Number(input.left), Number(input.down) - Number(input.up));
  return { moveX: move.x, moveY: move.y, aimX: input.pointerX, aimY: input.pointerY, fire: input.fire };
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
var SQUADRON_KEY = "voidmarch.squadron";
function loadLastSquadron(store = browserStorage()) {
  try {
    return store?.getItem(SQUADRON_KEY) ?? void 0;
  } catch {
    return void 0;
  }
}
function saveLastSquadron(name, store = browserStorage()) {
  try {
    store?.setItem(SQUADRON_KEY, name);
  } catch {
  }
}

// src/simwasm.ts
var SCRATCH_SIZE = LAYOUT.maxTargets * 3;
var PATTERN_SIZE = 4;
var at = (list, i, fallback) => list[i] ?? fallback;
async function instantiate(bytes, go) {
  const { instance } = await WebAssembly.instantiate(bytes, go.importObject);
  void go.run(instance);
  return instance.exports;
}
var Sandbox = class {
  ship;
  /** Ship position before the last tick, for smooth drawing between ticks. */
  previous = { x: 0, y: 0 };
  projectiles;
  exports;
  mode = "ship";
  alphaValue = 0;
  shipState;
  constructor(exports) {
    this.exports = exports;
    this.shipState = {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      angle: 0,
      thrusting: false,
      loadout: { weapon: WEAPONS[0], engine: ENGINES[0], shield: SHIELDS[0] },
      damage: 0,
      cooldown: 0,
      charging: 0,
      nextMuzzle: 0,
      rotationSnap: 0
    };
    this.ship = this.shipState;
    this.projectiles = new Projectiles(this);
    this.read();
  }
  /** How far the display is between the last two ticks, from 0 to 1. */
  get alpha() {
    return this.alphaValue;
  }
  /** How WASD maps to movement; ship-relative unless the player switched. */
  get controlMode() {
    return this.mode;
  }
  set controlMode(mode) {
    this.mode = mode;
    this.exports.setControlMode(mode === "screen" ? 1 : 0);
  }
  /** Runs as many fixed ticks as frameSeconds covers, using the same input for each. */
  advance(frameSeconds, input) {
    const cmd = toCommand(input);
    this.exports.advance(frameSeconds, cmd.moveX, cmd.moveY, cmd.aimX, cmd.aimY, cmd.fire ? 1 : 0);
    return this.read();
  }
  /** Puts the ship at (x, y) at rest, as a spawn or a takeover does. */
  placeShip(x, y) {
    this.exports.placeShip(x, y);
    this.read();
  }
  setLoadout(loadout) {
    this.exports.setLoadout(
      WEAPONS.indexOf(loadout.weapon),
      ENGINES.indexOf(loadout.engine),
      SHIELDS.indexOf(loadout.shield)
    );
    this.read();
  }
  setDamage(damage) {
    this.exports.setDamage(damage);
    this.read();
  }
  setRotationSnap(steps) {
    this.exports.setRotationSnap(steps);
    this.read();
  }
  /** Where p was, or will be, at age. */
  positionAt(p, age) {
    this.exports.positionAt(p.slot, age);
    const scratch = this.scratch();
    return { x: scratch[0] ?? p.x, y: scratch[1] ?? p.y };
  }
  /** The first target a projectile touches on its way from (x0, y0) to (x1, y1), if any. */
  hitTargetAlong(x0, y0, x1, y1, targets) {
    const n = Math.min(targets.length, LAYOUT.maxTargets);
    const scratch = this.scratch();
    for (let i = 0; i < n; i++) {
      const t = targets[i];
      if (t !== void 0) {
        scratch.set([t.x, t.y, t.radius], i * 3);
      }
    }
    const hit = this.exports.hitAlong(x0, y0, x1, y1, n);
    return hit < 0 ? void 0 : targets[hit];
  }
  /** The bullets of an enemy's volley: pure and seeded, the same on every client. */
  enemyPattern(kind, x, y, angle, seed) {
    const n = this.exports.enemyPattern(ENEMY_KINDS.indexOf(kind), x, y, angle, seed >>> 0);
    const scratch = this.scratch();
    const out = [];
    for (let i = 0; i < n; i++) {
      const b = i * PATTERN_SIZE;
      out.push({
        kind: at(PROJECTILE_KINDS, scratch[b] ?? 0, PROJECTILE_KINDS[0]),
        x: scratch[b + 1] ?? x,
        y: scratch[b + 2] ?? y,
        angle: scratch[b + 3] ?? angle
      });
    }
    return out;
  }
  /** The module's calls, for the projectile pool. */
  get calls() {
    return this.exports;
  }
  memory() {
    const memory = this.exports.memory ?? this.exports.mem;
    if (memory === void 0) {
      throw new Error("the sim module exports no memory");
    }
    return memory.buffer;
  }
  /**
   * The state array, viewed afresh: a call may have grown the memory, which
   * detaches older views. The pointer comes first for the same reason.
   */
  state() {
    const pointer = this.exports.statePointer();
    return new Float64Array(this.memory(), pointer, LAYOUT.stateSize);
  }
  scratch() {
    const pointer = this.exports.scratchPointer();
    return new Float64Array(this.memory(), pointer, SCRATCH_SIZE);
  }
  /** Mirrors the state into the ship and projectiles, and returns the frame's events. */
  read() {
    const s = this.state();
    const get = (i) => s[i] ?? 0;
    const ship = this.shipState;
    ship.x = get(LAYOUT.shipX);
    ship.y = get(LAYOUT.shipY);
    ship.vx = get(LAYOUT.shipVX);
    ship.vy = get(LAYOUT.shipVY);
    ship.angle = get(LAYOUT.shipAngle);
    ship.thrusting = get(LAYOUT.shipThrusting) !== 0;
    ship.cooldown = get(LAYOUT.shipCooldown);
    ship.charging = get(LAYOUT.shipCharging);
    ship.nextMuzzle = get(LAYOUT.shipNextMuzzle);
    ship.damage = get(LAYOUT.shipDamage);
    ship.rotationSnap = get(LAYOUT.shipRotationSnap);
    ship.loadout.weapon = at(WEAPONS, get(LAYOUT.shipWeapon), WEAPONS[0]);
    ship.loadout.engine = at(ENGINES, get(LAYOUT.shipEngine), ENGINES[0]);
    ship.loadout.shield = at(SHIELDS, get(LAYOUT.shipShield), SHIELDS[0]);
    this.previous.x = get(LAYOUT.previousX);
    this.previous.y = get(LAYOUT.previousY);
    this.alphaValue = get(LAYOUT.alpha);
    this.projectiles.read(s);
    const events = { ticks: get(LAYOUT.ticks), charges: [], shots: [], expired: [] };
    for (let i = 0; i < get(LAYOUT.shots); i++) {
      const b = LAYOUT.shotsOffset + i * LAYOUT.shotSize;
      events.shots.push({
        id: get(b + LAYOUT.shotId),
        weapon: at(WEAPONS, get(b + LAYOUT.shotWeapon), WEAPONS[0]),
        muzzle: get(b + LAYOUT.shotMuzzle),
        x: get(b + LAYOUT.shotX),
        y: get(b + LAYOUT.shotY),
        angle: get(b + LAYOUT.shotAngle)
      });
    }
    for (let i = 0; i < get(LAYOUT.charges); i++) {
      events.charges.push(at(WEAPONS, get(LAYOUT.chargesOffset + i), WEAPONS[0]));
    }
    for (let i = 0; i < get(LAYOUT.expired); i++) {
      const b = LAYOUT.expiredOffset + i * LAYOUT.expiredSize;
      events.expired.push({
        kind: at(PROJECTILE_KINDS, get(b + LAYOUT.expiredKind), PROJECTILE_KINDS[0]),
        faction: at(FACTIONS, get(b + LAYOUT.expiredFaction), FACTIONS[0]),
        x: get(b + LAYOUT.expiredX),
        y: get(b + LAYOUT.expiredY)
      });
    }
    return events;
  }
};
var Projectiles = class {
  items;
  slots;
  owners;
  sandbox;
  constructor(sandbox2) {
    this.sandbox = sandbox2;
    this.slots = Array.from({ length: LAYOUT.projectileCapacity }, (_, slot) => ({
      slot,
      active: false,
      kind: PROJECTILE_KINDS[0],
      faction: FACTIONS[0],
      owner: "",
      shotId: 0,
      x: 0,
      y: 0,
      angle: 0,
      age: 0
    }));
    this.owners = this.slots.map(() => "");
    this.items = this.slots;
  }
  get activeCount() {
    return this.slots.reduce((n, p) => n + Number(p.active), 0);
  }
  /** Starts a projectile and returns it. */
  spawn(shot, options = {}) {
    const faction = options.faction ?? "own";
    const slot = this.sandbox.calls.spawn(
      PROJECTILE_KINDS.indexOf(shot.kind),
      FACTIONS.indexOf(faction),
      shot.x,
      shot.y,
      shot.angle,
      options.ageSeconds ?? 0,
      options.shotId ?? 0
    );
    this.owners[slot] = options.owner ?? "";
    this.read(this.sandbox.state());
    const p = this.slots[slot];
    if (p === void 0) {
      throw new Error(`the sim refused to spawn ${shot.kind}`);
    }
    return p;
  }
  /** Ends a projectile, as a hit does. */
  deactivate(p) {
    this.sandbox.calls.deactivate(p.slot);
    this.read(this.sandbox.state());
  }
  /** Ends every projectile of a faction: the server's are gone once offline. */
  clear(faction) {
    this.sandbox.calls.clear(FACTIONS.indexOf(faction));
    this.read(this.sandbox.state());
  }
  /** Ends a remote player's shot that hit something, and returns it. */
  end(owner, shotId) {
    const p = this.slots.find((q) => q.active && q.faction === "remote" && q.owner === owner && q.shotId === shotId);
    if (p !== void 0) {
      this.deactivate(p);
    }
    return p;
  }
  /** Mirrors the pool from the state array. */
  read(s) {
    for (const p of this.slots) {
      const b = LAYOUT.poolOffset + p.slot * LAYOUT.projectileSize;
      p.active = (s[b + LAYOUT.projectileActive] ?? 0) !== 0;
      p.kind = at(PROJECTILE_KINDS, s[b + LAYOUT.projectileKind] ?? 0, PROJECTILE_KINDS[0]);
      p.faction = at(FACTIONS, s[b + LAYOUT.projectileFaction] ?? 0, FACTIONS[0]);
      p.owner = p.faction === "own" ? "" : this.owners[p.slot] ?? "";
      p.x = s[b + LAYOUT.projectileX] ?? 0;
      p.y = s[b + LAYOUT.projectileY] ?? 0;
      p.angle = s[b + LAYOUT.projectileAngle] ?? 0;
      p.age = s[b + LAYOUT.projectileAge] ?? 0;
      p.shotId = s[b + LAYOUT.projectileShotId] ?? 0;
    }
  }
};
function isWeapon(kind) {
  return WEAPONS.includes(kind);
}
var loaded;
async function loadSim(url) {
  if (loaded === void 0) {
    const Go = globalThis.Go;
    if (Go === void 0) {
      throw new Error("wasm_exec.js did not load: no Go runtime");
    }
    const response = await fetch(url);
    loaded = new Sandbox(await instantiate(await response.arrayBuffer(), new Go()));
  }
  return loaded;
}
function sandbox() {
  if (loaded === void 0) {
    throw new Error("the sim is not loaded yet");
  }
  return loaded;
}

// src/sim/world.ts
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

// src/sim/zoom.ts
var MIN_ZOOM = 2;
function integerZoom(viewportWidth, viewportHeight, targetWidth, targetHeight) {
  const fit = Math.floor(Math.min(viewportWidth / targetWidth, viewportHeight / targetHeight));
  return Math.max(MIN_ZOOM, fit);
}

// src/squadrons.ts
var SQUADRON_CAP = 4;
function modeName(info) {
  const mode = fromCompanionMode(info.mode) ?? "escort";
  return ORDER_ITEMS.find((i) => i.kind === "mode" && i.mode === mode)?.label ?? "Escort";
}
function squadronChoices(list) {
  const choices = [];
  const full = [];
  for (const info of list.squadrons) {
    const players = info.members.map((m) => m.name);
    const companions = info.members.reduce((n, m) => n + m.companions, 0);
    if (players.length >= SQUADRON_CAP) {
      full.push(info.name);
      continue;
    }
    const ships = Math.min(SQUADRON_CAP, players.length + companions);
    const shown = ships - players.length;
    const free = SQUADRON_CAP - ships;
    choices.push({
      name: info.name,
      players,
      companions,
      seats: "\u25A0".repeat(players.length) + "\u25A3".repeat(shown) + "\u25A1".repeat(free),
      note: free === 0 ? "you take over one of the companions" : `${String(free)} seat${free === 1 ? "" : "s"} free`,
      mode: modeName(info)
    });
  }
  return { choices, full };
}
function hangarLine(hangar, atHome) {
  if (!atHome || hangar === void 0) {
    return void 0;
  }
  return hangar === 0 ? "hangar: empty" : `hangar: ${String(hangar)} ship${hangar === 1 ? "" : "s"}`;
}
function pickFirst(choices, last) {
  return choices.find((c) => c.name === last)?.name ?? choices[0]?.name;
}
var SquadronScreen = class {
  form;
  list;
  full;
  next;
  error;
  picked;
  choose = () => void 0;
  constructor(doc = document) {
    this.form = doc.querySelector("#squadron-form");
    this.list = doc.querySelector("#squadron-list");
    this.full = doc.querySelector("#squadron-full");
    this.next = doc.querySelector("#squadron-next");
    this.error = doc.querySelector("#squadron-error");
    this.form?.addEventListener("submit", (event) => {
      event.preventDefault();
      this.choose(this.picked ?? "");
    });
    doc.querySelector("#squadron-start")?.addEventListener("click", () => {
      this.choose("");
    });
  }
  get open() {
    return this.form !== null && !this.form.hidden;
  }
  show(squadrons, last, choose) {
    this.choose = choose;
    this.picked = pickFirst(squadronChoices(squadrons).choices, last);
    if (this.form !== null) {
      this.form.hidden = false;
    }
    this.update(squadrons);
  }
  /** Redraws the list, keeping the pick while its squadron is still there. */
  update(squadrons) {
    const { choices, full } = squadronChoices(squadrons);
    if (!choices.some((c) => c.name === this.picked)) {
      this.picked = choices[0]?.name;
    }
    if (this.next !== null) {
      this.next.textContent = squadrons.nextName;
    }
    if (this.full !== null) {
      this.full.textContent = full.length === 0 ? "" : `Full: ${full.join(", ")}.`;
    }
    this.list?.replaceChildren(...choices.map((c) => this.row(c)));
    if (this.open) {
      this.list?.querySelector(".picked button")?.focus();
    }
  }
  showError(reason) {
    if (this.error !== null) {
      this.error.textContent = reason;
    }
  }
  hide() {
    if (this.form !== null) {
      this.form.hidden = true;
    }
    if (this.error !== null) {
      this.error.textContent = "";
    }
  }
  row(c) {
    const doc = this.list?.ownerDocument ?? document;
    const row = doc.createElement("div");
    row.className = c.name === this.picked ? "squadron picked" : "squadron";
    const name = doc.createElement("span");
    name.className = "name";
    name.textContent = c.name;
    const who = doc.createElement("span");
    who.className = "who";
    who.textContent = c.players.join(", ");
    if (c.companions > 0) {
      const ai = doc.createElement("span");
      ai.className = "ai";
      ai.textContent = ` + ${String(c.companions)} companion${c.companions === 1 ? "" : "s"}`;
      who.append(ai);
    }
    const join = doc.createElement("button");
    join.type = "button";
    join.textContent = "Join";
    join.addEventListener("click", () => {
      this.choose(c.name);
    });
    const seats = doc.createElement("span");
    seats.className = "seats-pips";
    seats.textContent = c.seats;
    const note = doc.createElement("span");
    note.className = "note";
    note.textContent = `${c.note} \xB7 orders: ${c.mode}`;
    row.append(name, who, join, seats, note);
    return row;
  }
};

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
  /** Sends the ship's state at most at the server's tick rate; the hub flies the companions. */
  sendState(ship, nowMs) {
    if (!this.welcomed || nowMs - this.lastStateAt < this.stateIntervalMs) {
      return;
    }
    this.lastStateAt = nowMs;
    this.send(create2(ClientMessageSchema, { kind: { case: "state", value: toShipState(ship) } }));
  }
  /** Joins the named squadron, or starts a new one when name is empty. */
  sendChooseSquadron(name) {
    if (this.welcomed) {
      this.send(create2(ClientMessageSchema, { kind: { case: "chooseSquadron", value: { name } } }));
    }
  }
  /** Gives the squadron an order, which the server passes to the squadmates. */
  sendSquadronOrder(order) {
    if (this.welcomed) {
      this.send(create2(ClientMessageSchema, { kind: { case: "squadronOrder", value: order } }));
    }
  }
  /** Asks the server for a companion. */
  sendSummon() {
    if (this.welcomed) {
      this.send(create2(ClientMessageSchema, { kind: { case: "summon", value: {} } }));
    }
  }
  /** Gives a companion's seat back. */
  sendDismiss(companion) {
    if (this.welcomed) {
      this.send(create2(ClientMessageSchema, { kind: { case: "dismiss", value: { companion } } }));
    }
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
          value: {
            id: shot.id,
            weapon: toWeapon(shot.weapon),
            muzzle: shot.muzzle,
            x: shot.x,
            y: shot.y,
            angle: shot.angle
          }
        }
      })
    );
  }
  /** Reports that one of our shots hit an enemy; the server trusts it. */
  sendHit(enemyId, shotId, damage) {
    if (this.welcomed) {
      this.send(create2(ClientMessageSchema, { kind: { case: "hit", value: { enemyId, shotId, damage } } }));
    }
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
      case "companionGranted":
        events.companionGranted(message.kind.value);
        break;
      case "companionRefused":
        events.companionRefused(message.kind.value.reason);
        break;
      case "companionDismissed":
        events.companionDismissed(message.kind.value.companion, message.kind.value.takenBy);
        break;
      case "squadrons":
        events.squadrons(message.kind.value);
        break;
      case "squadronJoined":
        events.squadronJoined(message.kind.value);
        break;
      case "squadronRefused":
        events.squadronRefused(message.kind.value.reason);
        break;
      case "squadronOrdered":
        events.squadronOrdered(message.kind.value);
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
  tint;
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
  /** Tints every part, for a companion in its owner's colour (0xRRGGBB). */
  setTint(colour) {
    this.tint = colour;
    for (const part of [this.engine, this.flame, this.hull, this.weapon, this.shield]) {
      part.setTint(colour).setTintMode(Phaser3.TintModes.MULTIPLY);
    }
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
      this.hull.setTintMode(Phaser3.TintModes.MULTIPLY);
      if (this.tint === void 0) {
        this.hull.clearTint();
      } else {
        this.hull.setTint(this.tint);
      }
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
var NOTICE_MS = 4e3;
var now = () => performance.now();
var playerLabel = (name, squadron) => squadron === "" ? name : `${name} \xB7 ${squadron}`;
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
  lastEnemyDestroyed;
  hitsTaken = 0;
  /** Enemies this player's companions shot down. */
  companionKills = 0;
  /** The enemy the player last hit, and when (performance.now() ms): what they're shooting at. */
  lastHit;
  /** How many companions the server allows each player. */
  companionLimit = 0;
  /** The squadrons as the server last listed them, and the player's own, "" before choosing. */
  squadrons;
  squadron = "";
  notice;
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
          const owner = remote.playerId.split("/")[0] ?? "";
          if (shot === void 0 || !this.remotes.has(remote.playerId) && !this.remotes.has(owner)) {
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
        },
        companionGranted: () => {
        },
        companionRefused: (reason) => {
          this.say(reason);
        },
        squadrons: (list) => {
          this.squadrons = list;
          if (options.squadronScreen.open) {
            options.squadronScreen.update(list);
          }
        },
        squadronJoined: (joined) => {
          this.squadronJoined(joined);
        },
        squadronRefused: (reason) => {
          options.squadronScreen.showError(reason);
        },
        squadronOrdered: (ordered) => {
          this.squadronOrdered(ordered);
        },
        companionDismissed: (number, takenBy) => {
          this.say(takenBy === "" ? `companion ${String(number)} went home` : `${takenBy} took over companion ${String(number)}`);
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
  /** Other players and their companions, for the HUD and the E2E tests. */
  get others() {
    return [...this.remotes.entries()].map(([id, r]) => ({
      id,
      name: r.name,
      colour: r.colour,
      x: r.view.root.x,
      y: r.view.root.y,
      ownerId: r.ownerId
    }));
  }
  /** The latest notice for the HUD, while it lasts. */
  get noticeText() {
    return this.notice !== void 0 && now() < this.notice.untilMs ? this.notice.text : void 0;
  }
  /** Companion ships waiting in the shared hangar, once the server has listed them. */
  get hangar() {
    return this.squadrons?.hangar;
  }
  /** How many companions the player has out, as the server last listed them. */
  get companionCount() {
    return this.squadronInfo?.members.find((m) => m.playerId === this.playerId)?.companions ?? 0;
  }
  /** The player's squadron as the server last listed it. */
  get squadronInfo() {
    return this.squadrons?.squadrons.find((s) => s.name === this.squadron);
  }
  /** Sends the player's order to the squadron, whose other players see it as a callout. */
  orderSquadron(item, context) {
    this.connection.sendSquadronOrder({
      mode: item.kind === "mode" ? toCompanionMode(item.mode) : CompanionMode.UNSPECIFIED,
      oneShot: item.kind === "oneShot" ? toCompanionOneShot(item.oneShot) : CompanionOneShot.UNSPECIFIED,
      x: context.pointX,
      y: context.pointY,
      focusEnemyId: context.focusEnemyId ?? 0
    });
  }
  /** Asks the server for a companion, or says why there can't be one. */
  summon() {
    const { ship } = this.options.sim;
    if (this.status !== "online") {
      this.say("companions need the server");
    } else if (this.companionCount >= this.companionLimit) {
      this.say("all your companions are already out");
    } else if (Math.hypot(ship.x, ship.y) > SAFE_ZONE_RADIUS) {
      this.say("summon companions at the home planet");
    } else if (this.hangar === 0) {
      this.say("the hangar is empty");
    } else {
      this.connection.sendSummon();
    }
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
    const seconds = nowMs / 1e3;
    this.connection.sendState(this.options.sim.ship, nowMs);
    for (const shot of events.shots) {
      this.connection.sendShot(shot);
    }
    const serverTick = this.clock.tickAt(nowMs);
    if (serverTick === void 0) {
      return frame;
    }
    const renderTick = serverTick - INTERPOLATION_DELAY_TICKS;
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
  /**
   * Everyone flies in a squadron: with squadrons to choose from the player
   * picks on the join screen, and with none they start their own.
   */
  pickSquadron(list) {
    if (list === void 0 || squadronChoices(list).choices.length === 0) {
      this.connection.sendChooseSquadron("");
      return;
    }
    this.options.squadronScreen.show(list, loadLastSquadron(), (name) => {
      this.connection.sendChooseSquadron(name);
    });
  }
  /** In a squadron now; a takeover puts the ship where the companion was. */
  squadronJoined(joined) {
    this.options.squadronScreen.hide();
    this.squadron = joined.name;
    saveLastSquadron(joined.name);
    if (joined.tookOver) {
      this.options.sim.placeShip(joined.x, joined.y);
    }
  }
  /** A squadmate's order, as a callout: the hub gives it to every companion. */
  squadronOrdered(ordered) {
    const order = ordered.order;
    if (order === void 0) {
      return;
    }
    const mode = fromCompanionMode(order.mode);
    const oneShot = fromCompanionOneShot(order.oneShot);
    const item = ORDER_ITEMS.find(
      (i) => i.kind === "mode" && i.mode === mode || i.kind === "oneShot" && i.oneShot === oneShot
    );
    if (item !== void 0) {
      this.say(`${ordered.name}: ${item.label}`);
    }
  }
  /** Shows a notice in the HUD for a few seconds. */
  say(text) {
    this.notice = { text, untilMs: now() + NOTICE_MS };
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
      if (enemy.destroyedAt === void 0 && enemy.lastSeen < this.latestSnapshot && enemy.lastSeen < renderTick) {
        enemy.view.destroy(false);
        this.enemies.delete(id);
      }
    }
  }
  /** The player's companions as drawn: the hub flies them, so they come in snapshots. */
  ownCompanions() {
    return [...this.remotes.values()].filter((r) => r.ownerId !== "" && r.ownerId === this.playerId);
  }
  /**
   * The player's shots against enemies as drawn, reported to the server (the
   * design's trust model); enemy bullets against the local ship and the
   * player's companions, which only flash them until health exists (#5). The
   * hub tests the companions' own shots. Each projectile is tested along the
   * path it flew during the frame's stepSeconds, so low frame rates don't skip
   * hits.
   */
  testHits(frame, stepSeconds) {
    const targets = [...this.enemies.entries()].map(([id, e]) => ({
      id,
      x: e.view.x,
      y: e.view.y,
      radius: ENEMY_RADIUS[e.view.kind]
    }));
    const { ship } = this.options.sim;
    const companions = this.ownCompanions();
    const wing = [
      { id: -1, x: ship.x, y: ship.y, radius: SHIP_RADIUS },
      ...companions.map((c, i) => ({ id: i, x: c.view.root.x, y: c.view.root.y, radius: SHIP_RADIUS }))
    ];
    for (const p of this.options.sim.projectiles.items) {
      if (!p.active || p.faction === "remote") {
        continue;
      }
      const from = this.options.sim.positionAt(p, Math.max(0, p.age - stepSeconds));
      if (p.faction === "own" && isWeapon(p.kind)) {
        const target = this.options.sim.hitTargetAlong(from.x, from.y, p.x, p.y, targets);
        if (target !== void 0) {
          this.options.sim.projectiles.deactivate(p);
          this.lastHit = { id: target.id, atMs: now() };
          this.connection.sendHit(target.id, p.shotId, WEAPON_STATS[p.kind].damage);
          this.enemies.get(target.id)?.view.flash();
          frame.enemyHits.push({ x: p.x, y: p.y });
        }
      } else if (p.faction === "enemy") {
        const hit = this.options.sim.hitTargetAlong(from.x, from.y, p.x, p.y, wing);
        if (hit === void 0) {
          continue;
        }
        this.options.sim.projectiles.deactivate(p);
        if (hit.id === -1) {
          this.hitsTaken++;
          frame.hitsOnMe.push({ x: p.x, y: p.y });
        } else {
          companions[hit.id]?.view.flash(this.options.scene);
          frame.enemyHits.push({ x: p.x, y: p.y });
        }
      }
    }
  }
  /** Whether a point is within range of the player or one of their companions. */
  nearWing(x, y, range) {
    const { ship } = this.options.sim;
    const ships = [{ x: ship.x, y: ship.y }, ...this.ownCompanions().map((c) => ({ x: c.view.root.x, y: c.view.root.y }))];
    return ships.some((s) => Math.hypot(s.x - x, s.y - y) <= range);
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
    if (!this.nearWing(origin.x, origin.y, ENEMY_VOLLEY_RANGE)) {
      return;
    }
    for (const bullet of this.options.sim.enemyPattern(volley.kind, origin.x, origin.y, volley.angle, volley.seed)) {
      this.options.sim.projectiles.spawn(bullet, { ageSeconds, faction: "enemy", owner: String(volley.enemyId) });
    }
    const ship = this.options.sim.ship;
    if (Math.hypot(origin.x - ship.x, origin.y - ship.y) <= ENEMY_VOLLEY_RANGE) {
      this.options.audio.enemyShot();
    }
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
      this.lastEnemyDestroyed = destroyed.enemyId;
    } else if (this.playerId !== void 0 && destroyed.byPlayerId.startsWith(`${this.playerId}/`)) {
      this.companionKills++;
    }
  }
  welcome(welcome) {
    this.status = "online";
    this.playerId = welcome.playerId;
    this.companionLimit = welcome.companionLimit;
    this.squadrons = welcome.squadrons;
    this.squadron = welcome.squadron;
    if (welcome.squadron === "") {
      this.pickSquadron(welcome.squadrons);
    }
    this.clock = new ServerClock(welcome.tickRate);
    this.tickRate = welcome.tickRate;
    this.resetTimeline(welcome.tickRate);
    this.clock.observe(welcome.tick, now());
    if (!this.spawned) {
      this.spawned = true;
      this.options.sim.placeShip(welcome.spawnX, welcome.spawnY);
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
      const remote = this.remotes.get(player.playerId) ?? this.add(player.playerId, player.name, player.colour, player.ownerId, player.squadron);
      if (player.ownerId === "" && remote.squadron !== player.squadron) {
        remote.squadron = player.squadron;
        remote.view.setLabel(
          this.options.scene,
          this.options.ships,
          playerLabel(player.name, player.squadron),
          player.colour,
          this.options.labelResolution()
        );
      }
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
  /** A remote ship: another player, or (with an owner) one of their companions. */
  add(id, name, colour, ownerId, squadron) {
    const { scene, ships } = this.options;
    const view = new ShipView(scene, ships, 0, 0);
    const label = ownerId === "" ? playerLabel(name, squadron) : `${name} ${id.slice(ownerId.length + 1)}`;
    if (ownerId !== "") {
      view.setTint(colour);
    }
    view.setLabel(scene, ships, label, colour, this.options.labelResolution());
    const remote = {
      view,
      buffer: new StateBuffer(),
      animator: new WeaponAnimator(weaponTiming("autoCannon")),
      weapon: "autoCannon",
      name,
      colour,
      ownerId,
      squadron
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
var BLOOM_BLUR = 3;
var EFFECT_ZOOM = 2;
var HUD_REFRESH_MS = 250;
var HIT_SPARKS = 5;
var HUD_FONT_PX = 12;
var HUD_MARGIN_PX = 8;
var ORDER_HOLD_MS = 200;
var ORDER_RING_PX = 88;
var ORDER_DEAD_ZONE_PX = 24;
var ORDER_COLOURS = { mode: 9427199, oneShot: 16769162 };
var ORDER_PICKED_TEXT = "#ffffff";
var ORDER_BACKDROP = 328458;
var ORDER_BACKDROP_ALPHA = 0.72;
var ORDER_BACKDROP_PAD = 40;
var ORDER_ICON_RISE = 10;
var ORDER_LABEL_DROP = 12;
var ORDER_ICONS = {
  Escort: { key: keys.hull("fullHealth"), scale: 1 },
  Attack: { key: keys.weapon("rockets"), scale: 1.1 },
  Guard: { key: keys.shield("front"), scale: 0.9 },
  "Hold here": { key: keys.engine("base"), scale: 1.2 },
  Stealth: { key: keys.weapon("autoCannon"), dim: true, scale: 1.1 },
  Focus: { key: keys.projectile("bigSpaceGun"), frame: 3, scale: 1.3 },
  Regroup: { key: keys.flamePowering("base"), frame: 2, scale: 1.4 },
  "Go home": { key: keys.planet, scale: 0.35 }
};
var hex = (colour) => `#${colour.toString(16).padStart(6, "0")}`;
function destroyRing(press) {
  for (const object of [...press.labels ?? [], ...press.extras]) {
    object.destroy();
  }
  press.backdrop?.destroy();
}
var SandboxScene = class extends Phaser5.Scene {
  sim = sandbox();
  world;
  backgrounds = [];
  backgroundFrame = 0;
  ships;
  ship;
  net;
  projectileSprites = [];
  /** Enemy bullets fly on their own layer, which glows as a whole: one filter, not one per bullet. */
  enemyFire;
  enemyFireGlow;
  muzzleFlash;
  puff;
  bloom;
  bloomBlur;
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
  orderPress;
  lastOrder;
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
      lastEnemyDestroyed: void 0,
      enemyFireGlow: false,
      hitsTaken: 0,
      companions: [],
      companionKills: 0,
      notice: void 0,
      orderMenuOpen: false,
      squadron: "",
      squadronScreen: false,
      hangar: void 0,
      squadronMode: void 0
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
    this.updateOrderMenu(time);
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
      },
      squadronScreen: new SquadronScreen()
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
    this.enemyFire = this.add.layer();
    this.world.add(this.enemyFire);
    this.enemyFire.enableFilters();
    this.enemyFireGlow = this.enemyFire.filters?.internal.addGlow(
      ENEMY_FIRE_GLOW_COLOUR,
      ENEMY_FIRE_GLOW_STRENGTH,
      0,
      1,
      false,
      ENEMY_FIRE_GLOW_QUALITY,
      ENEMY_FIRE_GLOW_DISTANCE
    );
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
    const bloom = Phaser5.Actions.AddEffectBloom(main, { threshold: 0.55, blurRadius: BLOOM_BLUR, blendAmount: 0.6 })[0];
    this.bloom = bloom?.parallelFilters;
    this.bloomBlur = bloom?.blur;
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
      if (event.repeat) {
        return;
      }
      if (event.code === "KeyQ") {
        this.pressOrders();
      } else {
        this.handleDebugKey(event.code);
      }
    };
    const onKeyUp = (event) => {
      if (event.code === "KeyQ") {
        this.releaseOrders();
      }
    };
    const onBlur = () => {
      this.closeOrderRing();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    this.events.once(Phaser5.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    });
  }
  handleDebugKey(code) {
    const ship = this.sim.ship;
    switch (code) {
      case "Digit1":
        this.sim.setLoadout({ ...ship.loadout, weapon: nextInCycle(WEAPONS, ship.loadout.weapon) });
        this.applyLoadout();
        this.audio.partSwitched();
        break;
      case "Digit2":
        this.sim.setLoadout({ ...ship.loadout, engine: nextInCycle(ENGINES, ship.loadout.engine) });
        this.applyLoadout();
        this.audio.partSwitched();
        break;
      case "Digit3":
        this.sim.setLoadout({ ...ship.loadout, shield: nextInCycle(SHIELDS, ship.loadout.shield) });
        this.applyLoadout();
        this.audio.shieldSwitched();
        break;
      case "KeyG":
        this.net?.summon();
        this.updateHud();
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
        this.sim.setDamage(DAMAGE_STATES.indexOf(this.damage));
        this.ship.setDamage(ship.damage);
        break;
      case "KeyC":
        this.sim.controlMode = nextInCycle(CONTROL_MODES, this.sim.controlMode);
        saveControlMode(this.sim.controlMode);
        this.updateHud();
        break;
      case "KeyR":
        this.sim.setRotationSnap(ship.rotationSnap === 0 ? ROTATION_SNAP_STEPS : 0);
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
        if (this.enemyFireGlow !== void 0) {
          this.enemyFireGlow.active = this.effects;
        }
        this.updateHud();
        break;
      default:
    }
  }
  /** Q down: remember where the pointer is. */
  pressOrders() {
    this.closeOrderRing();
    const pointer = this.input.activePointer;
    const world = pointer.positionToCamera(this.cameras.main);
    this.orderPress = {
      downAt: this.time.now,
      screenX: pointer.x,
      screenY: pointer.y,
      worldX: world.x,
      worldY: world.y,
      labels: void 0,
      backdrop: void 0,
      extras: []
    };
  }
  /** While Q is held: open the ring once held long enough, and light the item pointed at. */
  updateOrderMenu(time) {
    const press = this.orderPress;
    if (press === void 0 || time - press.downAt < ORDER_HOLD_MS) {
      return;
    }
    press.labels ??= this.openOrderRing(press);
    const picked = this.pickedOrder(press);
    this.drawRingBackdrop(press, picked);
    press.labels.forEach((label, i) => {
      const item = ORDER_ITEMS[i];
      label.setColor(i === picked || item === void 0 ? ORDER_PICKED_TEXT : hex(ORDER_COLOURS[item.kind]));
      label.setScale(i === picked ? 1.15 : 1);
    });
  }
  /** Lays out the ring: a label and its pack icon per order, and the wing's mode in the centre. */
  openOrderRing(press) {
    const dpr = this.dpr();
    const style = { fontFamily: "monospace", fontSize: `${String(HUD_FONT_PX * dpr)}px` };
    const info = this.net?.squadronInfo;
    const mode = info === void 0 ? void 0 : fromCompanionMode(info.mode) ?? "escort";
    press.backdrop = this.add.graphics();
    this.cameras.main.ignore(press.backdrop);
    const labels = ORDER_ITEMS.map((item, i) => {
      const at2 = itemPosition(i, ORDER_RING_PX * dpr);
      const x = press.screenX + at2.x;
      const y = press.screenY + at2.y + ORDER_LABEL_DROP * dpr;
      const inForce = item.kind === "mode" && item.mode === mode;
      const label = this.add.text(x, y, `${inForce ? "\u2022 " : ""}${item.label}`, { ...style, color: hex(ORDER_COLOURS[item.kind]) }).setOrigin(0.5).setShadow(1, 1, "#000000", 0);
      this.cameras.main.ignore(label);
      const icon = ORDER_ICONS[item.label];
      if (icon !== void 0) {
        const image = this.add.image(x, press.screenY + at2.y - ORDER_ICON_RISE * dpr, icon.key, icon.frame ?? 0).setScale(icon.scale * dpr);
        if (icon.dim === true) {
          image.setTint(10132122);
        }
        this.cameras.main.ignore(image);
        press.extras.push(image);
      }
      return label;
    });
    const count = this.net?.companionCount ?? 0;
    const centre = this.add.text(
      press.screenX,
      press.screenY,
      count === 0 || info === void 0 ? "no companions" : `wing (${String(count)})
${modeName(info)}`,
      { ...style, color: "#ffffff", align: "center" }
    ).setOrigin(0.5).setShadow(1, 1, "#000000", 0);
    this.cameras.main.ignore(centre);
    press.extras.push(centre);
    return labels;
  }
  /** The ring's backdrop, with the wedge of the item pointed at lit in its colour. */
  drawRingBackdrop(press, picked) {
    const g = press.backdrop;
    if (g === void 0) {
      return;
    }
    const dpr = this.dpr();
    const rx = (ORDER_RING_PX * RING_ASPECT + ORDER_BACKDROP_PAD) * dpr;
    const ry = (ORDER_RING_PX + ORDER_BACKDROP_PAD) * dpr;
    const { screenX: cx, screenY: cy } = press;
    g.clear();
    g.fillStyle(ORDER_BACKDROP, ORDER_BACKDROP_ALPHA).fillEllipse(cx, cy, rx * 2, ry * 2);
    g.lineStyle(dpr, ORDER_COLOURS.mode, 0.35).strokeEllipse(cx, cy, rx * 2, ry * 2);
    const item = picked === void 0 ? void 0 : ORDER_ITEMS[picked];
    if (picked === void 0 || item === void 0) {
      return;
    }
    const n = ORDER_ITEMS.length;
    const mid = -Math.PI / 2 + picked * Math.PI * 2 / n;
    const points = [new Phaser5.Math.Vector2(cx, cy)];
    const steps = 8;
    for (let k = 0; k <= steps; k++) {
      const a = mid - Math.PI / n + k * 2 * Math.PI / n / steps;
      points.push(new Phaser5.Math.Vector2(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry));
    }
    g.fillStyle(ORDER_COLOURS[item.kind], 0.22).fillPoints(points, true);
  }
  pickedOrder(press) {
    const pointer = this.input.activePointer;
    return pickItem(pointer.x - press.screenX, pointer.y - press.screenY, ORDER_DEAD_ZONE_PX * this.dpr());
  }
  /** Drops a Q press and its ring without giving an order. */
  closeOrderRing() {
    if (this.orderPress !== void 0) {
      destroyRing(this.orderPress);
    }
    this.orderPress = void 0;
  }
  /** Q up: give the item pointed at, or repeat the last order after a tap. */
  releaseOrders() {
    const press = this.orderPress;
    this.orderPress = void 0;
    if (press === void 0) {
      return;
    }
    if (press.labels === void 0) {
      const world = this.input.activePointer.positionToCamera(this.cameras.main);
      if (this.lastOrder === void 0) {
        this.net?.say("no order to repeat yet: hold Q");
      } else {
        this.giveOrder(this.lastOrder, { ...press, worldX: world.x, worldY: world.y });
      }
      return;
    }
    const picked = this.pickedOrder(press);
    destroyRing(press);
    const item = picked === void 0 ? void 0 : ORDER_ITEMS[picked];
    if (item !== void 0) {
      this.giveOrder(item, press);
    }
  }
  /**
   * Gives an order to the squadron: the hub gives it to every companion in
   * it, and squadmates see it as a callout.
   */
  giveOrder(item, press) {
    const net = this.net;
    if (net === void 0) {
      return;
    }
    const squadmates = (net.squadronInfo?.members.length ?? 1) - 1;
    if (net.companionCount === 0 && squadmates === 0) {
      net.say("no companions: press G at the home planet");
      return;
    }
    const focusEnemyId = chooseFocus(net.enemyList, press.worldX, press.worldY, net.lastHit, performance.now());
    if (item.kind === "oneShot" && item.oneShot === "focus" && focusEnemyId === void 0) {
      net.say("no enemy to focus: hit one, or point at it");
      return;
    }
    this.lastOrder = item;
    net.orderSquadron(item, { pointX: press.worldX, pointY: press.worldY, focusEnemyId });
    net.say(item.label);
    this.updateHud();
  }
  dpr() {
    return window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
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
    const effectScale = zoom / EFFECT_ZOOM;
    if (this.bloomBlur !== void 0) {
      this.bloomBlur.x = BLOOM_BLUR * effectScale;
      this.bloomBlur.y = BLOOM_BLUR * effectScale;
    }
    if (this.enemyFireGlow !== void 0) {
      this.enemyFireGlow.scale = effectScale;
    }
    this.hudCamera.setSize(width, height);
    const dpr = this.dpr();
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
    const own = events.shots;
    if (events.charges.length > 0) {
      this.weaponFrames.charge(now2, stats.charge);
    }
    if (stats.alternate) {
      for (const shot of own) {
        this.weaponFrames.release(now2, shot.muzzle, stats.muzzles.length);
      }
    } else if (own.length > 0) {
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
      const layer = p.faction === "enemy" ? this.enemyFire : this.world;
      if (sprite.displayList !== layer) {
        sprite.displayList.remove(sprite);
        layer.add(sprite);
      }
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
      "WASD move \xB7 mouse aim \xB7 hold left button to fire \xB7 G companion \xB7 hold Q orders, tap to repeat \xB7 C controls \xB7 M sound \xB7 N music \xB7 1/2/3 parts \xB7 H hull \xB7 R rotation \xB7 F effects",
      this.netStatus(),
      this.squadronStatus()
    ]);
  }
  /** The squadron, its players and companions and orders, then the latest notice on its own line. */
  squadronStatus() {
    const net = this.net;
    if (net === void 0) {
      return "";
    }
    const info = net.squadronInfo;
    const lines = [];
    if (info === void 0) {
      lines.push(net.squadron === "" ? "no squadron yet" : net.squadron);
    } else {
      const companions = info.members.reduce((n, m) => n + m.companions, 0);
      const ai = companions === 0 ? "" : ` \xB7 ${String(companions)} companion${companions === 1 ? "" : "s"}`;
      lines.push(`${info.name}: ${info.members.map((m) => m.name).join(", ")}${ai} \xB7 ${modeName(info)}`);
    }
    const { ship } = this.sim;
    const hangar = hangarLine(net.hangar, Math.hypot(ship.x, ship.y) <= SAFE_ZONE_RADIUS);
    if (hangar !== void 0) {
      lines.push(hangar);
    }
    const notice = net.noticeText;
    if (notice !== void 0) {
      lines.push(`\u2192 ${notice}`);
    }
    return lines.join("\n");
  }
  netStatus() {
    const net = this.net;
    if (net === void 0) {
      return "playing alone";
    }
    switch (net.status) {
      case "online": {
        const count = net.others.filter((o) => o.ownerId === "").length;
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
    this.debug.enemyFireGlow = this.enemyFireGlow?.active ?? false;
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
    this.debug.lastEnemyDestroyed = this.net?.lastEnemyDestroyed;
    this.debug.hitsTaken = this.net?.hitsTaken ?? 0;
    this.debug.companions = (this.net?.others ?? []).filter((o) => o.ownerId !== "" && o.ownerId === this.net?.playerId).map((o) => ({ number: Number(o.id.slice(o.ownerId.length + 1)), x: o.x, y: o.y }));
    this.debug.squadronMode = this.net?.squadronInfo === void 0 ? void 0 : modeName(this.net.squadronInfo);
    this.debug.companionKills = this.net?.companionKills ?? 0;
    this.debug.notice = this.net?.noticeText;
    this.debug.orderMenuOpen = this.orderPress?.labels !== void 0;
    this.debug.squadron = this.net?.squadron ?? "";
    this.debug.hangar = this.net?.hangar;
    this.debug.squadronScreen = !(document.querySelector("#squadron-form")?.hidden ?? true);
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
  await loadSim("/static/wasm/sim.wasm");
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
