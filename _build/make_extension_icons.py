"""Icons for the browser extension (extension/icons/icon16..128.png): a speaker with sound waves on the dark rounded square.
Run: python _build/make_extension_icons.py"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', 'extension', 'icons')
BG, TEAL, ORANGE, CREAM = '#1A2020', '#4FBBBC', '#F39120', '#E2DAC2'
SS = 8


def draw(size):
    s = size * SS; u = s / 100.0
    im = Image.new('RGBA', (s, s), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle([s * .02, s * .02, s * .98, s * .98], radius=s * .22, fill=BG)
    # speaker: box + cone
    d.polygon([(18 * u, 38 * u), (34 * u, 38 * u), (52 * u, 22 * u), (52 * u, 78 * u), (34 * u, 62 * u), (18 * u, 62 * u)], fill=CREAM)
    w = max(int((6 if size <= 32 else 5) * u), 1)
    d.arc([40 * u, 30 * u, 72 * u, 70 * u], -50, 50, fill=ORANGE, width=w)
    if size > 16: d.arc([40 * u, 14 * u, 92 * u, 86 * u], -48, 48, fill=TEAL, width=w)
    return im.resize((size, size), Image.LANCZOS)


os.makedirs(OUT, exist_ok=True)
for n in (16, 32, 48, 128): draw(n).save(os.path.join(OUT, 'icon%d.png' % n))
print('ok')
