// Monster Builder — fuld sekvens.
// Ansigt (skjult) -> 5 sek bryle-eksplosion (5 lyd-skiver) -> glitch -> stort monster paa regnbue.
// On-device. Intet billede/lyd gemmes — kun geometriske + lyd-features. Blendshapes FRA.

const CDN = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const SLICES = 5;
const SLICE_MS = 1000;
const ROAR_MS = SLICES * SLICE_MS;
const SCAN_MS = 3000;
const GLITCH_MS = 780;
const GATE = 0.06;

const TRANSLATIONS = {
  da: {
    words:       ["RÅB!", "SKRIG!", "BRØL!", "SKRIG!"],
    getReady:    "GØR KLAR!",
    loading:     "Henter model (første gang ~et par sek)...",
    asking:      "Beder om kamera + mikrofon...",
    promptStart: "Sig MONSTER! for at starte 👹",
    error:       (msg) => `Fejl: ${msg}  •  Åbn via http://localhost og tillad kamera + mikrofon.`,
    holdFace:    "Hold ansigtet stille...",
    makeSounds:  "LAV LYDE! 🔊",
    yourMonster: "Dit monster! 🎉",
    pressStart:  "Tryk Start, scan vi dit ansigt.",
    speechLang:  "da-DK",
    tagline:     "Scan dit ansigt, og råb alt hvad du kan i 5 sek — Så har du født et monster",
    scanLabel:   "Scanner ansigt",
    sayWord:     "Sig",
    recBtn:      "Lav lyd",
    againBtn:    "Nyt monster",
    title:       "Monster Builder — bryl monsteret frem",
    privacy:     `<b>Privatliv:</b> alt afvikles i din browser. Hverken billede eller lyd gemmes eller sendes — kun scan af ansigtets form, lydens styrke/tonehoejde. Ingen ansigtsgenkendelse, ingen følelsesaflæsning. Monsterets brøl er en ny lyd, der laves ud fra dine lyd-data.`
  },
  en: {
    words:       ["ROAR!", "SCREAM!", "ROAR!", "SCREAM!"],
    getReady:    "GET READY!",
    loading:     "Loading model (first time ~a few sec)...",
    asking:      "Asking for camera + microphone...",
    promptStart: "Say MONSTER! to start 👹",
    error:       (msg) => `Error: ${msg}  •  Open via http://localhost and allow camera + microphone.`,
    holdFace:    "Hold your face still...",
    makeSounds:  "MAKE SOUNDS! 🔊",
    yourMonster: "Your monster! 🎉",
    pressStart:  "Press Start, and we'll scan your face.",
    speechLang:  "en-US",
    tagline:     "Scan your face and scream as loud as you can for 5 seconds and you've created a monster",
    scanLabel:   "Scanning face",
    sayWord:     "Say",
    recBtn:      "Make sound",
    againBtn:    "New monster",
    title:       "Monster Builder — brew the monster",
    privacy:     `<b>Privacy:</b> Everything is processed in your browser. Neither images nor audio are stored or transmitted—only a scan of the shape of your face and the volume and pitch of your voice. No facial recognition, no emotion detection. The monster's roar is a new sound generated from your audio data.`
  }
};

let lang = (() => {
  const saved = localStorage.getItem("mb-lang");
  return saved ? saved : "en";
})();
const t = (key) => TRANSLATIONS[lang][key];

const L = {
  faceTop: 10, chin: 152, cheekR: 234, cheekL: 454,
  rEyeOut: 33, rEyeIn: 133, rEyeTop: 159, rEyeBot: 145,
  lEyeIn: 362, lEyeOut: 263, lEyeTop: 386, lEyeBot: 374,
  mouthR: 61, mouthL: 291, lipTop: 13, lipBot: 14
};

const $ = (id) => document.getElementById(id);
const video = $("video");
const canvas = $("fx");
const ctx = canvas.getContext("2d");
const camPanel = $("camPanel");
const magic = $("magic");
const revealBg = $("revealBg");
const glitch = $("glitch");
const countEl = $("count");
const shoutEl = $("shout");
const bignumEl = $("bignum");
const promptEl = $("prompt");
const statusEl = $("status");
const startBtn = $("startBtn");
const recBtn = $("recBtn");
const againBtn = $("againBtn");
const voicePrompt = $("voice-prompt");
const langBtn = $("langBtn");
const splashImg = $("splashImg");
const splashWrap = $("splashWrap");
const shLm = $("shLm");
const shBio = $("shBio");
const shDna = $("shDna");
const scanBarFill = $("scanBarFill");

let W = 700, H = 520;

let state = "idle";
let faceLandmarker = null;
let vstream = null, lastVideoTime = -1;
let audioCtx = null, analyser = null, timeBuf = null, freqBuf = null;

let roarStart = 0, sliceIdx = 0;
const base = { body: 0.5, eye: 0.5, gap: 0.5, mouth: 0.5, hue: 200, captured: false };
let scanStart = 0, scanFrames = 0;
const acc = { body: 0, eye: 0, gap: 0, mouth: 0, hue: 0 };

