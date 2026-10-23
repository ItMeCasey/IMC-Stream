"""The 20 sound effects viewers can put inside a text-to-speech message ([airhorn], [ding]...). They are made here from scratch (sine, square and saw waves and
noise: an 8-bit arcade sound that matches the pixel art), so there is nothing to license. 24 kHz, mono, 16 bit WAV files in sounds/tts/.
Run:  python _build/make_tts_sfx.py   (needs numpy)"""
import os
import wave
import numpy as np

OUT = os.path.join(os.path.dirname(__file__), '..', 'sounds', 'tts')
SR = 24000
rng = np.random.default_rng(7)


def t_(d): return np.arange(int(SR * d)) / SR
def env_exp(d, k): return np.exp(-k * t_(d))
def env_adsr(d, a=0.01, r=0.05):
    n = int(SR * d); e = np.ones(n); na = max(1, int(SR * a)); nr = max(1, int(SR * r)); e[:na] = np.linspace(0, 1, na); e[-nr:] = np.minimum(e[-nr:], np.linspace(1, 0, nr)); return e
def sine(f, d): return np.sin(2 * np.pi * np.cumsum(np.full(int(SR * d), f) if np.isscalar(f) else f) / SR)
def sweep(f0, f1, d, curve=1.0):
    x = t_(d) / d; f = f0 + (f1 - f0) * x ** curve; return f
def wave_of(kind, f, d):
    ph = np.cumsum(np.full(int(SR * d), f) if np.isscalar(f) else f) / SR
    if kind == 'sine': return np.sin(2 * np.pi * ph)
    if kind == 'square': return np.sign(np.sin(2 * np.pi * ph))
    if kind == 'saw': return 2 * (ph % 1) - 1
    if kind == 'tri': return 2 * np.abs(2 * (ph % 1) - 1) - 1
def noise(d): return rng.uniform(-1, 1, int(SR * d))
def lowpass(x, cutoff):
    cutoff = np.full(len(x), cutoff) if np.isscalar(cutoff) else cutoff; a = 1 - np.exp(-2 * np.pi * cutoff / SR); y = np.zeros(len(x)); s = 0.0
    for i in range(len(x)): s += a[i] * (x[i] - s); y[i] = s
    return y
def place(canvas, x, at):
    i = int(SR * at); n = min(len(x), len(canvas) - i)
    if n > 0: canvas[i:i + n] += x[:n]
def blank(d): return np.zeros(int(SR * d))
NOTE = lambda n: 440 * 2 ** ((n - 69) / 12)   # MIDI note number -> Hz


def ding():
    d = 1.0; return (sine(1318, d) + 0.35 * sine(2637, d) + 0.15 * sine(3951, d)) * env_exp(d, 4.5)
def bell():
    d = 1.6; m = sine(880 * 3.5, d) * 5 * env_exp(d, 3); return np.sin(2 * np.pi * np.cumsum(880 + m * 880 * 0.6) / SR) * env_exp(d, 2.5)
def airhorn():
    d = 1.2; c = blank(d)
    for at, dur in [(0.0, 0.18), (0.22, 0.18), (0.44, 0.75)]:
        v = 1 + 0.01 * np.sin(2 * np.pi * 6 * t_(dur)); h = sum(wave_of('saw', f * v, dur) for f in (349, 440, 523, 698)) / 4; h = lowpass(h, 2600) * env_adsr(dur, 0.01, 0.06); place(c, h, at)
    return c
def rimshot():
    c = blank(1.2)
    tom = wave_of('sine', sweep(260, 110, 0.18), 0.18) * env_exp(0.18, 14); place(c, tom, 0.0)
    sn = (lowpass(noise(0.2), 7000) * env_exp(0.2, 22) + 0.5 * wave_of('sine', 190, 0.2) * env_exp(0.2, 30)); place(c, sn, 0.2)
    cym = (noise(0.8) - lowpass(noise(0.8), 3000)) * env_exp(0.8, 5); place(c, cym * 0.8, 0.55); return c
def trombone():
    d = 2.2; c = blank(d)
    for i, (f, dur, at) in enumerate([(233, 0.4, 0.0), (220, 0.4, 0.5), (208, 0.4, 1.0), (196, 0.9, 1.5)]):
        fr = np.full(int(SR * dur), float(f)) * (1 + 0.02 * np.sin(2 * np.pi * 5.5 * t_(dur)))
        if i == 3: fr = fr * np.linspace(1, 0.82, len(fr))
        n = lowpass(wave_of('saw', fr, dur), 900 + 500 * (i == 3)) * env_adsr(dur, 0.03, 0.12); place(c, n, at)
    return c
def boing():
    d = 0.9; f = 330 + 260 * np.sin(2 * np.pi * 9 * t_(d) * (1 - 0.5 * t_(d) / d)) * np.exp(-3 * t_(d)); f = f * np.linspace(1.0, 0.7, len(f)); return wave_of('sine', f, d) * env_exp(d, 3.2)
def whoosh():
    d = 1.0; x = t_(d) / d; cut = 300 + 3500 * np.sin(np.pi * x) ** 2; return lowpass(noise(d), cut) * np.sin(np.pi * x) ** 1.5 * 2.2
def laser():
    d = 0.4; return wave_of('square', sweep(2000, 150, d, 0.6), d) * env_exp(d, 4) * 0.7
def coin():
    c = blank(0.6); place(c, wave_of('square', 988, 0.07) * env_adsr(0.07, 0.002, 0.01), 0.0); place(c, wave_of('square', 1319, 0.45) * env_exp(0.45, 7), 0.07); return c * 0.6
