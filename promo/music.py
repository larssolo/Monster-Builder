"""Monster Builder promo — score + sound design, synthesized from scratch.

70 BPM in D minor, on the same beat grid as film.js (beat b -> b * 60/70 s).
Heartbeat pulse ("lub-dub") is the backbone: the monster comes alive at 70 BPM.

    python3 music.py out.wav
"""
import sys
import numpy as np
from scipy import signal

SR = 48000
BPM = 70
BEAT = 60 / BPM
FPS = 30
FRAMES = int(48 * BEAT * FPS)           # same as film.js
DUR = FRAMES / FPS
N = int(round(DUR * SR))
rng = np.random.default_rng(7)


def s(b):
    return b * BEAT


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def tt(dur):
    return np.arange(int(dur * SR)) / SR


# ------------------------------------------------------------------ buses
BUS = {k: np.zeros((N, 2)) for k in ["drums", "bass", "pad", "arp", "bell", "fx", "vox", "special"]}
HALL = np.zeros((N, 2))      # big reverb send
ROOM = np.zeros((N, 2))      # short reverb send
SPECIAL_HALL = np.zeros((N, 2))
KICKS = []                   # sidechain trigger times


def place(buf, sig, t0, gain=1.0, pan=0.0):
    if sig.ndim == 1:
        a = (pan + 1) * np.pi / 4
        sig = np.stack([sig * np.cos(a), sig * np.sin(a)], axis=1) * np.sqrt(2)
    i0 = int(round(t0 * SR))
    if i0 >= N:
        return
    j0 = max(0, -i0)
    i0c = max(0, i0)
    n = min(len(sig) - j0, N - i0c)
    if n > 0:
        buf[i0c:i0c + n] += sig[j0:j0 + n] * gain


def add(bus, sig, t0, gain=1.0, pan=0.0, hall=0.0, room=0.0):
    place(BUS[bus], sig, t0, gain, pan)
    if hall:
        place(SPECIAL_HALL if bus == "special" else HALL, sig, t0, gain * hall, pan)
    if room:
        place(ROOM, sig, t0, gain * room, pan)


def lp(x, fc, order=2):
    b, a = signal.butter(order, min(fc, SR * 0.45) / (SR / 2), "low")
    return signal.lfilter(b, a, x, axis=0)


def hp(x, fc, order=2):
    b, a = signal.butter(order, fc / (SR / 2), "high")
    return signal.lfilter(b, a, x, axis=0)


def bp(x, lo, hi, order=2):
    b, a = signal.butter(order, [lo / (SR / 2), min(hi, SR * 0.45) / (SR / 2)], "band")
    return signal.lfilter(b, a, x, axis=0)


def adsr(n, a=0.005, d=0.1, sus=0.0, r=0.05, sustain_time=0.0):
    t = np.arange(n) / SR
    env = np.zeros(n)
    env = np.where(t < a, t / max(a, 1e-6), env)
    dd = (t >= a) & (t < a + d)
    env = np.where(dd, 1 - (1 - sus) * (t - a) / max(d, 1e-6), env)
    st = (t >= a + d) & (t < a + d + sustain_time)
    env = np.where(st, sus, env)
    rr = t >= a + d + sustain_time
    env = np.where(rr, sus * np.exp(-(t - a - d - sustain_time) / max(r, 1e-6)), env)
    return env


def noise(n):
    return rng.standard_normal(n)


def saw(phase):
    """Band-limited (polyBLEP) sawtooth from an unwrapped phase in radians."""
    phase = np.asarray(phase, dtype=float)
    p = (phase / (2 * np.pi)) % 1.0
    dt = np.abs(np.gradient(phase)) / (2 * np.pi) if phase.size > 1 else np.full(1, 1e-3)
    dt = np.clip(dt, 1e-6, 0.5)
    y = 2 * p - 1
    lo = p < dt
    x = p[lo] / dt[lo]
    y[lo] -= x + x - x * x - 1
    hi = p > 1 - dt
    x = (p[hi] - 1) / dt[hi]
    y[hi] -= x * x + x + x + 1
    return y


