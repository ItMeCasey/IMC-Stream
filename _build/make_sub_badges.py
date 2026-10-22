"""Pixel-art subscriber badges for Twitch, in the same style as the cheer badges, the reward icons and the Game Arena people:
flat colours on a tiny grid, scaled with hard edges. A star on 18 x 18 pixels (Twitch's smallest size), saved at 18, 36 and 72 pixels.
Tiers: base, 2, 3, 6 and 9 months, 1 year, then every half year up to 8.5 years (21 badges). The star grows and changes colour as the months go up;
from 1 year it carries the number of full years, and a half year adds a little gold "+".
Tier 2 and Tier 3 subscribers get the same star with a flair: Tier 2 has two silver bars (like a roman II), Tier 3 has three gold bars (III), in the bottom left corner.
Run:  python _build/make_sub_badges.py   (needs Pillow). Output: twitch/sub_badges/ (upload them under Viewer Rewards > Subscriptions > Subscriber Badges: tier1/ , tier2/ and tier3/ are the three tiers)."""
import math
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', 'twitch', 'sub_badges')
INK = '#14191a'
GOLD, GOLD_L, GOLD_D = '#F39120', '#ffd9a0', '#c06a0c'
COLORS = {   # main, light, dark
    'grey': ('#8a9594', '#c9d1d0', '#5d6867'), 'aqua': ('#4FBBBC', '#a6e6e7', '#2f8a8b'), 'heat': ('#F39120', '#ffd9a0', '#c06a0c'), 'rust': ('#EC4624', '#ff9f8a', '#B13A22'),
    'purple': ('#8e5ea2', '#cfa9e0', '#5f3d70'), 'cream': ('#E2DAC2', '#ffffff', '#b3ab92'), 'green': ('#6aa84f', '#b5e09a', '#43762f'), 'blue': ('#2e86c1', '#8cc8ee', '#1d5b87'),
}
YEAR_COLOR = ['rust', 'purple', 'aqua', 'heat', 'cream', 'green', 'blue', 'heat']   # the colour of the star for year 1 .. 8
DIGITS = {
    '1': ['010', '110', '010', '010', '111'], '2': ['111', '001', '111', '100', '111'], '3': ['111', '001', '111', '001', '111'], '4': ['101', '101', '111', '001', '001'],
    '5': ['111', '100', '111', '001', '111'], '6': ['111', '100', '111', '101', '111'], '7': ['111', '001', '010', '010', '010'], '8': ['111', '101', '111', '101', '111'],
}
# (file name, label, months)
TIERS = [('base', 'BASE', 0), ('2m', '2 MONTHS', 2), ('3m', '3 MONTHS', 3), ('6m', '6 MONTHS', 6), ('9m', '9 MONTHS', 9), ('12m', '1 YEAR', 12)]
TIERS += [('%dm' % m, ('%g YEARS' % (m / 12)), m) for m in range(18, 103, 6)]
TIERS = [(n, l.replace('1 YEARS', '1 YEAR'), m) for n, l, m in TIERS]


def hexrgb(c):
    return tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) + (255,)


def star_points(cx, cy, R, r):
    pts = []
    for i in range(10):
        a = -math.pi / 2 + i * math.pi / 5
        rad = R if i % 2 == 0 else r
        pts.append((cx + rad * math.cos(a), cy + rad * math.sin(a)))
    return pts


