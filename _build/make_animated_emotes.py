"""Animated pixel-art emotes in the same style as the other emotes (28 x 28 grid, flat colours, dark outline, hard-edged scaling): the moves chat uses most.
howdy (a cowboy tipping his hat), jam (bobbing to the beat), clap, pet (a hand petting a head), modcheck (darting eyes), shake (nervous), dance, riot, wave.
Each one is saved as a looping GIF and as an APNG at 28, 56 and 112 px, plus a preview strip of the frames.
Run:  python _build/make_animated_emotes.py   (needs Pillow). Output: twitch/emotes/animated/<name>_28|56|112.gif|.png and animated_preview.png"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(__file__))
from make_emotes import C, G, INK, FACE, FACE_L, FACE_D, SKIN, SKIN_D, CREAM, CREAM_D, HEAT, HEAT_D, HEAT_L, RUST, RUST_D, RUST_L, AQUA, AQUA_D, AQUA_L, GREY, GREY_D, GREY_L, WHITE   # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), '..', 'twitch', 'emotes', 'animated')


# ------------------------------------------------------------------------------------------------------------------ the animations
def jam():
    """a face with headphones bobbing to the beat, notes floating up"""
    frames = []
    for i, (dy, tilt) in enumerate([(0, 0), (2, 1), (3, 0), (2, -1)]):
        c = C(); c.face(14, 14 + dy, 10)
        c.eyes('happy', 11 + dy); c.art(9, 17 + dy, ['X.......X', '.XXXXXXX.'], {'X': INK})
        for x in range(5, 24):   # the headband over the head
            r = abs(x - 14.0) / 10.0; y = int(round(14 + dy - 11 * (1 - r * r) ** 0.5)) if r < 1 else 14 + dy
            c.p(x, y - 1, AQUA); c.p(x, y, AQUA_D)
        for ex in (2, 23): c.rect(ex, 12 + dy, 4, 7, AQUA); c.rect(ex, 12 + dy, 4, 1, AQUA_L); c.rect(ex + (2 if ex == 2 else 0), 13 + dy, 2, 5, AQUA_D)
        note = [(21, 2), (23, 5), (4, 4), (2, 1)][i]
        c.art(note[0] - 1, note[1], ['.XX', '.X.', 'XX.'], {'X': HEAT})
        frames.append(c)
    return frames


def _hand(c, x, y, flip=False):
    rows = ['..S.S.S.', '..S.S.S.', '.SSSSSSS', 'SSSSSSSS', 'SSSSSSSD', '.SSSSSDD', '..SSSDD.', '...SDD..']
    if flip: rows = [r[::-1] for r in rows]
    c.art(x, y, rows, {'S': SKIN, 'D': SKIN_D})


def _palm(c, x, y, left):
    """a hand seen from the side: a flat palm with the fingers up, 8 wide and 15 tall"""
    for dy in range(15):
        for dx in range(8):
            col = SKIN if dx < 6 else SKIN_D
            if dy < 5 and dx in (2, 5): col = SKIN_D     # the gaps between the fingers
            if dy < 3 and dx in (0, 7): continue          # rounded finger tips
            c.p(x + dx, y + dy, col)
    c.rect(x + (1 if left else 0), y + 15, 7, 3, HEAT); c.rect(x + (1 if left else 0), y + 15, 7, 1, HEAT_L)   # a sleeve


def clap():
    frames = []
    for gap, burst in [(11, 0), (7, 0), (3, 0), (0, 1), (3, 0), (7, 0)]:
        c = C(); _palm(c, 14 - gap // 2 - 8, 6, True); _palm(c, 14 + (gap + 1) // 2, 6, False)
        if burst:
            for p in [(14, 3), (14, 1), (9, 3), (19, 3), (4, 6), (24, 6), (6, 2), (22, 2)]: c.p(p[0], p[1], HEAT_L)
            for p in [(14, 2), (8, 4), (20, 4)]: c.p(p[0], p[1], HEAT)
        frames.append(c)
    return frames

def pet():
    frames = []
    for hy, squash in [(1, 0), (3, 1), (5, 2), (3, 1), (1, 0)]:
        c = C()
        # the head squashes a little under the hand
        top = 11 + squash * 2; c.face(14, 18 + squash, 9)
        for y in range(G):
            for x in range(G):
                if (x, y) in c.g and y < top: del c.g[(x, y)]
        c.eyes('happy', top + 3); c.art(10, top + 8, ['X.....X', '.XXXXX.'], {'X': INK})
        _hand(c, 9, hy); c.rect(8, hy + 8, 12, 2, SKIN_D) if False else None
        for p in [(4, 6 + squash), (24, 6 + squash)]: c.p(p[0], p[1], RUST_L)   # little hearts
        frames.append(c)
    return frames


def modcheck():
    frames = []
    for px, brow in [(0, 0), (-2, 1), (2, 0), (0, 1), (-2, 0), (2, 1)]:
        c = C(); c.face(14, 15, 11); c.rect(6, 7 - brow, 6, 1, INK); c.rect(16, 7 - brow, 6, 1, INK)
        for ex in (6, 16): c.rect(ex, 9, 6, 7, WHITE); c.rect(ex + 2 + px, 11, 2, 4, INK)       # the pupils dart left and right
        c.rect(10, 20, 8, 1, INK)
        frames.append(c)
    return frames

def shake():
    frames = []
    for dx, dy, drop in [(-1, 0, 0), (1, 0, 1), (-1, 1, 2), (1, 0, 3)]:
        c = C(); c.face(14 + dx, 15 + dy, 10, ('#f7e08a', '#fff3c0', '#c9a84a')); c.brows('sad', 9 + dy) if False else None
        c.rect(8 + dx, 8 + dy, 4, 1, INK); c.rect(17 + dx, 8 + dy, 4, 1, INK)
        for ex in (8, 17): c.rect(ex + dx, 10 + dy, 4, 4, WHITE); c.rect(ex + 1 + dx, 11 + dy, 2, 2, INK)
        c.art(9 + dx, 19 + dy, ['X.X.X.X.X', '.X.X.X.X.'][:2], {'X': INK})   # a wobbly mouth
        c.rect(23, 4 + drop * 2, 2, 3, AQUA); c.rect(23, 4 + drop * 2, 1, 1, AQUA_L)   # sweat flying off
        frames.append(c)
    return frames


def dance():
    frames = []
    for lean, left_up, right_up, legs in [(0, 1, 1, 0), (1, 1, 0, 1), (0, 0, 0, 2), (-1, 0, 1, 1)]:
        c = C(); hx = 14 + lean
        c.disc(hx, 6, 4.5, FACE); c.rect(hx - 2, 5, 1, 2, INK); c.rect(hx + 1, 5, 1, 2, INK); c.rect(hx - 1, 8, 3, 1, INK)             # the head
        c.rect(hx - 4, 11, 8, 8, HEAT); c.rect(hx - 4, 11, 8, 2, HEAT_L); c.rect(hx + 1, 13, 3, 6, HEAT_D)                             # the body
        c.rect(hx - 8, 3 if left_up else 12, 3, 8, SKIN); c.rect(hx + 5, 3 if right_up else 12, 3, 8, SKIN)                           # the arms
        c.rect(hx - 4, 19, 3, 5 + (1 if legs == 1 else 0), '#2a3333'); c.rect(hx + 1, 19, 3, 5 + (1 if legs == 2 else 0), '#2a3333')   # the legs
        c.rect(hx - 5, 24 + (1 if legs == 1 else 0), 4, 2, INK); c.rect(hx + 1, 24 + (1 if legs == 2 else 0), 4, 2, INK)
        for p in [(3 + lean * 2, 4), (24 - lean * 2, 9)]: c.p(p[0], p[1], AQUA_L)
        frames.append(c)
    return frames

def riot():
    frames = []
    for k, (sy, fl) in enumerate([(0, 0), (1, 1), (0, 2), (1, 1)]):
        c = C(); c.face(14, 17, 9, (RUST, RUST_L, RUST_D)); c.art(7, 13, ['XX...', '.XXX.', '...XX'], {'X': INK}); c.art(15, 13, ['...XX', '.XXX.', 'XX...'], {'X': INK})
        c.rect(9, 16, 2, 3, INK); c.rect(17, 16, 2, 3, INK); c.rect(9, 21, 10, 3, INK); c.rect(10, 22, 8, 1, WHITE)
        c.rect(13, 5 + sy, 2, 4, CREAM_D); c.rect(8, 0 + sy, 12, 6, CREAM); c.rect(8, 0 + sy, 12, 1, WHITE); c.rect(13, 1 + sy, 2, 3, RUST_D); c.rect(13, 5 + sy, 2, 1, RUST_D)   # a sign held up: !
        for (fx, fy) in [(3, 8), (24, 8)]:                                                                            # flames on both sides
            c.rect(fx, fy, 3, 5, HEAT); c.rect(fx + 1, fy - 1 - fl % 2, 1, 2, HEAT_L); c.rect(fx, fy + 2, 3, 3, RUST); c.rect(fx + 1, fy + 3, 1, 2, HEAT_L)
        frames.append(c)
    return frames


def wave():
    frames = []
    for hx, hy in [(18, 3), (20, 2), (22, 3), (20, 4)]:
        c = C(); c.face(11, 16, 9); c.eyes('dot', 13) if False else None
        c.rect(7, 13, 2, 3, INK); c.rect(13, 13, 2, 3, INK); c.art(7, 19, ['X.....X', '.XXXXX.'], {'X': INK})
        _hand(c, hx, hy + 2)
        for p in [(hx - 2, hy + 4), (hx - 3, hy + 7)]: c.p(p[0], p[1], HEAT)
        frames.append(c)
    return frames


F35 = {'H': ['101', '101', '111', '101', '101'], 'O': ['111', '101', '101', '101', '111'], 'W': ['10001', '10001', '10101', '10101', '01010'], 'D': ['110', '101', '101', '101', '110'], 'Y': ['101', '101', '010', '010', '010']}


def howdy():
    """a cowboy face that tips its hat while the letters of HOWDY bounce one after the other"""
    BR, BR_L, BR_D = '#8b5a2b', '#b5813f', '#5e3c1c'
    frames = []
    for i, (lift, bounce) in enumerate([(0, 0), (2, 1), (3, 2), (2, 3), (0, 4), (0, -1)]):
        c = C(); c.face(14, 14, 7.5)
        c.rect(10, 12 - (1 if lift else 0), 2, 2, INK); c.rect(16, 12 - (1 if lift else 0), 2, 2, INK)                       # eyes (a brow raise when the hat tips)
        c.art(9, 16, ['X.....X', '.XXXXX.'], {'X': INK}); c.rect(10, 15, 3, 1, BR_D); c.rect(15, 15, 3, 1, BR_D)           # a smile and a moustache
        dx = 1 if lift else 0; hy = 7 - lift                                                                                  # the hat: the brim and the crown, lifted when tipped
        c.rect(4 + dx, hy, 20, 2, BR); c.rect(4 + dx, hy, 20, 1, BR_L); c.rect(8 + dx, hy - 5, 12, 5, BR); c.rect(8 + dx, hy - 5, 12, 1, BR_L); c.rect(8 + dx, hy - 2, 12, 1, RUST)
        c.rect(8 + dx, hy - 5, 2, 5, BR_L); c.rect(18 + dx, hy - 5, 2, 5, BR_D); c.rect(13 + dx, hy - 5, 2, 1, BR_D)
        x = 3
        for k, ch in enumerate('HOWDY'):                                                                                      # the letters, one bouncing at a time
            up = 1 if k == bounce else 0; col = HEAT_L if k == bounce else CREAM
            for r, row in enumerate(F35[ch]):
                for q, bit in enumerate(row):
                    if bit == '1': c.p(x + q, 22 - up + r, col)
            x += len(F35[ch][0]) + 1
        frames.append(c)
    return frames


ANIMS = [('howdy', howdy, 140), ('jam', jam, 130), ('clap', clap, 110), ('pet', pet, 110), ('modcheck', modcheck, 220), ('shake', shake, 90), ('dance', dance, 150), ('riot', riot, 120), ('wave', wave, 140)]


# ------------------------------------------------------------------------------------------------------------------ export
def to_gif(frames, size, path, ms):
    """a looping GIF with a transparent background (one shared palette, index 0 is the transparent colour)"""
    imgs = [f.resize((size, size), Image.NEAREST) for f in frames]
    cols = []
    for im in imgs:
        for px in im.getdata():
            if px[3] > 0 and px[:3] not in cols: cols.append(px[:3])
    cols = cols[:255]; pal = [0, 0, 0]
    for c in cols: pal += list(c)
    pal += [0] * (768 - len(pal)); index = {c: i + 1 for i, c in enumerate(cols)}; out = []
    for im in imgs:
        p = Image.new('P', im.size, 0); p.putpalette(pal); pp = p.load(); src = im.load()
        for y in range(im.size[1]):
            for x in range(im.size[0]):
                px = src[x, y]; pp[x, y] = index.get(px[:3], 0) if px[3] > 0 else 0
        out.append(p)
    out[0].save(path, save_all=True, append_images=out[1:], duration=ms, loop=0, transparency=0, disposal=2)


def main():
    os.makedirs(OUT, exist_ok=True); sheet_rows = []
    for name, fn, ms in ANIMS:
        frames = [c.render() for c in fn()]
        for size in (28, 56, 112):
            to_gif(frames, size, os.path.join(OUT, '%s_%d.gif' % (name, size)), ms)
            ims = [f.resize((size, size), Image.NEAREST) for f in frames]
            ims[0].save(os.path.join(OUT, '%s_%d.png' % (name, size)), save_all=True, append_images=ims[1:], duration=ms, loop=0, disposal=1)   # an APNG
        sheet_rows.append((name, frames))
    W = 20 + 12 * 70; H = 20 + len(sheet_rows) * 80
    sheet = Image.new('RGB', (W, H), '#222A2A'); d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype('C:/Windows/Fonts/bahnschrift.ttf', 16); font.set_variation_by_name(b'Bold Condensed')
    except Exception:
        font = ImageFont.load_default()
    for r, (name, frames) in enumerate(sheet_rows):
        y = 12 + r * 80; d.text((10, y + 24), name.upper(), font=font, fill='#E2DAC2')
        for i, f in enumerate(frames):
            t = f.resize((64, 64), Image.NEAREST); x = 110 + i * 68; d.rectangle([x - 2, y - 2, x + 65, y + 65], fill='#1A2020'); sheet.paste(t, (x, y), t)
    sheet.save(os.path.join(OUT, 'animated_preview.png')); print('wrote', len(ANIMS), 'animated emotes to', os.path.abspath(OUT))


if __name__ == '__main__':
    main()
