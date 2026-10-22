"""Pixel-art heart emotes for Twitch in the same style as the badges and reward icons: a 28 x 28 grid, flat colours, a dark outline, hard-edged scaling.
One heart per subscriber tier: Tier 1 a plain heart, Tier 2 a heart in a silver rim with sparkles, Tier 3 a heart in a gold rim with a crown, wings and sparkles.
The plain (Tier 1) heart also comes in 9 other colours: orange, gold, green, aqua, blue, purple, pink, white and black.
Run:  python _build/make_heart_emotes.py   (needs Pillow). Output: twitch/emotes/heart_t1|t2|t3_28|56|112.png, heart_<colour>_28|56|112.png, heart_preview.png and heart_colors_preview.png"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', 'twitch', 'emotes')
G = 28
INK = '#14191a'
RUST, RUST_L, RUST_D = '#EC4624', '#ff9f8a', '#B13A22'
SILVER, SILVER_L, SILVER_D = '#c9d1d0', '#ffffff', '#8a9594'
GOLD, GOLD_L, GOLD_D = '#F39120', '#ffd9a0', '#c06a0c'
AQUA = '#4FBBBC'


def hexrgb(c):
    return tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) + (255,)


def heart_mask(cx, cy, w, h):
    """the pixels inside a heart (the classic implicit curve), w x h pixels, centred on (cx, cy)"""
    out = set()
    for py in range(G):
        for px in range(G):
            x = (px + 0.5 - cx) / (w / 2) * 1.2; y = -(py + 0.5 - cy) / (h / 2) * 1.2 + 0.1
            if (x * x + y * y - 1) ** 3 - x * x * y ** 3 <= 0: out.add((px, py))
    return out


def shrink(m):
    return {(x, y) for (x, y) in m if all((x + dx, y + dy) in m for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))}


def put(g, x, y, c):
    if 0 <= x < G and 0 <= y < G: g[(x, y)] = c


def sparkle(g, x, y, c):
    for p in [(x, y), (x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)]:
        put(g, p[0], p[1], c)


def paint_heart(g, m, main, light, dark):
    ys = [y for _, y in m]; xs = [x for x, _ in m]; y0, y1, x0, x1 = min(ys), max(ys), min(xs), max(xs); cx = (x0 + x1) / 2
    for (x, y) in m:
        c = main
        if y < y0 + (y1 - y0) * 0.42 and x < cx: c = light if (x - x0) + (y - y0) < (x1 - x0) * 0.55 else main     # the upper left lobe catches the light
        if x > cx + (x1 - x0) * 0.12 and y > y0 + (y1 - y0) * 0.35 or y > y1 - 4 and x >= cx: c = dark                 # the lower right is in shade
        put(g, x, y, c)
    gx, gy = x0 + int((x1 - x0) * 0.22), y0 + int((y1 - y0) * 0.22)                                                       # a glint
    for p in [(gx, gy), (gx + 1, gy), (gx, gy + 1)]: put(g, p[0], p[1], '#ffffff')


def crown(g, cx, y):
    for x in (cx - 4, cx, cx + 4): put(g, x, y, GOLD_L)
    for x in range(cx - 4, cx + 5): put(g, x, y + 1, GOLD)
    for x in range(cx - 4, cx + 5): put(g, x, y + 2, GOLD if x % 2 else GOLD_L)
    for x in range(cx - 4, cx + 5): put(g, x, y + 3, GOLD_D)
    put(g, cx, y + 2, RUST)


def wings(g, y):
    for i, (dx, w) in enumerate([(0, 4), (0, 4), (1, 3), (2, 3), (3, 2)]):
        for k in range(w):
            c = GOLD_L if i == 0 else GOLD if i < 4 else GOLD_D
            put(g, 0 + dx + k, y + i, c); put(g, G - 1 - dx - k, y + i, c)


COLORS = {   # main, light, dark
    'orange': ('#F39120', '#ffd9a0', '#c06a0c'), 'gold': ('#f2c230', '#fff0a8', '#b8860b'), 'green': ('#6aa84f', '#b5e09a', '#43762f'), 'aqua': ('#4FBBBC', '#a6e6e7', '#2f8a8b'),
    'blue': ('#2e86c1', '#8cc8ee', '#1d5b87'), 'purple': ('#8e5ea2', '#cfa9e0', '#5f3d70'), 'pink': ('#e8709e', '#ffc4da', '#b0436f'), 'white': ('#E2DAC2', '#ffffff', '#b3ab92'), 'black': ('#3a4444', '#7d8885', '#1d2424'),
}


def colored(name):
    g = {}; paint_heart(g, heart_mask(14, 14.5, 23, 21), *COLORS[name]); return g


def emote(tier):
    g = {}
    if tier == 1:
        paint_heart(g, heart_mask(14, 14.5, 23, 21), RUST, RUST_L, RUST_D)
    elif tier == 2:
        m = heart_mask(14, 14.5, 23, 21); rim = m - shrink(m)
        paint_heart(g, shrink(m), RUST, RUST_L, RUST_D)
        for (x, y) in rim: put(g, x, y, SILVER_L if (x + y) % 5 == 0 else SILVER if x < 14 else SILVER_D)
        sparkle(g, 3, 3, AQUA); sparkle(g, 24, 4, '#ffffff'); sparkle(g, 24, 23, AQUA)
    else:
        m = heart_mask(14, 16, 21, 19); rim = m - shrink(m)
        wings(g, 12); paint_heart(g, shrink(m), RUST, RUST_L, RUST_D)
        for (x, y) in rim: put(g, x, y, GOLD_L if (x + y) % 5 == 0 else GOLD if x < 14 else GOLD_D)
        crown(g, 14, 1); sparkle(g, 3, 4, GOLD_L); sparkle(g, 24, 4, GOLD_L); sparkle(g, 4, 24, '#ffffff'); sparkle(g, 23, 24, '#ffffff')
    return g


def render(g):
    im = Image.new('RGBA', (G, G), (0, 0, 0, 0)); px = im.load()
    for (x, y), c in g.items(): px[x, y] = hexrgb(c)
    out = im.copy(); op = out.load(); ol = hexrgb(INK)
    for y in range(G):
        for x in range(G):
            if px[x, y][3] == 0 and any(0 <= x + dx < G and 0 <= y + dy < G and px[x + dx, y + dy][3] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))): op[x, y] = ol
    return out


def main():
    os.makedirs(OUT, exist_ok=True); tiles = []
    for t in (1, 2, 3):
        im = render(emote(t))
        for size in (28, 56, 112): im.resize((size, size), Image.NEAREST).save(os.path.join(OUT, 'heart_t%d_%d.png' % (t, size)))
        tiles.append(im)
    sheet = Image.new('RGB', (3 * 160 + 20, 230), '#222A2A'); d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype('C:/Windows/Fonts/bahnschrift.ttf', 18); font.set_variation_by_name(b'Bold Condensed')
    except Exception:
        font = ImageFont.load_default()
    for i, im in enumerate(tiles):
        x = 20 + i * 160; d.rectangle([x - 8, 12, x + 128, 216], fill='#1A2020'); big = im.resize((112, 112), Image.NEAREST); sheet.paste(big, (x + 4, 24), big)
        small = im.resize((56, 56), Image.NEAREST); sheet.paste(small, (x + 4, 144), small); tiny = im.resize((28, 28), Image.NEAREST); sheet.paste(tiny, (x + 76, 158), tiny)
        d.text((x + 4, 196), 'TIER %d' % (i + 1), font=font, fill='#E2DAC2')
    sheet.save(os.path.join(OUT, 'heart_preview.png'))
    names = ['red'] + list(COLORS); ims = [tiles[0]] + [render(colored(n)) for n in COLORS]
    for n, im in zip(names[1:], ims[1:]):
        for size in (28, 56, 112): im.resize((size, size), Image.NEAREST).save(os.path.join(OUT, 'heart_%s_%d.png' % (n, size)))
    cols = 5; rows = (len(ims) + cols - 1) // cols; cs = Image.new('RGB', (cols * 140 + 20, rows * 150 + 20), '#222A2A'); d = ImageDraw.Draw(cs)
    for i, (n, im) in enumerate(zip(names, ims)):
        x = 20 + (i % cols) * 140; y = 20 + (i // cols) * 150; d.rectangle([x - 8, y - 8, x + 120, y + 138], fill='#1A2020'); big = im.resize((90, 90), Image.NEAREST); cs.paste(big, (x + 4, y), big)
        small = im.resize((28, 28), Image.NEAREST); cs.paste(small, (x + 88, y + 62), small); d.text((x + 4, y + 104), n.upper(), font=font, fill='#E2DAC2')
    cs.save(os.path.join(OUT, 'heart_colors_preview.png')); print('wrote', os.path.abspath(OUT))


if __name__ == '__main__':
    main()
