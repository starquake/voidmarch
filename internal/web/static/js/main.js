// src/main.ts
import Phaser12 from "./vendor/phaser.js";

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
function renderRatio(devicePixelRatio, cssPixels) {
  return cssPixels ? 1 : devicePixelRatio;
}
function blankSamples(width, height) {
  const out = [];
  for (const fx of [0.3, 0.5, 0.7]) {
    for (const fy of [0.3, 0.5, 0.7]) {
      out.push({ x: Math.floor(width * fx), y: Math.floor(height * fy) });
    }
  }
  return out;
}
function allBlack(samples) {
  return samples.length > 0 && samples.every((p) => p[0] === 0 && p[1] === 0 && p[2] === 0);
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

// src/glow.ts
var CHANNELS = 4;
var MAX = 255;
function double(src) {
  const width = src.width * 2;
  const height = src.height * 2;
  const data = new Uint8ClampedArray(width * height * CHANNELS);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (Math.floor(y / 2) * src.width + Math.floor(x / 2)) * CHANNELS;
      data.set(src.data.subarray(from, from + CHANNELS), (y * width + x) * CHANNELS);
    }
  }
  return { width, height, data };
}
function alphaAt(src, x, y) {
  const x0 = Math.floor(x - 0.5);
  const y0 = Math.floor(y - 0.5);
  const fx = x - 0.5 - x0;
  const fy = y - 0.5 - y0;
  const at2 = (px, py) => px < 0 || py < 0 || px >= src.width || py >= src.height ? 0 : (src.data[(py * src.width + px) * CHANNELS + 3] ?? 0) / MAX;
  return at2(x0, y0) * (1 - fx) * (1 - fy) + at2(x0 + 1, y0) * fx * (1 - fy) + at2(x0, y0 + 1) * (1 - fx) * fy + at2(x0 + 1, y0 + 1) * fx * fy;
}
function jitter(ring2, u, v) {
  const s = Math.sin(ring2 * 12.9898 + (u + v) * 78.233) * 43758.5453;
  return s - Math.floor(s);
}
function bakeGlow(src, glow) {
  const pad = glow.distance;
  const width = src.width + 2 * pad;
  const height = src.height + 2 * pad;
  const data = new Uint8ClampedArray(width * height * CHANNELS);
  const maxAlpha = glow.distance * (glow.distance + 1) * glow.quality / 2;
  const red2 = (glow.color >> 16 & MAX) / MAX;
  const green = (glow.color >> 8 & MAX) / MAX;
  const blue2 = (glow.color & MAX) / MAX;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = x - pad + 0.5;
      const sy = y - pad + 0.5;
      let total = 0;
      let angle = 0;
      for (let ring2 = 0; ring2 < glow.distance; ring2++) {
        angle += jitter(ring2, x / width, y / height);
        for (let i = 0; i < glow.quality; i++) {
          angle += Math.PI * 2 / glow.quality;
          total += (glow.distance - ring2) * alphaAt(src, sx + Math.cos(angle) * (ring2 + 1), sy + Math.sin(angle) * (ring2 + 1));
        }
      }
      const inside = sx > 0 && sy > 0 && sx < src.width && sy < src.height;
      const from = (Math.floor(sy) * src.width + Math.floor(sx)) * CHANNELS;
      const r = inside ? (src.data[from] ?? 0) / MAX : 0;
      const g = inside ? (src.data[from + 1] ?? 0) / MAX : 0;
      const b = inside ? (src.data[from + 2] ?? 0) / MAX : 0;
      const a = inside ? (src.data[from + 3] ?? 0) / MAX : 0;
      const outer = Math.min(1 - a, total / maxAlpha * glow.strength * (1 - a));
      const alpha = a + outer;
      const to = (y * width + x) * CHANNELS;
      if (alpha > 0) {
        data[to] = Math.round((r * a + outer * red2) / alpha * MAX);
        data[to + 1] = Math.round((g * a + outer * green) / alpha * MAX);
        data[to + 2] = Math.round((b * a + outer * blue2) / alpha * MAX);
        data[to + 3] = Math.round(alpha * MAX);
      }
    }
  }
  return { width, height, data };
}

// src/sounds.ts
var AUDIO = "/static/audio";
var both = (key2, path) => ({ key: key2, urls: [`${AUDIO}/${path}.ogg`, `${AUDIO}/${path}.mp3`] });
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
var TELEPORT_SOUND = "sfx-teleport";
var FIELD_ZAP_SOUNDS = ["sfx-field-zap-0", "sfx-field-zap-1", "sfx-field-zap-2"];
var MUSIC = {
  home: "music-title-screen",
  ring1: "music-level-1",
  ring2: "music-level-2",
  ring3: "music-level-3",
  ending: "music-ending"
};
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
    both(TELEPORT_SOUND, "sfx/teleport"),
    ...[0, 1, 2].map((i) => both(`sfx-field-zap-${i}`, `sfx/field-zap-${i}`)),
    both("sfx-engine-base", "sfx/engine-base"),
    both("sfx-engine-big-pulse", "sfx/engine-big-pulse"),
    both("sfx-engine-burst", "sfx/engine-burst"),
    both("sfx-engine-supercharged", "sfx/engine-supercharged")
  ];
  return files;
}
function musicFiles() {
  return Object.values(MUSIC).map((key2) => both(key2, `music/${key2.replace(/^music-/, "")}`));
}

// src/sim/rules.gen.ts
var WEAPONS = ["autoCannon", "rockets", "bigSpaceGun", "zapper"];
var ENGINES = ["base", "bigPulse", "burst", "supercharged"];
var SHIELDS = ["front", "frontAndSide", "round", "invincibility"];
var ENEMY_KINDS = ["scout", "fighter", "frigate", "dreadnought", "bomber", "torpedo", "support"];
var ENEMY_FACTIONS = ["klaed", "nairan", "nautolan"];
var PROJECTILE_KINDS = ["autoCannon", "rockets", "bigSpaceGun", "zapper", "klaedBullet", "klaedBigBullet", "klaedRay", "klaedWave", "nairanBolt", "nairanRay", "nautolanBullet", "nautolanSpinningBullet", "nairanRocket", "nairanTorpedo", "nautolanBomb", "nautolanWave", "nautolanRay", "klaedTorpedo", "shard"];
var FACTIONS = ["own", "remote", "enemy"];
var DEFAULT_LOADOUT = { weapon: "autoCannon", engine: "base", shield: "front", weaponTier: 0, engineTier: 0, shieldTier: 0 };
var TICK_RATE = 60;
var TICK_SECONDS = 1 / TICK_RATE;
var SECTOR_RADIUS = 990;
var GRID_RINGS = 3;
var WORLD_APOTHEM = 5445;
var WORLD_EDGE_BAND = 200;
var SAFE_ZONE_RADIUS = 300;
var DERELICT_HOLD_RADIUS = 600;
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
  klaed: {
    scout: 11,
    fighter: 12,
    frigate: 19,
    dreadnought: 44,
    bomber: 16,
    torpedo: 20,
    support: 14
  },
  nairan: {
    scout: 11,
    fighter: 14,
    frigate: 21,
    dreadnought: 44,
    bomber: 16,
    torpedo: 20,
    support: 15
  },
  nautolan: {
    scout: 15,
    fighter: 15,
    frigate: 20,
    dreadnought: 44,
    bomber: 14,
    torpedo: 19,
    support: 16
  }
};
var RING_FACTIONS = ["klaed", "klaed", "nairan", "nautolan"];
var FRIGATE_REACH = 800;
var FRIGATE_SHIELD = 20;
var DREADNOUGHT_SHIELD = 120;
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
var BOMBER_WARN_TINT = 2053248;
var ENEMY_FIRE_GLOW_STRENGTH = 6;
var ENEMY_FIRE_GLOW_QUALITY = 3;
var ENEMY_FIRE_GLOW_DISTANCE = 4;
var REPAIR_LINE_COLOR = 6217822;
var REPAIR_LINE_ALPHA = 0.35;
var REPAIR_LINE_WIDTH = 1;
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
var MISSION_ARROW_SIZE_PX = 24;
var MISSION_ARROW_MARGIN_PX = 44;
var MISSION_LABEL_OFFSET = 1.4;
var MISSION_BANNER_MS = 6e3;
var MISSION_BANNER_Y = 0.22;
var MISSION_BANNER_ALPHA = 0.6;
var MISSION_BANNER_BORDER_PX = 1;
var EVENT_COLOR = 16734794;
var EVENT_CSS = "#ff5a4a";
var UI_FONT_NAME = "Exo 2";
var HEADING_FONT_NAME = "Orbitron";
var UI_FONT = `'${UI_FONT_NAME}', sans-serif`;
var HEADING_FONT = `${HEADING_FONT_NAME}, sans-serif`;
var MINIMAP_WIDTH_PX = 170;
var MINIMAP_INSET_PX = 96;
var FULL_MAP_HEIGHT_PX = 470;
var MAP_MARGIN_PX = 10;
var MAP_HOME_COLOR = 3108764;
var MAP_CLEARED_COLOR = 2910780;
var MAP_HOSTILE_COLORS = [9056304, 9056304, 7218726, 5643549];
var MAP_FILL_ALPHA = 0.9;
var MINIMAP_FILL_ALPHA = 0.45;
var MAP_CLOSED_COLOR = 2763315;
var CLOSED_SHADE_ALPHA = 0.45;
var FIELD_COLOR = 16734794;
var FIELD_HOT_COLOR = 16751232;
var FIELD_STEP = 5;
var FIELD_DRAW_RANGE = 450;
var FIELD_FLARE_RANGE = 340;
var FIELD_RIPPLES = [
  { amplitude: 2.2, along: 0.05, speed: 3.1, phase: 0 },
  { amplitude: 1.2, along: 0.13, speed: -5.3, phase: 0 },
  { amplitude: 2.2, along: 0.07, speed: -4.2, phase: 1.7 },
  { amplitude: 1.2, along: 0.17, speed: 6.1, phase: 0 }
];
var FIELD_FLARE_SWELL = 2.5;
var FIELD_JITTER = 2.5;
var FIELD_STRAND_ALPHA = 0.55;
var FIELD_GLOW_ALPHA = 0.035;
var FIELD_GLOW_RADIUS = 9;
var FIELD_CORE_RADIUS = 4;
var FIELD_SPARK_COLOR = 16765120;
var FIELD_SPARK_JUMP = 6;
var FIELD_ZAP_EVERY_MS = 600;
var FIELD_ZAP_VOLUME = 0.35;
var MAP_EDGE_COLOR = 1181712;
var MAP_PANEL_COLOR = 328458;
var MAP_PANEL_ALPHA = 0.82;
var MAP_FRIGATE_COLOR = 16739163;
var MAP_OTHER_MISSION_COLOR = 11566335;
var MAP_YOU_COLOR = 16777215;
var MAP_FLASH_MS = 300;
var RING_TINTS = [16777215, 16777215, 9429168, 9417983];
var RING_TINT_FADE_MS = 1500;
var MINIMAP_REDRAW_MS = 100;
var FPS_CAP = 60;
var TOUCH_STICK_RADIUS_PX = 75;
var TOUCH_DEAD_ZONE = 0.2;
var TOUCH_AIM_REACH = 150;
var TOUCH_BUTTON_PX = 64;
var TOUCH_BUTTON_WIDTH_PX = 96;
var TOUCH_WIDE_BUTTON_PX = 240;
var TOUCH_BUTTON_GAP_PX = 14;
var TOUCH_EDGE_PX = 24;
var TOUCH_BUTTONS_Y = 0.37;
var TOUCH_RESPAWN_Y = 0.66;
var TOUCH_FULL_HEIGHT_PX = 700;
var TOUCH_SMALL_SHARE = 0.55;
var TOUCH_MIN_SCALE = 0.6;
var STANDINGS_TOP = 5;
var MISSION_AIM_MIN_SHOTS = 10;
var TELEPORT_CLOSE_S = 0.45;
var TELEPORT_HOLD_S = 0.15;
var TELEPORT_SHRINK_S = 0.35;
var TELEPORT_FLASH_S = 0.25;
var TELEPORT_SHIELD_START_SCALE = 2.4;
var TELEPORT_FLASH_RADIUS = 14;
var TELEPORT_COLOR = 5951999;
var TELEPORT_WHITE = 14219519;
var TELEPORT_SOUND_RANGE = 400;

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
var PART_HINTS = {
  autoCannon: "steady and precise",
  rockets: "seek the nearest enemy",
  bigSpaceGun: "charges, then bursts into shards",
  zapper: "a zigzag beam that pierces",
  base: "balanced",
  bigPulse: "fast, but drifts",
  burst: "snappy, but slow",
  supercharged: "quick and fast",
  front: "3 charges, the front",
  frontAndSide: "2 charges, front and sides",
  round: "1 charge, all round",
  invincibility: "3 charges all round, slow to recharge"
};
function ownedParts(parts, unlocks) {
  return unlocks === void 0 ? [...parts] : parts.filter((p) => unlocks.has(p));
}
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
function nextPart(parts, current, unlocks) {
  const choices = unlocks === void 0 ? parts : parts.filter((p) => p === current || unlocks.has(p));
  const next = choices[(choices.indexOf(current) + 1) % choices.length];
  return next ?? current;
}

// src/sim/enemies.ts
var FACTION_NAMES = { klaed: "Kla'ed", nairan: "Nairan", nautolan: "Nautolan" };

