// src/main.ts
import Phaser3 from "./vendor/phaser.js";

// src/scenes/boot.ts
import Phaser from "./vendor/phaser.js";

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
  autoCannon: { weapon: "weapon-auto-cannon", projectile: "projectile-auto-cannon", frames: 7, projectileFrames: 4 },
  rockets: { weapon: "weapon-rockets", projectile: "projectile-rocket", frames: 17, projectileFrames: 3 },
  bigSpaceGun: { weapon: "weapon-big-space-gun", projectile: "projectile-big-space-gun", frames: 12, projectileFrames: 10 },
  zapper: { weapon: "weapon-zapper", projectile: "projectile-zapper", frames: 14, projectileFrames: 8 }
};
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
  asteroid: "asteroid"
};
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
        // One firing animation per shot interval, so it keeps up with holding the trigger.
        strip(keys.weapon(id), `${ship}/${f.weapon}.png`, 48, f.frames, f.frames / WEAPON_STATS[id].interval, false),
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
    still(keys.asteroid, `${env}/asteroid.png`, 96)
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
import Phaser2 from "./vendor/phaser.js";

// src/debug.ts
function publishDebugState(state) {
  window.voidmarch = state;
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
function toCommand(input) {
  const move = normalize(Number(input.right) - Number(input.left), Number(input.down) - Number(input.up));
  return { moveX: move.x, moveY: move.y, aimX: input.pointerX, aimY: input.pointerY, fire: input.fire };
}

// src/sim/projectiles.ts
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
function place(p) {
  const stats = WEAPON_STATS[p.weapon];
  const lateral = stats.zigzag.amplitude * triangleWave(p.age * stats.zigzag.frequency);
  const offset = rotateOffset(travelled(stats, p.age), lateral, p.angle);
  p.x = p.originX + offset.x;
  p.y = p.originY + offset.y;
}
var ProjectilePool = class {
  items;
  next = 0;
  constructor(capacity) {
    this.items = Array.from({ length: capacity }, () => ({
      active: false,
      weapon: DEFAULT_LOADOUT.weapon,
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
  spawn(shot) {
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
    chosen.weapon = shot.weapon;
    chosen.originX = shot.x;
    chosen.originY = shot.y;
    chosen.angle = shot.angle;
    chosen.age = 0;
    place(chosen);
    return chosen;
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
      if (p.age >= WEAPON_STATS[p.weapon].lifetime || !inBounds(p.x, p.y)) {
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
  const shots = [];
  ship.cooldown -= dt;
  if (!fire) {
    ship.cooldown = Math.max(ship.cooldown, 0);
    return shots;
  }
  while (ship.cooldown <= 0) {
    ship.cooldown += stats.interval;
    const muzzles = stats.alternate ? [stats.muzzles[ship.nextMuzzle % stats.muzzles.length]] : stats.muzzles;
    ship.nextMuzzle = (ship.nextMuzzle + 1) % stats.muzzles.length;
    for (const muzzle of muzzles) {
      if (muzzle === void 0) {
        continue;
      }
      const offset = rotateOffset(muzzle.forward, muzzle.right, ship.angle);
      shots.push({ weapon: ship.loadout.weapon, x: ship.x + offset.x, y: ship.y + offset.y, angle: ship.angle });
    }
  }
  return shots;
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
  accumulator = 0;
  /** How far the display is between the last two ticks, from 0 to 1. */
  get alpha() {
    return this.accumulator / TICK_SECONDS;
  }
  /** Runs as many fixed ticks as frameSeconds covers, using the same input for each. */
  advance(frameSeconds, input) {
    const events = { ticks: 0, shots: [], expired: [] };
    this.accumulator = Math.min(this.accumulator + frameSeconds, TICK_SECONDS * MAX_TICKS_PER_FRAME);
    const cmd = toCommand(input);
    while (this.accumulator >= TICK_SECONDS) {
      this.accumulator -= TICK_SECONDS;
      this.tick(cmd, events);
    }
    return events;
  }
  tick(cmd, events) {
    this.previous.x = this.ship.x;
    this.previous.y = this.ship.y;
    stepShip(this.ship, cmd, TICK_SECONDS);
    applyWorldEdge(this.ship, TICK_SECONDS);
    for (const shot of stepWeapon(this.ship, cmd.fire, TICK_SECONDS)) {
      this.projectiles.spawn(shot);
      events.shots.push(shot);
    }
    for (const p of this.projectiles.step(TICK_SECONDS, projectileInBounds)) {
      events.expired.push({ weapon: p.weapon, x: p.x, y: p.y });
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

// src/scenes/sandbox.ts
var PARALLAX = [0.05, 0.15, 0.3];
var BACKGROUND_FPS = 6;
var BACKGROUND_FRAMES = 9;
var CAMERA_LERP = 0.15;
var HUD_REFRESH_MS = 250;
var SPRITE_FACING = Math.PI / 2;
var SandboxScene = class extends Phaser2.Scene {
  sim = new Sandbox();
  world;
  backgrounds = [];
  backgroundFrame = 0;
  ship;
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
  constructor() {
    super("sandbox");
  }
  create() {
    this.world = this.add.layer();
    this.createBackgrounds();
    this.createScenery();
    this.ship = this.createShip();
    this.createProjectiles();
    this.createParticles();
    this.createCameras();
    this.createInput();
    this.applyLoadout();
    this.resize();
    this.scale.on(Phaser2.Scale.Events.RESIZE, () => {
      this.resize();
    });
    this.debug = {
      ready: true,
      scene: this.scene.key,
      ship: { x: 0, y: 0, angle: 0, thrusting: false },
      loadout: this.sim.ship.loadout,
      damage: this.damage,
      rotationSnap: 0,
      effects: this.effects,
      projectiles: 0,
      shotsFired: 0,
      zoom: 1,
      fps: 0
    };
    this.publish();
  }
  update(time, deltaMs) {
    const events = this.sim.advance(deltaMs / 1e3, this.readInput());
    this.drawShip(events);
    this.drawProjectiles();
    this.playEffects(events);
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
  createShip() {
    const engine = this.add.image(0, 0, keys.engine("base"));
    const flame = this.add.sprite(0, 0, keys.flameIdle("base"));
    const hull = this.add.image(0, 0, keys.hull("fullHealth"));
    const weapon = this.add.sprite(0, 0, keys.weapon("autoCannon"), 0);
    const shield = this.add.sprite(0, 0, keys.shield("front"));
    const root = this.add.container(this.sim.ship.x, this.sim.ship.y, [engine, flame, hull, weapon, shield]);
    weapon.on(Phaser2.Animations.Events.ANIMATION_COMPLETE, () => weapon.setFrame(0));
    this.world.add(root);
    return { root, engine, flame, hull, weapon, shield };
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
      blendMode: Phaser2.BlendModes.ADD,
      emitting: false
    });
    this.puff = this.add.particles(0, 0, keys.projectile("bigSpaceGun"), {
      frame: [6, 7, 8],
      lifespan: 260,
      speed: { min: 15, max: 60 },
      scale: { start: 0.4, end: 0 },
      alpha: { start: 0.8, end: 0 },
      blendMode: Phaser2.BlendModes.ADD,
      emitting: false
    });
    this.world.add([this.muzzleFlash, this.puff]);
  }
  createCameras() {
    const main = this.cameras.main;
    main.setBackgroundColor("#05030a");
    main.startFollow(this.ship.root, true, CAMERA_LERP, CAMERA_LERP);
    main.setRoundPixels(true);
    this.bloom = Phaser2.Actions.AddEffectBloom(main, { threshold: 0.55, blurRadius: 3, blendAmount: 0.6 })[0]?.parallelFilters;
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
    const codes = Phaser2.Input.Keyboard.KeyCodes;
    this.moveKeys = {
      up: keyboard.addKey(codes.W),
      down: keyboard.addKey(codes.S),
      left: keyboard.addKey(codes.A),
      right: keyboard.addKey(codes.D)
    };
    this.input.mouse?.disableContextMenu();
    const ship = this.sim.ship;
    keyboard.on("keydown-ONE", () => {
      ship.loadout.weapon = nextInCycle(WEAPONS, ship.loadout.weapon);
      ship.cooldown = 0;
      ship.nextMuzzle = 0;
      this.applyLoadout();
    });
    keyboard.on("keydown-TWO", () => {
      ship.loadout.engine = nextInCycle(ENGINES, ship.loadout.engine);
      this.applyLoadout();
    });
    keyboard.on("keydown-THREE", () => {
      ship.loadout.shield = nextInCycle(SHIELDS, ship.loadout.shield);
      this.applyLoadout();
    });
    keyboard.on("keydown-H", () => {
      this.damage = nextInCycle(DAMAGE_STATES, this.damage);
      ship.damage = DAMAGE_STATES.indexOf(this.damage);
      this.ship.hull.setTexture(keys.hull(this.damage));
    });
    keyboard.on("keydown-R", () => {
      ship.rotationSnap = ship.rotationSnap === 0 ? ROTATION_SNAP_STEPS : 0;
    });
    keyboard.on("keydown-F", () => {
      this.effects = !this.effects;
      if (this.bloom !== void 0) {
        this.bloom.active = this.effects;
      }
      if (this.vignette !== void 0) {
        this.vignette.active = this.effects;
      }
    });
  }
  applyLoadout() {
    const { weapon, engine, shield } = this.sim.ship.loadout;
    this.ship.engine.setTexture(keys.engine(engine));
    this.ship.flame.play(keys.flameIdle(engine));
    this.ship.weapon.stop().setTexture(keys.weapon(weapon), 0);
    this.ship.shield.play(keys.shield(shield));
    this.updateHud();
  }
  resize() {
    const { width, height } = this.scale;
    const zoom = integerZoom(width, height, VIEW_WIDTH, VIEW_HEIGHT);
    this.cameras.main.setZoom(zoom);
    this.hudCamera.setSize(width, height);
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
    this.ship.root.setPosition(previous.x + (ship.x - previous.x) * alpha, previous.y + (ship.y - previous.y) * alpha).setRotation(ship.angle + SPRITE_FACING);
    const engine = ship.loadout.engine;
    this.ship.flame.play(ship.thrusting ? keys.flamePowering(engine) : keys.flameIdle(engine), true);
    if (events.shots.length > 0) {
      this.ship.weapon.play(keys.weapon(ship.loadout.weapon));
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
      sprite.play(keys.projectile(p.weapon), true);
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
      `rotation ${rotationSnap === 0 ? "free" : `${rotationSnap} directions`}  effects ${this.effects ? "on" : "off"}  ${Math.round(this.game.loop.actualFps)} fps`,
      "WASD move \xB7 mouse aim \xB7 hold left button to fire \xB7 1/2/3 parts \xB7 H hull \xB7 R rotation \xB7 F effects"
    ]);
  }
  publish() {
    const { ship, projectiles } = this.sim;
    this.debug.ship.x = ship.x;
    this.debug.ship.y = ship.y;
    this.debug.ship.angle = ship.angle;
    this.debug.ship.thrusting = ship.thrusting;
    this.debug.damage = this.damage;
    this.debug.rotationSnap = ship.rotationSnap;
    this.debug.effects = this.effects;
    this.debug.projectiles = projectiles.activeCount;
    this.debug.shotsFired = this.shotsFired;
    this.debug.zoom = this.cameras.main.zoom;
    this.debug.fps = this.game.loop.actualFps;
    publishDebugState(this.debug);
  }
};

// src/main.ts
new Phaser3.Game({
  type: Phaser3.AUTO,
  parent: "game",
  backgroundColor: "#05030a",
  pixelArt: true,
  roundPixels: true,
  banner: false,
  scale: {
    mode: Phaser3.Scale.RESIZE,
    width: "100%",
    height: "100%"
  },
  scene: [BootScene, SandboxScene]
});
