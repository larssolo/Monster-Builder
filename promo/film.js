// Monster Builder — 9:16 promo film, rendered frame-by-frame (deterministic).
// Everything is a pure function of the frame number so render.mjs can step through
// it and pipe frames to ffmpeg. Timeline is in beats at 70 BPM (see TIMELINE below
// and music.py, which uses the same beat grid).
//
//  beat  0– 8  intro: eyes in the dark  "Every face hides a monster."
//  beat  8–16  01 scan: 3D face landmarks → DNA lock
//  beat 16–24  02 roar: GET READY + 5-4-3-2-1 countdown, glitch, silence
//  beat 24–31  03 reveal: hero monster born on the spinning reveal background
//  beat 31–37  roster: one archetype per beat, a different transition each cut
//  beat 37–40  grid: all 18 archetypes
//  beat 40–43  the real site on a phone + features
//  beat 43–48  end card: logo splat, tagline, CTA, URL

import { loadInstance, makeDNA } from "./m3d.js";

const Q = new URLSearchParams(location.search);
const LANG = Q.get("lang") === "da" ? "da" : "en";
const FPS = 30, W = 1080, H = 1920, BPM = 70, BEAT = 60 / BPM, BEATS = 48;
const FRAMES = Math.floor(BEATS * BEAT * FPS);
const MW = 1080, MH = 1350;           // 3D monster render size

const INK = "#eafff6", MINT = "#52f0b0", SLIME = "#7dff3c", AQUA = "#00ffcc";

const TXT = {
  en: {
    l1: "Every face", l2a: "hides a ", l2b: "monster.",
    step: "STEP", s1: "Scan your face", s1sub: "478 LANDMARKS  →  MONSTER DNA", scanLabel: "SCANNING FACE",
    s2: "Roar for 5 seconds", ready: "GET READY!", words: ["ROAR!", "SCREAM!", "ROAR!", "SCREAM!"], voice: "VOICE  →  PERSONALITY",
    s3: "Meet your monster.", s3sub: "BORN FROM YOUR FACE + VOICE",
    no: "No.", g1: "18 species.", g2: "Endless mutations.",
    f1: "No app · No install", f2: "100% private · in your browser", f3a: "Say ", f3b: "MONSTER!", f3c: " to play again",
    tag: "Scan. Roar. Birth a monster.", cta: "Play now", url: "monster-builder.larssohl.dk",
    foot: "FREE  ·  CHROME & EDGE  ·  NO INSTALL",
    names: { blob: "BLOB", multihead: "MULTI-HEAD", octopus: "OCTOPUS", beast: "BEAST", fish: "FISH", bird: "BIRD", worm: "WORM",
      alien: "ALIEN", crab: "CRAB", dragon: "DRAGON", eyeball: "EYE MONSTER", jelly: "JELLY", virus: "VIRUS", bacteria: "BACTERIA",
      snake: "SNAKE", scorpion: "SCORPION", dino: "DINO", cell: "AMOEBA" }
  },
  da: {
    l1: "Bag hvert ansigt", l2a: "gemmer sig et ", l2b: "monster.",
    step: "TRIN", s1: "Scan dit ansigt", s1sub: "478 PUNKTER  →  MONSTER-DNA", scanLabel: "SCANNER ANSIGT",
    s2: "Brøl i 5 sekunder", ready: "GØR KLAR!", words: ["RÅB!", "SKRIG!", "BRØL!", "SKRIG!"], voice: "STEMME  →  PERSONLIGHED",
    s3: "Mød dit monster.", s3sub: "FØDT AF DIT ANSIGT + DIN STEMME",
    no: "Nr.", g1: "18 arter.", g2: "Uendelige mutationer.",
    f1: "Ingen app · Ingen installation", f2: "100% privat · i din browser", f3a: "Sig ", f3b: "MONSTER!", f3c: " og spil igen",
    tag: "Scan. Brøl. Skab et monster.", cta: "Spil nu", url: "monster-builder.larssohl.dk",
    foot: "GRATIS  ·  CHROME & EDGE  ·  INGEN INSTALLATION",
    names: { blob: "BLOB", multihead: "FLERHOVED", octopus: "BLÆKSPRUTTE", beast: "BÆST", fish: "FISK", bird: "FUGL", worm: "ORM",
      alien: "RUMVÆSEN", crab: "KRABBE", dragon: "DRAGE", eyeball: "ØJEMONSTER", jelly: "GOPLE", virus: "VIRUS", bacteria: "BAKTERIE",
      snake: "SLANGE", scorpion: "SKORPION", dino: "DINO", cell: "AMØBE" }
  }
};
const T = TXT[LANG];