# ------------------------------------------------------------------ instruments
def heartbeat(soft=1.0):
    def thump(f0, f1, dur, amp):
        t = tt(dur)
        f = f1 + (f0 - f1) * np.exp(-t / 0.035)
        ph = 2 * np.pi * np.cumsum(f) / SR
        body = np.sin(ph) * np.exp(-t / 0.11) * (1 - np.exp(-t / 0.002))
        click = lp(noise(len(t)), 900) * np.exp(-t / 0.006) * 0.25
        return (body + click) * amp
    lub = thump(105, 48, 0.42, 1.0)
    dub = thump(88, 44, 0.36, 0.6)
    out = np.zeros(int(0.8 * SR))
    out[:len(lub)] += lub
    o = int(s(0.25) * SR)
    out[o:o + len(dub)] += dub
    out = lp(out, 260)
    # a touch of saturation so it reads on phone speakers
    return np.tanh(out * 1.6 * soft) / 1.2


def kick(punch=1.0):
    t = tt(0.6)
    f = 44 + 120 * np.exp(-t / 0.04)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.22)
    click = hp(noise(len(t)), 2500) * np.exp(-t / 0.004) * 0.25 * punch
    return np.tanh((body + click) * 1.8) * 0.8


def snare():
    t = tt(0.5)
    n = bp(noise(len(t)), 1200, 7000) * np.exp(-t / 0.13)
    tone = np.sin(2 * np.pi * 185 * t) * np.exp(-t / 0.07) * 0.6
    clap = np.zeros(len(t))
    for k, d in enumerate([0, 0.011, 0.023]):
        i = int(d * SR)
        clap[i:] += bp(noise(len(t) - i), 900, 3500) * np.exp(-np.arange(len(t) - i) / SR / (0.009 if k < 2 else 0.09))
    return (n * 0.7 + tone + clap * 0.6) * 0.55


def hat(open_=False):
    t = tt(0.35 if open_ else 0.08)
    return hp(noise(len(t)), 7000) * np.exp(-t / (0.12 if open_ else 0.022)) * 0.3


def shaker():
    t = tt(0.12)
    env = (1 - np.exp(-t / 0.012)) * np.exp(-t / 0.045)
    return bp(noise(len(t)), 4500, 11000) * env * 0.25


def taiko():
    t = tt(1.2)
    f = 62 + 70 * np.exp(-t / 0.05)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.42)
    skin = lp(noise(len(t)), 1800) * np.exp(-t / 0.05) * 0.5
    return np.tanh((body + skin) * 2.0) * 0.8


def impact(size=1.0):
    t = tt(3.5)
    f = 28 + 60 * np.exp(-t / 0.25)
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / (0.9 * size))
    crack = lp(noise(len(t)), 3000) * np.exp(-t / 0.08)
    air = hp(noise(len(t)), 5000) * np.exp(-t / 0.9) * 0.18
    return np.tanh((sub * 1.2 + crack * 0.6 + air) * 1.5) * 0.8


def bell(m, dur=3.0, bright=1.0):
    t = tt(dur)
    f = mtof(m)
    idx = 2.2 * bright * np.exp(-t * 3.0)
    mod = np.sin(2 * np.pi * f * 3.5 * t) * idx
    car = np.sin(2 * np.pi * f * t + mod)
    shimmer = np.sin(2 * np.pi * f * 2.001 * t) * 0.25 * np.exp(-t * 2.0)
    env = (1 - np.exp(-t / 0.002)) * np.exp(-t * 1.3)
    return (car + shimmer) * env * 0.35


def pluck(m, dur=0.9, tone=1.0):
    t = tt(dur)
    f = mtof(m)
    x = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 10) * tone \
        + 0.15 * saw(2 * np.pi * f * t) * np.exp(-t * 18) * tone
    env = (1 - np.exp(-t / 0.003)) * np.exp(-t * 5.5)
    return lp(x * env, 4200) * 0.3


def blip(f, dur=0.05):
    t = tt(dur)
    return np.sin(2 * np.pi * f * t) * (1 - np.exp(-t / 0.001)) * np.exp(-t / (dur / 4)) * 0.25


def whoosh(dur=0.6, f0=300, f1=4000, peak=0.5, reverse=False):
    t = tt(dur)
    n = noise(len(t))
    out = np.zeros(len(t))
    # sweep a band-pass in 24 chunks
    k = 24
    edges = np.linspace(0, len(t), k + 1).astype(int)
    for i in range(k):
        u = (i + 0.5) / k
        fc = f0 * (f1 / f0) ** u
        seg_ = bp(n[max(0, edges[i] - 2000):edges[i + 1]], fc * 0.6, fc * 1.6)
        out[edges[i]:edges[i + 1]] = seg_[-(edges[i + 1] - edges[i]):]
    u = t / dur
    env = np.where(u < peak, (u / peak) ** 2, ((1 - u) / (1 - peak)) ** 1.5)
    out = out * env
    return out[::-1] * 0.8 if reverse else out * 0.8


