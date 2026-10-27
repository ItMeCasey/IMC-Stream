"""Original stock art for the Alert Builder (assets/stock/*.png): frames, a ribbon, a divider and icons in the app palette, on transparent backgrounds.
Everything is drawn here (no third-party art). Run: python _build/make_stock_art.py"""
import math
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'stock')
AQUA, HEAT, RUST, CREAM, IRON, DRUST = '#4FBBBC', '#F39120', '#EC4624', '#E2DAC2', '#222A2A', '#B13A22'
SS = 4   # drawn 4x larger, then shrunk, for smooth edges


def canvas(w, h):
    im = Image.new('RGBA', (w * SS, h * SS), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)


def save(im, name, w, h):
    os.makedirs(OUT, exist_ok=True)
    im.resize((w, h), Image.LANCZOS).save(os.path.join(OUT, name + '.png'), optimize=True)


def pts(l, s):   # points given in 0..100 units -> pixels
    return [(x * s / 100.0, y * s / 100.0) for x, y in l]


def gradient_line_frame(w, h, rad, width, c1, c2, name):
    """A rounded frame whose colour runs from c1 (left) to c2 (right)."""
    im, d = canvas(w, h)
    mask = Image.new('L', im.size, 0); md = ImageDraw.Draw(mask)
    md.rounded_rectangle([width * SS, width * SS, (w - width) * SS, (h - width) * SS], radius=rad * SS, outline=255, width=width * SS)
    g = Image.new('RGBA', im.size)
    a, b = Image.new('RGB', (1, 1), c1).getpixel((0, 0)), Image.new('RGB', (1, 1), c2).getpixel((0, 0))
    gd = ImageDraw.Draw(g)
    for x in range(im.size[0]):
        t = x / float(im.size[0] - 1)
        gd.line([(x, 0), (x, im.size[1])], fill=tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (255,))
    im.paste(g, (0, 0), mask)
    save(im, name, w, h)


# ---- frames, ribbon, divider
gradient_line_frame(600, 300, 26, 8, AQUA, HEAT, 'frame_rounded')

im, d = canvas(600, 300)   # corner brackets
for (cx, cy, sx, sy) in [(10, 10, 1, 1), (590, 10, -1, 1), (10, 290, 1, -1), (590, 290, -1, -1)]:
    d.line([(cx * SS, (cy + 90 * sy) * SS), (cx * SS, cy * SS), ((cx + 130 * sx) * SS, cy * SS)], fill=AQUA, width=10 * SS, joint='curve')
    d.line([((cx + 22 * sx) * SS, (cy + 70 * sy) * SS), ((cx + 22 * sx) * SS, (cy + 22 * sy) * SS), ((cx + 70 * sx) * SS, (cy + 22 * sy) * SS)], fill=HEAT, width=4 * SS, joint='curve')
save(im, 'frame_corners', 600, 300)

im, d = canvas(600, 300)   # double line frame
d.rectangle([6 * SS, 6 * SS, 594 * SS, 294 * SS], outline=CREAM, width=6 * SS)
d.rectangle([22 * SS, 22 * SS, 578 * SS, 278 * SS], outline=AQUA, width=3 * SS)
save(im, 'frame_double', 600, 300)

im, d = canvas(600, 300)   # frame with cut corners
c = 40
d.polygon([(x * SS, y * SS) for x, y in [(c, 6), (600 - c, 6), (594, c), (594, 300 - c), (600 - c, 294), (c, 294), (6, 300 - c), (6, c)]], outline=HEAT, width=8 * SS)
save(im, 'frame_notch', 600, 300)

im, d = canvas(600, 120)   # ribbon with swallow-tail ends
d.polygon([(x * SS, y * SS) for x, y in [(0, 20), (60, 20), (60, 100), (0, 100), (24, 60)]], fill=DRUST)
d.polygon([(x * SS, y * SS) for x, y in [(600, 20), (540, 20), (540, 100), (600, 100), (576, 60)]], fill=DRUST)
d.rectangle([40 * SS, 6 * SS, 560 * SS, 94 * SS], fill=RUST)
d.rectangle([40 * SS, 6 * SS, 560 * SS, 16 * SS], fill=HEAT)
save(im, 'ribbon', 600, 120)

