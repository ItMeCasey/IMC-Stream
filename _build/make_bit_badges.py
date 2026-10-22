"""Pixel-art cheer (bits) badges for Twitch, in the same style as the Game Arena people, the reward icons and Word Rush:
flat rectangles of the theme colours on a tiny grid, scaled with hard edges. Each badge is drawn on 18 x 18 pixels (Twitch's smallest size)
and saved at 18, 36 and 72 pixels, the three sizes Twitch asks for. One badge per tier: 1, 100, 1,000, 5,000, 10,000, 25,000, 50,000,
75,000, 100,000, 200,000, 300,000, 400,000 and 500,000 bits. The gem grows and gets more decoration with every tier.
Run:  python _build/make_bit_badges.py   (needs Pillow). Output: twitch/bit_badges/ (upload them under Viewer Rewards > Bits > Cheer Badges)."""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', 'twitch', 'bit_badges')
INK = '#14191a'
GEMS = {   # main, light, dark
    'grey': ('#8a9594', '#c9d1d0', '#5d6867'), 'aqua': ('#4FBBBC', '#a6e6e7', '#2f8a8b'), 'heat': ('#F39120', '#ffd9a0', '#c06a0c'), 'rust': ('#EC4624', '#ff9f8a', '#B13A22'),
    'purple': ('#8e5ea2', '#cfa9e0', '#5f3d70'), 'cream': ('#E2DAC2', '#ffffff', '#b3ab92'), 'gold': ('#F39120', '#ffe3a8', '#B13A22'),
}
GOLD, GOLD_L, GOLD_D = '#F39120', '#ffd9a0', '#c06a0c'


def put(g, x, y, c):
    if 0 <= x < 18 and 0 <= y < 18:
        g[(x, y)] = c


