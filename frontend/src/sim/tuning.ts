/**
 * Presentation tunables: the view, the effects and what's worth drawing or
 * hearing. The rules' numbers are the Go sim's (internal/sim/tuning.go),
 * generated into rules.gen.ts and passed on here.
 */
export {
  BRAIN_SPACING,
  ENGINE_STATS,
  HOME_SPAWN_Y,
  INTEREST_MARGIN,
  INTEREST_RADIUS,
  MAX_DAMAGE,
  MAX_TICKS_PER_FRAME,
  RAM_DAMAGE,
  RESPAWN_DELAY,
  SHARD_DAMAGE,
  SAFE_ZONE_RADIUS,
  SHIP_RADIUS,
  TICK_RATE,
  TICK_SECONDS,
  WEAPON_STATS,
  WORLD_APOTHEM,
  WORLD_EDGE_BAND,
} from './rules.gen.ts';

/** The view is at least this many art pixels; the zoom is the largest whole number that fits. */
export const VIEW_WIDTH = 640;
export const VIEW_HEIGHT = 360;

/** 0 is free rotation; 16 snaps to 16 directions (see docs/design.md, "Controls & feel"). */
export const ROTATION_SNAP_STEPS = 16;

export const ASTEROID_SEED = 20260927;
export const ASTEROID_COUNT = 60;
/** Keeps asteroids away from the home planet. */
export const ASTEROID_CLEAR_RADIUS = 260;

/**
 * Volleys from enemies farther than this from the ship are skipped: past the
 * view plus the bullets' reach, they can neither be seen nor hit you.
 */
export const ENEMY_VOLLEY_RANGE = 800;
/** Enemies explode audibly only this close to the ship, about the view. */
export const ENEMY_SOUND_RANGE = 400;
/** How far the engine loop's rate or volume moves before it is set again: each rate change restarts the loop's source (#263). */
export const ENGINE_MIX_STEP = 0.01;

/**
 * Enemy bullets fly on a layer with one glow in this color (0xRRGGBB), so
 * they stand out from the players' shots (#36). Quality is the filter's
 * sample count: a low one keeps software-rendered CI fast.
 */
export const ENEMY_FIRE_GLOW_COLOR = 0x3fa8ff;
/** What a Bomber's hull adds while it warns of a volley, having no weapons to animate (#137): half the enemy fire's blue. */
export const BOMBER_WARN_TINT = 0x1f5480;
export const ENEMY_FIRE_GLOW_STRENGTH = 6;
export const ENEMY_FIRE_GLOW_QUALITY = 3;
export const ENEMY_FIRE_GLOW_DISTANCE = 4;
/** A Support Ship's repair line (#184): thin, green, at the order ring's alpha. */
export const REPAIR_LINE_COLOR = 0x5ee05e;
export const REPAIR_LINE_ALPHA = 0.35;
export const REPAIR_LINE_WIDTH = 1;

/** A tier's color, from #77's mockup: none for plain, then Super blue, Mega violet, Hyper gold. */
export const TIER_COLORS: readonly (number | undefined)[] = [undefined, 0x5ad1ff, 0xc77dff, 0xffc93c];
/** When a pickup starts blinking before it's gone, in seconds after it dropped. */
export const PICKUP_BLINK_AFTER = 20;
/** A pickup's tier glow: its strength and quality, as Phaser's glow filter takes them. */
export const PICKUP_GLOW_STRENGTH = 6;
export const PICKUP_GLOW_QUALITY = 12;
export const PICKUP_GLOW_DISTANCE = 6;
/** A pickup the viewer has no use for (every tier already), drawn faint. */
export const PICKUP_USELESS_ALPHA = 0.45;
/** The sector edges (#99): faint lines in the HUD's light blue. */
export const SECTOR_LINE_COLOR = 0xd8f8ff;
export const SECTOR_LINE_ALPHA = 0.25;
/** How far past the view, in world pixels, the sector edges are drawn, so none shows up a frame late (#265). */
export const SECTOR_VIEW_MARGIN = 64;
/** The mission arrow at the screen's edge (#101): the mockups' gold, its size and inset in CSS pixels. */
export const MISSION_COLOR = 0xffd27a;
export const MISSION_CSS = '#ffd27a';
export const MISSION_ARROW_SIZE_PX = 24;
export const MISSION_ARROW_MARGIN_PX = 44;
/** How far in from an edge arrow its sector label sits, in arrow lengths. */
export const MISSION_LABEL_OFFSET = 1.4;
/** A new mission's banner (#101): how long it shows, and how far down the screen it sits. */
export const MISSION_BANNER_MS = 6000;
export const MISSION_BANNER_Y = 0.22;
/** The banner's box: black at this opacity, with a gold border this thick in CSS pixels. */
export const MISSION_BANNER_ALPHA = 0.6;
export const MISSION_BANNER_BORDER_PX = 1;
/** An attack's time left, in seconds, when its warning shows once more (#272). */
export const ATTACK_REMINDER_SECONDS = 60;
/** A world event's arrow and label (#102), in the enemy coral. */
export const EVENT_COLOR = 0xff5a4a;
export const EVENT_CSS = '#ff5a4a';

