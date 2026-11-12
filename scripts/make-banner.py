"""Regenerate assets/banner-light.png and assets/banner-dark.png.

Self-contained 1400x400 banners in the dsh-graft grammar: flat background, a
soft teal glow, the shipped app-icon tile on the left, a bold wordmark
(auto-fitted), a monospace tagline, and two tilted viewport cards (amber
panel + navy viewport with an isometric wireframe cube and orbit ring) on
the right.

The bundled dsh Python may be write-sandboxed; run with '-' to emit
"name\tbase64" lines on stdout for the caller to decode, or pass an output
directory to write files in place.
"""
from pathlib import Path
import base64
import io
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ASSETS
STDOUT = len(sys.argv) > 1 and sys.argv[1] == "-"
W, H = 1400, 400
TEAL = (47, 191, 160)
AMBER = (232, 160, 32)
FONT_BOLD = "C:/Windows/Fonts/segoeuib.ttf"
FONT_MONO = "C:/Windows/Fonts/consola.ttf"
TITLE = "dsh-blender-preview"
TAGLINE = "headless GLB · WebGL viewport · local Blender"


def rounded(img: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.width - 1, img.height - 1], radius, fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def glow(base: Image.Image):
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    for r, alpha in ((165, 10), (120, 12), (75, 14)):
        d.ellipse([170 - r, 200 - r, 170 + r, 200 + r], fill=TEAL + (alpha,))
    base.alpha_composite(overlay)


def sparkle(d: ImageDraw.ImageDraw, cx: int, cy: int, r: int, fill):
    p = 0.24
    d.polygon([
        (cx, cy - r), (cx + r * p, cy - r * p), (cx + r, cy),
        (cx + r * p, cy + r * p), (cx, cy + r), (cx - r * p, cy + r * p),
        (cx - r, cy), (cx - r * p, cy - r * p),
    ], fill=fill)


def iso_cube(d: ImageDraw.ImageDraw, cx: int, cy: int, u: float, fill, width: int):
    w, h = 0.866 * u, 1.5 * u
    top = (cx, cy - h)
    left = (cx - w, cy - h / 2)
    right = (cx + w, cy - h / 2)
    mid = (cx, cy)
    bottom = (cx, cy + h)
    leftb = (cx - w, cy + h / 2)
    rightb = (cx + w, cy + h / 2)
    d.line([top, right, rightb, bottom, leftb, left, top], fill=fill, width=width, joint="curve")
    d.line([mid, top], fill=fill, width=width)
    d.line([mid, left], fill=fill, width=width)
    d.line([mid, right], fill=fill, width=width)


def orbit(d: ImageDraw.ImageDraw, cx: int, cy: int, rx: int, ry: int, fill, width: int):
    box = [cx - rx, cy - ry, cx + rx, cy + ry]
    d.ellipse(box, outline=fill, width=width)
    d.arc(box, 15, 165, fill=fill, width=width)  # front sweep over the cube


def make_back_card() -> Image.Image:
    card = Image.new("RGBA", (250, 120), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    d.rounded_rectangle([0, 0, 249, 119], 13, fill=AMBER + (255,))
    for i, (x0, x1) in enumerate(((24, 150), (24, 196), (24, 118))):
        d.rounded_rectangle([x0, 28 + i * 28, x1, 41 + i * 28], 6, fill=(255, 255, 255, 235))
    return card


def make_front_card(card_fill: tuple) -> Image.Image:
    cw, ch = 280, 150
    card = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    d.rounded_rectangle([0, 0, cw - 1, ch - 1], 13, fill=card_fill + (255,), outline=(0, 0, 0, 36), width=2)
    cx, cy = 92, 74
    orbit(d, cx, cy, 74, 25, AMBER + (255,), 5)
    iso_cube(d, cx, cy, 34, TEAL + (255,), 6)
    orbit(d, cx, cy, 74, 25, AMBER + (255,), 5)
    for i, x1 in enumerate((252, 224, 240)):
        d.rounded_rectangle([185, 88 + i * 17, x1, 95 + i * 17], 4, fill=TEAL + (220,))
    sparkle(d, 252, 30, 10, (255, 255, 255, 235))
    return card


def card(base: Image.Image, piece: Image.Image, x: int, y: int, angle: float):
    shadow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(shadow)
    d.rounded_rectangle([x + 6, y + 8, x + 6 + piece.width - 1, y + 8 + piece.height - 1], 14, fill=(0, 0, 0, 41))
    base.alpha_composite(shadow)
    if angle:
        piece = piece.rotate(angle, expand=True, resample=Image.BICUBIC)
    base.alpha_composite(piece, (x, y))


def fit_title(d: ImageDraw.ImageDraw, text: str, x0: int, x1: int, start: int) -> ImageFont.FreeTypeFont:
    size = start
    while size > 40:
        font = ImageFont.truetype(FONT_BOLD, size)
        if d.textlength(text, font=font) <= x1 - x0:
            return font
        size -= 2
    return ImageFont.truetype(FONT_BOLD, size)


ICON = Image.open(ASSETS / "icon.png").convert("RGBA").resize((250, 250), Image.LANCZOS)


def banner(bg: tuple, ink: tuple, tag: tuple, card_fill: tuple, out: str):
    base = Image.new("RGBA", (W, H), bg + (255,))
    glow(base)
    base.alpha_composite(ICON, (55, 75))
    d = ImageDraw.Draw(base)
    d.text((320, 225), TITLE, font=fit_title(d, TITLE, 320, 1082, 82), fill=ink, anchor="ls")
    d.text((324, 272), TAGLINE, font=ImageFont.truetype(FONT_MONO, 18), fill=tag, anchor="ls")
    card(base, make_back_card(), 1120, 42, -6)
    card(base, make_front_card(card_fill), 1090, 150, -2)
    if STDOUT:
        buf = io.BytesIO()
        base.convert("RGB").save(buf, format="PNG")
        print(f"{out}\t{base64.b64encode(buf.getvalue()).decode()}")
    else:
        base.convert("RGB").save(OUT / out)
        print("wrote", out)


banner((244, 245, 247), (26, 31, 44), (92, 100, 112), (26, 31, 44), "banner-light.png")
banner((20, 24, 36), (244, 245, 247), (154, 163, 178), (13, 17, 23), "banner-dark.png")