im, d = canvas(600, 24)   # divider: line, diamond in the middle
d.line([(10 * SS, 12 * SS), (270 * SS, 12 * SS)], fill=AQUA, width=3 * SS); d.line([(330 * SS, 12 * SS), (590 * SS, 12 * SS)], fill=AQUA, width=3 * SS)
d.polygon([(300 * SS, 1 * SS), (312 * SS, 12 * SS), (300 * SS, 23 * SS), (288 * SS, 12 * SS)], fill=HEAT)
save(im, 'divider', 600, 24)

# ---- icons (256 x 256)
S = 256


def icon(name, draw):
    im, d = canvas(S, S); draw(d, S * SS); save(im, name, S, S)


def heart(d, s):
    u = s / 100.0
    d.ellipse([12 * u, 14 * u, 52 * u, 54 * u], fill=RUST); d.ellipse([48 * u, 14 * u, 88 * u, 54 * u], fill=RUST)
    d.polygon(pts([(14, 42), (86, 42), (50, 90)], s), fill=RUST); d.ellipse([22 * u, 24 * u, 34 * u, 36 * u], fill=CREAM)


def star(d, s, c=HEAT, r2=0.42, k=1.0, cy=54):
    p = []
    for i in range(10):
        a = -math.pi / 2 + i * math.pi / 5; r = 46 if i % 2 == 0 else 46 * r2
        p.append((50 + k * r * math.cos(a), cy + k * r * math.sin(a)))
    d.polygon(pts(p, s), fill=c, outline=CREAM, width=int(s / 60))


def bolt(d, s):
    d.polygon(pts([(58, 6), (22, 54), (46, 54), (36, 94), (80, 40), (54, 40)], s), fill=HEAT, outline=CREAM, width=int(s / 60))


def crown(d, s):
    u = s / 100.0
    d.polygon(pts([(10, 76), (6, 30), (28, 52), (50, 20), (72, 52), (94, 30), (90, 76)], s), fill=HEAT, outline=CREAM, width=int(s / 60))
    d.rectangle([10 * u, 78 * u, 90 * u, 88 * u], fill=DRUST)
    for x in (6, 50, 94):
        d.ellipse([(x - 6) * u, (x == 50 and 14 or 24) * u, (x + 6) * u, (x == 50 and 26 or 36) * u], fill=CREAM)


def gift(d, s):
    u = s / 100.0
    d.rectangle([14 * u, 40 * u, 86 * u, 90 * u], fill=AQUA); d.rectangle([8 * u, 28 * u, 92 * u, 46 * u], fill=AQUA, outline=IRON, width=int(s / 80))
    d.rectangle([44 * u, 28 * u, 56 * u, 90 * u], fill=HEAT)
    d.ellipse([22 * u, 6 * u, 50 * u, 30 * u], outline=HEAT, width=int(s / 25)); d.ellipse([50 * u, 6 * u, 78 * u, 30 * u], outline=HEAT, width=int(s / 25))


def gem(d, s):
    d.polygon(pts([(26, 14), (74, 14), (94, 40), (50, 92), (6, 40)], s), fill=AQUA, outline=CREAM, width=int(s / 60))
    d.polygon(pts([(6, 40), (94, 40), (50, 92)], s), fill='#3a9a9b'); d.polygon(pts([(26, 14), (38, 40), (50, 14)], s), fill=CREAM)
    d.line(pts([(6, 40), (94, 40)], s), fill=CREAM, width=int(s / 70))


def flame(d, s):
    p = [(50, 4), (66, 30), (84, 52), (80, 78), (62, 94), (38, 94), (20, 78), (16, 54), (30, 38), (36, 56), (42, 30)]
    d.polygon(pts(p, s), fill=RUST)
    d.polygon(pts([(50, 40), (64, 62), (62, 84), (50, 92), (38, 84), (36, 64)], s), fill=HEAT)
    d.polygon(pts([(50, 62), (57, 76), (50, 88), (43, 76)], s), fill=CREAM)


def play(d, s):
    u = s / 100.0
    d.ellipse([6 * u, 6 * u, 94 * u, 94 * u], fill=AQUA, outline=CREAM, width=int(s / 40)); d.polygon(pts([(38, 28), (38, 72), (74, 50)], s), fill=IRON)