def riser(dur, f0=180, f1=900, kind="saw"):
    t = tt(dur)
    f = f0 * (f1 / f0) ** (t / dur)
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = saw(ph) if kind == "saw" else np.sin(ph)
    x = lp(x, 2500) * (t / dur) ** 1.6
    nz = hp(noise(len(t)), 2000) * (t / dur) ** 2.5 * 0.5
    return (x * 0.5 + nz) * 0.6


def reverse_swell(dur=1.0, m_notes=(50, 57, 62)):
    t = tt(dur)
    x = np.zeros(len(t))
    for m in m_notes:
        x += bell(m, dur, 0.6)[: len(t)]
    x += hp(noise(len(t)), 3000) * 0.15 * np.exp(-t * 2)
    x = x[::-1] * (t / dur) ** 0.5
    return x


def growl(dur, f0, f1, vowel=("a", "o"), rough=0.6, noise_amt=0.35, seed=1):
    r = np.random.default_rng(seed)
    t = tt(dur)
    f = f0 * (f1 / f0) ** (t / dur)
    jit = lp(r.standard_normal(len(t)), 18) * 0.6
    f = f * (1 + 0.035 * np.sin(2 * np.pi * 5.5 * t) + 0.05 * jit)
    ph = 2 * np.pi * np.cumsum(f) / SR
    src = saw(ph) * (1 + rough * 0.7 * np.sin(ph * 0.5)) + noise_amt * r.standard_normal(len(t))
    FORM = {"a": [(720, 1.0), (1150, 0.6), (2500, 0.35)], "o": [(380, 1.0), (850, 0.5), (2300, 0.2)],
            "e": [(500, 1.0), (1900, 0.6), (2600, 0.3)], "i": [(300, 1.0), (2300, 0.5), (3000, 0.3)]}
    def vow(v):
        y = np.zeros(len(t))
        for fc, gn in FORM[v]:
            y += bp(src, fc * 0.82, fc * 1.22) * gn
        return y
    a, b = vow(vowel[0]), vow(vowel[1])
    mix = np.clip(t / dur * 1.4 - 0.2, 0, 1)
    y = a * (1 - mix) + b * mix + lp(src, 300) * 0.4
    env = (1 - np.exp(-t / 0.03)) * np.clip((dur - t) / 0.25, 0, 1) ** 1.5
    y = np.tanh(y * 2.4 * env)
    return y * 0.55


def pop(f0=1100, f1=380):
    t = tt(0.07)
    f = f1 + (f0 - f1) * np.exp(-t / 0.012)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.02) * 0.4


def squelch():
    t = tt(0.7)
    n = noise(len(t))
    out = np.zeros(len(t))
    k = 20
    edges = np.linspace(0, len(t), k + 1).astype(int)
    for i in range(k):
        u = (i + 0.5) / k
        fc = 1800 * (220 / 1800) ** u + 120 * np.sin(u * 30)
        seg_ = bp(n[max(0, edges[i] - 1500):edges[i + 1]], fc * 0.8, fc * 1.25, order=2)
        out[edges[i]:edges[i + 1]] = seg_[-(edges[i + 1] - edges[i]):]
    env = (1 - np.exp(-t / 0.01)) * np.exp(-t / 0.22)
    bub = np.zeros(len(t))
    for j in range(6):
        i0 = int((0.05 + j * 0.07) * SR)
        p = pop(900 + 200 * j, 300)
        bub[i0:i0 + len(p)] += p[: len(t) - i0] * 0.5
    return out * env * 3.0 + bub