// ---------------------------------------------------------------- math
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (x, a, b) => clamp((x - a) / (b - a));
const smooth = (x) => x * x * (3 - 2 * x);
const outCubic = (x) => 1 - Math.pow(1 - x, 3);
const inCubic = (x) => x * x * x;
const inOutCubic = (x) => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
const outExpo = (x) => x >= 1 ? 1 : 1 - Math.pow(2, -10 * x);
const inExpo = (x) => x <= 0 ? 0 : Math.pow(2, 10 * x - 10);
const inOutSine = (x) => -(Math.cos(Math.PI * x) - 1) / 2;
const outBack = (x, c = 1.70158) => { const c3 = c + 1; return 1 + c3 * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const fr = (x) => ((x % 1) + 1) % 1;
const hash = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const env = (x, k = 7) => x >= 0 ? Math.exp(-x * k) : 0;
// heartbeat "lub-dub" on every beat (dub a quarter beat later) — matches music.py
const heart = (b) => env(fr(b)) + 0.55 * env(fr(b - 0.25));
// keyframe track: [[pos, value], ...] with smoothstep between keys
function kf(u, keys) {
  if (u <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (u <= keys[i][0]) {
      const [p0, v0] = keys[i - 1], [p1, v1] = keys[i];
      return lerp(v0, v1, smooth((u - p0) / (p1 - p0)));
    }
  }
  return keys[keys.length - 1][1];
}

// ---------------------------------------------------------------- canvas helpers
const out = document.getElementById("out");
const ctx = out.getContext("2d");
function mk(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
const L1 = mk(W, H), L2 = mk(W, H), TMP = mk(W, H), CH = mk(W, H), GOO = mk(W, H), GOO2 = mk(W, H);
const SIL = mk(MW, MH), SILC = mk(MW, MH), SMALL = mk(MW / 4, MH / 4), CHAR = mk(640, 480);
const g2d = (c) => c.getContext("2d");

function rrect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function font(g, size, weight = 600, family = "Fredoka") { g.font = `${weight} ${size}px "${family}"`; }

// per-letter reveal: letters rise out of a blur, staggered
function revealText(g, str, x, y, o, p) {
  if (p <= 0) return;
  g.save();
  font(g, o.size, o.weight ?? 600, o.family ?? "Fredoka");
  g.letterSpacing = (o.ls ?? 0) + "px";
  g.textAlign = "left"; g.textBaseline = "alphabetic";
  const chars = [...str], n = chars.length;
  const total = g.measureText(str).width;
  const x0 = o.align === "left" ? x : o.align === "right" ? x - total : x - total / 2;
  const spread = o.spread ?? 7;
  let prefix = "";
  for (let i = 0; i < n; i++) {
    const cx = x0 + g.measureText(prefix).width;
    prefix += chars[i];
    const lp = clamp(p * (n + spread) / spread - i / spread);
    if (lp <= 0 || chars[i] === " ") continue;
    const e = outCubic(lp);
    g.globalAlpha = (o.alpha ?? 1) * e;
    const bl = (1 - e) * (o.blur ?? 14);
    const col = o.colorAt ? o.colorAt(i) : (o.color ?? INK);
    const glow = o.glowAt ? o.glowAt(i) : o.glow;
    const yy = y + (1 - e) * o.size * (o.rise ?? 0.42);
    if (bl > 0.4) {
      // blur on a small scratch canvas — a filter on the full frame is far too slow
      const pad = Math.ceil(bl * 3 + (glow ? (o.glowBlur ?? 30) : 0)) + 4;
      const cw = Math.ceil(g.measureText(chars[i]).width) + pad * 2, chh = Math.ceil(o.size * 1.5) + pad * 2;
      const sc = g2d(CHAR); sc.clearRect(0, 0, cw, chh);
      sc.save(); sc.font = g.font; sc.letterSpacing = "0px"; sc.textAlign = "left"; sc.textBaseline = "alphabetic";
      sc.filter = `blur(${bl.toFixed(1)}px)`; sc.fillStyle = col;
      if (glow) { sc.shadowColor = glow; sc.shadowBlur = o.glowBlur ?? 30; }
      sc.fillText(chars[i], pad, pad + o.size * 1.15); sc.restore();
      g.drawImage(CHAR, 0, 0, cw, chh, cx - pad, yy - o.size * 1.15 - pad, cw, chh);
      continue;
    }
    g.fillStyle = col;
    if (glow) { g.shadowColor = glow; g.shadowBlur = o.glowBlur ?? 30; } else g.shadowBlur = 0;
    g.fillText(chars[i], cx, yy);
  }
  g.restore();
}

function pill(g, str, cx, cy, alpha = 1, o = {}) {
  if (alpha <= 0) return;
  g.save();
  font(g, o.size ?? 24, 700, "Space Mono");
  const ls = o.ls ?? 7;
  g.letterSpacing = ls + "px";
  const tw = g.measureText(str).width - ls;
  const h = o.h ?? 56, w = tw + (o.padX ?? 34) * 2;
  g.globalAlpha = alpha;
  rrect(g, cx - w / 2, cy - h / 2, w, h, h / 2);
  g.fillStyle = "rgba(0,22,26,.62)"; g.fill();
  g.lineWidth = 2; g.strokeStyle = "rgba(82,240,176,.55)"; g.stroke();
  g.fillStyle = MINT; g.textAlign = "left"; g.textBaseline = "middle";
  g.fillText(str, cx - tw / 2, cy + 2);
  g.restore();
}

function monoText(g, str, x, y, o = {}) {
  g.save();
  font(g, o.size ?? 26, o.weight ?? 700, "Space Mono");
  g.letterSpacing = (o.ls ?? 4) + "px";
  g.textAlign = o.align ?? "center"; g.textBaseline = "alphabetic";
  g.globalAlpha = o.alpha ?? 1;
  g.fillStyle = o.color ?? MINT;
  if (o.glow) { g.shadowColor = o.glow; g.shadowBlur = 16; }
  g.fillText(str, x, y);
  g.restore();
}

// ---------------------------------------------------------------- static layers
let CAVE, VIGNETTE, GRAIN = [], SCANLINES, SPRITES = {};
function buildCave() {
  const c = mk(W, H), g = g2d(c);
  g.fillStyle = "#000508"; g.fillRect(0, 0, W, H);
  const rg = (x, y, rx, ry, stops) => {
    g.save(); g.translate(x, y); g.scale(rx, ry);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    stops.forEach(([o, col]) => gr.addColorStop(o, col));
    g.fillStyle = gr; g.fillRect(-1, -1, 2, 2); g.restore();
  };
  rg(W * 0.5, H * 1.08, W * 0.8, H * 0.36, [[0, "rgba(0,220,180,.24)"], [0.62, "rgba(0,220,180,0)"]]);
  rg(W * 0.14, H * 0.88, W * 0.48, H * 0.3, [[0, "rgba(0,150,200,.13)"], [0.55, "rgba(0,150,200,0)"]]);
  rg(W * 0.86, H * 0.84, W * 0.48, H * 0.3, [[0, "rgba(20,80,220,.11)"], [0.55, "rgba(20,80,220,0)"]]);
  rg(W * 0.5, H * 0.45, W * 1.2, H * 0.65, [[0, "rgba(0,24,40,.95)"], [0.72, "rgba(0,24,40,0)"]]);
  // stalactites (the site's clip-path, scaled)
  const stal = [[0, 0], [100, 0], [100, 26], [95, 78], [90, 34], [84, 96], [77, 40], [70, 70], [62, 30], [55, 88], [48, 38], [41, 64], [34, 30], [27, 100], [20, 42], [13, 72], [6, 32], [0, 30]];
  const sh = 330;
  g.save();
  g.shadowColor = "rgba(0,180,160,.22)"; g.shadowBlur = 44; g.shadowOffsetY = 18;
  let gr = g.createLinearGradient(0, 0, 0, sh);
  gr.addColorStop(0, "#000508"); gr.addColorStop(0.6, "#001018"); gr.addColorStop(1, "#000a10");
  g.fillStyle = gr; g.beginPath();
  stal.forEach(([px, py], i) => (i ? g.lineTo : g.moveTo).call(g, px / 100 * W, py / 100 * sh));
  g.closePath(); g.fill();
  // ground
  const grd = [[0, 100], [100, 100], [100, 44], [92, 70], [85, 40], [76, 64], [66, 36], [58, 60], [50, 32], [42, 58], [33, 38], [24, 66], [15, 40], [8, 70], [0, 46]];
  const gh = 300;
  g.shadowColor = "rgba(0,200,180,.16)"; g.shadowBlur = 50; g.shadowOffsetY = -10;
  gr = g.createLinearGradient(0, H, 0, H - gh);
  gr.addColorStop(0, "#000508"); gr.addColorStop(1, "#001018");
  g.fillStyle = gr; g.beginPath();
  grd.forEach(([px, py], i) => (i ? g.lineTo : g.moveTo).call(g, px / 100 * W, H - gh + py / 100 * gh));
  g.closePath(); g.fill();
  g.restore();
  return c;
}
function buildVignette() {
  const c = mk(W, H), g = g2d(c);
  g.save(); g.translate(W / 2, H / 2); g.scale(W * 0.95, H * 0.78);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  gr.addColorStop(0.45, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,.72)");
  g.fillStyle = gr; g.fillRect(-1.5, -1.5, 3, 3); g.restore();
  return c;
}
function buildGrain(seed) {
  const c = mk(512, 512), g = g2d(c), im = g.createImageData(512, 512);
  let s = seed * 9973 + 17;
  for (let i = 0; i < im.data.length; i += 4) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const v = 128 + ((s >> 8) % 120) - 60;
    im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  return c;
}
function buildScanlines() {
  const c = mk(W, H + 12), g = g2d(c);
  g.fillStyle = "rgba(255,255,255,.16)";
  for (let y = 0; y < H + 12; y += 6) g.fillRect(0, y, W, 2);
  return c;
}
function glowSprite(rgb) {
  const c = mk(64, 64), g = g2d(c), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(0.25, `rgba(${rgb},.55)`); gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return c;
}

// ---------------------------------------------------------------- shared FX
const SPORE_COLS = ["0,255,213", "64,176,255", "176,96,255", "0,255,204", "125,255,60"];
function drawSpores(g, t, alpha, n = 46) {
  if (alpha <= 0) return;
  g.save(); g.globalCompositeOperation = "lighter";
  for (let i = 0; i < n; i++) {
    const sp = 40 + hash(i * 3.1) * 70, span = H + 200;
    const y = H + 100 - fr(t * sp / span + hash(i * 7.7)) * span;
    const x = hash(i * 1.37) * W + Math.sin(t * 0.6 + i) * 22;
    const life = fr(t * sp / span + hash(i * 7.7));
    const a = alpha * Math.sin(life * Math.PI) * (0.35 + 0.65 * hash(i * 5.3));
    const s = 10 + hash(i * 2.9) * 26;
    g.globalAlpha = a;
    g.drawImage(SPRITES[SPORE_COLS[i % SPORE_COLS.length]], x - s, y - s, s * 2, s * 2);
  }
  g.restore();
}

function drawCrystals(g, b, alpha) {
  const list = [[0.06, 60 * 2.2, "#00d8c8", -10, 72], [0.13, 48 * 2.2, "#0090e0", 14, 46], [0.92, 64 * 2.2, "#8800ff", 9, 80], [0.85, 46 * 2.2, "#00c8e8", -8, 42]];
  g.save();
  list.forEach(([fx, bottom, col, rot, h], i) => {
    const hh = h * 2.3, ww = 26 * 2.3;
    const x = fx * W + (fx > 0.5 ? -ww : 0), y = H - bottom - hh;
    const pulse = 0.75 + 0.65 * (0.5 + 0.5 * Math.sin((b / 4 + i * 0.25) * Math.PI * 2));
    g.save(); g.translate(x + ww / 2, y + hh); g.rotate(rot * Math.PI / 180);
    g.globalAlpha = alpha * 0.9;
    g.shadowColor = col; g.shadowBlur = 50 * pulse;
    const gr = g.createLinearGradient(-ww / 2, -hh, ww / 2, 0);
    gr.addColorStop(0, "rgba(180,255,245,.85)"); gr.addColorStop(0.45, col); gr.addColorStop(1, "rgba(0,0,0,.3)");
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(0, -hh); g.lineTo(ww / 2, -hh * 0.7); g.lineTo(ww * 0.3, 0); g.lineTo(-ww * 0.3, 0); g.lineTo(-ww / 2, -hh * 0.7); g.closePath(); g.fill();
    g.shadowBlur = 0; g.globalCompositeOperation = pulse > 1 ? "lighter" : "source-over";
    g.globalAlpha = alpha * Math.abs(pulse - 1) * 0.6; g.fillStyle = pulse > 1 ? col : "#000"; g.fill();
    g.restore();
  });
  g.restore();
}

// monster-ish glowing eyes (intro + pre-reveal)
function drawEye(g, x, y, w, h, open, rot, glow, look) {
  if (open <= 0.02) return;
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(1, open);
  const path = new Path2D();
  path.moveTo(-w / 2, 0); path.quadraticCurveTo(0, -h, w / 2, 0); path.quadraticCurveTo(0, h, -w / 2, 0);
  g.shadowColor = `rgba(160,255,60,${0.85 * glow})`; g.shadowBlur = 30 + 60 * glow;
  const gr = g.createRadialGradient(look * 0.3, 0, 2, 0, 0, w / 2);
  gr.addColorStop(0, "#fbffd6"); gr.addColorStop(0.3, "#cfff5a"); gr.addColorStop(0.75, "#5fd000"); gr.addColorStop(1, "#1f5c00");
  g.fillStyle = gr; g.fill(path); g.shadowBlur = 0;
  g.save(); g.clip(path);
  g.fillStyle = "#040704"; g.beginPath(); g.ellipse(look, 0, w * 0.06, h * 0.62, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = "rgba(255,255,255,.75)"; g.beginPath(); g.ellipse(-w * 0.17 + look * 0.2, -h * 0.17, w * 0.05, h * 0.09, -0.4, 0, Math.PI * 2); g.fill();
  g.restore(); g.restore();
}
function drawEyePair(g, cx, cy, s, open, glow, look) {
  g.save(); g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.3 * glow * open;
  g.drawImage(SPRITES["160,255,60"], cx - 420 * s, cy - 260 * s, 840 * s, 520 * s);
  g.restore();
  drawEye(g, cx - 150 * s, cy, 200 * s, 112 * s, open, 0.16, glow, look);
  drawEye(g, cx + 150 * s, cy, 200 * s, 112 * s, open, -0.16, glow, look);
}

// RGB split + slice displacement + scanlines (the site's #glitch look)
function glitch(g, src, amt, f) {
  if (amt <= 0.001) { g.drawImage(src, 0, 0); return; }
  const cg = g2d(CH);
  g.save(); g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  const dx = 6 + 26 * amt;
  [["#f00", -dx, 0], ["#0f0", 0, 0], ["#00f", dx, dx * 0.3]].forEach(([col, ox, oy]) => {
    cg.globalCompositeOperation = "source-over"; cg.drawImage(src, 0, 0);
    cg.globalCompositeOperation = "multiply"; cg.fillStyle = col; cg.fillRect(0, 0, W, H);
    cg.globalCompositeOperation = "source-over";
    g.globalCompositeOperation = "lighter"; g.drawImage(CH, ox, oy);
  });
  g.globalCompositeOperation = "source-over";
  const n = Math.round(4 + 10 * amt);
  for (let k = 0; k < n; k++) {
    const y = hash(f * 13.1 + k * 3.7) * H, h = 16 + hash(f * 7.3 + k) * 150;
    const off = (hash(f * 3.3 + k * 9.1) - 0.5) * 220 * amt;
    g.drawImage(g.canvas, 0, y, W, h, off, y, W, h);
  }
  g.globalCompositeOperation = "screen"; g.globalAlpha = 0.55 * amt;
  g.drawImage(SCANLINES, 0, -(f % 6));
  const gr = g.createLinearGradient(0, 0, W, 0);
  gr.addColorStop(0, "rgba(255,0,76,.4)"); gr.addColorStop(1, "rgba(0,255,240,.4)");
  g.fillStyle = gr; g.globalAlpha = 0.5 * amt; g.fillRect(0, 0, W, H);
  g.restore();
}

// ---------------------------------------------------------------- 3D monsters
let MA, MB, MT, CA, CB, CT, SNAP = {};
const HERO = makeDNA({ type: "blob", hue: 105, menace: 0.55, seed: 4, body: 0.55, eye: 0.6, gap: 0.5, mouth: 0.65, bright: 0.45 });
const ROSTER = [
  { type: "octopus", hue: 205, menace: 0.45, seed: 11, z: 8.6, ly: -0.4 },
  { type: "eyeball", hue: 265, menace: 0.62, seed: 12, z: 8.2, ly: 0.05 },
  { type: "jelly", hue: 292, menace: 0.4, seed: 13, z: 8.8, ly: -0.5 },
  { type: "dino", hue: 168, menace: 0.5, seed: 14, z: 8.8, ly: 0.05 },
  { type: "virus", hue: 335, menace: 0.5, seed: 15, z: 8.4, ly: 0.05 },
  { type: "beast", hue: 262, menace: 0.6, seed: 16, z: 8.2, ly: 0.0 }
].map((o) => ({ ...o, dna: makeDNA(o) }));
const ARCH = ["blob", "multihead", "octopus", "beast", "fish", "bird", "worm", "alien", "crab", "dragon", "eyeball", "jelly", "virus", "bacteria", "snake", "scorpion", "dino", "cell"];
// grid order: the last roster monster (beast) sits in the middle tile it shrinks into
const GRID = ["bird", "dragon", "fish", "alien", "multihead", "crab", "worm", "beast", "snake", "jelly", "eyeball", "virus", "scorpion", "blob", "bacteria", "dino", "cell", "octopus"];
const GRID_CENTER = 7;
const gridTile = (i) => ({ x: (i % 3) * 360, y: Math.floor(i / 3) * 320, w: 360, h: 320 });
const GRID_RANK = (() => {
  const c = gridTile(GRID_CENTER);
  const d = GRID.map((_, i) => { const r = gridTile(i); return [Math.hypot(r.x - c.x, (r.y - c.y) * 1.1), i]; });
  d.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const rank = []; d.forEach(([, i], k) => (rank[i] = k));
  return rank;
})();
function gridDNA(type, i) {
  const r = ROSTER.find((o) => o.type === type);
  if (r) return r.dna;
  if (type === "blob") return HERO;
  return makeDNA({ type, hue: (i * 47 + 120) % 360, menace: 0.45, seed: 30 + i });
}

function setCam(inst, c) {
  const cam = inst.__cam();
  cam.position.set(c.x ?? 0, c.y ?? 0.3, c.z ?? 8);
  cam.lookAt(0, c.ly ?? 0.05, 0);
}
function renderMonster(inst, dna, tsec, prog, cam) {
  inst.build(dna);
  setCam(inst, cam);
  inst.render(10000 + tsec * 1000, prog, dna.menace);
}

// ---------------------------------------------------------------- face mesh
let FACE;
function prepFace(json) {
  const v = json.v; let minY = 1e9, maxY = -1e9, sx = 0, sz = 0;
  for (const p of v) { sx += p[0]; sz += p[2]; minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  const mx = sx / v.length, my = (minY + maxY) / 2, mz = sz / v.length;
  FACE = { pts: v.map((p) => [p[0] - mx, p[1] - my, p[2] - mz]), e: json.e, h: maxY - minY, ny: v.map((p) => (maxY - p[1]) / (maxY - minY)) };
}
function projectFace(yaw, pitch, cx, cy, height) {
  const s = height / FACE.h, D = FACE.h * 2.6;
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const n = FACE.pts.length, P = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const [x, y, z] = FACE.pts[i];
    const x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw;
    const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
    const k = D / (D - z2);
    P[i * 3] = cx + x1 * s * k; P[i * 3 + 1] = cy - y2 * s * k; P[i * 3 + 2] = z2 / FACE.h;
  }
  return P;
}

// ================================================================= SHOTS
// each shot draws a complete, opaque frame into g at beat b / time t

// ---- intro: eyes in the dark
function shotIntro(g, b, t) {
  const look = Math.sin(b * 0.8) * 9 - 6 * smooth(seg(b, 4, 5));
  const ex = 540, ey = 800, pupX = ex + 150 + look, pupY = ey;
  const zp = seg(b, 7.0, 8.0), z = (1 + 0.05 * seg(b, 0, 7)) * (1 + inExpo(zp) * 90);
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  g.save();
  g.translate(pupX, pupY); g.scale(z, z); g.translate(-pupX, -pupY);
  g.globalAlpha = 0.9 * smooth(seg(b, 0.3, 4));
  g.drawImage(CAVE, 0, 0); g.globalAlpha = 1;
  drawSpores(g, t, smooth(seg(b, 0.6, 3.5)));
  let open = outCubic(seg(b, 1.0, 1.45));
  for (const c of [3.5, 5.75]) open *= 1 - clamp(1 - Math.abs(b - c) / 0.13);
  open *= lerp(1, 0.62, smooth(seg(b, 6.5, 6.95)));
  drawEyePair(g, ex, ey, 1, open, 0.55 + 0.45 * heart(b), look);
  g.restore();
  const ta = 1 - smooth(seg(b, 6.85, 7.25));
  if (ta > 0) {
    revealText(g, T.l1, 540, 1190, { size: 104, alpha: ta, glow: "rgba(82,240,176,.25)" }, seg(b, 2.0, 3.3));
    const k = [...T.l2a].length;
    revealText(g, T.l2a + T.l2b, 540, 1312, {
      size: 104, alpha: ta,
      colorAt: (i) => (i >= k ? SLIME : INK),
      glowAt: (i) => (i >= k ? "rgba(125,255,60,.65)" : "rgba(82,240,176,.25)")
    }, seg(b, 4.0, 5.4));
  }
  if (b < 0.7) { g.fillStyle = `rgba(0,0,0,${1 - smooth(seg(b, 0, 0.7))})`; g.fillRect(0, 0, W, H); }
}

// ---- 01 scan
const TAGS = [
  { i: 234, k: "BODY", v: "0.62", at: 12.0, left: true, dy: 40 }, { i: 386, k: "EYE", v: "0.48", at: 12.5, left: false, dy: -90 },
  { i: 168, k: "GAP", v: "0.55", at: 13.0, left: true, dy: -150 }, { i: 14, k: "MOUTH", v: "0.71", at: 13.5, left: false, dy: 60 }
];
function shotScan(g, b, t) {
  const cx = 540, cy = 880, fh = 690;
  const box = { x: 150, y: 480, w: 780, h: 800 };
  g.fillStyle = "#00070c"; g.fillRect(0, 0, W, H);
  const fin = smooth(seg(b, 8.0, 8.8));
  // faint scan grid + center glow
  g.save();
  const gr = g.createRadialGradient(cx, cy, 0, cx, cy, 900);
  gr.addColorStop(0, `rgba(0,110,100,${0.32 * fin})`); gr.addColorStop(1, "rgba(0,40,40,0)");
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.strokeStyle = `rgba(0,220,180,${0.06 * fin})`; g.lineWidth = 1.5; g.beginPath();
  for (let x = 0; x <= W; x += 54) { g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); }
  for (let y = 0; y <= H; y += 54) { g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); }
  g.stroke(); g.restore();
  drawSpores(g, t, 0.35 * fin, 24);

  // face mesh
  const yaw = Math.sin(t * 0.62 + 0.4) * 0.4 + (1 - outCubic(seg(b, 8.0, 9.8))) * 1.4;
  const pitch = -0.12 + Math.sin(t * 0.45) * 0.07;
  const P = projectFace(yaw, pitch, cx, cy, fh);
  const q = inCubic(seg(b, 15.0, 15.85));
  const n = FACE.pts.length, X = new Float32Array(n), Y = new Float32Array(n), A = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const d = hash(i * 7.13) * 0.8;
    const pa = outExpo(seg(b, 8.0 + d, 9.1 + d));
    const ang = hash(i) * Math.PI * 2, rad = 520 + hash(i + 0.37) * 760;
    let x = lerp(cx + Math.cos(ang) * rad, P[i * 3], pa), y = lerp(cy + Math.sin(ang) * rad, P[i * 3 + 1], pa);
    if (q > 0) {
      const a = q * 3.2 * (0.6 + hash(i * 2.2) * 0.8), dx = (x - cx) * (1 - q), dy = (y - cy) * (1 - q);
      x = cx + dx * Math.cos(a) - dy * Math.sin(a); y = cy + dx * Math.sin(a) + dy * Math.cos(a);
    }
    X[i] = x; Y[i] = y; A[i] = pa * (1 - smooth(seg(q, 0.75, 1)));
  }
  const edgeA = smooth(seg(b, 8.9, 9.9)) * (1 - smooth(seg(b, 15.0, 15.3)));
  if (edgeA > 0) {
    g.save(); g.lineWidth = 1.4;
    g.strokeStyle = `rgba(0,220,180,${(0.1 + 0.16 * seg(b, 9, 12)) * edgeA})`;
    g.beginPath();
    for (const [a, c] of FACE.e) { g.moveTo(X[a], Y[a]); g.lineTo(X[c], Y[c]); }
    g.stroke(); g.restore();
  }
  // scan line sweeps (one per 2 beats)
  const sp = fr((b - 9) / 2), scanOn = b >= 9 && b < 15 ? 1 : 0;
  const scanY = box.y + 20 + inOutSine(clamp(sp / 0.8)) * (box.h - 40);
  const scanA = scanOn * (sp < 0.8 ? 1 : 0) * smooth(clamp(sp / 0.05)) * (1 - smooth(seg(sp, 0.74, 0.8)));
  g.save();
  for (let i = 0; i < n; i++) {
    if (A[i] <= 0.01) continue;
    const dz = clamp(P[i * 3 + 2] + 0.5);
    const locked = b > 9 + FACE.ny[i] * 1.6;
    const near = scanA * Math.exp(-(((Y[i] - scanY) / 28) ** 2));
    const r = (1.6 + dz * 1.6 + near * 2.4);
    g.globalAlpha = A[i] * (0.35 + 0.65 * dz);
    g.fillStyle = near > 0.3 ? "#e6fff8" : locked ? "#78ffdc" : "rgba(0,220,180,.5)";
    g.beginPath(); g.arc(X[i], Y[i], r, 0, Math.PI * 2); g.fill();
  }
  g.globalCompositeOperation = "lighter";
  for (let i = 0; i < n; i++) {
    const near = scanA * Math.exp(-(((Y[i] - scanY) / 34) ** 2));
    if (near < 0.05 || A[i] <= 0.01) continue;
    g.globalAlpha = near * 0.6 * A[i];
    g.drawImage(SPRITES["0,255,204"], X[i] - 14, Y[i] - 14, 28, 28);
  }
  g.restore();
  if (scanA > 0) {
    g.save(); g.globalAlpha = scanA;
    const lg = g.createLinearGradient(box.x, 0, box.x + box.w, 0);
    lg.addColorStop(0, "rgba(0,220,180,0)"); lg.addColorStop(0.5, "rgba(0,255,210,.95)"); lg.addColorStop(1, "rgba(0,220,180,0)");
    g.shadowColor = "rgba(0,220,180,.8)"; g.shadowBlur = 30;
    g.fillStyle = lg; g.fillRect(box.x, scanY - 2, box.w, 4);
    g.globalAlpha = scanA * 0.12; g.shadowBlur = 0;
    const tg = g.createLinearGradient(0, scanY - 120, 0, scanY);
    tg.addColorStop(0, "rgba(0,220,180,0)"); tg.addColorStop(1, "rgba(0,220,180,1)");
    g.fillStyle = tg; g.fillRect(box.x, scanY - 120, box.w, 120);
    g.restore();
  }
  // landmark tags
  for (const tg of TAGS) {
    const p = seg(b, tg.at, tg.at + 0.45), fade = 1 - smooth(seg(b, 14.7, 15.05));
    if (p <= 0 || fade <= 0) continue;
    const px = X[tg.i], py = Y[tg.i], left = tg.left;
    const lx = left ? 92 : W - 92, ly = py + tg.dy;
    const e = outCubic(p);
    g.save(); g.globalAlpha = fade;
    g.strokeStyle = "rgba(120,255,220,.8)"; g.lineWidth = 2;
    g.beginPath(); g.arc(px, py, 9, 0, Math.PI * 2); g.stroke();
    g.fillStyle = "#e6fff8"; g.beginPath(); g.arc(px, py, 3.5, 0, Math.PI * 2); g.fill();
    const mx = lerp(px, px + (left ? -60 : 60), e), my = lerp(py, ly, e);
    const ex2 = lerp(mx, lx + (left ? 200 : -200), seg(p, 0.3, 1));
    g.beginPath(); g.moveTo(px + (left ? -9 : 9), py); g.lineTo(mx, my); g.lineTo(ex2, my); g.stroke();
    const ta = smooth(seg(p, 0.45, 1));
    if (ta > 0) {
      g.globalAlpha = fade * ta;
      font(g, 22, 700, "Space Mono"); g.letterSpacing = "3px"; g.textBaseline = "bottom";
      g.textAlign = left ? "left" : "right";
      g.fillStyle = "rgba(0,220,180,.65)"; g.fillText(tg.k, lx, my - 10);
      font(g, 34, 700, "Space Mono"); g.fillStyle = "#e6fff8";
      g.shadowColor = "rgba(0,255,204,.6)"; g.shadowBlur = 14;
      g.fillText(tg.v, lx, my + 44);
    }
    g.restore();
  }
  // HUD brackets + label
  const hudA = smooth(seg(b, 8.4, 9.2)) * (1 - smooth(seg(b, 15.2, 15.7)));
  if (hudA > 0) {
    g.save(); g.globalAlpha = hudA * (0.75 + 0.25 * Math.sin(t * 3));
    g.strokeStyle = "rgba(0,240,200,.95)"; g.lineWidth = 4; g.shadowColor = "rgba(0,220,180,.7)"; g.shadowBlur = 14;
    const L = 58, ins = (1 - outCubic(seg(b, 8.4, 9.3))) * 60;
    const bx = box.x + ins, by = box.y + ins, bw = box.w - ins * 2, bh = box.h - ins * 2;
    g.beginPath();
    g.moveTo(bx, by + L); g.lineTo(bx, by); g.lineTo(bx + L, by);
    g.moveTo(bx + bw - L, by); g.lineTo(bx + bw, by); g.lineTo(bx + bw, by + L);
    g.moveTo(bx, by + bh - L); g.lineTo(bx, by + bh); g.lineTo(bx + L, by + bh);
    g.moveTo(bx + bw - L, by + bh); g.lineTo(bx + bw, by + bh); g.lineTo(bx + bw, by + bh - L);
    g.stroke(); g.restore();
    monoText(g, T.scanLabel, cx, box.y - 24, { size: 22, ls: 7, alpha: hudA * 0.8, color: "rgba(0,220,180,1)" });
    // readouts (same rows as the site's HUD)
    const rx0 = box.x + 10, rx1 = box.x + box.w - 10, ry = box.y + box.h + 70;
    const lm = Math.round(478 * outCubic(seg(b, 8.6, 10.8)));
    const lockedFace = b >= 11.5;
    const pct = Math.round(100 * seg(b, 9, 15));
    const rows = [["LANDMARKS", `${lm} pt`, false], ["BIOMETRIC", lockedFace ? "FACE LOCKED" : "READING…", lockedFace], ["DNA LOCK", `${pct}%`, pct === 100]];
    rows.forEach(([k, v, hot], j) => {
      const y = ry + j * 46;
      monoText(g, k, rx0, y, { size: 26, ls: 3, align: "left", alpha: hudA * 0.55, color: "rgba(0,220,180,1)" });
      const blink = !lockedFace && j === 1 ? (fr(t / 1.1) < 0.5 ? 1 : 0.15) : 1;
      monoText(g, v, rx1, y, { size: 26, ls: 3, align: "right", alpha: hudA * blink, color: hot ? AQUA : "rgba(0,240,200,1)", glow: hot ? "rgba(0,255,180,.7)" : null });
    });
    const by2 = ry + 3 * 46 - 14;
    g.save(); g.globalAlpha = hudA;
    rrect(g, rx0, by2, rx1 - rx0, 8, 4); g.fillStyle = "rgba(0,220,180,.14)"; g.fill();
    rrect(g, rx0, by2, (rx1 - rx0) * pct / 100, 8, 4); g.fillStyle = "rgba(0,240,200,.95)";
    g.shadowColor = "rgba(0,220,180,.8)"; g.shadowBlur = 14; g.fill();
    g.restore();
  }
  // header
  pill(g, `${T.step} 01`, 540, 250, outCubic(seg(b, 8.2, 8.8)) * (1 - smooth(seg(b, 15.1, 15.5))));
  revealText(g, T.s1, 540, 372, { size: 92, alpha: 1 - smooth(seg(b, 15.1, 15.5)), glow: "rgba(82,240,176,.3)" }, seg(b, 8.35, 9.4));
  monoText(g, T.s1sub, 540, 1600, { size: 26, ls: 4, alpha: smooth(seg(b, 10.2, 10.8)) * (1 - smooth(seg(b, 15.1, 15.5))) * 0.8 });
  // DNA orb + flash into the roar
  if (q > 0) {
    g.save(); g.globalCompositeOperation = "lighter";
    const r = lerp(10, 170, inCubic(q));
    g.globalAlpha = q; g.drawImage(SPRITES["0,255,204"], cx - r * 3, cy - r * 3, r * 6, r * 6);
    g.globalAlpha = q * 0.9; g.drawImage(SPRITES["230,255,250"], cx - r, cy - r, r * 2, r * 2);
    g.restore();
  }
  const fl = smooth(seg(b, 15.7, 16.0));
  if (fl > 0) { g.fillStyle = `rgba(230,255,248,${fl})`; g.fillRect(0, 0, W, H); }
  if (b < 8.25) { g.fillStyle = `rgba(0,0,0,${1 - seg(b, 8.0, 8.25)})`; g.fillRect(0, 0, W, H); }
}

