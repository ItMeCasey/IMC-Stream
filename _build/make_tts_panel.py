"""A Twitch panel that explains how to use text-to-speech and the sound effects (640 pixels wide: it shows at 320 on Twitch, sharp on every screen).
Run:  python _build/make_tts_panel.py   (needs Pillow, and the Bahnschrift font that ships with Windows). Output: twitch/panel_tts_640.png"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(__file__))
ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'twitch', 'panel_tts_640.png')
W = 640
IRON, IRON_D, AQUA, HEAT, RUST, DRUST, CREAM, INK = '#222A2A', '#1A2020', '#4FBBBC', '#F39120', '#EC4624', '#B13A22', '#E2DAC2', '#14191a'
FONT = 'C:/Windows/Fonts/bahnschrift.ttf'
# the sound effects (name, what it is), the same list as server/tts-sfx.js
SFX = [('ding', 'ding'), ('bell', 'bell'), ('airhorn', 'airhorn'), ('rimshot', 'ba-dum-tss'), ('trombone', 'sad trombone'), ('boing', 'boing'), ('whoosh', 'whoosh'), ('laser', 'laser'), ('coin', 'coin'), ('powerup', 'power-up'),
       ('powerdown', 'power-down'), ('boom', 'explosion'), ('drumroll', 'drum roll'), ('tada', 'ta-da'), ('buzzer', 'buzzer'), ('crickets', 'crickets'), ('applause', 'applause'), ('pop', 'pop'), ('siren', 'siren'), ('sparkle', 'sparkle')]


def font(size, style=b'Bold Condensed'):
    f = ImageFont.truetype(FONT, size)
    try: f.set_variation_by_name(style)
    except Exception: pass
    return f


def tw(d, text, f): return d.textlength(text, font=f)


def wrap(d, text, f, width):
    lines, cur = [], ''
    for w in text.split():
        t = (cur + ' ' + w).strip()
        if tw(d, t, f) > width and cur: lines.append(cur); cur = w
        else: cur = t
    return lines + [cur]


def main():
    H = 1500
    im = Image.new('RGB', (W, H), IRON); d = ImageDraw.Draw(im)
    for y in range(0, H, 8):                                                      # a faint checker like the other panels
        for x in range((y // 8 % 2) * 8, W, 16): d.rectangle([x, y, x + 7, y + 7], fill='#262f2f')
    d.rectangle([0, 0, W, 140], fill=IRON_D)
    x = 0
    for c, f in [(AQUA, .30), (HEAT, .25), (RUST, .20), (DRUST, .15), (CREAM, .10)]:   # the palette stripe
        d.rectangle([x, 136, x + int(W * f) + 1, 140], fill=c); x += int(W * f)
    try:
        logo = Image.open(os.path.join(ROOT, 'assets', 'logo.png')).convert('RGBA').resize((86, 86), Image.LANCZOS); im.paste(logo, (30, 26), logo)
    except Exception: pass
    d.text((140, 22), 'TEXT-TO-SPEECH', font=font(62), fill=CREAM); d.text((142, 88), 'MAKE THE STREAM TALK (AND GO BOOM)', font=font(26), fill=HEAT)

    y = 170
    steps = [('1', AQUA, 'REDEEM THE REWARD', 'Spend your channel points on the Text-to-Speech reward.'), ('2', HEAT, 'TYPE YOUR MESSAGE', 'Whatever you type is read out loud on stream.'), ('3', RUST, 'ADD A SOUND', 'Put a sound in the middle with its name in [square brackets].')]
    for n, col, title, body in steps:
        d.rectangle([30, y, 30 + 64, y + 64], fill=INK); d.rectangle([34, y + 4, 30 + 60, y + 60], fill=col); d.text((62, y + 3), n, font=font(54), fill=INK, anchor='ma')
        d.text((116, y - 4), title, font=font(34), fill=CREAM); fb = font(23, b'SemiCondensed'); ls = wrap(d, body, fb, W - 116 - 30)
        for k, ln in enumerate(ls): d.text((116, y + 34 + k * 26), ln, font=fb, fill='#b5bdb9')
        y += 70 + 26 * len(ls) + 10

    # the example
    d.rectangle([30, y + 6, W - 30, y + 118], fill=INK); d.rectangle([34, y + 10, W - 34, y + 114], fill='#2d3737')
    d.text((50, y + 14), 'EXAMPLE', font=font(20), fill=AQUA)
    parts = [('good luck ', CREAM), ('[airhorn]', HEAT), (' you will need it ', CREAM), ('[boom]', HEAT)]; fx = font(30, b'SemiCondensed'); lines = [[parts[0], parts[1], parts[2]], [parts[3]]]
    yy = y + 44
    for line in lines:
        xx = 50
        for t, c in line: d.text((xx, yy), t, font=fx, fill=c); xx += tw(d, t, fx)
        yy += 36
    y += 140

    # the sound list
    d.text((30, y), 'SOUNDS TO CHOOSE FROM', font=font(30), fill=AQUA); y += 46
    cols, gap = 3, 10; cw = (W - 60 - gap * (cols - 1)) // cols; ch = 46; fn, fd = font(26, b'SemiCondensed'), font(17, b'SemiCondensed')
    for i, (name, desc) in enumerate(SFX):
        cx, cy = 30 + (i % cols) * (cw + gap), y + (i // cols) * (ch + gap)
        d.rectangle([cx, cy, cx + cw, cy + ch], fill=INK); d.rectangle([cx + 3, cy + 3, cx + cw - 3, cy + ch - 3], fill='#2d3737'); d.rectangle([cx + 3, cy + 3, cx + 8, cy + ch - 3], fill=[AQUA, HEAT, RUST][(i % cols)])
        d.text((cx + 18, cy + 6), '[' + name + ']', font=fn, fill=CREAM)
    y += ((len(SFX) + cols - 1) // cols) * (ch + gap) + 16

    d.rectangle([30, y, W - 30, y + 3], fill='#3d4848'); y += 18
    for line in ['Up to 3 sounds in one message.', 'Blocked words are never read out loud.', 'Your points are refunded if it cannot be read.']:
        d.rectangle([34, y + 10, 42, y + 18], fill=HEAT); d.text((56, y), line, font=font(24, b'SemiCondensed'), fill='#b5bdb9'); y += 34
    im = im.crop((0, 0, W, y + 24)); im.save(OUT); print('wrote', os.path.abspath(OUT), im.size)


if __name__ == '__main__':
    main()
