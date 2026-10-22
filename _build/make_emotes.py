"""Pixel-art Twitch emotes in the same style as the hearts, badges and reward icons: a 28 x 28 grid, flat colours, a dark outline, hard-edged scaling
(28, 56 and 112 px, the three sizes Twitch asks for). The round yellow face is the base of most of them; a few are objects (GG, RIP, cheers, thumbs up).
Emotes: hype, laugh, sad, gg, hi, lurk, rip, rage, sleep, cheers, facepalm, thumbsup, shocked, salute. (The heart is in make_heart_emotes.py.)
Run:  python _build/make_emotes.py   (needs Pillow). Output: twitch/emotes/<name>_28|56|112.png and emotes_preview.png"""
import math
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', 'twitch', 'emotes')
G = 28
INK = '#14191a'
FACE, FACE_L, FACE_D = '#f7c948', '#ffe590', '#c9902a'
SKIN, SKIN_D = '#f1c9a0', '#d9a074'
CREAM, CREAM_D = '#E2DAC2', '#b3ab92'
HEAT, HEAT_D, HEAT_L = '#F39120', '#c06a0c', '#ffd9a0'
RUST, RUST_D, RUST_L = '#EC4624', '#B13A22', '#ff9f8a'
AQUA, AQUA_D, AQUA_L = '#4FBBBC', '#2f8a8b', '#a6e6e7'
GREY, GREY_D, GREY_L = '#8a9594', '#5d6867', '#c9d1d0'
WHITE = '#ffffff'

F57 = {   # a 5 x 7 pixel font for the few letters the emotes need
    'G': '01110 10001 10000 10111 10001 10001 01111', 'R': '11110 10001 10001 11110 10100 10010 10001', 'I': '01110 00100 00100 00100 00100 00100 01110', 'P': '11110 10001 10001 11110 10000 10000 10000',
    'Z': '11111 00001 00010 00100 01000 10000 11111',
}


