"""Turn a captured game scene into store thumbnails with the title on top.

Usage:  python make_thumbnails.py promo/scene.png
Writes promo/thumb_<w>x<h>.png in the sizes Poki and CrazyGames ask for.
"""
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "promo"
SIZES = [(1920, 1080), (800, 470), (800, 1200), (628, 628), (512, 512)]
GOLD, OUTLINE = (255, 213, 74), (61, 40, 6)


def font(px):
    for name in ("impact.ttf", "arialbd.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(name, px)
        except OSError:
            pass
    return ImageFont.load_default()


def cover(img, w, h, focus=(0.5, 0.55)):
    """Scale and crop to w x h, keeping the focus point (car) in frame."""
    s = max(w / img.width, h / img.height)
    im = img.resize((round(img.width * s), round(img.height * s)), Image.LANCZOS)
    fx, fy = im.width * focus[0], im.height * focus[1]
    x = min(max(0, fx - w / 2), im.width - w)
    y = min(max(0, fy - h / 2), im.height - h)
    return im.crop((round(x), round(y), round(x) + w, round(y) + h))


def title(im):
    w, h = im.size
    portrait, square = h > w * 1.1, abs(w - h) < 10
    lines = ["MERGE", "BASTION"]
    size = int(min(w * (0.16 if portrait or square else 0.105), h * 0.2))
    f = font(size)
    # darken the top band so the title always reads
    band = Image.new("L", (w, h), 0)
    bd = ImageDraw.Draw(band)
    top_h = int(h * (0.42 if portrait else 0.5))
    for y in range(top_h):
        bd.line([(0, y), (w, y)], fill=int(170 * (1 - y / top_h) ** 1.6))
    im = Image.composite(Image.new("RGB", (w, h), (14, 24, 8)), im, band)
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    y = int(h * (0.06 if portrait else 0.05))
    stroke = max(3, size // 12)
    boxes = []
    for i, line in enumerate(lines):
        fs = f if i else font(int(size * 1.12))
        bw = d.textbbox((0, 0), line, font=fs, stroke_width=stroke)
        tw, th = bw[2] - bw[0], bw[3] - bw[1]
        boxes.append((line, fs, (w - tw) // 2 - bw[0], y - bw[1]))
        y += th + int(size * 0.06)
    shadow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    for line, fs, x, yy in boxes:
        sd.text((x + stroke, yy + stroke * 2), line, font=fs, fill=(0, 0, 0, 200), stroke_width=stroke, stroke_fill=(0, 0, 0, 200))
    shadow = shadow.filter(ImageFilter.GaussianBlur(stroke))
    for line, fs, x, yy in boxes:
        d.text((x, yy), line, font=fs, fill=GOLD, stroke_width=stroke, stroke_fill=OUTLINE)
    im = im.convert("RGBA")
    im.alpha_composite(shadow)
    im.alpha_composite(layer)
    return im.convert("RGB")


def main(src):
    scene = Image.open(src).convert("RGB")
    OUT.mkdir(exist_ok=True)
    for w, h in SIZES:
        p = OUT / f"thumb_{w}x{h}.png"
        title(cover(scene, w, h)).save(p, optimize=True)
        print(p.relative_to(ROOT), f"{p.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else OUT / "scene.png")
