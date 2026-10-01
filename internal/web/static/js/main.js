// src/main.ts
import Phaser9 from "./vendor/phaser.js";

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
var ENEMY_KINDS = ["scout", "fighter", "frigate"];
var PROJECTILE_KINDS = ["autoCannon", "rockets", "bigSpaceGun", "zapper", "klaedBullet", "klaedBigBullet", "shard"];
var FACTIONS = ["own", "remote", "enemy"];
var DEFAULT_LOADOUT = { weapon: "autoCannon", engine: "base", shield: "front", weaponTier: 0, engineTier: 0, shieldTier: 0 };
var TICK_RATE = 60;
var TICK_SECONDS = 1 / TICK_RATE;
var WORLD_HALF_SIZE = 5600;
var SECTOR_SIZE = 1600;
var GRID_SIZE = 7;
var WORLD_EDGE_BAND = 200;
var SAFE_ZONE_RADIUS = 300;
var SHIP_RADIUS = 12;
var MAX_DAMAGE = 3;
var RESPAWN_DELAY = 3;
var HOME_SPAWN_Y = 160;
var BRAIN_SPACING = 40;
var RAM_DAMAGE = 2;
var SHARD_DAMAGE = 2;
var TIER_NAMES = ["", "Super", "Mega", "Hyper"];
var MAX_TIER = 3;
var PICKUP_REACH = 24;
var SHIELD_STATS = {
  front: { coverage: 1.5707963267948966, strength: 3, recharge: 5 },
  frontAndSide: { coverage: 3.141592653589793, strength: 2, recharge: 5 },
  round: { coverage: 6.283185307179586, strength: 1, recharge: 3 },
  invincibility: { coverage: 6.283185307179586, strength: 3, recharge: 12 }
};
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
    interval: 0.4,
    charge: 0,
    damage: 3,
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
    lifetime: 0.5,
    muzzles: [{ forward: 16, right: 0 }],
    alternate: false,
    shake: 2e-3
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
  fighter: 12,
  frigate: 19
};
var FRIGATE_REACH = 800;
var FRIGATE_SHIELD = 20;
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
  shipShieldCharge: 21,
  shipSinceHit: 22,
  shipDownFor: 23,
  shipRevive: 24,
  shipWeaponTier: 25,
  shipEngineTier: 26,
  shipShieldTier: 27,
  previousX: 16,
  previousY: 17,
  shots: 18,
  charges: 19,
  expired: 20,
  projectileCapacity: 256,
  poolOffset: 28,
  projectileSize: 9,
  projectileActive: 0,
  projectileKind: 1,
  projectileFaction: 2,
  projectileX: 3,
  projectileY: 4,
  projectileAngle: 5,
  projectileAge: 6,
  projectileShotId: 7,
  projectileShard: 8,
  shotsOffset: 2332,
  shotSize: 6,
  shotId: 0,
  shotWeapon: 1,
  shotMuzzle: 2,
  shotX: 3,
  shotY: 4,
  shotAngle: 5,
  chargesOffset: 2392,
  expiredOffset: 2397,
  expiredSize: 6,
  expiredKind: 0,
  expiredFaction: 1,
  expiredX: 2,
  expiredY: 3,
  expiredShotId: 4,
  expiredSlot: 5,
  stateSize: 3933,
  maxTargets: 128,
  targetSize: 4,
  shipTargetSize: 5,
  bumpSize: 8,
  scratchSize: 1024
};

// src/sim/loadout.ts
var DAMAGE_STATES = ["fullHealth", "slightDamage", "damaged", "veryDamaged"];
var damageState = (damage) => DAMAGE_STATES[Math.min(Math.max(0, Math.floor(damage)), DAMAGE_STATES.length - 1)] ?? "fullHealth";
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
var ENEMY_FIRE_GLOW_COLOR = 4172031;
var ENEMY_FIRE_GLOW_STRENGTH = 6;
var ENEMY_FIRE_GLOW_QUALITY = 3;
var ENEMY_FIRE_GLOW_DISTANCE = 4;
var TIER_COLORS = [void 0, 5951999, 13073919, 16763196];
var PICKUP_BLINK_AFTER = 20;
var PICKUP_GLOW_STRENGTH = 6;
var PICKUP_GLOW_QUALITY = 12;
var PICKUP_GLOW_DISTANCE = 6;
var PICKUP_USELESS_ALPHA = 0.45;
var SECTOR_LINE_COLOR = 14219519;
var SECTOR_LINE_ALPHA = 0.25;
var MISSION_COLOR = 16765562;
var MISSION_CSS = "#ffd27a";
var MISSION_ARROW_SIZE_PX = 12;
var MISSION_ARROW_MARGIN_PX = 28;

