"""A pixel-art channel points icon: a gold arcade coin with "1UP" on it, in the same style as the badges and emotes (flat colours, a dark outline,
hard-edged scaling). Drawn on 28 x 28 pixels and saved at 28, 56 and 112 pixels (the sizes Twitch asks for a custom points icon).
Run:  python _build/make_points_icon.py   (needs Pillow). Output: twitch/channel_points/points_icon_<size>.png"""
import os
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', 'twitch', 'channel_points')
INK = '#14191a'
GOLD, GOLD_L, GOLD_D, RIM, RIM_D = '#F39120', '#ffd9a0', '#c06a0c', '#ffbf5e', '#8a4a06'
G57 = {'1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'], 'U': ['10001', '10001', '10001', '10001', '10001', '10001', '01110'], 'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000']}


def rgb(c):
    return tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) + (255,)


def coin():
    N = 28; im = Image.new('RGBA', (N, N), (0, 0, 0, 0)); px = im.load(); cx = cy = (N - 1) / 2
    for y in range(N):
        for x in range(N):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if d > 12.6: continue
            if d > 10.0: c = RIM if (x - cx) + (y - cy) < 3 else RIM_D                # the raised rim: bright top left, dark bottom right
            else: c = GOLD_D if (x - cx) + (y - cy) > 8 else GOLD                      # the face, a little shade at the bottom right
            px[x, y] = rgb(c)
    for (x, y) in [(7, 5), (8, 4), (9, 3), (6, 6), (5, 7), (10, 3), (4, 8)]: px[x, y] = rgb(GOLD_L)   # a shine along the top left of the rim
    px[8, 5] = rgb('#ffffff'); px[7, 6] = rgb('#ffffff'); px[9, 4] = rgb('#ffffff')
    x0, y0 = 5, 10                                                                  # "1UP" in 5 x 7 pixels, centred, with a light edge underneath
    for i, ch in enumerate('1UP'):
        for r, row in enumerate(G57[ch]):
            for q, bit in enumerate(row):
                if bit == '1': px[x0 + i * 6 + q, y0 + r + 1] = rgb(GOLD_L)
    for i, ch in enumerate('1UP'):
        for r, row in enumerate(G57[ch]):
            for q, bit in enumerate(row):
                if bit == '1': px[x0 + i * 6 + q, y0 + r] = rgb(INK)
    out = im.copy(); op = out.load()
    for y in range(N):
        for x in range(N):
            if px[x, y][3] == 0 and any(0 <= x + dx < N and 0 <= y + dy < N and px[x + dx, y + dy][3] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))): op[x, y] = rgb(INK)
    return out


def main():
    os.makedirs(OUT, exist_ok=True); im = coin()
    for f in os.listdir(OUT):
        if f.startswith('points_icon_'): os.remove(os.path.join(OUT, f))
    for size in (28, 56, 112):
        im.resize((size, size), Image.NEAREST).save(os.path.join(OUT, 'points_icon_%d.png' % size))
    sheet = Image.new('RGB', (340, 150), '#222A2A'); x = 20
    for size in (112, 56, 28):
        t = im.resize((size, size), Image.NEAREST); sheet.paste(t, (x, 20 + (112 - size) // 2), t); x += size + 20
    sheet.save(os.path.join(OUT, 'points_icon_preview.png')); print('wrote', os.path.abspath(OUT))


if __name__ == '__main__':
    main()