const parts = [];
const orbs = [];        // animerede kugler der flyver i gryden
const confetti = [];
let recStart = 0;
let rec = null;
let liveLevel = 0;
let revealStart = 0;
let aggBright = 0.5, aggLoud = 0.5, aggRough = 0.3, aggN = 0;
let menace = 0.5;
let creature = null;

// ---- 3D monster (Three.js) pilot ----
const canvas3d = $("fx3d");
const PILOT_3D = new Set(["blob", "multihead", "octopus", "beast", "fish", "bird", "worm", "alien",
  "crab", "dragon", "eyeball", "jelly", "virus", "bacteria", "snake", "scorpion", "dino", "cell"]);
let m3dMod = null;
let m3dState = "none";          // none | loading | ready | failed
function dnaSnapshot() { return { base, parts, creature, menace, voice: { loud: aggLoud, rough: aggRough, bright: aggBright } }; }
function ensure3D() {
  if (m3dState !== "none") return;
  m3dState = "loading";
  import("./monster3d.js").then(mod => {
    m3dMod = mod; mod.init(canvas3d); mod.resize(W, H); m3dState = "ready";
  }).catch(e => { console.warn("3D monster load failed → 2D fallback", e); m3dState = "failed"; });
}
function hide3D() {
  if (canvas3d) canvas3d.style.display = "none";
  if (m3dState === "ready" && m3dMod) m3dMod.clear();
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const invlerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOutBack = (x) => { const c = 2.2; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
function status(m) { statusEl.textContent = m; }
function setPrompt(m) { promptEl.textContent = m; }

function applyLang() {
  document.documentElement.lang = lang;
  document.title = t("title");
  $("tagline").innerHTML = t("tagline");
  $("scanLabel").textContent = t("scanLabel");
  $("voiceWord").textContent = t("sayWord");
  recBtn.textContent = t("recBtn");
  againBtn.textContent = t("againBtn");
  $("privacyText").innerHTML = t("privacy");
  langBtn.textContent = lang === "da" ? "EN" : "DA";
  if (state === "idle") setPrompt(t("pressStart"));
}

function setupCanvas() {
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * scale;
  canvas.height = H * scale;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

function sizeStage(full) {
  if (full) { W = Math.round(window.innerWidth); H = Math.round(window.innerHeight); }
  else { W = 700; H = 520; }
  setupCanvas();
  if (m3dState === "ready" && m3dMod) m3dMod.resize(W, H);
}

// ---------------- model ----------------
async function loadModel() {
  const vision = await import(CDN);
  const { FaceLandmarker, FilesetResolver } = vision;
  const fileset = await FilesetResolver.forVisionTasks(`${CDN}/wasm`);
  faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false
  });
}

// ---------------- audio ----------------
function initAudio(stream) {
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === "suspended") audioCtx.resume();
  const src = audioCtx.createMediaStreamSource(stream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.4;
  src.connect(analyser);
  timeBuf = new Uint8Array(analyser.fftSize);
  freqBuf = new Uint8Array(analyser.frequencyBinCount);
}

function tone(freq, dur, type = "sine", vol = 0.18, slideTo = null) {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime;
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.linearRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(audioCtx.destination);
  o.start(t0); o.stop(t0 + dur);
}
function noiseBurst(dur, vol = 0.3, hp = 600) {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime;
  const n = Math.floor(audioCtx.sampleRate * dur);
  const buf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const s = audioCtx.createBufferSource(); s.buffer = buf;
  const f = audioCtx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp;
  const g = audioCtx.createGain(); g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f).connect(g).connect(audioCtx.destination);
  s.start(t0); s.stop(t0 + dur);
}
function roar() {
  if (!audioCtx) return;
  const f = lerp(70, 240, aggBright);
  tone(f, 0.8, "sawtooth", 0.22, f * 0.6);
  tone(f * 1.5, 0.8, "square", 0.12, f * 0.9);
  noiseBurst(0.5, 0.18, 300);
}

// ---------------- face features ----------------
function px(lm, i) { return { x: lm[i].x * video.videoWidth, y: lm[i].y * video.videoHeight }; }
function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function mid(lm, i, j) { return { x: (lm[i].x + lm[j].x) / 2 * video.videoWidth, y: (lm[i].y + lm[j].y) / 2 * video.videoHeight }; }

function sampleFace(lm) {
  const fw = dist(px(lm, L.cheekR), px(lm, L.cheekL));
  const fh = dist(px(lm, L.faceTop), px(lm, L.chin));
  if (fw < 1 || fh < 1) return;
  const eo = (dist(px(lm, L.rEyeTop), px(lm, L.rEyeBot)) + dist(px(lm, L.lEyeTop), px(lm, L.lEyeBot))) / 2;
  const io = dist(mid(lm, L.rEyeOut, L.rEyeIn), mid(lm, L.lEyeIn, L.lEyeOut));
  const mw = dist(px(lm, L.mouthR), px(lm, L.mouthL));
  acc.body += invlerp(0.66, 0.95, fw / fh);
  acc.eye += invlerp(0.02, 0.07, eo / fh);
  acc.gap += invlerp(0.33, 0.52, io / fw);
  acc.mouth += invlerp(0.30, 0.55, mw / fw);
  scanFrames++;
}

