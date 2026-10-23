"""Pixel-art icons for channel point rewards and power-ups, in the same style as the Game Arena / Dance Party people:
flat rectangles of the theme colours, drawn on a tiny grid and scaled with hard edges.
Each icon is drawn on 12x12 pixels, gets a 1 pixel dark outline (so 14x14), and is saved at 112, 56 and 28 pixels (x8, x4, x2),
the three sizes Twitch asks for custom reward icons. Run:  python _build/make_reward_icons.py   (needs Pillow)"""
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', 'twitch', 'reward_icons')
P = {  # the theme palette plus a few shades
    'k': '#14191a', 'w': '#f4f0e4', 'c': '#E2DAC2', 'a': '#4FBBBC', 'A': '#2f8a8b', 'h': '#F39120', 'H': '#c06a0c', 'y': '#ffd9a0',
    'r': '#EC4624', 'd': '#B13A22', 'g': '#8a9594', 'G': '#2a3333', 'p': '#8e5ea2', 'P': '#5f3d70', 'b': '#8b5a2b', 'B': '#5e3c1c', 's': '#f1c9a0',
}


def grid(rows):
    """rows of 12 characters, '.' = empty"""
    g = {}
    for y, row in enumerate(rows):
        assert len(row) == 12, (y, row)
        for x, ch in enumerate(row):
            if ch != '.':
                g[(x, y)] = ch
    return g


def rect(g, x, y, w, h, c):
    for yy in range(y, y + h):
        for xx in range(x, x + w):
            g[(xx, yy)] = c


def line(g, pts, c):
    for p in pts:
        g[p] = c


# ---------------------------------------------------------------- rewards
def boss():
    g = {}
    rect(g, 1, 3, 10, 7, 'p'); rect(g, 3, 2, 6, 1, 'p'); rect(g, 1, 9, 10, 1, 'P')            # body, top bump, shaded belly
    rect(g, 1, 0, 2, 3, 'w'); rect(g, 9, 0, 2, 3, 'w')                                          # horns
    rect(g, 3, 4, 2, 2, 'w'); rect(g, 7, 4, 2, 2, 'w'); g[(4, 5)] = 'k'; g[(7, 5)] = 'k'       # eyes
    rect(g, 3, 7, 6, 2, 'k'); g[(4, 7)] = 'w'; g[(6, 7)] = 'w'; g[(8, 7)] = 'w'                 # mouth with teeth
    rect(g, 2, 10, 3, 2, 'P'); rect(g, 7, 10, 3, 2, 'P')                                        # feet
    return g


def arena():
    g = {}
    def sword(mirror):
        f = (lambda x: 11 - x) if mirror else (lambda x: x)
        for i in range(8):                                  # blade from the top corner down to the guard
            g[(f(1 + i), i)] = 'c'; g[(f(2 + i), i)] = 'w'
        for p in [(7, 10), (8, 9), (9, 8), (10, 7), (11, 6), (8, 10), (9, 9), (10, 8), (11, 7)]:   # cross guard (across the blade)
            g[(f(p[0]), p[1])] = 'h'
        for p in [(10, 9), (11, 10), (10, 10), (11, 11)]:    # grip and pommel
            g[(f(p[0]), p[1])] = 'd'
    sword(False); sword(True)
    return g


def race():
    g = {}
    rect(g, 2, 5, 6, 3, 'b'); rect(g, 2, 7, 6, 1, 'B')                                          # body
    rect(g, 7, 3, 2, 3, 'b'); rect(g, 8, 2, 3, 2, 'b'); g[(10, 4)] = 'b'; g[(10, 3)] = 'B'; g[(8, 1)] = 'B'   # neck, head, nose, ear
    g[(7, 3)] = 'k'; g[(7, 4)] = 'k'                                                              # mane
    rect(g, 0, 5, 2, 2, 'k'); g[(0, 7)] = 'k'                                                     # tail
    for x in (2, 4, 6, 7):                                                                        # legs (a gallop: two pairs)
        rect(g, x, 8, 1, 2, 'b')
    g[(1, 10)] = 'b'; g[(3, 10)] = 'b'; g[(5, 10)] = 'b'; g[(8, 10)] = 'b'
    for x in (1, 3, 5, 8): g[(x, 11)] = 'k'
    rect(g, 4, 2, 3, 3, 'h'); rect(g, 5, 0, 2, 2, 's'); g[(5, 0)] = 'r'                          # jockey: silks, head, cap
    return g