// src/sim/parts.ts
var PARTS = [...WEAPONS, ...ENGINES, ...SHIELDS];
var PART_NAMES = {
  autoCannon: "Auto Cannon",
  rockets: "Rockets",
  bigSpaceGun: "Big Space Gun",
  zapper: "Zapper",
  base: "Base Engine",
  bigPulse: "Big Pulse Engine",
  burst: "Burst Engine",
  supercharged: "Supercharged Engine",
  front: "Front Shield",
  frontAndSide: "Front and Side Shield",
  round: "Round Shield",
  invincibility: "Invincibility Shield"
};
function partLabel(part, tier) {
  const name = TIER_NAMES[tier] ?? "";
  return name === "" ? PART_NAMES[part] : `${name} ${PART_NAMES[part]}`;
}
var tierColor = (tier) => TIER_COLORS[tier];
function tierCss(tier) {
  const color = tierColor(tier);
  return color === void 0 ? "#d8f8ff" : `#${color.toString(16).padStart(6, "0")}`;
}
function tierFromPickup(unlocks, part) {
  const tier = unlocks.get(part);
  if (tier === void 0) {
    return 0;
  }
  return tier + 1 < TIER_NAMES.length ? tier + 1 : void 0;
}
function withTiers(loadout, unlocks) {
  return {
    ...loadout,
    weaponTier: unlocks.get(loadout.weapon) ?? 0,
    engineTier: unlocks.get(loadout.engine) ?? 0,
    shieldTier: unlocks.get(loadout.shield) ?? 0
  };
}
var defaultUnlocks = () => /* @__PURE__ */ new Map([
  [DEFAULT_LOADOUT.weapon, 0],
  [DEFAULT_LOADOUT.engine, 0],
  [DEFAULT_LOADOUT.shield, 0]
]);

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
  fighter: { engine: 10, weapons: 6, destruction: 9 },
  frigate: { engine: 12, weapons: 6, destruction: 9, shield: 40 }
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
  enemyShield: (kind) => `klaed-${kind}-shield`,
  enemyBullet: (id) => id === "klaedBullet" ? "klaed-bullet" : "klaed-big-bullet",
  pickup: (part) => `pickup-${part}`
};
var pickupFile = (part) => `${WEAPONS.includes(part) ? "weapon" : ENGINES.includes(part) ? "engine" : "shield"}-${part.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
var PICKUP_FRAMES = 15;
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
    ...PARTS.map((part) => strip(keys.pickup(part), `${ASSETS}/pickups/${pickupFile(part)}.png`, 32, PICKUP_FRAMES, 12)),
    still(keys.asteroid, `${env}/asteroid.png`, 96),
    ...ENEMY_KINDS.flatMap((kind) => {
      const f = KLAED_FILES[kind];
      return [
        still(keys.enemyBase(kind), `${klaed}/${kind}-base.png`, 64),
        strip(keys.enemyEngine(kind), `${klaed}/${kind}-engine.png`, 64, f.engine, 12),
        strip(keys.enemyWeapons(kind), `${klaed}/${kind}-weapons.png`, 64, f.weapons, 18, false),
        strip(keys.enemyDestruction(kind), `${klaed}/${kind}-destruction.png`, 64, f.destruction, 14, false),
        ...f.shield === void 0 ? [] : [strip(keys.enemyShield(kind), `${klaed}/${kind}-shield.png`, 64, f.shield, 20)]
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
import Phaser8 from "./vendor/phaser.js";

// src/background.ts
var BACKGROUND_INTERVAL_MS = 50;
var WORKER_SOURCE = `let timer;
onmessage = (event) => {
  clearInterval(timer);
  if (event.data > 0) {
    timer = setInterval(() => postMessage(0), event.data);
  }
};`;
function workerTimer() {
  let worker;
  return {
    start(intervalMs, tick) {
      worker ??= new Worker(URL.createObjectURL(new Blob([WORKER_SOURCE], { type: "text/javascript" })));
      worker.onmessage = tick;
      worker.postMessage(intervalMs);
    },
    stop() {
      worker?.postMessage(0);
    }
  };
}
var BackgroundTicker = class {
  page;
  timer;
  now;
  onTick;
  last = 0;
  running = false;
  changed = () => {
    this.sync();
  };
  constructor(onTick, page, timer, now2) {
    this.onTick = onTick;
    this.page = page;
    this.timer = timer;
    this.now = now2;
  }
  /** Starts watching the page's visibility. */
  start() {
    this.page.addEventListener("visibilitychange", this.changed);
    this.sync();
  }
  /** Stops watching, and ticking. */
  stop() {
    this.page.removeEventListener("visibilitychange", this.changed);
    this.halt();
  }
  /** Whether the worker is stepping the game. */
  get ticking() {
    return this.running;
  }
  sync() {
    if (this.page.visibilityState !== "hidden") {
      this.halt();
      return;
    }
    if (this.running) {
      return;
    }
    this.running = true;
    this.last = this.now();
    this.timer.start(BACKGROUND_INTERVAL_MS, () => {
      const at2 = this.now();
      this.onTick(at2 - this.last);
      this.last = at2;
    });
  }
  halt() {
    if (this.running) {
      this.running = false;
      this.timer.stop();
    }
  }
};

// src/debug.ts
function publishDebugState(state) {
  window.voidmarch = state;
}

// src/net/codec.ts
import { fromBinary, fromJsonString, toBinary, toJsonString } from "./vendor/protobuf.js";

// src/gen/voidmarch/v1/messages_pb.js
import { enumDesc, fileDesc, messageDesc, tsEnum } from "./vendor/protobuf-codegenv2.js";
var file_voidmarch_v1_messages = /* @__PURE__ */ fileDesc("Cht2b2lkbWFyY2gvdjEvbWVzc2FnZXMucHJvdG8SDHZvaWRtYXJjaC52MSK6AQoHTG9hZG91dBIkCgZ3ZWFwb24YASABKA4yFC52b2lkbWFyY2gudjEuV2VhcG9uEiQKBmVuZ2luZRgCIAEoDjIULnZvaWRtYXJjaC52MS5FbmdpbmUSJAoGc2hpZWxkGAMgASgOMhQudm9pZG1hcmNoLnYxLlNoaWVsZBITCgt3ZWFwb25fdGllchgEIAEoDRITCgtlbmdpbmVfdGllchgFIAEoDRITCgtzaGllbGRfdGllchgGIAEoDSKGAQoEUGFydBImCgZ3ZWFwb24YASABKA4yFC52b2lkbWFyY2gudjEuV2VhcG9uSAASJgoGZW5naW5lGAIgASgOMhQudm9pZG1hcmNoLnYxLkVuZ2luZUgAEiYKBnNoaWVsZBgDIAEoDjIULnZvaWRtYXJjaC52MS5TaGllbGRIAEIGCgRraW5kIjgKBlVubG9jaxIgCgRwYXJ0GAEgASgLMhIudm9pZG1hcmNoLnYxLlBhcnQSDAoEdGllchgCIAEoDSKzAQoJU2hpcFN0YXRlEgkKAXgYASABKAISCQoBeRgCIAEoAhIKCgJ2eBgDIAEoAhIKCgJ2eRgEIAEoAhINCgVhbmdsZRgFIAEoAhIRCgl0aHJ1c3RpbmcYBiABKAgSJgoHbG9hZG91dBgHIAEoCzIVLnZvaWRtYXJjaC52MS5Mb2Fkb3V0Eg4KBmRhbWFnZRgIIAEoDRIOCgZzaGllbGQYCSABKAISDgoGcmV2aXZlGAogASgCIhYKBUhlbGxvEg0KBXRva2VuGAEgASgJIoUBCglTaG90RmlyZWQSCgoCaWQYASABKA0SJAoGd2VhcG9uGAIgASgOMhQudm9pZG1hcmNoLnYxLldlYXBvbhIOCgZtdXp6bGUYAyABKA0SCQoBeBgEIAEoAhIJCgF5GAUgASgCEg0KBWFuZ2xlGAYgASgCEhEKCWNvbXBhbmlvbhgHIAEoDSJvCgNIaXQSEAoIZW5lbXlfaWQYASABKA0SDwoHc2hvdF9pZBgCIAEoDRIOCgZkYW1hZ2UYAyABKA0SFQoJY29tcGFuaW9uGAQgASgNQgIYARINCgVzaGFyZBgFIAEoDRIPCgdnb2VzX29uGAYgASgIIggKBlN1bW1vbiJPCg5Db21wYW5pb25TdGF0ZRIRCgljb21wYW5pb24YASABKA0SJgoFc3RhdGUYAiABKAsyFy52b2lkbWFyY2gudjEuU2hpcFN0YXRlOgIYASIeCg5DaG9vc2VTcXVhZHJvbhIMCgRuYW1lGAEgASgJIpoBCg1TcXVhZHJvbk9yZGVyEikKBG1vZGUYASABKA4yGy52b2lkbWFyY2gudjEuQ29tcGFuaW9uTW9kZRIwCghvbmVfc2hvdBgCIAEoDjIeLnZvaWRtYXJjaC52MS5Db21wYW5pb25PbmVTaG90EgkKAXgYAyABKAISCQoBeRgEIAEoAhIWCg5mb2N1c19lbmVteV9pZBgFIAEoDSIcCgdEaXNtaXNzEhEKCWNvbXBhbmlvbhgBIAEoDSKIBAoNQ2xpZW50TWVzc2FnZRIkCgVoZWxsbxgBIAEoCzITLnZvaWRtYXJjaC52MS5IZWxsb0gAEigKBXN0YXRlGAIgASgLMhcudm9pZG1hcmNoLnYxLlNoaXBTdGF0ZUgAEicKBHNob3QYAyABKAsyFy52b2lkbWFyY2gudjEuU2hvdEZpcmVkSAASIAoDaGl0GAQgASgLMhEudm9pZG1hcmNoLnYxLkhpdEgAEiYKBnN1bW1vbhgFIAEoCzIULnZvaWRtYXJjaC52MS5TdW1tb25IABI1Cgljb21wYW5pb24YBiABKAsyHC52b2lkbWFyY2gudjEuQ29tcGFuaW9uU3RhdGVCAhgBSAASKAoHZGlzbWlzcxgHIAEoCzIVLnZvaWRtYXJjaC52MS5EaXNtaXNzSAASNwoPY2hvb3NlX3NxdWFkcm9uGAggASgLMhwudm9pZG1hcmNoLnYxLkNob29zZVNxdWFkcm9uSAASNQoOc3F1YWRyb25fb3JkZXIYCSABKAsyGy52b2lkbWFyY2gudjEuU3F1YWRyb25PcmRlckgAEigKB2NvbGxlY3QYCiABKAsyFS52b2lkbWFyY2gudjEuQ29sbGVjdEgAEjEKDHBpY2tfbWlzc2lvbhgLIAEoCzIZLnZvaWRtYXJjaC52MS5QaWNrTWlzc2lvbkgAQgYKBGtpbmQiHQoLUGlja01pc3Npb24SDgoGc2VjdG9yGAEgASgJIhUKB0NvbGxlY3QSCgoCaWQYASABKA0iqQMKB1dlbGNvbWUSEQoJcGxheWVyX2lkGAEgASgJEg0KBWNvbG9yGAIgASgNEg8KB3NwYXduX3gYAyABKAISDwoHc3Bhd25feRgEIAEoAhIMCgR0aWNrGAUgASgNEhEKCXRpY2tfcmF0ZRgGIAEoDRIXCg9jb21wYW5pb25fbGltaXQYByABKA0SDAoEbmFtZRgJIAEoCRISCgpjb21wYW5pb25zGAogAygNEioKCXNxdWFkcm9ucxgLIAEoCzIXLnZvaWRtYXJjaC52MS5TcXVhZHJvbnMSEAoIc3F1YWRyb24YDCABKAkSJQoHdW5sb2NrcxgNIAMoCzIULnZvaWRtYXJjaC52MS5VbmxvY2sSLAoHcGlja3VwcxgOIAMoCzIbLnZvaWRtYXJjaC52MS5QaWNrdXBEcm9wcGVkEiYKB2xvYWRvdXQYDyABKAsyFS52b2lkbWFyY2gudjEuTG9hZG91dBITCgtkZXZlbG9wbWVudBgQIAEoCBIXCg9jbGVhcmVkX3NlY3RvcnMYESADKAlKBAgIEAlSD3N1bW1vbl9hbnl3aGVyZSKMAQoOUGxheWVyU25hcHNob3QSEQoJcGxheWVyX2lkGAEgASgJEgwKBG5hbWUYAiABKAkSDQoFY29sb3IYAyABKA0SJgoFc3RhdGUYBCABKAsyFy52b2lkbWFyY2gudjEuU2hpcFN0YXRlEhAKCG93bmVyX2lkGAUgASgJEhAKCHNxdWFkcm9uGAYgASgJIkUKDlNxdWFkcm9uTWVtYmVyEhEKCXBsYXllcl9pZBgBIAEoCRIMCgRuYW1lGAIgASgJEhIKCmNvbXBhbmlvbnMYAyABKA0ihwEKDFNxdWFkcm9uSW5mbxIMCgRuYW1lGAEgASgJEi0KB21lbWJlcnMYAiADKAsyHC52b2lkbWFyY2gudjEuU3F1YWRyb25NZW1iZXISKQoEbW9kZRgDIAEoDjIbLnZvaWRtYXJjaC52MS5Db21wYW5pb25Nb2RlEg8KB21pc3Npb24YBCABKAkiXQoJU3F1YWRyb25zEi0KCXNxdWFkcm9ucxgBIAMoCzIaLnZvaWRtYXJjaC52MS5TcXVhZHJvbkluZm8SEQoJbmV4dF9uYW1lGAIgASgJEg4KBmhhbmdhchgDIAEoDSJyCg5TcXVhZHJvbkpvaW5lZBIMCgRuYW1lGAEgASgJEikKBG1vZGUYAiABKA4yGy52b2lkbWFyY2gudjEuQ29tcGFuaW9uTW9kZRIRCgl0b29rX292ZXIYAyABKAgSCQoBeBgEIAEoAhIJCgF5GAUgASgCIiEKD1NxdWFkcm9uUmVmdXNlZBIOCgZyZWFzb24YASABKAkiXgoPU3F1YWRyb25PcmRlcmVkEhEKCXBsYXllcl9pZBgBIAEoCRIMCgRuYW1lGAIgASgJEioKBW9yZGVyGAMgASgLMhsudm9pZG1hcmNoLnYxLlNxdWFkcm9uT3JkZXIiwgEKCkVuZW15U3RhdGUSEAoIZW5lbXlfaWQYASABKA0SJQoEa2luZBgCIAEoDjIXLnZvaWRtYXJjaC52MS5FbmVteUtpbmQSCQoBeBgDIAEoAhIJCgF5GAQgASgCEg0KBWFuZ2xlGAUgASgCEgoKAnZ4GAYgASgCEgoKAnZ5GAcgASgCEgoKAmhwGAggASgCEg4KBm1heF9ocBgJIAEoAhIOCgZzaGllbGQYCiABKAISEgoKc2NhbGVkX2ZvchgLIAEoAiKiAQoIU25hcHNob3QSDAoEdGljaxgBIAEoDRItCgdwbGF5ZXJzGAIgAygLMhwudm9pZG1hcmNoLnYxLlBsYXllclNuYXBzaG90EikKB2VuZW1pZXMYAyADKAsyGC52b2lkbWFyY2gudjEuRW5lbXlTdGF0ZRIuCglkZXJlbGljdHMYBCADKAsyGy52b2lkbWFyY2gudjEuRGVyZWxpY3RTdGF0ZSJsCg1EZXJlbGljdFN0YXRlEhMKC2RlcmVsaWN0X2lkGAEgASgNEgkKAXgYAiABKAISCQoBeRgDIAEoAhINCgVhbmdsZRgEIAEoAhIOCgZyZXNjdWUYBSABKAISEQoJZ29uZV90aWNrGAYgASgNIpoBCgpFbmVteUZpcmVkEhAKCGVuZW15X2lkGAEgASgNEiUKBGtpbmQYAiABKA4yFy52b2lkbWFyY2gudjEuRW5lbXlLaW5kEgwKBHRpY2sYAyABKA0SDAoEc2VlZBgEIAEoDRIJCgF4GAUgASgCEgkKAXkYBiABKAISDQoFYW5nbGUYByABKAISEgoKd2Fybl90aWNrcxgIIAEoDSKDAQoORW5lbXlEZXN0cm95ZWQSEAoIZW5lbXlfaWQYASABKA0SJQoEa2luZBgCIAEoDjIXLnZvaWRtYXJjaC52MS5FbmVteUtpbmQSFAoMYnlfcGxheWVyX2lkGAMgASgJEgwKBHRpY2sYBCABKA0SCQoBeBgFIAEoAhIJCgF5GAYgASgCIkwKCVNob3RFbmRlZBIRCglwbGF5ZXJfaWQYASABKAkSDwoHc2hvdF9pZBgCIAEoDRIMCgR0aWNrGAMgASgNEg0KBXNoYXJkGAQgASgNIlQKClJlbW90ZVNob3QSEQoJcGxheWVyX2lkGAEgASgJEgwKBHRpY2sYAiABKA0SJQoEc2hvdBgDIAEoCzIXLnZvaWRtYXJjaC52MS5TaG90RmlyZWQiHwoKUGxheWVyTGVmdBIRCglwbGF5ZXJfaWQYASABKAkiOwoQQ29tcGFuaW9uR3JhbnRlZBIRCgljb21wYW5pb24YASABKA0SCQoBeBgCIAEoAhIJCgF5GAMgASgCIiIKEENvbXBhbmlvblJlZnVzZWQSDgoGcmVhc29uGAEgASgJIjkKEkNvbXBhbmlvbkRpc21pc3NlZBIRCgljb21wYW5pb24YASABKA0SEAoIdGFrZW5fYnkYAiABKAkiBgoERnVsbCLyBwoNU2VydmVyTWVzc2FnZRIoCgd3ZWxjb21lGAEgASgLMhUudm9pZG1hcmNoLnYxLldlbGNvbWVIABIqCghzbmFwc2hvdBgCIAEoCzIWLnZvaWRtYXJjaC52MS5TbmFwc2hvdEgAEigKBHNob3QYAyABKAsyGC52b2lkbWFyY2gudjEuUmVtb3RlU2hvdEgAEigKBGxlZnQYBCABKAsyGC52b2lkbWFyY2gudjEuUGxheWVyTGVmdEgAEiIKBGZ1bGwYBSABKAsyEi52b2lkbWFyY2gudjEuRnVsbEgAEi8KC2VuZW15X2ZpcmVkGAYgASgLMhgudm9pZG1hcmNoLnYxLkVuZW15RmlyZWRIABI3Cg9lbmVteV9kZXN0cm95ZWQYByABKAsyHC52b2lkbWFyY2gudjEuRW5lbXlEZXN0cm95ZWRIABItCgpzaG90X2VuZGVkGAggASgLMhcudm9pZG1hcmNoLnYxLlNob3RFbmRlZEgAEjsKEWNvbXBhbmlvbl9ncmFudGVkGAkgASgLMh4udm9pZG1hcmNoLnYxLkNvbXBhbmlvbkdyYW50ZWRIABI7ChFjb21wYW5pb25fcmVmdXNlZBgKIAEoCzIeLnZvaWRtYXJjaC52MS5Db21wYW5pb25SZWZ1c2VkSAASPwoTY29tcGFuaW9uX2Rpc21pc3NlZBgLIAEoCzIgLnZvaWRtYXJjaC52MS5Db21wYW5pb25EaXNtaXNzZWRIABIsCglzcXVhZHJvbnMYDCABKAsyFy52b2lkbWFyY2gudjEuU3F1YWRyb25zSAASNwoPc3F1YWRyb25fam9pbmVkGA0gASgLMhwudm9pZG1hcmNoLnYxLlNxdWFkcm9uSm9pbmVkSAASOQoQc3F1YWRyb25fcmVmdXNlZBgOIAEoCzIdLnZvaWRtYXJjaC52MS5TcXVhZHJvblJlZnVzZWRIABI5ChBzcXVhZHJvbl9vcmRlcmVkGA8gASgLMh0udm9pZG1hcmNoLnYxLlNxdWFkcm9uT3JkZXJlZEgAEjUKDnBpY2t1cF9kcm9wcGVkGBAgASgLMhsudm9pZG1hcmNoLnYxLlBpY2t1cERyb3BwZWRIABIxCgxwaWNrdXBfdGFrZW4YESABKAsyGS52b2lkbWFyY2gudjEuUGlja3VwVGFrZW5IABI5ChBkZXJlbGljdF9yZXNjdWVkGBIgASgLMh0udm9pZG1hcmNoLnYxLkRlcmVsaWN0UmVzY3VlZEgAEjUKDnNlY3Rvcl9jbGVhcmVkGBMgASgLMhsudm9pZG1hcmNoLnYxLlNlY3RvckNsZWFyZWRIAEIGCgRraW5kInQKDVBpY2t1cERyb3BwZWQSCgoCaWQYASABKA0SIAoEcGFydBgCIAEoCzISLnZvaWRtYXJjaC52MS5QYXJ0EgkKAXgYAyABKAISCQoBeRgEIAEoAhIMCgR0aWNrGAUgASgNEhEKCWdvbmVfdGljaxgGIAEoDSJVCgtQaWNrdXBUYWtlbhIKCgJpZBgBIAEoDRIRCglwbGF5ZXJfaWQYAiABKAkSJwoFZ2FpbnMYAyADKAsyGC52b2lkbWFyY2gudjEuUGlja3VwR2FpbiJWCg1TZWN0b3JDbGVhcmVkEg4KBnNlY3RvchgBIAEoCRIMCgR0aWNrGAIgASgNEicKBWdhaW5zGAMgAygLMhgudm9pZG1hcmNoLnYxLlBpY2t1cEdhaW4iVwoPRGVyZWxpY3RSZXNjdWVkEhMKC2RlcmVsaWN0X2lkGAEgASgNEhEKCXBsYXllcl9pZBgCIAEoCRIMCgR0aWNrGAMgASgNEg4KBmhhbmdhchgEIAEoDSJFCgpQaWNrdXBHYWluEhEKCXBsYXllcl9pZBgBIAEoCRIkCgZ1bmxvY2sYAiABKAsyFC52b2lkbWFyY2gudjEuVW5sb2NrKnkKBldlYXBvbhIWChJXRUFQT05fVU5TUEVDSUZJRUQQABIWChJXRUFQT05fQVVUT19DQU5OT04QARISCg5XRUFQT05fUk9DS0VUUxACEhgKFFdFQVBPTl9CSUdfU1BBQ0VfR1VOEAMSEQoNV0VBUE9OX1pBUFBFUhAEKnIKBkVuZ2luZRIWChJFTkdJTkVfVU5TUEVDSUZJRUQQABIPCgtFTkdJTkVfQkFTRRABEhQKEEVOR0lORV9CSUdfUFVMU0UQAhIQCgxFTkdJTkVfQlVSU1QQAxIXChNFTkdJTkVfU1VQRVJDSEFSR0VEEAQqeQoGU2hpZWxkEhYKElNISUVMRF9VTlNQRUNJRklFRBAAEhAKDFNISUVMRF9GUk9OVBABEhkKFVNISUVMRF9GUk9OVF9BTkRfU0lERRACEhAKDFNISUVMRF9ST1VORBADEhgKFFNISUVMRF9JTlZJTkNJQklMSVRZEAQqbQoJRW5lbXlLaW5kEhoKFkVORU1ZX0tJTkRfVU5TUEVDSUZJRUQQABIUChBFTkVNWV9LSU5EX1NDT1VUEAESFgoSRU5FTVlfS0lORF9GSUdIVEVSEAISFgoSRU5FTVlfS0lORF9GUklHQVRFEAMqtAEKDUNvbXBhbmlvbk1vZGUSHgoaQ09NUEFOSU9OX01PREVfVU5TUEVDSUZJRUQQABIZChVDT01QQU5JT05fTU9ERV9FU0NPUlQQARIZChVDT01QQU5JT05fTU9ERV9BVFRBQ0sQAhIYChRDT01QQU5JT05fTU9ERV9HVUFSRBADEhcKE0NPTVBBTklPTl9NT0RFX0hPTEQQBBIaChZDT01QQU5JT05fTU9ERV9TVEVBTFRIEAUqlAEKEENvbXBhbmlvbk9uZVNob3QSIgoeQ09NUEFOSU9OX09ORV9TSE9UX1VOU1BFQ0lGSUVEEAASHAoYQ09NUEFOSU9OX09ORV9TSE9UX0ZPQ1VTEAESHgoaQ09NUEFOSU9OX09ORV9TSE9UX1JFR1JPVVAQAhIeChpDT01QQU5JT05fT05FX1NIT1RfR09fSE9NRRADQkZaRGdpdGh1Yi5jb20vc3RhcnF1YWtlL3ZvaWRtYXJjaC9pbnRlcm5hbC9nZW4vdm9pZG1hcmNoL3YxO3ZvaWRtYXJjaHYxYgZwcm90bzM");
var ShipStateSchema = /* @__PURE__ */ messageDesc(file_voidmarch_v1_messages, 3);
var ClientMessageSchema = /* @__PURE__ */ messageDesc(file_voidmarch_v1_messages, 12);
var ServerMessageSchema = /* @__PURE__ */ messageDesc(file_voidmarch_v1_messages, 35);
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
var fromEnemyKind = (kind) => {
  switch (kind) {
    case EnemyKind.FIGHTER:
      return "fighter";
    case EnemyKind.FRIGATE:
      return "frigate";
    default:
      return "scout";
  }
};
var fromWeapon = (w) => WEAPON_IDS.get(w) ?? DEFAULT_LOADOUT.weapon;
function fromPart(part) {
  switch (part?.kind.case) {
    case "weapon":
      return WEAPON_IDS.get(part.kind.value);
    case "engine":
      return ENGINE_IDS.get(part.kind.value);
    case "shield":
      return SHIELD_IDS.get(part.kind.value);
    default:
      return void 0;
  }
}
function fromUnlocks(unlocks) {
  const out = /* @__PURE__ */ new Map();
  for (const u of unlocks) {
    const part = fromPart(u.part);
    if (part !== void 0) {
      out.set(part, tierOf(u.tier));
    }
  }
  return out;
}
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
      shield: SHIELDS2[ship.loadout.shield],
      weaponTier: ship.loadout.weaponTier,
      engineTier: ship.loadout.engineTier,
      shieldTier: ship.loadout.shieldTier
    },
    damage: ship.damage,
    shield: ship.shield,
    revive: ship.revive
  });
}
function fromLoadout(loadout) {
  return {
    weapon: fromWeapon(loadout?.weapon ?? Weapon.UNSPECIFIED),
    engine: ENGINE_IDS.get(loadout?.engine ?? Engine.UNSPECIFIED) ?? DEFAULT_LOADOUT.engine,
    shield: SHIELD_IDS.get(loadout?.shield ?? Shield.UNSPECIFIED) ?? DEFAULT_LOADOUT.shield,
    weaponTier: tierOf(loadout?.weaponTier),
    engineTier: tierOf(loadout?.engineTier),
    shieldTier: tierOf(loadout?.shieldTier)
  };
}
var tierOf = (tier) => Math.min(tier ?? 0, MAX_TIER);
function fromShipState(state) {
  const loadout = state.loadout;
  return {
    x: state.x,
    y: state.y,
    vx: state.vx,
    vy: state.vy,
    angle: state.angle,
    thrusting: state.thrusting,
    loadout: fromLoadout(loadout),
    damage: Math.min(state.damage, DAMAGE_STATES.length - 1),
    shield: state.shield,
    revive: state.revive
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
    return CONTROL_MODES.find((mode) => mode === saved) ?? "screen";
  } catch {
    return "screen";
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

// src/loadout.ts
var SLOTS = ["weapon", "engine", "shield"];
var SLOT_PARTS = { weapon: WEAPONS, engine: ENGINES, shield: SHIELDS };
var PART_HINTS = {
  autoCannon: "steady and precise",
  rockets: "seek their target",
  bigSpaceGun: "bursts into a star",
  zapper: "pierces",
  base: "balanced",
  bigPulse: "fast, drifts",
  burst: "quick off the mark",
  supercharged: "fast and quick",
  front: "strong ahead",
  frontAndSide: "wider cover",
  round: "all around, one charge",
  invincibility: "three charges, slow to recharge"
};
function loadoutEntries(slot, unlocks, fitted) {
  return SLOT_PARTS[slot].map((part) => {
    const tier = unlocks.get(part);
    const locked = tier === void 0;
    return {
      part,
      label: partLabel(part, tier ?? 0),
      color: tierCss(tier ?? 0),
      hint: locked ? "not found yet" : PART_HINTS[part],
      locked,
      fitted: fitted[slot] === part,
      tier: tier ?? 0
    };
  });
}
function fitPart(loadout, slot, part, unlocks) {
  const tier = unlocks.get(part) ?? 0;
  switch (slot) {
    case "weapon":
      return { ...loadout, weapon: part, weaponTier: tier };
    case "engine":
      return { ...loadout, engine: part, engineTier: tier };
    case "shield":
      return { ...loadout, shield: part, shieldTier: tier };
  }
}
function stepPart(slot, unlocks, fitted, step) {
  const parts = SLOT_PARTS[slot];
  const from = parts.indexOf(fitted[slot]);
  for (let i = 1; i < parts.length; i++) {
    const part = parts[(from + step * i + parts.length) % parts.length];
    if (part !== void 0 && unlocks.has(part)) {
      return part;
    }
  }
  return void 0;
}
var LoadoutScreen = class {
  form;
  slots;
  hangar;
  slot = "weapon";
  unlocks = /* @__PURE__ */ new Map();
  loadout;
  actions = { fit: () => void 0, summon: () => void 0 };
  constructor(doc = document) {
    this.form = doc.querySelector("#loadout-form");
    this.slots = doc.querySelector("#loadout-slots");
    this.hangar = doc.querySelector("#loadout-hangar");
    this.form?.addEventListener("submit", (event) => {
      event.preventDefault();
    });
    doc.querySelector("#loadout-summon")?.addEventListener("click", () => {
      this.actions.summon();
    });
  }
  get open() {
    return this.form !== null && !this.form.hidden;
  }
  show(actions) {
    this.actions = actions;
    if (this.form !== null) {
      this.form.hidden = false;
    }
  }
  hide() {
    if (this.form !== null) {
      this.form.hidden = true;
    }
  }
  /** Redraws the parts and the hangar line when anything changed. */
  update(unlocks, loadout, hangar) {
    this.unlocks = unlocks;
    const changed = this.loadout === void 0 || JSON.stringify(this.loadout) !== JSON.stringify(loadout);
    this.loadout = { ...loadout };
    if (this.hangar !== null && this.hangar.textContent !== hangar) {
      this.hangar.textContent = hangar;
    }
    if (changed || this.slots?.childElementCount === 0) {
      this.slots?.replaceChildren(...SLOTS.map((slot) => this.column(slot)));
    }
  }
  /** Handles a key while the screen is open, and reports whether it was the screen's. */
  key(code) {
    const slot = { Digit1: "weapon", Digit2: "engine", Digit3: "shield" }[code];
    if (slot !== void 0) {
      this.slot = slot;
      this.redraw();
      return true;
    }
    const step = code === "ArrowDown" ? 1 : code === "ArrowUp" ? -1 : 0;
    if (step === 0 || this.loadout === void 0) {
      return false;
    }
    const part = stepPart(this.slot, this.unlocks, this.loadout, step);
    if (part !== void 0) {
      this.actions.fit(fitPart(this.loadout, this.slot, part, this.unlocks));
    }
    return true;
  }
  redraw() {
    this.slots?.replaceChildren(...SLOTS.map((slot) => this.column(slot)));
  }
  column(slot) {
    const doc = this.slots?.ownerDocument ?? document;
    const column = doc.createElement("div");
    column.className = slot === this.slot ? "loadout-slot picked" : "loadout-slot";
    const title = doc.createElement("h3");
    title.textContent = slot;
    column.append(title);
    const fitted = this.loadout;
    if (fitted === void 0) {
      return column;
    }
    for (const entry of loadoutEntries(slot, this.unlocks, fitted)) {
      column.append(this.row(doc, slot, entry, fitted));
    }
    return column;
  }
  row(doc, slot, entry, fitted) {
    const row = doc.createElement("button");
    row.type = "button";
    row.className = `loadout-part${entry.locked ? " locked" : ""}${entry.fitted ? " fitted" : ""}`;
    row.disabled = entry.locked;
    row.dataset.part = entry.part;
    const icon = doc.createElement("span");
    icon.className = "icon";
    icon.style.backgroundImage = `url(${ASSETS}/pickups/${pickupFile(entry.part)}.png)`;
    const name = doc.createElement("span");
    name.className = "label";
    name.textContent = entry.label;
    name.style.color = entry.locked ? "" : entry.color;
    const hint = doc.createElement("span");
    hint.className = "hint";
    hint.textContent = entry.fitted ? `fitted \xB7 ${entry.hint}` : entry.hint;
    name.append(hint);
    row.append(icon, name);
    row.addEventListener("click", () => {
      this.slot = slot;
      this.actions.fit(fitPart(fitted, slot, entry.part, this.unlocks));
    });
    return row;
  }
};

// src/simwasm.ts
var SCRATCH_SIZE = LAYOUT.scratchSize;
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
      loadout: { weapon: WEAPONS[0], engine: ENGINES[0], shield: SHIELDS[0], weaponTier: 0, engineTier: 0, shieldTier: 0 },
      damage: 0,
      shield: 0,
      sinceHit: 0,
      downFor: 0,
      revive: 0,
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
  /**
   * Runs as many fixed ticks as frameSeconds covers, using the same input for
   * each. The nearest squadmate that is up decides the shield's formation
   * bonus, and it or any friendly ship that is up revives a downed ship.
   */
  advance(frameSeconds, input, squadmateDistance = Infinity, friendDistance = Infinity) {
    const cmd = toCommand(input);
    this.exports.advance(frameSeconds, cmd.moveX, cmd.moveY, cmd.aimX, cmd.aimY, cmd.fire ? 1 : 0, squadmateDistance, friendDistance);
    return this.read();
  }
  /** Applies a hit on the ship from direction from, as shipScan reports it; true when the shield took it. */
  takeHit(from) {
    const absorbed = this.exports.takeHit(from) !== 0;
    this.read();
    return absorbed;
  }
  /** Whether the ship is down (#47). */
  get downed() {
    return this.ship.damage >= MAX_DAMAGE;
  }
  /** Whether the downed ship's player may respawn yet. */
  get canRespawn() {
    return this.downed && this.ship.downFor >= RESPAWN_DELAY;
  }
  /** Brings the downed ship back at (x, y), whole, once its player may; true when it did. */
  respawn(x, y) {
    const done = this.exports.respawn(x, y) !== 0;
    this.read();
    return done;
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
      SHIELDS.indexOf(loadout.shield),
      loadout.weaponTier,
      loadout.engineTier,
      loadout.shieldTier
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
  /**
   * Tests every active projectile of the faction along the path it flew in
   * the last stepSeconds against the targets, ends the ones that hit, and
   * returns what hit what: one call for the frame.
   */
  hitScan(faction, stepSeconds, targets) {
    const n = this.writeTargets(targets);
    const count = this.exports.hitScan(FACTIONS.indexOf(faction), stepSeconds, n);
    if (count === 0) {
      return [];
    }
    const pointer = this.exports.hitsPointer();
    const triples = new Float64Array(this.memory(), pointer, count * 3);
    const hits = Array.from({ length: count }, (_, i) => [triples[i * 3] ?? -1, triples[i * 3 + 1] ?? -1, triples[i * 3 + 2] === 1]);
    this.read();
    const out = [];
    for (const [slot, index, goesOn] of hits) {
      const projectile = this.projectiles.items[slot];
      const target = targets[index];
      if (projectile !== void 0 && target !== void 0) {
        out.push({ projectile, target, goesOn });
      }
    }
    return out;
  }
  /**
   * Turns the seeking projectiles of the faction toward the nearest of the
   * targets ahead of them, by at most their turn rate over stepSeconds (#72).
   */
  steer(faction, stepSeconds, targets) {
    const n = this.writeTargets(targets);
    this.exports.steer(FACTIONS.indexOf(faction), stepSeconds, n);
    this.read();
  }
  /**
   * Scatters the star a shot of weapon bursts into where it ended, as
   * projectiles of the faction named by the shot's id and owner. The owner
   * seeds it, so every screen draws the same star. The shards pass the
   * enemies the shot in slot from hit. Returns the shards.
   */
  burst(weapon, faction, x, y, shotId, owner, from = -1) {
    const scratch = this.scratch();
    const units = Array.from(owner.slice(0, SCRATCH_SIZE), (_, i) => owner.charCodeAt(i));
    scratch.set(units);
    const seed = this.exports.burstSeed(units.length, shotId);
    const count = this.exports.burst(WEAPONS.indexOf(weapon), FACTIONS.indexOf(faction), x, y, shotId, seed >>> 0, from);
    const slots = Array.from(this.scratch().subarray(0, count));
    return this.projectiles.adopt(slots, faction === "own" ? "" : owner);
  }
  /** Writes targets into scratch for a scan, and returns how many fit. */
  writeTargets(targets) {
    const n = Math.min(targets.length, LAYOUT.maxTargets);
    const scratch = this.scratch();
    for (let i = 0; i < n; i++) {
      const t = targets[i];
      if (t !== void 0) {
        scratch.set([t.x, t.y, t.radius, typeof t.id === "number" ? t.id : i], i * LAYOUT.targetSize);
      }
    }
    return n;
  }
  /**
   * Tests every enemy bullet along the path it flew in the last stepSeconds
   * against the ships, a charged shield's arc before the hull, and ends the
   * ones that hit. Returns what hit which ship, and the direction of the
   * contact from it, for takeHit.
   */
  shipScan(stepSeconds, ships) {
    const n = Math.min(ships.length, LAYOUT.maxTargets);
    const scratch = this.scratch();
    for (let i = 0; i < n; i++) {
      const s = ships[i];
      if (s !== void 0) {
        scratch.set([s.x, s.y, s.angle, SHIELDS.indexOf(s.shield), s.charges], i * LAYOUT.shipTargetSize);
      }
    }
    const count = this.exports.shipScan(stepSeconds, n);
    if (count === 0) {
      return [];
    }
    const triples = new Float64Array(this.memory(), this.exports.hitsPointer(), count * 3);
    const hits = Array.from({ length: count }, (_, i) => [triples[i * 3] ?? -1, triples[i * 3 + 1] ?? -1, triples[i * 3 + 2] ?? 0]);
    this.read();
    const out = [];
    for (const [slot, index, from] of hits) {
      const projectile = this.projectiles.items[slot];
      const ship = ships[index];
      if (projectile !== void 0 && ship !== void 0) {
        out.push({ projectile, ship, from });
      }
    }
    return out;
  }
  /**
   * Pushes the ship out of every body it overlaps and applies a hit for
   * each ram, from the rammed body's side. Returns the rams, by index into
   * bodies, and whether the shield took each.
   */
  bump(bodies) {
    const n = Math.min(bodies.length, LAYOUT.maxTargets);
    const scratch = this.scratch();
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      if (b !== void 0) {
        scratch.set([b.x, b.y, b.radius, b.vx, b.vy, b.key, b.side, b.gentle === true ? 1 : 0], i * LAYOUT.bumpSize);
      }
    }
    const count = this.exports.bump(n);
    const rams = [];
    if (count > 0) {
      const pairs = new Float64Array(this.memory(), this.exports.hitsPointer(), count * 2);
      for (let i = 0; i < count; i++) {
        rams.push({ index: pairs[i * 2] ?? -1, absorbed: pairs[i * 2 + 1] === 1 });
      }
    }
    this.read();
    return rams;
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
    ship.shield = get(LAYOUT.shipShieldCharge);
    ship.sinceHit = get(LAYOUT.shipSinceHit);
    ship.downFor = get(LAYOUT.shipDownFor);
    ship.revive = get(LAYOUT.shipRevive);
    ship.rotationSnap = get(LAYOUT.shipRotationSnap);
    ship.loadout.weapon = at(WEAPONS, get(LAYOUT.shipWeapon), WEAPONS[0]);
    ship.loadout.engine = at(ENGINES, get(LAYOUT.shipEngine), ENGINES[0]);
    ship.loadout.shield = at(SHIELDS, get(LAYOUT.shipShield), SHIELDS[0]);
    ship.loadout.weaponTier = get(LAYOUT.shipWeaponTier);
    ship.loadout.engineTier = get(LAYOUT.shipEngineTier);
    ship.loadout.shieldTier = get(LAYOUT.shipShieldTier);
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
        y: get(b + LAYOUT.expiredY),
        shotId: get(b + LAYOUT.expiredShotId),
        owner: this.projectiles.ownerOf(get(b + LAYOUT.expiredSlot))
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
      shard: 0,
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
  /** The remote owner of the projectile in slot, '' for an own shot. */
  ownerOf(slot) {
    return this.owners[slot] ?? "";
  }
  /** Takes on projectiles the sim spawned itself, a burst's shards, for owner. */
  adopt(slots, owner) {
    for (const slot of slots) {
      this.owners[slot] = owner;
    }
    this.read(this.sandbox.state());
    return slots.map((slot) => this.slots[slot]).filter((p) => p !== void 0);
  }
  /** Ends a remote player's shot, or a shard of its burst, that hit something, and returns it. */
  end(owner, shotId, shard = 0) {
    const p = this.slots.find(
      (q) => q.active && q.faction === "remote" && q.owner === owner && q.shotId === shotId && q.shard === shard
    );
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
      p.shard = s[b + LAYOUT.projectileShard] ?? 0;
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

// src/sim/sectors.ts
var LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
function sectorName(x, y) {
  const col = Math.floor((x + WORLD_HALF_SIZE) / SECTOR_SIZE);
  const row = Math.floor((y + WORLD_HALF_SIZE) / SECTOR_SIZE);
  if (col < 0 || col >= GRID_SIZE || row < 0 || row >= GRID_SIZE) {
    return void 0;
  }
  return `${LETTERS.charAt(col)}${String(row + 1)}`;
}
var HOME_SECTOR = sectorName(0, 0) ?? "";
function sectorState(name, cleared) {
  if (name === HOME_SECTOR) {
    return "home";
  }
  if (cleared === void 0) {
    return "unknown";
  }
  return cleared.has(name) ? "cleared" : "hostile";
}
function sectorLine(x, y, cleared) {
  const name = sectorName(x, y);
  if (name === void 0) {
    return "";
  }
  const state = sectorState(name, cleared);
  return state === "unknown" ? `Sector ${name}` : `Sector ${name} \xB7 ${state}`;
}
function sectorEdges() {
  return Array.from({ length: GRID_SIZE + 1 }, (_, i) => i * SECTOR_SIZE - WORLD_HALF_SIZE);
}
function sectorCenter(name) {
  const col = LETTERS.indexOf(name.charAt(0));
  const row = Number(name.slice(1)) - 1;
  if (col < 0 || col >= GRID_SIZE || !Number.isInteger(row) || row < 0 || row >= GRID_SIZE) {
    return void 0;
  }
  return { x: (col + 0.5) * SECTOR_SIZE - WORLD_HALF_SIZE, y: (row + 0.5) * SECTOR_SIZE - WORLD_HALF_SIZE };
}
function missionArrow(ship, target, width, height, margin) {
  const center = sectorCenter(target);
  if (center === void 0 || sectorName(ship.x, ship.y) === target) {
    return void 0;
  }
  const angle = Math.atan2(center.y - ship.y, center.x - ship.x);
  const halfW = width / 2 - margin;
  const halfH = height / 2 - margin;
  const scale = Math.min(halfW / Math.max(Math.abs(Math.cos(angle)), 1e-9), halfH / Math.max(Math.abs(Math.sin(angle)), 1e-9));
  return { x: width / 2 + Math.cos(angle) * scale, y: height / 2 + Math.sin(angle) * scale, angle };
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

// src/net/boss.ts
var BOSS_NAMES = { frigate: "KLA'ED FRIGATE" };
function bossBar(bosses, x, y) {
  let nearest;
  let distance = FRIGATE_REACH;
  for (const boss of bosses) {
    const d = Math.hypot(boss.x - x, boss.y - y);
    if (d <= distance && BOSS_NAMES[boss.kind] !== void 0) {
      nearest = boss;
      distance = d;
    }
  }
  if (nearest === void 0 || nearest.maxHp <= 0) {
    return void 0;
  }
  const hp = Math.max(0, Math.ceil(nearest.hp));
  const max = Math.round(nearest.maxHp);
  const scaled = nearest.scaledFor > 0 ? ` \xB7 scaled for ${String(nearest.scaledFor)} nearby` : "";
  return {
    name: BOSS_NAMES[nearest.kind] ?? "",
    health: Math.min(hp / max, 1),
    shield: Math.min(Math.max(nearest.shield / FRIGATE_SHIELD, 0), 1),
    text: `${String(hp)} / ${String(max)}${scaled}`
  };
}

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

// src/scenes/bossbar.ts
import "./vendor/phaser.js";
var NAME_COLOR = "#ff9a8a";
var TEXT_COLOR = "#d8f8ff";
var HEALTH_FILL = 16734794;
var SHIELD_FILL = 9427199;
var TRACK = 328458;
var TRACK_ALPHA = 0.8;
var WIDTH_SHARE = 0.3;
var TOP_PX = 8;
var FONT_PX = 12;
var HEALTH_PX = 10;
var SHIELD_PX = 3;
var GAP_PX = 2;
var BossBarView = class {
  name;
  text;
  bars;
  shown;
  width = 0;
  scale = 1;
  constructor(scene, hide) {
    const style = { fontFamily: "monospace", fontSize: `${String(FONT_PX)}px` };
    this.name = scene.add.text(0, 0, "", { ...style, color: NAME_COLOR }).setOrigin(0.5, 0).setShadow(1, 1, "#000000", 0);
    this.text = scene.add.text(0, 0, "", { ...style, color: TEXT_COLOR }).setOrigin(0.5, 0).setShadow(1, 1, "#000000", 0);
    this.bars = scene.add.graphics();
    for (const object of [this.name, this.text, this.bars]) {
      hide(object);
    }
    this.show(void 0);
  }
  /** The bar as shown, for the E2E tests. */
  get current() {
    return this.shown;
  }
  /** Lays the bar out for a screen width in device pixels at dpr. */
  resize(width, dpr) {
    this.width = Math.round(width * WIDTH_SHARE);
    this.scale = dpr;
    const x = width / 2;
    this.name.setFontSize(FONT_PX * dpr).setPosition(x, TOP_PX * dpr);
    this.bars.setPosition(Math.round(x - this.width / 2), this.name.y + this.name.height + GAP_PX * dpr);
    this.text.setFontSize(FONT_PX * dpr).setPosition(x, this.bars.y + (HEALTH_PX + SHIELD_PX + 2 * GAP_PX) * dpr);
    this.draw();
  }
  /** Shows bar, or hides it when undefined. */
  show(bar) {
    const same = bar?.name === this.shown?.name && bar?.health === this.shown?.health && bar?.shield === this.shown?.shield && bar?.text === this.shown?.text;
    this.shown = bar;
    for (const object of [this.name, this.text, this.bars]) {
      object.setVisible(bar !== void 0);
    }
    if (bar === void 0 || same) {
      return;
    }
    this.name.setText(bar.name);
    this.text.setText(bar.text);
    this.draw();
  }
  draw() {
    const bar = this.shown;
    this.bars.clear();
    if (bar === void 0) {
      return;
    }
    const s = this.scale;
    const health = HEALTH_PX * s;
    const shieldY = health + GAP_PX * s;
    const shield = SHIELD_PX * s;
    this.bars.fillStyle(TRACK, TRACK_ALPHA).fillRect(0, 0, this.width, health).fillRect(0, shieldY, this.width, shield).fillStyle(HEALTH_FILL, 1).fillRect(0, 0, Math.round(this.width * bar.health), health).fillStyle(SHIELD_FILL, 1).fillRect(0, shieldY, Math.round(this.width * bar.shield), shield);
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
  /** Reports a hit on an enemy: by a shot, a shard of its burst, or a ram (shot 0); goesOn when a piercing shot carries on (#72). */
  sendHit(enemyId, shotId, damage, shard = 0, goesOn = false) {
    if (this.welcomed) {
      this.send(create2(ClientMessageSchema, { kind: { case: "hit", value: { enemyId, shotId, damage, shard, goesOn } } }));
    }
  }
  /** Says our ship flew over a pickup; the server decides who gets it. */
  sendCollect(id) {
    if (this.welcomed) {
      this.send(create2(ClientMessageSchema, { kind: { case: "collect", value: { id } } }));
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
      case "pickupDropped":
        events.pickupDropped(message.kind.value);
        break;
      case "pickupTaken":
        events.pickupTaken(message.kind.value);
        break;
      case "derelictRescued":
        events.derelictRescued(message.kind.value);
        break;
      case "sectorCleared":
        events.sectorCleared(message.kind.value);
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
import Phaser5 from "./vendor/phaser.js";

// src/scenes/shipview.ts
import Phaser4 from "./vendor/phaser.js";
var SPRITE_FACING = Math.PI / 2;
var HIT_FLASH_MS = 70;
var LABEL_OFFSET = 26;
var LABEL_LINE = 9;
var DOWN_OFFSET = 18;
var DOWN_UNDER_NAME = 36;
var DOWN_COLOR = "#ffd27a";
var REVIVE_FILL = 16765562;
var REVIVE_BAR_WIDTH = 32;
var REVIVE_BAR_HEIGHT = 3;
var REVIVE_BAR_BELOW = 11;
var REVIVE_TRACK = 328458;
var REVIVE_TRACK_ALPHA = 0.85;
var ShipView = class {
  root;
  scene;
  weapon;
  engine;
  flame;
  hull;
  shield;
  label;
  /** The weapon under the name, in its tier's color (#77). */
  partLabel;
  downLabel;
  reviveBar;
  /** The revive progress the bar shows, from 0 to 1. */
  revive = 0;
  layer;
  loadout;
  tint;
  thrusting = false;
  /** The state last drawn, so a drop flashes; undefined until the first. */
  damage;
  charges;
  constructor(scene, layer, x, y) {
    this.scene = scene;
    this.layer = layer;
    this.engine = scene.add.image(0, 0, keys.engine("base"));
    this.flame = scene.add.sprite(0, 0, keys.flameIdle("base"));
    this.hull = scene.add.image(0, 0, keys.hull("fullHealth"));
    this.weapon = scene.add.sprite(0, 0, keys.weapon("autoCannon"), 0);
    this.shield = scene.add.sprite(0, 0, keys.shield("front"));
    this.root = scene.add.container(x, y, [this.engine, this.flame, this.hull, this.weapon, this.shield]);
    layer.add(this.root);
  }
  /** Shows a name under the ship in the player's color (0xRRGGBB). */
  setLabel(scene, layer, name, color, resolution) {
    this.label?.destroy();
    this.label = scene.add.text(this.root.x, this.root.y + LABEL_OFFSET, name, {
      fontFamily: "monospace",
      fontSize: "8px",
      color: `#${color.toString(16).padStart(6, "0")}`,
      resolution
    }).setOrigin(0.5, 0).setShadow(1, 1, "#000000", 0);
    layer.add(this.label);
  }
  /** Shows a second line under the name, such as the weapon in its tier's color (#77, decision 11). */
  setLabelPart(text, color, resolution) {
    if (this.label === void 0 || this.partLabel?.text === text && this.partLabel.style.color === color) {
      return;
    }
    this.partLabel?.destroy();
    this.partLabel = this.scene.add.text(this.root.x, this.root.y + LABEL_OFFSET + LABEL_LINE, text, {
      fontFamily: "monospace",
      fontSize: "8px",
      color,
      resolution
    }).setOrigin(0.5, 0).setShadow(1, 1, "#000000", 0);
    this.layer.add(this.partLabel);
  }
  /** The weapon line under the name, for the E2E tests. */
  get labelPart() {
    return this.partLabel?.text;
  }
  /** Tints every part, for a companion in its owner's color (0xRRGGBB). */
  setTint(color) {
    this.tint = color;
    for (const part of [this.engine, this.flame, this.hull, this.weapon, this.shield]) {
      part.setTint(color).setTintMode(Phaser4.TintModes.MULTIPLY);
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
    for (const part of [this.weapon, this.engine, this.shield]) {
      this.restoreTint(part);
    }
  }
  /** A part's own tint: the owner's color for a companion, else its tier's (#77, decision 12). */
  restoreTint(part) {
    part.setTintMode(Phaser4.TintModes.MULTIPLY);
    const l = this.loadout;
    const tier = l === void 0 ? 0 : part === this.weapon ? l.weaponTier : part === this.engine ? l.engineTier : part === this.shield ? l.shieldTier : 0;
    const color = this.tint ?? tierColor(tier);
    if (color === void 0) {
      part.clearTint();
    } else {
      part.setTint(color);
    }
  }
  /** Draws the hull for the hits taken; a new hit flashes it. */
  setDamage(damage) {
    if (damage === this.damage) {
      return;
    }
    this.hull.setTexture(keys.hull(damageState(damage)));
    if (this.damage !== void 0 && damage > this.damage) {
      this.flash(this.hull);
    }
    this.damage = damage;
  }
  /** Draws the shield while it holds a whole charge; a lost charge flashes it. */
  setShield(charges) {
    const whole = Math.floor(charges);
    if (whole === this.charges) {
      return;
    }
    const lost = this.charges !== void 0 && whole < this.charges;
    this.charges = whole;
    if (lost) {
      this.flash(this.shield);
    } else {
      this.shield.setVisible(whole > 0);
    }
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
    this.partLabel?.setPosition(x, y + LABEL_OFFSET + LABEL_LINE);
    const down = y + (this.label === void 0 ? DOWN_OFFSET : DOWN_UNDER_NAME + (this.partLabel === void 0 ? 0 : LABEL_LINE));
    this.downLabel?.setPosition(x, down);
    this.reviveBar?.setPosition(x - REVIVE_BAR_WIDTH / 2, down + REVIVE_BAR_BELOW);
  }
  /**
   * Shows DOWN under a downed ship (#47), and under it a bar of its revive
   * progress once it has some (#66); gone when it's up.
   */
  setDown(down, revive, resolution) {
    if (!down) {
      this.downLabel?.destroy();
      this.downLabel = void 0;
      this.reviveBar?.destroy();
      this.reviveBar = void 0;
      this.revive = 0;
      return;
    }
    if (this.downLabel === void 0) {
      this.downLabel = this.scene.add.text(0, 0, "DOWN", { fontFamily: "monospace", fontSize: "8px", color: DOWN_COLOR, resolution }).setOrigin(0.5, 0).setShadow(1, 1, "#000000", 0);
      this.reviveBar = this.scene.add.graphics();
      this.layer.add([this.downLabel, this.reviveBar]);
      this.place(this.root.x, this.root.y, this.root.rotation - SPRITE_FACING);
    }
    const fill = Math.round(Math.min(Math.max(revive, 0), 1) * REVIVE_BAR_WIDTH) / REVIVE_BAR_WIDTH;
    if (fill !== this.revive) {
      this.revive = fill;
      this.drawReviveBar();
    }
  }
  drawReviveBar() {
    const bar = this.reviveBar?.clear();
    if (bar !== void 0 && this.revive > 0) {
      drawReviveBar(bar, this.revive);
    }
  }
  /** Whether DOWN is shown, and its text, for the E2E tests. */
  get downText() {
    return this.downLabel?.text;
  }
  /** The revive bar's fill while it's shown, for the E2E tests. */
  get reviveShown() {
    return this.downLabel === void 0 || this.revive <= 0 ? void 0 : this.revive;
  }
  /** Whether the shield is drawn, for the E2E tests. */
  get shieldShown() {
    return this.shield.visible;
  }
  /** A short white flash of a part; the shield then shows only while charged. */
  flash(part) {
    part.setVisible(true).setTint(16777215).setTintMode(Phaser4.TintModes.FILL);
    this.scene.time.delayedCall(HIT_FLASH_MS, () => {
      this.restoreTint(part);
      if (part === this.shield) {
        part.setVisible((this.charges ?? 0) > 0);
      }
    });
  }
  destroy() {
    this.root.destroy();
    this.label?.destroy();
    this.partLabel?.destroy();
    this.downLabel?.destroy();
    this.reviveBar?.destroy();
  }
};
function drawReviveBar(bar, fill) {
  bar.fillStyle(REVIVE_TRACK, REVIVE_TRACK_ALPHA).fillRect(-1, -1, REVIVE_BAR_WIDTH + 2, REVIVE_BAR_HEIGHT + 2).fillStyle(REVIVE_FILL, 1).fillRect(0, 0, REVIVE_BAR_WIDTH * fill, REVIVE_BAR_HEIGHT);
}