// ---- 02 roar
function drawRays(g, cx, cy, t, kick, alpha) {
  const n = 28, R = 2600;
  g.save(); g.translate(cx, cy); g.rotate(t * 0.22);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, w = 0.05 + (i % 2) * 0.03;
    const hue = 165 + ((i * 37 + t * 24) % 150);
    g.fillStyle = `hsla(${hue},85%,55%,${(0.05 + 0.08 * kick) * alpha})`;
    g.beginPath(); g.moveTo(0, 0);
    g.lineTo(Math.cos(a - w) * R, Math.sin(a - w) * R); g.lineTo(Math.cos(a + w) * R, Math.sin(a + w) * R);
    g.closePath(); g.fill();
  }
  g.restore();
}
function drawCountWord(g, word, x, y, u, size) {
  if (u < 0) return;
  const sc = kf(u, [[0, 0.2], [0.4, 1.32], [0.62, 0.93], [0.82, 1.08], [1, 1]]);
  const rot = kf(u, [[0, -3], [0.4, 5], [0.62, -5], [0.82, 3], [1, -3]]) * Math.PI / 180;
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(sc, sc); g.globalAlpha = clamp(u / 0.4);
  font(g, size, 400, "Kablammo"); g.textAlign = "center"; g.textBaseline = "middle"; g.letterSpacing = "2px";
  const k = size / 156;
  g.fillStyle = "rgba(0,0,0,.35)"; g.fillText(word, 0, 24 * k);
  g.fillStyle = "#ff2e63"; g.fillText(word, 12 * k, 12 * k);
  g.fillStyle = "#00d2ff"; g.fillText(word, -10 * k, 10 * k);
  g.lineJoin = "round"; g.lineWidth = 12 * k; g.strokeStyle = "#18122b"; g.strokeText(word, 0, 0);
  g.fillStyle = "#fff"; g.fillText(word, 0, 0);
  g.restore();
}
function drawBigNum(g, num, x, y, u, t) {
  if (u < 0) return;
  const sc = kf(u, [[0, 0.3], [0.35, 1.22], [1, 1]]), rot = kf(u, [[0, -6], [0.35, 3], [1, 0]]) * Math.PI / 180;
  const size = 300;
  g.save(); g.translate(x, y); g.rotate(rot); g.scale(sc, sc); g.globalAlpha = clamp(u / 0.35);
  font(g, size, 700); g.textAlign = "center"; g.textBaseline = "alphabetic";
  const gr = g.createLinearGradient(0, -size * 0.72, 0, 0);
  gr.addColorStop(0, "#ff6a6a"); gr.addColorStop(0.52, "#e0101f"); gr.addColorStop(1, "#7e0410");
  g.fillStyle = "rgba(0,0,0,.4)"; g.fillText(num, 9, 13);
  g.fillStyle = gr; g.fillText(num, 0, 0);
  // blood drips (site's .drips keyframes)
  const delays = [0, 0.55, 1.05, 0.3, 1.35], widths = [12, 9, 13, 8, 11];
  delays.forEach((d, i) => {
    const p = fr((t - d) / 1.9);
    const ty = kf(p, [[0, 0], [0.22, 6], [0.7, 58], [1, 150]]) * 1.3;
    const sy = kf(p, [[0, 0.4], [0.22, 1.5], [0.7, 2.3], [1, 1]]);
    const a = kf(p, [[0, 0], [0.22, 1], [0.7, 0.9], [1, 0]]);
    const dx = -110 + i * 55, w = widths[i] * 2, h = 13 * 2;
    g.save(); g.globalAlpha = a * clamp(u / 0.35); g.translate(dx, 10 + ty); g.scale(1, sy);
    const dg = g.createLinearGradient(0, 0, 0, h); dg.addColorStop(0, "#e01225"); dg.addColorStop(1, "#7e0410");
    g.fillStyle = dg; g.beginPath(); g.ellipse(0, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); g.fill();
    g.restore();
  });
  g.restore();
}
function heroSilhouette(t) {
  MA.__ground().visible = false;
  renderMonster(MA, HERO, t, 1, { x: 0, y: 0.3, z: 8.0, ly: 0.1 });
  const THREE = MA.__three(), cam = MA.__cam(), v = new THREE.Vector3();
  const eyes = MA.__eyes().map((e) => { e.group.getWorldPosition(v); v.project(cam); return [(v.x + 1) / 2 * MW, (1 - v.y) / 2 * MH]; });
  MA.__ground().visible = true;
  for (const [c, col] of [[SIL, "#07040f"], [SILC, "hsl(105,95%,55%)"]]) {
    const sg = g2d(c);
    sg.globalCompositeOperation = "source-over"; sg.clearRect(0, 0, MW, MH); sg.drawImage(CA, 0, 0);
    sg.globalCompositeOperation = "source-in"; sg.fillStyle = col; sg.fillRect(0, 0, MW, MH);
    sg.globalCompositeOperation = "source-over";
  }
  return eyes;
}
function drawCauldron(g, cx, cy, S, t, lvl) {
  g.save();
  const glow = 0.4 + 0.25 * Math.sin(t * 4.2) + lvl * 0.5;
  g.fillStyle = `hsla(${150 + 30 * Math.sin(t)},80%,55%,${0.12 + glow * 0.12})`;
  g.beginPath(); g.ellipse(cx, cy - 30 * S, (150 + glow * 30) * S, (90 + glow * 20) * S, 0, 0, Math.PI * 2); g.fill();
  const pg = g.createLinearGradient(cx - 150 * S, 0, cx + 150 * S, 0);
  pg.addColorStop(0, "#0d0a1c"); pg.addColorStop(0.45, "#2a2048"); pg.addColorStop(1, "#0b0816");
  g.fillStyle = pg; g.strokeStyle = "#5a4690"; g.lineWidth = 5;
  g.beginPath(); g.ellipse(cx, cy + 70 * S, 130 * S, 36 * S, 0, 0, Math.PI * 2); g.fill(); g.stroke();
  g.beginPath();
  g.moveTo(cx - 130 * S, cy + 70 * S);
  g.quadraticCurveTo(cx - 150 * S, cy - 40 * S, cx - 95 * S, cy - 56 * S);
  g.lineTo(cx + 95 * S, cy - 56 * S);
  g.quadraticCurveTo(cx + 150 * S, cy - 40 * S, cx + 130 * S, cy + 70 * S);
  g.closePath(); g.fill(); g.stroke();
  g.save(); g.clip();
  const hl = g.createLinearGradient(cx - 150 * S, 0, cx + 150 * S, 0);
  hl.addColorStop(0, "rgba(255,255,255,0)"); hl.addColorStop(0.22, "rgba(190,170,255,.16)"); hl.addColorStop(0.32, "rgba(255,255,255,0)");
  hl.addColorStop(0.8, "rgba(0,0,0,0)"); hl.addColorStop(1, "rgba(0,0,0,.35)");
  g.fillStyle = hl; g.fillRect(cx - 160 * S, cy - 70 * S, 320 * S, 160 * S);
  g.restore();
  g.lineWidth = 9; g.strokeStyle = "#6d58b0";
  g.beginPath(); g.ellipse(cx, cy - 55 * S, 104 * S, 25 * S, 0, 0, Math.PI * 2); g.stroke();
  const bg = g.createRadialGradient(cx, cy - 56 * S, 0, cx, cy - 56 * S, 95 * S);
  const hue = 120 + 40 * Math.sin(t * 0.8);
  bg.addColorStop(0, `hsl(${hue},90%,70%)`); bg.addColorStop(1, `hsl(${hue + 30},80%,38%)`);
  g.fillStyle = bg; g.shadowColor = `hsl(${hue},90%,55%)`; g.shadowBlur = 40;
  g.beginPath(); g.ellipse(cx, cy - 54 * S, 95 * S, 22 * S, 0, 0, Math.PI * 2); g.fill();
  g.shadowBlur = 0;
  for (let i = 0; i < 6; i++) {
    const ph = fr(t * 0.55 + i * 0.37);
    const bx = cx - 70 * S + fr(i * 0.31 + t * 0.07) * 140 * S, by = cy - 54 * S - ph * 70 * S;
    g.fillStyle = `hsla(${hue + i * 20},80%,75%,${0.7 * (1 - ph)})`;
    g.beginPath(); g.arc(bx, by, (5 + (i % 3) * 3) * S * 0.8, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}
function shotRoar(g, b, t) {
  const cx = 540;
  const inCount = b >= 17 && b < 22;
  const kick = b >= 16 ? env(fr(b), 3.2) : 0;
  const lvl = inCount ? env(fr(b), 2.4) * (0.6 + 0.4 * hash(Math.floor(b))) : 0.15;
  const growthBeat = clamp(b - 17 + 1);   // 0 at 16, 1 at 17, ... 5 at 21
  const gp = clamp((Math.floor(growthBeat) + outBack(clamp(fr(growthBeat) * 2.5), 2.2)) / 6);
  // camera kick per slice
  const shake = inCount ? env(fr(b), 6) * (6 + 2 * (b - 17)) : 0;
  g.fillStyle = "#05030c"; g.fillRect(0, 0, W, H);
  g.save();
  g.translate((hash(Math.floor(t * 30) * 1.1) - 0.5) * shake, (hash(Math.floor(t * 30) * 2.3) - 0.5) * shake);
  const bgr = g.createRadialGradient(cx, 980, 0, cx, 980, 1300);
  bgr.addColorStop(0, "#14223a"); bgr.addColorStop(1, "#02010a");
  g.fillStyle = bgr; g.fillRect(-40, -40, W + 80, H + 80);
  drawRays(g, cx, 980, t, kick, 1);
  // pulsing rings
  for (let r = 0; r < 3; r++) {
    const pr = fr(b + r / 3);
    g.strokeStyle = `hsla(${(160 + r * 60 + t * 20) % 360},90%,62%,${(1 - pr) * (0.18 + lvl * 0.4)})`;
    g.lineWidth = 6 + lvl * 18;
    g.beginPath(); g.arc(cx, 1000, pr * 820, 0, Math.PI * 2); g.stroke();
  }
  // sparks
  const sparks = 6 + Math.floor(lvl * 22);
  for (let i = 0; i < sparks; i++) {
    const fq = Math.floor(t * 12);
    const x = hash(fq * 3.1 + i) * W, y = 200 + hash(fq * 5.7 + i * 2) * 1500, s = (6 + hash(fq + i * 9) * 16) * (0.6 + lvl);
    g.fillStyle = `hsla(${hash(i + fq) * 360},90%,70%,${0.25 + lvl * 0.45})`;
    g.beginPath(); g.moveTo(x, y - s); g.lineTo(x + s * 0.25, y - s * 0.25); g.lineTo(x + s, y); g.lineTo(x + s * 0.25, y + s * 0.25);
    g.lineTo(x, y + s); g.lineTo(x - s * 0.25, y + s * 0.25); g.lineTo(x - s, y); g.lineTo(x - s * 0.25, y - s * 0.25); g.closePath(); g.fill();
  }
  // silhouette rising out of the cauldron (the hero, still dark)
  const potY = 1300, S = 2.1, brewY = potY - 54 * S;
  const eyes = heroSilhouette(t);
  const sc = lerp(0.42, 0.72, gp), dw = MW * sc, dh = MH * sc;
  const dx = cx - dw / 2, dy = brewY - dh * 0.7 + Math.sin(t * 1.8) * 6;
  g.save();
  const sm = g2d(SMALL); sm.clearRect(0, 0, SMALL.width, SMALL.height);
  sm.filter = "blur(5px)"; sm.drawImage(SILC, 0, 0, SMALL.width, SMALL.height); sm.filter = "none";
  g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.6 + 0.35 * lvl;
  g.drawImage(SMALL, dx, dy, dw, dh);
  g.restore();
  g.drawImage(SIL, dx, dy, dw, dh);
  const blink = (fr(t / 2.4) > 0.06) ? 1 : 0.1;
  g.save(); g.globalCompositeOperation = "lighter";
  for (const [ex, ey] of eyes) {
    const x = dx + ex * sc, y = dy + ey * sc, r = 26 * sc + 10;
    g.globalAlpha = 0.9 * blink; g.drawImage(SPRITES["200,255,90"], x - r * 2, y - r * 2, r * 4, r * 4);
    g.globalAlpha = blink; g.drawImage(SPRITES["255,255,220"], x - r * 0.45, y - r * 0.45, r * 0.9, r * 0.9);
  }
  g.restore();
  drawCauldron(g, cx, potY, S, t, lvl);
  // voice waveform
  const wy = 1545, wa = smooth(seg(b, 16.4, 17)) * (1 - smooth(seg(b, 21.8, 22)));
  if (wa > 0) {
    g.save(); g.globalAlpha = wa; g.lineWidth = 3.5; g.strokeStyle = MINT; g.shadowColor = "rgba(82,240,176,.8)"; g.shadowBlur = 16;
    for (const mir of [1, -0.45]) {
      g.beginPath();
      for (let i = 0; i <= 220; i++) {
        const u = i / 220, x = 110 + u * 860;
        const amp = (10 + 120 * lvl) * Math.sin(Math.PI * u) ** 1.5;
        const v = Math.sin(u * 46 + t * 17) * 0.55 + Math.sin(u * 113 - t * 23) * 0.3 + (hash(i * 1.7 + Math.floor(t * 30)) - 0.5) * 0.5;
        const y = wy + v * amp * mir;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.globalAlpha = wa * (mir > 0 ? 1 : 0.35); g.stroke();
    }
    g.restore();
    const rec = fr(t / 0.9) < 0.6 ? 1 : 0.25;
    g.save(); g.globalAlpha = wa * rec; g.fillStyle = "#ff2e4a"; g.shadowColor = "#ff2e4a"; g.shadowBlur = 12;
    g.beginPath(); g.arc(cx - 230, 1612, 9, 0, Math.PI * 2); g.fill(); g.restore();
    monoText(g, T.voice, cx + 12, 1622, { size: 24, ls: 5, alpha: wa * 0.85 });
  }
  g.restore();
  // header
  pill(g, `${T.step} 02`, 540, 250, outCubic(seg(b, 16.1, 16.6)));
  revealText(g, T.s2, 540, 372, { size: 88, glow: "rgba(82,240,176,.3)" }, seg(b, 16.2, 17.2));
  // countdown: GET READY on 16, then word + 5..1 on beats 17..21
  const countKick = (u) => ({ s: kf(u, [[0, 1], [0.28, 1.13], [0.58, 0.96], [1, 1]]), x: kf(u, [[0, 0], [0.28, 16], [0.58, -14], [1, 0]]), r: kf(u, [[0, 0], [0.28, 1], [0.58, -1], [1, 0]]) });
  const bi = Math.floor(b);
  if (b >= 16 && b < 22) {
    const u0 = (b - bi) * BEAT;
    const ck = countKick(clamp(u0 / 0.4));
    g.save(); g.translate(cx + ck.x, 760); g.rotate(ck.r * Math.PI / 180); g.scale(ck.s, ck.s); g.translate(-cx, -760);
    if (bi === 16) drawCountWord(g, T.ready, cx, 700, (b - 16.05) * BEAT / 0.46, 132);
    else {
      const i = bi - 17;
      drawCountWord(g, T.words[i % T.words.length], cx, 540, u0 / 0.46, 150);
      drawBigNum(g, String(5 - i), cx, 870, u0 / 0.65, t);
    }
    g.restore();
  }
  // 22.0–22.9: glitch (like the site's GLITCH_MS = 780ms), then silence + the eyes
  if (b >= 22 && b < 22.95) {
    g2d(TMP).drawImage(g.canvas, 0, 0);
    const amt = 0.55 + 0.45 * Math.sin(b * 41) ** 2;
    const f = Math.round(t * FPS);
    g.save(); g.translate((hash(f) - 0.5) * 14, (hash(f * 1.7) - 0.5) * 10);
    glitch(g, TMP, amt, f);
    g.restore();
    const gf = kf(seg(b, 22, 22.91), [[0, 1], [0.14, 0.25], [1, 0]]);
    g.fillStyle = `rgba(255,255,255,${gf})`; g.fillRect(0, 0, W, H);
  } else if (b >= 22.95) {
    g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
    let open = outCubic(seg(b, 23.1, 23.35)) * (1 - clamp(1 - Math.abs(b - 23.62) / 0.1));
    open *= 1 - smooth(seg(b, 23.82, 23.97));
    drawEyePair(g, 540, 900, 0.82, open, 1, 0);
  }
  if (b < 16.35) { g.fillStyle = `rgba(230,255,248,${1 - smooth(seg(b, 16, 16.35))})`; g.fillRect(0, 0, W, H); }
}

// ---- 03 reveal
const CONF = Array.from({ length: 220 }, (_, i) => ({
  x: hash(i * 1.1) * W, y: -20 - hash(i * 2.3) * H * 0.3, vx: (hash(i * 3.7) - 0.5) * 15, vy: 3 + hash(i * 4.1) * 9,
  rot: hash(i * 5.9) * 6, vr: (hash(i * 6.3) - 0.5) * 0.4, c: `hsl(${Math.floor(hash(i * 7.9) * 360)},85%,62%)`, s: 14 + hash(i * 8.3) * 18
}));
function drawConfetti(g, tSince) {
  if (tSince < 0) return;
  const n = tSince * 60;
  g.save();
  for (const c of CONF) {
    const y = c.y + c.vy * n + 0.12 * n * (n - 1);
    if (y > H + 40) continue;
    g.save(); g.translate(c.x + c.vx * n, y); g.rotate(c.rot + c.vr * n);
    g.fillStyle = c.c; g.fillRect(-c.s / 2, -c.s * 0.3, c.s, c.s * 0.6); g.restore();
  }
  g.restore();
}
function shotReveal(g, b, t) {
  const cx = 540, cy = 1000, t24 = 24 * BEAT, ts = t - t24;
  // the site's spinning conic reveal background
  const ang = t * (Math.PI * 2 / 10);
  const cg = g.createConicGradient(ang, cx, cy);
  ["#001234", "#003a7a", "#001a50", "#00558c", "#000e36", "#002c6c", "#001234"].forEach((c, i, a) => cg.addColorStop(i / (a.length - 1), c));
  g.fillStyle = cg; g.fillRect(0, 0, W, H);
  g.save(); g.globalCompositeOperation = "lighter";
  g.translate(cx, cy); g.rotate(-t * 0.08);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    g.fillStyle = "rgba(120,255,200,.035)";
    g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a - 0.07) * 2400, Math.sin(a - 0.07) * 2400); g.lineTo(Math.cos(a + 0.07) * 2400, Math.sin(a + 0.07) * 2400); g.fill();
  }
  g.restore();
  const lg = g.createRadialGradient(cx, cy - 40, 0, cx, cy - 40, 780);
  lg.addColorStop(0, "rgba(140,255,110,.34)"); lg.addColorStop(0.5, "rgba(60,200,140,.12)"); lg.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = lg; g.fillRect(0, 0, W, H);
  // monster
  const prog = clamp(ts / 0.72);
  const k = inOutSine(seg(b, 24, 31));
  renderMonster(MA, HERO, t, prog, { x: Math.sin((b - 24) * 0.33) * 1.5, y: 0.35, z: lerp(8.6, 7.3, k), ly: 0.1 });
  g.drawImage(CA, cx - MW / 2, cy - MH / 2);
  drawConfetti(g, ts);
  // shockwave + flash on the downbeat
  const sw = seg(b, 24, 24.9);
  if (sw > 0 && sw < 1) {
    g.save(); g.strokeStyle = `rgba(200,255,230,${1 - sw})`; g.lineWidth = lerp(70, 2, outCubic(sw));
    g.shadowColor = "rgba(82,240,176,.9)"; g.shadowBlur = 40;
    g.beginPath(); g.arc(cx, cy, outCubic(sw) * 1300, 0, Math.PI * 2); g.stroke(); g.restore();
  }
  pill(g, `${T.step} 03`, 540, 250, outCubic(seg(b, 25.2, 25.7)));
  revealText(g, T.s3, 540, 372, { size: 92, glow: "rgba(82,240,176,.35)" }, seg(b, 25.35, 26.5));
  monoText(g, T.s3sub, 540, 1640, { size: 26, ls: 5, alpha: smooth(seg(b, 26.5, 27.2)) * 0.85 });
  const fl = 1 - smooth(seg(b, 24, 24.4));
  if (fl > 0) { g.fillStyle = `rgba(240,255,250,${fl * 0.95})`; g.fillRect(0, 0, W, H); }
}