class C:
    def __init__(self):
        self.g = {}

    def p(self, x, y, c):
        if 0 <= x < G and 0 <= y < G: self.g[(int(x), int(y))] = c

    def rect(self, x, y, w, h, c):
        for yy in range(y, y + h):
            for xx in range(x, x + w): self.p(xx, yy, c)

    def disc(self, cx, cy, r, c):
        for y in range(G):
            for x in range(G):
                if (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r: self.p(x, y, c)

    def art(self, x, y, rows, pal):
        """rows of characters; '.' is empty, every other character is looked up in pal"""
        for j, row in enumerate(rows):
            for i, ch in enumerate(row):
                if ch != '.': self.p(x + i, y + j, pal[ch])

    def line(self, x0, y0, x1, y1, c):
        n = max(abs(x1 - x0), abs(y1 - y0)) or 1
        for i in range(n + 1): self.p(round(x0 + (x1 - x0) * i / n), round(y0 + (y1 - y0) * i / n), c)

    def text(self, s, x, y, c, sc=1):
        for k, ch in enumerate(s):
            gl = F57[ch].split(' ')
            for r in range(7):
                for q in range(5):
                    if gl[r][q] == '1': self.rect(x + k * 6 * sc + q * sc, y + r * sc, sc, sc, c)

    def face(self, cx=14, cy=15, r=11, col=(FACE, FACE_L, FACE_D)):
        main, light, dark = col
        for y in range(G):
            for x in range(G):
                d = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2
                if d <= r * r:
                    c = main
                    if (x - cx) + (y - cy) > r * 0.55: c = dark
                    elif (x - cx) + (y - cy) < -r * 0.9: c = light
                    self.p(x, y, c)

    def eyes(self, kind='dot', y=12):
        L, R = 9, 17
        if kind == 'dot':
            self.rect(L, y, 2, 3, INK); self.rect(R, y, 2, 3, INK)
        elif kind == 'wide':   # big white eyes with a small pupil
            for ex in (L - 1, R - 1):
                self.rect(ex, y - 1, 4, 5, WHITE); self.rect(ex + 1, y + 1, 2, 2, INK)
        elif kind == 'happy':   # ^ ^
            for ex in (L - 1, R - 1):
                self.art(ex, y, ['.XX.', 'X..X'], {'X': INK})
        elif kind == 'squint':   # > <
            self.art(L - 1, y - 1, ['XX..', '..XX', 'XX..'], {'X': INK}); self.art(R, y - 1, ['..XX', 'XX..', '..XX'], {'X': INK})
        elif kind == 'closed':
            self.rect(L - 1, y + 1, 4, 1, INK); self.rect(R - 1, y + 1, 4, 1, INK)
        elif kind == 'star':
            for ex in (L, R + 1): self.art(ex - 1, y - 1, ['.X.', 'XXX', '.X.'], {'X': INK})

    def brows(self, kind, y=9):
        if kind == 'angry':
            self.art(7, y, ['XX...', '.XXX.', '...XX'], {'X': INK}); self.art(16, y, ['...XX', '.XXX.', 'XX...'], {'X': INK})
        elif kind == 'sad':
            self.art(7, y, ['...XX', '.XXX.', 'XX...'], {'X': INK}); self.art(16, y, ['XX...', '.XXX.', '...XX'], {'X': INK})
        elif kind == 'up':
            self.rect(8, y - 1, 4, 1, INK); self.rect(16, y - 1, 4, 1, INK)

    def mouth(self, kind):
        if kind == 'smile':
            self.art(9, 19, ['X.......X', '.XXXXXXX.'], {'X': INK})
        elif kind == 'open':   # a big open smile
            self.art(8, 18, ['XXXXXXXXXXXX', 'XWWWWWWWWWWX', '.XRRRRRRRRX.', '..XRRRRRRX..', '...XXXXXX...'], {'X': INK, 'W': WHITE, 'R': RUST})
        elif kind == 'o':
            self.art(12, 18, ['.XXXX.', 'X....X', 'X....X', 'X....X', '.XXXX.'], {'X': INK}); self.rect(13, 19, 4, 3, RUST_D)
        elif kind == 'small_o':
            self.art(12, 19, ['.XX.', 'X..X', '.XX.'], {'X': INK})
        elif kind == 'frown':
            self.art(10, 19, ['.XXXXXX.', 'X......X'], {'X': INK})
        elif kind == 'flat':
            self.rect(10, 20, 8, 1, INK)
        elif kind == 'teeth':   # gritted teeth
            self.rect(8, 18, 12, 5, INK); self.rect(9, 19, 10, 3, WHITE)
            for x in (11, 14, 17): self.rect(x, 19, 1, 3, INK)
            self.rect(9, 20, 10, 1, INK)

    def render(self):
        im = Image.new('RGBA', (G, G), (0, 0, 0, 0)); px = im.load()
        for (x, y), c in self.g.items(): px[x, y] = tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) + (255,)
        out = im.copy(); op = out.load(); ol = tuple(int(INK[i:i + 2], 16) for i in (1, 3, 5)) + (255,)
        for y in range(G):
            for x in range(G):
                if px[x, y][3] == 0 and any(0 <= x + dx < G and 0 <= y + dy < G and px[x + dx, y + dy][3] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))): op[x, y] = ol
        return out


def hand(c, x, y, wave=0):
    """a small open hand (9 x 10) with the thumb on the left"""
    c.art(x, y, ['..S.S.S..', '..S.S.S..', '.SSSSSSS.', 'SSSSSSSSS', 'SSSSSSSSD', '.SSSSSSD.', '..SSSSDD.', '...SSDD..'], {'S': SKIN, 'D': SKIN_D})


# ---------------------------------------------------------------------------------------------------------------- the emotes
def hype():
    c = C(); c.face(); c.brows('up'); c.eyes('star', 12); c.mouth('open')
    for (x, y) in [(2, 3), (25, 3), (25, 22)]:
        for p in [(x, y), (x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)]: c.p(p[0], p[1], HEAT_L if p == (x, y) else HEAT)
    return c


def laugh():
    c = C(); c.face(); c.eyes('squint', 12); c.mouth('open')
    for (x, y) in [(5, 16), (4, 17), (4, 18), (23, 16), (24, 17), (24, 18)]: c.p(x, y, AQUA_L)   # tears of joy
    c.p(5, 17, AQUA); c.p(23, 17, AQUA)
    return c


def sad():
    c = C(); c.face(); c.brows('sad'); c.eyes('dot', 12); c.mouth('frown')
    c.rect(18, 15, 2, 6, AQUA); c.rect(18, 15, 1, 2, AQUA_L); c.rect(18, 21, 2, 2, AQUA_D)   # a tear running down
    return c