def glitch_burst(dur, seed):
    r = np.random.default_rng(seed)
    t = tt(dur)
    out = np.zeros(len(t))
    i = 0
    while i < len(t):
        L = int(r.uniform(0.012, 0.06) * SR)
        kind = r.integers(0, 4)
        tt_ = np.arange(min(L, len(t) - i)) / SR
        if kind == 0:
            seg_ = np.sign(np.sin(2 * np.pi * r.uniform(200, 2400) * tt_))
        elif kind == 1:
            seg_ = hp(r.standard_normal(len(tt_)), 1500)
        elif kind == 2:
            f = r.uniform(80, 400)
            seg_ = saw(2 * np.pi * f * tt_)
        else:
            seg_ = np.zeros(len(tt_))
        q = r.choice([4, 8, 16])
        seg_ = np.round(seg_ * q) / q        # bitcrush
        out[i:i + len(seg_)] = seg_ * r.uniform(0.3, 1.0)
        i += len(seg_)
    return out * 0.35


def typing(n, dur, seed=3):
    r = np.random.default_rng(seed)
    out = np.zeros(int((dur + 0.1) * SR))
    for k in range(n):
        t0 = int((k * dur / n + r.uniform(0, 0.008)) * SR)
        c = hp(r.standard_normal(int(0.012 * SR)), 3000) * np.exp(-np.arange(int(0.012 * SR)) / SR / 0.003)
        c += np.sin(2 * np.pi * r.uniform(1800, 2600) * np.arange(len(c)) / SR) * np.exp(-np.arange(len(c)) / SR / 0.004) * 0.3
        out[t0:t0 + len(c)] += c * 0.3
    return out


# ------------------------------------------------------------------ harmony
CH = {
    "Dm": [50, 57, 62, 65, 69], "Bbmaj7": [46, 53, 57, 62, 65], "Gm9": [55, 58, 62, 69], "Asus": [57, 62, 64, 69],
    "A": [57, 61, 64, 69], "Bb": [53, 58, 62, 65], "F": [53, 57, 60, 65, 69], "C": [55, 60, 64, 67], "Dm9": [50, 57, 62, 64, 65, 69],
}
ROOT = {"Dm": 38, "Bbmaj7": 34, "Gm9": 43, "Asus": 45, "A": 45, "Bb": 46, "F": 41, "C": 36, "Dm9": 38}
TIMELINE = [  # (from beat, to beat, chord, pad brightness)
    (0, 4, "Dm", 0.25), (4, 8, "Bbmaj7", 0.3), (8, 12, "Gm9", 0.45), (12, 14, "Asus", 0.5), (14, 16, "A", 0.6),
    (16, 20, "Bb", 0.7), (20, 22, "A", 0.85),
    (24, 28, "Dm", 0.8), (28, 32, "Bbmaj7", 0.75), (32, 36, "F", 0.8), (36, 40, "C", 0.85),
    (40, 42, "Gm9", 0.55), (42, 43, "A", 0.65), (43, 48, "Dm9", 0.7),
]


def pad_chord(notes, dur, bright, seed):
    r = np.random.default_rng(seed)
    t = tt(dur + 2.5)
    L = np.zeros(len(t)); R = np.zeros(len(t))
    for m in notes:
        f = mtof(m)
        for k in range(5):
            det = (k - 2) * 0.0045 + r.uniform(-0.001, 0.001)
            ph = 2 * np.pi * f * (1 + det) * t + r.uniform(0, 6.28)
            v = saw(ph) * (1 / (1 + 0.25 * k))
            if k % 2:
                L += v
            else:
                R += v
            if k == 2:
                L += v * 0.5; R += v * 0.5
    cut = 400 + 2600 * bright
    st = np.stack([lp(L, cut, 2), lp(R, cut, 2)], axis=1)
    st = st + np.stack([lp(L, cut * 0.4), lp(R, cut * 0.4)], axis=1) * 0.6
    # slow swell + release
    env = np.clip(t / 0.9, 0, 1) ** 1.5 * np.clip((dur + 0.15 - t) / 1.6 + 1, 0, 1)
    env = np.where(t > dur, np.exp(-(t - dur) / 0.7), env)
    lfo = 1 + 0.12 * np.sin(2 * np.pi * t / s(4) + seed)
    return st * (env * lfo)[:, None] / (len(notes) * 4.5)