// ---------------- audio features per round ----------------
function sampleAudio() {
  analyser.getByteTimeDomainData(timeBuf);
  analyser.getByteFrequencyData(freqBuf);
  let sum = 0;
  for (let i = 0; i < timeBuf.length; i++) { const v = (timeBuf[i] - 128) / 128; sum += v * v; }
  const rms = Math.sqrt(sum / timeBuf.length);
  liveLevel = lerp(liveLevel, clamp(rms / 0.4, 0, 1), 0.35);

  let mag = 0, cen = 0, hi = 0;
  const binHz = audioCtx.sampleRate / analyser.fftSize;
  for (let i = 1; i < freqBuf.length; i++) {
    const m = freqBuf[i];
    mag += m; cen += i * binHz * m;
    if (i * binHz > 2000) hi += m;
  }
  const centroid = mag > 0 ? cen / mag : 0;
  const hiRatio = mag > 0 ? hi / mag : 0;

  rec.frames++;
  rec.peak = Math.max(rec.peak, rms);
  if (rms > GATE) {
    rec.active++;
    rec.cSum += invlerp(150, 4000, centroid) * rms;
    rec.cW += rms;
    rec.hSum += hiRatio;
    if (!rec.prevOver) rec.onsets++;
    rec.prevOver = true;
  } else {
    rec.prevOver = false;
  }
}

function featuresFromRec() {
  const loud = clamp(rec.peak / 0.4, 0, 1);
  const bright = rec.cW > 0 ? clamp(rec.cSum / rec.cW, 0, 1) : 0.5;
  const rough = rec.active > 0 ? clamp(rec.hSum / rec.active, 0, 1) : 0.3;
  const bursts = clamp(rec.onsets, 1, 5);
  const dur = rec.frames > 0 ? rec.active / rec.frames : 0;
  return { loud, bright, rough, bursts, dur };
}

function partFromFeatures(f, idx) {
  // Fordel typer rundtom baseret paa indeks + features — undgaar at alt bliver "limb"
  // naar barnet broeler i eet straek (dur er altid hoj)
  const cycle = ["spike", "bump", "limb", "spike", "bump"][idx % 5];
  let type;
  if (f.bright > 0.68) type = "spike";
  else if (f.bright < 0.32) type = "bump";
  else type = cycle;                // midterzone: brug rotationen
  aggBright = (aggBright * aggN + f.bright) / (aggN + 1);
  aggLoud   = (aggLoud   * aggN + f.loud)   / (aggN + 1);
  aggRough  = (aggRough  * aggN + f.rough)  / (aggN + 1);
  aggN++;
  return {
    type,
    size:  lerp(0.55, 1.4, f.loud),
    count: type === "limb" ? 1 : clamp(Math.round(f.bursts), 1, 4),
    rough: f.rough > 0.45,
    hue:   (base.hue + (f.bright - 0.5) * 140 + 360) % 360,
    idx
  };
}

// ---------------- flow ----------------
async function start() {
  startBtn.disabled = true;
  splashWrap.style.display = "none";
  resetData();
  try {
    status(t("loading"));
    if (!faceLandmarker) await loadModel();
    status(t("asking"));
    vstream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: 640, height: 480 }, audio: true
    });
    initAudio(vstream);
    startBtn.style.display = "none";
    status("");
    startRound();
  } catch (e) {
    status(t("error")(e.message));
    startBtn.disabled = false;
  }
}

function resetData() {
  parts.length = 0; orbs.length = 0; confetti.length = 0;
  acc.body = acc.eye = acc.gap = acc.mouth = 0; scanFrames = 0;
  aggBright = 0.5; aggLoud = 0.5; aggRough = 0.3; aggN = 0; menace = 0.5; creature = null;
  sliceIdx = 0; rec = null;
  base.captured = false;
}

// startRound genbruger den eksisterende stream — ingen ny getUserMedia,
// ingen knap-tryk. Kaldes fra stemme-genkendelses-handleren og knappen.
function startRound() {
  resetData();
  stopKeywordWatch();
  // Gå ud af fuldskærm og reset visuals
  revealBg.classList.remove("on");
  magic.classList.remove("full");
  againBtn.classList.remove("float");
  againBtn.style.display = "none";
  countEl.style.display = "none";
  hide3D();
  sizeStage(false);

  // Fejlhåndtering: stream er lukket (meget sjælden) — fuld genstart
  if (!vstream || !vstream.active) { start(); return; }

  // Genaktivér video-track (blev deaktiveret i finishScan)
  vstream.getVideoTracks().forEach(t => { t.enabled = true; });
  video.srcObject = vstream;
  if (video.paused) video.play().catch(() => {});

  // Genoptag AudioContext hvis browseren har suspenderet den
  if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();

  camPanel.style.display = "";
  lastVideoTime = -1;
  state = "scanning";
  scanStart = performance.now();
  setPrompt(t("holdFace"));
  status("");
  // reset + start HUD
  shLm.textContent = "— pt";
  shBio.textContent = "READING…";
  shBio.className = "sh-val sh-blink";
  shDna.textContent = "0%";
  scanBarFill.style.setProperty("--scan-ms", SCAN_MS + "ms");
  scanBarFill.classList.remove("go");
  void scanBarFill.offsetWidth;   // force reflow to restart animation
  scanBarFill.classList.add("go");
}