def powerup():
    c = blank(0.9)
    for i, n in enumerate([60, 64, 67, 72, 76, 79, 84]): place(c, wave_of('square', NOTE(n), 0.1) * env_adsr(0.1, 0.003, 0.02), i * 0.07)
    place(c, wave_of('square', NOTE(84), 0.35) * env_exp(0.35, 6), 0.49); return c * 0.5
def powerdown():
    c = blank(1.0)
    for i, n in enumerate([84, 79, 76, 72, 67, 64, 60, 55]): place(c, wave_of('square', NOTE(n), 0.14) * env_adsr(0.14, 0.003, 0.03), i * 0.09)
    return c * 0.5
def boom():
    d = 1.5; n = lowpass(noise(d), sweep(2500, 120, d, 0.4)) * env_exp(d, 3.2) * 3; s = wave_of('sine', sweep(90, 28, d, 0.5), d) * env_exp(d, 2.2); return n + s * 1.5
def drumroll():
    d = 1.8; c = blank(d); n = int(d / 0.035)
    for i in range(n):
        a = 0.25 + 0.75 * (i / n); h = lowpass(noise(0.05), 6000) * env_exp(0.05, 45) * a; place(c, h, i * 0.035)
    cym = (noise(0.6) - lowpass(noise(0.6), 3000)) * env_exp(0.6, 6); c2 = np.concatenate([c, blank(0.6)]); place(c2, cym * 0.8, d); return c2
def tada():
    c = blank(1.7)
    for at, notes, dur in [(0.0, [67], 0.12), (0.14, [72], 0.12), (0.28, [76], 0.12)]:
        for nn in notes: place(c, lowpass(wave_of('saw', NOTE(nn), dur), 3000) * env_adsr(dur, 0.005, 0.02) * 0.5, at)
    ch = sum(lowpass(wave_of('saw', NOTE(nn), 1.2), 2400) for nn in (72, 76, 79, 84)) / 4 * env_adsr(1.2, 0.02, 0.5) * env_exp(1.2, 1.3); place(c, ch * 1.2, 0.45); return c
def buzzer():
    d = 0.7; return (wave_of('square', 150, d) + wave_of('square', 156, d)) * env_adsr(d, 0.005, 0.05) * 0.4
def crickets():
    c = blank(2.4)
    for at in (0.1, 0.9, 1.7):
        for k in range(3):
            d = 0.07; x = wave_of('sine', 4300, d) * env_adsr(d, 0.01, 0.02) * (1 + 0.4 * np.sin(2 * np.pi * 90 * t_(d))); place(c, x * 0.4, at + k * 0.11)
    return c
def applause():
    d = 2.8; c = blank(d); n = 520
    for i in range(n):
        at = rng.uniform(0, d - 0.1); dens = np.sin(np.pi * at / d) ** 0.6; amp = rng.uniform(0.2, 1.0) * dens
        if rng.uniform() < dens: place(c, lowpass(noise(0.05), rng.uniform(2500, 6000)) * env_exp(0.05, 70) * amp, at)
    return c * 1.8
def pop():
    d = 0.15; return wave_of('sine', sweep(900, 180, d), d) * env_exp(d, 26) + 0.3 * noise(d) * env_exp(d, 90)
def siren():
    d = 1.6; f = 800 + 250 * np.sin(2 * np.pi * 1.25 * t_(d)); return wave_of('tri', f, d) * env_adsr(d, 0.03, 0.15) * 0.6
def sparkle():
    c = blank(1.1)
    for i, n in enumerate([84, 88, 91, 95, 100, 96, 103, 107]): place(c, (wave_of('sine', NOTE(n), 0.35) + 0.3 * wave_of('sine', NOTE(n) * 2, 0.35)) * env_exp(0.35, 9), i * 0.075)
    return c * 0.5


EFFECTS = [('ding', 'a bright ding', ding), ('bell', 'a ringing bell', bell), ('airhorn', 'da-da-DAAA airhorn', airhorn), ('rimshot', 'ba-dum-tss', rimshot), ('trombone', 'sad trombone', trombone),
           ('boing', 'a springy boing', boing), ('whoosh', 'a whoosh', whoosh), ('laser', 'a laser zap', laser), ('coin', 'an arcade coin', coin), ('powerup', 'a power-up jingle', powerup),
           ('powerdown', 'a power-down', powerdown), ('boom', 'an explosion', boom), ('drumroll', 'a drum roll with a cymbal', drumroll), ('tada', 'ta-da fanfare', tada), ('buzzer', 'a wrong-answer buzzer', buzzer),
           ('crickets', 'awkward crickets', crickets), ('applause', 'applause', applause), ('pop', 'a pop', pop), ('siren', 'a siren', siren), ('sparkle', 'a sparkle', sparkle)]


def save(name, x, peak=0.8):
    x = x / (np.max(np.abs(x)) or 1) * peak; x = np.concatenate([x, np.zeros(int(SR * 0.05))])   # a little silence at the end
    x[:48] *= np.linspace(0, 1, 48)                                                              # no click at the start
    data = (np.clip(x, -1, 1) * 32767).astype('<i2').tobytes()
    with wave.open(os.path.join(OUT, name + '.wav'), 'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(data)
    return len(x) / SR


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, desc, fn in EFFECTS:
        print('%-10s %.2fs  %s' % (name, save(name, fn()), desc))


if __name__ == '__main__':
    main()
