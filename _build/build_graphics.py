"""Generates all static graphics, sounds and the stinger for the ItMeCasey OBS pack.
Run: python build_graphics.py   (needs Pillow, numpy, ffmpeg on PATH)"""
import math, shutil, subprocess, tempfile, wave
from pathlib import Path
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

PACK = Path(__file__).resolve().parent.parent
SRC = PACK.parent
A, TW, SND, TR = PACK / "assets", PACK / "twitch", PACK / "sounds", PACK / "transitions"

IRON, AQUA, RUST, HEAT, CREAM, DRUST = "#222A2A", "#4FBBBC", "#EC4624", "#F39120", "#E2DAC2", "#B13A22"
DARK = "#1A2020"
SLANT = 250 / 1080  # matches background.png edge slope

# geometry shared with build_collection.py
G = {
    "game": (0, 0, 1920, 1016),
    "cam_game": (1496, 767, 400, 225),
    "cam_chat": (40, 70, 1200, 675),
    "chat_panel": (1280, 40, 600, 936),
    "chat_box": (1296, 112, 568, 852),
    "cam_full": (40, 70, 1840, 906),
}

FONT = "C:/Windows/Fonts/bahnschrift.ttf"


def F(size, w=700, wd=100):
    f = ImageFont.truetype(FONT, size)
    f.set_variation_by_axes([w, wd])
    return f


def fit(text, maxw, size, w=700, wd=100):
    while size > 10:
        f = F(size, w, wd)
        if f.getlength(text) <= maxw:
            return f
        size -= 2
    return F(10, w, wd)


def spaced(d, xy, text, font, fill, sp=0):
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=font, fill=fill)
        x += font.getlength(ch) + sp
    return x


def spaced_w(text, font, sp):
    return sum(font.getlength(c) + sp for c in text) - sp


def logo(size):
    return Image.open(SRC / "ItMeCasey-Logo-1100px.png").convert("RGBA").resize((size, size), Image.LANCZOS)


def paste_shadow(img, lg, xy, blur=18, off=(0, 10), alpha=150):
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    a = lg.split()[3].point(lambda v: v * alpha // 255)
    s = Image.new("RGBA", lg.size, (0, 0, 0, 255))
    s.putalpha(a)
    sh.paste(s, (xy[0] + off[0], xy[1] + off[1]), s)
    img.alpha_composite(sh.filter(ImageFilter.GaussianBlur(blur)))
    img.alpha_composite(lg, xy)


def palette_strip(d, x, y, w, h, skew=0):
    segs = [(AQUA, .30), (HEAT, .25), (RUST, .20), (DRUST, .15), (CREAM, .10)]
    cx = x
    for i, (c, f) in enumerate(segs):
        sw = round(w * f) if i < 4 else x + w - cx
        d.rectangle([cx, y, cx + sw, y + h], fill=c)
        cx += sw


def para(d, x_top, y0, y1, w, fill):
    """slanted band: left edge x_top at y0 leaning '/' like the background."""
    d.polygon([(x_top, y0), (x_top + w, y0), (x_top + w - SLANT * (y1 - y0), y1),
               (x_top - SLANT * (y1 - y0), y1)], fill=fill)


def noise_bg(w=1920, h=1080):
    rng = np.random.default_rng(7)
    base = np.array(Image.new("RGB", (w, h), IRON), dtype=np.int16)
    n = rng.normal(0, 2.2, (h, w, 1)).astype(np.int16)
    img = Image.fromarray(np.clip(base + n, 0, 255).astype(np.uint8))
    return img.convert("RGBA")


def three_bands(w, h, e1, e2, S=2):
    """Iron | Rust | Heat diagonal bands. e1/e2 = x of the iron/rust and rust/heat edges at the TOP of the image.
    Every edge uses the same slope (SLANT) and every upper band casts the identical soft shadow onto the band beside it."""
    W, H = w * S, h * S
    def left_of(xt):  # mask of everything left of a slanted edge
        m = Image.new("L", (W, H), 0)
        ImageDraw.Draw(m).polygon([(-4000, 0), (xt * S, 0), ((xt - SLANT * h) * S, H), (-4000, H)], fill=255)
        return m
    def cast(edge_mask, clip_to):  # soft shadow thrown to the right (light from upper-left), kept off the caster itself
        sh = edge_mask.transform((W, H), Image.AFFINE, (1, 0, -18 * S, 0, 1, -4 * S)).filter(ImageFilter.GaussianBlur(11 * S))
        sh = sh.point(lambda v: v * 135 // 255)
        a = ImageChops.multiply(sh, clip_to)
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 255)); layer.putalpha(a)
        return layer
    inv = lambda m: ImageChops.invert(m)
    iron_m, rust_m = left_of(e1), left_of(e2)          # iron = left of e1; rust+iron = left of e2
    img = Image.new("RGBA", (W, H), HEAT)
    img.alpha_composite(cast(rust_m, inv(rust_m)))      # rust -> heat
    img.paste(Image.new("RGBA", (W, H), RUST), mask=rust_m)
    img.alpha_composite(cast(iron_m, inv(iron_m)))      # iron -> rust
    img.paste(Image.new("RGBA", (W, H), IRON), mask=iron_m)
    return img.resize((w, h), Image.LANCZOS)