def build_music():
    # ---- pad + bass
    for i, (b0, b1, ch, br) in enumerate(TIMELINE):
        dur = s(b1 - b0)
        p = pad_chord(CH[ch], dur, br, i)
        add("pad", p, s(b0), 0.9, hall=0.55)
        if b0 >= 8:
            t = tt(dur + 0.4)
            f = mtof(ROOT[ch])
            x = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) + 0.12 * np.sin(2 * np.pi * 3 * f * t)
            env = np.clip(t / 0.06, 0, 1) * np.clip((dur + 0.05 - t) / 0.3, 0, 1)
            add("bass", np.tanh(x * env * 1.3) * 0.32, s(b0))
    # deep drone under the intro
    t = tt(s(8.3))
    dr = (np.sin(2 * np.pi * mtof(26) * t) * 0.5 + lp(noise(len(t)), 220) * 0.25) * np.clip(t / s(3), 0, 1) * np.clip((s(8.3) - t) / 0.5, 0, 1)
    add("pad", dr * 0.35, 0)

    # ---- heartbeat / drums
    for bt in range(0, 22):
        soft = 0.65 + 0.3 * min(bt, 15) / 15
        add("drums", heartbeat(soft), s(bt), 0.95 if bt < 16 else 0.7, room=0.15)
        KICKS.append(s(bt))
    add("special", heartbeat(0.9), s(23.0), 1.0)              # alone in the silence
    for bt in range(24, 47):
        add("drums", heartbeat(1.0), s(bt), 0.8, room=0.1)
        KICKS.append(s(bt))
        if bt < 43 and bt % 2 == 0:
            add("drums", kick(), s(bt), 0.45)
        if 26 <= bt < 43 and bt % 2 == 1:
            add("drums", snare(), s(bt), 0.42, hall=0.45, room=0.2)
        if 26 <= bt < 40:
            for h in range(2):
                add("drums", hat(), s(bt + h * 0.5 + 0.0), 0.35 if h else 0.22, pan=0.25)
        if 32 <= bt < 40:
            for h in range(4):
                add("drums", shaker(), s(bt + h * 0.25), 0.28 if h % 2 else 0.18, pan=-0.3)
    add("drums", heartbeat(0.8), s(47.0), 0.55, room=0.2)

    # ---- arps
    for k in range(int((16 - 8.5) * 4)):           # scan: 16ths, soft "data" plucks
        bt = 8.5 + k * 0.25
        ch = next(c for b0, b1, c, _ in TIMELINE if b0 <= bt < b1)
        tones = sorted(set(m % 12 for m in CH[ch]))
        pat = [0, 1, 2, 1, 3, 2, 1, 2]
        m = 74 + ((tones[pat[k % 8] % len(tones)] - 2) % 12)
        vel = 0.5 + 0.5 * (k % 4 == 0) + 0.25 * min(1, k / 20)
        add("arp", pluck(m, 0.5, 0.6), s(bt), 0.22 * vel, pan=0.35 * np.sin(k * 0.9), hall=0.25)
    for k in range(int((40 - 25) * 2)):            # reveal → roster: 8ths
        bt = 25 + k * 0.5
        ch = next(c for b0, b1, c, _ in TIMELINE if b0 <= bt < b1)
        notes = sorted(CH[ch])[-4:]
        pat = [0, 1, 2, 3, 2, 1, 2, 3]
        m = notes[pat[k % 8]] + 12
        vel = 0.75 if k % 2 == 0 else 0.5
        add("arp", pluck(m, 0.9), s(bt), 0.2 * vel * min(1, (bt - 25) / 2 + 0.4), pan=0.3 * np.sin(k * 1.3), hall=0.3)
        add("arp", pluck(m, 0.9) * 0.35, s(bt + 0.75), 0.2 * vel, pan=-0.5, hall=0.2)   # dotted-8th echo
    for k, m in enumerate([81, 77, 74, 69, 65, 62]):  # end sparkle
        add("arp", pluck(m, 1.2), s(44 + k * 0.5), 0.12, pan=0.4 * np.sin(k), hall=0.5)

    # ---- bells on key moments
    for bt, m, g in [(1.0, 69, 0.35), (2.0, 74, 0.3), (4.0, 77, 0.32), (11.5, 81, 0.25), (11.75, 86, 0.22), (15.0, 86, 0.3), (15.0, 81, 0.25),
                     (24.0, 74, 0.4), (24.0, 81, 0.3), (25.4, 86, 0.18), (38.2, 81, 0.25), (40.05, 79, 0.25), (41.0, 82, 0.25), (42.0, 85, 0.25),
                     (43.0, 86, 0.35), (43.0, 74, 0.3), (44.0, 81, 0.22), (45.0, 86, 0.22)]:
        add("bell", bell(m, 3.5), s(bt), g, pan=0.2 * np.sin(bt), hall=0.7)