function finishScan() {
  if (scanFrames > 5) {
    base.body = acc.body / scanFrames;
    base.eye = acc.eye / scanFrames;
    base.gap = acc.gap / scanFrames;
    base.mouth = acc.mouth / scanFrames;
    base.hue = (base.body * 200 + base.gap * 160) % 360;
  } else {
    base.hue = Math.random() * 360; // intet ansigt fanget — tilfaeldig krop, demo stopper aldrig
  }
  base.captured = true;
  // Deaktivér kamera-track (slukker kamera-lyset) men stop IKKE stream —
  // vi genbruger den i næste runde uden ny getUserMedia.
  if (vstream) vstream.getVideoTracks().forEach(t => { t.enabled = false; });
  camPanel.style.display = "none";
  noiseBurst(0.12, 0.25, 1200);
  recBtn.style.display = "none";
  getReady();           // ingen knap — sekvensen starter selv
}

function getReady() {
  state = "getready";
  magic.classList.add("full");      // fuldskaerm allerede her, saa skyggen har plads
  sizeStage(true);
  liveLevel = 0;
  countEl.style.display = "flex";
  bignumEl.textContent = "";
  shoutEl.textContent = t("getReady");
  shoutEl.classList.remove("pop"); void shoutEl.offsetWidth; shoutEl.classList.add("pop");
  countEl.classList.remove("kick"); void countEl.offsetWidth; countEl.classList.add("kick");
  setPrompt("");
  status("");
  tone(180, 1.2, "sawtooth", 0.07, 720);   // riser
  setTimeout(startRoar, 1300);
}

function freshRec() { return { frames: 0, peak: 0, active: 0, cSum: 0, cW: 0, hSum: 0, onsets: 0, prevOver: false }; }

function startRoar() {
  if (state !== "getready") return;
  state = "roar";
  recBtn.style.display = "none";
  countEl.style.display = "flex";
  roarStart = performance.now();
  sliceIdx = 0;
  startSlice(0);
  tone(660, 0.14, "triangle", 0.2);                  // GO!
  tone(150, ROAR_MS / 1000, "sawtooth", 0.05, 540);  // lav rumlen under det hele
  setPrompt("");
  status(t("makeSounds"));
}

function startSlice(i) {
  rec = freshRec();
  liveLevel = 0;
  const words = t("words"); shoutEl.textContent = words[i % words.length];
  bignumEl.textContent = String(SLICES - i);         // 5,4,3,2,1
  shoutEl.classList.remove("pop"); void shoutEl.offsetWidth; shoutEl.classList.add("pop");
  bignumEl.classList.remove("pulse"); void bignumEl.offsetWidth; bignumEl.classList.add("pulse");
  countEl.classList.remove("kick"); void countEl.offsetWidth; countEl.classList.add("kick");
  tone(300 + i * 90, 0.16, "square", 0.16);
}

function finalizeSlice() {
  if (!rec) return;
  if (rec.peak > GATE * 1.3) {                        // kun en del hvis skiven havde lyd
    const f = featuresFromRec();
    const p = partFromFeatures(f, parts.length);
    parts.push(p);
    orbs.push({ t: 0, hue: p.hue, from: Math.min(parts.length - 1, 4) });
    tone(520 + parts.length * 70, 0.16, "sine", 0.18, 760);
  }
  rec = null;
}

function endRoar() {
  countEl.style.display = "none";
  if (parts.length === 0) {                           // helt stille barn -> stadig et monster
    parts.push({ type: "bump", size: 1, count: 2, rough: false, hue: (base.hue + 120) % 360, idx: 0 });
  }
  doGlitch();
}

function doGlitch() {
  state = "glitch";
  glitch.classList.add("on");
  noiseBurst(GLITCH_MS / 1000, 0.35, 200);
  tone(120, 0.2, "square", 0.2);
  tone(1500, 0.2, "sawtooth", 0.12, 200);
  setTimeout(reveal, GLITCH_MS);
}

// ---------------- stemme-genstart ----------------
let speechRec = null;

function startKeywordWatch() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return;
  try {
    speechRec = new SR();
    speechRec.lang = t("speechLang");
    speechRec.continuous = true;
    speechRec.interimResults = true;
    speechRec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const txt = e.results[i][0].transcript.toLowerCase().replace(/\s+/g,"");
        if (txt.includes("monster")) { stopKeywordWatch(); startRound(); return; }
      }
    };
    // Genstart efter stilhed (~7 sek i Chrome) — virker i begge ventende states
    speechRec.onend = () => {
      if ((state === "reveal" || state === "listening") && speechRec) {
        try { speechRec.start(); } catch(_) {}
      }
    };
    speechRec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        speechRec = null;
      }
    };
    speechRec.start();
    // voicePrompt vises kun under fuldskærms-reveal — under listening bruger vi #prompt
    if (state === "reveal") voicePrompt.classList.add("on");
  } catch(_) { speechRec = null; }
}

function stopKeywordWatch() {
  voicePrompt.classList.remove("on");
  if (!speechRec) return;
  speechRec.onend = null; // forhindr auto-genstart
  try { speechRec.stop(); } catch(_) {}
  speechRec = null;
}

