#!/usr/bin/env python3
"""Add the ROCCA watermark to slab photos and export them as WebP.

Matches the watermark on ROCCA's own slab photos: a faint diagonal
"ROCCA" pattern across the image plus "ROCCA · rocca.co.il" in the
bottom-left corner.

Usage:
    python3 tools/watermark.py OUT_DIR IMAGE [IMAGE ...]

Each IMAGE is resized to at most 1600px wide and saved as
OUT_DIR/<original-name>.webp. Requires Pillow (pip install pillow).
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

MAX_WIDTH = 1600
CORNER_TEXT = "ROCCA · rocca.co.il"
TILE_TEXT = "ROCCA"
FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
]


def load_font(size):
    for path in FONT_CANDIDATES:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def tiled_layer(size, font):
    """Faint diagonal ROCCA pattern, built on a larger canvas then rotated."""
    w, h = size
    side = int((w ** 2 + h ** 2) ** 0.5)
    layer = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    box = draw.textbbox((0, 0), TILE_TEXT, font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    step_x, step_y = int(tw * 2.6), int(th * 4.5)
    for row, y in enumerate(range(0, side, step_y)):
        offset = (step_x // 2) if row % 2 else 0
        for x in range(-step_x + offset, side, step_x):
            draw.text((x, y), TILE_TEXT, font=font, fill=(255, 255, 255, 34))
    layer = layer.rotate(30, resample=Image.BICUBIC)
    left, top = (side - w) // 2, (side - h) // 2
    return layer.crop((left, top, left + w, top + h))


def corner_layer(size, font):
    """Bottom-left label with a soft dark shadow so it reads on any stone."""
    w, h = size
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    box = draw.textbbox((0, 0), CORNER_TEXT, font=font)
    th = box[3] - box[1]
    margin = int(w * 0.018)
    pos = (margin, h - th - margin - box[1])
    shadow = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).text(pos, CORNER_TEXT, font=font, fill=(0, 0, 0, 200))
    shadow = shadow.filter(ImageFilter.GaussianBlur(max(2, th // 8)))
    layer = Image.alpha_composite(layer, shadow)
    ImageDraw.Draw(layer).text(pos, CORNER_TEXT, font=font, fill=(255, 255, 255, 240))
    return layer


def watermark(src, out_dir):
    im = Image.open(src).convert("RGB")
    if im.width > MAX_WIDTH:
        im = im.resize((MAX_WIDTH, round(im.height * MAX_WIDTH / im.width)), Image.LANCZOS)
    base = im.convert("RGBA")
    base = Image.alpha_composite(base, tiled_layer(base.size, load_font(int(base.width * 0.06))))
    base = Image.alpha_composite(base, corner_layer(base.size, load_font(int(base.width * 0.022))))
    out = Path(out_dir) / (Path(src).stem + ".webp")
    base.convert("RGB").save(out, "WEBP", quality=72, method=6)
    return out


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 1
    out_dir = Path(argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    for src in argv[2:]:
        print(watermark(src, out_dir))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