// src/sprites.ts
var ASSETS = "/static/assets";
var still = (key2, url, size) => ({
  key: key2,
  url,
  frameWidth: size,
  frameHeight: size,
  frames: 1,
  fps: 0,
  loop: false
});
var WEAPONS_FPS = 18;
var ENEMY_FILES = {
  klaed: {
    scout: { size: 64, engine: 10, weapons: 6, destruction: 10, shield: 14 },
    fighter: { size: 64, engine: 10, weapons: 6, destruction: 9, shield: 10 },
    bomber: { size: 64, engine: 10, destruction: 8, shield: 6 },
    torpedo: { size: 64, engine: 10, weapons: 16, destruction: 10, shield: 10, weaponsFps: 21 },
    frigate: { size: 64, engine: 12, weapons: 6, destruction: 9, shield: 40 },
    dreadnought: { size: 128, engine: 12, weapons: 60, destruction: 12, shield: 10 },
    support: { size: 64, engine: 10, destruction: 10 }
  },
  nairan: {
    scout: { size: 64, engine: 8, weapons: 6, destruction: 16, shield: 18 },
    fighter: { size: 64, engine: 8, weapons: 28, destruction: 18, shield: 20, weaponsFps: 84 },
    bomber: { size: 64, engine: 8, destruction: 16, shield: 10 },
    torpedo: { size: 64, engine: 8, weapons: 12, destruction: 16, shield: 8, weaponsFps: 16 },
    frigate: { size: 64, engine: 8, weapons: 5, destruction: 16, shield: 8, weaponsFps: 15 },
    dreadnought: { size: 128, engine: 8, weapons: 34, destruction: 18, shield: 8, weaponsFps: 15 },
    support: { size: 64, engine: 8, destruction: 16 }
  },
  nautolan: {
    scout: { size: 64, engine: 8, weapons: 7, destruction: 9, shield: 13, weaponsFps: 21 },
    fighter: { size: 64, engine: 8, weapons: 9, destruction: 9, shield: 10, weaponsFps: 27 },
    bomber: { size: 64, engine: 8, destruction: 10, shield: 10 },
    torpedo: { size: 64, engine: 8, weapons: 16, destruction: 8, shield: 8, weaponsFps: 21 },
    frigate: { size: 64, engine: 8, weapons: 9, destruction: 9, shield: 36, shieldSize: 63, weaponsFps: 27 },
    dreadnought: { size: 128, engine: 8, weapons: 35, destruction: 12, shield: 20, weaponsFps: 21 },
    support: { size: 64, engine: 8, destruction: 8 }
  }
};
var BULLET_VARIANT = "blue";
var BULLET_FPS = 12;
var BULLET_FRAMES = {
  klaedBullet: { faction: "klaed", file: "bullet", width: 4, height: 16, frames: 4 },
  klaedBigBullet: { faction: "klaed", file: "big-bullet", width: 8, height: 16, frames: 4 },
  // The Dreadnought's (#124): a beam segment, and a wave arc.
  klaedRay: { faction: "klaed", file: "ray", width: 18, height: 38, frames: 4 },
  klaedWave: { faction: "klaed", file: "wave", width: 64, height: 64, frames: 6 },
  nairanBolt: { faction: "nairan", file: "bolt", width: 9, height: 9, frames: 5 },
  nairanRay: { faction: "nairan", file: "ray", width: 18, height: 38, frames: 4 },
  nautolanBullet: { faction: "nautolan", file: "bullet", width: 12, height: 12, frames: 6 },
  nautolanSpinningBullet: { faction: "nautolan", file: "spinning-bullet", width: 8, height: 8, frames: 8 },
  // The heavy hitters' (#137): the Bombers' Rockets and Bombs, the Torpedo Ships' Torpedoes and Waves.
  nairanRocket: { faction: "nairan", file: "rocket", width: 9, height: 16, frames: 4 },
  nairanTorpedo: { faction: "nairan", file: "torpedo", width: 9, height: 24, frames: 3 },
  // The Kla'ed Torpedo keeps the pack's colors: its teal exhaust already stands apart from the players' orange.
  klaedTorpedo: { faction: "klaed", file: "torpedo", width: 11, height: 32, frames: 3, plain: true },
  nautolanBomb: { faction: "nautolan", file: "bomb", width: 16, height: 16, frames: 16 },
  nautolanWave: { faction: "nautolan", file: "wave", width: 64, height: 64, frames: 6 },
  // The Nautolan Dreadnought's beam (#153).
  nautolanRay: { faction: "nautolan", file: "ray", width: 18, height: 38, frames: 4 }
};
var strip = (key2, url, size, frames, fps, loop = true) => ({
  key: key2,
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
  enemyBase: (faction, kind) => `${faction}-${kind}-base`,
  enemyEngine: (faction, kind) => `${faction}-${kind}-engine`,
  enemyWeapons: (faction, kind) => `${faction}-${kind}-weapons`,
  enemyDestruction: (faction, kind) => `${faction}-${kind}-destruction`,
  enemyShield: (faction, kind) => `${faction}-${kind}-shield`,
  enemyBullet: (id) => `${BULLET_FRAMES[id].faction}-${BULLET_FRAMES[id].file}`,
  /** An enemy bullet with its glow baked in at boot (#143), drawn at half scale. */
  enemyBulletGlow: (id) => `${BULLET_FRAMES[id].faction}-${BULLET_FRAMES[id].file}-glow`,
  pickup: (part) => `pickup-${part}`
};
var pickupFile = (part) => `${WEAPONS.includes(part) ? "weapon" : ENGINES.includes(part) ? "engine" : "shield"}-${part.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
var PICKUP_FRAMES = 15;
function sheets() {
  const ship = `${ASSETS}/mainship`;
  const env = `${ASSETS}/environment`;
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
    ...keys.background.map((key2) => ({
      key: key2,
      url: `${env}/${key2}.png`,
      frameWidth: 640,
      frameHeight: 360,
      frames: 9,
      fps: 6,
      loop: true
    })),
    strip(keys.planet, `${env}/planet-earth-like.png`, 96, 77, 8),
    ...PARTS.map((part) => strip(keys.pickup(part), `${ASSETS}/pickups/${pickupFile(part)}.png`, 32, PICKUP_FRAMES, 12)),
    still(keys.asteroid, `${env}/asteroid.png`, 96),
    ...ENEMY_FACTIONS.flatMap(
      (faction) => ENEMY_KINDS.flatMap((kind) => {
        const f = ENEMY_FILES[faction][kind];
        if (f === void 0) {
          return [];
        }
        const dir = `${ASSETS}/${faction}`;
        return [
          still(keys.enemyBase(faction, kind), `${dir}/${kind}-base.png`, f.size),
          strip(keys.enemyEngine(faction, kind), `${dir}/${kind}-engine.png`, f.size, f.engine, 12),
          ...f.weapons === void 0 ? [] : [strip(keys.enemyWeapons(faction, kind), `${dir}/${kind}-weapons.png`, f.size, f.weapons, f.weaponsFps ?? WEAPONS_FPS, false)],
          strip(keys.enemyDestruction(faction, kind), `${dir}/${kind}-destruction.png`, f.size, f.destruction, 14, false),
          ...f.shield === void 0 ? [] : [strip(keys.enemyShield(faction, kind), `${dir}/${kind}-shield.png`, f.shieldSize ?? f.size, f.shield, 20)]
        ];
      })
    ),
    ...Object.values(BULLET_FRAMES).map((f) => ({
      key: `${f.faction}-${f.file}`,
      url: `${ASSETS}/${f.faction}/${f.file}${f.plain === true ? "" : `-${BULLET_VARIANT}`}.png`,
      frameWidth: f.width,
      frameHeight: f.height,
      frames: f.frames,
      fps: BULLET_FPS,
      loop: true
    }))
  ];
}
function glowSheets() {
  return Object.keys(BULLET_FRAMES).map((id) => ({
    key: keys.enemyBullet(id),
    glowKey: keys.enemyBulletGlow(id),
    frameWidth: BULLET_FRAMES[id].width,
    frameHeight: BULLET_FRAMES[id].height,
    frames: BULLET_FRAMES[id].frames,
    fps: BULLET_FPS
  }));
}

// src/scenes/boot.ts
var ENEMY_FIRE_GLOW = {
  color: ENEMY_FIRE_GLOW_COLOR,
  strength: ENEMY_FIRE_GLOW_STRENGTH,
  quality: ENEMY_FIRE_GLOW_QUALITY,
  distance: ENEMY_FIRE_GLOW_DISTANCE
};
function bakeSheet(source, sheet) {
  const read = document.createElement("canvas");
  read.width = sheet.frameWidth * sheet.frames;
  read.height = sheet.frameHeight;
  const reader = read.getContext("2d", { willReadFrequently: true });
  reader?.drawImage(source, 0, 0);
  const frames = [];
  for (let i = 0; i < sheet.frames; i++) {
    const frame = reader?.getImageData(i * sheet.frameWidth, 0, sheet.frameWidth, sheet.frameHeight);
    if (frame !== void 0) {
      frames.push(bakeGlow(double({ width: frame.width, height: frame.height, data: frame.data }), ENEMY_FIRE_GLOW));
    }
  }
  const frameWidth = frames[0]?.width ?? 1;
  const frameHeight = frames[0]?.height ?? 1;
  const canvas = document.createElement("canvas");
  canvas.width = frameWidth * frames.length;
  canvas.height = frameHeight;
  const writer = canvas.getContext("2d");
  frames.forEach((f, i) => {
    writer?.putImageData(new ImageData(new Uint8ClampedArray(f.data), f.width, f.height), i * frameWidth, 0);
  });
  return { canvas, frameWidth, frameHeight };
}
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
  /** Bakes a glowing copy of every enemy bullet sheet, once, in place of a glow filter every frame (#143). */
  bakeEnemyFireGlow() {
    for (const sheet of glowSheets()) {
      const { canvas, frameWidth, frameHeight } = bakeSheet(this.textures.get(sheet.key).getSourceImage(), sheet);
      const texture = this.textures.addCanvas(sheet.glowKey, canvas);
      if (texture === null) {
        continue;
      }
      for (let i = 0; i < sheet.frames; i++) {
        texture.add(i, 0, i * frameWidth, 0, frameWidth, frameHeight);
      }
      this.anims.create({
        key: sheet.glowKey,
        frames: this.anims.generateFrameNumbers(sheet.glowKey, { start: 0, end: sheet.frames - 1 }),
        frameRate: sheet.fps,
        repeat: -1
      });
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
    this.bakeEnemyFireGlow();
    this.scene.start("sandbox");
  }
};

// src/scenes/sandbox.ts
import Phaser11 from "./vendor/phaser.js";

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

// src/frametimes.ts
var WINDOW_MS = 1e3;
var FrameTimes = class {
  frames = [];
  /** Notes a frame that took ms and ended at now (ms). */
  add(ms, now2) {
    this.frames.push({ at: now2, ms });
    const since = now2 - WINDOW_MS;
    const first = this.frames.findIndex((f) => f.at > since);
    this.frames = first < 0 ? [] : this.frames.slice(first);
  }
  /** The average frame time of the last second, 0 before the first frame; never above the worst, which rounding could otherwise push it past. */
  get average() {
    return this.frames.length === 0 ? 0 : Math.min(this.worst, this.frames.reduce((sum, f) => sum + f.ms, 0) / this.frames.length);
  }
  /** The longest frame of the last second, 0 before the first frame. */
  get worst() {
    return this.frames.reduce((most, f) => Math.max(most, f.ms), 0);
  }
};
var GpuTimer = class {
  /** The GPU time of the latest frame measured, in ms, if any. */
  last;
  gl;
  ext;
  active;
  pending = [];
  constructor(gl) {
    this.gl = gl;
    this.ext = gl.getExtension("EXT_disjoint_timer_query") ?? void 0;
  }
  /** Whether the browser offers a GPU timer. */
  get available() {
    return this.ext !== void 0;
  }
  /** Starts timing a frame's GPU work. */
  begin() {
    if (this.ext === void 0 || this.active !== void 0) {
      return;
    }
    const query = this.ext.createQueryEXT();
    if (query === null) {
      return;
    }
    this.ext.beginQueryEXT(this.ext.TIME_ELAPSED_EXT, query);
    this.active = query;
  }
  /** Stops timing the frame, and reads the frames whose results are in. */
  end() {
    const ext = this.ext;
    if (ext === void 0 || this.active === void 0) {
      return;
    }
    ext.endQueryEXT(ext.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = void 0;
    const disjoint = this.gl.getParameter(ext.GPU_DISJOINT_EXT) === true;
    while (this.pending.length > 0) {
      const query = this.pending[0];
      if (query === void 0 || ext.getQueryObjectEXT(query, ext.QUERY_RESULT_AVAILABLE_EXT) !== true) {
        break;
      }
      if (!disjoint) {
        this.last = Number(ext.getQueryObjectEXT(query, ext.QUERY_RESULT_EXT)) / 1e6;
      }
      ext.deleteQueryEXT(query);
      this.pending.shift();
    }
  }
};

// src/net/codec.ts
import { fromBinary, fromJsonString, toBinary, toJsonString } from "./vendor/protobuf.js";

// src/gen/voidmarch/v1/messages_pb.js
import { enumDesc, fileDesc, messageDesc, tsEnum } from "./vendor/protobuf-codegenv2.js";
var file_voidmarch_v1_messages = /* @__PURE__ */ fileDesc("Cht2b2lkbWFyY2gvdjEvbWVzc2FnZXMucHJvdG8SDHZvaWRtYXJjaC52MSK6AQoHTG9hZG91dBIkCgZ3ZWFwb24YASABKA4yFC52b2lkbWFyY2gudjEuV2VhcG9uEiQKBmVuZ2luZRgCIAEoDjIULnZvaWRtYXJjaC52MS5FbmdpbmUSJAoGc2hpZWxkGAMgASgOMhQudm9pZG1hcmNoLnYxLlNoaWVsZBITCgt3ZWFwb25fdGllchgEIAEoDRITCgtlbmdpbmVfdGllchgFIAEoDRITCgtzaGllbGRfdGllchgGIAEoDSKGAQoEUGFydBImCgZ3ZWFwb24YASABKA4yFC52b2lkbWFyY2gudjEuV2VhcG9uSAASJgoGZW5naW5lGAIgASgOMhQudm9pZG1hcmNoLnYxLkVuZ2luZUgAEiYKBnNoaWVsZBgDIAEoDjIULnZvaWRtYXJjaC52MS5TaGllbGRIAEIGCgRraW5kIjgKBlVubG9jaxIgCgRwYXJ0GAEgASgLMhIudm9pZG1hcmNoLnYxLlBhcnQSDAoEdGllchgCIAEoDSKzAQoJU2hpcFN0YXRlEgkKAXgYASABKAISCQoBeRgCIAEoAhIKCgJ2eBgDIAEoAhIKCgJ2eRgEIAEoAhINCgVhbmdsZRgFIAEoAhIRCgl0aHJ1c3RpbmcYBiABKAgSJgoHbG9hZG91dBgHIAEoCzIVLnZvaWRtYXJjaC52MS5Mb2Fkb3V0Eg4KBmRhbWFnZRgIIAEoDRIOCgZzaGllbGQYCSABKAISDgoGcmV2aXZlGAogASgCIhYKBUhlbGxvEg0KBXRva2VuGAEgASgJIoUBCglTaG90RmlyZWQSCgoCaWQYASABKA0SJAoGd2VhcG9uGAIgASgOMhQudm9pZG1hcmNoLnYxLldlYXBvbhIOCgZtdXp6bGUYAyABKA0SCQoBeBgEIAEoAhIJCgF5GAUgASgCEg0KBWFuZ2xlGAYgASgCEhEKCWNvbXBhbmlvbhgHIAEoDSJvCgNIaXQSEAoIZW5lbXlfaWQYASABKA0SDwoHc2hvdF9pZBgCIAEoDRIOCgZkYW1hZ2UYAyABKA0SFQoJY29tcGFuaW9uGAQgASgNQgIYARINCgVzaGFyZBgFIAEoDRIPCgdnb2VzX29uGAYgASgIIggKBlN1bW1vbiJPCg5Db21wYW5pb25TdGF0ZRIRCgljb21wYW5pb24YASABKA0SJgoFc3RhdGUYAiABKAsyFy52b2lkbWFyY2gudjEuU2hpcFN0YXRlOgIYASIeCg5DaG9vc2VTcXVhZHJvbhIMCgRuYW1lGAEgASgJIpoBCg1TcXVhZHJvbk9yZGVyEikKBG1vZGUYASABKA4yGy52b2lkbWFyY2gudjEuQ29tcGFuaW9uTW9kZRIwCghvbmVfc2hvdBgCIAEoDjIeLnZvaWRtYXJjaC52MS5Db21wYW5pb25PbmVTaG90EgkKAXgYAyABKAISCQoBeRgEIAEoAhIWCg5mb2N1c19lbmVteV9pZBgFIAEoDSIcCgdEaXNtaXNzEhEKCWNvbXBhbmlvbhgBIAEoDSL4BAoNQ2xpZW50TWVzc2FnZRIkCgVoZWxsbxgBIAEoCzITLnZvaWRtYXJjaC52MS5IZWxsb0gAEigKBXN0YXRlGAIgASgLMhcudm9pZG1hcmNoLnYxLlNoaXBTdGF0ZUgAEicKBHNob3QYAyABKAsyFy52b2lkbWFyY2gudjEuU2hvdEZpcmVkSAASIAoDaGl0GAQgASgLMhEudm9pZG1hcmNoLnYxLkhpdEgAEiYKBnN1bW1vbhgFIAEoCzIULnZvaWRtYXJjaC52MS5TdW1tb25IABI1Cgljb21wYW5pb24YBiABKAsyHC52b2lkbWFyY2gudjEuQ29tcGFuaW9uU3RhdGVCAhgBSAASKAoHZGlzbWlzcxgHIAEoCzIVLnZvaWRtYXJjaC52MS5EaXNtaXNzSAASNwoPY2hvb3NlX3NxdWFkcm9uGAggASgLMhwudm9pZG1hcmNoLnYxLkNob29zZVNxdWFkcm9uSAASNQoOc3F1YWRyb25fb3JkZXIYCSABKAsyGy52b2lkbWFyY2gudjEuU3F1YWRyb25PcmRlckgAEigKB2NvbGxlY3QYCiABKAsyFS52b2lkbWFyY2gudjEuQ29sbGVjdEgAEjEKDHBpY2tfbWlzc2lvbhgLIAEoCzIZLnZvaWRtYXJjaC52MS5QaWNrTWlzc2lvbkgAEjgKEGRldl9zdGFydF9hdHRhY2sYDCABKAsyHC52b2lkbWFyY2gudjEuRGV2U3RhcnRBdHRhY2tIABI0Cg5kZXZfc2Vhc29uX3dvbhgNIAEoCzIaLnZvaWRtYXJjaC52MS5EZXZTZWFzb25Xb25IAEIGCgRraW5kIiAKDkRldlN0YXJ0QXR0YWNrEg4KBnNlY3RvchgBIAEoCSIOCgxEZXZTZWFzb25Xb24iHQoLUGlja01pc3Npb24SDgoGc2VjdG9yGAEgASgJIhUKB0NvbGxlY3QSCgoCaWQYASABKA0i7QQKB1dlbGNvbWUSEQoJcGxheWVyX2lkGAEgASgJEg0KBWNvbG9yGAIgASgNEg8KB3NwYXduX3gYAyABKAISDwoHc3Bhd25feRgEIAEoAhIMCgR0aWNrGAUgASgNEhEKCXRpY2tfcmF0ZRgGIAEoDRIXCg9jb21wYW5pb25fbGltaXQYByABKA0SDAoEbmFtZRgJIAEoCRISCgpjb21wYW5pb25zGAogAygNEioKCXNxdWFkcm9ucxgLIAEoCzIXLnZvaWRtYXJjaC52MS5TcXVhZHJvbnMSEAoIc3F1YWRyb24YDCABKAkSJQoHdW5sb2NrcxgNIAMoCzIULnZvaWRtYXJjaC52MS5VbmxvY2sSLAoHcGlja3VwcxgOIAMoCzIbLnZvaWRtYXJjaC52MS5QaWNrdXBEcm9wcGVkEiYKB2xvYWRvdXQYDyABKAsyFS52b2lkbWFyY2gudjEuTG9hZG91dBITCgtkZXZlbG9wbWVudBgQIAEoCBIXCg9jbGVhcmVkX3NlY3RvcnMYESADKAkSLQoLd29ybGRfZXZlbnQYEiABKAsyGC52b2lkbWFyY2gudjEuV29ybGRFdmVudBIQCghtYXBfbmFtZRgTIAEoCRIoCghmcm9udGllchgUIAEoCzIWLnZvaWRtYXJjaC52MS5Gcm9udGllchIrCgpzZWFzb25fd29uGBUgASgLMhcudm9pZG1hcmNoLnYxLlNlYXNvbldvbhIqCglzdGFuZGluZ3MYFiABKAsyFy52b2lkbWFyY2gudjEuU3RhbmRpbmdzSgQICBAJUg9zdW1tb25fYW55d2hlcmUiRwoJU3RhbmRpbmdzEioKB3BsYXllcnMYASADKAsyGS52b2lkbWFyY2gudjEuUGxheWVyU3RhdHMSDgoGc2Vhc29uGAIgASgDImkKCVNlYXNvbldvbhIOCgZzZWFzb24YASABKAMSDwoHc2Vjb25kcxgCIAEoBBIqCgdwbGF5ZXJzGAMgAygLMhkudm9pZG1hcmNoLnYxLlBsYXllclN0YXRzEg8KB3NlY3RvcnMYBCABKA0ipQEKC1BsYXllclN0YXRzEhEKCXBsYXllcl9pZBgBIAEoCRIMCgRuYW1lGAIgASgJEg0KBWtpbGxzGAMgASgNEhcKD2NvbXBhbmlvbl9raWxscxgEIAEoDRINCgVzaG90cxgFIAEoDRIMCgRoaXRzGAYgASgNEg4KBmRlYXRocxgHIAEoDRIPCgdyZXNjdWVzGAggASgNEg8KB3NlY3RvcnMYCSABKA0ijAEKDlBsYXllclNuYXBzaG90EhEKCXBsYXllcl9pZBgBIAEoCRIMCgRuYW1lGAIgASgJEg0KBWNvbG9yGAMgASgNEiYKBXN0YXRlGAQgASgLMhcudm9pZG1hcmNoLnYxLlNoaXBTdGF0ZRIQCghvd25lcl9pZBgFIAEoCRIQCghzcXVhZHJvbhgGIAEoCSJFCg5TcXVhZHJvbk1lbWJlchIRCglwbGF5ZXJfaWQYASABKAkSDAoEbmFtZRgCIAEoCRISCgpjb21wYW5pb25zGAMgASgNIocBCgxTcXVhZHJvbkluZm8SDAoEbmFtZRgBIAEoCRItCgdtZW1iZXJzGAIgAygLMhwudm9pZG1hcmNoLnYxLlNxdWFkcm9uTWVtYmVyEikKBG1vZGUYAyABKA4yGy52b2lkbWFyY2gudjEuQ29tcGFuaW9uTW9kZRIPCgdtaXNzaW9uGAQgASgJIl0KCVNxdWFkcm9ucxItCglzcXVhZHJvbnMYASADKAsyGi52b2lkbWFyY2gudjEuU3F1YWRyb25JbmZvEhEKCW5leHRfbmFtZRgCIAEoCRIOCgZoYW5nYXIYAyABKA0icgoOU3F1YWRyb25Kb2luZWQSDAoEbmFtZRgBIAEoCRIpCgRtb2RlGAIgASgOMhsudm9pZG1hcmNoLnYxLkNvbXBhbmlvbk1vZGUSEQoJdG9va19vdmVyGAMgASgIEgkKAXgYBCABKAISCQoBeRgFIAEoAiIhCg9TcXVhZHJvblJlZnVzZWQSDgoGcmVhc29uGAEgASgJIl4KD1NxdWFkcm9uT3JkZXJlZBIRCglwbGF5ZXJfaWQYASABKAkSDAoEbmFtZRgCIAEoCRIqCgVvcmRlchgDIAEoCzIbLnZvaWRtYXJjaC52MS5TcXVhZHJvbk9yZGVyIoICCgpFbmVteVN0YXRlEhAKCGVuZW15X2lkGAEgASgNEiUKBGtpbmQYAiABKA4yFy52b2lkbWFyY2gudjEuRW5lbXlLaW5kEgkKAXgYAyABKAISCQoBeRgEIAEoAhINCgVhbmdsZRgFIAEoAhIKCgJ2eBgGIAEoAhIKCgJ2eRgHIAEoAhIKCgJocBgIIAEoAhIOCgZtYXhfaHAYCSABKAISDgoGc2hpZWxkGAogASgCEhIKCnNjYWxlZF9mb3IYCyABKAISKwoHZmFjdGlvbhgMIAEoDjIaLnZvaWRtYXJjaC52MS5FbmVteUZhY3Rpb24SEQoJcmVwYWlyaW5nGA0gASgNIqIBCghTbmFwc2hvdBIMCgR0aWNrGAEgASgNEi0KB3BsYXllcnMYAiADKAsyHC52b2lkbWFyY2gudjEuUGxheWVyU25hcHNob3QSKQoHZW5lbWllcxgDIAMoCzIYLnZvaWRtYXJjaC52MS5FbmVteVN0YXRlEi4KCWRlcmVsaWN0cxgEIAMoCzIbLnZvaWRtYXJjaC52MS5EZXJlbGljdFN0YXRlInoKDURlcmVsaWN0U3RhdGUSEwoLZGVyZWxpY3RfaWQYASABKA0SCQoBeBgCIAEoAhIJCgF5GAMgASgCEg0KBWFuZ2xlGAQgASgCEg4KBnJlc2N1ZRgFIAEoAhIRCglnb25lX3RpY2sYBiABKA0SDAoEaGVsZBgHIAEoCCLHAQoKRW5lbXlGaXJlZBIQCghlbmVteV9pZBgBIAEoDRIlCgRraW5kGAIgASgOMhcudm9pZG1hcmNoLnYxLkVuZW15S2luZBIMCgR0aWNrGAMgASgNEgwKBHNlZWQYBCABKA0SCQoBeBgFIAEoAhIJCgF5GAYgASgCEg0KBWFuZ2xlGAcgASgCEhIKCndhcm5fdGlja3MYCCABKA0SKwoHZmFjdGlvbhgJIAEoDjIaLnZvaWRtYXJjaC52MS5FbmVteUZhY3Rpb24igwEKDkVuZW15RGVzdHJveWVkEhAKCGVuZW15X2lkGAEgASgNEiUKBGtpbmQYAiABKA4yFy52b2lkbWFyY2gudjEuRW5lbXlLaW5kEhQKDGJ5X3BsYXllcl9pZBgDIAEoCRIMCgR0aWNrGAQgASgNEgkKAXgYBSABKAISCQoBeRgGIAEoAiJMCglTaG90RW5kZWQSEQoJcGxheWVyX2lkGAEgASgJEg8KB3Nob3RfaWQYAiABKA0SDAoEdGljaxgDIAEoDRINCgVzaGFyZBgEIAEoDSJUCgpSZW1vdGVTaG90EhEKCXBsYXllcl9pZBgBIAEoCRIMCgR0aWNrGAIgASgNEiUKBHNob3QYAyABKAsyFy52b2lkbWFyY2gudjEuU2hvdEZpcmVkIh8KClBsYXllckxlZnQSEQoJcGxheWVyX2lkGAEgASgJIjsKEENvbXBhbmlvbkdyYW50ZWQSEQoJY29tcGFuaW9uGAEgASgNEgkKAXgYAiABKAISCQoBeRgDIAEoAiIiChBDb21wYW5pb25SZWZ1c2VkEg4KBnJlYXNvbhgBIAEoCSI5ChJDb21wYW5pb25EaXNtaXNzZWQSEQoJY29tcGFuaW9uGAEgASgNEhAKCHRha2VuX2J5GAIgASgJIgYKBEZ1bGwijgoKDVNlcnZlck1lc3NhZ2USKAoHd2VsY29tZRgBIAEoCzIVLnZvaWRtYXJjaC52MS5XZWxjb21lSAASKgoIc25hcHNob3QYAiABKAsyFi52b2lkbWFyY2gudjEuU25hcHNob3RIABIoCgRzaG90GAMgASgLMhgudm9pZG1hcmNoLnYxLlJlbW90ZVNob3RIABIoCgRsZWZ0GAQgASgLMhgudm9pZG1hcmNoLnYxLlBsYXllckxlZnRIABIiCgRmdWxsGAUgASgLMhIudm9pZG1hcmNoLnYxLkZ1bGxIABIvCgtlbmVteV9maXJlZBgGIAEoCzIYLnZvaWRtYXJjaC52MS5FbmVteUZpcmVkSAASNwoPZW5lbXlfZGVzdHJveWVkGAcgASgLMhwudm9pZG1hcmNoLnYxLkVuZW15RGVzdHJveWVkSAASLQoKc2hvdF9lbmRlZBgIIAEoCzIXLnZvaWRtYXJjaC52MS5TaG90RW5kZWRIABI7ChFjb21wYW5pb25fZ3JhbnRlZBgJIAEoCzIeLnZvaWRtYXJjaC52MS5Db21wYW5pb25HcmFudGVkSAASOwoRY29tcGFuaW9uX3JlZnVzZWQYCiABKAsyHi52b2lkbWFyY2gudjEuQ29tcGFuaW9uUmVmdXNlZEgAEj8KE2NvbXBhbmlvbl9kaXNtaXNzZWQYCyABKAsyIC52b2lkbWFyY2gudjEuQ29tcGFuaW9uRGlzbWlzc2VkSAASLAoJc3F1YWRyb25zGAwgASgLMhcudm9pZG1hcmNoLnYxLlNxdWFkcm9uc0gAEjcKD3NxdWFkcm9uX2pvaW5lZBgNIAEoCzIcLnZvaWRtYXJjaC52MS5TcXVhZHJvbkpvaW5lZEgAEjkKEHNxdWFkcm9uX3JlZnVzZWQYDiABKAsyHS52b2lkbWFyY2gudjEuU3F1YWRyb25SZWZ1c2VkSAASOQoQc3F1YWRyb25fb3JkZXJlZBgPIAEoCzIdLnZvaWRtYXJjaC52MS5TcXVhZHJvbk9yZGVyZWRIABI1Cg5waWNrdXBfZHJvcHBlZBgQIAEoCzIbLnZvaWRtYXJjaC52MS5QaWNrdXBEcm9wcGVkSAASMQoMcGlja3VwX3Rha2VuGBEgASgLMhkudm9pZG1hcmNoLnYxLlBpY2t1cFRha2VuSAASOQoQZGVyZWxpY3RfcmVzY3VlZBgSIAEoCzIdLnZvaWRtYXJjaC52MS5EZXJlbGljdFJlc2N1ZWRIABI1Cg5zZWN0b3JfY2xlYXJlZBgTIAEoCzIbLnZvaWRtYXJjaC52MS5TZWN0b3JDbGVhcmVkSAASMwoNZXZlbnRfc3RhcnRlZBgUIAEoCzIaLnZvaWRtYXJjaC52MS5FdmVudFN0YXJ0ZWRIABIvCgtldmVudF9lbmRlZBgVIAEoCzIYLnZvaWRtYXJjaC52MS5FdmVudEVuZGVkSAASKgoIZnJvbnRpZXIYFiABKAsyFi52b2lkbWFyY2gudjEuRnJvbnRpZXJIABIrCglib3NzX2ZlbGwYFyABKAsyFi52b2lkbWFyY2gudjEuQm9zc0ZlbGxIABItCgpzZWFzb25fd29uGBggASgLMhcudm9pZG1hcmNoLnYxLlNlYXNvbldvbkgAEiwKCXN0YW5kaW5ncxgZIAEoCzIXLnZvaWRtYXJjaC52MS5TdGFuZGluZ3NIAEIGCgRraW5kIpUBCghCb3NzRmVsbBIlCgRraW5kGAEgASgOMhcudm9pZG1hcmNoLnYxLkVuZW15S2luZBInCgVnYWlucxgCIAMoCzIYLnZvaWRtYXJjaC52MS5QaWNrdXBHYWluEgwKBHRpY2sYAyABKA0SKwoHZmFjdGlvbhgEIAEoDjIaLnZvaWRtYXJjaC52MS5FbmVteUZhY3Rpb24iLgoIRnJvbnRpZXISEgoKb3Blbl9yaW5ncxgBIAEoDRIOCgZvcGVuZWQYAiADKAkidAoNUGlja3VwRHJvcHBlZBIKCgJpZBgBIAEoDRIgCgRwYXJ0GAIgASgLMhIudm9pZG1hcmNoLnYxLlBhcnQSCQoBeBgDIAEoAhIJCgF5GAQgASgCEgwKBHRpY2sYBSABKA0SEQoJZ29uZV90aWNrGAYgASgNIlUKC1BpY2t1cFRha2VuEgoKAmlkGAEgASgNEhEKCXBsYXllcl9pZBgCIAEoCRInCgVnYWlucxgDIAMoCzIYLnZvaWRtYXJjaC52MS5QaWNrdXBHYWluIlsKCldvcmxkRXZlbnQSKgoEa2luZBgBIAEoDjIcLnZvaWRtYXJjaC52MS5Xb3JsZEV2ZW50S2luZBIOCgZzZWN0b3IYAiABKAkSEQoJZW5kc190aWNrGAMgASgNIkgKDEV2ZW50U3RhcnRlZBInCgVldmVudBgBIAEoCzIYLnZvaWRtYXJjaC52MS5Xb3JsZEV2ZW50Eg8KB29uZ29pbmcYAiABKAgiQgoKRXZlbnRFbmRlZBInCgVldmVudBgBIAEoCzIYLnZvaWRtYXJjaC52MS5Xb3JsZEV2ZW50EgsKA3dvbhgCIAEoCCKCAQoNU2VjdG9yQ2xlYXJlZBIOCgZzZWN0b3IYASABKAkSDAoEdGljaxgCIAEoDRInCgVnYWlucxgDIAMoCzIYLnZvaWRtYXJjaC52MS5QaWNrdXBHYWluEioKB21pc3Npb24YBCADKAsyGS52b2lkbWFyY2gudjEuUGxheWVyU3RhdHMiZwoPRGVyZWxpY3RSZXNjdWVkEhMKC2RlcmVsaWN0X2lkGAEgASgNEhEKCXBsYXllcl9pZBgCIAEoCRIMCgR0aWNrGAMgASgNEg4KBmhhbmdhchgEIAEoDRIOCgZkb2NrZWQYBSABKAgiRQoKUGlja3VwR2FpbhIRCglwbGF5ZXJfaWQYASABKAkSJAoGdW5sb2NrGAIgASgLMhQudm9pZG1hcmNoLnYxLlVubG9jayp5CgZXZWFwb24SFgoSV0VBUE9OX1VOU1BFQ0lGSUVEEAASFgoSV0VBUE9OX0FVVE9fQ0FOTk9OEAESEgoOV0VBUE9OX1JPQ0tFVFMQAhIYChRXRUFQT05fQklHX1NQQUNFX0dVThADEhEKDVdFQVBPTl9aQVBQRVIQBCpyCgZFbmdpbmUSFgoSRU5HSU5FX1VOU1BFQ0lGSUVEEAASDwoLRU5HSU5FX0JBU0UQARIUChBFTkdJTkVfQklHX1BVTFNFEAISEAoMRU5HSU5FX0JVUlNUEAMSFwoTRU5HSU5FX1NVUEVSQ0hBUkdFRBAEKnkKBlNoaWVsZBIWChJTSElFTERfVU5TUEVDSUZJRUQQABIQCgxTSElFTERfRlJPTlQQARIZChVTSElFTERfRlJPTlRfQU5EX1NJREUQAhIQCgxTSElFTERfUk9VTkQQAxIYChRTSElFTERfSU5WSU5DSUJJTElUWRAEKtABCglFbmVteUtpbmQSGgoWRU5FTVlfS0lORF9VTlNQRUNJRklFRBAAEhQKEEVORU1ZX0tJTkRfU0NPVVQQARIWChJFTkVNWV9LSU5EX0ZJR0hURVIQAhIWChJFTkVNWV9LSU5EX0ZSSUdBVEUQAxIaChZFTkVNWV9LSU5EX0RSRUFETk9VR0hUEAQSFQoRRU5FTVlfS0lORF9CT01CRVIQBRIWChJFTkVNWV9LSU5EX1RPUlBFRE8QBhIWChJFTkVNWV9LSU5EX1NVUFBPUlQQByp8CgxFbmVteUZhY3Rpb24SHQoZRU5FTVlfRkFDVElPTl9VTlNQRUNJRklFRBAAEhcKE0VORU1ZX0ZBQ1RJT05fS0xBRUQQARIYChRFTkVNWV9GQUNUSU9OX05BSVJBThACEhoKFkVORU1ZX0ZBQ1RJT05fTkFVVE9MQU4QAyq0AQoNQ29tcGFuaW9uTW9kZRIeChpDT01QQU5JT05fTU9ERV9VTlNQRUNJRklFRBAAEhkKFUNPTVBBTklPTl9NT0RFX0VTQ09SVBABEhkKFUNPTVBBTklPTl9NT0RFX0FUVEFDSxACEhgKFENPTVBBTklPTl9NT0RFX0dVQVJEEAMSFwoTQ09NUEFOSU9OX01PREVfSE9MRBAEEhoKFkNPTVBBTklPTl9NT0RFX1NURUFMVEgQBSqUAQoQQ29tcGFuaW9uT25lU2hvdBIiCh5DT01QQU5JT05fT05FX1NIT1RfVU5TUEVDSUZJRUQQABIcChhDT01QQU5JT05fT05FX1NIT1RfRk9DVVMQARIeChpDT01QQU5JT05fT05FX1NIT1RfUkVHUk9VUBACEh4KGkNPTVBBTklPTl9PTkVfU0hPVF9HT19IT01FEAMqbgoOV29ybGRFdmVudEtpbmQSIAocV09STERfRVZFTlRfS0lORF9VTlNQRUNJRklFRBAAEhsKF1dPUkxEX0VWRU5UX0tJTkRfQVRUQUNLEAESHQoZV09STERfRVZFTlRfS0lORF9ESVNUUkVTUxACQkZaRGdpdGh1Yi5jb20vc3RhcnF1YWtlL3ZvaWRtYXJjaC9pbnRlcm5hbC9nZW4vdm9pZG1hcmNoL3YxO3ZvaWRtYXJjaHYxYgZwcm90bzM");
var ShipStateSchema = /* @__PURE__ */ messageDesc(file_voidmarch_v1_messages, 3);
var ClientMessageSchema = /* @__PURE__ */ messageDesc(file_voidmarch_v1_messages, 12);
var ServerMessageSchema = /* @__PURE__ */ messageDesc(file_voidmarch_v1_messages, 40);
var WeaponSchema = /* @__PURE__ */ enumDesc(file_voidmarch_v1_messages, 0);
var Weapon = /* @__PURE__ */ tsEnum(WeaponSchema);
var EngineSchema = /* @__PURE__ */ enumDesc(file_voidmarch_v1_messages, 1);
var Engine = /* @__PURE__ */ tsEnum(EngineSchema);
var ShieldSchema = /* @__PURE__ */ enumDesc(file_voidmarch_v1_messages, 2);
var Shield = /* @__PURE__ */ tsEnum(ShieldSchema);
var EnemyKindSchema = /* @__PURE__ */ enumDesc(file_voidmarch_v1_messages, 3);
var EnemyKind = /* @__PURE__ */ tsEnum(EnemyKindSchema);
var EnemyFactionSchema = /* @__PURE__ */ enumDesc(file_voidmarch_v1_messages, 4);
var EnemyFaction = /* @__PURE__ */ tsEnum(EnemyFactionSchema);
var CompanionModeSchema = /* @__PURE__ */ enumDesc(file_voidmarch_v1_messages, 5);
var CompanionMode = /* @__PURE__ */ tsEnum(CompanionModeSchema);
var CompanionOneShotSchema = /* @__PURE__ */ enumDesc(file_voidmarch_v1_messages, 6);
var CompanionOneShot = /* @__PURE__ */ tsEnum(CompanionOneShotSchema);
var WorldEventKindSchema = /* @__PURE__ */ enumDesc(file_voidmarch_v1_messages, 7);
var WorldEventKind = /* @__PURE__ */ tsEnum(WorldEventKindSchema);

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
    case EnemyKind.DREADNOUGHT:
      return "dreadnought";
    case EnemyKind.BOMBER:
      return "bomber";
    case EnemyKind.TORPEDO:
      return "torpedo";
    case EnemyKind.SUPPORT:
      return "support";
    default:
      return "scout";
  }
};
var fromPlayerStats = (p) => ({
  playerId: p.playerId,
  name: p.name,
  kills: p.kills,
  companionKills: p.companionKills,
  shots: p.shots,
  hits: p.hits,
  deaths: p.deaths,
  rescues: p.rescues,
  sectors: p.sectors
});
var fromSeasonWon = (won) => ({
  season: won.season.toString(),
  seconds: Number(won.seconds),
  sectors: won.sectors,
  players: won.players.map(fromPlayerStats)
});
var fromEnemyFaction = (faction) => {
  switch (faction) {
    case EnemyFaction.NAIRAN:
      return "nairan";
    case EnemyFaction.NAUTOLAN:
      return "nautolan";
    default:
      return "klaed";
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
  const move = input.moveX === void 0 || input.moveY === void 0 ? normalize(Number(input.right) - Number(input.left), Number(input.down) - Number(input.up)) : capped(input.moveX, input.moveY);
  return { moveX: move.x, moveY: move.y, aimX: input.pointerX, aimY: input.pointerY, fire: input.fire };
}
function capped(x, y) {
  const length = Math.hypot(x, y);
  return length > 1 ? { x: x / length, y: y / length } : { x, y };
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
var DISPLAY_KEY = "voidmarch.display";
var DEFAULT_DISPLAY = { fpsCap: false, cssPixels: false };
function loadDisplaySettings(store = browserStorage()) {
  try {
    const parsed = JSON.parse(store?.getItem(DISPLAY_KEY) ?? "null");
    if (typeof parsed !== "object" || parsed === null) {
      return { ...DEFAULT_DISPLAY };
    }
    const saved = parsed;
    return {
      fpsCap: typeof saved.fpsCap === "boolean" ? saved.fpsCap : DEFAULT_DISPLAY.fpsCap,
      cssPixels: typeof saved.cssPixels === "boolean" ? saved.cssPixels : DEFAULT_DISPLAY.cssPixels
    };
  } catch {
    return { ...DEFAULT_DISPLAY };
  }
}
function saveDisplaySettings(settings, store = browserStorage()) {
  try {
    store?.setItem(DISPLAY_KEY, JSON.stringify(settings));
  } catch {
  }
}
var VIEW_KEY = "voidmarch.view";
var DEFAULT_VIEW = { snapRotation: false, effects: true };
function loadViewSettings(store = browserStorage()) {
  try {
    const parsed = JSON.parse(store?.getItem(VIEW_KEY) ?? "null");
    if (typeof parsed !== "object" || parsed === null) {
      return { ...DEFAULT_VIEW };
    }
    const saved = parsed;
    return {
      snapRotation: typeof saved.snapRotation === "boolean" ? saved.snapRotation : DEFAULT_VIEW.snapRotation,
      effects: typeof saved.effects === "boolean" ? saved.effects : DEFAULT_VIEW.effects
    };
  } catch {
    return { ...DEFAULT_VIEW };
  }
}
function saveViewSettings(settings, store = browserStorage()) {
  try {
    store?.setItem(VIEW_KEY, JSON.stringify(settings));
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
var SEEN_SEASON_KEY = "voidmarch.seasonSeen";
function loadSeenSeason(store = browserStorage()) {
  try {
    return store?.getItem(SEEN_SEASON_KEY) ?? void 0;
  } catch {
    return void 0;
  }
}
function saveSeenSeason(season, store = browserStorage()) {
  try {
    store?.setItem(SEEN_SEASON_KEY, season);
  } catch {
  }
}
var INTRO_SEEN_KEY = "voidmarch.introSeen";
function loadIntroSeen(store = browserStorage()) {
  try {
    return store?.getItem(INTRO_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}
function saveIntroSeen(store = browserStorage()) {
  try {
    store?.setItem(INTRO_SEEN_KEY, "1");
  } catch {
  }
}
var BLOOM_BROKEN_KEY = "voidmarch.bloomBroken.2";
function loadBloomBroken(store = browserStorage()) {
  try {
    return store?.getItem(BLOOM_BROKEN_KEY) === "1";
  } catch {
    return false;
  }
}
function saveBloomBroken(store = browserStorage()) {
  try {
    store?.setItem(BLOOM_BROKEN_KEY, "1");
  } catch {
  }
}

// src/sim/options.ts
var OPTION_IDS = ["sound", "music", "controls", "snapRotation", "effects", "fpsCap", "lowResolution"];
var onOff = (on) => on ? "on" : "off";
function optionRows(options) {
  const values = {
    sound: ["Sound", onOff(options.sound)],
    music: ["Music", onOff(options.music)],
    controls: ["Controls", options.controls === "ship" ? "ship-relative" : "screen-relative"],
    snapRotation: ["Rotation", options.snapRotation ? `${String(ROTATION_SNAP_STEPS)} directions` : "free"],
    effects: ["Effects", onOff(options.effects)],
    fpsCap: ["Frame rate", options.fpsCap ? `capped at ${String(FPS_CAP)}` : "the display's own"],
    lowResolution: ["Resolution", options.lowResolution ? "low" : "full"]
  };
  return OPTION_IDS.map((id) => ({ id, label: values[id][0], value: values[id][1] }));
}
function changeOption(options, id) {
  if (id === "controls") {
    const next = CONTROL_MODES[(CONTROL_MODES.indexOf(options.controls) + 1) % CONTROL_MODES.length] ?? options.controls;
    return { ...options, controls: next };
  }
  return { ...options, [id]: !options[id] };
}
function moveSelection(selected, step, rows) {
  return rows === 0 ? 0 : ((selected + step) % rows + rows) % rows;
}

// src/settingsscreen.ts
var SettingsScreen = class {
  form;
  list;
  change;
  rows = [];
  selected = 0;
  constructor(change, doc = document) {
    this.change = change;
    this.form = doc.querySelector("#settings-form");
    this.list = doc.querySelector("#settings-rows");
    this.form?.addEventListener("submit", (event) => {
      event.preventDefault();
    });
    this.list?.addEventListener("pointerdown", (event) => {
      event.preventDefault();
    });
    this.list?.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest("[data-row]") : null;
      const index = Number(button?.dataset.row);
      const row = this.rows[index];
      if (row !== void 0) {
        this.selected = index;
        this.change(row);
      }
    });
  }
  get open() {
    return this.form !== null && !this.form.hidden;
  }
  /** Opens the screen on its first row. */
  show(rows) {
    this.selected = 0;
    this.update(rows);
    if (this.form !== null) {
      this.form.hidden = false;
    }
  }
  /** Shows the rows' current values. */
  update(rows) {
    this.rows = rows;
    const doc = this.list?.ownerDocument;
    if (doc === void 0) {
      return;
    }
    this.list?.replaceChildren(
      ...rows.map((row, i) => {
        const button = doc.createElement("button");
        button.type = "button";
        button.className = i === this.selected ? "settings-row selected" : "settings-row";
        button.dataset.row = String(i);
        const label = doc.createElement("span");
        label.textContent = row.label;
        const value = doc.createElement("span");
        value.className = "value";
        value.textContent = row.value;
        button.append(label, value);
        return button;
      })
    );
  }
  hide() {
    if (this.form !== null) {
      this.form.hidden = true;
    }
  }
  /** Handles a key while open: the arrows pick a row, and Enter, Space, left and right change it. Returns whether the key was the screen's. */
  key(event) {
    switch (event.code) {
      case "ArrowUp":
      case "ArrowDown":
        event.preventDefault();
        this.selected = moveSelection(this.selected, event.code === "ArrowUp" ? -1 : 1, this.rows.length);
        this.update(this.rows);
        return true;
      case "Enter":
      case "Space":
      case "ArrowLeft":
      case "ArrowRight": {
        event.preventDefault();
        const row = this.rows[this.selected];
        if (row !== void 0) {
          this.change(row);
        }
        return true;
      }
      default:
        return false;
    }
  }
};

// src/sim/sectors.ts
var LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
var SQRT3 = Math.sqrt(3);
function ring({ q, r }) {
  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
}
function hexName({ q, r }) {
  const row = r + (q - (q & 1)) / 2 + GRID_RINGS;
  return `${LETTERS.charAt(q + GRID_RINGS)}${String(row + 1)}`;
}
function sectorAxial(name) {
  return parseHex(name);
}
function parseHex(name) {
  const col = LETTERS.indexOf(name.charAt(0));
  const row = Number(name.slice(1)) - 1;
  if (col < 0 || !/^[1-9]\d*$/.test(name.slice(1))) {
    return void 0;
  }
  const q = col - GRID_RINGS;
  const hex2 = { q, r: row - GRID_RINGS - (q - (q & 1)) / 2 };
  return ring(hex2) <= GRID_RINGS ? hex2 : void 0;
}
function hexCenter({ q, r }) {
  return { x: SECTOR_RADIUS * 1.5 * q, y: SECTOR_RADIUS * SQRT3 * (r + q / 2) };
}
function sectorName(x, y) {
  const q = 2 / 3 * x / SECTOR_RADIUS;
  const r = (-x / 3 + SQRT3 * y / 3) / SECTOR_RADIUS;
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) {
    rq = -rr - rs;
  } else if (dr > ds) {
    rr = -rq - rs;
  }
  const hex2 = { q: rq + 0, r: rr + 0 };
  return ring(hex2) <= GRID_RINGS ? hexName(hex2) : void 0;
}
var GRID_EXTENT = { x: SECTOR_RADIUS * (1.5 * GRID_RINGS + 1), y: SECTOR_RADIUS * SQRT3 * (GRID_RINGS + 0.5) };
function sectorRing(name) {
  const hex2 = parseHex(name);
  return hex2 === void 0 ? void 0 : ring(hex2);
}
var SECTOR_NAMES = (() => {
  const names = [];
  for (let q = -GRID_RINGS; q <= GRID_RINGS; q++) {
    for (let r = -GRID_RINGS; r <= GRID_RINGS; r++) {
      if (ring({ q, r }) <= GRID_RINGS) {
        names.push(hexName({ q, r }));
      }
    }
  }
  return names;
})();
var HOME_SECTOR = sectorName(0, 0) ?? "";
var ALL_OPEN = { openRings: 0, opened: /* @__PURE__ */ new Set() };
function sectorOpen(name, frontier) {
  const ring2 = sectorRing(name);
  return ring2 !== void 0 && (frontier.openRings === 0 || ring2 <= frontier.openRings || frontier.opened.has(name));
}
function closedEdges(frontier) {
  const edges = [];
  for (const name of SECTOR_NAMES) {
    if (sectorOpen(name, frontier)) {
      continue;
    }
    const center = sectorCenter(name) ?? { x: 0, y: 0 };
    const corners = sectorCorners(name);
    corners.forEach((a, i) => {
      const b = corners[(i + 1) % corners.length] ?? a;
      const side = (2 * i + 1) * Math.PI / 6;
      const across = sectorName(center.x + SQRT3 * SECTOR_RADIUS * Math.cos(side), center.y + SQRT3 * SECTOR_RADIUS * Math.sin(side));
      if (across !== void 0 && sectorOpen(across, frontier)) {
        edges.push({ a, b });
      }
    });
  }
  return edges;
}
function sectorState(name, cleared, frontier = ALL_OPEN) {
  if (name === HOME_SECTOR) {
    return "home";
  }
  if (!sectorOpen(name, frontier)) {
    return "closed";
  }
  if (cleared === void 0) {
    return "unknown";
  }
  return cleared.has(name) ? "cleared" : "hostile";
}
function sectorLine(x, y, cleared, frontier = ALL_OPEN) {
  const name = sectorName(x, y);
  if (name === void 0) {
    return "";
  }
  const state = sectorState(name, cleared, frontier);
  return state === "unknown" ? `Sector ${name}` : `Sector ${name} \xB7 ${state}`;
}
function sectorCorners(name) {
  const hex2 = parseHex(name);
  if (hex2 === void 0) {
    return [];
  }
  const center = hexCenter(hex2);
  return Array.from({ length: 6 }, (_, i) => ({
    x: center.x + SECTOR_RADIUS * Math.cos(i * Math.PI / 3),
    y: center.y + SECTOR_RADIUS * Math.sin(i * Math.PI / 3)
  }));
}
function sectorCenter(name) {
  const hex2 = parseHex(name);
  return hex2 === void 0 ? void 0 : hexCenter(hex2);
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
function sectorFaction(name) {
  const ring2 = sectorRing(name);
  return (ring2 === void 0 ? void 0 : RING_FACTIONS[ring2]) ?? "klaed";
}
function missionBanner(sector) {
  return [
    `New mission: sector ${sector}`,
    `Destroy every ${FACTION_NAMES[sectorFaction(sector)]} ship in ${sector} to clear it.`,
    "Follow the gold arrow at the edge of the screen."
  ];
}
function missionCompleteBanner(sector, part, stats) {
  const lines = [`Mission complete: sector ${sector} cleared`];
  if (stats !== void 0) {
    lines.push(stats);
  }
  if (part !== void 0) {
    lines.push(`Your reward: ${part}`);
  }
  return lines;
}
var WHITE = 16777215;
var CHANNELS2 = [16, 8, 0];
var CHANNEL_MAX = 255;
function ringTint(x, y) {
  const name = sectorName(x, y);
  const ring2 = name === void 0 ? void 0 : sectorRing(name);
  return (ring2 === void 0 ? void 0 : RING_TINTS[ring2]) ?? WHITE;
}
function fadeColor(a, b, t) {
  const share = Math.min(1, Math.max(0, t));
  let out = 0;
  for (const shift of CHANNELS2) {
    const from = a >> shift & CHANNEL_MAX;
    const to = b >> shift & CHANNEL_MAX;
    const step = (to - from) * share;
    const moved = share > 0 && Math.abs(step) < 1 ? from + Math.sign(to - from) : Math.round(from + step);
    out |= moved << shift;
  }
  return out;
}

// src/sim/intro.ts
var plain = (text) => ({ text });
var gold = (text) => ({ text, mark: "gold" });
var blue = (text) => ({ text, mark: "blue" });
var red = (text) => ({ text, mark: "red" });
var key = (text) => ({ text, mark: "key" });
var NUMBER_WORDS = ["no", "one", "two", "three", "four", "five"];
function numberWord(n, capital = false) {
  const word = NUMBER_WORDS[n] ?? String(n);
  return capital ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}
var PREMISE = [
  plain("The "),
  gold("Kla'ed"),
  plain(", "),
  gold("Nairan"),
  plain(" and "),
  gold("Nautolan"),
  plain(
    " fleets hold the sectors around your home planet. Clear them ring by ring with your friends and your companions. Rescue derelict ships for the hangar, and bring down each ring's Dreadnought to open the next. Win the season together."
  )
];
var KEYBOARD = {
  title: "Keyboard",
  style: "keys",
  rows: [
    { keys: ["W", "A", "S", "D"], text: "move" },
    { keys: ["G"], text: "draw a companion, at home" },
    { keys: ["Q"], text: "hold for orders, tap to repeat" },
    { keys: ["1", "2", "3"], text: "switch weapon, engine, shield" },
    { keys: ["M"], text: "map" },
    { keys: ["Tab"], text: "hold for the standings" },
    { keys: ["H", "J"], text: "when down: respawn home, or by a squadmate" },
    { keys: ["O"], text: "the season's victory screen" },
    { keys: ["Esc"], text: "settings, or close a screen" },
    { keys: ["F1"], text: "this screen" }
  ]
};
var MOUSE = {
  title: "Mouse",
  style: "plain",
  rows: [
    { keys: ["point"], text: "aim" },
    { keys: ["hold left"], text: "fire; the big space gun charges, and fires when you let go" },
    { keys: ["click"], text: "on the map: send your squadron to a sector" },
    { keys: ["click a slot"], text: "bottom left: pick another part you own" }
  ],
  note: "W flies up the screen, or toward the mouse with ship-relative controls in the settings."
};
var THUMBS = {
  title: "Thumbs",
  style: "plain",
  rows: [
    { keys: ["left half"], text: "a stick where your thumb lands: move that way" },
    { keys: ["right half"], text: "a stick: aim that way and fire while pushed; the big space gun fires on release" },
    { keys: ["minimap"], text: "the full map: tap a sector to send your squadron there" },
    { keys: ["a slot"], text: "bottom left: tap it, then a part you own" }
  ]
};
var BUTTONS = {
  title: "Buttons",
  style: "buttons",
  rows: [
    { keys: ["Summon"], text: "draw a companion, at home" },
    { keys: ["Orders"], text: "hold for the order ring, tap to repeat" },
    { keys: ["Respawn"], text: "when down: at home, or beside a squadmate" },
    { keys: ["Settings"], text: "sound, controls, effects" },
    { keys: ["Help"], text: "this screen" }
  ]
};
var SECTORS = [
  [
    plain("The world is "),
    blue(`${String(SECTOR_NAMES.length)} hexagonal sectors`),
    plain(`: home in ${HOME_SECTOR} and ${numberWord(GRID_RINGS)} rings around it.`)
  ],
  [plain("Destroy a sector's whole garrison to "), blue("clear it"), plain(" for good. Its losses stay, so you can wear it down over several visits.")],
  [
    plain("Your squadron's "),
    gold("mission"),
    plain(" is the nearest uncleared sector: the "),
    gold("gold arrow"),
    plain(" at the screen's edge points the way.")
  ],
  [plain("A "), red("red force field"), plain(" closes the outer rings until the ring's Dreadnought falls.")]
];
function extras(touch) {
  return [
    [blue("Companions"), plain(" are AI wingmates from the shared hangar, up to three. They follow your squadron's orders from the order ring.")],
    [
      blue("Parts"),
      plain(
        ` drop from enemies: fly over one to take it for your squadron, or raise its tier. Switch anywhere with ${touch ? "the slots bottom left" : "1, 2, 3 or the slots"}.`
      )
    ],
    [
      blue("Going down:"),
      plain(
        ` ${numberWord(MAX_DAMAGE, true)} hull hits. A friend hovering beside you revives you, or after ${String(RESPAWN_DELAY)} s respawn at home or beside a squadmate.`
      )
    ],
    [blue("Squadrons"), plain(" are up to 4 ships, companions included. An order from anyone reaches every companion in it.")],
    [blue("The season"), plain(" is won when the Nautolan Dreadnought in ring 3 falls; the victory screen then shows everyone's stats.")]
  ];
}
function introContent(touch) {
  return {
    premise: PREMISE,
    hint: touch ? [key("Help"), plain(", top left, opens this again \xB7 tap beside it to close")] : [key("F1"), plain(" opens and closes this \xB7 "), key("Esc"), plain(" closes \xB7 the world keeps playing behind it")],
    controls: touch ? [THUMBS, BUTTONS] : [KEYBOARD, MOUSE],
    sectors: SECTORS,
    extras: extras(touch),
    friends: "Everyone with this link plays in the same world, up to 16 ships."
  };
}
function shareLink(location) {
  return location.origin + location.pathname;
}

// src/introscreen.ts
var COPIED_MS = 2e3;
var IntroScreen = class {
  doc;
  form;
  link;
  copy;
  share;
  closed;
  copiedTimer;
  /** closed runs each time the screen closes. */
  constructor(closed, doc = document) {
    this.closed = closed;
    this.doc = doc;
    this.form = doc.querySelector("#intro-form");
    this.link = doc.querySelector("#intro-link");
    this.copy = doc.querySelector("#intro-copy");
    this.share = doc.querySelector("#intro-share");
    this.form?.addEventListener("submit", (event) => {
      event.preventDefault();
      this.hide();
    });
    this.copy?.addEventListener("click", () => {
      this.copyLink();
    });
    this.share?.addEventListener("click", () => {
      this.shareLink();
    });
  }
  get open() {
    return this.form !== null && !this.form.hidden;
  }
  /** Opens the screen with the controls of the device, keeping the screens behind it from taking focus or clicks. */
  show(touch) {
    if (this.form === null) {
      return;
    }
    this.fill(touch);
    for (const other of this.doc.querySelectorAll(".name-screen")) {
      other.inert = other !== this.form;
    }
    this.form.hidden = false;
    this.form.scrollTop = 0;
    if (!touch) {
      this.doc.querySelector("#intro-play")?.focus({ preventScroll: true });
    }
  }
  hide() {
    if (!this.open || this.form === null) {
      return;
    }
    this.form.hidden = true;
    for (const other of this.doc.querySelectorAll(".name-screen")) {
      other.inert = false;
    }
    this.closed();
  }
  fill(touch) {
    const content = introContent(touch);
    const location = this.doc.defaultView?.location;
    this.text("#intro-hint", content.hint);
    this.text("#intro-premise", content.premise);
    this.doc.querySelector("#intro-friends")?.replaceChildren(content.friends);
    if (this.link !== null && location !== void 0) {
      this.link.value = shareLink(location);
    }
    this.resetCopy();
    if (this.share !== null) {
      this.share.hidden = !touch || typeof this.doc.defaultView?.navigator.share !== "function";
    }
    this.doc.querySelector("#intro-controls")?.replaceChildren(...content.controls.map((column) => this.column(column)));
    this.list("#intro-sectors", content.sectors);
    this.list("#intro-extras", content.extras);
  }
  /** Copies the link and says so for a moment; where the clipboard is out of reach, selects it to copy by hand. */
  copyLink() {
    const link = this.link?.value ?? "";
    const clipboard = this.doc.defaultView?.navigator.clipboard;
    const fallback = () => {
      this.link?.focus();
      this.link?.select();
    };
    if (clipboard === void 0) {
      fallback();
      return;
    }
    clipboard.writeText(link).then(() => {
      this.copied();
    }, fallback);
  }
  copied() {
    const view = this.doc.defaultView;
    if (this.copy === null || view === null) {
      return;
    }
    this.copy.textContent = "Copied";
    this.copy.classList.add("copied");
    view.clearTimeout(this.copiedTimer);
    this.copiedTimer = view.setTimeout(() => {
      this.resetCopy();
    }, COPIED_MS);
  }
  resetCopy() {
    this.doc.defaultView?.clearTimeout(this.copiedTimer);
    this.copiedTimer = void 0;
    if (this.copy !== null) {
      this.copy.textContent = "Copy link";
      this.copy.classList.remove("copied");
    }
  }
  /** Opens the device's share sheet with the link; closing it unshared is fine. */
  shareLink() {
    const nav = this.doc.defaultView?.navigator;
    nav?.share({ title: "Voidmarch", url: this.link?.value ?? "" }).catch(() => void 0);
  }
  text(selector, line) {
    this.doc.querySelector(selector)?.replaceChildren(...this.spans(line));
  }
  list(selector, lines) {
    this.doc.querySelector(selector)?.replaceChildren(
      ...lines.map((line) => {
        const li = this.doc.createElement("li");
        li.append(...this.spans(line));
        return li;
      })
    );
  }
  spans(line) {
    return line.map(({ text, mark }) => {
      if (mark === void 0) {
        return text;
      }
      const el = this.doc.createElement(mark === "key" ? "b" : "span");
      if (mark !== "key") {
        el.className = `mark-${mark}`;
      }
      el.textContent = text;
      return el;
    });
  }
  column(column) {
    const el = this.doc.createElement("div");
    const title = this.doc.createElement("h3");
    title.textContent = column.title;
    const rows = this.doc.createElement("div");
    rows.className = "intro-rows";
    for (const row of column.rows) {
      const keys2 = this.doc.createElement("span");
      keys2.className = column.style === "buttons" ? "intro-keys buttons" : "intro-keys";
      keys2.append(
        ...row.keys.map((k) => {
          if (column.style !== "keys") {
            return k;
          }
          const cap = this.doc.createElement("kbd");
          cap.textContent = k;
          return cap;
        })
      );
      const text = this.doc.createElement("span");
      text.textContent = row.text;
      rows.append(keys2, text);
    }
    el.append(title, rows);
    if (column.note !== void 0) {
      const note = this.doc.createElement("p");
      note.className = "intro-note";
      note.textContent = column.note;
      el.append(note);
    }
    return el;
  }
};

// src/hud.ts
var ASSETS2 = "/static/assets";
var TOAST_FADE_MS = 600;
var HudView = class _HudView {
  root;
  gauge;
  panel;
  toastBox;
  gaugeKey = "";
  panelKey = "";
  toasts = /* @__PURE__ */ new Map();
  fit;
  /** The slot whose drop-up is open (#191). */
  open;
  constructor(fit, doc = document) {
    this.fit = fit;
    this.root = doc.querySelector("#hud");
    this.gauge = doc.querySelector("#hud-gauge");
    this.panel = doc.querySelector("#hud-panel");
    this.toastBox = doc.querySelector("#hud-toasts");
    this.gauge?.addEventListener("pointerdown", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const option = target?.closest("[data-part]");
      const slot = target?.closest("[data-slot]");
      event.preventDefault();
      event.stopPropagation();
      if (option !== null && option !== void 0 && this.open !== void 0) {
        this.fit(this.open, option.dataset.part ?? "");
        this.close();
      } else if (slot !== null && slot !== void 0) {
        const kind = slot.dataset.slot;
        this.setOpen(this.open === kind ? void 0 : kind);
      }
    });
    doc.addEventListener("pointerdown", () => {
      this.close();
    });
  }
  /** Whether a slot's drop-up is open, so the scene's Esc closes it first. */
  get dropOpen() {
    return this.open;
  }
  /** Closes the drop-up, if it's open. */
  close() {
    this.setOpen(void 0);
  }
  setOpen(kind) {
    if (kind === this.open) {
      return;
    }
    this.open = kind;
    this.gaugeKey = "";
  }
  /** The panel's rows as "Label: value", for the E2E tests. */
  get rowTexts() {
    const cells = [...this.panel?.children ?? []].map((el) => el.textContent);
    const rows = [];
    for (let i = 0; i + 1 < cells.length; i += 2) {
      rows.push(`${cells[i] ?? ""}: ${cells[i + 1] ?? ""}`);
    }
    return rows;
  }
  /** The texts of the toasts on screen, fading ones excluded, for the E2E tests. */
  get toastTexts() {
    return [...this.toasts.entries()].filter(([, el]) => !el.classList.contains("gone")).map(([text]) => text);
  }
  update(frame) {
    if (this.root === null) {
      return;
    }
    this.root.hidden = !frame.shown;
    this.drawGauge(frame);
    this.drawPanel(frame.rows);
    this.drawToasts(frame.toasts);
  }
  drawGauge(frame) {
    const key2 = JSON.stringify([frame.slots, frame.hull, frame.shield, this.open]);
    if (this.gauge === null || key2 === this.gaugeKey) {
      return;
    }
    this.gaugeKey = key2;
    const doc = this.gauge.ownerDocument;
    const slots = doc.createElement("div");
    slots.className = "hud-slots";
    for (const slot of frame.slots) {
      const box = doc.createElement("div");
      box.className = slot.kind === this.open ? "hud-slot open" : "hud-slot";
      box.title = `${slot.name} (${slot.key})`;
      box.dataset.slot = slot.kind;
      box.style.borderColor = slot.kind === this.open ? "" : slot.color;
      const keyLabel = doc.createElement("span");
      keyLabel.className = "key";
      keyLabel.textContent = slot.key;
      box.append(_HudView.icon(doc, slot.file), keyLabel);
      slots.append(box);
    }
    const bars = doc.createElement("div");
    bars.className = "hud-bars";
    for (const [label, pips, kind] of [
      ["HULL", frame.hull, "hull"],
      ["SHIELD", frame.shield, "shield"]
    ]) {
      const name = doc.createElement("span");
      name.textContent = label;
      const row = doc.createElement("span");
      row.className = `hud-pips ${kind}`;
      for (let i = 0; i < pips.of; i++) {
        const pip = doc.createElement("span");
        pip.className = i < pips.on ? "pip on" : "pip";
        row.append(pip);
      }
      bars.append(name, row);
    }
    this.gauge.replaceChildren(slots, bars);
    const open = frame.slots.find((s) => s.kind === this.open);
    if (open !== void 0) {
      this.drawDrop(doc, open, slots);
    }
  }
  /** The open slot's drop-up, above it, its icons in one column with the slot's (#191). */
  drawDrop(doc, slot, slots) {
    const drop = doc.createElement("div");
    drop.className = "hud-drop";
    const title = doc.createElement("div");
    title.className = "title";
    title.textContent = `${slot.kind.toUpperCase()} \xB7 ${slot.key} cycles`;
    drop.append(title);
    for (const option of slot.options) {
      const row = doc.createElement("div");
      row.className = option.part === slot.part ? "option fitted" : "option";
      row.dataset.part = option.part;
      const text = doc.createElement("span");
      const name = doc.createElement("span");
      name.className = "name";
      name.textContent = option.name;
      name.style.color = option.color;
      const hint = doc.createElement("span");
      hint.className = "hint";
      hint.textContent = option.hint;
      text.append(name, hint);
      row.append(_HudView.icon(doc, option.file), text);
      drop.append(row);
    }
    this.gauge?.append(drop);
    const slotIcon = slots.querySelector(`[data-slot="${slot.kind}"] i`)?.getBoundingClientRect();
    const listIcon = drop.querySelector(".option i")?.getBoundingClientRect();
    if (slotIcon !== void 0 && listIcon !== void 0) {
      drop.style.left = `${String(drop.offsetLeft + slotIcon.left - listIcon.left)}px`;
    }
  }
  /** The texts of the open drop-up's parts, for the E2E tests. */
  get dropParts() {
    return [...this.gauge?.querySelectorAll(".hud-drop [data-part]") ?? []].map((el) => el.dataset.part ?? "");
  }
  static icon(doc, file) {
    const icon = doc.createElement("i");
    icon.style.backgroundImage = `url(${ASSETS2}/pickups/${file}.png)`;
    return icon;
  }
  drawPanel(rows) {
    const key2 = JSON.stringify(rows);
    if (this.panel === null || key2 === this.panelKey) {
      return;
    }
    this.panelKey = key2;
    const doc = this.panel.ownerDocument;
    this.panel.hidden = rows.length === 0;
    this.panel.replaceChildren(
      ...rows.flatMap((row) => {
        const label = doc.createElement("span");
        label.className = "k";
        label.textContent = row.label;
        const value = doc.createElement("span");
        value.textContent = row.value;
        if (row.alert) {
          value.className = "alert";
        }
        return [label, value];
      })
    );
  }
  drawToasts(texts) {
    if (this.toastBox === null) {
      return;
    }
    const doc = this.toastBox.ownerDocument;
    for (const [text, el] of this.toasts) {
      if (!texts.includes(text) && !el.classList.contains("gone")) {
        el.classList.add("gone");
        setTimeout(() => {
          el.remove();
          if (this.toasts.get(text) === el) {
            this.toasts.delete(text);
          }
        }, TOAST_FADE_MS);
      }
    }
    for (const text of texts) {
      const shown = this.toasts.get(text);
      if (shown !== void 0 && !shown.classList.contains("gone")) {
        continue;
      }
      shown?.remove();
      const el = doc.createElement("div");
      el.className = "hud-toast";
      el.textContent = text;
      this.toastBox.append(el);
      this.toasts.set(text, el);
    }
  }
};

// src/sim/hud.ts
function hullPips(damage) {
  return { on: Math.min(MAX_DAMAGE, Math.max(0, MAX_DAMAGE - Math.floor(damage))), of: MAX_DAMAGE };
}
function shieldPips(shield, strength) {
  return { on: Math.min(strength, Math.max(0, Math.floor(shield))), of: strength };
}
var ORDER_HINTS = {
  escort: "companions fly with you",
  attack: "companions hunt enemies near you",
  guard: "companions shield you",
  hold: "companions hold their spot",
  stealth: "companions hold fire"
};
function joinNames(names) {
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}
function panelRows(state) {
  const rows = [];
  const row = (label, value, alert = false) => {
    rows.push({ label, value, alert });
  };
  const { squadron } = state;
  if (squadron !== void 0) {
    const companions = squadron.companions === 0 ? [] : [`${String(squadron.companions)} companion${squadron.companions === 1 ? "" : "s"}`];
    const others = [...squadron.others, ...companions];
    row("Squadron", others.length === 0 ? squadron.name : `${squadron.name}, with ${joinNames(others)}`);
    const hint = ORDER_HINTS[squadron.mode];
    row("Orders", hint === void 0 ? squadron.order : `${squadron.order}: ${hint}`);
  }
  if (state.hangar !== void 0) {
    row("Hangar", state.hangar === 0 ? "empty" : `${String(state.hangar)} ship${state.hangar === 1 ? "" : "s"} to summon`);
  }
  if (state.companions !== void 0 && state.companions.limit > 0) {
    row("Companions", `${String(state.companions.out)} of ${String(state.companions.limit)} out`);
  }
  if (state.sector !== void 0) {
    const { name, state: what } = state.sector;
    row("You're in", what === "home" ? `${name}, the home sector` : what === "unknown" ? name : `${name}, ${what}`);
  }
  if (state.mission !== void 0 && state.mission !== "") {
    row("Mission", `Clear sector ${state.mission}`);
  }
  if (state.event !== "") {
    row("Alert", state.event, true);
  }
  return rows;
}
function connectionToast(status) {
  switch (status) {
    case void 0:
      return "Playing alone";
    case "online":
      return void 0;
    case "full":
      return "The frontier is full, try again soon";
    case "offline":
      return "Offline, reconnecting";
    default:
      return "Connecting";
  }
}

// src/sim/standings.ts
var PERCENT = 100;
var SECONDS_PER_HOUR = 3600;
var HOURS_PER_DAY = 24;
function hitRate(hits, shots) {
  return shots === 0 ? "\u2013" : `${String(Math.round(PERCENT * hits / shots))}%`;
}
function standingRows(players, playerId, top = STANDINGS_TOP) {
  const row = (p) => ({
    name: p.name,
    kills: String(p.kills),
    hitRate: hitRate(p.hits, p.shots),
    killsDeaths: `${String(p.kills)} / ${String(p.deaths)}`,
    you: p.playerId === playerId
  });
  const rows = players.slice(0, top).map(row);
  const own = players.slice(top).find((p) => p.playerId === playerId);
  if (own !== void 0) {
    rows.push(row(own));
  }
  return rows;
}
function seasonAge(startedSeconds, nowSeconds) {
  const hours = Math.max(0, Math.floor((nowSeconds - startedSeconds) / SECONDS_PER_HOUR));
  return `day ${String(Math.floor(hours / HOURS_PER_DAY) + 1)} \xB7 ${String(hours)} h`;
}
function missionStatsLine(mission, minShots = MISSION_AIM_MIN_SHOTS) {
  if (mission.length === 0) {
    return void 0;
  }
  const parts = [];
  const killer = mission.reduce((best, p) => p.kills > best.kills ? p : best);
  if (killer.kills > 0) {
    parts.push(`Most kills: ${killer.name} ${String(killer.kills)}`);
  }
  const aimers = mission.filter((p) => p.shots >= minShots);
  if (aimers.length > 0) {
    const aim = aimers.reduce((best, p) => p.hits / p.shots > best.hits / best.shots ? p : best);
    parts.push(`Best aim: ${aim.name} ${hitRate(aim.hits, aim.shots)}`);
  }
  const down = mission.filter((p) => p.deaths > 0).map((p) => p.name);
  parts.push(down.length === 0 ? "Nobody went down" : `Went down: ${down.join(", ")}`);
  return parts.join(" \xB7 ");
}

// src/victory.ts
var SECONDS_PER_MINUTE = 60;
var MINUTES_PER_HOUR = 60;
function formatTook(seconds) {
  const minutes = Math.floor(Math.max(0, seconds) / SECONDS_PER_MINUTE);
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;
  return hours === 0 ? `${String(rest)} min` : `${String(hours)} h ${String(rest)} min`;
}
function victoryRows(result, playerId) {
  const sum = (pick) => result.players.reduce((total, p) => total + pick(p), 0);
  const rows = result.players.map((p) => ({
    name: p.name,
    kills: String(p.kills),
    companionKills: String(p.companionKills),
    hitRate: hitRate(p.hits, p.shots),
    killsDeaths: `${String(p.kills)} / ${String(p.deaths)}`,
    rescues: String(p.rescues),
    sectors: String(p.sectors),
    you: p.playerId === playerId
  }));
  const kills = sum((p) => p.kills);
  rows.push({
    name: "Everyone",
    kills: String(kills),
    companionKills: String(sum((p) => p.companionKills)),
    hitRate: hitRate(
      sum((p) => p.hits),
      sum((p) => p.shots)
    ),
    killsDeaths: `${String(kills)} / ${String(sum((p) => p.deaths))}`,
    rescues: String(sum((p) => p.rescues)),
    sectors: String(result.sectors),
    you: false
  });
  return rows;
}
var COLUMNS = ["name", "kills", "companionKills", "hitRate", "killsDeaths", "rescues", "sectors"];
var VictoryScreen = class _VictoryScreen {
  form;
  took;
  body;
  totals;
  constructor(doc = document) {
    this.form = doc.querySelector("#victory-form");
    this.took = doc.querySelector("#victory-took");
    this.body = doc.querySelector("#victory-players");
    this.totals = doc.querySelector("#victory-totals");
    this.form?.addEventListener("submit", (event) => {
      event.preventDefault();
    });
  }
  get open() {
    return this.form !== null && !this.form.hidden;
  }
  show(result, playerId) {
    if (this.form === null) {
      return;
    }
    const doc = this.form.ownerDocument;
    if (this.took !== null) {
      this.took.textContent = `in ${formatTook(result.seconds)}`;
    }
    const rows = victoryRows(result, playerId);
    const everyone = rows.pop();
    this.body?.replaceChildren(...rows.map((row) => _VictoryScreen.row(doc, row)));
    this.totals?.replaceChildren(...everyone === void 0 ? [] : [_VictoryScreen.row(doc, everyone)]);
    this.form.hidden = false;
  }
  hide() {
    if (this.form !== null) {
      this.form.hidden = true;
    }
  }
  static row(doc, row) {
    const tr = doc.createElement("tr");
    if (row.you) {
      tr.className = "you";
    }
    for (const column of COLUMNS) {
      const td = doc.createElement("td");
      td.textContent = row[column];
      if (column === "companionKills") {
        td.className = "dim";
      }
      tr.append(td);
    }
    return tr;
  }
};

// src/standings.ts
var COLUMNS2 = ["name", "kills", "hitRate", "killsDeaths"];
var HEADINGS = ["Player", "Kills", "Hit rate", "Kills / deaths"];
var StandingsPanel = class _StandingsPanel {
  el;
  drawn = -1;
  constructor(selector, doc = document) {
    this.el = doc.querySelector(selector);
  }
  /** How many rows it shows, or 0 while hidden, for the E2E tests. */
  get rows() {
    return this.el === null || this.el.hidden ? 0 : this.el.querySelectorAll("tbody tr").length;
  }
  /**
   * Shows the table when show is set and anyone has stats, redrawing it only
   * when version moved; hides it otherwise.
   */
  update(show, players, playerId, started, version) {
    if (this.el === null) {
      return;
    }
    const visible = show && players.length > 0;
    this.el.hidden = !visible;
    if (!visible || version === this.drawn) {
      return;
    }
    this.drawn = version;
    const doc = this.el.ownerDocument;
    const title = doc.createElement("h3");
    title.textContent = "Season so far";
    const age = doc.createElement("span");
    age.textContent = started > 0 ? seasonAge(started, Date.now() / 1e3) : "";
    title.append(age);
    const table = doc.createElement("table");
    const head = doc.createElement("tr");
    for (const heading of HEADINGS) {
      const th = doc.createElement("th");
      th.textContent = heading;
      head.append(th);
    }
    const thead = doc.createElement("thead");
    thead.append(head);
    const body = doc.createElement("tbody");
    body.append(...standingRows(players, playerId).map((row) => _StandingsPanel.row(doc, row)));
    table.append(thead, body);
    this.el.replaceChildren(title, table);
  }
  static row(doc, row) {
    const tr = doc.createElement("tr");
    if (row.you) {
      tr.className = "you";
    }
    for (const column of COLUMNS2) {
      const td = doc.createElement("td");
      td.textContent = row[column];
      tr.append(td);
    }
    return tr;
  }
};

// src/scenes/mapview.ts
import "./vendor/phaser.js";

// src/sim/sectormap.ts
function layoutForWidth(x, y, width) {
  return { x, y, scale: width / (2 * GRID_EXTENT.x) };
}
function layoutForHeight(x, y, height) {
  return { x, y, scale: height / (2 * GRID_EXTENT.y) };
}
function minimapLayout(width, dpr) {
  const miniWidth = MINIMAP_WIDTH_PX * dpr;
  const inset = MINIMAP_INSET_PX * dpr;
  const miniHeight = mapSize(layoutForWidth(0, 0, miniWidth)).height;
  return layoutForWidth(width - inset - miniWidth / 2, inset + miniHeight / 2, miniWidth);
}
function mapSize(layout) {
  return { width: 2 * GRID_EXTENT.x * layout.scale, height: 2 * GRID_EXTENT.y * layout.scale };
}
var toScreen = (layout, p) => ({ x: layout.x + p.x * layout.scale, y: layout.y + p.y * layout.scale });
function sectorFill(name, state, flash) {
  if (flash && state.attack === name) {
    return EVENT_COLOR;
  }
  if (!sectorOpen(name, state.frontier)) {
    return MAP_CLOSED_COLOR;
  }
  if (name === HOME_SECTOR) {
    return MAP_HOME_COLOR;
  }
  if (state.cleared.has(name)) {
    return MAP_CLEARED_COLOR;
  }
  const ring2 = sectorRing(name) ?? 0;
  return MAP_HOSTILE_COLORS[Math.min(ring2, MAP_HOSTILE_COLORS.length - 1)] ?? EVENT_COLOR;
}
function drawnMap(state, layout, flash) {
  const outlines = /* @__PURE__ */ new Map();
  for (const m of state.missions) {
    if (m.own || !outlines.has(m.sector)) {
      outlines.set(m.sector, m.own ? MISSION_COLOR : MAP_OTHER_MISSION_COLOR);
    }
  }
  const sectors = SECTOR_NAMES.map((name) => ({
    name,
    center: toScreen(layout, sectorCenter(name) ?? { x: 0, y: 0 }),
    corners: sectorCorners(name).map((c) => toScreen(layout, c)),
    fill: sectorFill(name, state, flash),
    outline: outlines.get(name)
  }));
  const bySector = (points) => [...new Set(points.flatMap((p) => sectorName(p.x, p.y) ?? []))].map((name) => toScreen(layout, sectorCenter(name) ?? { x: 0, y: 0 }));
  const frigates = bySector(state.frigates);
  const dreadnoughts = bySector(state.dreadnoughts);
  return {
    sectors,
    frigates,
    dreadnoughts,
    you: toScreen(layout, state.you),
    squadmates: state.squadmates.map((s) => ({ ...toScreen(layout, s), color: s.color }))
  };
}
function sectorAtScreen(layout, x, y) {
  return sectorName((x - layout.x) / layout.scale, (y - layout.y) / layout.scale);
}
function canPick(name, cleared, frontier) {
  return name !== void 0 && name !== HOME_SECTOR && !cleared.has(name) && sectorOpen(name, frontier);
}
function mapTitle(mapName, cleared) {
  const ringOne = SECTOR_NAMES.filter((name) => sectorRing(name) === 1);
  const done = ringOne.filter((name) => cleared.has(name)).length;
  const title = mapName === "" ? "SECTORS" : mapName.toUpperCase();
  return `${title}  \xB7  ${String(done)} of ${String(ringOne.length)} ring-1 sectors cleared  \xB7  Tab closes`;
}
function missionsLine(missions) {
  return missions.map((m) => `${m.squadron} \u2192 ${m.sector}`).join(" \xB7 ");
}
function mapLegend(missions, dreadnought = false) {
  const own = missions.find((m) => m.own);
  const sent = missions.map((m) => `\u25A0 ${m.squadron}${m.own ? " (you)" : ""}: ${m.sector}`);
  const bosses = dreadnought ? ["\u25B2 Frigate", "\u25B2 Dreadnought"] : ["\u25B2 Frigate"];
  return [
    [...sent, ...bosses, "\u25CF you", "\u25CF squadmate"].join("     "),
    own === void 0 ? "" : `Click an uncleared sector to send ${own.squadron} there.`
  ];
}

// src/scenes/mapview.ts
var FONT_PX = 12;
var SMALL_FONT_PX = 11;
var PANEL_PAD_X_PX = 60;
var PANEL_PAD_TOP_PX = 34;
var PANEL_PAD_BOTTOM_PX = 56;
var PANEL_CORNER_PX = 6;
var TEXT_GAP_PX = 10;
var FRIGATE_SHARE = 0.3;
var FRIGATE_MIN_PX = 4;
var YOU_SHARE_OF_FRIGATE = 0.45;
var YOU_MIN_PX = 2;
var SQUADMATE_SHARE_OF_YOU = 0.8;
var NAME_LIFT_SHARE = 0.55;
var DREADNOUGHT_MARKER = 1.7;
var MAP_DEPTH = 10;
var MapView = class {
  open = false;
  mini;
  miniLabel;
  full;
  title;
  legend;
  names = [];
  miniLayout = layoutForWidth(0, 0, MINIMAP_WIDTH_PX);
  fullLayout = layoutForHeight(0, 0, FULL_MAP_HEIGHT_PX);
  dpr = 1;
  scene;
  hideFromWorld;
  constructor(scene, hideFromWorld) {
    const text = (size) => scene.add.text(0, 0, "", { fontFamily: UI_FONT, fontSize: `${String(size)}px`, color: "#d8f8ff", align: "center" }).setShadow(1, 1, "#000000", 0);
    this.mini = scene.add.graphics();
    this.miniLabel = text(SMALL_FONT_PX).setOrigin(0.5, 0);
    this.full = scene.add.graphics();
    this.title = text(FONT_PX).setOrigin(0.5, 0);
    this.legend = text(FONT_PX).setOrigin(0.5, 0);
    const objects = [this.mini, this.miniLabel, this.full, this.title, this.legend];
    for (const o of [this.mini, this.miniLabel, this.full, this.title, this.legend]) {
      o.setDepth(MAP_DEPTH);
    }
    this.setFullVisible(false);
    hideFromWorld(objects);
    this.scene = scene;
    this.hideFromWorld = hideFromWorld;
  }
  /** Places both maps for a screen of width by height device pixels. */
  resize(width, height, dpr) {
    this.dpr = dpr;
    this.miniLayout = minimapLayout(width, dpr);
    const miniBottom = this.miniLayout.y + mapSize(this.miniLayout).height / 2;
    this.miniLabel.setFontSize(SMALL_FONT_PX * dpr).setPosition(this.miniLayout.x, miniBottom + MAP_MARGIN_PX * dpr / 2);
    const fullHeight = Math.min(FULL_MAP_HEIGHT_PX * dpr, height - (PANEL_PAD_TOP_PX + PANEL_PAD_BOTTOM_PX) * dpr);
    this.fullLayout = layoutForHeight(width / 2, height / 2 - (PANEL_PAD_BOTTOM_PX - PANEL_PAD_TOP_PX) * dpr / 2, fullHeight);
    this.title.setFontSize(FONT_PX * dpr);
    this.legend.setFontSize(FONT_PX * dpr);
    for (const name of this.names) {
      name.setFontSize(SMALL_FONT_PX * dpr);
    }
  }
  /** Where the full map's grid sits. */
  get layout() {
    return this.fullLayout;
  }
  /** Opens or closes the full map. */
  toggle() {
    this.open = !this.open;
    this.setFullVisible(this.open);
  }
  close() {
    this.open = false;
    this.setFullVisible(false);
  }
  /** Draws both maps; nothing when there's no state, offline. */
  draw(state, mapName, nowMs) {
    this.mini.clear();
    this.full.clear();
    if (state === void 0) {
      this.miniLabel.setText("");
      this.close();
      return;
    }
    const flash = Math.floor(nowMs / MAP_FLASH_MS) % 2 === 0;
    this.drawGrid(this.mini, drawnMap(state, this.miniLayout, flash), this.miniLayout, 1, 2, MINIMAP_FILL_ALPHA);
    this.miniLabel.setText(missionsLine(state.missions));
    if (!this.open) {
      return;
    }
    const drawn = drawnMap(state, this.fullLayout, flash);
    const size = mapSize(this.fullLayout);
    const top = this.fullLayout.y - size.height / 2 - PANEL_PAD_TOP_PX * this.dpr;
    const bottom = this.fullLayout.y + size.height / 2 + PANEL_PAD_BOTTOM_PX * this.dpr;
    const halfWidth = size.width / 2 + PANEL_PAD_X_PX * this.dpr;
    this.full.fillStyle(MAP_PANEL_COLOR, MAP_PANEL_ALPHA).fillRoundedRect(this.fullLayout.x - halfWidth, top, halfWidth * 2, bottom - top, PANEL_CORNER_PX * this.dpr);
    this.drawGrid(this.full, drawn, this.fullLayout, 2, 3, MAP_FILL_ALPHA);
    this.drawNames(drawn);
    this.title.setText(mapTitle(mapName, state.cleared)).setPosition(this.fullLayout.x, top + TEXT_GAP_PX * this.dpr);
    const legendY = this.fullLayout.y + size.height / 2 + TEXT_GAP_PX * this.dpr;
    this.legend.setText(mapLegend(state.missions, state.dreadnoughts.length > 0).join("\n")).setPosition(this.fullLayout.x, legendY);
  }
  /** Whether (x, y) is on the minimap, which a tap opens the full map from (#180). */
  onMinimap(x, y) {
    return within(this.miniLayout, x, y);
  }
  /** Whether (x, y) is on the open full map's grid, so a tap beside it closes it (#180). */
  onFull(x, y) {
    return this.open && within(this.fullLayout, x, y);
  }
  /** The sector a click on the open full map picks as the mission, if it can be picked. */
  pick(x, y, cleared, frontier) {
    if (!this.open) {
      return void 0;
    }
    const name = sectorAtScreen(this.fullLayout, x, y);
    return canPick(name, cleared, frontier) ? name : void 0;
  }
  drawGrid(g, drawn, layout, edge, outline, fill) {
    const scale = this.dpr;
    for (const s of drawn.sectors) {
      g.fillStyle(s.fill, fill);
      polygon(g, s.corners);
      g.fillPath();
      g.lineStyle(edge * scale, MAP_EDGE_COLOR, 1);
      polygon(g, s.corners);
      g.strokePath();
    }
    for (const s of drawn.sectors) {
      if (s.outline !== void 0) {
        g.lineStyle(outline * scale, s.outline, 1);
        polygon(g, s.corners);
        g.strokePath();
      }
    }
    const marker = Math.max(FRIGATE_MIN_PX * scale, SECTOR_RADIUS * layout.scale * FRIGATE_SHARE);
    g.fillStyle(MAP_FRIGATE_COLOR, 1);
    for (const f of drawn.frigates) {
      g.fillTriangle(f.x, f.y - marker, f.x - marker, f.y + marker, f.x + marker, f.y + marker);
    }
    const big = marker * DREADNOUGHT_MARKER;
    for (const d of drawn.dreadnoughts) {
      g.fillTriangle(d.x, d.y - big, d.x - big, d.y + big, d.x + big, d.y + big);
    }
    const dot = Math.max(YOU_MIN_PX * scale, marker * YOU_SHARE_OF_FRIGATE);
    for (const s of drawn.squadmates) {
      g.fillStyle(s.color, 1).fillCircle(s.x, s.y, dot * SQUADMATE_SHARE_OF_YOU);
    }
    g.fillStyle(MAP_YOU_COLOR, 1).fillCircle(drawn.you.x, drawn.you.y, dot);
  }
  drawNames(drawn) {
    while (this.names.length < drawn.sectors.length) {
      const text = this.scene.add.text(0, 0, "", { fontFamily: UI_FONT, fontSize: `${String(SMALL_FONT_PX * this.dpr)}px`, color: "#d8f8ff" }).setOrigin(0.5).setDepth(MAP_DEPTH + 1).setShadow(1, 1, "#000000", 0);
      this.hideFromWorld([text]);
      this.names.push(text);
    }
    const lift = SECTOR_RADIUS * this.fullLayout.scale * NAME_LIFT_SHARE;
    drawn.sectors.forEach((s, i) => {
      this.names[i]?.setText(s.name).setPosition(s.center.x, s.center.y - lift).setVisible(true);
    });
  }
  setFullVisible(visible) {
    this.full.setVisible(visible);
    this.title.setVisible(visible);
    this.legend.setVisible(visible);
    for (const name of this.names) {
      name.setVisible(visible);
    }
  }
};
function polygon(g, corners) {
  const [first, ...rest] = corners;
  if (first === void 0) {
    return;
  }
  g.beginPath().moveTo(first.x, first.y);
  for (const c of rest) {
    g.lineTo(c.x, c.y);
  }
  g.closePath();
}
function within(layout, x, y) {
  const size = mapSize(layout);
  return Math.abs(x - layout.x) <= size.width / 2 && Math.abs(y - layout.y) <= size.height / 2;
}

// src/simwasm.ts
var SCRATCH_SIZE = LAYOUT.scratchSize;
var PATTERN_SIZE = 5;
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
  /** Applies a hit by a projectile of kind on the ship from direction from, as shipScan reports it (a Torpedo takes two steps); true when the shield took any. */
  takeHit(from, kind) {
    const absorbed = this.exports.takeHit(from, PROJECTILE_KINDS.indexOf(kind)) !== 0;
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
  /** Opens home and the rings up to openRings, and the sectors in opened on their own (#123). */
  setFrontier(openRings, opened) {
    this.exports.setFrontier(openRings);
    for (const name of opened) {
      const hex2 = sectorAxial(name);
      if (hex2 !== void 0) {
        this.exports.openSector(hex2.q, hex2.r);
      }
    }
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
  enemyPattern(kind, faction, x, y, angle, seed) {
    const n = this.exports.enemyPattern(ENEMY_KINDS.indexOf(kind), ENEMY_FACTIONS.indexOf(faction), x, y, angle, seed >>> 0);
    const scratch = this.scratch();
    const out = [];
    for (let i = 0; i < n; i++) {
      const b = i * PATTERN_SIZE;
      out.push({
        kind: at(PROJECTILE_KINDS, scratch[b] ?? 0, PROJECTILE_KINDS[0]),
        x: scratch[b + 1] ?? x,
        y: scratch[b + 2] ?? y,
        angle: scratch[b + 3] ?? angle,
        curve: scratch[b + 4] ?? 0
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
      shot.curve ?? 0,
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

// src/sim/forcefield.ts
function distanceToSide(side, p) {
  const dx = side.b.x - side.a.x;
  const dy = side.b.y - side.a.y;
  const lengthSquared = dx * dx + dy * dy;
  const u = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - side.a.x) * dx + (p.y - side.a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (side.a.x + dx * u), p.y - (side.a.y + dy * u));
}
function nearestSide(sides, p) {
  return sides.reduce((nearest, side) => Math.min(nearest, distanceToSide(side, p)), Number.POSITIVE_INFINITY);
}
function fieldSides(sides, ship, t) {
  return sides.filter((side) => distanceToSide(side, ship) <= FIELD_DRAW_RANGE).map((side) => sampleSide(side, ship, t));
}
function sampleSide(side, ship, t) {
  const length = Math.hypot(side.b.x - side.a.x, side.b.y - side.a.y);
  const nx = -(side.b.y - side.a.y) / length;
  const ny = (side.b.x - side.a.x) / length;
  const steps = Math.ceil(length / FIELD_STEP);
  const [r1, r2, r3, r4] = FIELD_RIPPLES;
  const wave = (r, s) => r.amplitude * Math.sin(s * r.along + t * r.speed + r.phase);
  const samples = [];
  for (let i = 0; i <= steps; i++) {
    const s = i / steps * length;
    const x = side.a.x + (side.b.x - side.a.x) * (i / steps);
    const y = side.a.y + (side.b.y - side.a.y) * (i / steps);
    const flare = Math.max(0, 1 - Math.hypot(ship.x - x, ship.y - y) / FIELD_FLARE_RANGE) ** 2;
    const swell = 1 + flare * FIELD_FLARE_SWELL;
    const jitter2 = Math.sin(s * 0.9 + t * 31) * flare * FIELD_JITTER;
    const one = (wave(r1, s) + wave(r2, s)) * swell + jitter2;
    const two = (wave(r3, s) + wave(r4, s)) * swell - jitter2;
    samples.push({
      x: x + nx * one,
      y: y + ny * one,
      x2: x + nx * two,
      y2: y + ny * two,
      flare,
      flicker: 0.65 + 0.35 * Math.sin(t * 9 + s * 0.021) * Math.sin(t * 13.7 - s * 9e-3)
    });
  }
  return { samples, nx, ny };
}
function fieldColor(flare) {
  const channel = (shift) => {
    const from = FIELD_COLOR >> shift & 255;
    const to = FIELD_HOT_COLOR >> shift & 255;
    return Math.round(from + (to - from) * flare) << shift;
  };
  return channel(16) | channel(8) | channel(0);
}
function sparks(i, t) {
  return Math.sin(i * 12.9898 + Math.floor(t * 20) * 78.233) > 0.93;
}
function zapVolume(distance, downed) {
  if (downed || distance >= WORLD_EDGE_BAND) {
    return 0;
  }
  return FIELD_ZAP_VOLUME * (0.4 + 0.6 * (1 - Math.max(0, distance) / WORLD_EDGE_BAND));
}

// src/sim/touch.ts
function touchUnit(height, dpr) {
  const scale = Math.min(1, Math.max(TOUCH_MIN_SCALE, height / dpr / TOUCH_FULL_HEIGHT_PX));
  return dpr * scale;
}
function touchButtons(screen) {
  const dpr = touchUnit(screen.height, screen.dpr);
  const small = { y: TOUCH_EDGE_PX * dpr, height: TOUCH_BUTTON_PX * dpr * TOUCH_SMALL_SHARE, gold: false };
  const settings = {
    ...small,
    button: "settings",
    label: "Settings",
    x: TOUCH_EDGE_PX * dpr + (screen.insetLeft ?? 0),
    width: TOUCH_BUTTON_WIDTH_PX * dpr * TOUCH_SMALL_SHARE
  };
  const help = { ...settings, button: "help", label: "Help", x: settings.x + settings.width + TOUCH_BUTTON_GAP_PX * dpr };
  const switcher = screen.fullscreen === void 0 ? [] : [
    {
      ...small,
      button: "fullscreen",
      label: screen.fullscreen ? "Windowed" : "Full screen",
      x: help.x + help.width + TOUCH_BUTTON_GAP_PX * dpr,
      width: TOUCH_WIDE_BUTTON_PX * dpr * TOUCH_SMALL_SHARE
    }
  ];
  return [...playButtons(screen, dpr), settings, help, ...switcher];
}
function playButtons(screen, dpr) {
  const { width, height } = screen;
  const h = TOUCH_BUTTON_PX * dpr;
  const gap = TOUCH_BUTTON_GAP_PX * dpr;
  if (screen.down) {
    if (!screen.canRespawn) {
      return [];
    }
    const wide = TOUCH_WIDE_BUTTON_PX * dpr;
    const respawns = [{ button: "respawnHome", label: "Respawn at home", gold: true }];
    if (screen.beside !== void 0) {
      respawns.push({ button: "respawnBeside", label: `Respawn beside ${screen.beside}`, gold: false });
    }
    const total = respawns.length * wide + (respawns.length - 1) * gap;
    const left = (width - total) / 2;
    return respawns.map((r, i) => ({ ...r, x: left + i * (wide + gap), y: height * TOUCH_RESPAWN_Y, width: wide, height: h }));
  }
  const w = TOUCH_BUTTON_WIDTH_PX * dpr;
  const right = width - TOUCH_EDGE_PX * dpr - w - (screen.insetRight ?? 0);
  const top = height * TOUCH_BUTTONS_Y;
  const buttons = [
    { button: "summon", label: "Summon", x: right, y: top, width: w, height: h, gold: false },
    { button: "orders", label: "Orders", x: right, y: top + h + gap, width: w, height: h, gold: false }
  ];
  return buttons;
}
function buttonAt(buttons, x, y) {
  return buttons.find((b) => x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height);
}
var TouchControls = class {
  tracks = /* @__PURE__ */ new Map();
  dpr = 1;
  /**
   * Starts touch id at (x, y) and returns what it does; undefined when that
   * stick is taken already. unit is touchUnit's: device pixels per CSS pixel
   * of touch UI.
   */
  start(id, x, y, width, buttons, onMinimap, unit) {
    this.dpr = unit;
    let role = buttonAt(buttons, x, y)?.button ?? (onMinimap ? "map" : void 0);
    if (role === void 0) {
      const stick = x < width / 2 ? "move" : "aim";
      role = this.held(stick) ? void 0 : stick;
    }
    if (role !== void 0) {
      this.tracks.set(id, { role, originX: x, originY: y, x, y });
    }
    return role;
  }
  /**
   * Moves touch id to (x, y). A touch that started on the minimap and moves
   * becomes the aim stick, if that's free: only a tap opens the map, since on
   * a phone the minimap covers much of where the aiming thumb lands.
   */
  moveTo(id, x, y) {
    const t = this.tracks.get(id);
    if (t === void 0) {
      return;
    }
    t.x = x;
    t.y = y;
    const moved = Math.hypot(x - t.originX, y - t.originY) > TOUCH_STICK_RADIUS_PX * this.dpr * TOUCH_DEAD_ZONE;
    if (t.role === "map" && moved && !this.held("aim")) {
      t.role = "aim";
    }
  }
  /** Ends touch id and returns what it was doing. */
  end(id) {
    const t = this.tracks.get(id);
    this.tracks.delete(id);
    return t?.role;
  }
  /** Lets go of every touch, as when the window loses focus. */
  clear() {
    this.tracks.clear();
  }
  /** Whether a touch is doing role. */
  held(role) {
    return [...this.tracks.values()].some((t) => t.role === role);
  }
  /** Where the touch doing role is now, if any. */
  position(role) {
    const t = this.track(role);
    return t === void 0 ? void 0 : { x: t.x, y: t.y };
  }
  /** A stick's deflection: its offset over its reach, at most length 1, zero inside the dead zone. */
  stick(role) {
    const t = this.track(role);
    if (t === void 0) {
      return { x: 0, y: 0 };
    }
    const radius = TOUCH_STICK_RADIUS_PX * this.dpr;
    const x = (t.x - t.originX) / radius;
    const y = (t.y - t.originY) / radius;
    const length = Math.hypot(x, y);
    if (length < TOUCH_DEAD_ZONE) {
      return { x: 0, y: 0 };
    }
    return length > 1 ? { x: x / length, y: y / length } : { x, y };
  }
  /** The aim stick's direction while it's pushed past the dead zone, as a unit vector. */
  aim() {
    const { x, y } = this.stick("aim");
    const length = Math.hypot(x, y);
    return length === 0 ? void 0 : { x: x / length, y: y / length };
  }
  /** Whether the aim stick fires: pushed past the dead zone. */
  get firing() {
    return this.aim() !== void 0;
  }
  /** The sticks being held, for drawing: where each started, and its knob, kept within reach. */
  sticks() {
    const radius = TOUCH_STICK_RADIUS_PX * this.dpr;
    const out = [];
    for (const t of this.tracks.values()) {
      if (t.role !== "move" && t.role !== "aim") {
        continue;
      }
      const dx = t.x - t.originX;
      const dy = t.y - t.originY;
      const scale = Math.min(1, radius / Math.max(Math.hypot(dx, dy), Number.EPSILON));
      out.push({
        role: t.role,
        origin: { x: t.originX, y: t.originY },
        knob: { x: t.originX + dx * scale, y: t.originY + dy * scale },
        firing: t.role === "aim" && this.firing
      });
    }
    return out;
  }
  track(role) {
    return [...this.tracks.values()].find((t) => t.role === role);
  }
};
function touchMode(matches, search) {
  const asked = new URLSearchParams(search).get("touch");
  if (asked !== null) {
    return asked === "1";
  }
  return matches("(pointer: coarse)") && !matches("(any-pointer: fine)");
}

// src/sim/music.ts
function musicPlace(sector, victory) {
  if (victory) {
    return "ending";
  }
  switch (sector === void 0 ? void 0 : sectorRing(sector)) {
    case 0:
      return "home";
    case 1:
      return "ring1";
    case 2:
      return "ring2";
    default:
      return "ring3";
  }
}

// src/sim/world.ts
function asteroidField(seed = ASTEROID_SEED, count = ASTEROID_COUNT) {
  const random = seededRandom(seed);
  const field = [];
  const span = WORLD_APOTHEM - WORLD_EDGE_BAND;
  while (field.length < count) {
    const x = (random() * 2 - 1) * span;
    const y = (random() * 2 - 1) * span * 2 / Math.sqrt(3);
    const rotation = Math.floor(random() * 4) * (Math.PI / 2);
    const flip = random() < 0.5;
    if (Math.hypot(x, y) >= ASTEROID_CLEAR_RADIUS && worldReach(x, y) <= span) {
      field.push({ x, y, rotation, flip });
    }
  }
  return field;
}
function worldReach(x, y) {
  const slant = y * Math.sqrt(3) / 2;
  return Math.max(Math.abs(x), Math.abs(x / 2 + slant), Math.abs(-x / 2 + slant));
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
      this.focusPick();
    }
  }
  /** Gives the picked squadron's Join the focus, so Enter joins it. */
  focusPick() {
    this.list?.querySelector(".picked button")?.focus();
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
var BOSSES = {
  frigate: { name: "FRIGATE", shield: FRIGATE_SHIELD },
  dreadnought: { name: "DREADNOUGHT", shield: DREADNOUGHT_SHIELD }
};
function bossBar(bosses, x, y) {
  let nearest;
  let distance = FRIGATE_REACH;
  for (const boss2 of bosses) {
    const d = Math.hypot(boss2.x - x, boss2.y - y);
    if (d <= distance && BOSSES[boss2.kind] !== void 0) {
      nearest = boss2;
      distance = d;
    }
  }
  const boss = nearest === void 0 ? void 0 : BOSSES[nearest.kind];
  if (nearest === void 0 || boss === void 0 || nearest.maxHp <= 0) {
    return void 0;
  }
  const hp = Math.max(0, Math.ceil(nearest.hp));
  const max = Math.round(nearest.maxHp);
  const scaled = nearest.scaledFor > 0 ? ` \xB7 scaled for ${String(nearest.scaledFor)} online` : "";
  return {
    name: `${FACTION_NAMES[nearest.faction].toUpperCase()} ${boss.name}`,
    health: Math.min(hp / max, 1),
    shield: Math.min(Math.max(nearest.shield / boss.shield, 0), 1),
    text: `${String(hp)} / ${String(max)}${scaled}`
  };
}

// src/scenes/audio.ts
import Phaser3 from "./vendor/phaser.js";

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
function randomVariant(variants, last, random) {
  const others = variants.length > 1 ? variants.filter((v) => v !== last) : variants;
  return others[Math.floor(random() * others.length)];
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
var TELEPORT_VOLUME = 0.3;
var MUSIC_VOLUME = 0.3;
var MUSIC_FADE_MS = 2e3;
var ShipAudio = class {
  engine;
  engineId;
  /** The track playing or fading in, and those fading out. */
  music;
  fading = /* @__PURE__ */ new Set();
  place = "home";
  awaitingUnlock = false;
  /** Whether the next track fades in: after a place change, not at the start or when the music is switched on. */
  fadeInNext = false;
  musicLoaded = false;
  shots = 0;
  lastZap;
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
    if (sound instanceof Phaser3.Sound.WebAudioSoundManager) {
      return "webaudio";
    }
    return sound instanceof Phaser3.Sound.HTML5AudioSoundManager ? "html5" : "none";
  }
  /** The key of the playing track, or null. */
  get playingMusic() {
    return this.music?.isPlaying === true ? this.music.key : null;
  }
  /** Where the music thinks the ship is. */
  get musicPlace() {
    return this.place;
  }
  /** The playing track's volume, 0 with none. */
  get musicVolume() {
    return this.music?.isPlaying === true ? this.music.volume : 0;
  }
  /** How many tracks are still fading out. */
  get fadingMusic() {
    return this.fading.size;
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
      const key2 = CHARGE_SOUNDS[weapon];
      if (key2 !== void 0) {
        this.scene.sound.play(key2, { volume: CHARGE_VOLUME, detune: CHARGE_DETUNE });
      }
    }
    const volleys = /* @__PURE__ */ new Set();
    for (const shot of events.shots) {
      const volley = WEAPON_STATS[shot.weapon].alternate ? `${shot.weapon}-${shot.muzzle}-${volleys.size}` : shot.weapon;
      if (volleys.has(volley)) {
        continue;
      }
      volleys.add(volley);
      const key2 = nextVariant(SHOT_SOUNDS[shot.weapon], this.shots++);
      if (key2 !== void 0) {
        this.scene.sound.play(key2, { volume: SHOT_VOLUME, detune: shotDetune(Math.random) });
      }
    }
    for (const expired of events.expired) {
      const key2 = isWeapon(expired.kind) ? EXPIRE_SOUNDS[expired.kind] : void 0;
      if (key2 !== void 0) {
        this.scene.sound.play(key2, { volume: EXPIRE_VOLUME, detune: shotDetune(Math.random) });
      }
    }
  }
  /** Another player's shot: the same sound, quieter. */
  remoteShot(weapon) {
    const key2 = nextVariant(SHOT_SOUNDS[weapon], this.shots++);
    if (key2 !== void 0) {
      this.scene.sound.play(key2, { volume: SHOT_VOLUME * REMOTE_SHOT_VOLUME, detune: shotDetune(Math.random) });
    }
  }
  /** An enemy's shot: their own laser, soft and a little low. */
  enemyShot() {
    this.scene.sound.play(ENEMY_SHOT_SOUND, { volume: ENEMY_SHOT_VOLUME, detune: ENEMY_SHOT_DETUNE + shotDetune(Math.random) });
  }
  enemyDestroyed() {
    this.scene.sound.play(ENEMY_EXPLOSION_SOUND, { volume: EXPIRE_VOLUME, detune: shotDetune(Math.random) });
  }
  /** A derelict teleporting away (#190). */
  teleported() {
    this.scene.sound.play(TELEPORT_SOUND, { volume: TELEPORT_VOLUME });
  }
  shieldSwitched() {
    this.scene.sound.play(SHIELD_SOUND, { volume: UI_VOLUME });
  }
  /** A force field zap (#127), at a volume from 0 to 1: a random one, never the last one again. */
  fieldZap(volume) {
    const key2 = randomVariant(FIELD_ZAP_SOUNDS, this.lastZap, Math.random);
    this.lastZap = key2;
    if (key2 !== void 0) {
      this.scene.sound.play(key2, { volume });
    }
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
      this.stopMusic();
    }
  }
  /** Crossfades to the place's music when the ship moves to another place (#187). */
  setMusicPlace(place) {
    if (place === this.place) {
      return;
    }
    this.place = place;
    this.fadeInNext = true;
    if (this.music !== void 0) {
      this.fadeOut(this.music);
      this.music = void 0;
    }
    this.playMusic();
  }
  /** Loads the music after the game has started, so it never delays the first frame; each track plays once it's in. */
  loadMusic() {
    const loader = this.scene.load;
    for (const file of musicFiles()) {
      loader.audio(file.key, file.urls);
    }
    const loaded2 = () => {
      this.playMusic();
    };
    loader.on(Phaser3.Loader.Events.FILE_COMPLETE, loaded2);
    loader.once(Phaser3.Loader.Events.COMPLETE, () => {
      loader.off(Phaser3.Loader.Events.FILE_COMPLETE, loaded2);
      this.musicLoaded = true;
      this.playMusic();
    });
    loader.start();
  }
  playMusic() {
    if (!this.settings.music || this.music !== void 0) {
      return;
    }
    if (this.scene.sound.locked) {
      if (!this.awaitingUnlock) {
        this.awaitingUnlock = true;
        this.scene.sound.once(Phaser3.Sound.Events.UNLOCKED, () => {
          this.awaitingUnlock = false;
          this.playMusic();
        });
      }
      return;
    }
    const key2 = MUSIC[this.place];
    const fading = [...this.fading].find((sound) => sound.key === key2);
    if (fading !== void 0) {
      this.fading.delete(fading);
      this.music = fading;
      this.fadeInNext = false;
      this.fadeTo(fading, MUSIC_VOLUME);
      return;
    }
    if (!this.scene.cache.audio.exists(key2)) {
      return;
    }
    const music = this.scene.sound.add(key2, { volume: this.fadeInNext ? 0 : MUSIC_VOLUME, loop: true });
    this.music = music;
    music.play();
    if (this.fadeInNext) {
      this.fadeInNext = false;
      this.fadeTo(music, MUSIC_VOLUME);
    }
  }
  fadeOut(music) {
    this.fading.add(music);
    this.fadeTo(music, 0, () => {
      this.discard(music);
    });
  }
  fadeTo(music, volume, done) {
    this.scene.tweens.killTweensOf(music);
    this.scene.tweens.add({ targets: music, volume, duration: MUSIC_FADE_MS, onComplete: () => done?.() });
  }
  /** Drops a track that has faded out or been switched off. */
  discard(music) {
    this.scene.tweens.killTweensOf(music);
    this.fading.delete(music);
    music.destroy();
  }
  stopMusic() {
    for (const music of this.fading) {
      this.discard(music);
    }
    if (this.music !== void 0) {
      this.discard(this.music);
      this.music = void 0;
    }
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
var FONT_PX2 = 12;
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
    const style = { fontFamily: UI_FONT, fontSize: `${String(FONT_PX2)}px` };
    this.name = scene.add.text(0, 0, "", { ...style, fontFamily: HEADING_FONT, color: NAME_COLOR }).setOrigin(0.5, 0).setShadow(1, 1, "#000000", 0);
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
    this.name.setFontSize(FONT_PX2 * dpr).setPosition(x, TOP_PX * dpr);
    this.bars.setPosition(Math.round(x - this.width / 2), this.name.y + this.name.height + GAP_PX * dpr);
    this.text.setFontSize(FONT_PX2 * dpr).setPosition(x, this.bars.y + (HEALTH_PX + SHIELD_PX + 2 * GAP_PX) * dpr);
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
  /** Sends the ship's state past the throttle, for a change the server must not miss, such as a fitted part (#110). */
  sendStateNow(ship) {
    if (this.welcomed) {
      this.send(create2(ClientMessageSchema, { kind: { case: "state", value: toShipState(ship) } }));
    }
  }
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
  /** Sends the squadron to a sector (#101); the server keeps it only if it's uncleared. */
  sendPickMission(sector) {
    if (this.welcomed) {
      this.send(create2(ClientMessageSchema, { kind: { case: "pickMission", value: { sector } } }));
    }
  }
  /** Starts an attack on a cleared sector at once; a development server only (#102). */
  sendDevStartAttack(sector) {
    if (this.welcomed) {
      this.send(create2(ClientMessageSchema, { kind: { case: "devStartAttack", value: { sector } } }));
    }
  }
  /** Asks for the season's result as if it were won now; a development server only (#156). */
  sendDevSeasonWon() {
    if (this.welcomed) {
      this.send(create2(ClientMessageSchema, { kind: { case: "devSeasonWon", value: {} } }));
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
      case "eventStarted":
        events.eventStarted(message.kind.value);
        break;
      case "eventEnded":
        events.eventEnded(message.kind.value);
        break;
      case "frontier":
        events.frontier(message.kind.value);
        break;
      case "bossFell":
        events.bossFell(message.kind.value);
        break;
      case "seasonWon":
        events.seasonWon(message.kind.value);
        break;
      case "standings":
        events.standings(message.kind.value);
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
import Phaser6 from "./vendor/phaser.js";

// src/scenes/shipview.ts
import Phaser5 from "./vendor/phaser.js";
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
      fontFamily: UI_FONT,
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
      fontFamily: UI_FONT,
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
      part.setTint(color).setTintMode(Phaser5.TintModes.MULTIPLY);
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
    part.setTintMode(Phaser5.TintModes.MULTIPLY);
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
      this.downLabel = this.scene.add.text(0, 0, "DOWN", { fontFamily: UI_FONT, fontSize: "8px", color: DOWN_COLOR, resolution }).setOrigin(0.5, 0).setShadow(1, 1, "#000000", 0);
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
    part.setVisible(true).setTint(16777215).setTintMode(Phaser5.TintModes.FILL);
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
  faction;
  root;
  base;
  /** The weapons, for the kinds whose pack draws them; a Bomber has none (#137), nor a Support Ship (#184). */
  weapon;
  /** The shield bubble, for the kinds whose pack draws one: a boss's (#89), a small ship's for its repairs (#188). */
  shield;
  scene;
  constructor(scene, parent, kind, faction) {
    this.scene = scene;
    this.kind = kind;
    this.faction = faction;
    const engine = scene.add.sprite(0, 0, keys.enemyEngine(faction, kind)).play(keys.enemyEngine(faction, kind));
    this.base = scene.add.image(0, 0, keys.enemyBase(faction, kind));
    const parts = [engine, this.base];
    if (scene.textures.exists(keys.enemyWeapons(faction, kind))) {
      const weapon = scene.add.sprite(0, 0, keys.enemyWeapons(faction, kind), 0);
      weapon.on(Phaser6.Animations.Events.ANIMATION_COMPLETE, () => {
        weapon.setFrame(0);
      });
      this.weapon = weapon;
      parts.push(weapon);
    }
    if (scene.textures.exists(keys.enemyShield(faction, kind))) {
      this.shield = scene.add.sprite(0, 0, keys.enemyShield(faction, kind)).play(keys.enemyShield(faction, kind)).setVisible(false);
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
  /** Shows or hides the shield bubble: a boss's while it holds a charge, a small ship's while it's repaired. */
  setShield(up) {
    this.shield?.setVisible(up);
  }
  /** Whether the shield bubble shows, for the E2E tests. */
  get shieldShown() {
    return this.shield?.visible ?? false;
  }
  /** The telegraph before a volley leaves in ms: the weapon animation, or without weapons a blue glow for that long. */
  warn(ms) {
    if (this.weapon !== void 0) {
      this.weapon.play(keys.enemyWeapons(this.faction, this.kind));
      return;
    }
    this.base.setTint(BOMBER_WARN_TINT).setTintMode(Phaser6.TintModes.ADD);
    this.scene.time.delayedCall(ms, () => {
      this.base.clearTint().setTintMode(Phaser6.TintModes.MULTIPLY);
    });
  }
  /** A short white flash where a shot landed. */
  flash() {
    this.base.setTint(16777215).setTintMode(Phaser6.TintModes.FILL);
    this.scene.time.delayedCall(FLASH_MS, () => {
      this.base.clearTint().setTintMode(Phaser6.TintModes.MULTIPLY);
    });
  }
  /** Plays the pack's destruction animation in place of the ship, then goes. */
  destroy(explode) {
    if (!explode) {
      this.root.destroy();
      return;
    }
    const boom = this.scene.add.sprite(this.root.x, this.root.y, keys.enemyDestruction(this.faction, this.kind)).setRotation(this.root.rotation);
    this.root.parentContainer.add(boom);
    this.root.destroy();
    boom.once(Phaser6.Animations.Events.ANIMATION_COMPLETE, () => {
      boom.destroy();
    });
    boom.play(keys.enemyDestruction(this.faction, this.kind));
  }
};

// src/scenes/derelictview.ts
import Phaser7 from "./vendor/phaser.js";

// src/sim/teleport.ts
var TELEPORT_DURATION_S = TELEPORT_CLOSE_S + TELEPORT_HOLD_S + TELEPORT_SHRINK_S + TELEPORT_FLASH_S;
var clamp01 = (x) => Math.min(Math.max(x, 0), 1);
function teleportFrame(elapsed) {
  const t = Math.max(elapsed, 0);
  const shrinking = TELEPORT_CLOSE_S + TELEPORT_HOLD_S;
  const shrunk = shrinking + TELEPORT_SHRINK_S;
  if (t >= TELEPORT_DURATION_S) {
    return { shieldScale: 0, shieldAlpha: 0, hullScale: 0, white: true, flashRadius: 0, flashAlpha: 0, done: true };
  }
  if (t < shrinking) {
    const eased = 1 - (1 - clamp01(t / TELEPORT_CLOSE_S)) ** 2;
    return {
      shieldScale: TELEPORT_SHIELD_START_SCALE + (1 - TELEPORT_SHIELD_START_SCALE) * eased,
      shieldAlpha: eased,
      hullScale: 1,
      white: false,
      flashRadius: 0,
      flashAlpha: 0,
      done: false
    };
  }
  if (t < shrunk) {
    const shrink = clamp01((t - shrinking) / TELEPORT_SHRINK_S);
    return {
      shieldScale: 1 - shrink,
      shieldAlpha: 1,
      hullScale: 1 - shrink,
      white: true,
      flashRadius: TELEPORT_FLASH_RADIUS * shrink,
      flashAlpha: shrink,
      done: false
    };
  }
  const collapse = clamp01((t - shrunk) / TELEPORT_FLASH_S);
  return { shieldScale: 0, shieldAlpha: 0, hullScale: 0, white: true, flashRadius: TELEPORT_FLASH_RADIUS * (1 - collapse), flashAlpha: 1, done: false };
}

// src/scenes/derelictview.ts
var DERELICT_TINT = 9080729;
var DERELICT_HELD_TINT = 4869724;
var FLASH_CORE = 0.5;
var DerelictView = class {
  scene;
  layer;
  hull;
  label;
  bar;
  fill = -1;
  teleporting;
  constructor(scene, layer, x, y, angle, resolution) {
    this.scene = scene;
    this.layer = layer;
    this.hull = scene.add.image(x, y, keys.hull("veryDamaged")).setRotation(angle + SPRITE_FACING).setTint(DERELICT_TINT).setTintMode(Phaser7.TintModes.MULTIPLY);
    this.label = scene.add.text(x, y + DOWN_OFFSET, "", { fontFamily: UI_FONT, fontSize: "8px", color: DOWN_COLOR, resolution }).setOrigin(0.5, 0).setShadow(1, 1, "#000000", 0);
    this.bar = scene.add.graphics().setPosition(x - REVIVE_BAR_WIDTH / 2, y + DOWN_OFFSET + REVIVE_BAR_BELOW);
    layer.add([this.hull, this.label, this.bar]);
  }
  /** Shows the label, whether it's held, and the rescue's progress (0 to 1); the bar shows once there is some. */
  update(label, held, rescue) {
    this.hull.setTint(held ? DERELICT_HELD_TINT : DERELICT_TINT);
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
  /** Starts teleporting away at now, in seconds: the label and bar go, and the Invincibility Shield closes in (#190). */
  teleport(now2) {
    if (this.teleporting !== void 0) {
      return;
    }
    this.label.setVisible(false);
    this.bar.setVisible(false);
    const shield = this.scene.add.sprite(this.hull.x, this.hull.y, keys.shield("invincibility")).setRotation(this.hull.rotation).setTint(TELEPORT_COLOR).setTintMode(Phaser7.TintModes.FILL).setBlendMode(Phaser7.BlendModes.ADD);
    shield.play(keys.shield("invincibility"));
    const flash = this.scene.add.graphics().setPosition(this.hull.x, this.hull.y).setBlendMode(Phaser7.BlendModes.ADD);
    this.layer.add([shield, flash]);
    this.teleporting = { start: now2, shield, flash };
    this.step(now2);
  }
  /** Draws the teleport at now, in seconds; true once it's over, false while it runs or before it starts. */
  step(now2) {
    const t = this.teleporting;
    if (t === void 0) {
      return false;
    }
    const f = teleportFrame(now2 - t.start);
    if (f.white) {
      this.hull.setTint(TELEPORT_WHITE).setTintMode(Phaser7.TintModes.FILL);
      t.shield.setTint(TELEPORT_WHITE);
    }
    this.hull.setScale(f.hullScale).setVisible(f.hullScale > 0);
    t.shield.setScale(f.shieldScale).setAlpha(f.shieldAlpha).setVisible(f.shieldScale > 0 && f.shieldAlpha > 0);
    t.flash.clear();
    if (f.flashRadius > 0) {
      t.flash.fillStyle(TELEPORT_COLOR, f.flashAlpha).fillCircle(0, 0, f.flashRadius);
      t.flash.fillStyle(TELEPORT_WHITE, f.flashAlpha).fillCircle(0, 0, f.flashRadius * FLASH_CORE);
    }
    return f.done;
  }
  destroy() {
    this.hull.destroy();
    this.label.destroy();
    this.bar.destroy();
    this.teleporting?.shield.destroy();
    this.teleporting?.flash.destroy();
    this.teleporting = void 0;
  }
};

// src/net/derelict.ts
function derelictLabel(goneTick, tick, tickRate) {
  const seconds = Math.max(0, Math.ceil((goneTick - tick) / tickRate));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `DERELICT ${String(m)}:${String(s).padStart(2, "0")}`;
}
function heldLabel(holders2) {
  return holders2 > 0 ? `DERELICT \xB7 HELD BY ${String(holders2)}` : "DERELICT \xB7 HELD";
}
function holders(x, y, enemies) {
  return enemies.filter((e) => Math.hypot(e.x - x, e.y - y) < DERELICT_HOLD_RADIUS).length;
}
function rescueNotice(name, hangar, docked) {
  return docked ? `${name} rescued a ship \xB7 hangar ${String(hangar)}` : `${name} rescued a ship \xB7 the hangar is full`;
}

// src/net/frontier.ts
var ringOpenedBy = (faction) => RING_FACTIONS.lastIndexOf(faction) + 1;
function bossFellBanner(faction, part) {
  const ring2 = ringOpenedBy(faction);
  const lines = [`The ${FACTION_NAMES[faction]} Dreadnought has fallen`, ring2 > GRID_RINGS ? "The season is won." : `Ring ${String(ring2)} is open.`];
  if (part !== void 0) {
    lines.push(`Your reward: ${part}`);
  }
  return lines;
}
function ringNames(first, last) {
  if (first === last) {
    return `Ring ${String(last)} has`;
  }
  const rings = Array.from({ length: last - first + 1 }, (_, i) => String(first + i));
  return `Rings ${rings.slice(0, -1).join(", ")} and ${rings.at(-1) ?? ""} have`;
}
function ringsClosedBanner(before, after) {
  if (before < 2 || after >= before) {
    return void 0;
  }
  return [
    `${ringNames(after + 1, before)} closed`,
    `Ring ${String(after)} fell below 4 cleared sectors. Take them back to wake a new Dreadnought.`
  ];
}

// src/net/repair.ts
var REPAIR_SHIELD_KINDS = ["scout", "fighter", "bomber", "torpedo"];
function drawnRepairs(enemies) {
  const repairs = [];
  for (const e of enemies.values()) {
    const target = e.repairing === 0 ? void 0 : enemies.get(e.repairing);
    if (e.drawn !== void 0 && target?.drawn !== void 0) {
      repairs.push({
        line: { fromX: e.drawn.x, fromY: e.drawn.y, toX: target.drawn.x, toY: target.drawn.y },
        targetId: e.repairing,
        targetKind: target.kind
      });
    }
  }
  return repairs;
}
function repairLines(enemies) {
  return drawnRepairs(enemies).map((r) => r.line);
}
function repairShields(enemies) {
  return new Set(drawnRepairs(enemies).flatMap((r) => REPAIR_SHIELD_KINDS.includes(r.targetKind) ? [r.targetId] : []));
}

// src/net/events.ts
function timeLeft(endsTick, tick, tickRate) {
  const seconds = Math.max(0, Math.ceil((endsTick - tick) / tickRate));
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, "0")}`;
}
function eventLine(event, tick, tickRate) {
  if (event === void 0) {
    return "";
  }
  const left = timeLeft(event.endsTick, tick, tickRate);
  return event.kind === WorldEventKind.ATTACK ? `${event.sector} under attack \xB7 ${left}` : `Distress call in ${event.sector} \xB7 ${left}`;
}
function eventStartBanner(event) {
  return event.kind === WorldEventKind.ATTACK ? [
    `Sector ${event.sector} is under attack!`,
    "Destroy the Frigate and its fleet before time runs out, or lose the sector.",
    "Follow the red arrow at the edge of the screen."
  ] : [
    `Distress call from sector ${event.sector}`,
    "Destroy its guard, then hover beside the derelict ship to rescue it.",
    "Follow the red arrow at the edge of the screen."
  ];
}
function eventEndBanner(event, won) {
  if (event.kind === WorldEventKind.ATTACK) {
    return won ? [`Sector ${event.sector} held!`, "A ship joins the hangar."] : [`Sector ${event.sector} has fallen`];
  }
  return won ? [`Derelict rescued in sector ${event.sector}`] : [`The derelict in sector ${event.sector} was lost`];
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
  /** The Support Ships' repair lines (#184), redrawn every frame. */
  repairGraphics;
  derelicts = /* @__PURE__ */ new Map();
  /** Derelicts gone from the snapshots, teleporting away (#190). */
  departing = /* @__PURE__ */ new Set();
  /** Derelicts seen to start teleporting away (#190). */
  teleports = 0;
  /** Whether a snapshot came since connecting, so derelicts already there aren't announced. */
  derelictsSeen = false;
  /** Derelicts this player, or their companions, rescued (#52). */
  rescues = 0;
  /** The world event running, as the server last said (#102). */
  worldEvent;
  /** The last sector cleared and the part it gave this player, for the E2E tests (#101). */
  lastClear;
  /** Announcements waiting for the middle of the screen, oldest first (#101). */
  banners = [];
  /** The cleared sectors, by name (#99). */
  clearedSectors = /* @__PURE__ */ new Set();
  /** The game map's name ("frontier"), for the full map's title (#100). */
  mapName = "";
  /** Which sectors are open (#123), and a count that moves on every change, for redrawing. */
  frontier = ALL_OPEN;
  frontierVersion = 0;
  /** The season's result once it's won (#156), and whether the victory screen should open for it. */
  seasonResult;
  /** The season so far (#167): everyone's stats, when the season started, and a count that moves on every change. */
  standings = [];
  seasonStarted = 0;
  standingsVersion = 0;
  victoryPending = false;
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
    this.repairGraphics = options.scene.add.graphics();
    options.ships.addAt(this.repairGraphics, 0);
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
          const shooter = this.remotes.get(remote.playerId);
          if (shooter !== void 0) {
            shooter.shotsSeen++;
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
        eventStarted: (started) => {
          this.worldEvent = started.event;
          if (started.event !== void 0 && !started.ongoing) {
            this.banners.push(eventStartBanner(started.event));
          }
        },
        frontier: (frontier) => {
          this.setFrontier(frontier);
        },
        bossFell: (fell) => {
          this.bossFell(fromEnemyFaction(fell.faction), fell.gains);
        },
        seasonWon: (won) => {
          this.seasonWon(won, true);
        },
        standings: (standings) => {
          this.setStandings(standings);
        },
        eventEnded: (ended) => {
          this.worldEvent = void 0;
          const event = ended.event;
          if (event === void 0) {
            return;
          }
          if (event.kind === WorldEventKind.ATTACK && !ended.won) {
            this.clearedSectors.delete(event.sector);
          }
          this.banners.push(eventEndBanner(event, ended.won));
        },
        derelictRescued: (rescued) => {
          const name = rescued.playerId === this.playerId ? this.name : this.remotes.get(rescued.playerId)?.name ?? "a squadmate";
          this.say(rescueNotice(name, rescued.hangar, rescued.docked));
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
    for (const view of this.departing) {
      view.destroy();
    }
    this.departing.clear();
  }
  /** Other players and their companions, for the HUD and the E2E tests. */
  get others() {
    return [...this.remotes.entries()].map(([id, r]) => ({
      id,
      name: r.name,
      color: r.color,
      x: r.view.root.x,
      y: r.view.root.y,
      ownerId: r.ownerId,
      shotsSeen: r.shotsSeen
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
  /** The HUD's line for the world event running, counting down (#102). */
  eventLine(nowMs) {
    const tick = this.clock.tickAt(nowMs);
    return tick === void 0 ? "" : eventLine(this.worldEvent, tick, this.tickRate);
  }
  /** The player's squadron's mission (#101), undefined without one. */
  get mission() {
    const mission = this.squadronInfo?.mission;
    return mission === void 0 || mission === "" ? void 0 : mission;
  }
  /** Takes the parts the fall gave this player, and announces it (#125). */
  bossFell(faction, gains) {
    let reward;
    for (const gain of gains) {
      const part = fromPart(gain.unlock?.part);
      if (gain.playerId === this.playerId && part !== void 0) {
        const tier = tierOf(gain.unlock?.tier);
        this.unlocks.set(part, tier);
        reward = partLabel(part, tier);
      }
    }
    this.banners.push(bossFellBanner(faction, reward));
    this.options.pickups.regrade(this.unlocks);
    this.refit();
  }
  /** Takes the server's frontier, and hands it to the sim so the ship stays out of closed sectors (#123). */
  setFrontier(message) {
    const closed = ringsClosedBanner(this.frontier.openRings, message.openRings);
    if (closed !== void 0) {
      this.banners.push(closed);
    }
    this.frontier = { openRings: message.openRings, opened: new Set(message.opened) };
    this.frontierVersion++;
    this.options.sim.setFrontier(message.openRings, message.opened);
  }
  /** What the maps show (#100), with the local ship at you. */
  mapState(you) {
    return {
      cleared: this.clearedSectors,
      frontier: this.frontier,
      frigates: this.bosses.filter((b) => b.kind === "frigate"),
      dreadnoughts: this.bosses.filter((b) => b.kind === "dreadnought"),
      missions: (this.squadrons?.squadrons ?? []).flatMap(
        (s) => s.mission === "" ? [] : [{ squadron: s.name, sector: s.mission, own: s.name === this.squadron }]
      ),
      attack: this.worldEvent?.kind === WorldEventKind.ATTACK ? this.worldEvent.sector : void 0,
      you,
      squadmates: [...this.remotes.values()].filter((r) => r.ownerId === "" && this.isSquadmate(r)).map((r) => ({ x: r.view.root.x, y: r.view.root.y, color: r.color }))
    };
  }
  /** Sends the squadron to another sector, picked on the full map (#100). */
  pickMission(sector) {
    this.connection.sendPickMission(sector);
  }
  /**
   * Keeps the season's result, and opens the victory screen for it: always
   * at the fall, and for a joiner only the first time this browser sees
   * that season (#156, decision 10).
   */
  seasonWon(won, always) {
    const result = fromSeasonWon(won);
    this.seasonResult = result;
    if (always || loadSeenSeason() !== result.season) {
      this.victoryPending = true;
      saveSeenSeason(result.season);
    }
  }
  /** Keeps the season so far (#167). */
  setStandings(standings) {
    this.standings = standings.players.map(fromPlayerStats);
    this.seasonStarted = Number(standings.season);
    this.standingsVersion++;
  }
  /** Whether the victory screen should open now; asking clears it. */
  takeVictory() {
    const pending = this.victoryPending;
    this.victoryPending = false;
    return pending;
  }
  /** On a development server, asks for the season's result as if it were won now (#156). */
  devSeasonWon() {
    if (this.development) {
      this.connection.sendDevSeasonWon();
    }
  }
  /** On a development server, starts an attack on the sector the ship is in, if it's cleared (#102). */
  devStartAttack() {
    const { x, y } = this.options.sim.ship;
    const sector = sectorName(x, y);
    if (this.development && sector !== void 0) {
      this.connection.sendDevStartAttack(sector);
    }
  }
  /** Sends the ship's state now, so the server has a just-fitted loadout (#110). */
  sendStateNow() {
    this.connection.sendStateNow(this.options.sim.ship);
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
  /** The derelicts waiting to be rescued, for the E2E tests (#52). */
  get derelictList() {
    return [...this.derelicts.entries()].map(([id, d]) => ({
      id,
      x: d.state.x,
      y: d.state.y,
      rescue: d.state.rescue,
      held: d.state.held
    }));
  }
  /** Derelicts still teleporting away, for the E2E tests (#190). */
  get departingCount() {
    return this.departing.size;
  }
  /**
   * Draws the snapshot's derelicts and drops the ones no longer in it; a new
   * one after the first snapshot is announced. One gone from a later
   * snapshot was rescued or ran out of time, and teleports away either way
   * (#190); a disconnect, at tick 0, drops them at once.
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
      const label = state.held ? heldLabel(holders(state.x, state.y, [...this.enemies.values()].map((e) => e.view))) : derelictLabel(state.goneTick, tick, this.tickRate);
      drawn.view.update(label, state.held, state.rescue);
    }
    for (const [id, drawn] of this.derelicts) {
      if (!seen.has(id)) {
        this.derelicts.delete(id);
        if (tick > 0) {
          drawn.view.teleport(now() / 1e3);
          this.departing.add(drawn.view);
          this.teleports++;
          const ship = this.options.sim.ship;
          if (Math.hypot(drawn.state.x - ship.x, drawn.state.y - ship.y) <= TELEPORT_SOUND_RANGE) {
            this.options.audio.teleported();
          }
        } else {
          drawn.view.destroy();
        }
      }
    }
    this.derelictsSeen = tick > 0;
  }
  /** The bosses as drawn, with their health (#89). */
  get bosses() {
    return [...this.enemies.values()].flatMap(
      (e) => e.health === void 0 ? [] : [{ kind: e.view.kind, faction: e.view.faction, x: e.view.x, y: e.view.y, ...e.health }]
    );
  }
  /** Enemies as drawn, for the E2E tests. */
  get enemyList() {
    return [...this.enemies.entries()].map(([id, e]) => ({
      id,
      kind: e.view.kind,
      faction: e.view.faction,
      x: e.view.x,
      y: e.view.y,
      repairing: e.repairing,
      shielded: e.view.shieldShown
    }));
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
    for (const view of this.departing) {
      if (view.step(seconds)) {
        view.destroy();
        this.departing.delete(view);
      }
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
    const g = this.repairGraphics.clear().lineStyle(REPAIR_LINE_WIDTH, REPAIR_LINE_COLOR, REPAIR_LINE_ALPHA);
    for (const line of repairLines(this.enemies)) {
      g.lineBetween(line.fromX, line.fromY, line.toX, line.toY);
    }
    const shielded = repairShields(this.enemies);
    for (const [id, enemy] of this.enemies) {
      if (REPAIR_SHIELD_KINDS.includes(enemy.kind)) {
        enemy.view.setShield(shielded.has(id));
      }
    }
    for (const { item } of this.enemyWarnings.due(renderTick)) {
      this.enemies.get(item.enemyId)?.view.warn(item.warnTicks * 1e3 / this.tickRate);
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
    return [...this.enemies.entries()].map(([id, e]) => ({ id, x: e.view.x, y: e.view.y, radius: ENEMY_RADIUS[e.view.faction][e.view.kind] }));
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
        sim.takeHit(from, p.kind);
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
        bodies.push({ x: s.x, y: s.y, vx: s.vx, vy: s.vy, radius: SHIP_RADIUS, key: this.bumpKey(id), side, gentle: true });
        rammed.push(void 0);
      }
    }
    for (const [id, enemy] of this.enemies) {
      const e = enemy.drawn;
      if (e !== void 0) {
        const radius = ENEMY_RADIUS[enemy.view.faction][enemy.view.kind];
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
    let key2 = this.bumpKeys.get(name);
    if (key2 === void 0) {
      key2 = this.bumpKeys.size + 1;
      this.bumpKeys.set(name, key2);
    }
    return key2;
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
    for (const bullet of this.options.sim.enemyPattern(volley.kind, volley.faction, origin.x, origin.y, volley.angle, volley.seed)) {
      this.options.sim.projectiles.spawn(bullet, { ageSeconds, faction: "enemy", owner: String(volley.enemyId) });
    }
    const ship = this.options.sim.ship;
    if (Math.hypot(origin.x - ship.x, origin.y - ship.y) <= ENEMY_VOLLEY_RANGE) {
      this.options.audio.enemyShot();
    }
  }
  enemyFired(fired) {
    this.enemyWarnings.add(fired.tick - fired.warnTicks, { enemyId: fired.enemyId, warnTicks: fired.warnTicks });
    this.enemyVolleys.add(fired.tick, {
      enemyId: fired.enemyId,
      kind: fromEnemyKind(fired.kind),
      faction: fromEnemyFaction(fired.faction),
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
    this.worldEvent = welcome.worldEvent;
    this.mapName = welcome.mapName;
    this.seasonResult = void 0;
    if (welcome.standings !== void 0) {
      this.setStandings(welcome.standings);
    }
    if (welcome.seasonWon !== void 0) {
      this.seasonWon(welcome.seasonWon, false);
    }
    if (welcome.frontier !== void 0) {
      this.setFrontier(welcome.frontier);
    }
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
    const ours = cleared.sector === this.mission;
    let reward;
    let gained = "";
    for (const gain of cleared.gains) {
      const part = fromPart(gain.unlock?.part);
      if (gain.playerId !== this.playerId || part === void 0) {
        continue;
      }
      const tier = tierOf(gain.unlock?.tier);
      this.unlocks.set(part, tier);
      reward = partLabel(part, tier);
      gained = ` \xB7 ${reward}`;
    }
    this.say(`Sector ${cleared.sector} cleared${gained}`);
    this.lastClear = { sector: cleared.sector, reward };
    if (ours) {
      this.banners.push(missionCompleteBanner(cleared.sector, reward, missionStatsLine(cleared.mission.map(fromPlayerStats))));
    }
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
        const kind = fromEnemyKind(state.kind);
        enemy = {
          kind,
          view: new EnemyView(this.options.scene, this.options.ships, kind, fromEnemyFaction(state.faction)),
          buffer: new StateBuffer(),
          drawn: void 0,
          lastSeen: snapshot.tick,
          destroyedAt: void 0,
          health: void 0,
          repairing: 0
        };
        this.enemies.set(state.enemyId, enemy);
      }
      enemy.lastSeen = snapshot.tick;
      enemy.repairing = state.repairing;
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
      drawn: void 0,
      shotsSeen: 0
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

// src/scenes/resample.ts
import Phaser9 from "./vendor/phaser.js";
var RESAMPLE_NODE = "FilterResample";
var FRAGMENT = [
  "#pragma phaserTemplate(shaderName)",
  // mediump can be 16 bits on a phone, too coarse for pixel positions past 2048 (#180).
  "#ifdef GL_FRAGMENT_PRECISION_HIGH",
  "precision highp float;",
  "#else",
  "precision mediump float;",
  "#endif",
  "uniform sampler2D uMainSampler;",
  "uniform vec2 inputSize;",
  "varying vec2 outTexCoord;",
  "#pragma phaserTemplate(fragmentHeader)",
  "void main ()",
  "{",
  "    vec2 p = outTexCoord * inputSize - 0.5;",
  "    vec2 f = fract(p);",
  "    vec2 i = floor(p);",
  "    vec4 a = texture2D(uMainSampler, (i + vec2(0.5, 0.5)) / inputSize);",
  "    vec4 b = texture2D(uMainSampler, (i + vec2(1.5, 0.5)) / inputSize);",
  "    vec4 c = texture2D(uMainSampler, (i + vec2(0.5, 1.5)) / inputSize);",
  "    vec4 d = texture2D(uMainSampler, (i + vec2(1.5, 1.5)) / inputSize);",
  "    gl_FragColor = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);",
  "}"
].join("\n");
var Resample = class extends Phaser9.Filters.Controller {
  scale;
  constructor(camera, scale) {
    super(camera, RESAMPLE_NODE);
    this.scale = scale;
  }
};
var ResampleNode = class extends Phaser9.Renderer.WebGL.RenderNodes.BaseFilterShader {
  inputSize = [1, 1];
  constructor(manager) {
    super(RESAMPLE_NODE, manager, void 0, FRAGMENT);
  }
  run(controller, inputDrawingContext, outputDrawingContext) {
    const scale = controller instanceof Resample ? controller.scale : 1;
    this.inputSize = [inputDrawingContext.width, inputDrawingContext.height];
    const output = outputDrawingContext ?? this.manager.renderer.drawingContextPool.get(
      Math.max(1, Math.round(inputDrawingContext.width * scale)),
      Math.max(1, Math.round(inputDrawingContext.height * scale))
    );
    return super.run(controller, inputDrawingContext, output, new Phaser9.Geom.Rectangle());
  }
  setupUniforms() {
    this.programManager.setUniform("inputSize", this.inputSize);
  }
};
function registerResample(renderer) {
  if (renderer.renderNodes.getNode(RESAMPLE_NODE) === null) {
    renderer.renderNodes.addNodeConstructor(RESAMPLE_NODE, ResampleNode);
  }
}

// src/vignette.ts
function vignetteDarkness(u, v, vignette) {
  const d = Math.hypot(u - vignette.x, v - vignette.y);
  if (d > vignette.radius) {
    return 1;
  }
  return Math.sin(d / vignette.radius * 3.14 * vignette.strength);
}
function vignetteImage(size, vignette) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      data[(y * size + x) * 4 + 3] = Math.round(vignetteDarkness((x + 0.5) / size, (y + 0.5) / size, vignette) * 255);
    }
  }
  return data;
}

// src/scenes/touchview.ts
var UI = 9427199;
var GOLD = 16773258;
var PANEL = 328458;
var KNOB_RADIUS = 32;
var LINE_PX = 2;
var BUTTON_ALPHA = 0.7;
var RING_ALPHA = 0.45;
var KNOB_ALPHA = 0.35;
var FONT_PX3 = 13;
var TouchView = class {
  g;
  labels = [];
  scene;
  hide;
  constructor(scene, hideFromWorld) {
    this.scene = scene;
    this.hide = hideFromWorld;
    this.g = scene.add.graphics().setDepth(1e3);
    hideFromWorld(this.g);
  }
  /** Draws the sticks being held and the buttons, unit device pixels to a CSS pixel of touch UI (touchUnit). */
  draw(controls, buttons, unit) {
    const g = this.g.clear();
    for (const s of controls.sticks()) {
      const color = s.firing ? GOLD : UI;
      g.fillStyle(PANEL, RING_ALPHA).fillCircle(s.origin.x, s.origin.y, TOUCH_STICK_RADIUS_PX * unit);
      g.lineStyle(LINE_PX * unit, color, RING_ALPHA).strokeCircle(s.origin.x, s.origin.y, TOUCH_STICK_RADIUS_PX * unit);
      g.fillStyle(color, KNOB_ALPHA).fillCircle(s.knob.x, s.knob.y, KNOB_RADIUS * unit);
      g.lineStyle(LINE_PX * unit, color, 1).strokeCircle(s.knob.x, s.knob.y, KNOB_RADIUS * unit);
    }
    while (this.labels.length < buttons.length) {
      const label = this.scene.add.text(0, 0, "", { fontFamily: UI_FONT }).setOrigin(0.5).setDepth(1001);
      this.hide(label);
      this.labels.push(label);
    }
    this.labels.forEach((label, i) => {
      const b = buttons[i];
      label.setVisible(b !== void 0);
      if (b === void 0) {
        return;
      }
      const color = b.gold ? GOLD : UI;
      const radius = b.height / 2;
      g.fillStyle(PANEL, BUTTON_ALPHA).fillRoundedRect(b.x, b.y, b.width, b.height, radius);
      g.lineStyle(LINE_PX * unit, color, BUTTON_ALPHA).strokeRoundedRect(b.x, b.y, b.width, b.height, radius);
      label.setText(b.label).setFontSize(FONT_PX3 * unit).setColor(b.gold ? "#fff08a" : "#d8f8ff").setPosition(b.x + b.width / 2, b.y + b.height / 2);
    });
  }
};

// src/scenes/blend.ts
import Phaser10 from "./vendor/phaser.js";
var FRAGMENT2 = [
  "#pragma phaserTemplate(shaderName)",
  "precision mediump float;",
  "uniform sampler2D uMainSampler;",
  "uniform sampler2D uMainSampler2;",
  "uniform float amount;",
  "uniform vec4 color;",
  "uniform float mode;",
  "varying vec2 outTexCoord;",
  "#pragma phaserTemplate(fragmentHeader)",
  "void main ()",
  "{",
  "    vec4 base = texture2D(uMainSampler, outTexCoord);",
  "    vec4 blend = texture2D(uMainSampler2, outTexCoord) * color;",
  "    vec4 blended = blend + base * (1.0 - blend.a);",
  "    if (mode > 1.5) {",
  "        blended = blend;",
  "    } else if (mode > 0.5) {",
  "        blended = base + blend;",
  "    }",
  "    gl_FragColor = mix(base, blended, amount);",
  "}"
].join("\n");
function modeOf(blendMode) {
  if (blendMode === Phaser10.BlendModes.COPY) {
    return 2;
  }
  return blendMode === Phaser10.BlendModes.ADD ? 1 : 0;
}
var SmallBlendNode = class extends Phaser10.Renderer.WebGL.RenderNodes.BaseFilterShader {
  constructor(manager) {
    super("FilterBlend", manager, void 0, FRAGMENT2);
  }
  setupTextures(controller, textures) {
    textures[1] = controller.glTexture;
  }
  setupUniforms(controller) {
    const blend = controller;
    this.programManager.setUniform("uMainSampler2", 1);
    this.programManager.setUniform("amount", blend.amount);
    this.programManager.setUniform("color", blend.color);
    this.programManager.setUniform("mode", modeOf(blend.blendMode));
  }
};
var registered = /* @__PURE__ */ new WeakSet();
function registerSmallBlend(renderer) {
  if (registered.has(renderer)) {
    return;
  }
  registered.add(renderer);
  renderer.renderNodes.addNode("FilterBlend", new SmallBlendNode(renderer.renderNodes));
}

// src/diag.ts
var KEEP = 4;
var Diagnostics = class {
  errors = [];
  info;
  gl;
  canvas;
  constructor(gl, canvas) {
    this.gl = gl;
    this.canvas = canvas;
    this.info = describe(gl);
    window.addEventListener("error", (event) => {
      this.note(`error: ${event.message}`);
    });
    window.addEventListener("unhandledrejection", (event) => {
      this.note(`rejected: ${String(event.reason)}`);
    });
    const consoleError = console.error.bind(console);
    console.error = (...args) => {
      this.note(`console: ${args.map(String).join(" ")}`);
      consoleError(...args);
    };
  }
  /** Reads WebGL's error flag once a frame, keeping any error it held. */
  check() {
    const code = this.gl?.getError() ?? 0;
    if (code !== 0) {
      this.note(`gl error 0x${code.toString(16)}`);
    }
  }
  /** The lines for the HUD; the canvas's size as it is now, since a phone turning changes it. */
  lines() {
    const size = `canvas ${String(this.canvas.width)}x${String(this.canvas.height)} window ${String(window.innerWidth)}x${String(window.innerHeight)} dpr ${String(window.devicePixelRatio)}`;
    return [...this.info, size, ...this.errors];
  }
  note(message) {
    this.errors.push(message.slice(0, 160));
    if (this.errors.length > KEEP) {
      this.errors.shift();
    }
  }
};
function describe(gl) {
  if (gl === void 0) {
    return ["no WebGL"];
  }
  const version = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext ? "webgl2" : "webgl1";
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const gpu = debug === null ? "gpu ?" : String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL));
  const maxTexture = String(gl.getParameter(gl.MAX_TEXTURE_SIZE));
  const highp = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT)?.precision ?? 0;
  const mediump = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.MEDIUM_FLOAT)?.precision ?? 0;
  return [`${version} \xB7 ${gpu}`, `max texture ${maxTexture} \xB7 fragment highp ${String(highp)} mediump ${String(mediump)} bits`];
}

// src/scenes/sandbox.ts
var PARALLAX = [0.05, 0.15, 0.3];
var BACKGROUND_FPS = 6;
var BACKGROUND_FRAMES = 9;
var CAMERA_LERP = 0.15;
var BLOOM_BLUR = 3;
var BLOOM_THRESHOLD = 0.55;
var BLOOM_BLUR_STEPS = 4;
var BLOOM_AMOUNT = 0.6;
var VIGNETTE = { x: 0.5, y: 0.5, radius: 0.9, strength: 0.35 };
var VIGNETTE_KEY = "vignette";
var VIGNETTE_SIZE = 256;
var EFFECT_ZOOM = 2;
var BAKED_GLOW_SCALE = 0.5;
var BLOOM_SCALE = 0.5;
var HUD_REFRESH_MS = 250;
var HIT_SPARKS = 5;
var SHARD_TINT = 16765562;
var HUD_FONT_PX = 12;
var HUD_MARGIN_PX = 8;
var DOWN_PANEL_FONT_PX = 14;
var DOWN_PANEL_PADDING_X = 12;
var DOWN_PANEL_PADDING_Y = 8;
var DOWN_PANEL_Y = 0.8;
var BLOOM_CHECK_FRAME = 30;
var KEY_HINT = "F1 help \xB7 Esc settings";
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
var SandboxScene = class extends Phaser11.Scene {
  sim = sandbox();
  world;
  backgrounds = [];
  backgroundFrame = 0;
  /** The background's tint now, fading toward the ring the ship is in (#136). */
  backgroundTint = 16777215;
  ships;
  pickups;
  /** The HUD's page elements (#91): the gauge, the panel and the toasts. */
  hudView = new HudView((kind, part) => {
    this.fitPart(kind, part);
  });
  /** Whether the text HUD shows frames per second: F3 on a development server (#91, decision 2). */
  showFps = false;
  /** The own ship's loadout as last drawn, so any change redraws it. */
  shownLoadout = "";
  ship;
  net;
  victoryScreen = new VictoryScreen();
  settingsScreen = new SettingsScreen((row) => {
    this.setOption(row.id);
  });
  squadronScreen = new SquadronScreen();
  /** The intro screen (#193), on the first visit and from F1; it saves itself as seen when closed. */
  introScreen = new IntroScreen(() => {
    saveIntroSeen();
    if (this.squadronScreen.open) {
      this.squadronScreen.focusPick();
    }
  });
  /** The season so far on the join screen, and above the down panel while down or while Tab is held (#167). */
  standingsJoin = new StandingsPanel("#standings-join");
  standingsDown = new StandingsPanel("#standings-down");
  standingsHeld = false;
  /** Twin-stick touch controls on a tablet (#180). */
  touchOn = touchMode((query) => window.matchMedia(query).matches, window.location.search);
  touch = new TouchControls();
  touchView;
  touchButtonRects = [];
  askedFullscreen = false;
  /** The notch's safe area, read on resize (#180). */
  insets = { insetLeft: 0, insetRight: 0 };
  maps;
  /** The closed sectors' shade (#123), and the frontier it was drawn for. */
  closedLayer;
  closedDrawn = -1;
  /** The force field on the closed sectors' edge (#127): its sides, its layer, drawn every frame, and its zaps. */
  closedSides = [];
  fieldLayer;
  lastZap = Number.NEGATIVE_INFINITY;
  fieldZaps = 0;
  projectileSprites = [];
  /** Enemy bullets fly on their own layer, above the players' shots, so enemy fire stands out (#36). */
  enemyFire;
  muzzleFlash;
  puff;
  bloom;
  bloomBlur;
  /** Set where the bloom draws the world black, so it stays off (#180). */
  bloomBroken = false;
  /** The vignette as an overlay on the HUD camera, over the bloomed world (#143). */
  vignette;
  hudCamera;
  hud;
  bossBar;
  missionArrow;
  missionLabel;
  eventLabel;
  missionBanner;
  missionFrame;
  announcedMission;
  missionBannerUntil = 0;
  downPanel;
  /** Whether the ship was down last frame and was respawned since, to count revives. */
  wasDown = false;
  respawned = false;
  revives = 0;
  moveKeys;
  effects = true;
  /** WebGL's limits and the page's errors in the HUD, with `?diag=1` (#180). */
  diagnostics;
  shotsFired = 0;
  hudUpdatedAt = 0;
  debug;
  frameTimes = new FrameTimes();
  mapsDrawnAt = -Infinity;
  displaySettings;
  gpuTimer;
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
    this.displaySettings = loadDisplaySettings();
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
    this.timeGpu();
    this.checkBloom();
    this.createInput();
    if (this.touchOn) {
      this.createTouch();
    }
    const asked = new URLSearchParams(window.location.search);
    const view = loadViewSettings();
    if (view.snapRotation) {
      this.sim.setRotationSnap(ROTATION_SNAP_STEPS);
    }
    if (!view.effects || asked.get("effects") === "0") {
      this.setEffects(false);
    }
    if (asked.get("diag") === "1") {
      const renderer = this.renderer;
      this.diagnostics = new Diagnostics(renderer instanceof Phaser11.Renderer.WebGL.WebGLRenderer ? renderer.gl : void 0, this.game.canvas);
    }
    this.applyLoadout();
    this.resize();
    this.scale.on(Phaser11.Scale.Events.RESIZE, () => {
      this.resize();
    });
    this.startNetPlay();
    if (!loadIntroSeen()) {
      this.introScreen.show(this.touchOn);
    }
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
      frameMs: { average: 0, worst: 0 },
      fpsCap: false,
      cssPixels: false,
      gpuMs: void 0,
      weaponFrame: 0,
      audio: {
        muted: false,
        music: false,
        locked: true,
        backend: "none",
        musicLoaded: false,
        musicPlace: "home",
        playingMusic: null,
        musicVolume: 0,
        fadingMusic: 0
      },
      net: { status: "offline", playerId: void 0, others: [] },
      enemies: [],
      enemiesDestroyed: 0,
      lastEnemyDestroyed: void 0,
      enemyFireGlow: false,
      field: { distance: null, zaps: 0 },
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
      hud: { panel: [], toasts: [] },
      orderMenuOpen: false,
      squadron: "",
      squadronScreen: false,
      victoryScreen: false,
      settingsScreen: false,
      introScreen: false,
      standings: { join: 0, down: 0 },
      touch: this.touchOn,
      touchButtons: [],
      touchSticks: [],
      touchFiring: false,
      mapOpen: false,
      openRings: 0,
      openedSectors: [],
      mapLayout: { x: 0, y: 0, scale: 0 },
      boss: void 0,
      sector: "",
      mission: void 0,
      worldEvent: void 0,
      lastClear: void 0,
      clearedSectors: [],
      missionBanner: void 0,
      derelicts: [],
      rescues: 0,
      teleports: 0,
      departing: 0,
      hangar: void 0,
      squadronMode: void 0
    };
    this.publish();
  }
  update(time, deltaMs) {
    this.frameTimes.add(deltaMs, time);
    const events = this.sim.advance(deltaMs / 1e3, this.readInput(), this.net?.squadmateDistance, this.net?.friendDistance);
    this.burstExpired(events);
    const net = this.net?.update(events);
    if (loadoutKey(this.sim.ship.loadout) !== this.shownLoadout) {
      this.applyLoadout();
    }
    this.openVictoryIfDue();
    this.updateStandings();
    this.drawTouch();
    this.diagnostics?.check();
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
    this.scrollBackgrounds(time, deltaMs);
    this.bossBar.show(bossBar(this.net?.bosses ?? [], this.sim.ship.x, this.sim.ship.y));
    this.audio.setMusicPlace(musicPlace(sectorName(this.sim.ship.x, this.sim.ship.y), this.victoryScreen.open));
    this.drawMissionArrow();
    this.drawMaps();
    this.drawClosed();
    this.drawField(time);
    this.announceMission(time);
    if (time - this.hudUpdatedAt > HUD_REFRESH_MS) {
      this.hudUpdatedAt = time;
      this.updateHud();
    }
    this.publish();
  }
  /**
   * Announces in the middle of the screen, one after another: a finished
   * mission, then the squadron's new one whenever it starts or changes (#101).
   */
  announceMission(time) {
    const net = this.net;
    if (net === void 0) {
      return;
    }
    const mission = net.mission;
    if (mission !== void 0 && mission !== this.announcedMission) {
      net.banners.push(missionBanner(mission));
    }
    this.announcedMission = mission;
    if (this.missionBanner.visible && time <= this.missionBannerUntil) {
      return;
    }
    const next = net.banners.shift();
    this.missionBanner.setVisible(next !== void 0);
    this.missionFrame.setVisible(next !== void 0);
    if (next !== void 0) {
      this.missionBanner.setText(next);
      this.drawMissionFrame();
      this.missionBannerUntil = time + MISSION_BANNER_MS;
    }
  }
  /** The banner's black, see-through box with a thin gold border, fitted around its text. */
  drawMissionFrame() {
    const b = this.missionBanner.getBounds();
    const line = MISSION_BANNER_BORDER_PX * this.dpr();
    this.missionFrame.clear().fillStyle(0, MISSION_BANNER_ALPHA).fillRect(b.x, b.y, b.width, b.height).lineStyle(line, MISSION_COLOR, 1).strokeRect(b.x + line / 2, b.y + line / 2, b.width - line, b.height - line);
  }
  /**
   * The arrows at the screen's edge: gold toward the squadron's mission (#101),
   * red toward a world event (#102), each while the ship is elsewhere.
   */
  drawMissionArrow() {
    const g = this.missionArrow.clear();
    this.drawArrow(g, this.missionLabel, this.net?.mission, MISSION_COLOR);
    this.drawArrow(g, this.eventLabel, this.net?.worldEvent?.sector, EVENT_COLOR);
  }
  drawArrow(g, label, sector, color) {
    const mission = sector;
    const { width, height } = this.scale;
    const dpr = this.dpr();
    const at2 = mission === void 0 ? void 0 : missionArrow(this.sim.ship, mission, width, height, MISSION_ARROW_MARGIN_PX * dpr);
    label.setVisible(at2 !== void 0);
    if (at2 === void 0 || mission === void 0) {
      return;
    }
    const size = MISSION_ARROW_SIZE_PX * dpr;
    const tip = { x: at2.x + Math.cos(at2.angle) * size, y: at2.y + Math.sin(at2.angle) * size };
    const side = (turn) => ({ x: at2.x + Math.cos(at2.angle + turn) * size * 0.7, y: at2.y + Math.sin(at2.angle + turn) * size * 0.7 });
    const left = side(Math.PI / 2);
    const right = side(-Math.PI / 2);
    g.fillStyle(color, 1).fillTriangle(tip.x, tip.y, left.x, left.y, right.x, right.y);
    label.setText(mission).setFontSize(HUD_FONT_PX * dpr).setPosition(at2.x - Math.cos(at2.angle) * size * MISSION_LABEL_OFFSET, at2.y - Math.sin(at2.angle) * size * MISSION_LABEL_OFFSET);
  }
  createBackgrounds() {
    this.backgrounds = keys.background.map((key2, i) => {
      const sprite = this.add.tileSprite(0, 0, VIEW_WIDTH, VIEW_HEIGHT, key2, 0).setScrollFactor(0);
      this.world.add(sprite);
      return { sprite, factor: PARALLAX[i] ?? 0 };
    });
  }
  createScenery() {
    const lines = this.add.graphics().lineStyle(1, SECTOR_LINE_COLOR, SECTOR_LINE_ALPHA);
    for (const name of SECTOR_NAMES) {
      const [first, ...rest] = sectorCorners(name);
      if (first !== void 0) {
        lines.beginPath().moveTo(first.x, first.y);
        for (const corner of rest) {
          lines.lineTo(corner.x, corner.y);
        }
        lines.closePath().strokePath();
      }
    }
    this.world.add(lines);
    this.closedLayer = this.add.graphics();
    this.world.add(this.closedLayer);
    this.fieldLayer = this.add.graphics().setBlendMode(Phaser11.BlendModes.ADD);
    this.world.add(this.fieldLayer);
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
      squadronScreen: this.squadronScreen,
      pickups: this.pickups
    });
    this.net.start();
    this.events.once(Phaser11.Scenes.Events.SHUTDOWN, () => this.net?.stop());
    const background = new BackgroundTicker(
      (deltaMs) => {
        this.stepHidden(deltaMs);
      },
      document,
      workerTimer(),
      () => performance.now()
    );
    background.start();
    this.events.once(Phaser11.Scenes.Events.SHUTDOWN, () => {
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
  }
  createParticles() {
    this.muzzleFlash = this.add.particles(0, 0, keys.projectile("bigSpaceGun"), {
      frame: [2, 3, 4],
      lifespan: 120,
      speed: { min: 10, max: 40 },
      scale: { start: 0.35, end: 0 },
      alpha: { start: 0.9, end: 0 },
      blendMode: Phaser11.BlendModes.ADD,
      emitting: false
    });
    this.puff = this.add.particles(0, 0, keys.projectile("bigSpaceGun"), {
      frame: [6, 7, 8],
      lifespan: 260,
      speed: { min: 15, max: 60 },
      scale: { start: 0.4, end: 0 },
      alpha: { start: 0.8, end: 0 },
      blendMode: Phaser11.BlendModes.ADD,
      emitting: false
    });
    this.world.add([this.muzzleFlash, this.puff]);
  }
  /**
   * Bloom as Phaser's AddEffectBloom draws it, but with its threshold and
   * blur at half the screen's size between two smooth resamples (#143).
   */
  createBloom(main) {
    if (!(this.renderer instanceof Phaser11.Renderer.WebGL.WebGLRenderer)) {
      return;
    }
    registerResample(this.renderer);
    registerSmallBlend(this.renderer);
    const bloom = main.filters.external.addParallelFilters();
    bloom.top.add(new Resample(main, BLOOM_SCALE));
    bloom.top.addThreshold(BLOOM_THRESHOLD, 1);
    this.bloomBlur = bloom.top.addBlur(0, BLOOM_BLUR * BLOOM_SCALE, BLOOM_BLUR * BLOOM_SCALE, 1, 16777215, BLOOM_BLUR_STEPS);
    bloom.top.add(new Resample(main, 1 / BLOOM_SCALE));
    bloom.blend.blendMode = Phaser11.BlendModes.ADD;
    bloom.blend.amount = BLOOM_AMOUNT;
    this.bloom = bloom;
  }
  /**
   * The vignette the camera's filter used to draw, as one stretched image of
   * black at its darkness: the same look without a pass over every pixel.
   */
  createVignette() {
    if (!this.textures.exists(VIGNETTE_KEY)) {
      const canvas = document.createElement("canvas");
      canvas.width = VIGNETTE_SIZE;
      canvas.height = VIGNETTE_SIZE;
      canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(vignetteImage(VIGNETTE_SIZE, VIGNETTE)), VIGNETTE_SIZE, VIGNETTE_SIZE), 0, 0);
      this.textures.addCanvas(VIGNETTE_KEY, canvas)?.setFilter(Phaser11.Textures.FilterMode.LINEAR);
    }
    return this.add.image(0, 0, VIGNETTE_KEY).setOrigin(0, 0);
  }
  createCameras() {
    const main = this.cameras.main;
    main.setBackgroundColor("#05030a");
    main.startFollow(this.ship.root, true, CAMERA_LERP, CAMERA_LERP);
    main.setRoundPixels(true);
    this.createBloom(main);
    this.vignette = this.createVignette();
    main.ignore(this.vignette);
    this.hud = this.add.text(8, 8, "", { fontFamily: UI_FONT, fontSize: "12px", color: "#d8f8ff", align: "right" }).setOrigin(1, 1).setShadow(1, 1, "#000000", 0);
    main.ignore(this.hud);
    this.downPanel = this.add.text(0, 0, "", {
      fontFamily: UI_FONT,
      fontSize: `${String(DOWN_PANEL_FONT_PX)}px`,
      color: "#d8f8ff",
      align: "center",
      backgroundColor: "#05030acc"
    }).setOrigin(0.5, 0).setShadow(1, 1, "#000000", 0).setVisible(false);
    main.ignore(this.downPanel);
    this.missionFrame = this.add.graphics().setVisible(false);
    this.missionBanner = this.add.text(0, 0, "", {
      fontFamily: HEADING_FONT,
      fontSize: `${String(DOWN_PANEL_FONT_PX)}px`,
      color: MISSION_CSS,
      align: "center"
    }).setOrigin(0.5, 0).setShadow(1, 1, "#000000", 0).setVisible(false);
    main.ignore([this.missionFrame, this.missionBanner]);
    this.bossBar = new BossBarView(this, (object) => main.ignore(object));
    this.missionArrow = this.add.graphics();
    this.missionLabel = this.add.text(0, 0, "", { fontFamily: UI_FONT, fontSize: "12px", color: MISSION_CSS }).setOrigin(0.5).setShadow(1, 1, "#000000", 0);
    this.eventLabel = this.add.text(0, 0, "", { fontFamily: UI_FONT, fontSize: "12px", color: EVENT_CSS }).setOrigin(0.5).setShadow(1, 1, "#000000", 0);
    main.ignore([this.missionArrow, this.missionLabel, this.eventLabel]);
    this.maps = new MapView(this, (objects) => main.ignore(objects));
    this.hudCamera = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.hudCamera.ignore(this.world);
  }
  createInput() {
    const keyboard = this.input.keyboard;
    if (keyboard === null) {
      throw new Error("keyboard input is disabled");
    }
    const codes = Phaser11.Input.Keyboard.KeyCodes;
    this.moveKeys = {
      up: keyboard.addKey(codes.W),
      down: keyboard.addKey(codes.S),
      left: keyboard.addKey(codes.A),
      right: keyboard.addKey(codes.D)
    };
    this.input.mouse?.disableContextMenu();
    const onKeyDown = (event) => {
      if (event.repeat) {
        if (event.code === "Tab" && this.standingsHeld) {
          event.preventDefault();
        }
        return;
      }
      if (event.code === "F1") {
        event.preventDefault();
        this.toggleIntro();
      } else if (this.introScreen.open) {
        this.introKey(event);
      } else if (this.hudView.dropOpen !== void 0 && event.code === "Escape") {
        this.hudView.close();
      } else if (this.settingsScreen.open) {
        this.settingsKey(event);
      } else if (this.victoryScreen.open) {
        this.victoryKey(event);
      } else if (this.maps.open) {
        this.mapKey(event);
      } else if (event.code === "KeyM" && this.canOpenMap()) {
        this.maps.toggle();
      } else if (event.code === "Tab" && !this.joinScreenOpen()) {
        event.preventDefault();
        this.standingsHeld = true;
      } else if (event.code === "KeyO") {
        this.openVictory();
      } else if (event.code === "KeyQ") {
        this.pressOrders();
      } else if (event.code === "Escape") {
        this.openSettings();
      } else {
        this.handleDebugKey(event.code);
      }
    };
    const onKeyUp = (event) => {
      if (event.code === "KeyQ") {
        this.releaseOrders();
      } else if (event.code === "Tab") {
        this.standingsHeld = false;
      }
    };
    const onBlur = () => {
      this.closeOrderRing();
      this.standingsHeld = false;
    };
    this.input.on(Phaser11.Input.Events.POINTER_DOWN, (pointer) => {
      if (this.touchOn) {
        return;
      }
      const sector = this.maps.pick(pointer.x, pointer.y, this.net?.clearedSectors ?? /* @__PURE__ */ new Set(), this.net?.frontier ?? ALL_OPEN);
      if (sector !== void 0) {
        this.net?.pickMission(sector);
      }
    });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    this.events.once(Phaser11.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    });
  }
  /** The full map opens online, and not over the join screen or the order ring, where the keys and the mouse are theirs. */
  canOpenMap() {
    return this.net?.status === "online" && this.orderPress === void 0 && !this.joinScreenOpen();
  }
  /** Whether the squadron join screen is up, whose form takes Tab to move between its fields. */
  joinScreenOpen() {
    return document.querySelector("#squadron-form")?.hidden === false;
  }
  /** A key while the full map is open: M and Esc close it, and the rest wait. */
  mapKey(event) {
    if (event.code === "KeyM" || event.code === "Escape") {
      event.preventDefault();
      this.maps.close();
    }
  }
  /** Shades the closed sectors and finds their sides with the open ones, whenever the frontier changes (#123). */
  drawClosed() {
    const version = this.net?.frontierVersion ?? 0;
    if (version === this.closedDrawn) {
      return;
    }
    this.closedDrawn = version;
    const frontier = this.net?.frontier ?? ALL_OPEN;
    const g = this.closedLayer.clear();
    for (const name of SECTOR_NAMES) {
      if (sectorOpen(name, frontier)) {
        continue;
      }
      const [first, ...rest] = sectorCorners(name);
      if (first !== void 0) {
        g.fillStyle(0, CLOSED_SHADE_ALPHA).beginPath().moveTo(first.x, first.y);
        for (const corner of rest) {
          g.lineTo(corner.x, corner.y);
        }
        g.closePath().fillPath();
      }
    }
    this.closedSides = closedEdges(frontier);
  }
  /** Draws the force field along the closed sides near the ship, and zaps while the ship is in its push-back band (#127). */
  drawField(time) {
    const g = this.fieldLayer.clear();
    const ship = this.sim.ship;
    for (const { samples, nx, ny } of fieldSides(this.closedSides, ship, time / 1e3)) {
      if (this.effects) {
        for (const s of samples) {
          g.fillStyle(fieldColor(s.flare), FIELD_GLOW_ALPHA * s.flicker * (1 + s.flare * 3));
          g.fillCircle(s.x, s.y, FIELD_GLOW_RADIUS * (1 + s.flare));
          g.fillCircle(s.x, s.y, FIELD_CORE_RADIUS * (1 + s.flare));
        }
      }
      samples.forEach((s, i) => {
        const prev = samples[i - 1];
        if (prev === void 0) {
          return;
        }
        g.lineStyle(1, fieldColor(s.flare), Math.min(1, FIELD_STRAND_ALPHA * s.flicker * (1 + s.flare * 1.2)));
        g.lineBetween(prev.x, prev.y, s.x, s.y);
        if (!this.effects) {
          return;
        }
        g.lineStyle(1, fieldColor(s.flare / 2), Math.min(1, FIELD_STRAND_ALPHA * 0.6 * s.flicker * (1 + s.flare * 1.5)));
        g.lineBetween(prev.x2, prev.y2, s.x2, s.y2);
        if (s.flare > 0.3 && sparks(i, time / 1e3)) {
          const jump = Math.sin(i + time / 25) * FIELD_SPARK_JUMP;
          g.fillStyle(FIELD_SPARK_COLOR, s.flare).fillRect(s.x + nx * jump, s.y + ny * jump, 1, 1);
        }
      });
    }
    const volume = zapVolume(nearestSide(this.closedSides, ship), this.sim.downed);
    if (volume > 0 && time - this.lastZap >= FIELD_ZAP_EVERY_MS) {
      this.lastZap = time;
      this.fieldZaps++;
      this.audio.fieldZap(volume);
    }
  }
  /** Draws the maps, and hides the HUD's lines under the open full map (#100, decision 9). */
  drawMaps() {
    const now2 = performance.now();
    if (this.maps.open || now2 - this.mapsDrawnAt >= MINIMAP_REDRAW_MS) {
      this.mapsDrawnAt = now2;
      const net = this.net;
      const state = net?.status === "online" ? net.mapState(this.sim.ship) : void 0;
      this.maps.draw(state, net?.mapName ?? "", now2);
    }
    const alpha = this.maps.open ? 0 : 1;
    for (const o of [this.hud, this.missionBanner, this.missionFrame, this.missionArrow, this.missionLabel, this.eventLabel]) {
      o.setAlpha(alpha);
    }
  }
  /** Opens the victory screen once the season is won (#156), over the map. */
  openVictory() {
    const result = this.net?.seasonResult;
    if (result === void 0) {
      return;
    }
    this.maps.close();
    this.victoryScreen.show(result, this.net?.playerId);
  }
  /** Opens the victory screen when the season is won, or for a joiner seeing a won season the first time (#156). */
  openVictoryIfDue() {
    if (this.net?.takeVictory() === true) {
      this.openVictory();
    }
  }
  /** Shows the season so far on the join screen while it's up, and above the down panel while down (#167). */
  updateStandings() {
    const net = this.net;
    const players = net?.standings ?? [];
    for (const [panel, show] of [
      [this.standingsJoin, this.joinScreenOpen()],
      // Holding Tab shows it too, in the same place (#167, decision 6).
      [this.standingsDown, this.sim.downed || this.standingsHeld]
    ]) {
      panel.update(show, players, net?.playerId, net?.seasonStarted ?? 0, net?.standingsVersion ?? 0);
    }
  }
  /** A key while the victory screen is open: O and Esc close it, and the rest wait. */
  victoryKey(event) {
    if (event.code === "KeyO" || event.code === "Escape") {
      this.victoryScreen.hide();
    }
  }
  /** Whether a screen or the full map covers the game, so the ship holds still and the touch controls hide. */
  get screenOpen() {
    return this.maps.open || this.victoryScreen.open || this.settingsScreen.open || this.introScreen.open;
  }
  /** Opens the intro screen in place of any other screen, map or list, or closes it; not while the order ring is up. */
  toggleIntro() {
    if (this.introScreen.open) {
      this.introScreen.hide();
      return;
    }
    if (this.orderPress !== void 0) {
      return;
    }
    this.settingsScreen.hide();
    this.victoryScreen.hide();
    this.maps.close();
    this.hudView.close();
    this.standingsHeld = false;
    this.introScreen.show(this.touchOn);
  }
  /** A key while the intro screen is open: Esc closes it, and the rest wait. */
  introKey(event) {
    if (event.code === "Escape") {
      this.introScreen.hide();
    }
  }
  /** Opens the settings screen (#145), unless the join screen or the order ring is up. */
  openSettings() {
    const squadronScreen = document.querySelector("#squadron-form");
    if (this.orderPress !== void 0 || squadronScreen?.hidden === false) {
      return;
    }
    this.settingsScreen.show(optionRows(this.options()));
  }
  /** A key while the settings screen is open: Esc closes it, the arrows and Enter are its own, and the rest wait. */
  settingsKey(event) {
    if (event.code === "Escape") {
      this.settingsScreen.hide();
    } else {
      this.settingsScreen.key(event);
    }
  }
  /** The settings screen's options, as they are now. */
  options() {
    return {
      sound: !this.audioSettings.muted,
      music: this.audioSettings.music,
      controls: this.sim.controlMode,
      snapRotation: this.sim.ship.rotationSnap !== 0,
      effects: this.effects,
      fpsCap: this.displaySettings.fpsCap,
      lowResolution: this.displaySettings.cssPixels
    };
  }
  /** Changes one option to its next value, applies it at once and remembers it (#145). */
  setOption(id) {
    const next = changeOption(this.options(), id);
    switch (id) {
      case "sound":
        this.audio.toggleMute();
        saveAudioSettings(this.audioSettings);
        break;
      case "music":
        this.audio.toggleMusic();
        saveAudioSettings(this.audioSettings);
        break;
      case "controls":
        this.sim.controlMode = next.controls;
        saveControlMode(next.controls);
        break;
      case "snapRotation":
        this.sim.setRotationSnap(next.snapRotation ? ROTATION_SNAP_STEPS : 0);
        break;
      case "effects":
        this.setEffects(next.effects);
        break;
      case "fpsCap":
        this.displaySettings = { ...this.displaySettings, fpsCap: next.fpsCap };
        saveDisplaySettings(this.displaySettings);
        this.game.loop.setFPSLimit(next.fpsCap ? FPS_CAP : 0);
        break;
      case "lowResolution":
        this.displaySettings = { ...this.displaySettings, cssPixels: next.lowResolution };
        saveDisplaySettings(this.displaySettings);
        window.dispatchEvent(new Event("resize"));
        break;
    }
    if (id === "snapRotation" || id === "effects") {
      saveViewSettings({ snapRotation: next.snapRotation, effects: next.effects });
    }
    this.settingsScreen.update(optionRows(this.options()));
    this.updateHud();
  }
  /** The parts 1/2/3 and the drop-ups choose from (#191): the player's own, or undefined for every part where anything goes. */
  get ownedUnlocks() {
    return this.partKeys ? void 0 : this.net?.unlocks ?? defaultUnlocks();
  }
  /** Fits a part picked from a slot's drop-up (#191). */
  fitPart(kind, part) {
    const { loadout } = this.sim.ship;
    if (loadout[kind] === part || this.sim.downed) {
      return;
    }
    this.fit({ ...loadout, [kind]: part });
    this.applyLoadout();
    if (kind === "shield") {
      this.audio.shieldSwitched();
    } else {
      this.audio.partSwitched();
    }
  }
  /** Anything goes in development and offline: 1/2/3 cycle every part, and F3 shows frames per second (#91, #191). */
  get partKeys() {
    return this.net?.status !== "online" || this.net.development;
  }
  handleDebugKey(code) {
    const ship = this.sim.ship;
    if (!this.partKeys && code === "F3") {
      return;
    }
    const owned = this.ownedUnlocks;
    switch (code) {
      case "KeyK":
        this.net?.devStartAttack();
        break;
      case "KeyY":
        this.net?.devSeasonWon();
        break;
      case "F3":
        this.showFps = !this.showFps;
        this.updateHud();
        break;
      case "Digit1":
        this.fit({ ...ship.loadout, weapon: nextPart(WEAPONS, ship.loadout.weapon, owned) });
        this.applyLoadout();
        this.audio.partSwitched();
        break;
      case "Digit2":
        this.fit({ ...ship.loadout, engine: nextPart(ENGINES, ship.loadout.engine, owned) });
        this.applyLoadout();
        this.audio.partSwitched();
        break;
      case "Digit3":
        this.fit({ ...ship.loadout, shield: nextPart(SHIELDS, ship.loadout.shield, owned) });
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
      default:
    }
  }
  /** Q down: remember where the pointer is. */
  pressOrders(at2) {
    this.closeOrderRing();
    const pointer = this.input.activePointer;
    const screen = at2 ?? { x: pointer.x, y: pointer.y };
    const world = this.cameras.main.getWorldPoint(screen.x, screen.y);
    this.orderPress = {
      downAt: this.time.now,
      touch: at2 !== void 0,
      screenX: screen.x,
      screenY: screen.y,
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
    const style = { fontFamily: UI_FONT, fontSize: `${String(HUD_FONT_PX * dpr)}px` };
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
    const points = [new Phaser11.Math.Vector2(cx, cy)];
    const steps = 8;
    for (let k = 0; k <= steps; k++) {
      const a = mid - Math.PI / n + k * 2 * Math.PI / n / steps;
      points.push(new Phaser11.Math.Vector2(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry));
    }
    g.fillStyle(ORDER_COLORS[item.kind], 0.22).fillPoints(points, true);
  }
  pickedOrder(press) {
    const pointer = press.touch ? this.touch.position("orders") ?? { x: press.screenX, y: press.screenY } : this.input.activePointer;
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
      const world = press.touch ? { x: press.worldX, y: press.worldY } : this.input.activePointer.positionToCamera(this.cameras.main);
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
  /** Device pixels per CSS pixel the canvas renders at, for sizing the HUD: 1 when P picked CSS pixels (#143). */
  dpr() {
    const ratio = renderRatio(window.devicePixelRatio > 0 ? window.devicePixelRatio : 1, this.displaySettings.cssPixels);
    return this.touchOn ? touchUnit(this.scale.height, ratio) : ratio;
  }
  /** Fits a loadout, each part at the tier this player owns it at. */
  fit(loadout) {
    this.sim.setLoadout(withTiers(loadout, this.net?.unlocks ?? /* @__PURE__ */ new Map()));
    this.net?.sendStateNow();
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
    if (this.touchOn) {
      this.insets = this.safeInsets();
    }
    const effectScale = zoom / EFFECT_ZOOM;
    if (this.bloomBlur !== void 0) {
      this.bloomBlur.x = BLOOM_BLUR * effectScale * BLOOM_SCALE;
      this.bloomBlur.y = BLOOM_BLUR * effectScale * BLOOM_SCALE;
    }
    this.hudCamera.setSize(width, height);
    this.vignette.setDisplaySize(width, height);
    const dpr = this.dpr();
    this.hud.setFontSize(HUD_FONT_PX * dpr);
    this.layoutHud();
    this.maps.resize(width, height, dpr);
    this.bossBar.resize(width, dpr);
    this.downPanel.setFontSize(DOWN_PANEL_FONT_PX * dpr).setPadding(DOWN_PANEL_PADDING_X * dpr, DOWN_PANEL_PADDING_Y * dpr).setPosition(width / 2, height * DOWN_PANEL_Y);
    this.missionBanner.setFontSize(DOWN_PANEL_FONT_PX * dpr).setPadding(DOWN_PANEL_PADDING_X * dpr, DOWN_PANEL_PADDING_Y * dpr).setPosition(width / 2, height * MISSION_BANNER_Y);
    this.drawMissionFrame();
    for (const { sprite } of this.backgrounds) {
      sprite.setPosition(width / 2, height / 2).setSize(Math.ceil(width / zoom), Math.ceil(height / zoom));
    }
  }
  /** Turns the touch controls on (#180): screen-relative sticks, their view, and the canvas's touches. */
  createTouch() {
    this.sim.controlMode = "screen";
    document.body.classList.add("touch");
    this.touchView = new TouchView(this, (object) => {
      this.cameras.main.ignore(object);
    });
    const canvas = this.game.canvas;
    const at2 = (t) => {
      const r = canvas.getBoundingClientRect();
      return { x: (t.clientX - r.left) * canvas.width / r.width, y: (t.clientY - r.top) * canvas.height / r.height };
    };
    const onStart = (event) => {
      event.preventDefault();
      for (const t of event.changedTouches) {
        this.touchStart(t.identifier, at2(t));
      }
    };
    const onMove = (event) => {
      event.preventDefault();
      for (const t of event.changedTouches) {
        const p = at2(t);
        this.touch.moveTo(t.identifier, p.x, p.y);
      }
    };
    const onEnd = (event) => {
      event.preventDefault();
      this.askFullscreen();
      for (const t of event.changedTouches) {
        this.touchEnd(t.identifier);
      }
    };
    const onBlur = () => {
      this.touch.clear();
    };
    canvas.addEventListener("touchstart", onStart, { passive: false });
    canvas.addEventListener("touchmove", onMove, { passive: false });
    canvas.addEventListener("touchend", onEnd, { passive: false });
    canvas.addEventListener("touchcancel", onEnd, { passive: false });
    window.addEventListener("blur", onBlur);
    const victory = document.querySelector("#victory-form");
    const closeVictory = () => {
      this.victoryScreen.hide();
    };
    victory?.addEventListener("click", closeVictory);
    this.events.once(Phaser11.Scenes.Events.SHUTDOWN, () => {
      canvas.removeEventListener("touchstart", onStart);
      canvas.removeEventListener("touchmove", onMove);
      canvas.removeEventListener("touchend", onEnd);
      canvas.removeEventListener("touchcancel", onEnd);
      window.removeEventListener("blur", onBlur);
      victory?.removeEventListener("click", closeVictory);
    });
  }
  /** Asks for fullscreen once, on the first touch, where the browser has it. */
  askFullscreen() {
    if (this.askedFullscreen) {
      return;
    }
    this.askedFullscreen = true;
    this.switchFullscreen(true);
  }
  /** Switches the page to fullscreen or back, where the browser can: iPadOS Safari only by its webkit names, an iPhone's not at all. */
  switchFullscreen(on) {
    const page = document.documentElement;
    const doc = document;
    if (on) {
      if (page.requestFullscreen !== void 0) {
        page.requestFullscreen().catch(() => void 0);
      } else {
        page.webkitRequestFullscreen?.();
      }
    } else if (this.fullscreenState() === true) {
      if (doc.exitFullscreen !== void 0) {
        doc.exitFullscreen().catch(() => void 0);
      } else {
        doc.webkitExitFullscreen?.();
      }
    }
  }
  /** Whether the page is fullscreen, or undefined where the browser can't switch. */
  fullscreenState() {
    const doc = document;
    if (doc.fullscreenEnabled !== true && doc.webkitFullscreenEnabled !== true) {
      return void 0;
    }
    return (doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null) !== null;
  }
  /** The notch's safe area on the left and right, in canvas pixels, from the page's safe-area probe. */
  safeInsets() {
    const probe = document.querySelector("#safe-area");
    if (probe === null) {
      return { insetLeft: 0, insetRight: 0 };
    }
    const style = getComputedStyle(probe);
    const toCanvas = this.scale.width / Math.max(1, window.innerWidth);
    return { insetLeft: parseFloat(style.paddingLeft) * toCanvas || 0, insetRight: parseFloat(style.paddingRight) * toCanvas || 0 };
  }
  /** A touch lands: it closes an open screen or map, picks a sector, or starts a stick, a button or the map. */
  touchStart(id, p) {
    if (this.introScreen.open) {
      this.introScreen.hide();
      return;
    }
    if (this.settingsScreen.open) {
      this.settingsScreen.hide();
      return;
    }
    if (this.victoryScreen.open) {
      this.victoryScreen.hide();
      return;
    }
    if (this.maps.open) {
      const sector = this.maps.pick(p.x, p.y, this.net?.clearedSectors ?? /* @__PURE__ */ new Set(), this.net?.frontier ?? ALL_OPEN);
      if (sector !== void 0) {
        this.net?.pickMission(sector);
      } else if (!this.maps.onFull(p.x, p.y)) {
        this.maps.close();
      }
      return;
    }
    const role = this.touch.start(id, p.x, p.y, this.scale.width, this.touchButtonRects, this.maps.onMinimap(p.x, p.y), this.dpr());
    if (role === "orders") {
      this.pressOrders(p);
    }
  }
  /** A touch lifts: a button does its job on release, like its key. */
  touchEnd(id) {
    switch (this.touch.end(id)) {
      case "orders":
        this.releaseOrders();
        break;
      case "summon":
        this.net?.summon();
        break;
      case "settings":
        this.openSettings();
        break;
      case "help":
        this.toggleIntro();
        break;
      case "respawnHome":
        this.respawn(false);
        break;
      case "respawnBeside":
        this.respawn(true);
        break;
      case "fullscreen":
        this.switchFullscreen(this.fullscreenState() !== true);
        break;
      case "map":
        if (this.canOpenMap()) {
          this.maps.toggle();
        }
        break;
      case "move":
      case "aim":
      case void 0:
        break;
    }
  }
  /** The touch sticks as input (#180): the left one moves, and the right one aims and fires while pushed. */
  readTouch() {
    const { x, y, angle } = this.sim.ship;
    const move = this.touch.stick("move");
    const aim = this.touch.aim() ?? { x: Math.cos(angle), y: Math.sin(angle) };
    return {
      up: false,
      down: false,
      left: false,
      right: false,
      moveX: move.x,
      moveY: move.y,
      pointerX: x + aim.x * TOUCH_AIM_REACH,
      pointerY: y + aim.y * TOUCH_AIM_REACH,
      fire: this.touch.firing
    };
  }
  /** Lays out and draws the touch buttons and sticks; none over a screen or the full map. */
  drawTouch() {
    if (this.touchView === void 0) {
      return;
    }
    this.touchButtonRects = this.screenOpen ? [] : touchButtons({
      width: this.scale.width,
      height: this.scale.height,
      dpr: renderRatio(window.devicePixelRatio > 0 ? window.devicePixelRatio : 1, this.displaySettings.cssPixels),
      down: this.sim.downed,
      canRespawn: this.sim.canRespawn,
      beside: this.net?.nearestSquadmate()?.name,
      fullscreen: this.fullscreenState(),
      ...this.insets
    });
    this.touchView.draw(this.touch, this.touchButtonRects, this.dpr());
  }
  readInput() {
    const pointer = this.input.activePointer;
    const aim = pointer.positionToCamera(this.cameras.main);
    if (this.touchOn && !this.screenOpen) {
      return this.readTouch();
    }
    if (this.screenOpen) {
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
    const keys2 = `[H] respawn at home${beside === void 0 ? "" : `      [J] respawn beside ${beside.name}`}`;
    const choices = this.sim.canRespawn ? this.touchOn ? "respawn with a button above" : keys2 : `respawn in ${String(Math.ceil(RESPAWN_DELAY - this.sim.ship.downFor))} s`;
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
        sprite.play(keys.projectile("autoCannon"), true).setTint(SHARD_TINT).setScale(1);
      } else if (isWeapon(p.kind)) {
        sprite.play(keys.projectile(p.kind), true).clearTint().setScale(1);
      } else if (this.effects) {
        sprite.play(keys.enemyBulletGlow(p.kind), true).clearTint().setScale(BAKED_GLOW_SCALE);
      } else {
        sprite.play(keys.enemyBullet(p.kind), true).clearTint().setScale(1);
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
  /** Scrolls each layer at its parallax factor and tints it for the ship's ring; TileSprites cannot play animations, so frames step here. */
  scrollBackgrounds(time, deltaMs) {
    const camera = this.cameras.main;
    const frame = Math.floor(time / 1e3 * BACKGROUND_FPS) % BACKGROUND_FRAMES;
    const frameChanged = frame !== this.backgroundFrame;
    this.backgroundFrame = frame;
    const tint = fadeColor(this.backgroundTint, ringTint(this.sim.ship.x, this.sim.ship.y), deltaMs / RING_TINT_FADE_MS);
    const tintChanged = tint !== this.backgroundTint;
    this.backgroundTint = tint;
    for (const { sprite, factor } of this.backgrounds) {
      sprite.setTilePosition(camera.scrollX * factor, camera.scrollY * factor);
      if (frameChanged) {
        sprite.setFrame(frame);
      }
      if (tintChanged) {
        sprite.setTint(tint);
      }
    }
  }
  /** Times the GPU's work for each frame, where the browser can (#143). */
  timeGpu() {
    const renderer = this.renderer;
    if (!(renderer instanceof Phaser11.Renderer.WebGL.WebGLRenderer)) {
      return;
    }
    const timer = new GpuTimer(renderer.gl);
    if (!timer.available) {
      return;
    }
    this.gpuTimer = timer;
    renderer.on(Phaser11.Renderer.Events.PRE_RENDER, () => {
      timer.begin();
    });
    renderer.on(Phaser11.Renderer.Events.POST_RENDER, () => {
      timer.end();
    });
  }
  /** Turns the bloom and the vignette on or off: F, or `?effects=0` for a device without a keyboard. The bloom stays off where it draws the world black. */
  setEffects(on) {
    this.effects = on;
    if (this.bloom !== void 0) {
      this.bloom.active = on && !this.bloomBroken;
    }
    this.vignette.setVisible(on);
    this.updateHud();
  }
  /**
   * Turns the bloom off for good in this browser if it draws the world black,
   * as Phaser's parallel filters do on some phones' GPUs (a PowerVR D-Series,
   * #180): a moment after the start, if every sample across the middle of the
   * screen is pure black, which the world's background never is.
   */
  checkBloom() {
    const renderer = this.renderer;
    if (!(renderer instanceof Phaser11.Renderer.WebGL.WebGLRenderer) || this.bloom === void 0) {
      return;
    }
    if (loadBloomBroken()) {
      this.bloomBroken = true;
      this.bloom.active = false;
      return;
    }
    let frames = 0;
    const check = () => {
      frames++;
      if (frames < BLOOM_CHECK_FRAME || this.bloom?.active !== true) {
        return;
      }
      renderer.off(Phaser11.Renderer.Events.POST_RENDER, check);
      const gl = renderer.gl;
      const bound = gl.getParameter(gl.FRAMEBUFFER_BINDING);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const samples = blankSamples(gl.drawingBufferWidth, gl.drawingBufferHeight).map(({ x, y }) => {
        const pixel = new Uint8Array(4);
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        return pixel;
      });
      gl.bindFramebuffer(gl.FRAMEBUFFER, bound);
      if (allBlack(samples)) {
        this.bloomBroken = true;
        this.bloom.active = false;
        saveBloomBroken();
      }
    };
    renderer.on(Phaser11.Renderer.Events.POST_RENDER, check);
  }
  /** The HUD's frame rate: frames a second, the worst frame of the last second, and the GPU's time where known. */
  fpsLine() {
    const gpu = this.gpuTimer?.last;
    return `${String(Math.round(this.game.loop.actualFps))} fps (worst ${this.frameTimes.worst.toFixed(1)} ms${gpu === void 0 ? "" : `, gpu ${gpu.toFixed(1)} ms`})`;
  }
  updateHud() {
    this.hud.setText([
      // The hint is about keys, so a tablet goes without it (#180, decision 6).
      ...this.touchOn ? [] : [KEY_HINT],
      ...this.showFps ? [this.fpsLine()] : [],
      ...this.diagnostics?.lines() ?? []
    ]);
    this.layoutHud();
    this.updateHudView();
  }
  layoutHud() {
    const dpr = this.dpr();
    this.hud.setPosition(this.scale.width - HUD_MARGIN_PX * dpr, this.scale.height - HUD_MARGIN_PX * dpr);
  }
  /** Draws the gauge, the panel and the toasts (#91); hidden under the full map. */
  updateHudView() {
    const { ship } = this.sim;
    const { loadout } = ship;
    const net = this.net;
    const online = net?.status === "online";
    const owned = this.ownedUnlocks;
    const unlocks = this.net?.unlocks ?? defaultUnlocks();
    const view = (part, tier) => ({ part, file: pickupFile(part), name: partLabel(part, tier), color: tierCss(tier), hint: PART_HINTS[part] });
    const slot = (kind, key2, parts, part, tier) => ({
      ...view(part, tier),
      kind,
      key: key2,
      options: ownedParts(parts, owned).map((p) => view(p, unlocks.get(p) ?? 0))
    });
    const info = net?.squadronInfo;
    const here = sectorName(ship.x, ship.y);
    const toasts = [connectionToast(net?.status), net?.noticeText].filter((t) => t !== void 0);
    this.hudView.update({
      shown: !this.maps.open,
      slots: [
        slot("weapon", "1", WEAPONS, loadout.weapon, loadout.weaponTier),
        slot("engine", "2", ENGINES, loadout.engine, loadout.engineTier),
        slot("shield", "3", SHIELDS, loadout.shield, loadout.shieldTier)
      ],
      hull: hullPips(ship.damage),
      shield: shieldPips(ship.shield, SHIELD_STATS[loadout.shield].strength),
      rows: panelRows({
        squadron: info === void 0 ? void 0 : {
          name: info.name,
          others: info.members.filter((m) => m.playerId !== net?.playerId).map((m) => m.name),
          companions: info.members.reduce((n, m) => n + m.companions, 0),
          order: modeName(info),
          mode: fromCompanionMode(info.mode) ?? "escort"
        },
        hangar: Math.hypot(ship.x, ship.y) <= SAFE_ZONE_RADIUS ? net?.hangar : void 0,
        // How many of your companions are out, which the loadout screen showed until #191.
        companions: online ? { out: net.companionCount, limit: net.companionLimit } : void 0,
        sector: here === void 0 ? void 0 : { name: here, state: sectorState(here, online ? net.clearedSectors : void 0, net?.frontier) },
        mission: net?.mission,
        event: net?.eventLine(performance.now()) ?? ""
      }),
      toasts
    });
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
    this.debug.fpsCap = this.game.loop.hasFpsLimit;
    this.debug.cssPixels = this.displaySettings.cssPixels;
    this.debug.enemyFireGlow = this.effects;
    this.debug.hud = { panel: this.hudView.rowTexts, toasts: this.hudView.toastTexts };
    const distance = nearestSide(this.closedSides, this.sim.ship);
    this.debug.field = { distance: Number.isFinite(distance) ? distance : null, zaps: this.fieldZaps };
    this.debug.projectiles = projectiles.activeCount;
    this.debug.unlocks = Object.fromEntries(this.net?.unlocks ?? []);
    this.debug.pickups = this.pickups.items.map(({ id, part, x, y }) => ({ id, part, x, y }));
    this.debug.ownShards = projectiles.items.filter((p) => p.active && p.faction === "own" && p.kind === "shard").length;
    this.debug.shotsFired = this.shotsFired;
    this.debug.zoom = this.cameras.main.zoom;
    this.debug.fps = this.game.loop.actualFps;
    this.debug.frameMs = { average: this.frameTimes.average, worst: this.frameTimes.worst };
    this.debug.gpuMs = this.gpuTimer?.last;
    this.debug.weaponFrame = Number(this.ship.weapon.frame.name);
    this.debug.audio.muted = this.audioSettings.muted;
    this.debug.audio.music = this.audioSettings.music;
    this.debug.audio.locked = this.sound.locked;
    this.debug.audio.musicPlace = this.audio.musicPlace;
    this.debug.audio.playingMusic = this.audio.playingMusic;
    this.debug.audio.musicVolume = this.audio.musicVolume;
    this.debug.audio.fadingMusic = this.audio.fadingMusic;
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
    this.debug.victoryScreen = this.victoryScreen.open;
    this.debug.settingsScreen = this.settingsScreen.open;
    this.debug.introScreen = this.introScreen.open;
    this.debug.standings = { join: this.standingsJoin.rows, down: this.standingsDown.rows };
    this.debug.touchButtons = this.touchButtonRects.map((b) => b.button);
    this.debug.touchSticks = this.touch.sticks().map((s) => s.role);
    this.debug.touchFiring = this.touch.firing;
    this.debug.mapOpen = this.maps.open;
    this.debug.openRings = this.net?.frontier.openRings ?? 0;
    this.debug.openedSectors = [...this.net?.frontier.opened ?? []];
    this.debug.mapLayout = { ...this.maps.layout };
    this.debug.boss = this.bossBar.current;
    this.debug.mission = this.net?.mission;
    this.debug.lastClear = this.net?.lastClear;
    this.debug.clearedSectors = this.net?.status === "online" ? [...this.net.clearedSectors].sort() : [];
    this.debug.worldEvent = this.net?.worldEvent === void 0 ? void 0 : this.net.eventLine(performance.now());
    this.debug.missionBanner = this.missionBanner.visible ? this.missionBanner.text : void 0;
    this.debug.sector = sectorLine(this.sim.ship.x, this.sim.ship.y, this.net?.status === "online" ? this.net.clearedSectors : void 0, this.net?.frontier);
    this.debug.derelicts = this.net?.derelictList ?? [];
    this.debug.rescues = this.net?.rescues ?? 0;
    this.debug.teleports = this.net?.teleports ?? 0;
    this.debug.departing = this.net?.departingCount ?? 0;
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
  await Promise.all([
    loadSim("/static/wasm/sim.wasm"),
    ...[UI_FONT_NAME, HEADING_FONT_NAME].map(async (name) => document.fonts.load(`16px '${name}'`).catch(() => []))
  ]);
  const display = loadDisplaySettings();
  const size = deviceSize(window.innerWidth, window.innerHeight, renderRatio(window.devicePixelRatio, display.cssPixels));
  const game = new Phaser12.Game({
    type: Phaser12.AUTO,
    parent: "game",
    backgroundColor: "#05030a",
    pixelArt: true,
    roundPixels: true,
    banner: false,
    // Sized in device pixels and shown at CSS size, so pixel art stays even
    // at any display scaling (see display.ts).
    scale: {
      mode: Phaser12.Scale.NONE,
      width: size.width,
      height: size.height,
      zoom: size.zoom
    },
    scene: [BootScene, SandboxScene],
    // V caps it at 60 (#143); 0 follows the display.
    fps: { limit: display.fpsCap ? FPS_CAP : 0 },
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
    const size = deviceSize(window.innerWidth, window.innerHeight, renderRatio(window.devicePixelRatio, loadDisplaySettings().cssPixels));
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
