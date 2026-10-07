# Art license

The images in this directory are from Foozle's Void asset packs, released
under Creative Commons Zero (CC0 1.0 Universal,
http://creativecommons.org/publicdomain/zero/1.0/). Attribution is not
required; it is given here anyway.

- `mainship/`: [Void - Main Ship](https://foozlecc.itch.io/void-main-ship),
  commissioned from Baldur, distributed by Foozle.
- `environment/`: [Void - Environment Pack](https://foozlecc.itch.io/void-environment-pack),
  commissioned from Baldur, distributed by Foozle.

- `klaed/`: [Void - Fleet Pack 1 (Kla'ed)](https://foozlecc.itch.io/void-fleet-pack-1),
  distributed by Foozle.
- `nairan/`: [Void - Fleet Pack 2 (Nairan)](https://foozlecc.itch.io/void-fleet-pack-2),
  distributed by Foozle.
- `nautolan/`: [Void - Fleet Pack 3 (Nautolan)](https://foozlecc.itch.io/void-fleet-pack-3),
  distributed by Foozle.
- `pickups/`: [Void - Pickups Pack](https://foozlecc.itch.io/void-pickups-pack),
  commissioned from Baldur, distributed by Foozle. Named by slot and part
  (`weapon-zapper.png`); the pack's "All around shield" is `shield-round.png`.

Files are renamed to kebab-case and otherwise unchanged. A fleet ship's parts
are named by class and part: the Support Ships' (#184)
`Kla'ed - Support ship - Base.png` is `klaed/support-base.png`, the Torpedo
Ships' (#185) `Kla'ed - Torpedo Ship - Weapons.png` is
`klaed/torpedo-weapons.png`, and the
Nautolan pack's `Nautolan Ship - Support.png`, its destruction strip, is
`nautolan/support-destruction.png`. The Kla'ed Torpedo Ship's shot,
`Kla'ed - Torpedo.png`, is `klaed/torpedo.png`; the game draws it as it is,
with no blue variant (#185). Some also come in
recoloured variants beside the original: palette swaps made with
`tools/recolor.py`, which turns every pixel's hue and keeps its brightness and
shading.

- `klaed/bullet-blue.png` and `klaed/big-bullet-blue.png`: `bullet.png` and
  `big-bullet.png` turned 190 degrees, from orange to blue. The game draws
  these, so enemy fire stands apart from the players' orange shots (#36).
- `klaed/bullet-purple.png` and `klaed/big-bullet-purple.png`: turned 260
  degrees, to purple; kept for later.
- `klaed/ray-blue.png`: the Dreadnought's `Ray.png` turned 240 degrees, from
  pink to the same blue (#124, #133).
- `klaed/wave-blue.png`: the Dreadnought's `Wave.png` turned 190 degrees,
  from orange to blue, like the bullets (#124, #133).
- `nairan/bolt-blue.png`: `Nairan - Bolt.png` turned 245 degrees, from pink
  to the same blue (#136). The pack's original isn't kept.
- `nairan/ray-blue.png`: `Nairan - Ray.png` turned 190 degrees, from orange
  to blue (#136).
- `nautolan/bullet-blue.png`: `Nautolan - Bullet.png` turned 90 degrees, from
  green to blue (#136).
- `nautolan/spinning-bullet-blue.png`: `Nautolan - Spinning Bullet.png`
  turned 85 degrees, from green to blue (#136).
- `nairan/rocket-blue.png` and `nairan/torpedo-blue.png`: `Nairan - Rocket.png`
  turned 210 degrees and `Nairan - Torpedo.png` 200, from red and orange to
  blue (#137).
- `nautolan/bomb-blue.png`: `Nautolan - Bomb.png` turned 240 degrees, from
  pink to blue (#137).
- `nautolan/wave-blue.png`: `Nautolan - Wave.png` turned 135 degrees, from
  green to blue (#137).
- `nautolan/ray-blue.png`: `Nautolan - Ray.png` turned 172 degrees, from
  yellow to blue (#153).

Some strips are laid out differently, so that no texture is over 4096 px and
older GPUs can hold every one (#222). Every pixel is the pack's own; only
where it sits changes. `cmd/cutsheets` makes them from the pack's PNGs:

- `environment/background-void.png`: the Environment Pack's
  `Backgrounds/PNGs/Condesed/Starry background  - Layer 01 - Void.png`, its
  9 frames of 640 x 360 as a 3 x 3 grid
  (`cutsheets grid -frame 640x360 -columns 3`).
- `environment/background-stars.png` and `background-stars.json`:
  `Starry background  - Layer 02 - Stars.png` from the same folder, as one
  sheet of pieces (`cutsheets layer -frame 640x360`): the first frame with
  every region that changes cleared, then each changing region's 9 frames
  side by side (the Rotary Star, Rotary Star 2, the Black hole and 68
  twinkling stars). The JSON says where each piece sits in the sheet and on
  the frame; drawing them rebuilds every frame exactly.
- `environment/background-big-stars.png` and `background-big-stars.json`:
  `Starry background  - Layer 03 - Stars.png` the same way: its two big
  stars, with nothing still around them.
- `environment/planet-earth-like.png`: `Planets/PNGs/Earth-Like planet.png`,
  its 77 frames of 96 px cropped by the 10 px that are transparent around
  every frame, to 76 px with the back glow, 9 to a row
  (`cutsheets grid -frame 96x96 -columns 9 -crop`).
- The Dreadnoughts' 15 strips, `dreadnought-base.png`, `-engine.png`,
  `-weapons.png`, `-destruction.png` and `-shield.png` in `klaed/`, `nairan/`
  and `nautolan/` (#236): the pack's frames of 128 px, each different frame
  kept once, in the order the strip first shows it; cropped by the margin
  that is transparent on both sides of every frame, across and top to bottom
  apart, so each frame keeps its center; in rows of the columns below
  (`cutsheets grid -frame 128x128 -columns N -crop -distinct`). The game
  plays them in the pack's order: `frontend/src/sprites.ts` lists the frames
  of each strip that repeats some. Each cell is the frames kept (of the
  strip's, where it repeats some), their size, and how many to a row.

  | Strip       | Kla'ed            | Nairan           | Nautolan          |
  |-------------|-------------------|------------------|-------------------|
  | base        | 72 x 102          | 68 x 102         | 72 x 104          |
  | engine      | 6 of 12, 70 x 104, 6 to a row | 8, 34 x 116, 8 to a row | 7 of 8, 36 x 116, 7 to a row |
  | weapons     | 39 of 60, 72 x 102, 13 to a row | 7 of 34, 68 x 102, 7 to a row | 22 of 35, 72 x 104, 11 to a row |
  | destruction | 12, 126 x 106, 6 to a row | 18, 112 x 108, 6 to a row | 12, 72 x 106, 6 to a row |
  | shield      | 10, 118 x 118, 5 to a row | 8, 124 x 124, 8 to a row | 20, 112 x 116, 5 to a row |