// ---- roster: one archetype per beat
function shotRoster(g, b, t, i) {
  const r = ROSTER[i], start = 31 + i, cx = 540, cy = 860;
  const inst = i % 2 === 0 ? MB : MA, canv = i % 2 === 0 ? CB : CA;
  const bg = g.createRadialGradient(cx, cy, 0, cx, cy, 1400);
  bg.addColorStop(0, `hsl(${r.hue},62%,20%)`); bg.addColorStop(0.55, `hsl(${r.hue + 18},70%,9%)`); bg.addColorStop(1, `hsl(${r.hue + 30},80%,3%)`);
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // giant outlined name drifting behind
  const name = T.names[r.type];
  g.save();
  font(g, 330, 700); g.textBaseline = "middle"; g.textAlign = "left"; g.letterSpacing = "6px";
  g.strokeStyle = `hsla(${r.hue},90%,75%,.11)`; g.lineWidth = 3;
  const tw = g.measureText(name + "  ").width;
  const off = -fr((t * 90 + i * 300) / tw) * tw;
  for (let k = -1; k < 3; k++) g.strokeText(name, off + k * tw, cy - 40);
  g.restore();
  // spotlight
  const sl = g.createRadialGradient(cx, cy - 80, 0, cx, cy - 80, 620);
  sl.addColorStop(0, `hsla(${r.hue},90%,70%,.26)`); sl.addColorStop(1, "hsla(0,0%,0%,0)");
  g.fillStyle = sl; g.fillRect(0, 0, W, H);
  drawSpores(g, t + i * 5, 0.5, 20);
  const prog = 0.5 + 0.5 * seg(b, start - 0.15, start + 0.5);
  const lb = b - start;
  renderMonster(inst, r.dna, t, prog, { x: Math.sin(lb * 0.9 + i) * 1.1, y: 0.4, z: r.z - 0.25 * lb, ly: r.ly });
  g.drawImage(canv, cx - MW / 2, cy - MH / 2);
  // labels
  const e = outCubic(seg(b, start - 0.05, start + 0.35));
  const num = String(ARCH.indexOf(r.type) + 1).padStart(2, "0");
  monoText(g, `${T.no} ${num} / 18`, cx, 1425, { size: 30, ls: 6, alpha: e * 0.9, color: `hsl(${r.hue},90%,78%)` });
  g.save();
  g.beginPath(); g.rect(0, 1436, W, 170); g.clip();
  font(g, name.length > 9 ? 104 : 124, 700); g.textAlign = "center"; g.textBaseline = "alphabetic"; g.letterSpacing = "4px";
  g.fillStyle = INK; g.shadowColor = `hsla(${r.hue},90%,60%,.6)`; g.shadowBlur = 30;
  g.fillText(name, cx, 1566 + (1 - e) * 150);
  g.restore();
}