def build_fx():
    # intro: glint when the eyes open, wind
    t = tt(s(8))
    wind = bp(noise(len(t)), 300, 1400) * (0.5 + 0.5 * np.sin(2 * np.pi * t / 5.5)) * np.clip(t / 2, 0, 1) * np.clip((s(7.9) - t) / 0.4, 0, 1)
    add("fx", wind * 0.05, 0, pan=-0.2, hall=0.3)
    add("fx", whoosh(0.5, 2000, 9000, 0.3), s(0.95), 0.12, pan=-0.3, hall=0.5)
    for bb in (3.5, 5.75):          # blinks
        add("fx", blip(2600, 0.04), s(bb), 0.15, hall=0.4)
    # zoom into the pupil: riser + reverse suck, hard cut at 8
    r = riser(s(1.0), 150, 1400, "sine") + whoosh(s(1.0), 200, 6000, 0.97)
    r[-int(0.01 * SR):] *= np.linspace(1, 0, int(0.01 * SR))
    add("fx", r, s(7.0), 0.55, hall=0.1)

    # scan: boot, sweeps, data blips, counter ticks, locks
    add("fx", impact(0.5) * 0.5, s(8.0), 0.35, hall=0.3)
    add("fx", blip(1200, 0.08), s(8.05), 0.5, hall=0.3)
    add("fx", blip(2400, 0.06), s(8.12), 0.4, hall=0.3)
    for k in range(3):
        add("fx", whoosh(s(1.6), 500, 5000, 0.5) * 0.8, s(9 + 2 * k), 0.16, pan=0.0, hall=0.25)
    for k in range(60):                         # landmark counter ticks
        add("fx", blip(3000 + 40 * k, 0.012), s(8.6 + k * (2.2 / 60)), 0.07, pan=np.sin(k) * 0.6)
    r2 = np.random.default_rng(11)
    for k in range(int((15 - 9) * 4)):
        if r2.random() < 0.6:
            add("fx", blip(r2.choice([1760, 2093, 2349, 2637, 3136]), 0.035), s(9 + k * 0.25 + 0.125), 0.08, pan=r2.uniform(-0.8, 0.8), hall=0.2)
    for at in (12.0, 12.5, 13.0, 13.5):         # tag pops
        add("fx", pop(1800, 900), s(at), 0.35, pan=-0.4 if at in (12.0, 13.0) else 0.4, hall=0.2)
    add("fx", blip(1320, 0.12) * 1.2, s(11.5), 0.45, hall=0.4)
    add("fx", blip(1760, 0.14) * 1.2, s(11.62), 0.45, hall=0.4)
    # DNA lock → collapse suck → flash
    add("fx", riser(s(1.0), 220, 1760, "sine"), s(15.0), 0.5, hall=0.2)
    add("fx", whoosh(s(0.95), 7000, 300, 0.92), s(15.05), 0.4)

    # roar: GET READY riser (the site's 180→720 Hz saw), then 5 slices
    add("fx", impact(0.6), s(16.0), 0.55, hall=0.35)
    add("fx", riser(s(1.0), 180, 720, "saw"), s(16.0), 0.35, hall=0.2)
    words = [("a", "o", 95, 70), ("e", "i", 160, 120), ("a", "o", 105, 72), ("e", "i", 175, 130), ("a", "o", 110, 60)]
    for i in range(5):
        bt = 17 + i
        add("drums", taiko(), s(bt), 0.75, hall=0.25)
        add("drums", kick(1.3), s(bt), 0.6)
        v0, v1, f0, f1 = words[i]
        add("vox", growl(0.55 + 0.05 * i, f0, f1, (v0, v1), rough=0.5 + 0.1 * i, seed=20 + i), s(bt) + 0.02, 0.32 + 0.04 * i,
            pan=0.15 * (-1) ** i, hall=0.3)
        t = tt(0.16)                            # the site's per-slice square beep (300 + i*90 Hz)
        sq = np.sign(np.sin(2 * np.pi * (300 + i * 90) * t)) * np.exp(-t / 0.05)
        add("fx", lp(sq, 3000) * 0.12, s(bt), 1.0)
        KICKS.append(s(bt))
    add("fx", riser(s(5.0), 120, 1000, "saw"), s(17.0), 0.32, hall=0.2)

    # glitch 22.0–22.91 then hard silence
    g = glitch_burst(s(0.91), 5)
    t = tt(s(0.91))
    tape = saw(2 * np.pi * np.cumsum(1500 * (200 / 1500) ** (t / t[-1])) / SR) * 0.15   # the site's 1500→200 Hz sweep
    gl = (g + tape + hp(noise(len(t)), 200) * np.exp(-t / 0.3) * 0.25) * np.clip((s(0.91) - t) / 0.01, 0, 1)
    add("special", gl, s(22.0), 0.75)
    imp = impact(0.4)[: int(s(0.9) * SR)]
    imp[-480:] *= np.linspace(1, 0, 480)
    add("special", imp, s(22.0), 0.35)
    # suck-in before the reveal
    sw = reverse_swell(s(0.85), (62, 69, 74)) + whoosh(s(0.85), 400, 8000, 0.98) * 0.6
    add("special", sw, s(23.15), 0.55, hall=0.2)
    add("special", blip(3200, 0.05), s(23.12), 0.12, hall=0.6)

    # reveal: BOOM + the monster's roar + confetti sparkle
    add("fx", impact(1.4), s(24.0), 0.95, hall=0.4)
    add("vox", growl(1.5, 120, 55, ("a", "o"), rough=0.75, noise_amt=0.45, seed=3), s(24.12), 0.55, hall=0.45)
    add("vox", growl(1.2, 240, 110, ("e", "a"), rough=0.4, seed=4), s(24.16), 0.18, pan=0.3, hall=0.5)
    r3 = np.random.default_rng(5)
    for k in range(40):
        add("fx", blip(r3.uniform(3000, 7000), 0.03), s(24.1) + r3.uniform(0, 2.2), 0.05 * r3.uniform(0.4, 1), pan=r3.uniform(-0.9, 0.9), hall=0.4)

    # roster cuts — each one its own transition sound + a little creature call
    add("fx", whoosh(s(0.5), 300, 6000, 0.55), s(30.75), 0.38, pan=0.0, hall=0.2)                 # whip
    add("fx", whoosh(s(0.5), 2000, 9000, 0.3) + bell(93, s(0.5), 0.5)[: int(s(0.5) * SR)] * 0.3, s(31.95), 0.3, hall=0.4)  # iris
    add("fx", squelch(), s(32.55), 0.6, hall=0.2)                                                  # slime
    add("fx", glitch_burst(s(0.2), 9), s(33.94), 0.5)                                              # glitch cut
    add("fx", whoosh(s(0.4), 500, 7000, 0.6), s(34.82), 0.38, hall=0.2)                            # vertical whip
    add("fx", whoosh(s(0.45), 6000, 200, 0.4, reverse=True), s(35.75), 0.38, hall=0.2)             # zoom-through
    add("fx", kick(), s(36.0), 0.4)
    add("fx", whoosh(s(0.5), 5000, 400, 0.3), s(37.0), 0.3, hall=0.2)                              # shrink to grid
    calls = [(31, 210, 150, "o", "a"), (32, 330, 260, "e", "i"), (33, 420, 520, "o", "i"), (34, 150, 95, "a", "o"), (35, 380, 300, "i", "e"), (36, 115, 70, "a", "o")]
    for k, (bt, f0, f1, v0, v1) in enumerate(calls):
        add("vox", growl(0.42, f0, f1, (v0, v1), rough=0.35, noise_amt=0.25, seed=40 + k), s(bt) + 0.05, 0.16, pan=0.2 * (-1) ** k, hall=0.35)
    # grid pops (same formula as film.js: 37.04 + rank*0.055)
    for rank in range(17):
        add("fx", pop(700 + rank * 60, 300 + rank * 25), s(37.04 + rank * 0.055), 0.22, pan=np.sin(rank * 1.7) * 0.7, hall=0.15)
    add("fx", impact(0.5), s(38.2), 0.3, hall=0.4)

    # phone + chips
    add("fx", whoosh(s(0.5), 300, 5000, 0.55), s(39.8), 0.35, hall=0.2)
    for at in (40.05, 41.0, 42.0):
        add("fx", pop(1500, 700), s(at), 0.25, hall=0.3)
    add("fx", glitch_burst(s(0.15), 13), s(41.44), 0.25)

    # logo splat + end card
    add("fx", impact(1.6), s(43.0), 1.0, hall=0.45)
    add("fx", squelch(), s(43.0), 0.7, hall=0.3)
    add("fx", reverse_swell(s(1.0), (62, 69, 74, 77)) * 0.6, s(42.0), 0.5, hall=0.2)
    add("fx", whoosh(s(0.6), 800, 7000, 0.4), s(43.9), 0.12, hall=0.4)
    add("fx", pop(900, 500), s(45.0), 0.35, hall=0.3)
    add("fx", typing(26, s(1.0)), s(45.3), 0.5, hall=0.1)