// src/scenes/enemyview.ts
var FLASH_MS = 70;
var EnemyView = class {
  kind;
  root;
  base;
  weapon;
  /** The shield bubble, for the kinds that have one (#89). */
  shield;
  scene;
  constructor(scene, parent, kind) {
    this.scene = scene;
    this.kind = kind;
    const engine = scene.add.sprite(0, 0, keys.enemyEngine(kind)).play(keys.enemyEngine(kind));
    this.base = scene.add.image(0, 0, keys.enemyBase(kind));
    this.weapon = scene.add.sprite(0, 0, keys.enemyWeapons(kind), 0);
    this.weapon.on(Phaser5.Animations.Events.ANIMATION_COMPLETE, () => {
      this.weapon.setFrame(0);
    });
    const parts = [engine, this.base, this.weapon];
    if (scene.textures.exists(keys.enemyShield(kind))) {
      this.shield = scene.add.sprite(0, 0, keys.enemyShield(kind)).play(keys.enemyShield(kind)).setVisible(false);
      parts.push(this.shield);
    }
    this.root = scene.add.container(0, 0, parts);
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
  /** Shows the shield bubble while the shield holds a charge. */
  setShield(up) {
    this.shield?.setVisible(up);
  }
  /** Whether the shield bubble shows, for the E2E tests. */
  get shieldShown() {
    return this.shield?.visible ?? false;
  }
  /** Plays the weapon animation: the telegraph before a volley leaves. */
  warn() {
    this.weapon.play(keys.enemyWeapons(this.kind));
  }
  /** A short white flash where a shot landed. */
  flash() {
    this.base.setTint(16777215).setTintMode(Phaser5.TintModes.FILL);
    this.scene.time.delayedCall(FLASH_MS, () => {
      this.base.clearTint().setTintMode(Phaser5.TintModes.MULTIPLY);
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
    boom.once(Phaser5.Animations.Events.ANIMATION_COMPLETE, () => {
      boom.destroy();
    });
    boom.play(keys.enemyDestruction(this.kind));
  }
};

// src/scenes/derelictview.ts
import Phaser6 from "./vendor/phaser.js";
var DERELICT_TINT = 9080729;
var DerelictView = class {
  hull;
  label;
  bar;
  fill = -1;
  constructor(scene, layer, x, y, angle, resolution) {
    this.hull = scene.add.image(x, y, keys.hull("veryDamaged")).setRotation(angle + SPRITE_FACING).setTint(DERELICT_TINT).setTintMode(Phaser6.TintModes.MULTIPLY);
    this.label = scene.add.text(x, y + DOWN_OFFSET, "", { fontFamily: "monospace", fontSize: "8px", color: DOWN_COLOR, resolution }).setOrigin(0.5, 0).setShadow(1, 1, "#000000", 0);
    this.bar = scene.add.graphics().setPosition(x - REVIVE_BAR_WIDTH / 2, y + DOWN_OFFSET + REVIVE_BAR_BELOW);
    layer.add([this.hull, this.label, this.bar]);
  }
  /** Shows the label and the rescue's progress (0 to 1); the bar shows once there is some. */
  update(label, rescue) {
    if (this.label.text !== label) {
      this.label.setText(label);
    }
    const fill = Math.round(Math.min(Math.max(rescue, 0), 1) * REVIVE_BAR_WIDTH) / REVIVE_BAR_WIDTH;
    if (fill === this.fill) {
      return;
    }
    this.fill = fill;
    this.bar.clear();
    if (fill > 0) {
      drawReviveBar(this.bar, fill);
    }
  }
  destroy() {
    this.hull.destroy();
    this.label.destroy();
    this.bar.destroy();
  }
};

// src/net/derelict.ts
function derelictLabel(goneTick, tick, tickRate) {
  const seconds = Math.max(0, Math.ceil((goneTick - tick) / tickRate));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `DERELICT ${String(m)}:${String(s).padStart(2, "0")}`;
}
function rescueNotice(name, hangar) {
  return `${name} rescued a ship \xB7 hangar ${String(hangar)}`;
}

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
  derelicts = /* @__PURE__ */ new Map();
  /** Whether a snapshot came since connecting, so derelicts already there aren't announced. */
  derelictsSeen = false;
  /** Derelicts this player, or their companions, rescued (#52). */
  rescues = 0;
  /** The cleared sectors, by name (#99). */
  clearedSectors = /* @__PURE__ */ new Set();
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
  /** Rams the local ship made or took. */
  rams = 0;
  bumpKeys = /* @__PURE__ */ new Map();
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
  /** The parts this player owns, at their tiers (#77); the server's word. */
  unlocks = defaultUnlocks();
  /** The player's name, for their own notices. */
  name = "";
  /** Whether the server is for development, where 1/2/3 fit any part (#78). */
  development = false;
  /** Pickups this ship reported flying over, until it leaves them. */
  collecting = /* @__PURE__ */ new Set();
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
          this.syncDerelicts([], 0);
          this.resetTimeline(this.tickRate);
          options.pickups.clear();
          this.collecting.clear();
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
          this.shotEnds.add(ended.tick, { owner: ended.playerId, shotId: ended.shotId, shard: ended.shard });
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
        pickupDropped: (dropped) => {
          const pickup = fromPickup(dropped);
          if (pickup !== void 0) {
            options.pickups.add(pickup, this.unlocks);
          }
        },
        sectorCleared: (cleared) => {
          this.sectorCleared(cleared);
        },
        derelictRescued: (rescued) => {
          const name = rescued.playerId === this.playerId ? this.name : this.remotes.get(rescued.playerId)?.name ?? "a squadmate";
          this.say(rescueNotice(name, rescued.hangar));
          if (rescued.playerId === this.playerId) {
            this.rescues++;
          }
        },
        pickupTaken: (taken) => {
          this.pickupTaken(taken);
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
      color: r.color,
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
  /** The player's squadron's mission (#101), undefined without one. */
  get mission() {
    const mission = this.squadronInfo?.mission;
    return mission === void 0 || mission === "" ? void 0 : mission;
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
  /** The derelicts waiting to be rescued, for the E2E tests (#52). */
  get derelictList() {
    return [...this.derelicts.entries()].map(([id, d]) => ({ id, x: d.state.x, y: d.state.y, rescue: d.state.rescue }));
  }
  /**
   * Draws the snapshot's derelicts and drops the ones no longer in it; a new
   * one after the first snapshot is announced.
   */
  syncDerelicts(states, tick) {
    const seen = /* @__PURE__ */ new Set();
    for (const state of states) {
      seen.add(state.derelictId);
      let drawn = this.derelicts.get(state.derelictId);
      if (drawn === void 0) {
        const { scene, ships } = this.options;
        drawn = { view: new DerelictView(scene, ships, state.x, state.y, state.angle, this.options.labelResolution()), state };
        this.derelicts.set(state.derelictId, drawn);
        if (this.derelictsSeen) {
          this.say("Derelict released: hover beside it to rescue it into the hangar");
        }
      }
      drawn.state = state;
      drawn.view.update(derelictLabel(state.goneTick, tick, this.tickRate), state.rescue);
    }
    for (const [id, drawn] of this.derelicts) {
      if (!seen.has(id)) {
        drawn.view.destroy();
        this.derelicts.delete(id);
      }
    }
    this.derelictsSeen = tick > 0;
  }
  /** The bosses as drawn, with their health (#89). */
  get bosses() {
    return [...this.enemies.values()].flatMap(
      (e) => e.health === void 0 ? [] : [{ kind: e.view.kind, x: e.view.x, y: e.view.y, ...e.health }]
    );
  }
  get enemyList() {
    return [...this.enemies.entries()].map(([id, e]) => ({ id, kind: e.view.kind, x: e.view.x, y: e.view.y }));
  }
  /**
   * Once a frame: send the local ship, draw the others and the enemies, spawn
   * their shots, and test hits. Returns where hits landed.
   */
  update(events) {
    const frame = { enemyHits: [], hitsOnMe: [], ownBursts: [] };
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
    this.options.pickups.update(serverTick, this.tickRate);
    this.collect();
    for (const remote of this.remotes.values()) {
      const ship = remote.buffer.sample(renderTick);
      remote.drawn = ship;
      if (ship === void 0) {
        continue;
      }
      if (ship.loadout.weapon !== remote.weapon) {
        remote.weapon = ship.loadout.weapon;
        remote.animator = new WeaponAnimator(weaponTiming(remote.weapon));
      }
      remote.view.setLoadout(ship.loadout);
      if (remote.ownerId === "") {
        remote.view.setLabelPart(
          partLabel(ship.loadout.weapon, ship.loadout.weaponTier),
          tierCss(ship.loadout.weaponTier),
          this.options.labelResolution()
        );
      }
      remote.view.setDamage(ship.damage);
      remote.view.setShield(ship.shield);
      remote.view.setDown(ship.damage >= MAX_DAMAGE, ship.revive, this.options.labelResolution());
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
    const { sim } = this.options;
    for (const { item: ended } of this.shotEnds.due(renderTick)) {
      const p = sim.projectiles.end(ended.owner, ended.shotId, ended.shard);
      if (p?.kind === "bigSpaceGun") {
        sim.burst(p.kind, "remote", p.x, p.y, p.shotId, ended.owner, p.slot);
      }
    }
    for (const e of events.expired) {
      if (e.faction === "remote" && e.kind === "bigSpaceGun") {
        sim.burst(e.kind, "remote", e.x, e.y, e.shotId, e.owner);
      }
    }
    this.drawEnemies(renderTick);
    const stepSeconds = events.ticks * TICK_SECONDS;
    sim.steer("own", stepSeconds, this.enemyTargets());
    sim.steer("remote", stepSeconds, this.enemyTargets());
    this.bump(frame);
    this.testHits(frame, stepSeconds);
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
      enemy.drawn = enemy.destroyedAt === void 0 ? pose : void 0;
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
  /** The enemies as drawn, as targets for hits and seeking shots. */
  enemyTargets() {
    return [...this.enemies.entries()].map(([id, e]) => ({ id, x: e.view.x, y: e.view.y, radius: ENEMY_RADIUS[e.view.kind] }));
  }
  /** How far the nearest squadmate, a player or companion of the same squadron, is; Infinity for none. */
  get squadmateDistance() {
    return this.nearestUp((r) => this.isSquadmate(r))?.distance ?? Infinity;
  }
  /** How far the nearest friendly ship that is up is, for revives; Infinity for none. */
  get friendDistance() {
    return this.nearestUp(() => true)?.distance ?? Infinity;
  }
  /** The nearest squadmate that is up, by its label, for a respawn beside them (#47). */
  nearestSquadmate() {
    return this.nearestUp((r) => this.isSquadmate(r));
  }
  isSquadmate(r) {
    return this.squadron !== "" && r.squadron === this.squadron;
  }
  /** The nearest other ship that is up and which picks, as drawn, and how far it is. */
  nearestUp(which) {
    const { ship } = this.options.sim;
    let best;
    for (const [id, r] of this.remotes) {
      const s = r.drawn;
      if (s === void 0 || s.damage >= MAX_DAMAGE || !which(r)) {
        continue;
      }
      const distance = Math.hypot(s.x - ship.x, s.y - ship.y);
      if (best === void 0 || distance < best.distance) {
        const name = r.ownerId === "" ? r.name : `${r.name} ${id.slice(r.ownerId.length + 1)}`;
        best = { x: s.x, y: s.y, name, distance };
      }
    }
    return best;
  }
  /**
   * The player's shots against enemies as drawn, reported to the server (the
   * design's trust model); enemy bullets against the local ship, which take
   * its shield or hull. Bullets that touch other ships end there, for the
   * picture only: the hub and their owners count that damage. Each projectile
   * is tested along the path it flew during the frame's stepSeconds, so low
   * frame rates don't skip hits.
   */
  testHits(frame, stepSeconds) {
    const targets = this.enemyTargets();
    const { sim } = this.options;
    const { ship } = sim;
    const ships = [];
    if (!sim.downed) {
      ships.push({ id: -1, x: ship.x, y: ship.y, angle: ship.angle, shield: ship.loadout.shield, charges: ship.shield });
    }
    for (const r of this.remotes.values()) {
      const s = r.drawn;
      if (s !== void 0 && s.damage < MAX_DAMAGE) {
        ships.push({ id: ships.length, x: s.x, y: s.y, angle: s.angle, shield: s.loadout.shield, charges: s.shield });
      }
    }
    for (const { projectile: p, target, goesOn } of sim.hitScan("own", stepSeconds, targets)) {
      const damage = p.kind === "shard" ? SHARD_DAMAGE : isWeapon(p.kind) ? WEAPON_STATS[p.kind].damage : 0;
      if (damage === 0) {
        continue;
      }
      this.lastHit = { id: target.id, atMs: now() };
      this.connection.sendHit(target.id, p.shotId, damage, p.shard, goesOn);
      this.enemies.get(target.id)?.view.flash();
      frame.enemyHits.push({ x: p.x, y: p.y });
      if (p.kind === "bigSpaceGun" && !goesOn) {
        sim.burst(p.kind, "own", p.x, p.y, p.shotId, this.playerId ?? "", p.slot);
        frame.ownBursts.push(p.kind);
      }
    }
    for (const { projectile: p, ship: target, from } of sim.shipScan(stepSeconds, ships)) {
      if (target.id === -1) {
        this.hitsTaken++;
        sim.takeHit(from);
        frame.hitsOnMe.push({ x: p.x, y: p.y });
      } else {
        frame.enemyHits.push({ x: p.x, y: p.y });
      }
    }
  }
  /**
   * Pushes the local ship out of every ship and enemy as drawn. A ram costs
   * it a shield charge or hull step, and a rammed enemy takes RAM_DAMAGE,
   * reported like a shot's hit with no shot. The others' clients and the hub
   * bump their own ships.
   */
  bump(frame) {
    const { sim } = this.options;
    if (sim.downed) {
      return;
    }
    const bodies = [];
    const rammed = [];
    for (const [id, remote] of this.remotes) {
      const s = remote.drawn;
      if (s !== void 0 && s.damage < MAX_DAMAGE) {
        const side = this.playerId !== void 0 && this.playerId < id ? 1 : -1;
        const gentle = remote.ownerId !== "" && remote.ownerId === this.playerId;
        bodies.push({ x: s.x, y: s.y, vx: s.vx, vy: s.vy, radius: SHIP_RADIUS, key: this.bumpKey(id), side, gentle });
        rammed.push(void 0);
      }
    }
    for (const [id, enemy] of this.enemies) {
      const e = enemy.drawn;
      if (e !== void 0) {
        const radius = ENEMY_RADIUS[enemy.view.kind];
        bodies.push({ x: e.x, y: e.y, vx: e.vx, vy: e.vy, radius, key: -id, side: 1 });
        rammed.push(id);
      }
    }
    for (const { index } of sim.bump(bodies)) {
      this.rams++;
      frame.hitsOnMe.push({ x: sim.ship.x, y: sim.ship.y });
      const enemyId = rammed[index];
      if (enemyId !== void 0) {
        this.connection.sendHit(enemyId, 0, RAM_DAMAGE);
        this.enemies.get(enemyId)?.view.flash();
      }
    }
  }
  /** A number naming another ship for the ram cooldown, the same for as long as the page runs. */
  bumpKey(name) {
    let key = this.bumpKeys.get(name);
    if (key === void 0) {
      key = this.bumpKeys.size + 1;
      this.bumpKeys.set(name, key);
    }
    return key;
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
    this.name = welcome.name;
    this.clearedSectors.clear();
    for (const sector of welcome.clearedSectors) {
      this.clearedSectors.add(sector);
    }
    this.unlocks = defaultUnlocks();
    for (const [part, tier] of fromUnlocks(welcome.unlocks)) {
      this.unlocks.set(part, tier);
    }
    this.refit();
    this.options.pickups.clear();
    this.collecting.clear();
    for (const dropped of welcome.pickups) {
      const pickup = fromPickup(dropped);
      if (pickup !== void 0) {
        this.options.pickups.add(pickup, this.unlocks);
      }
    }
    this.companionLimit = welcome.companionLimit;
    this.development = welcome.development;
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
      if (welcome.loadout !== void 0) {
        this.options.sim.setLoadout(withTiers(fromLoadout(welcome.loadout), this.unlocks));
      }
    }
  }
  /** Reports each pickup the ship flies over once, until it leaves it (#77). */
  collect() {
    const ship = this.options.sim.ship;
    const near = ship.damage >= MAX_DAMAGE ? [] : this.options.pickups.near(ship.x, ship.y, PICKUP_REACH);
    const ids = new Set(near.map((p) => p.id));
    for (const id of this.collecting) {
      if (!ids.has(id)) {
        this.collecting.delete(id);
      }
    }
    for (const id of ids) {
      if (!this.collecting.has(id)) {
        this.collecting.add(id);
        this.connection.sendCollect(id);
      }
    }
  }
  /** A sector is cleared; the part it gave this player is theirs now (#101). */
  sectorCleared(cleared) {
    this.clearedSectors.add(cleared.sector);
    let gained = "";
    for (const gain of cleared.gains) {
      const part = fromPart(gain.unlock?.part);
      if (gain.playerId !== this.playerId || part === void 0) {
        continue;
      }
      const tier = tierOf(gain.unlock?.tier);
      this.unlocks.set(part, tier);
      gained = ` \xB7 ${partLabel(part, tier)}`;
    }
    this.say(`Sector ${cleared.sector} cleared${gained}`);
    this.options.pickups.regrade(this.unlocks);
    this.refit();
  }
  /** A pickup is gone; the parts this player gained are theirs now. */
  pickupTaken(taken) {
    this.options.pickups.remove(taken.id);
    this.collecting.delete(taken.id);
    const collector = taken.playerId === this.playerId ? this.name : this.remotes.get(taken.playerId)?.name ?? "a squadmate";
    for (const gain of taken.gains) {
      const part = fromPart(gain.unlock?.part);
      if (gain.playerId !== this.playerId || part === void 0) {
        continue;
      }
      const tier = tierOf(gain.unlock?.tier);
      this.unlocks.set(part, tier);
      this.say(`${collector}: ${partLabel(part, tier)}`);
    }
    this.options.pickups.regrade(this.unlocks);
    this.refit();
  }
  /** Fits the ship's parts at the tiers this player owns them at. */
  refit() {
    const sim = this.options.sim;
    const loadout = withTiers(sim.ship.loadout, this.unlocks);
    const l = sim.ship.loadout;
    if (loadout.weaponTier !== l.weaponTier || loadout.engineTier !== l.engineTier || loadout.shieldTier !== l.shieldTier) {
      sim.setLoadout(loadout);
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
      const remote = this.remotes.get(player.playerId) ?? this.add(player.playerId, player.name, player.color, player.ownerId, player.squadron);
      if (player.ownerId === "" && remote.squadron !== player.squadron) {
        remote.squadron = player.squadron;
        remote.view.setLabel(
          this.options.scene,
          this.options.ships,
          playerLabel(player.name, player.squadron),
          player.color,
          this.options.labelResolution()
        );
      }
      remote.buffer.push(snapshot.tick, fromShipState(player.state));
    }
    this.syncDerelicts(snapshot.derelicts, snapshot.tick);
    for (const state of snapshot.enemies) {
      let enemy = this.enemies.get(state.enemyId);
      if (enemy === void 0) {
        enemy = {
          view: new EnemyView(this.options.scene, this.options.ships, fromEnemyKind(state.kind)),
          buffer: new StateBuffer(),
          drawn: void 0,
          lastSeen: snapshot.tick,
          destroyedAt: void 0,
          health: void 0
        };
        this.enemies.set(state.enemyId, enemy);
      }
      enemy.lastSeen = snapshot.tick;
      if (state.maxHp > 0) {
        enemy.health = { hp: state.hp, maxHp: state.maxHp, shield: state.shield, scaledFor: state.scaledFor };
        enemy.view.setShield(state.shield > 0);
      }
      enemy.buffer.push(snapshot.tick, { x: state.x, y: state.y, angle: state.angle, vx: state.vx, vy: state.vy });
    }
  }
  /** A remote ship: another player, or (with an owner) one of their companions. */
  add(id, name, color, ownerId, squadron) {
    const { scene, ships } = this.options;
    const view = new ShipView(scene, ships, 0, 0);
    const label = ownerId === "" ? playerLabel(name, squadron) : `${name} ${id.slice(ownerId.length + 1)}`;
    if (ownerId !== "") {
      view.setTint(color);
    }
    view.setLabel(scene, ships, label, color, this.options.labelResolution());
    const remote = {
      view,
      buffer: new StateBuffer(),
      animator: new WeaponAnimator(weaponTiming("autoCannon")),
      weapon: "autoCannon",
      name,
      color,
      ownerId,
      squadron,
      drawn: void 0
    };
    this.remotes.set(id, remote);
    return remote;
  }
  remove(id) {
    this.remotes.get(id)?.view.destroy();
    this.remotes.delete(id);
  }
};
function fromPickup(dropped) {
  const part = fromPart(dropped.part);
  return part === void 0 ? void 0 : { id: dropped.id, part, x: dropped.x, y: dropped.y, tick: dropped.tick, goneTick: dropped.goneTick };
}

// src/scenes/pickups.ts
import "./vendor/phaser.js";
var PickupsView = class {
  scene;
  layer;
  drawn = /* @__PURE__ */ new Map();
  constructor(scene, layer) {
    this.scene = scene;
    this.layer = layer;
  }
  /** Puts a pickup down, drawn for this player's unlocks. */
  add(pickup, unlocks) {
    this.remove(pickup.id);
    const sprite = this.scene.add.sprite(pickup.x, pickup.y, keys.pickup(pickup.part), 0);
    this.layer.add(sprite);
    const drawn = { pickup, sprite, blinking: false };
    this.drawn.set(pickup.id, drawn);
    this.grade(drawn, unlocks);
  }
  remove(id) {
    this.drawn.get(id)?.sprite.destroy();
    this.drawn.delete(id);
  }
  clear() {
    for (const id of [...this.drawn.keys()]) {
      this.remove(id);
    }
  }
  /** Redraws every pickup's glow, after this player's unlocks changed. */
  regrade(unlocks) {
    for (const drawn of this.drawn.values()) {
      this.grade(drawn, unlocks);
    }
  }
  /** Blinks the pickups near their end and removes the ones whose time is up, at the server tick. */
  update(tick, tickRate) {
    for (const [id, d] of this.drawn) {
      if (tick >= d.pickup.goneTick) {
        this.remove(id);
      } else if (!d.blinking && tick >= d.pickup.tick + PICKUP_BLINK_AFTER * tickRate) {
        d.blinking = true;
        d.sprite.play(keys.pickup(d.pickup.part));
      }
    }
  }
  /** The pickups within reach of (x, y). */
  near(x, y, reach) {
    return [...this.drawn.values()].map((d) => d.pickup).filter((p) => Math.hypot(p.x - x, p.y - y) <= reach);
  }
  /** The pickups on the ground, for the E2E tests. */
  get items() {
    return [...this.drawn.values()].map((d) => d.pickup);
  }
  grade(drawn, unlocks) {
    const { sprite } = drawn;
    const tier = tierFromPickup(unlocks, drawn.pickup.part);
    sprite.setAlpha(tier === void 0 ? PICKUP_USELESS_ALPHA : 1);
    sprite.filters?.internal.clear();
    const color = tier === void 0 ? void 0 : tierColor(tier);
    if (color === void 0) {
      return;
    }
    sprite.enableFilters();
    sprite.filters?.internal.addGlow(color, PICKUP_GLOW_STRENGTH, 0, 1, false, PICKUP_GLOW_QUALITY, PICKUP_GLOW_DISTANCE);
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
var SHARD_TINT = 16765562;
var HUD_FONT_PX = 12;
var HUD_MARGIN_PX = 8;
var DOWN_PANEL_FONT_PX = 14;
var DOWN_PANEL_PADDING_X = 12;
var DOWN_PANEL_PADDING_Y = 8;
var DOWN_PANEL_Y = 0.8;
var ORDER_HOLD_MS = 200;
var ORDER_RING_PX = 88;
var ORDER_DEAD_ZONE_PX = 24;
var ORDER_COLORS = { mode: 9427199, oneShot: 16769162 };
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
var hex = (color) => `#${color.toString(16).padStart(6, "0")}`;
function destroyRing(press) {
  for (const object of [...press.labels ?? [], ...press.extras]) {
    object.destroy();
  }
  press.backdrop?.destroy();
}
var SandboxScene = class extends Phaser8.Scene {
  sim = sandbox();
  world;
  backgrounds = [];
  backgroundFrame = 0;
  ships;
  pickups;
  partsLine = [];
  /** The own ship's loadout as last drawn, so any change redraws it. */
  shownLoadout = "";
  ship;
  net;
  /** The loadout screen at the home planet (#78). */
  loadoutScreen = new LoadoutScreen();
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
  bossBar;
  missionArrow;
  missionLabel;
  downPanel;
  /** Whether the ship was down last frame and was respawned since, to count revives. */
  wasDown = false;
  respawned = false;
  revives = 0;
  moveKeys;
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
    const pickupLayer = this.add.layer();
    this.world.add(pickupLayer);
    this.pickups = new PickupsView(this, pickupLayer);
    this.ships = this.add.container(0, 0);
    this.world.add(this.ships);
    this.ship = new ShipView(this, this.ships, this.sim.ship.x, this.sim.ship.y);
    this.createProjectiles();
    this.createParticles();
    this.createCameras();
    this.createInput();
    this.applyLoadout();
    this.resize();
    this.scale.on(Phaser8.Scale.Events.RESIZE, () => {
      this.resize();
    });
    this.startNetPlay();
    this.debug = {
      ready: true,
      scene: this.scene.key,
      ship: { x: 0, y: 0, angle: 0, thrusting: false },
      loadout: this.sim.ship.loadout,
      damage: "fullHealth",
      shield: 0,
      shieldShown: false,
      rotationSnap: 0,
      controlMode: this.sim.controlMode,
      effects: this.effects,
      projectiles: 0,
      ownShards: 0,
      shakes: 0,
      unlocks: {},
      pickups: [],
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
      rams: 0,
      downed: false,
      revive: 0,
      canRespawn: false,
      downLabel: void 0,
      reviveBar: void 0,
      revives: 0,
      downPanel: void 0,
      companions: [],
      companionKills: 0,
      notice: void 0,
      orderMenuOpen: false,
      squadron: "",
      squadronScreen: false,
      loadoutScreen: false,
      boss: void 0,
      sector: "",
      mission: void 0,
      derelicts: [],
      rescues: 0,
      hangar: void 0,
      squadronMode: void 0
    };
    this.publish();
  }
  update(time, deltaMs) {
    const events = this.sim.advance(deltaMs / 1e3, this.readInput(), this.net?.squadmateDistance, this.net?.friendDistance);
    this.burstExpired(events);
    const net = this.net?.update(events);
    if (loadoutKey(this.sim.ship.loadout) !== this.shownLoadout) {
      this.applyLoadout();
    }
    this.updateLoadoutScreen();
    this.drawShip(events);
    this.countRevive();
    this.updateDownPanel();
    if (net !== void 0) {
      this.showHits(net);
    }
    this.drawProjectiles();
    this.updateOrderMenu(time);
    this.playEffects(events);
    this.audio.update(this.sim.ship, events);
    this.scrollBackgrounds(time);
    this.bossBar.show(bossBar(this.net?.bosses ?? [], this.sim.ship.x, this.sim.ship.y));
    this.drawMissionArrow();
    if (time - this.hudUpdatedAt > HUD_REFRESH_MS) {
      this.hudUpdatedAt = time;
      this.updateHud();
    }
    this.publish();
  }
  /** The arrow at the screen's edge toward the squadron's mission while it's elsewhere (#101). */
  drawMissionArrow() {
    const g = this.missionArrow.clear();
    const mission = this.net?.mission;
    const { width, height } = this.scale;
    const dpr = this.dpr();
    const at2 = mission === void 0 ? void 0 : missionArrow(this.sim.ship, mission, width, height, MISSION_ARROW_MARGIN_PX * dpr);
    this.missionLabel.setVisible(at2 !== void 0);
    if (at2 === void 0 || mission === void 0) {
      return;
    }
    const size = MISSION_ARROW_SIZE_PX * dpr;
    const tip = { x: at2.x + Math.cos(at2.angle) * size, y: at2.y + Math.sin(at2.angle) * size };
    const side = (turn) => ({ x: at2.x + Math.cos(at2.angle + turn) * size * 0.6, y: at2.y + Math.sin(at2.angle + turn) * size * 0.6 });
    const left = side(Math.PI / 2);
    const right = side(-Math.PI / 2);
    g.fillStyle(MISSION_COLOR, 1).fillTriangle(tip.x, tip.y, left.x, left.y, right.x, right.y);
    this.missionLabel.setText(mission).setFontSize(HUD_FONT_PX * dpr).setPosition(at2.x - Math.cos(at2.angle) * size * 1.6, at2.y - Math.sin(at2.angle) * size * 1.6);
  }
  createBackgrounds() {
    this.backgrounds = keys.background.map((key, i) => {
      const sprite = this.add.tileSprite(0, 0, VIEW_WIDTH, VIEW_HEIGHT, key, 0).setScrollFactor(0);
      this.world.add(sprite);
      return { sprite, factor: PARALLAX[i] ?? 0 };
    });
  }
  createScenery() {
    const lines = this.add.graphics().lineStyle(1, SECTOR_LINE_COLOR, SECTOR_LINE_ALPHA);
    for (const at2 of sectorEdges()) {
      lines.lineBetween(at2, -WORLD_HALF_SIZE, at2, WORLD_HALF_SIZE).lineBetween(-WORLD_HALF_SIZE, at2, WORLD_HALF_SIZE, at2);
    }
    this.world.add(lines);
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
      squadronScreen: new SquadronScreen(),
      pickups: this.pickups
    });
    this.net.start();
    this.events.once(Phaser8.Scenes.Events.SHUTDOWN, () => this.net?.stop());
    const background = new BackgroundTicker(
      (deltaMs) => {
        this.stepHidden(deltaMs);
      },
      document,
      workerTimer(),
      () => performance.now()
    );
    background.start();
    this.events.once(Phaser8.Scenes.Events.SHUTDOWN, () => {
      background.stop();
    });
  }
  /**
   * One step while the tab is hidden: the ship coasts with nothing held, its
   * state goes to the server, and nothing is drawn. The ship stays in the
   * world, exposed (#57).
   */
  stepHidden(deltaMs) {
    const { pointerX, pointerY } = this.readInput();
    const idle = { up: false, down: false, left: false, right: false, pointerX, pointerY, fire: false };
    const events = this.sim.advance(deltaMs / 1e3, idle, this.net?.squadmateDistance, this.net?.friendDistance);
    this.burstExpired(events);
    this.net?.update(events);
    this.publish();
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
      ENEMY_FIRE_GLOW_COLOR,
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
      blendMode: Phaser8.BlendModes.ADD,
      emitting: false
    });
    this.puff = this.add.particles(0, 0, keys.projectile("bigSpaceGun"), {
      frame: [6, 7, 8],
      lifespan: 260,
      speed: { min: 15, max: 60 },
      scale: { start: 0.4, end: 0 },
      alpha: { start: 0.8, end: 0 },
      blendMode: Phaser8.BlendModes.ADD,
      emitting: false
    });
    this.world.add([this.muzzleFlash, this.puff]);
  }
  createCameras() {
    const main = this.cameras.main;
    main.setBackgroundColor("#05030a");
    main.startFollow(this.ship.root, true, CAMERA_LERP, CAMERA_LERP);
    main.setRoundPixels(true);
    const bloom = Phaser8.Actions.AddEffectBloom(main, { threshold: 0.55, blurRadius: BLOOM_BLUR, blendAmount: 0.6 })[0];
    this.bloom = bloom?.parallelFilters;
    this.bloomBlur = bloom?.blur;
    this.vignette = main.filters.external.addVignette(0.5, 0.5, 0.9, 0.35);
    this.hud = this.add.text(8, 8, "", { fontFamily: "monospace", fontSize: "12px", color: "#d8f8ff" }).setOrigin(0, 1).setShadow(1, 1, "#000000", 0);
    main.ignore(this.hud);
    this.partsLine = Array.from({ length: 4 }, () => {
      const text = this.add.text(0, 0, "", { fontFamily: "monospace", fontSize: "12px", color: "#d8f8ff" }).setShadow(1, 1, "#000000", 0);
      main.ignore(text);
      return text;
    });
    this.downPanel = this.add.text(0, 0, "", {
      fontFamily: "monospace",
      fontSize: `${String(DOWN_PANEL_FONT_PX)}px`,
      color: "#d8f8ff",
      align: "center",
      backgroundColor: "#05030acc"
    }).setOrigin(0.5, 0).setShadow(1, 1, "#000000", 0).setVisible(false);
    main.ignore(this.downPanel);
    this.bossBar = new BossBarView(this, (object) => main.ignore(object));
    this.missionArrow = this.add.graphics();
    this.missionLabel = this.add.text(0, 0, "", { fontFamily: "monospace", fontSize: "12px", color: MISSION_CSS }).setOrigin(0.5).setShadow(1, 1, "#000000", 0);
    main.ignore([this.missionArrow, this.missionLabel]);
    this.hudCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.hudCamera.ignore(this.world);
  }
  createInput() {
    const keyboard = this.input.keyboard;
    if (keyboard === null) {
      throw new Error("keyboard input is disabled");
    }
    const codes = Phaser8.Input.Keyboard.KeyCodes;
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
      if (this.loadoutScreen.open) {
        this.loadoutKey(event);
      } else if (event.code === "KeyL") {
        this.openLoadout();
      } else if (event.code === "KeyQ") {
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
    this.events.once(Phaser8.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    });
  }
  /** Opens the loadout screen, only at the home planet and with the ship up (#78, decisions 2 and 4). */
  openLoadout() {
    const ship = this.sim.ship;
    const squadronScreen = document.querySelector("#squadron-form");
    const busy = this.orderPress !== void 0 || squadronScreen?.hidden === false;
    if (busy || this.sim.downed || Math.hypot(ship.x, ship.y) > SAFE_ZONE_RADIUS) {
      return;
    }
    this.loadoutScreen.show({
      fit: (loadout) => {
        this.fit(loadout);
        this.applyLoadout();
        this.audio.partSwitched();
      },
      summon: () => this.net?.summon()
    });
    this.updateLoadoutScreen();
  }
  /** A key while the loadout screen is open: L and Esc close it, and the rest are its own. */
  loadoutKey(event) {
    if (event.code === "KeyL" || event.code === "Escape") {
      this.loadoutScreen.hide();
    } else if (event.code === "KeyG") {
      this.net?.summon();
    } else if (this.loadoutScreen.key(event.code)) {
      event.preventDefault();
    }
  }
  /** Keeps the open screen current, and closes it once the ship is away from home or down. */
  updateLoadoutScreen() {
    if (!this.loadoutScreen.open) {
      return;
    }
    const ship = this.sim.ship;
    if (this.sim.downed || Math.hypot(ship.x, ship.y) > SAFE_ZONE_RADIUS) {
      this.loadoutScreen.hide();
      return;
    }
    const net = this.net;
    const hangar = net === void 0 ? "Hangar: offline" : hangarLine(net.hangar, true) ?? "Hangar: \u2026";
    const out = net === void 0 ? "" : ` \xB7 ${String(net.companionCount)} of ${String(net.companionLimit)} companions out`;
    this.loadoutScreen.update(
      this.net?.unlocks ?? defaultUnlocks(),
      ship.loadout,
      `${hangar}${out} \xB7 they pick from your parts, spread across the squadron`
    );
  }
  /** The 1/2/3 keys fit any part in development and offline; elsewhere the loadout screen does (#78). */
  get partKeys() {
    return this.net?.status !== "online" || this.net.development;
  }
  handleDebugKey(code) {
    const ship = this.sim.ship;
    if (!this.partKeys && (code === "Digit1" || code === "Digit2" || code === "Digit3")) {
      return;
    }
    switch (code) {
      case "Digit1":
        this.fit({ ...ship.loadout, weapon: nextInCycle(WEAPONS, ship.loadout.weapon) });
        this.applyLoadout();
        this.audio.partSwitched();
        break;
      case "Digit2":
        this.fit({ ...ship.loadout, engine: nextInCycle(ENGINES, ship.loadout.engine) });
        this.applyLoadout();
        this.audio.partSwitched();
        break;
      case "Digit3":
        this.fit({ ...ship.loadout, shield: nextInCycle(SHIELDS, ship.loadout.shield) });
        this.applyLoadout();
        this.audio.shieldSwitched();
        break;
      case "KeyH":
        this.respawn(false);
        break;
      case "KeyJ":
        this.respawn(true);
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
      label.setColor(i === picked || item === void 0 ? ORDER_PICKED_TEXT : hex(ORDER_COLORS[item.kind]));
      label.setScale(i === picked ? 1.15 : 1);
    });
  }
  /** Lays out the ring: a label and its pack icon per order, and the wing's mode in the center. */
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
      const label = this.add.text(x, y, `${inForce ? "\u2022 " : ""}${item.label}`, { ...style, color: hex(ORDER_COLORS[item.kind]) }).setOrigin(0.5).setShadow(1, 1, "#000000", 0);
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
    const center = this.add.text(
      press.screenX,
      press.screenY,
      count === 0 || info === void 0 ? "no companions" : `wing (${String(count)})
${modeName(info)}`,
      { ...style, color: "#ffffff", align: "center" }
    ).setOrigin(0.5).setShadow(1, 1, "#000000", 0);
    this.cameras.main.ignore(center);
    press.extras.push(center);
    return labels;
  }
  /** The ring's backdrop, with the wedge of the item pointed at lit in its color. */
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
    g.lineStyle(dpr, ORDER_COLORS.mode, 0.35).strokeEllipse(cx, cy, rx * 2, ry * 2);
    const item = picked === void 0 ? void 0 : ORDER_ITEMS[picked];
    if (picked === void 0 || item === void 0) {
      return;
    }
    const n = ORDER_ITEMS.length;
    const mid = -Math.PI / 2 + picked * Math.PI * 2 / n;
    const points = [new Phaser8.Math.Vector2(cx, cy)];
    const steps = 8;
    for (let k = 0; k <= steps; k++) {
      const a = mid - Math.PI / n + k * 2 * Math.PI / n / steps;
      points.push(new Phaser8.Math.Vector2(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry));
    }
    g.fillStyle(ORDER_COLORS[item.kind], 0.22).fillPoints(points, true);
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
  /** Fits a loadout, each part at the tier this player owns it at. */
  fit(loadout) {
    this.sim.setLoadout(withTiers(loadout, this.net?.unlocks ?? /* @__PURE__ */ new Map()));
  }
  applyLoadout() {
    const { weapon, engine } = this.sim.ship.loadout;
    this.shownLoadout = loadoutKey(this.sim.ship.loadout);
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
    this.hud.setFontSize(HUD_FONT_PX * dpr);
    this.layoutHud();
    this.bossBar.resize(width, dpr);
    this.downPanel.setFontSize(DOWN_PANEL_FONT_PX * dpr).setPadding(DOWN_PANEL_PADDING_X * dpr, DOWN_PANEL_PADDING_Y * dpr).setPosition(width / 2, height * DOWN_PANEL_Y);
    for (const { sprite } of this.backgrounds) {
      sprite.setPosition(width / 2, height / 2).setSize(Math.ceil(width / zoom), Math.ceil(height / zoom));
    }
  }
  readInput() {
    const pointer = this.input.activePointer;
    const aim = pointer.positionToCamera(this.cameras.main);
    if (this.loadoutScreen.open) {
      const { x, y, angle } = this.sim.ship;
      return {
        up: false,
        down: false,
        left: false,
        right: false,
        pointerX: x + Math.cos(angle),
        pointerY: y + Math.sin(angle),
        fire: false
      };
    }
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
    this.ship.setDamage(ship.damage);
    this.ship.setShield(ship.shield);
    this.ship.setDown(this.sim.downed, ship.revive, this.cameras.main.zoom);
    this.animateWeapon(events);
  }
  /** While the ship is down: how to get back, respawning once it may (#47). */
  updateDownPanel() {
    if (!this.sim.downed) {
      this.downPanel.setVisible(false);
      return;
    }
    const beside = this.net?.nearestSquadmate();
    const choices = this.sim.canRespawn ? `[H] respawn at home${beside === void 0 ? "" : `      [J] respawn beside ${beside.name}`}` : `respawn in ${String(Math.ceil(RESPAWN_DELAY - this.sim.ship.downFor))} s`;
    const text = ["You're down", "", choices, "or stay: a friend close by revives you"].join("\n");
    if (this.downPanel.text !== text) {
      this.downPanel.setText(text);
    }
    this.downPanel.setVisible(true);
  }
  /** Respawns at home, or beside the nearest squadmate that is up, once the ship may. */
  respawn(beside) {
    if (!beside) {
      this.respawned = this.sim.respawn(0, HOME_SPAWN_Y) || this.respawned;
      return;
    }
    const mate = this.net?.nearestSquadmate();
    if (mate !== void 0) {
      this.respawned = this.sim.respawn(mate.x + BRAIN_SPACING, mate.y) || this.respawned;
    }
  }
  /** Counts the ship coming back up without a respawn: a friend revived it. */
  countRevive() {
    const down = this.sim.downed;
    if (this.wasDown && !down && !this.respawned) {
      this.revives++;
    }
    this.wasDown = down;
    this.respawned = false;
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
  /** Our own big space gun balls that ran out burst into their star, as on every screen (#72). */
  burstExpired(events) {
    for (const e of events.expired) {
      if (e.faction === "own" && e.kind === "bigSpaceGun") {
        this.sim.burst(e.kind, "own", e.x, e.y, e.shotId, this.net?.playerId ?? "");
      }
    }
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
      if (p.kind === "shard") {
        sprite.play(keys.projectile("autoCannon"), true).setTint(SHARD_TINT);
      } else {
        sprite.play(isWeapon(p.kind) ? keys.projectile(p.kind) : keys.enemyBullet(p.kind), true).clearTint();
      }
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
    }
    for (const p of events.expired) {
      this.puff.explode(4, p.x, p.y);
      if (p.faction === "own" && isWeapon(p.kind)) {
        this.shakeFor(p.kind);
      }
    }
  }
  /** Our own shot bursting shakes the camera, if its weapon does. */
  shakeFor(weapon) {
    const shake = WEAPON_STATS[weapon].shake;
    if (this.effects && shake > 0) {
      this.cameras.main.shake(120, shake);
      this.debug.shakes++;
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
    for (const weapon of net.ownBursts) {
      this.shakeFor(weapon);
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
    const { loadout, rotationSnap, damage, shield } = this.sim.ship;
    this.hud.setText([
      `weapon ${loadout.weapon}  engine ${loadout.engine}  shield ${loadout.shield} ${Math.floor(shield)}/${SHIELD_STATS[loadout.shield].strength}  hull ${damageState(damage)}`,
      `controls ${this.sim.controlMode === "ship" ? "ship-relative" : "screen-relative"}  rotation ${rotationSnap === 0 ? "free" : `${rotationSnap} directions`}  effects ${this.effects ? "on" : "off"}  sound ${this.audioSettings.muted ? "off" : "on"}  music ${this.audioSettings.music ? "on" : "off"}  ${Math.round(this.game.loop.actualFps)} fps`,
      "WASD move \xB7 mouse aim \xB7 hold left button to fire \xB7 H/J respawn when down \xB7 G companion \xB7 L loadout at home",
      "hold Q orders, tap to repeat \xB7 C controls \xB7 M sound \xB7 N music \xB7 1/2/3 parts \xB7 R rotation \xB7 F effects",
      sectorLine(this.sim.ship.x, this.sim.ship.y, this.net?.status === "online" ? this.net.clearedSectors : void 0),
      this.net?.mission === void 0 ? "" : `Mission: ${this.net.mission}`,
      this.netStatus(),
      this.squadronStatus()
    ]);
    this.layoutHud();
  }
  /**
   * The HUD at the bottom left (#89): its lines, then the fitted parts under
   * them, each named in its tier's color (#77, decision 12).
   */
  layoutHud() {
    const dpr = this.dpr();
    const lineHeight = this.hud.height / Math.max(1, this.hud.text.split("\n").length);
    const y = this.scale.height - HUD_MARGIN_PX * dpr - lineHeight;
    this.hud.setPosition(HUD_MARGIN_PX * dpr, y);
    const l = this.sim.ship.loadout;
    const words = [
      ["parts", tierCss(0)],
      [partLabel(l.weapon, l.weaponTier), tierCss(l.weaponTier)],
      [partLabel(l.engine, l.engineTier), tierCss(l.engineTier)],
      [partLabel(l.shield, l.shieldTier), tierCss(l.shieldTier)]
    ];
    let x = this.hud.x;
    const gap = Number.parseFloat(String(this.hud.style.fontSize));
    this.partsLine.forEach((text, i) => {
      const [word, color] = words[i] ?? ["", tierCss(0)];
      text.setFontSize(this.hud.style.fontSize).setColor(color).setText(word).setPosition(x, y);
      x += text.width + gap;
    });
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
    this.debug.damage = damageState(ship.damage);
    this.debug.shield = ship.shield;
    this.debug.shieldShown = this.ship.shieldShown;
    this.debug.rotationSnap = ship.rotationSnap;
    this.debug.controlMode = this.sim.controlMode;
    this.debug.effects = this.effects;
    this.debug.enemyFireGlow = this.enemyFireGlow?.active ?? false;
    this.debug.projectiles = projectiles.activeCount;
    this.debug.unlocks = Object.fromEntries(this.net?.unlocks ?? []);
    this.debug.pickups = this.pickups.items.map(({ id, part, x, y }) => ({ id, part, x, y }));
    this.debug.ownShards = projectiles.items.filter((p) => p.active && p.faction === "own" && p.kind === "shard").length;
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
    this.debug.rams = this.net?.rams ?? 0;
    this.debug.downed = this.sim.downed;
    this.debug.revive = ship.revive;
    this.debug.canRespawn = this.sim.canRespawn;
    this.debug.downLabel = this.ship.downText;
    this.debug.reviveBar = this.ship.reviveShown;
    this.debug.revives = this.revives;
    this.debug.downPanel = this.downPanel.visible ? this.downPanel.text : void 0;
    this.debug.companions = (this.net?.others ?? []).filter((o) => o.ownerId !== "" && o.ownerId === this.net?.playerId).map((o) => ({ number: Number(o.id.slice(o.ownerId.length + 1)), x: o.x, y: o.y }));
    this.debug.squadronMode = this.net?.squadronInfo === void 0 ? void 0 : modeName(this.net.squadronInfo);
    this.debug.companionKills = this.net?.companionKills ?? 0;
    this.debug.notice = this.net?.noticeText;
    this.debug.orderMenuOpen = this.orderPress?.labels !== void 0;
    this.debug.squadron = this.net?.squadron ?? "";
    this.debug.hangar = this.net?.hangar;
    this.debug.squadronScreen = !(document.querySelector("#squadron-form")?.hidden ?? true);
    this.debug.loadoutScreen = this.loadoutScreen.open;
    this.debug.boss = this.bossBar.current;
    this.debug.mission = this.net?.mission;
    this.debug.sector = sectorLine(this.sim.ship.x, this.sim.ship.y, this.net?.status === "online" ? this.net.clearedSectors : void 0);
    this.debug.derelicts = this.net?.derelictList ?? [];
    this.debug.rescues = this.net?.rescues ?? 0;
    publishDebugState(this.debug);
  }
};
var loadoutKey = (l) => `${l.weapon}:${l.engine}:${l.shield}:${String(l.weaponTier)}${String(l.engineTier)}${String(l.shieldTier)}`;

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
  const game = new Phaser9.Game({
    type: Phaser9.AUTO,
    parent: "game",
    backgroundColor: "#05030a",
    pixelArt: true,
    roundPixels: true,
    banner: false,
    // Sized in device pixels and shown at CSS size, so pixel art stays even
    // at any display scaling (see display.ts).
    scale: {
      mode: Phaser9.Scale.NONE,
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