// ---- grid of all 18
function shotGrid(g, b, t, hideCenter) {
  g.fillStyle = "#02060a"; g.fillRect(0, 0, W, H);
  const zs = lerp(1, 1.07, inOutSine(seg(b, 37, 40)));
  g.save(); g.translate(W / 2, H / 2); g.scale(zs, zs); g.translate(-W / 2, -H / 2);
  GRID.forEach((type, i) => {
    if (hideCenter && i === GRID_CENTER) return;
    const a = i === GRID_CENTER ? 37.5 : 37.04 + GRID_RANK[i] * 0.055;
    const p = seg(b, a, a + 0.32);
    if (p <= 0) return;
    const tl = gridTile(i), s = i === GRID_CENTER ? 1 : outBack(p, 2.0);
    const hue = (i * 47 + 120) % 360;
    g.save(); g.translate(tl.x + tl.w / 2, tl.y + tl.h / 2); g.scale(s, s);
    rrect(g, -tl.w / 2 + 8, -tl.h / 2 + 8, tl.w - 16, tl.h - 16, 30);
    const tg = g.createLinearGradient(0, -tl.h / 2, 0, tl.h / 2);
    tg.addColorStop(0, `hsl(${hue},48%,17%)`); tg.addColorStop(1, `hsl(${hue + 20},60%,7%)`);
    g.fillStyle = tg; g.fill(); g.strokeStyle = "rgba(255,255,255,.07)"; g.lineWidth = 2; g.stroke();
    const br = 1 + Math.sin(t * 3 + i) * 0.02;
    g.save(); g.clip();
    g.drawImage(SNAP[type], -150, -165 + 6, 300, 300 * br);
    g.restore();
    monoText(g, T.names[type], 0, tl.h / 2 - 22, { size: 17, ls: 3, alpha: 0.55, color: "#cfe" });
    g.restore();
  });
  g.restore();
  const dim = smooth(seg(b, 38.1, 38.5));
  if (dim > 0) {
    g.fillStyle = `rgba(0,4,8,${0.62 * dim})`; g.fillRect(0, 0, W, H);
    const k = [...T.g1];
    revealText(g, T.g1, 540, 930, { size: 150, weight: 700, glow: "rgba(0,0,0,.6)", glowBlur: 40 }, seg(b, 38.2, 38.95));
    revealText(g, T.g2, 540, 1060, { size: 70, color: SLIME, glow: "rgba(125,255,60,.55)" }, seg(b, 38.7, 39.5));
  }
}