def limiter(x, thr, look_ms=5, rel_ms=120):
    from scipy.ndimage import minimum_filter1d, uniform_filter1d
    peak = np.abs(x).max(axis=1)
    g = np.minimum(1.0, thr / np.maximum(peak, 1e-9))
    L = int(look_ms * SR / 1000)
    g = minimum_filter1d(g, size=2 * L + 1)
    g = uniform_filter1d(g, size=L)
    # release: one-pole that only rises slowly
    a = np.exp(-1 / (rel_ms * SR / 1000))
    g = np.minimum(g, 1 - signal.lfilter([1 - a], [1, -a], 1 - g))
    g = minimum_filter1d(g, size=L)
    y = x * g[:, None]
    return np.clip(y, -thr, thr)


def reverb_ir(rt60, seconds, damp, seed):
    r = np.random.default_rng(seed)
    t = tt(seconds)
    decay = np.exp(-6.9 * t / rt60)
    ir = np.stack([r.standard_normal(len(t)), r.standard_normal(len(t))], axis=1) * decay[:, None]
    ir = lp(ir, damp)
    ir[: int(0.018 * SR)] = 0        # predelay
    return ir / np.sqrt((ir ** 2).sum(axis=0)).max()


def convolve(x, ir):
    return np.stack([signal.fftconvolve(x[:, c], ir[:, c])[:N] for c in range(2)], axis=1)