def gg():
    c = C(); c.rect(1, 5, 26, 18, HEAT); c.rect(1, 5, 26, 3, HEAT_L); c.rect(1, 20, 26, 3, HEAT_D); c.rect(24, 8, 3, 12, HEAT_D)
    c.text('G', 4, 8, CREAM, 2); c.text('G', 15, 8, CREAM, 2); c.rect(4, 22, 20, 1, HEAT_D)
    return c

def hi():
    c = C(); c.face(12, 16, 10); c.eyes('dot', 13); c.mouth('smile')
    hand(c, 17, 2)
    for p in [(16, 4), (15, 6), (16, 9)]: c.p(p[0], p[1], HEAT)   # wave marks
    return c


def lurk():
    c = C(); c.face(14, 12, 10)
    c.rect(8, 9, 4, 3, WHITE); c.rect(16, 9, 4, 3, WHITE); c.rect(9, 10, 2, 2, INK); c.rect(17, 10, 2, 2, INK); c.rect(7, 7, 6, 1, INK); c.rect(15, 7, 6, 1, INK)   # eyes glancing sideways
    LEAF, LEAF_L, LEAF_D = '#6aa84f', '#9bd17c', '#3a6b28'   # hiding behind a bush: overlapping round clumps of leaves, lit from the top left
    for (x, y, r) in [(3, 22, 4.5), (8, 20.5, 4.2), (13, 20, 4.5), (18, 20.5, 4.5), (23, 21.5, 4.5), (27, 24, 4), (10, 25, 5), (17, 25.5, 5.5), (4, 26, 4.5), (24, 26, 4.5)]:
        c.disc(x, y, r, LEAF)
    for y in range(G):
        for x in range(G):
            if c.g.get((x, y)) == LEAF and y > 16:
                h = (x * 73856093 ^ y * 19349663) % 11
                if h == 0 or h == 1: c.p(x, y, LEAF_D)                                  # dark gaps between the leaves
                elif h == 2 and y < 24: c.p(x, y, LEAF_L)                               # light leaf tips
                elif y > 24 or x > 23: c.p(x, y, LEAF_D)                                # the shaded lower right
    c.rect(0, 26, 28, 2, LEAF_D)
    return c


def rip():
    c = C(); c.rect(0, 24, 28, 4, '#43762f'); c.rect(0, 24, 28, 1, '#6aa84f')
    c.art(4, 2, ['...XXXXXXXXXXXXXX...', '..XXXXXXXXXXXXXXXX..', '.XXXXXXXXXXXXXXXXXX.'] + ['XXXXXXXXXXXXXXXXXXXX'] * 19, {'X': GREY})
    c.rect(4, 5, 2, 19, GREY_L); c.rect(22, 6, 2, 18, GREY_D)
    c.rect(13, 5, 2, 7, GREY_D); c.rect(11, 7, 6, 2, GREY_D)   # a cross
    c.text('R', 6, 14, INK, 1); c.text('I', 12, 14, INK, 1); c.text('P', 18, 14, INK, 1)   # RIP, 5 pixels per letter, all on the stone (x 6 to 22)
    return c


def rage():
    c = C(); c.face(14, 15, 11, (RUST, RUST_L, RUST_D)); c.brows('angry', 9); c.eyes('dot', 12); c.mouth('teeth')
    for (x, y) in [(3, 5), (24, 5)]:   # steam
        c.rect(x, y, 3, 2, WHITE); c.rect(x + 1, y - 1, 2, 1, CREAM)
    return c


def sleep():
    c = C(); c.face(12, 16, 10); c.eyes('closed', 14); c.rect(10, 20, 4, 1, INK)
    c.text('Z', 19, 2, AQUA, 1); c.text('Z', 22, 9, AQUA_L, 1) if False else None
    c.art(22, 8, ['XXXX', '..X.', '.X..', 'XXXX'], {'X': AQUA_L})
    return c


def cheers():
    c = C()
    for (x, y, tilt) in [(3, 7, 1), (14, 7, -1)]:
        c.rect(x, y, 10, 14, CREAM); c.rect(x + 1, y + 3, 8, 10, HEAT); c.rect(x + 1, y + 3, 8, 2, HEAT_L); c.rect(x + 7, y + 3, 2, 10, HEAT_D)   # glass with beer
        c.rect(x, y - 2, 10, 3, WHITE); c.rect(x + 2, y - 3, 3, 1, WHITE)   # foam
        c.rect(x + 9 if tilt > 0 else x - 3, y + 4, 3, 6, CREAM_D)   # handle
    for (x, y) in [(13, 3), (11, 2), (16, 2)]: c.p(x, y, HEAT_L)
    c.rect(13, 3, 2, 2, WHITE)
    return c


