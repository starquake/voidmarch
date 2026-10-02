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
- `pickups/`: [Void - Pickups Pack](https://foozlecc.itch.io/void-pickups-pack),
  commissioned from Baldur, distributed by Foozle. Named by slot and part
  (`weapon-zapper.png`); the pack's "All around shield" is `shield-round.png`.

Files are renamed to kebab-case and otherwise unchanged. Some also come in
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