/** The game's two fonts (#170): Exo 2 for its text and announcements (#254), Orbitron for titles. */
export const UI_FONT_NAME = 'Exo 2';
export const HEADING_FONT_NAME = 'Orbitron';
export const UI_FONT = `'${UI_FONT_NAME}', sans-serif`;
export const HEADING_FONT = `${HEADING_FONT_NAME}, sans-serif`;

/** The maps (#100): the minimap's width and the full map's height, in CSS pixels. */
export const MINIMAP_WIDTH_PX = 170;
/** How far the minimap sits in from the top and right: inside the edge arrows' track and their labels (#100). */
export const MINIMAP_INSET_PX = 96;
export const FULL_MAP_HEIGHT_PX = 470;
export const MAP_MARGIN_PX = 10;
export const MAP_HOME_COLOR = 0x2f6f9c;
export const MAP_CLEARED_COLOR = 0x2c6a3c;
/** Hostile sectors by ring, darker the farther from home. */
export const MAP_HOSTILE_COLORS: readonly number[] = [0x8a3030, 0x8a3030, 0x6e2626, 0x561d1d];
export const MAP_FILL_ALPHA = 0.9;
/** The minimap's sectors are see-through, so ships behind it stay visible (#91, decision 6). */
export const MINIMAP_FILL_ALPHA = 0.45;
/** A closed sector on the maps (#123). */
export const MAP_CLOSED_COLOR = 0x2a2a33;
/** In the world, a closed sector's shade (#123). */
export const CLOSED_SHADE_ALPHA = 0.45;
/** The force field on a closed sector's edge with the open ones (#127): its red, and what it flares toward near a ship. */
export const FIELD_COLOR = 0xff5a4a;
export const FIELD_HOT_COLOR = 0xff9a80;
/** World px between the field's samples along a side. */
export const FIELD_STEP = 5;
/** Sides farther than this from the ship aren't drawn: drawing every one each frame costs too much. */
export const FIELD_DRAW_RANGE = 450;
/** The field starts to flare this far from a ship, which reaches past the push-back band. */
export const FIELD_FLARE_RANGE = 340;
/** The two strands' ripples: each a pair of waves, in radians per px along the side and per second. */
export const FIELD_RIPPLES = [
  { amplitude: 2.2, along: 0.05, speed: 3.1, phase: 0 },
  { amplitude: 1.2, along: 0.13, speed: -5.3, phase: 0 },
  { amplitude: 2.2, along: 0.07, speed: -4.2, phase: 1.7 },
  { amplitude: 1.2, along: 0.17, speed: 6.1, phase: 0 },
] as const;
/** How much wider the ripples get at full flare, and its fast jitter in px. */
export const FIELD_FLARE_SWELL = 2.5;
export const FIELD_JITTER = 2.5;
export const FIELD_STRAND_ALPHA = 0.55;
export const FIELD_GLOW_ALPHA = 0.035;
export const FIELD_GLOW_RADIUS = 9;
export const FIELD_CORE_RADIUS = 4;
/** The glow's dot texture, in texels per world px: at full flare it doubles, and stays sharp. */
export const FIELD_DOT_TEXELS = 4;
/** World px past the camera's view still sampled: a flared glow, the ripples, and a view a frame old. */
export const FIELD_VIEW_MARGIN = 48;
/** A spark's color, and how far it jumps off the strand in px. */
export const FIELD_SPARK_COLOR = 0xffd0c0;
export const FIELD_SPARK_JUMP = 6;
/** The fewest ms between two zaps, and the loudest one (#127). */
export const FIELD_ZAP_EVERY_MS = 600;
export const FIELD_ZAP_VOLUME = 0.35;
export const MAP_EDGE_COLOR = 0x120810;
export const MAP_PANEL_COLOR = 0x05030a;
export const MAP_PANEL_ALPHA = 0.82;
export const MAP_FRIGATE_COLOR = 0xff6b5b;
/** Another squadron's mission (#101, decision 7). */
export const MAP_OTHER_MISSION_COLOR = 0xb07cff;
export const MAP_YOU_COLOR = 0xffffff;
/** How often a sector under attack flashes, per half cycle (#100, decision 3). */
export const MAP_FLASH_MS = 300;