def coin(d, s):
    u = s / 100.0
    d.ellipse([6 * u, 6 * u, 94 * u, 94 * u], fill=HEAT, outline=DRUST, width=int(s / 30)); d.ellipse([20 * u, 20 * u, 80 * u, 80 * u], outline=CREAM, width=int(s / 50))
    star(d, s, CREAM, 0.42, 0.5, 50)


def bell(d, s):
    u = s / 100.0
    d.pieslice([18 * u, 14 * u, 82 * u, 78 * u], 180, 360, fill=HEAT); d.polygon(pts([(18, 46), (82, 46), (90, 80), (10, 80)], s), fill=HEAT)
    d.rectangle([8 * u, 78 * u, 92 * u, 86 * u], fill=DRUST); d.ellipse([40 * u, 84 * u, 60 * u, 98 * u], fill=CREAM); d.ellipse([44 * u, 6 * u, 56 * u, 18 * u], fill=CREAM)


def sparkle(d, s):
    d.polygon(pts([(50, 2), (58, 42), (98, 50), (58, 58), (50, 98), (42, 58), (2, 50), (42, 42)], s), fill=CREAM)


def burst(d, s):
    p = []
    for i in range(32):
        a = i * math.pi / 16; r = 48 if i % 2 == 0 else 30
        p.append((50 + r * math.cos(a), 50 + r * math.sin(a)))
    d.polygon(pts(p, s), fill=HEAT, outline=CREAM, width=int(s / 60))


for n, f in [('icon_heart', heart), ('icon_star', star), ('icon_bolt', bolt), ('icon_crown', crown), ('icon_gift', gift), ('icon_gem', gem), ('icon_flame', flame),
             ('icon_play', play), ('icon_coin', coin), ('icon_bell', bell), ('sparkle', sparkle), ('burst', burst)]:
    icon(n, f)
print('ok', len(os.listdir(OUT)), 'files in', os.path.normpath(OUT))


# ---- one-colour versions for the Alert Builder to tint with a theme colour (white shapes on transparent; the builder fills them with any colour)
def mono_of(name):
    im = Image.open(os.path.join(OUT, name + '.png')).convert('RGBA')
    a = im.getchannel('A'); white = Image.new('RGBA', im.size, (255, 255, 255, 0)); white.putalpha(a)
    white.save(os.path.join(OUT, 'mono_' + name.replace('icon_', '') + '.png'), optimize=True)


for n in ['icon_heart', 'icon_star', 'icon_bolt', 'icon_crown', 'icon_gift', 'icon_gem', 'icon_flame', 'icon_play', 'icon_coin', 'icon_bell', 'sparkle', 'burst', 'frame_corners', 'frame_double', 'frame_notch', 'frame_rounded', 'ribbon', 'divider']:
    mono_of(n)


def mono(name, w, h, draw):
    im, d = canvas(w, h); draw(d, w * SS, h * SS); save(im, 'mono_' + name, w, h)


W = '#FFFFFF'
def chevron(d, w, h): d.line([(w * .25, h * .1), (w * .75, h * .5), (w * .25, h * .9)], fill=W, width=int(w * .16), joint='curve')
def arrow(d, w, h):
    d.polygon([(w * .05, h * .38), (w * .6, h * .38), (w * .6, h * .12), (w * .95, h * .5), (w * .6, h * .88), (w * .6, h * .62), (w * .05, h * .62)], fill=W)
def check(d, w, h): d.line([(w * .15, h * .55), (w * .4, h * .8), (w * .86, h * .22)], fill=W, width=int(w * .14), joint='curve')
def bubble(d, w, h):
    d.rounded_rectangle([w * .02, h * .02, w * .98, h * .78], radius=h * .22, fill=W); d.polygon([(w * .18, h * .7), (w * .12, h * .98), (w * .38, h * .7)], fill=W)
def ticket(d, w, h):
    d.rounded_rectangle([w * .02, h * .1, w * .98, h * .9], radius=h * .1, fill=W)
    for y in (.1, .9): d.ellipse([w * .5 - h * .1, h * y - h * .1, w * .5 + h * .1, h * y + h * .1], fill=(0, 0, 0, 0))
    for i in range(6): d.rectangle([w * .5 - 2 * SS, h * (.2 + i * .12), w * .5 + 2 * SS, h * (.26 + i * .12)], fill=(0, 0, 0, 0))
def hexagon(d, w, h):
    d.polygon([(w * (.5 + .48 * math.cos(math.radians(a))), h * (.5 + .48 * math.sin(math.radians(a)))) for a in range(0, 360, 60)], fill=W)