// ---- the real site on a phone
let IMG = {};
function shotPhone(g, b, t) {
  g.drawImage(CAVE, 0, 0);
  drawCrystals(g, b, 1);
  drawSpores(g, t, 0.9, 36);
  const cx = 540, enter = outCubic(seg(b, 39.85, 40.6));
  const pw = 500, ph = 1064, py = 1145 + (1 - enter) * 820 + Math.sin(t * 1.4) * 8;
  const glow = g.createRadialGradient(cx, py, 0, cx, py, 760);
  glow.addColorStop(0, `rgba(82,240,176,${0.2 + 0.1 * heart(b)})`); glow.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = glow; g.fillRect(0, 0, W, H);
  g.save(); g.translate(cx, py); g.rotate(lerp(-0.1, -0.035, enter) + Math.sin(t * 0.9) * 0.008);
  g.shadowColor = "rgba(0,0,0,.7)"; g.shadowBlur = 80; g.shadowOffsetY = 40;
  rrect(g, -pw / 2, -ph / 2, pw, ph, 74); g.fillStyle = "#070a0c"; g.fill();
  g.shadowColor = "transparent";
  const eg = g.createLinearGradient(-pw / 2, -ph / 2, pw / 2, ph / 2);
  eg.addColorStop(0, "#5c6b70"); eg.addColorStop(0.5, "#1a2226"); eg.addColorStop(1, "#4a585c");
  g.lineWidth = 5; g.strokeStyle = eg; g.stroke();
  const sw = pw - 32, sh = ph - 32;
  rrect(g, -sw / 2, -sh / 2, sw, sh, 60); g.save(); g.clip();
  const img = b < 41.5 ? IMG.splash : IMG.reveal;
  const ir = img.width / img.height, sr = sw / sh;
  let iw = sw, ih = sh; if (ir > sr) iw = sh * ir; else ih = sw / ir;
  g.drawImage(img, -iw / 2, -ih / 2, iw, ih);
  const gl = bumpGlitch(b, 41.5);
  if (gl > 0) { g.fillStyle = `rgba(230,255,250,${gl * 0.8})`; g.fillRect(-sw / 2, -sh / 2, sw, sh); }
  const sheen = fr(t * 0.25);
  const shg = g.createLinearGradient(-sw, -sh / 2 + sheen * sh * 2 - sh, sw, sh / 2 + sheen * sh * 2 - sh);
  shg.addColorStop(0.42, "rgba(255,255,255,0)"); shg.addColorStop(0.5, "rgba(255,255,255,.07)"); shg.addColorStop(0.58, "rgba(255,255,255,0)");
  g.fillStyle = shg; g.fillRect(-sw / 2, -sh / 2, sw, sh);
  g.restore();
  rrect(g, -62, -sh / 2 + 18, 124, 34, 17); g.fillStyle = "#000"; g.fill();
  g.restore();
  // feature chips
  const chips = [[T.f1, 40.05, "check"], [T.f2, 41.0, "lock"], [T.f3a + T.f3b + T.f3c, 42.0, "mic"]];
  chips.forEach(([txt, at, icon], i) => {
    const p = outCubic(seg(b, at, at + 0.45));
    if (p <= 0) return;
    const y = 268 + i * 112, dir = i % 2 ? 1 : -1;
    g.save(); g.globalAlpha = p; g.translate(cx + dir * (1 - p) * 120, y);
    font(g, 44, 600); g.letterSpacing = "0px";
    const tw = g.measureText(txt).width, w = tw + 136, h = 90;
    rrect(g, -w / 2, -h / 2, w, h, h / 2);
    g.fillStyle = "rgba(0,14,22,.86)"; g.fill();
    g.lineWidth = 2; g.strokeStyle = "rgba(0,220,180,.45)"; g.stroke();
    const ix = -w / 2 + 50;
    g.fillStyle = MINT; g.beginPath(); g.arc(ix, 0, 25, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#04140f"; g.fillStyle = "#04140f"; g.lineWidth = 4.5; g.lineCap = "round"; g.lineJoin = "round";
    if (icon === "check") { g.beginPath(); g.moveTo(ix - 9, 1); g.lineTo(ix - 2, 8); g.lineTo(ix + 10, -7); g.stroke(); }
    if (icon === "lock") { rrect(g, ix - 9, -3, 18, 13, 3); g.fill(); g.lineWidth = 3.5; g.beginPath(); g.arc(ix, -4, 6, Math.PI, 0); g.stroke(); }
    if (icon === "mic") { rrect(g, ix - 5, -13, 10, 17, 5); g.fill(); g.lineWidth = 3; g.beginPath(); g.arc(ix, -3, 9, 0.15, Math.PI - 0.15); g.stroke(); g.beginPath(); g.moveTo(ix, 6); g.lineTo(ix, 12); g.stroke(); }
    g.textAlign = "left"; g.textBaseline = "middle";
    let x = -w / 2 + 96;
    if (icon === "mic") {
      for (const [s, col] of [[T.f3a, INK], [T.f3b, MINT], [T.f3c, INK]]) { g.fillStyle = col; g.fillText(s, x, 2); x += g.measureText(s).width; }
    } else { g.fillStyle = INK; g.fillText(txt, x, 2); }
    g.restore();
  });
}
const bumpGlitch = (b, at) => clamp(1 - Math.abs(b - at) / 0.12);

// ---- end card
const SPLASH_DOTS = [[0.32, -0.21, 26], [-0.31, -0.19, 22], [0.34, 0.15, 23], [-0.29, 0.17, 18], [0.15, -0.31, 16], [-0.13, -0.29, 14], [0, -0.35, 12], [0.4, -0.04, 14], [-0.39, 0.02, 16], [-0.2, -0.35, 10], [0.23, 0.29, 12]];
const SPLASH_DRIPS = [{ dx: -1.1, d: 0 }, { dx: -0.35, d: 0.35 }, { dx: 0.3, d: 0.65 }, { dx: 1.05, d: 0.15 }, { dx: -0.72, d: 0.8 }];
function shotEnd(g, b, t) {
  const cx = 540, cy = 760;
  g.drawImage(CAVE, 0, 0);
  g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(0, 0, W, H);
  drawCrystals(g, b, 0.8);
  drawSpores(g, t, 0.8, 30);
  const gl = g.createRadialGradient(cx, cy, 0, cx, cy, 820);
  gl.addColorStop(0, `rgba(125,255,60,${0.16 + 0.06 * heart(b)})`); gl.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gl; g.fillRect(0, 0, W, H);
  // goo splatter dots + drips (the site's idle splash)
  const burst = outExpo(seg(b, 43, 43.5));
  const gg = g2d(GOO);
  gg.clearRect(0, 0, W, H); gg.fillStyle = SLIME;
  SPLASH_DOTS.forEach(([dx, dy, r], i) => {
    const pulse = 1 + 0.22 * Math.sin(t / 0.55 + i * 1.4);
    gg.beginPath(); gg.arc(cx + dx * W * 1.25 * burst, cy + dy * 1400 * burst, r * 1.7 * pulse * (0.4 + 0.6 * burst), 0, Math.PI * 2); gg.fill();
  });
  const fs = 300, dripBase = cy + fs * 0.62;
  SPLASH_DRIPS.forEach(({ dx, d }) => {
    const p = fr(t / 2.2 + d), tipY = dripBase + p * 190 * burst, br = 12 + p * 8;
    gg.fillRect(cx + dx * fs - 9, dripBase, 18, Math.max(0, tipY - dripBase - br));
    gg.beginPath(); gg.arc(cx + dx * fs, tipY, br, 0, Math.PI * 2); gg.fill();
  });
  g.save(); g.globalAlpha = 0.72 * smooth(seg(b, 43, 43.15)); g.filter = "url(#goo) drop-shadow(0 0 22px rgba(125,255,60,.8))"; g.drawImage(GOO, 0, 0); g.restore();
  // logo
  const lp = seg(b, 43, 43.55);
  if (lp > 0) {
    const s = lerp(0.35, 1, outBack(lp, 1.9)) * (1 + 0.012 * heart(b)) * lerp(1, 1.04, seg(b, 43.5, 48));
    const rot = lerp(-0.14, 0, outCubic(lp)) + Math.sin(t * 2.1) * 0.01;
    const lw = 880, lh = lw * IMG.logo.height / IMG.logo.width;
    g.save(); g.translate(cx, cy); g.rotate(rot); g.scale(s, s);
    g.shadowColor = "rgba(126,240,96,.75)"; g.shadowBlur = 50 + 20 * heart(b);
    g.drawImage(IMG.logo, -lw / 2, -lh / 2, lw, lh);
    g.restore();
  }
  const sw = seg(b, 43, 43.8);
  if (sw > 0 && sw < 1) {
    g.save(); g.strokeStyle = `rgba(200,255,150,${1 - sw})`; g.lineWidth = lerp(50, 2, outCubic(sw));
    g.beginPath(); g.arc(cx, cy, outCubic(sw) * 1200, 0, Math.PI * 2); g.stroke(); g.restore();
  }
  revealText(g, T.tag, cx, 1215, { size: 64, glow: "rgba(82,240,176,.35)" }, seg(b, 44, 45));
  // CTA button in the site's button style
  const bp = seg(b, 45, 45.45);
  if (bp > 0) {
    const s = outBack(bp, 2.2), bw = 520, bh = 132, by = 1370;
    g.save(); g.translate(cx, by); g.scale(s, s);
    g.shadowColor = "rgba(82,240,176,.55)"; g.shadowBlur = 44 + 20 * heart(b);
    rrect(g, -bw / 2, -bh / 2 + 14, bw, bh, 36); g.fillStyle = "#0e201a"; g.fill();
    g.shadowBlur = 0;
    rrect(g, -bw / 2, -bh / 2, bw, bh, 36);
    const bgd = g.createLinearGradient(0, -bh / 2, 0, bh / 2); bgd.addColorStop(0, "#2f5d4a"); bgd.addColorStop(1, "#1c3a2e");
    g.fillStyle = bgd; g.fill(); g.lineWidth = 5; g.strokeStyle = "#5fe0a8"; g.stroke();
    font(g, 62, 700); g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = "#eafff5"; g.shadowColor = "rgba(95,224,168,.8)"; g.shadowBlur = 20;
    g.fillText(T.cta + "  ▶", 0, 4);
    g.restore();
  }
  const up = seg(b, 45.3, 46.3);
  if (up > 0) {
    const nChars = Math.floor(T.url.length * up);
    const cursor = fr(t / 0.7) < 0.55 ? "▍" : " ";
    monoText(g, T.url.slice(0, nChars), cx, 1540, { size: 40, ls: 1, color: MINT, glow: "rgba(82,240,176,.5)" });
    if (up < 1 || b < 47) {
      g.save(); font(g, 40, 700, "Space Mono"); g.letterSpacing = "1px";
      const fw = g.measureText(T.url).width, pw2 = g.measureText(T.url.slice(0, nChars)).width;
      g.fillStyle = MINT; g.globalAlpha = cursor === "▍" ? 0.9 : 0;
      g.fillRect(cx - fw / 2 + pw2 + 4, 1508, 18, 40); g.restore();
    }
  }
  monoText(g, T.foot, cx, 1612, { size: 22, ls: 4, alpha: 0.6 * smooth(seg(b, 46.2, 46.8)), color: "#9fd" });
  const fl = 1 - smooth(seg(b, 43, 43.3));
  if (fl > 0) { g.fillStyle = `rgba(240,255,235,${fl * 0.9})`; g.fillRect(0, 0, W, H); }
}

// ================================================================= TRANSITIONS
function whip(g, A, B, p, vertical) {
  const e = inOutCubic(p), speed = Math.sin(Math.PI * p);
  const N = speed > 0.15 ? 7 : 1, smear = speed * 260;
  g.save(); g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = "lighter"; g.globalAlpha = 1 / N;
  for (let k = 0; k < N; k++) {
    const o = (N > 1 ? k / (N - 1) - 0.5 : 0) * smear;
    const d = (vertical ? H : W) * e;
    if (vertical) { g.drawImage(A, 0, -d + o); g.drawImage(B, 0, H - d + o); }
    else { g.drawImage(A, -d + o, 0); g.drawImage(B, W - d + o, 0); }
  }
  g.restore();
}
function iris(g, A, B, p) {
  g.drawImage(A, 0, 0);
  const r = outCubic(p) * 1250;
  g.save(); g.beginPath(); g.arc(540, 900, r, 0, Math.PI * 2); g.clip(); g.drawImage(B, 0, 0); g.restore();
  g.save(); g.strokeStyle = `rgba(200,255,240,${1 - p})`; g.lineWidth = 10; g.shadowColor = MINT; g.shadowBlur = 30;
  g.beginPath(); g.arc(540, 900, r, 0, Math.PI * 2); g.stroke(); g.restore();
}
function gooMask(target, front, seed) {
  const gg = g2d(GOO); gg.clearRect(0, 0, W, H); gg.fillStyle = "#fff";
  const tips = [], cols = 11;
  for (let i = 0; i < cols; i++) {
    const x = (i + 0.5) * (W / cols) + (hash(i + seed) - 0.5) * 30, len = 140 + hash(i * 3.3 + seed) * 360, wcol = 74 + hash(i * 1.9 + seed) * 44;
    const yEnd = front + len;
    gg.fillRect(x - wcol / 2, -50, wcol, Math.max(0, yEnd + 50));
    gg.beginPath(); gg.arc(x, yEnd, wcol * 0.6, 0, Math.PI * 2); gg.fill();
    const dy = yEnd + 80 + hash(i * 5.1 + seed) * 110, dr = 16 + hash(i * 7 + seed) * 16;
    gg.beginPath(); gg.arc(x + (hash(i + seed * 2) - 0.5) * 24, dy, dr, 0, Math.PI * 2); gg.fill();
    tips.push([x, yEnd, wcol * 0.6], [x, dy, dr]);
  }
  gg.fillRect(0, -50, W, Math.max(0, front + 50));
  const m = g2d(target); m.clearRect(0, 0, W, H); m.filter = "url(#goo)"; m.drawImage(GOO, 0, 0); m.filter = "none";
  return tips;
}
function slimeWipe(g, A, B, p) {
  g.drawImage(A, 0, 0);
  const front = inOutSine(p) * (H + 1300) - 420;
  const tips = gooMask(GOO2, front, 0);
  const tg = g2d(TMP);
  tg.globalCompositeOperation = "source-over"; tg.clearRect(0, 0, W, H); tg.drawImage(GOO2, 0, 0);
  tg.globalCompositeOperation = "source-in";
  const sg = tg.createLinearGradient(0, front - 600, 0, front + 500);
  sg.addColorStop(0, "#2fb400"); sg.addColorStop(1, "#8dff4a");
  tg.fillStyle = sg; tg.fillRect(0, 0, W, H); tg.globalCompositeOperation = "source-over";
  g.save(); g.shadowColor = "rgba(8,50,0,.85)"; g.shadowOffsetY = 16; g.shadowBlur = 10; g.drawImage(TMP, 0, 0); g.restore();
  g.save(); g.fillStyle = "rgba(255,255,255,.55)";
  for (const [x, y, r] of tips) { g.beginPath(); g.ellipse(x - r * 0.32, y - r * 0.3, r * 0.22, r * 0.14, -0.5, 0, Math.PI * 2); g.fill(); }
  g.restore();
  // the next shot follows behind the slime front
  gooMask(GOO2, front - 480, 7);
  tg.clearRect(0, 0, W, H); tg.drawImage(B, 0, 0); tg.globalCompositeOperation = "destination-in"; tg.drawImage(GOO2, 0, 0); tg.globalCompositeOperation = "source-over";
  g.drawImage(TMP, 0, 0);
}
function zoomThrough(g, A, B, p) {
  const e = inOutCubic(p);
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  g.save(); g.globalAlpha = smooth(seg(p, 0.25, 0.8));
  const sb = lerp(0.72, 1, outCubic(seg(p, 0.25, 1)));
  g.translate(540, 900); g.scale(sb, sb); g.translate(-540, -900); g.drawImage(B, 0, 0); g.restore();
  g.save(); g.globalAlpha = 1 - smooth(seg(p, 0.2, 0.7));
  const sa = 1 + inCubic(e) * 2.2;
  g.filter = `blur(${(e * 16).toFixed(1)}px)`;
  g.translate(540, 900); g.scale(sa, sa); g.translate(-540, -900); g.drawImage(A, 0, 0); g.restore();
  const fl = clamp(1 - Math.abs(p - 0.45) / 0.25) * 0.45;
  if (fl > 0) { g.fillStyle = `rgba(240,255,250,${fl})`; g.fillRect(0, 0, W, H); }
}
function toGrid(g, A, B, p) {
  g.drawImage(B, 0, 0);
  const e = inOutCubic(p), tl = gridTile(GRID_CENTER);
  const zs = lerp(1, 1.07, inOutSine(seg(37 + p * 0.5, 37, 40)));
  const tx = (tl.x + tl.w / 2 - W / 2) * zs + W / 2, ty = (tl.y + tl.h / 2 - H / 2) * zs + H / 2;
  const s = lerp(1, 0.4 * zs, e);
  const x0 = lerp(0, tx - (tl.w / 2 - 8) * zs, e), y0 = lerp(0, ty - (tl.h / 2 - 8) * zs, e);
  const x1 = lerp(W, tx + (tl.w / 2 - 8) * zs, e), y1 = lerp(H, ty + (tl.h / 2 - 8) * zs, e);
  g.save(); rrect(g, x0, y0, x1 - x0, y1 - y0, lerp(0, 30 * zs, e)); g.clip();
  g.translate(lerp(540, tx, e), lerp(900, ty - 10, e)); g.scale(s, s); g.translate(-540, -900);
  g.drawImage(A, 0, 0); g.restore();
}

// ================================================================= TIMELINE
// shots and the cuts between them (beats)
const SHOTS = [
  { from: 0, draw: shotIntro }, { from: 8, draw: shotScan }, { from: 16, draw: shotRoar }, { from: 24, draw: shotReveal },
  ...ROSTER.map((_, i) => ({ from: 31 + i, draw: (g, b, t) => shotRoster(g, b, t, i) })),
  { from: 37, draw: (g, b, t) => shotGrid(g, b, t, false) }, { from: 40, draw: shotPhone }, { from: 43, draw: shotEnd }
];
const CUTS = {
  31: { pre: 0.15, post: 0.15, fx: (g, A, B, p) => whip(g, A, B, p, false) },
  32: { pre: 0.04, post: 0.32, fx: iris },
  33: { pre: 0.5, post: 0.55, fx: slimeWipe },
  34: { pre: 0.07, post: 0.1, fx: null },
  35: { pre: 0.15, post: 0.15, fx: (g, A, B, p) => whip(g, A, B, p, true) },
  36: { pre: 0.2, post: 0.16, fx: zoomThrough },
  37: { pre: 0.0, post: 0.5, fx: toGrid, nextDraw: (g, b, t) => shotGrid(g, b, t, true) },
  40: { pre: 0.15, post: 0.15, fx: (g, A, B, p) => whip(g, A, B, p, true) }
};

function compose(g, b, t, f) {
  let idx = 0;
  for (let i = 0; i < SHOTS.length; i++) if (b >= SHOTS[i].from) idx = i;
  for (const [at, c] of Object.entries(CUTS)) {
    const a = +at;
    if (b >= a - c.pre && b < a + c.post) {
      const pi = SHOTS.findIndex((s) => s.from === a);
      const prev = SHOTS[pi - 1], next = SHOTS[pi];
      const p = (b - (a - c.pre)) / (c.pre + c.post);
      prev.draw(g2d(L1), b, t);
      (c.nextDraw || next.draw)(g2d(L2), b, t);
      if (c.fx) { c.fx(g, L1, L2, p, t); return; }
      // glitch cut
      g2d(TMP).drawImage(p < 0.5 ? L1 : L2, 0, 0);
      glitch(g, TMP, clamp(1 - Math.abs(p - 0.5) * 1.6), f);
      return;
    }
  }
  SHOTS[idx].draw(g, b, t);
}

function post(g, b, f) {
  g.save();
  g.drawImage(VIGNETTE, 0, 0);
  g.globalCompositeOperation = "overlay"; g.globalAlpha = 0.09;
  const gt = GRAIN[f % GRAIN.length], ox = Math.floor(hash(f * 1.3) * 512), oy = Math.floor(hash(f * 2.9) * 512);
  for (let y = -oy; y < H; y += 512) for (let x = -ox; x < W; x += 512) g.drawImage(gt, x, y);
  g.restore();
  const fo = smooth(seg(b, 47.3, 48));
  if (fo > 0) { g.fillStyle = `rgba(0,0,0,${fo})`; g.fillRect(0, 0, W, H); }
}

function renderFrame(f) {
  const t = f / FPS, b = t / BEAT;
  ctx.save();
  compose(ctx, b, t, f);
  ctx.restore();
  post(ctx, b, f);
}

// ================================================================= boot
async function boot() {
  const fams = ["600 100px Fredoka", "700 100px Fredoka", "500 100px Fredoka", "400 100px Kablammo", "700 40px 'Space Mono'", "400 40px 'Space Mono'"];
  await Promise.all(fams.map((f) => document.fonts.load(f, "AaÆØÅæøå!→·…▶▍0123456789")));
  await document.fonts.ready;
  const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const [logo, splash, reveal, face] = await Promise.all([
    loadImg("../monster-builder-splash.png"), loadImg("assets/site_splash.jpg"), loadImg("assets/site_reveal.jpg"),
    fetch("assets/face_mesh.json").then((r) => r.json())
  ]);
  IMG = { logo, splash, reveal };
  prepFace(face);
  CAVE = buildCave(); VIGNETTE = buildVignette(); SCANLINES = buildScanlines();
  GRAIN = [0, 1, 2, 3].map(buildGrain);
  for (const rgb of [...SPORE_COLS, "160,255,60", "200,255,90", "255,255,220", "230,255,250"]) SPRITES[rgb] = glowSprite(rgb);
  CA = mk(MW, MH); CB = mk(MW, MH); CT = mk(400, 400);
  MA = await loadInstance(CA, MW, MH);
  MB = await loadInstance(CB, MW, MH);
  MT = await loadInstance(CT, 400, 400);
  GRID.forEach((type, i) => {
    renderMonster(MT, gridDNA(type, i), 2 + i * 0.37, 1, { x: 0, y: 0.35, z: type === "snake" || type === "jelly" || type === "octopus" ? 8.4 : 7.6, ly: -0.05 });
    const c = mk(400, 400); g2d(c).drawImage(CT, 0, 0); SNAP[type] = c;
  });
  // warm up the shaders of both large instances
  renderMonster(MA, HERO, 0, 1, {}); renderMonster(MB, ROSTER[0].dna, 0, 1, {});
}

window.FILM = {
  FPS, FRAMES, W, H, LANG,
  ready: boot().then(() => true),
  render(f) { renderFrame(f); },
  async frameJPEG(f, q = 0.95) { renderFrame(f); return out.toDataURL("image/jpeg", q); }
};
