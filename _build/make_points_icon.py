"""A pixel-art channel points icon: a gold arcade coin with "1UP" on it, in the same style as the badges and emotes (flat colours, a dark outline,
hard-edged scaling). Drawn on 20 x 20 pixels and saved at 20, 40 and 80 pixels (the sizes Twitch asks for a custom points icon) and bigger for previews.
Run:  python _build/make_points_icon.py   (needs Pillow). Output: twitch/channel_points/points_icon_<size>.png"""
import os
from PIL import Image

OUT = os.path.join(os.path.dirname(__file__), '..', 'twitch', 'channel_points')
INK = '#14191a'
GOLD, GOLD_L, GOLD_D, RIM, RIM_D = '#F39120', '#ffd9a0', '#c06a0c', '#ffbf5e', '#8a4a06'
G35 = {'1': ['010', '110', '010', '010', '111'], 'U': ['101', '101', '101', '101', '111'], 'P': ['110', '101', '110', '100', '100']}


def rgb(c):
    return tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) + (255,)


def coin():
    N = 20; im = Image.new('RGBA', (N, N), (0, 0, 0, 0)); px = im.load(); cx = cy = (N - 1) / 2
    for y in range(N):
        for x in range(N):
            d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
            if d > 9.0: continue
            if d > 7.3: c = RIM if (x - cx) + (y - cy) < 2 else RIM_D                # the raised rim: bright top left, dark bottom right
            else: c = GOLD_D if (x - cx) + (y - cy) > 5 else GOLD                      # the face: a little shade at the bottom right
            px[x, y] = rgb(c)
    for (x, y) in [(5, 4), (6, 3), (4, 5), (7, 3), (3, 6)]: px[x, y] = rgb(GOLD_L)  # a shine near the top left of the rim
    px[6, 4] = rgb('#ffffff'); px[5, 5] = rgb('#ffffff')
    x0 = 4                                                                          # "1UP" in 3 x 5 pixels, centred (11 wide) with a light edge underneath
    for i, ch in enumerate('1UP'):
        for r, row in enumerate(G35[ch]):
            for q, bit in enumerate(row):
                if bit == '1': px[x0 + i * 4 + q + 0, 7 + r + 1] = rgb(GOLD_L); px[x0 + i * 4 + q, 7 + r] = rgb(INK)
    out = im.copy(); op = out.load()
    for y in range(N):
        for x in range(N):
            if px[x, y][3] == 0 and any(0 <= x + dx < N and 0 <= y + dy < N and px[x + dx, y + dy][3] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))): op[x, y] = rgb(INK)
    return out


def main():
    os.makedirs(OUT, exist_ok=True); im = coin()
    for size in (20, 40, 80, 160):
        im.resize((size, size), Image.NEAREST).save(os.path.join(OUT, 'points_icon_%d.png' % size))
    sheet = Image.new('RGB', (360, 200), '#222A2A'); x = 20
    for size in (160, 80, 40, 20):
        t = im.resize((size, size), Image.NEAREST); sheet.paste(t, (x, 20 + (160 - size) // 2), t); x += size + 12
    sheet.save(os.path.join(OUT, 'points_icon_preview.png')); print('wrote', os.path.abspath(OUT))


if __name__ == '__main__':
    main()