def shield(d, w, h): d.polygon([(w * .1, h * .08), (w * .9, h * .08), (w * .9, h * .5), (w * .5, h * .96), (w * .1, h * .5)], fill=W)
def ring(d, w, h): d.ellipse([w * .06, h * .06, w * .94, h * .94], outline=W, width=int(w * .08))
def triangle(d, w, h): d.polygon([(w * .5, h * .06), (w * .96, h * .92), (w * .04, h * .92)], fill=W)
def dots(d, w, h):
    for i in range(5): d.ellipse([w * (.04 + i * .2), h * .2, w * (.16 + i * .2), h * .8], fill=W)
def wave(d, w, h): d.line([(w * x / 100.0, h * (.5 + .3 * math.sin(x / 100.0 * 6.28 * 3))) for x in range(0, 101, 2)], fill=W, width=int(h * .18), joint='curve')
def plus(d, w, h): d.rectangle([w * .4, h * .06, w * .6, h * .94], fill=W); d.rectangle([w * .06, h * .4, w * .94, h * .6], fill=W)
def pill(d, w, h): d.rounded_rectangle([0, 0, w - 1, h - 1], radius=h / 2, fill=W)
def bar(d, w, h): d.rounded_rectangle([0, h * .3, w - 1, h * .7], radius=h * .2, fill=W)
def slant(d, w, h): d.polygon([(w * .08, 0), (w, 0), (w * .92, h), (0, h)], fill=W)
def cross(d, w, h):
    d.line([(w * .15, h * .15), (w * .85, h * .85)], fill=W, width=int(w * .14)); d.line([(w * .85, h * .15), (w * .15, h * .85)], fill=W, width=int(w * .14))
def diamond(d, w, h): d.polygon([(w * .5, h * .02), (w * .98, h * .5), (w * .5, h * .98), (w * .02, h * .5)], fill=W)

for n, (w, h), f in [('chevron', (200, 200), chevron), ('arrow', (256, 128), arrow), ('check', (200, 200), check), ('bubble', (320, 200), bubble), ('ticket', (400, 160), ticket), ('hexagon', (256, 256), hexagon),
                     ('shield', (240, 280), shield), ('ring', (256, 256), ring), ('triangle', (256, 256), triangle), ('dots', (300, 60), dots), ('wave', (400, 80), wave), ('plus', (200, 200), plus),
                     ('pill', (400, 100), pill), ('bar', (600, 40), bar), ('slant', (500, 120), slant), ('cross', (200, 200), cross), ('diamond', (200, 200), diamond)]:
    mono(n, w, h, f)
print('mono ok', len([f for f in os.listdir(OUT) if f.startswith('mono_')]))


# ---- patterns for panels (low-opacity overlays): diagonal stripes and a halftone dot grid
def stripes(d, w, h):
    x = -h
    while x < w + h:
        d.polygon([(x, h), (x + 14, h), (x + 14 + h, 0), (x + h, 0)], fill=W); x += 34


def halftone(d, w, h):
    for j in range(0, 14):
        for i in range(0, 40):
            r = 2.2 + 3.2 * (i / 40.0)
            cx, cy = 8 + i * 15 + (7 if j % 2 else 0), 8 + j * 15
            d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=W)


mono('stripes', 600, 200, stripes)
mono('halftone', 600, 200, halftone)
print('patterns ok')


# coin and play button as one-colour art with the symbol cut out (the plain silhouette would be a flat disc)
def coin_mono(d, w, h):
    d.ellipse([w * .03, h * .03, w * .97, h * .97], fill=W)
    p = []
    for i in range(10):
        a = -math.pi / 2 + i * math.pi / 5; r = 30 if i % 2 == 0 else 13
        p.append((w * (.5 + r / 100.0 * math.cos(a)), h * (.5 + r / 100.0 * math.sin(a))))
    d.polygon(p, fill=(0, 0, 0, 0))


def play_mono(d, w, h):
    d.ellipse([w * .03, h * .03, w * .97, h * .97], fill=W); d.polygon([(w * .38, h * .28), (w * .38, h * .72), (w * .74, h * .5)], fill=(0, 0, 0, 0))


mono('coin', 256, 256, coin_mono)
mono('play', 256, 256, play_mono)