def gem(g, widths, top, cols, cx=9):
    """a faceted gem: rows of the given widths from row `top`, centred on column cx. Light top, main middle, dark point, a bright glint."""
    main, light, dark = cols
    n = len(widths)
    for i, w in enumerate(widths):
        x0 = cx - w // 2
        for k in range(w):
            c = light if i < max(1, n // 4) else main if i < (n * 2) // 3 else dark
            if i >= max(1, n // 4) and k >= w - max(1, w // 3):
                c = dark if c == main else dark   # the right-hand facet is always in shade
            put(g, x0 + k, top + i, c)
    put(g, cx - widths[1] // 2 + 1, top + 1, '#ffffff')   # glint


def sparkle(g, x, y, c='#ffffff'):
    for p in [(x, y), (x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)]:
        put(g, p[0], p[1], c)


def star(g, x, y, c=GOLD_L):
    put(g, x, y, c)
    for p in [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)]:
        put(g, p[0], p[1], GOLD_D if c == GOLD_L else c)


def crown(g, y=1, c=GOLD, l=GOLD_L, d=GOLD_D):
    """a little crown (9 wide, 4 tall) sitting at row y"""
    for x in (5, 9, 13):
        put(g, x, y, l)
    for x in range(5, 14):
        put(g, x, y + 1, c)
    for x in range(5, 14):
        put(g, x, y + 2, c if x % 2 else l)
    for x in range(5, 14):
        put(g, x, y + 3, d)
    put(g, 9, y + 2, '#EC4624')


def wings(g, y=6, c=GOLD, l=GOLD_L, d=GOLD_D, big=False):
    """wings either side of the gem"""
    rows = [(0, 3), (1, 3), (2, 2), (3, 1)] if not big else [(0, 3), (0, 3), (1, 3), (2, 2), (3, 2), (4, 1)]
    for i, (dx, w) in enumerate(rows):
        for k in range(w):
            col = l if i == 0 else c if i < len(rows) - 1 else d
            put(g, 0 + dx + k, y + i, col)
            put(g, 17 - dx - k, y + i, col)


def frame(g, c=GOLD, d=GOLD_D):
    """a thin diamond frame around the whole badge"""
    for i in range(9):
        for p in [(8 - i, 0 + i), (9 + i, 0 + i), (8 - i, 17 - i), (9 + i, 17 - i)]:
            put(g, p[0], p[1], c if (p[0] + p[1]) % 2 == 0 else d)


def tier(idx):
    g = {}
    if idx == 0:    gem(g, [4, 6, 6, 4, 2], 6, GEMS['grey'])                                                               # 1
    elif idx == 1:  gem(g, [6, 8, 8, 6, 4, 2], 5, GEMS['aqua'])                                                             # 100
    elif idx == 2:  gem(g, [8, 10, 10, 10, 8, 6, 4, 2], 4, GEMS['heat'])                                                    # 1,000
    elif idx == 3:                                                                                                          # 5,000
        gem(g, [8, 10, 10, 10, 8, 6, 4, 2], 5, GEMS['rust']); sparkle(g, 2, 3); sparkle(g, 15, 14)
    elif idx == 4:                                                                                                          # 10,000
        gem(g, [8, 10, 12, 12, 10, 8, 6, 4, 2], 4, GEMS['purple']); sparkle(g, 2, 2); sparkle(g, 15, 2); sparkle(g, 15, 15)
    elif idx == 5:                                                                                                          # 25,000
        gem(g, [8, 10, 12, 12, 10, 8, 6, 4, 2], 5, GEMS['cream']); sparkle(g, 2, 3, GEMS['aqua'][0]); sparkle(g, 15, 3, GEMS['aqua'][0]); sparkle(g, 3, 14, GEMS['aqua'][0]); sparkle(g, 14, 14, GEMS['aqua'][0])
    elif idx == 6:                                                                                                          # 50,000
        frame(g); gem(g, [6, 8, 10, 10, 8, 6, 4, 2], 5, GEMS['aqua']); star(g, 9, 2)
    elif idx == 7:                                                                                                          # 75,000
        wings(g, 6); gem(g, [6, 8, 10, 10, 8, 6, 4, 2], 5, GEMS['rust'])
    elif idx == 8:                                                                                                          # 100,000
        crown(g, 0); gem(g, [6, 8, 10, 10, 8, 6, 4, 2], 6, GEMS['heat'])
    elif idx == 9:                                                                                                          # 200,000
        wings(g, 8); crown(g, 0); gem(g, [6, 8, 10, 10, 8, 6, 4, 2], 6, GEMS['purple'])
    elif idx == 10:                                                                                                         # 300,000
        wings(g, 8, big=True); crown(g, 0); gem(g, [6, 8, 10, 10, 8, 6, 4, 2], 6, GEMS['aqua']); star(g, 2, 2); star(g, 15, 2)
    elif idx == 11:                                                                                                         # 400,000
        frame(g); wings(g, 8, big=True); crown(g, 1); gem(g, [6, 8, 10, 10, 8, 6, 4, 2], 6, GEMS['rust']); star(g, 2, 2); star(g, 15, 2)
    else:                                                                                                                   # 500,000
        frame(g); wings(g, 8, big=True); crown(g, 1); gem(g, [6, 8, 10, 10, 8, 6, 4, 2], 6, GEMS['cream']); star(g, 2, 2); star(g, 15, 2); star(g, 2, 15); star(g, 15, 15)
    return g


TIERS = [1, 100, 1000, 5000, 10000, 25000, 50000, 75000, 100000, 200000, 300000, 400000, 500000]


def hexrgb(c):
    return tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) + (255,)


def render(g):
    """18 x 18 with a 1 pixel dark outline around every shape"""
    im = Image.new('RGBA', (18, 18), (0, 0, 0, 0)); px = im.load()
    for (x, y), c in g.items():
        px[x, y] = hexrgb(c)
    out = im.copy(); op = out.load(); ol = hexrgb(INK)
    for y in range(18):
        for x in range(18):
            if px[x, y][3] == 0 and any(0 <= x + dx < 18 and 0 <= y + dy < 18 and px[x + dx, y + dy][3] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                op[x, y] = ol
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    tiles = []
    for i, bits in enumerate(TIERS):
        im = render(tier(i))
        for size in (18, 36, 72):
            im.resize((size, size), Image.NEAREST).save(os.path.join(OUT, 'bits_%d_%d.png' % (bits, size)))
        tiles.append((bits, im.resize((90, 90), Image.NEAREST)))
    cols = 5; W = cols * 130 + 24; rows = (len(tiles) + cols - 1) // cols; H = rows * 140 + 24
    sheet = Image.new('RGB', (W, H), '#222A2A'); d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype('C:/Windows/Fonts/bahnschrift.ttf', 18); font.set_variation_by_name(b'Bold Condensed')
    except Exception:
        font = ImageFont.load_default()
    for i, (bits, im) in enumerate(tiles):
        x = 24 + (i % cols) * 130; y = 24 + (i // cols) * 140
        d.rectangle([x - 8, y - 8, x + 104, y + 118], fill='#1A2020'); sheet.paste(im, (x + 3, y), im)
        label = format(bits, ',') + ' BITS'; w = d.textlength(label, font=font); d.text((x + 48 - w / 2, y + 94), label, font=font, fill='#E2DAC2')
    sheet.save(os.path.join(OUT, 'bit_badges_sheet.png'))
    print('wrote', len(TIERS), 'badges (18, 36 and 72 px) to', os.path.abspath(OUT))


if __name__ == '__main__':
    main()