def dance():
    g = {}
    cx, cy, r = 5.5, 6.5, 4.5                                                                      # disco ball
    for y in range(12):
        for x in range(12):
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r: g[(x, y)] = 'g'
    for y in range(2, 11):
        for x in range(1, 11):
            if (x, y) in g and (x % 2 == 0 or y % 2 == 0): g[(x, y)] = 'c' if (x + y) % 4 else 'g'
    for p in [(3, 4), (4, 3), (3, 3)]: g[p] = 'w'
    g[(5, 0)] = 'g'; g[(5, 1)] = 'g'; g[(5, 2)] = 'g'                                              # string
    for p, c in [((0, 2), 'a'), ((11, 1), 'h'), ((11, 9), 'a'), ((0, 10), 'h'), ((10, 4), 'r')]: g[p] = c   # sparkles
    return g


def emote():
    """the letters 7TV (the colour of 7TV): the reward that adds a 7TV emote"""
    glyphs = {'7': ['111', '001', '001', '010', '010', '010', '010'], 'T': ['111', '010', '010', '010', '010', '010', '010'], 'V': ['101', '101', '101', '101', '101', '010', '010']}   # 3 x 7 pixels, tall enough to fill the icon
    g = {}
    for i, ch in enumerate('7TV'):
        for r, row in enumerate(glyphs[ch]):
            for q, bit in enumerate(row):
                if bit == '1': g[(i * 4 + q, 2 + r + 1)] = 'A'          # the shade under the letters
    for i, ch in enumerate('7TV'):
        for r, row in enumerate(glyphs[ch]):
            for q, bit in enumerate(row):
                if bit == '1': g[(i * 4 + q, 2 + r)] = 'a'
    return g


def tts():
    """a speech bubble with sound waves: text-to-speech"""
    return grid(['............', '.ccccccc....', 'ccccccccc.a.', 'ckkkkkkkc..a', 'ccccccccc..a', 'ckkkkkcc...a', 'ccccccccc.a.', '.ccccccc....', '..cc........', '.c..........', '............', '............'])


# ---------------------------------------------------------------- power-ups
def bolt():
    g = grid(['............', '......yhh...', '.....yhh....', '....yhh.....', '...yhhhhhh..', '...yhhhhhh..', '......hh....', '.....hh.....', '....hh......', '...hh.......', '...h........', '............'])
    return g


def shield():
    return grid(['.aaaaaaaaaa.', '.aaaaccaaaA.', '.aaaaccaaaA.', '.accccccccA.', '.accccccccA.', '.aaaaccaaaA.', '.aaaaccaaaA.', '..aaaccaaA..', '..aaaaaaAA..', '...aaaaAA...', '....aaAA....', '.....aA.....'])


def heal():
    return grid(['............', '.rrrr..rrrr.', 'rrwwrrrrrrrd', 'rrwrrrrrrrrd', 'rrrrrrrrrrrd', '.rrrrrrrrrd.', '..rrrrrrrd..', '...rrrrrd...', '....rrrd....', '.....rd.....', '............', '............'])


def crit():
    return grid(['.....yh.....', '.....hh.....', '....hhhh....', 'yyhhhhhhhhhh', '.hhhhhhhhhH.', '..hhhhhhhH..', '...hhhhhH...', '..hhhhhhHH..', '..hhh..hHH..', '.hhh....hHH.', '.hh......hH.', '............'])


