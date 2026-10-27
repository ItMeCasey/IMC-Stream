"""Simplified window / title-bar icon (app/build/window.ico + window.png).
The desktop icon has many thin stripes that turn to mush at 16-32 px, so this one keeps only the play button and the signal arcs, drawn
with thick bands, and uses fewer bands at the smallest sizes. Run: python _build/make_window_icon.py"""
import math
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', 'app', 'build')
BG, TEAL, ORANGE, RUST, CREAM = '#1A2020', '#4FBBBC', '#F39120', '#EC4624', '#E2DAC2'
SS = 8   # supersampling


def tri(cx, cy, r):
    """right-pointing triangle with circumradius r centred on (cx, cy)"""
    return [(cx + r * math.cos(a), cy + r * math.sin(a)) for a in (0, 2 * math.pi / 3, 4 * math.pi / 3)]


def draw(size, detail):
    s = size * SS
    im = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    pad = s * (0.02 if size <= 32 else 0.04)
    d.rounded_rectangle([pad, pad, s - pad, s - pad], radius=s * 0.22, fill=BG)
    u = s / 100.0

    cx, cy = 30 * u, 50 * u
    # play button: thick outline rings, outermost first; innermost is solid
    rings = {1: [(26, TEAL, 0)], 2: [(26, TEAL, 8), (14, CREAM, 0)], 3: [(25, TEAL, 7), (17, ORANGE, 6), (8, CREAM, 0)]}[detail]
    for r, col, w in rings:
        pts = tri(cx, cy, r * u)
        if w:
            d.line(pts + [pts[0], pts[1]], fill=col, width=int(w * u), joint='curve')
            for x, y in pts:
                d.ellipse([x - w * u / 2, y - w * u / 2, x + w * u / 2, y + w * u / 2], fill=col)
        else:
            d.polygon(pts, fill=col)
    # signal arcs on the right
    arcs = {1: [(24, ORANGE, 9)], 2: [(20, ORANGE, 8), (33, TEAL, 8)], 3: [(18, RUST, 6), (28, ORANGE, 6), (38, TEAL, 6)]}[detail]
    ax, ay = 46 * u, 50 * u
    for r, col, w in arcs:
        box = [ax - r * u, ay - r * u, ax + r * u, ay + r * u]
        d.arc(box, -42, 42, fill=col, width=int(w * u))
    return im.resize((size, size), Image.LANCZOS)


SIZES = [(16, 1), (20, 1), (24, 2), (32, 2), (48, 3), (64, 3), (128, 3), (256, 3)]
imgs = {n: draw(n, k) for n, k in SIZES}
imgs[256].save(os.path.join(OUT, 'window.png'))
imgs[256].save(os.path.join(OUT, 'window.ico'), format='ICO', sizes=[(n, n) for n, _ in SIZES], append_images=[imgs[n] for n, _ in SIZES if n != 256])
# contact sheet for a quick look (not shipped)
sheet = Image.new('RGBA', (sum(n * 3 for n, _ in SIZES[:5]) + 60, 160), '#444')
x = 10
for n, _ in SIZES[:5]:
    sheet.paste(imgs[n].resize((n * 3, n * 3), Image.NEAREST), (x, 10), imgs[n].resize((n * 3, n * 3), Image.NEAREST)); x += n * 3 + 10
sheet.save(os.environ.get('SHEET', os.path.join(OUT, '_sheet.png')))
print('ok')