function reveal() {
  glitch.classList.remove("on");
  state = "reveal";
  magic.classList.add("full");                 // monsteret fylder hele skaermen
  sizeStage(true);
  revealBg.classList.add("on");
  revealStart = performance.now();
  // hvor "farligt": jo mere barnet broelede + jo ruere lyd, jo vildere monster
  menace = clamp(aggLoud * 0.7 + aggRough * 0.7, 0, 1);
  creature = buildCreature();
  if (PILOT_3D.has(creature.type)) ensure3D();
  for (let i = 0; i < 220; i++) {
    confetti.push({
      x: Math.random() * W,
      y: -20 - Math.random() * H * 0.3,
      vx: (Math.random() - 0.5) * 10,
      vy: 2 + Math.random() * 6,
      rot: Math.random() * 6,
      vr: (Math.random() - 0.5) * 0.4,
      c: `hsl(${Math.random() * 360},85%,62%)`,
      s: 9 + Math.random() * 12
    });
  }
  roar();
  setPrompt("");
  status(t("yourMonster"));
  againBtn.style.display = "";
  againBtn.classList.add("float");
  setTimeout(startKeywordWatch, 1500);
}

// ---------------- render ----------------
function drawRoarFX(t) {
  const cx = W / 2, cy = H / 2, lvl = liveLevel, hueBase = (t / 8) % 360;
  // roterende fartstriber (comic speed-lines)
  const lines = 28, maxR = Math.hypot(W, H);
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(t / 2500);
  for (let i = 0; i < lines; i++) {
    const a = (i / lines) * Math.PI * 2, hue = (hueBase + i * 18) % 360, w1 = 0.05 + (i % 2) * 0.03;
    ctx.fillStyle = `hsla(${hue},85%,60%,${0.08 + lvl * 0.2})`;
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a - w1) * maxR, Math.sin(a - w1) * maxR);
    ctx.lineTo(Math.cos(a + w1) * maxR, Math.sin(a + w1) * maxR);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  // pulserende ringe der reagerer paa lydstyrken
  for (let r = 0; r < 3; r++) {
    const pr = ((t / 600 + r / 3) % 1), rad = pr * Math.min(W, H) * 0.6;
    ctx.strokeStyle = `hsla(${(hueBase + r * 90) % 360},90%,62%,${(1 - pr) * (0.25 + lvl * 0.45)})`;
    ctx.lineWidth = 6 + lvl * 16;
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.stroke();
  }
  // gnister / grafisk larm (flimrer, mere jo hoejere der broeles)
  const sparks = 12 + Math.floor(lvl * 34);
  for (let i = 0; i < sparks; i++) {
    const x = Math.random() * W, y = Math.random() * H, s = 4 + Math.random() * 11 * (0.5 + lvl);
    ctx.fillStyle = `hsla(${Math.random() * 360},90%,66%,${0.3 + lvl * 0.5})`;
    ctx.beginPath();
    ctx.moveTo(x, y - s); ctx.lineTo(x + s * 0.3, y - s * 0.3); ctx.lineTo(x + s, y);
    ctx.lineTo(x + s * 0.3, y + s * 0.3); ctx.lineTo(x, y + s); ctx.lineTo(x - s * 0.3, y + s * 0.3);
    ctx.lineTo(x - s, y); ctx.lineTo(x - s * 0.3, y - s * 0.3); ctx.closePath(); ctx.fill();
  }
}