def bomb():
    g = {}
    cx, cy, r = 5.0, 7.0, 4.2
    for y in range(12):
        for x in range(12):
            if (x - cx) ** 2 + (y - cy) ** 2 <= r * r: g[(x, y)] = 'G'
    for p in [(3, 5), (4, 4), (3, 6), (4, 5)]: g[p] = 'g'
    g[(3, 5)] = 'w'
    for p in [(6, 2), (7, 2), (8, 1), (9, 1)]: g[p] = 'c'                                          # fuse
    for p, c in [((10, 0), 'y'), ((9, 0), 'h'), ((11, 1), 'r'), ((10, 2), 'h'), ((10, 1), 'y')]: g[p] = c   # spark
    return g


def coin():
    g = {}
    cx, cy, r = 5.5, 5.5, 5.2
    for y in range(12):
        for x in range(12):
            d = (x - cx) ** 2 + (y - cy) ** 2
            if d <= r * r: g[(x, y)] = 'H' if d > 3.6 ** 2 else 'h'
    rect(g, 5, 3, 2, 6, 'H'); g[(4, 4)] = 'H'; g[(7, 4)] = 'H'; g[(4, 7)] = 'H'; g[(7, 7)] = 'H'  # a simple "$"
    for p in [(2, 3), (3, 2), (2, 4)]: g[p] = 'y'
    return g


ICONS = [('reward_boss', 'Summon a Boss', boss), ('reward_arena', 'Open the Arena', arena), ('reward_race', 'Horse Race', race), ('reward_dance', 'Dance Party', dance), ('reward_emote', '7TV emote', emote), ('reward_tts', 'Text-to-speech', tts),
         ('powerup_double', 'Double damage', bolt), ('powerup_shield', 'Shield', shield), ('powerup_heal', 'Heal', heal), ('powerup_crit', 'Critical hit', crit), ('powerup_bomb', 'Bomb', bomb), ('powerup_coin', 'Bonus coins', coin)]


def render(g):
    """12x12 pixel map -> 14x14 image with a 1 pixel dark outline"""
    im = Image.new('RGBA', (14, 14), (0, 0, 0, 0)); px = im.load()
    for (x, y), c in g.items():
        px[x + 1, y + 1] = tuple(int(P[c][i:i + 2], 16) for i in (1, 3, 5)) + (255,)
    ol = tuple(int(P['k'][i:i + 2], 16) for i in (1, 3, 5)) + (255,)
    out = im.copy(); op = out.load()
    for y in range(14):
        for x in range(14):
            if px[x, y][3] == 0 and any(0 <= x + dx < 14 and 0 <= y + dy < 14 and px[x + dx, y + dy][3] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                op[x, y] = ol
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    tiles = []
    for name, label, fn in ICONS:
        im = render(fn())
        for size in (112, 56, 28):
            im.resize((size, size), Image.NEAREST).save(os.path.join(OUT, '%s_%d.png' % (name, size)))
        tiles.append((label, im.resize((112, 112), Image.NEAREST)))
    # a preview sheet on the dark theme colour
    cols = 5; W = cols * 168 + 24; rows = (len(tiles) + cols - 1) // cols; H = rows * 176 + 24
    sheet = Image.new('RGB', (W, H), '#222A2A'); d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype('C:/Windows/Fonts/bahnschrift.ttf', 20); font.set_variation_by_name(b'Bold Condensed')
    except Exception:
        font = ImageFont.load_default()
    for i, (label, im) in enumerate(tiles):
        x = 24 + (i % cols) * 168; y = 24 + (i // cols) * 176
        d.rectangle([x - 8, y - 8, x + 128, y + 150], fill='#1A2020'); sheet.paste(im, (x, y), im)
        w = d.textlength(label.upper(), font=font); d.text((x + 56 - w / 2, y + 120), label.upper(), font=font, fill='#E2DAC2')
    sheet.save(os.path.join(OUT, 'reward_icons_sheet.png'))
    print('wrote', len(ICONS), 'icons to', os.path.abspath(OUT))


if __name__ == '__main__':
    main()