def facepalm():
    c = C(); c.face(13, 15, 10); c.eyes('closed', 14)
    c.mouth('flat'); c.rect(8, 22, 2, 1, INK)
    c.art(12, 6, ['SSSSSSSSSS', 'SSSSSSSSSS', 'SSSSSSSSSD', 'SSSSSSSSDD', '.SSSSSSDD.', '..SSSSDD..'], {'S': SKIN, 'D': SKIN_D})   # a hand over the eyes
    c.rect(11, 8, 3, 6, SKIN); c.rect(11, 12, 3, 1, SKIN_D)
    return c


def thumbsup():
    c = C()
    c.rect(3, 12, 5, 12, HEAT); c.rect(3, 12, 5, 2, HEAT_L); c.rect(6, 14, 2, 10, HEAT_D)   # the cuff
    c.rect(10, 3, 4, 9, SKIN); c.rect(13, 4, 1, 8, SKIN_D); c.rect(11, 2, 2, 1, SKIN)   # the thumb
    c.rect(8, 11, 17, 12, SKIN); c.rect(8, 21, 17, 2, SKIN_D); c.rect(23, 12, 2, 10, SKIN_D)   # the fist
    for y in (14, 17, 20): c.rect(13, y, 11, 1, SKIN_D)   # the fingers
    return c

def shocked():
    c = C(); c.face(14, 15, 11, ('#f7e08a', '#fff3c0', '#c9a84a')); c.brows('up', 8); c.eyes('wide', 12); c.mouth('small_o')
    for (x, y) in [(3, 6), (3, 9), (25, 6), (25, 9)]: c.rect(x - 1, y, 2, 2, GREY_L)   # shock lines
    c.rect(23, 14, 2, 4, AQUA); c.rect(23, 14, 1, 1, AQUA_L)   # a cold sweat
    return c


def salute():
    c = C(); c.face(13, 16, 10); c.brows('angry', 10); c.eyes('dot', 13); c.mouth('flat')
    c.art(11, 3, ['SSSSSSSSSSSS', 'SSSSSSSSSSSS', 'SSSSSSSSSSSD', '.SSSSSSSSDD.'], {'S': SKIN, 'D': SKIN_D}); c.rect(20, 5, 7, 3, SKIN); c.rect(24, 7, 3, 3, SKIN_D)   # a flat hand at the brow
    return c


EMOTES = [('hype', hype), ('laugh', laugh), ('sad', sad), ('gg', gg), ('hi', hi), ('lurk', lurk), ('rip', rip), ('rage', rage), ('sleep', sleep), ('cheers', cheers), ('facepalm', facepalm), ('thumbsup', thumbsup), ('shocked', shocked), ('salute', salute)]


def main():
    os.makedirs(OUT, exist_ok=True); ims = []
    for name, fn in EMOTES:
        im = fn().render(); ims.append((name, im))
        for size in (28, 56, 112): im.resize((size, size), Image.NEAREST).save(os.path.join(OUT, '%s_%d.png' % (name, size)))
    cols = 5; rows = (len(ims) + cols - 1) // cols; sheet = Image.new('RGB', (cols * 140 + 20, rows * 150 + 20), '#222A2A'); d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype('C:/Windows/Fonts/bahnschrift.ttf', 18); font.set_variation_by_name(b'Bold Condensed')
    except Exception:
        font = ImageFont.load_default()
    for i, (name, im) in enumerate(ims):
        x = 20 + (i % cols) * 140; y = 20 + (i // cols) * 150; d.rectangle([x - 8, y - 8, x + 120, y + 138], fill='#1A2020'); big = im.resize((90, 90), Image.NEAREST); sheet.paste(big, (x + 4, y), big)
        small = im.resize((28, 28), Image.NEAREST); sheet.paste(small, (x + 88, y + 62), small); d.text((x + 4, y + 104), name.upper(), font=font, fill='#E2DAC2')
    sheet.save(os.path.join(OUT, 'emotes_preview.png')); print('wrote', len(ims), 'emotes to', os.path.abspath(OUT))


if __name__ == '__main__':
    main()