def background():
    three_bands(1920, 1080, 1370, 1670).convert("RGB").save(A / "background.png")


# ---------------------------------------------------------------- scene backgrounds
def scene_bg(lines, tag, sub, name, colors=(CREAM, HEAT, AQUA)):
    img = Image.open(A / "background.png").convert("RGBA")
    d = ImageDraw.Draw(img)
    lg = logo(470)
    paste_shadow(img, lg, (100, 275))
    x = 640
    f = F(34, 700, 85)
    spaced(d, (x, 214), tag, f, AQUA, 8)
    palette_strip(d, x, 262, 220, 8)
    y = 296
    for i, ln in enumerate(lines):
        font = fit(ln, 590, 150, 700, 78)
        d.text((x - 4, y), ln, font=font, fill=colors[i % len(colors)])
        y += font.size * 0.98
    if sub:
        spaced(d, (x, int(y) + 22), sub, F(30, 600, 85), CREAM, 5)
    img.convert("RGB").save(A / name)


def iron_bg():
    img = noise_bg()
    d = ImageDraw.Draw(img)
    # faint concentric arcs echo the logo
    ring = Image.new("RGBA", img.size, (0, 0, 0, 0))
    rd = ImageDraw.Draw(ring)
    cx, cy = 1500, 1380
    for i, c in enumerate([AQUA, HEAT, RUST, DRUST, CREAM]):
        r = 1180 - i * 70
        rd.ellipse([cx - r, cy - r, cx + r, cy + r], outline=c, width=26)
    ring.putalpha(ring.split()[3].point(lambda v: v * 22 // 255))
    img.alpha_composite(ring)
    img.convert("RGB").save(A / "bg_iron.png")


def bar(d, img):
    d.rectangle([0, 1016, 1920, 1080], fill=DARK)
    palette_strip(d, 0, 1010, 1920, 6)
    lg = logo(46)
    img.alpha_composite(lg, (24, 1025))
    spaced(d, (86, 1030), "ITMECASEY", F(30, 700, 85), CREAM, 6)
    t = "TWITCH.TV/ITMECASEY"
    f = F(26, 600, 85)
    spaced(d, (1896 - spaced_w(t, f, 5), 1033), t, f, AQUA, 5)


def frame(d, rect, label=None, b=8):
    x, y, w, h = rect
    d.rectangle([x - b, y - b, x + w + b, y + h + b], outline=RUST, width=b)
    d.rectangle([x - b - 4, y - b - 4, x + w + b + 4, y + h + b + 4], outline=DARK, width=4)
    # corner tabs
    for cx, cy in [(x - b, y - b), (x + w + b - 44, y - b), (x - b, y + h + b - 8), (x + w + b - 44, y + h + b - 8)]:
        d.rectangle([cx, cy, cx + 44, cy + 8], fill=HEAT)
    if label:
        f = F(24, 700, 85)
        tw = spaced_w(label, f, 4)
        d.polygon([(x - b, y - b - 38), (x - b + tw + 44, y - b - 38), (x - b + tw + 28, y - b), (x - b, y - b)], fill=HEAT)
        spaced(d, (x - b + 14, y - b - 34), label, f, IRON, 4)


def overlays():
    # gameplay
    img = Image.new("RGBA", (1920, 1080), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    bar(d, img)
    frame(d, G["cam_game"], "CASEY")
    img.save(A / "overlay_gameplay.png")

    # just chatting
    img = Image.new("RGBA", (1920, 1080), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    bar(d, img)
    frame(d, G["cam_chat"], "CASEY")
    x, y, w, h = G["chat_panel"]
    d.rectangle([x, y, x + w, y + h], fill=(26, 32, 32, 235))
    d.rectangle([x, y, x + w, y + 56], fill=RUST)
    spaced(d, (x + 22, y + 9), "LIVE CHAT", F(32, 700, 85), CREAM, 7)
    palette_strip(d, x, y + 56, w, 6)
    d.rectangle([x, y, x + w, y + h], outline=DARK, width=3)
    # lower-left info strip under the cam
    lg = logo(190)
    paste_shadow(img, lg, (60, 785), 12, (0, 8), 120)
    spaced(d, (290, 805), "JUST CHATTING", F(78, 700, 80), CREAM, 4)
    spaced(d, (292, 895), "PULL UP A CHAIR  //  SAY HI IN CHAT", F(30, 600, 85), AQUA, 5)
    palette_strip(d, 292, 945, 360, 10)
    img.save(A / "overlay_justchatting.png")

    # full cam
    img = Image.new("RGBA", (1920, 1080), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    bar(d, img)
    frame(d, G["cam_full"], "CASEY", 10)
    img.save(A / "overlay_fullcam.png")


# ---------------------------------------------------------------- twitch kit
def banner():
    img = three_bands(1200, 480, 940, 1090).convert("RGBA")
    d = ImageDraw.Draw(img)
    lg = logo(330)
    paste_shadow(img, lg, (70, 75))
    f = fit("ITMECASEY", 400, 120, 700, 80)
    d.text((430, 130), "ITMECASEY", font=f, fill=CREAM)
    spaced(d, (434, 262), "GAMES  //  GOOD VIBES  //  CHAOS", F(22, 600, 85), AQUA, 4)
    palette_strip(d, 434, 305, 300, 8)
    img.convert("RGB").save(TW / "profile_banner_1200x480.png")


def panels():
    names = ["ABOUT", "SCHEDULE", "RULES", "COMMANDS", "SOCIALS", "SUPPORT", "GEAR", "FAQ"]
    for n in names:
        img = noise_bg(640, 140)
        d = ImageDraw.Draw(img)
        para(d, 590, 0, 140, 34, RUST)
        para(d, 640, 0, 140, 60, HEAT)
        img.alpha_composite(logo(88), (26, 26))
        spaced(d, (140, 28), n, fit(n, 400, 76, 700, 80), CREAM, 6)
        palette_strip(d, 142, 112, 200, 7)
        img.convert("RGB").save(TW / f"panel_{n.lower()}_640x140.png")


# ---------------------------------------------------------------- audio
SR = 44100


def wav(path, data, vol=0.8):
    data = np.clip(data / max(1e-9, np.abs(data).max()) * vol, -1, 1)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((data * 32767).astype("<i2").tobytes())


def note(f, dur, at, total, kind="bell"):
    t = np.arange(int(SR * total)) / SR
    out = np.zeros_like(t)
    m = t >= at
    tt = t[m] - at
    env = np.exp(-tt * (4.5 if kind == "bell" else 2.2)) * np.minimum(1, tt * 400)
    if kind == "bell":
        s = np.sin(2 * np.pi * f * tt) + .4 * np.sin(2 * np.pi * f * 2.01 * tt) + .15 * np.sin(2 * np.pi * f * 3.02 * tt)
    else:  # brass-ish
        s = sum(np.sin(2 * np.pi * f * k * tt) / k for k in range(1, 7))
    out[m] = s * env
    return out


def sounds():
    SND.mkdir(exist_ok=True)
    n = {"C5": 523.25, "E5": 659.25, "G5": 783.99, "C6": 1046.5, "A4": 440, "D5": 587.33, "G4": 392, "E6": 1318.5}
    T = 1.8
    wav(SND / "alert_follow.wav", sum(note(n[k], .5, i * .12, T) for i, k in enumerate(["C5", "E5", "G5", "C6"])))
    wav(SND / "alert_sub.wav", sum(note(n[k], .9, i * .14, 2.4, "brass") for i, k in enumerate(["G4", "C5", "E5", "G5"])) +
        sum(note(n[k], .9, .6, 2.4, "bell") for k in ["C5", "E5", "G5", "C6"]))
    wav(SND / "alert_bits.wav", sum(note(n["E6"] * (1 if i % 2 == 0 else 1.5), .2, i * .07, 1.4) for i in range(7)))
    wav(SND / "alert_tip.wav", sum(note(n[k], .4, i * .09, 1.8) for i, k in enumerate(["D5", "G5", "D5", "G5", "C6"])))
    # raid: rising horn sweep + hit
    t = np.arange(int(SR * 2.4)) / SR
    f = 120 + 260 * np.clip(t / 1.2, 0, 1) ** 1.5
    ph = 2 * np.pi * np.cumsum(f) / SR
    horn = sum(np.sin(ph * k) / k for k in range(1, 6)) * np.minimum(1, t * 8) * np.where(t < 1.3, 1, np.exp(-(t - 1.3) * 4))
    wav(SND / "alert_raid.wav", horn + note(98, 1, 1.25, 2.4, "brass") * 1.3)


def whoosh_audio(path, total):
    rng = np.random.default_rng(3)
    n = int(SR * total)
    t = np.arange(n) / SR
    noise = rng.normal(0, 1, n)
    out = np.zeros(n)
    y = 0.0
    for i in range(n):  # time-varying one-pole lowpass
        a = 0.03 + 0.5 * (math.exp(-((t[i] - .45) ** 2) / .02) + math.exp(-((t[i] - 1.3) ** 2) / .03))
        y += a * (noise[i] - y)
        out[i] = y
    env = np.exp(-((t - .45) ** 2) / .04) * .9 + np.exp(-((t - 1.3) ** 2) / .06) * .7
    thump = np.sin(2 * np.pi * 60 * t) * np.exp(-np.clip(t - .88, 0, None) * 14) * (t > .88)
    wav(path, out * env + thump * .6, 0.85)


# ---------------------------------------------------------------- stinger
def ease(x):
    x = min(1, max(0, x))
    return 4 * x ** 3 if x < .5 else 1 - (-2 * x + 2) ** 3 / 2


def stinger(fps=30, n=54):
    layers = [AQUA, HEAT, RUST, DRUST, IRON]
    lg = Image.open(SRC / "ItMeCasey-Logo-1100px.png").convert("RGBA")
    f_name = F(54, 700, 80)
    tmp = Path(tempfile.mkdtemp(prefix="stinger_"))
    X0, X1 = -420, 2380
    for i in range(n):
        p = i / (n - 1)
        S = 2
        im = Image.new("RGBA", (1920 * S, 1080 * S), (0, 0, 0, 0))
        d = ImageDraw.Draw(im)
        for k, c in enumerate(layers):
            front = X0 + (X1 - X0) * ease((p - .04 * k) / .30)
            back = X0 + (X1 - X0) * ease((p - (.56 + .04 * (4 - k))) / .28)
            if front <= back:
                continue
            h = 1080
            pts = [(front + 125, 0), (front - 125, h), (back - 125, h), (back + 125, 0)]
            d.polygon([(x * S, y * S) for x, y in pts], fill=c)
        im = im.resize((1920, 1080), Image.LANCZOS)
        la = ease((p - .36) / .08) * (1 - ease((p - .58) / .06))
        if la > 0:
            sc = 0.7 + 0.3 * ease((p - .36) / .12)
            size = int(520 * sc)
            l2 = lg.resize((size, size), Image.LANCZOS)
            l2.putalpha(l2.split()[3].point(lambda v: int(v * la)))
            im.alpha_composite(l2, (960 - size // 2, 470 - size // 2))
            d2 = ImageDraw.Draw(im)
            t = "ITMECASEY"
            tw = spaced_w(t, f_name, 14)
            col = tuple(int(CREAM[j:j + 2], 16) for j in (1, 3, 5)) + (int(255 * la),)
            spaced(d2, (960 - tw / 2, 770), t, f_name, col, 14)
        im.save(tmp / f"f{i:03d}.png")
    wh = tmp / "whoosh.wav"
    whoosh_audio(wh, n / fps)
    TR.mkdir(exist_ok=True)
    common = ["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps), "-i", str(tmp / "f%03d.png"), "-i", str(wh)]
    subprocess.run(common + ["-c:v", "qtrle", "-pix_fmt", "argb", "-c:a", "pcm_s16le", str(TR / "stinger.mov")], check=True)
    subprocess.run(common + ["-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "28",
                             "-auto-alt-ref", "0", "-c:a", "libopus", str(TR / "stinger.webm")], check=True)
    shutil.rmtree(tmp, ignore_errors=True)


def main():
    for p in (A, TW):
        p.mkdir(exist_ok=True)
    background()
    shutil.copy(SRC / "ItMeCasey-Logo-1100px.png", A / "logo.png")
    shutil.copy(SRC / "ItMeCasey-LogoBG-1100px.png", A / "logo_bg.png")
    scene_bg(["STREAM", "STARTING", "SOON"], "ITMECASEY  //  LIVE", "GRAB A SNACK. GET COMFY.", "scene_starting.png")
    scene_bg(["BE RIGHT", "BACK"], "ITMECASEY  //  INTERMISSION", "STRETCH  //  HYDRATE  //  CHAT AMONGST YOURSELVES", "scene_brb.png", (CREAM, HEAT))
    scene_bg(["THANKS FOR", "WATCHING"], "ITMECASEY  //  STREAM ENDED", "FOLLOW  //  SEE YOU NEXT TIME", "scene_ending.png", (CREAM, HEAT))
    scene_bg(["STREAM", "OFFLINE"], "ITMECASEY", "FOLLOW TO GET NOTIFIED WHEN I GO LIVE", "twitch_offline_1920x1080.png", (CREAM, HEAT))
    # fix: offline file belongs in twitch kit
    shutil.move(str(A / "twitch_offline_1920x1080.png"), str(TW / "offline_screen_1920x1080.png"))
    iron_bg(); overlays(); banner(); panels()
    Image.open(SRC / "ItMeCasey-LogoBG-1100px.png").convert("RGB").resize((800, 800), Image.LANCZOS).save(TW / "profile_picture_800x800.png")
    sounds(); stinger()
    print("done")


if __name__ == "__main__":
    main()