function drawSilhouette(t, cx, cy) {
  if (!base.captured) return;
  const grow = parts.length / SLICES;                 // 0..1, vokser pr. lyd
  const R = 50 + grow * 34;
  const aspect = lerp(0.85, 1.35, base.body);
  const rx = R * Math.sqrt(aspect);
  const ry = R / Math.sqrt(aspect);
  const bx = cx, by = cy - 100 - grow * 20 + Math.sin(t / 520) * 4;  // svaever og stiger
  const wob = Math.sin(t / 430);
  const dark = "rgba(9,6,18,.93)";
  const rim = `hsla(${base.hue},75%,55%,.45)`;

  // moerke lemmer (stubbe)
  parts.filter(p => p.type === "limb").forEach((p, i) => {
    const a = (-Math.PI / 2) + (i % 2 === 0 ? -1 : 1) * (0.9 + i * 0.12);
    const ex = bx + Math.cos(a) * rx, ey = by + Math.sin(a) * ry;
    const len = p.size * R * 0.9;
    ctx.strokeStyle = dark; ctx.lineCap = "round"; ctx.lineWidth = 13;
    ctx.beginPath(); ctx.moveTo(ex, ey);
    ctx.lineTo(ex + Math.cos(a) * len + wob * 6, ey + Math.sin(a) * len); ctx.stroke();
  });

  // krop
  blob(bx, by, rx, ry, base.gap * 7, t);
  ctx.fillStyle = dark; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = rim; ctx.stroke();

  // moerke pigge/bumser
  const deco = parts.filter(p => p.type !== "limb");
  deco.forEach((p, i) => {
    const baseAng = (-130 + (deco.length === 1 ? 65 : (i / (deco.length - 1)) * 90)) * Math.PI / 180 + Math.PI;
    for (let j = 0; j < p.count; j++) {
      const a = baseAng + (j - (p.count - 1) / 2) * 0.22;
      const ex = bx + Math.cos(a) * rx, ey = by + Math.sin(a) * ry;
      ctx.fillStyle = dark; ctx.strokeStyle = rim; ctx.lineWidth = 2;
      if (p.type === "spike") {
        const len = p.size * R * 0.5, nx = Math.cos(a), ny = Math.sin(a), tx = -ny, tyy = nx, w = 8 + p.size * 5;
        ctx.beginPath();
        ctx.moveTo(ex + tx * w, ey + tyy * w);
        ctx.lineTo(ex + nx * len, ey + ny * len);
        ctx.lineTo(ex - tx * w, ey - tyy * w);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      } else {
        const rr = 8 + p.size * 10;
        ctx.beginPath(); ctx.arc(ex, ey, rr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
  });

  // lysende oejne i moerket (teaser — sjaeldent blink, ingen rigtige oejne endnu)
  const er = lerp(3, 6, base.eye), gap = lerp(0.2, 0.46, base.gap) * rx, ey = by - ry * 0.18;
  const blink = (Math.sin(t / 1600) > -0.96) ? 1 : 0.15;
  ctx.save();
  ctx.shadowColor = `hsl(${(base.hue + 40) % 360},90%,65%)`; ctx.shadowBlur = 14;
  ctx.fillStyle = `hsl(${(base.hue + 40) % 360},90%,72%)`; ctx.globalAlpha = blink;
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(bx + s * gap / 2, ey, er, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
}

function drawCauldron(t, shake) {
  const cx = W / 2, cy = H * 0.52;
  const sx = shake ? (Math.random() - 0.5) * shake : 0;
  const sy = shake ? (Math.random() - 0.5) * shake : 0;
  ctx.save(); ctx.translate(sx, sy);

  // glow
  const glow = 0.4 + 0.25 * Math.sin(t / 240) + liveLevel * 0.5;
  ctx.fillStyle = `hsla(${(t / 20) % 360}, 80%, 60%, ${0.18 + glow * 0.18})`;
  ctx.beginPath(); ctx.ellipse(cx, cy - 30, 150 + glow * 30, 90 + glow * 20, 0, 0, Math.PI * 2); ctx.fill();

  // gryde
  ctx.fillStyle = "#241a3a"; ctx.strokeStyle = "#5a4690"; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.ellipse(cx, cy + 70, 130, 36, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 130, cy + 70);
  ctx.quadraticCurveTo(cx - 150, cy - 40, cx - 95, cy - 56);
  ctx.lineTo(cx + 95, cy - 56);
  ctx.quadraticCurveTo(cx + 150, cy - 40, cx + 130, cy + 70);
  ctx.closePath(); ctx.fill(); ctx.stroke();

  // silhuet-teaser: monsteret-under-opbygning stiger op af gryden (moerkt, ingen farver/ansigt)
  drawSilhouette(t, cx, cy);

  // brygget overflade
  ctx.fillStyle = `hsl(${(t / 15) % 360}, 70%, 55%)`;
  ctx.beginPath(); ctx.ellipse(cx, cy - 54, 95, 22, 0, 0, Math.PI * 2); ctx.fill();
  // bobler
  for (let i = 0; i < 5; i++) {
    const bx = cx - 70 + ((t / 6 + i * 130) % 140);
    const by = cy - 54 - ((t / 4 + i * 90) % 70);
    ctx.fillStyle = `hsla(${(t / 15 + i * 40) % 360},80%,75%,${0.7 - ((t / 4 + i * 90) % 70) / 100})`;
    ctx.beginPath(); ctx.arc(bx, by, 5 + (i % 3) * 3, 0, Math.PI * 2); ctx.fill();
  }
  // damp der sloerer silhuetten (holder paa mystikken)
  for (let i = 0; i < 4; i++) {
    const phase = (t / 1400 + i * 0.27) % 1;
    const sxp = cx - 50 + i * 34 + Math.sin(t / 600 + i) * 10;
    const syp = (cy - 60) - phase * 120;
    ctx.fillStyle = `rgba(220,210,255,${0.16 * (1 - phase)})`;
    ctx.beginPath(); ctx.ellipse(sxp, syp, 26 + phase * 18, 18 + phase * 14, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  // flyvende kugler
  for (let k = orbs.length - 1; k >= 0; k--) {
    const o = orbs[k];
    o.t += 0.04;
    const p = Math.min(o.t, 1);
    const startX = 120 + o.from * 150, startY = 60;
    const ox = lerp(startX, cx, p);
    const oy = lerp(startY, cy - 54, p) - Math.sin(p * Math.PI) * 70;
    ctx.fillStyle = `hsl(${o.hue},85%,62%)`;
    ctx.beginPath(); ctx.arc(ox, oy, lerp(16, 4, p), 0, Math.PI * 2); ctx.fill();
    if (p >= 1) orbs.splice(k, 1);
  }

  // mikrofon-ring der pulserer med lydstyrken
  if (state === "roar") {
    ctx.strokeStyle = `hsl(${140 + liveLevel * 80}, 85%, 62%)`;
    ctx.lineWidth = 7; ctx.beginPath();
    ctx.arc(cx, cy - 54, 50 + liveLevel * 70, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function blob(cx, cy, rx, ry, seed, t) {
  const N = 30; ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const w = Math.sin(a * 3 + seed) * 0.05 + Math.sin(t / 700 + a * 2 + seed) * 0.03;
    const x = cx + Math.cos(a) * rx * (1 + w);
    const y = cy + Math.sin(a) * ry * (1 + w);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}
// ---------------- generativ skabning ----------------
// ================================================================
//  GENERATIVT MONSTER-SYSTEM  —  12 arketyper
// ================================================================
function srand(n){const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x);}
function makeRng(seed){let s=((Math.floor(seed)%233280)+233280)%233280||1;return()=>{s=(s*9301+49297)%233280;return s/233280;};}

// ---- arketype-valg ----
const ARCHETYPES = ["blob","multihead","octopus","beast","fish","bird","worm","alien","crab","dragon","eyeball","jelly","virus","bacteria","snake","scorpion","dino","cell"];

function buildCreature(){
  let sn=Math.floor(base.body*97+base.gap*131+base.mouth*89+base.eye*53+parts.length*23);
  parts.forEach((p,i)=>{sn+=Math.floor(p.hue+p.size*60+p.count*11)*(i+2);});
  const rng=makeRng(sn+7);
  const pick=a=>a[Math.floor(rng()*a.length)];
  const type=ARCHETYPES[Math.floor(rng()*ARCHETYPES.length)];
  return{
    type,rng,sn,
    heads:      pick([2,2,3]),
    eyeCount:   pick([1,2,2,2,3]),
    tentacles:  4+Math.floor(rng()*5),
    hornStyle:  pick(["curved","curved","none"]),
    armLen:     0.8+rng()*0.6,
    spotMode:   pick(["spots","spots","stripes","none"]),
    tailLen:    0.7+rng()*0.8,
    feathers:   5+Math.floor(rng()*5),
    segments:   4+Math.floor(rng()*4),
    antennae:   2+Math.floor(rng()*3),
    fins:       3+Math.floor(rng()*4),
    coils:      3+Math.floor(rng()*3),
    spikes:     6+Math.floor(rng()*10),
    pseudopods: 5+Math.floor(rng()*5),
  };
}

function drawMonsterBig(t){
  if(!creature)creature=buildCreature();
  const prog=Math.min((t-revealStart)/720,1);

  if (m3dState === "ready") {
    if (canvas3d.style.display !== "block") canvas3d.style.display = "block";
    m3dMod.build(dnaSnapshot());
    m3dMod.render(t, prog, menace);
  }

  for(let k=confetti.length-1;k>=0;k--){
    const c=confetti[k];
    c.x+=c.vx;c.y+=c.vy;c.vy+=.18;c.rot+=c.vr;
    ctx.save();ctx.translate(c.x,c.y);ctx.rotate(c.rot);
    ctx.fillStyle=c.c;ctx.fillRect(-c.s/2,-c.s/2,c.s,c.s*.6);ctx.restore();
    if(c.y>H+30)confetti.splice(k,1);
  }
}

// ---------------- idle splash ----------------
let _splashGC = null;

const SPLASH_DOTS = [
  [0.32, -0.21, 26], [-0.31, -0.19, 22], [0.34, 0.15, 23], [-0.29, 0.17, 18],
  [0.15, -0.31, 16], [-0.13, -0.29, 14], [0, -0.35, 12],
  [0.40, -0.04, 14], [-0.39, 0.02, 16], [-0.20, -0.35, 10], [0.23, 0.29, 12]
];

const SPLASH_DRIPS = [
  {dx: -1.1, d: 0}, {dx: -0.35, d: 0.35}, {dx: 0.3, d: 0.65},
  {dx: 1.05, d: 0.15}, {dx: -0.72, d: 0.8}
];

function drawIdleSplash(t) {
  ctx.clearRect(0, 0, W, H);

  const cx = W / 2, cy = H * 0.46;
  const fs = Math.min(W / 4.0, H / 3.0, 130);
  const dripBaseY = cy + fs * 1.14;

  if (!_splashGC || _splashGC.width !== canvas.width || _splashGC.height !== canvas.height) {
    _splashGC = document.createElement('canvas');
    _splashGC.width = canvas.width;
    _splashGC.height = canvas.height;
  }
  const gc = _splashGC;
  const gx = gc.getContext('2d');
  const dpr = canvas.width / W;
  gx.clearRect(0, 0, gc.width, gc.height);
  gx.save();
  gx.scale(dpr, dpr);
  gx.fillStyle = '#7dff3c';

  // Pulsing splatter dots
  SPLASH_DOTS.forEach(([dx, dy, r], i) => {
    const pulse = 1 + 0.22 * Math.sin(t / 550 + i * 1.4);
    gx.beginPath();
    gx.arc(cx + dx * W, cy + dy * H, r * pulse, 0, Math.PI * 2);
    gx.fill();
  });

  // Animated drips
  SPLASH_DRIPS.forEach(({dx, d}) => {
    const p = ((t / 2200 + d) % 1);
    const tipY = dripBaseY + p * H * 0.28;
    const br   = 7 + p * 6;
    const stemH = Math.max(0, tipY - dripBaseY - br);
    gx.fillRect(cx + dx * fs - 5, dripBaseY, 10, stemH);
    gx.beginPath();
    gx.arc(cx + dx * fs, dripBaseY + stemH + br, br, 0, Math.PI * 2);
    gx.fill();
  });

  gx.restore();

  // Composite with goo filter for slimy merge effect
  ctx.save();
  ctx.filter = 'blur(10px) contrast(22)';
  ctx.drawImage(gc, 0, 0, W, H);
  ctx.restore();
}

function mainLoop() {
  const t = performance.now();

  if (state === "scanning") {
    let faceDetected = false;
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const res = faceLandmarker.detectForVideo(video, t);
      if (res.faceLandmarks && res.faceLandmarks.length) {
        sampleFace(res.faceLandmarks[0]);
        faceDetected = true;
        const lmCount = res.faceLandmarks[0].length;
        shLm.textContent = lmCount + " pt";
      }
    }
    const pct = Math.min(100, Math.round((t - scanStart) / SCAN_MS * 100));
    shDna.textContent = pct + "%";
    if (faceDetected) {
      shBio.textContent = "FACE LOCKED";
      shBio.className = "sh-val sh-face-ok";
    } else if (shBio.textContent === "READING…" || shBio.className.includes("sh-blink")) {
      shBio.textContent = "READING…";
      shBio.className = "sh-val sh-blink";
    }
    if (t - scanStart > SCAN_MS) finishScan();
  }
  if (state === "roar") {
    const elapsed = t - roarStart;
    const idx = Math.min(SLICES - 1, Math.floor(elapsed / SLICE_MS));
    if (idx !== sliceIdx) { finalizeSlice(); sliceIdx = idx; startSlice(idx); }
    sampleAudio();
    if (elapsed >= ROAR_MS) { finalizeSlice(); endRoar(); }
  }

  ctx.clearRect(0, 0, W, H);
  if (state === "reveal") {
    drawMonsterBig(t);
  } else if (state === "glitch") {
    // overlay klarer det visuelle
  } else if (state === "roar" || state === "getready") {
    drawRoarFX(t);
    drawCauldron(t, state === "roar" ? 4 + liveLevel * 8 : 0);
  } else if (state === "idle") {
    drawIdleSplash(t);
  } else {
    drawCauldron(t, 0);
  }
  requestAnimationFrame(mainLoop);
}

// ---------------- wire ----------------
startBtn.addEventListener("click", start);
recBtn.addEventListener("click", startRoar);
function backToStart() {
  stopKeywordWatch();
  if (vstream) vstream.getTracks().forEach(tr => tr.stop());
  vstream = null;
  if (audioCtx) { audioCtx.close(); audioCtx = null; analyser = null; }
  revealBg.classList.remove("on");
  magic.classList.remove("full");
  againBtn.classList.remove("float");
  againBtn.style.display = "none";
  recBtn.style.display = "none";
  countEl.style.display = "none";
  camPanel.style.display = "none";
  sizeStage(false);
  resetData();
  state = "idle";
  startBtn.style.display = "";
  startBtn.disabled = false;
  startBtn.textContent = "Start";
  splashWrap.style.display = "flex";
  setPrompt(t("pressStart"));
  status("");
}

againBtn.addEventListener("click", () => {
  if (vstream && vstream.active) startRound();
  else backToStart();
});

setupCanvas();
ensure3D();
window.addEventListener("resize", () => sizeStage(state === "reveal"));
langBtn.addEventListener("click", () => {
  lang = lang === "da" ? "en" : "da";
  localStorage.setItem("mb-lang", lang);
  applyLang();
});
splashImg.addEventListener("click", start);
const SPLASH_FX = ["splash-fx-slime","splash-fx-glitch","splash-fx-pulse"];
splashImg.addEventListener("mouseenter", () => {
  splashImg.classList.remove(...SPLASH_FX);
  splashImg.classList.add(SPLASH_FX[Math.floor(Math.random() * SPLASH_FX.length)]);
});
splashImg.addEventListener("mouseleave", () => splashImg.classList.remove(...SPLASH_FX));
splashWrap.style.display = "flex";
applyLang();
requestAnimationFrame(mainLoop);

// ---- DEV: ?type=blob|beast|eyeball|dragon... jumps straight to a reveal with
// synthetic DNA so the 3D look can be inspected without camera + mic.
(function debugReveal() {
  const q = new URLSearchParams(location.search);
  const forced = q.get("type");
  if (!forced) return;
  const num = (k, d) => { const v = parseFloat(q.get(k)); return Number.isFinite(v) ? v : d; };
  base.body = num("body", 0.5); base.eye = num("eye", 0.5); base.gap = num("gap", 0.5);
  base.mouth = num("mouth", 0.6); base.hue = num("hue", 200); base.captured = true;
  menace = num("menace", 0.5);
  aggLoud = num("loud", menace); aggRough = num("rough", menace); aggBright = num("bright", 0.5);
  parts.length = 0;
  creature = buildCreature();
  creature.type = forced;
  if (PILOT_3D.has(forced)) ensure3D();
  splashWrap.style.display = "none";
  startBtn.style.display = "none";
  magic.classList.add("full");
  revealBg.classList.add("on");
  sizeStage(true);
  revealStart = performance.now();
  state = "reveal";
})();
