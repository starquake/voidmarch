"""Recolors a sprite from the Void packs by rotating the hue of every pixel.

Brightness, saturation and alpha stay as drawn, so the pack's shading survives:
it is a palette swap, which the art rule allows (CLAUDE.md). Needs Pillow:

    python3 -m venv ~/.venvs/voidmarch-tools
    ~/.venvs/voidmarch-tools/bin/pip install pillow
    ~/.venvs/voidmarch-tools/bin/python tools/recolor.py SRC OUT DEGREES

The recolored files, and the degrees each used, are listed in
internal/web/static/assets/LICENSE.md.
"""

import colorsys
import sys

from PIL import Image


def recolor(src: str, out: str, degrees: float) -> None:
    """Writes src to out with every pixel's hue turned by degrees."""
    img = Image.open(src).convert("RGBA")
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            h, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
            r2, g2, b2 = colorsys.hsv_to_rgb((h + degrees / 360) % 1, s, v)
            px[x, y] = (round(r2 * 255), round(g2 * 255), round(b2 * 255), a)
    img.save(out)


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit("usage: recolor.py SRC OUT DEGREES")
    recolor(sys.argv[1], sys.argv[2], float(sys.argv[3]))