def main(out):
    build_music()
    build_fx()
    hall = reverb_ir(3.2, 4.5, 5500, 1)
    room = reverb_ir(0.7, 1.2, 7000, 2)
    hall_ret = convolve(HALL, hall) * 0.55
    room_ret = convolve(ROOM, room) * 0.45
    sp_ret = convolve(SPECIAL_HALL, hall) * 0.55

    t = np.arange(N) / SR
    # sidechain pump on pad + bass from the heartbeat/kicks
    duck = np.ones(N)
    for k in KICKS:
        i = int(k * SR)
        if i >= N:
            continue
        L = min(N - i, int(0.6 * SR))
        duck[i:i + L] = np.minimum(duck[i:i + L], 1 - 0.45 * np.exp(-np.arange(L) / SR / 0.16))
    music = ((BUS["pad"] + BUS["bass"]) * duck[:, None] + BUS["drums"] * 0.85 + BUS["arp"] * 2.6 + BUS["bell"] * 1.4
             + BUS["fx"] * 0.8 + BUS["vox"] * 1.7 + hall_ret + room_ret)
    # the surprise: everything stops dead during the glitch tail → silence → reveal
    mute = np.ones(N)
    a, b = int(s(22.0) * SR), int(s(24.0) * SR)
    ramp = int(0.012 * SR)
    mute[a:b] = 0
    mute[a - ramp:a] = np.linspace(1, 0, ramp)
    music *= mute[:, None]
    mix = music + BUS["special"] + sp_ret
    # gentle final fade with the picture
    fo0, fo1 = s(47.0), DUR
    fade = np.where(t < fo0, 1, np.clip((fo1 - t) / (fo1 - fo0), 0, 1) ** 1.2)
    mix *= fade[:, None]
    mix = hp(mix, 28)
    # level to ~-15 dBFS RMS over the active part, then a look-ahead limiter keeps
    # the booms under -1 dBFS (final loudness is matched by ffmpeg loudnorm)
    active = np.abs(mix).max(axis=1) > 1e-3
    mix *= 10 ** (-15 / 20) / np.sqrt((mix[active] ** 2).mean())
    mix = limiter(mix, 0.89)
    pcm = (mix * 32767).astype(np.int16)
    from scipy.io import wavfile
    wavfile.write(out, SR, pcm)
    print("wrote", out, f"{DUR:.3f}s", "peak", np.abs(mix).max())


if __name__ == "__main__":
    main(sys.argv[1])