/** The background's tint in each ring, home outward (#9 decisions 7 and 9): ring 2 green for the Nairan, ring 3 blue for the Nautolan. */
export const RING_TINTS: readonly number[] = [0xffffff, 0xffffff, 0x8fe0b0, 0x8fb4ff];
/** How long the background takes to fade to a new ring's tint. */
export const RING_TINT_FADE_MS = 1500;

/** How often the minimap redraws while the full map is closed (#143): it moves slowly, so every frame is wasted work. */
export const MINIMAP_REDRAW_MS = 100;

/** The frame rate V caps rendering at (#143). */
export const FPS_CAP = 60;

/** Touch controls (#180), in CSS pixels unless named otherwise. */
/** How far a thumb pushes a stick to full deflection. */
export const TOUCH_STICK_RADIUS_PX = 75;
/** The share of a stick's reach that does nothing, so a resting thumb neither moves nor fires. */
export const TOUCH_DEAD_ZONE = 0.2;
/** How far from the ship, in world pixels, the aim stick puts the aim point. */
export const TOUCH_AIM_REACH = 150;
/** A touch button's height and a small one's width, a wide one's width, the gap between them and their inset from the edge. */
export const TOUCH_BUTTON_PX = 64;
export const TOUCH_BUTTON_WIDTH_PX = 96;
export const TOUCH_WIDE_BUTTON_PX = 240;
export const TOUCH_BUTTON_GAP_PX = 14;
export const TOUCH_EDGE_PX = 24;
/** Where the right-edge buttons start, and the respawn buttons sit, as a share of the screen's height. */
export const TOUCH_BUTTONS_Y = 0.37;
export const TOUCH_RESPAWN_Y = 0.66;
/** The screen height the touch UI is drawn full size for, and the smallest it shrinks to on a phone (#180). */
export const TOUCH_FULL_HEIGHT_PX = 700;
/** The fullscreen switch's size, as a share of a wide button's, in the top left corner. */
export const TOUCH_SMALL_SHARE = 0.55;
export const TOUCH_MIN_SCALE = 0.6;

/** The season-so-far table's length, before the player's own row (#167). */
export const STANDINGS_TOP = 5;
/** The shots a player needs in a mission to be named for the best aim, so one lucky shot isn't (#167). */
export const MISSION_AIM_MIN_SHOTS = 10;

/** A derelict teleporting away (#190): the shield closes in, holds, then hull and shield shrink into a flash that collapses, in seconds. */
export const TELEPORT_CLOSE_S = 0.45;
export const TELEPORT_HOLD_S = 0.15;
export const TELEPORT_SHRINK_S = 0.35;
export const TELEPORT_FLASH_S = 0.25;
/** The Invincibility Shield's scale as it starts closing in; 1 is its own size round the hull. */
export const TELEPORT_SHIELD_START_SCALE = 2.4;
/** The flash's radius at its peak, in world px. */
export const TELEPORT_FLASH_RADIUS = 14;
/** The shield's fill, the Super tier's blue, and the light blue that hull, shield and the flash's core turn as they shrink. */
export const TELEPORT_COLOR = 0x5ad1ff;
export const TELEPORT_WHITE = 0xd8f8ff;
/** A teleport is heard only this close to the ship, about the view, like an enemy exploding. */
export const TELEPORT_SOUND_RANGE = 400;
/** A raiding Dreadnought's teleport (#223), scaled from the Main Ship's 48 px to its 128. */
export const TELEPORT_DREADNOUGHT_SIZE = 128 / 48;

/** Holding 1, 2 or 3 this long opens that slot's list instead of cycling it (#259). */
export const PART_HOLD_MS = 250;