def tier(months, level=1):
    years, half = divmod(months, 12)[0], months > 12 and (months % 12) == 6
    if months == 0:   name, R = 'grey', 5.2
    elif months == 2: name, R = 'aqua', 6.0
    elif months == 3: name, R = 'aqua', 7.0
    elif months == 6: name, R = 'heat', 7.4
    elif months == 9: name, R = 'heat', 8.0
    else:             name, R = YEAR_COLOR[min(years, 8) - 1] if years >= 1 else 'rust', 8.4
    main, light, dark = COLORS[name]
    cx, cy = 8.5, 9.4 + (0.6 if R < 7 else 0)
    mask = Image.new('L', (18, 18), 0); ImageDraw.Draw(mask).polygon(star_points(cx, cy, R, R * 0.52), fill=255)
    im = Image.new('RGBA', (18, 18), (0, 0, 0, 0)); px = im.load(); mp = mask.load()
    for y in range(18):
        for x in range(18):
            if mp[x, y] > 127:
                c = main
                if abs(x - cx) <= 3 and abs(y - cy) <= 4.5: c = main   # the middle stays plain so the number can be read
                elif y < cy - R * 0.25 and x < cx + 1: c = light        # the upper left is lit
                elif x > cx + 3.5 or (y > cy + R * 0.55 and x > cx): c = dark   # the right and the lower right are in shade
                px[x, y] = hexrgb(c)
    # a glint
    gx, gy = int(cx - R * 0.28), int(cy - R * 0.35)
    if px[gx, gy][3]: px[gx, gy] = hexrgb('#ffffff')
    # the number of full years, in the middle of the star
    if years >= 1:
        d = DIGITS[str(min(years, 8))]
        for ry, row in enumerate(d):
            for rx, ch in enumerate(row):
                if ch == '1': px[int(cx) - 1 + rx, int(cy) - 2 + ry] = hexrgb(INK)
    # a half year: a little gold plus in the corner
    if half:
        for p in [(15, 14), (14, 14), (16, 14), (15, 13), (15, 15)]:
            px[p] = hexrgb(GOLD_L if p == (15, 14) else GOLD)
    # the 8 year star wears a crown
    if years >= 8:
        for x in (5, 8, 11): px[x, 0] = hexrgb(GOLD_L)
        for x in range(5, 12): px[x, 1] = hexrgb(GOLD)
    # Tier 2 and 3 flair: roman-numeral style bars in the bottom left corner (silver for II, gold for III)
    if level >= 2:
        bar, bar_l = ('#c9d1d0', '#ffffff') if level == 2 else (GOLD, GOLD_L)
        for i in range(level):
            for y in range(13, 17):
                px[1 + i * 2, y] = hexrgb(bar_l if y == 13 else bar)
    out = im.copy(); op = out.load(); ol = hexrgb(INK)
    for y in range(18):
        for x in range(18):
            if px[x, y][3] == 0 and any(0 <= x + dx < 18 and 0 <= y + dy < 18 and px[x + dx, y + dy][3] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                op[x, y] = ol
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    try:
        font = ImageFont.truetype('C:/Windows/Fonts/bahnschrift.ttf', 17); font.set_variation_by_name(b'Bold Condensed')
    except Exception:
        font = ImageFont.load_default()
    for level in (1, 2, 3):
        folder = os.path.join(OUT, 'tier%d' % level); os.makedirs(folder, exist_ok=True); tiles = []
        for name, label, months in TIERS:
            im = tier(months, level)
            for size in (18, 36, 72):
                im.resize((size, size), Image.NEAREST).save(os.path.join(folder, 'sub_t%d_%s_%d.png' % (level, name, size)))
            tiles.append((label, im.resize((90, 90), Image.NEAREST)))
        cols = 7; W = cols * 130 + 24; rows = (len(tiles) + cols - 1) // cols; H = rows * 140 + 24
        sheet = Image.new('RGB', (W, H), '#222A2A'); d = ImageDraw.Draw(sheet)
        for i, (label, im) in enumerate(tiles):
            x = 24 + (i % cols) * 130; y = 24 + (i // cols) * 140
            d.rectangle([x - 8, y - 8, x + 104, y + 118], fill='#1A2020'); sheet.paste(im, (x + 3, y), im)
            w = d.textlength(label, font=font); d.text((x + 48 - w / 2, y + 94), label, font=font, fill='#E2DAC2')
        sheet.save(os.path.join(OUT, 'sub_badges_tier%d_sheet.png' % level))
    # the flair on its own, as transparent overlays that go on top of any of the normal (Tier 1) badges
    fl = os.path.join(OUT, 'flair'); os.makedirs(fl, exist_ok=True)
    for level in (2, 3):
        im = Image.new('RGBA', (18, 18), (0, 0, 0, 0)); px = im.load(); bar, bar_l = ('#c9d1d0', '#ffffff') if level == 2 else (GOLD, GOLD_L)
        for i in range(level):
            for y in range(13, 17):
                px[1 + i * 2, y] = hexrgb(bar_l if y == 13 else bar)
        out = im.copy(); op = out.load()
        for y in range(18):
            for x in range(18):
                if px[x, y][3] == 0 and any(0 <= x + dx < 18 and 0 <= y + dy < 18 and px[x + dx, y + dy][3] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                    op[x, y] = hexrgb(INK)
        for size in (18, 36, 72):
            out.resize((size, size), Image.NEAREST).save(os.path.join(fl, 'sub_flair_t%d_%d.png' % (level, size)))
    print('wrote', len(TIERS) * 3, 'badges (3 tiers x 18, 36 and 72 px) to', os.path.abspath(OUT))


if __name__ == '__main__':
    main()
