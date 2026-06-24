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
  return (saved || navigator.language || "en").toLowerCase().startsWith("da") ? "da" : "en";
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
  splashImg.style.display = "none";
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

function drawBigShadow(t) {
  if (!base.captured) return;
  const grow = parts.length / SLICES;                  // vokser pr. lyd
  const cx = W / 2, cy = H * 0.6;
  const R = Math.min(W, H) * (0.17 + grow * 0.09);
  const aspect = lerp(0.85, 1.3, base.body);
  const wob = Math.sin(t / 480) * 0.02;
  const rx = R * Math.sqrt(aspect) * (1 + wob);
  const ry = R / Math.sqrt(aspect) * (1 - wob);
  const hue = base.hue, dark = "rgba(10,6,20,.9)", rim = `hsla(${hue},80%,60%,.5)`;

  // aura bag skyggen (pulserer med lydstyrken)
  const ag = ctx.createRadialGradient(cx, cy, R * 0.3, cx, cy, R * 1.9);
  ag.addColorStop(0, `hsla(${(t / 12) % 360},85%,55%,${0.12 + liveLevel * 0.28})`);
  ag.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = ag;
  ctx.beginPath(); ctx.arc(cx, cy, R * 1.9, 0, Math.PI * 2); ctx.fill();

  // arme (moerke)
  parts.filter(p => p.type === "limb").forEach((p, i) => {
    const a = (-Math.PI / 2) + (i % 2 === 0 ? -1 : 1) * (0.9 + i * 0.12);
    const ex = cx + Math.cos(a) * rx, ey = cy + Math.sin(a) * ry, len = p.size * R;
    ctx.strokeStyle = dark; ctx.lineCap = "round"; ctx.lineWidth = R * 0.13;
    ctx.beginPath(); ctx.moveTo(ex, ey);
    ctx.lineTo(ex + Math.cos(a) * len + Math.sin(t / 300 + i) * R * 0.06, ey + Math.sin(a) * len); ctx.stroke();
  });

  // horn (moerke, paa toppen)
  parts.filter(p => p.type === "spike").slice(0, 2).forEach((p, i) => {
    const dir = i ? 1 : -1, hx = cx + dir * rx * 0.42, hy = cy - ry * 0.6, hlen = R * (0.5 + p.size * 0.4);
    ctx.fillStyle = dark; ctx.strokeStyle = rim; ctx.lineWidth = R * 0.012;
    ctx.beginPath();
    ctx.moveTo(hx - dir * R * 0.1, hy);
    ctx.quadraticCurveTo(hx + dir * R * 0.05, hy - hlen * 0.6, hx + dir * R * 0.14, hy - hlen);
    ctx.quadraticCurveTo(hx + dir * R * 0.12, hy - hlen * 0.5, hx + dir * R * 0.1, hy);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  });

  // krop
  blob(cx, cy, rx, ry, base.gap * 7, t);
  ctx.fillStyle = dark; ctx.fill();
  ctx.lineWidth = R * 0.03; ctx.strokeStyle = rim; ctx.stroke();

  // bumser (moerke)
  parts.filter(p => p.type === "bump").forEach((p, i) => {
    const baseAng = (-120 + i * 50) * Math.PI / 180 + Math.PI;
    for (let j = 0; j < p.count; j++) {
      const a = baseAng + (j - (p.count - 1) / 2) * 0.26;
      const ex = cx + Math.cos(a) * rx * 0.95, ey = cy + Math.sin(a) * ry * 0.95, rr = R * (0.07 + p.size * 0.06);
      ctx.fillStyle = dark; ctx.strokeStyle = rim; ctx.lineWidth = R * 0.01;
      ctx.beginPath(); ctx.arc(ex, ey, rr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  });

  // lysende oejne (teaser — ingen rigtige oejne endnu)
  const er = R * 0.1, gap = lerp(0.22, 0.5, base.gap) * rx, ey = cy - ry * 0.22;
  const blink = (Math.sin(t / 1500) > -0.95) ? 1 : 0.12;
  ctx.save();
  ctx.shadowColor = `hsl(${(hue + 40) % 360},90%,65%)`; ctx.shadowBlur = 26;
  ctx.fillStyle = `hsl(${(hue + 40) % 360},92%,72%)`; ctx.globalAlpha = blink;
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(cx + s * gap / 2, ey, er, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
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

// ================================================================
//  DELTE TEGNE-PRIMITIVER
// ================================================================
function eyeball(x,y,r,hue,m,t){
  ctx.fillStyle="rgba(0,0,0,.16)";
  ctx.beginPath();ctx.ellipse(x,y+r*.14,r*1.14,r*1.14,0,0,Math.PI*2);ctx.fill();
  const sg=ctx.createRadialGradient(x-r*.32,y-r*.38,r*.2,x,y,r);
  sg.addColorStop(0,"#ffffff");sg.addColorStop(.7,"#f2f3f8");sg.addColorStop(1,"#c7cad9");
  ctx.fillStyle=sg;ctx.strokeStyle=`hsl(${hue},45%,20%)`;ctx.lineWidth=r*.12;
  ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.stroke();
  const gx=Math.sin(t/900)*r*.16,gy=Math.cos(t/1100)*r*.1,ir=r*.64,ih=(hue+175)%360;
  const ig=ctx.createRadialGradient(x+gx,y+gy-ir*.2,ir*.15,x+gx,y+gy,ir);
  ig.addColorStop(0,`hsl(${ih},85%,66%)`);ig.addColorStop(.7,`hsl(${ih},80%,46%)`);ig.addColorStop(1,`hsl(${ih},78%,26%)`);
  ctx.fillStyle=ig;ctx.beginPath();ctx.arc(x+gx,y+gy,ir,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle=`hsl(${ih},75%,20%)`;ctx.lineWidth=r*.05;ctx.beginPath();ctx.arc(x+gx,y+gy,ir,0,Math.PI*2);ctx.stroke();
  ctx.fillStyle="#0a0c12";ctx.beginPath();ctx.ellipse(x+gx,y+gy,ir*lerp(.5,.28,m),ir*.66,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="rgba(255,255,255,.97)";ctx.beginPath();ctx.arc(x+gx-ir*.34,y+gy-ir*.38,r*.17,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="rgba(255,255,255,.55)";ctx.beginPath();ctx.arc(x+gx+ir*.28,y+gy+ir*.22,r*.08,0,Math.PI*2);ctx.fill();
  ctx.save();ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.clip();
  ctx.fillStyle="rgba(0,0,0,.14)";ctx.beginPath();ctx.ellipse(x,y-r*.55,r*.98,r*.5,0,0,Math.PI*2);ctx.fill();ctx.restore();
}

function brow(x,y,er,hue,m,s){
  ctx.strokeStyle=`hsl(${hue},50%,16%)`;ctx.lineWidth=er*.32;ctx.lineCap="round";
  const by=y-er*1.15,inner=lerp(.1,.7,m);
  ctx.beginPath();ctx.moveTo(x-s*er*.7,by-er*.05);ctx.quadraticCurveTo(x,by-er*(inner+.1),x+s*er*.7,by-er*inner);ctx.stroke();
}

function drawMouth(cx,my,mw,mh,hue,m){
  const mg=ctx.createRadialGradient(cx,my+mh*.2,mh*.1,cx,my,mw*.5);
  mg.addColorStop(0,"#2a0710");mg.addColorStop(.6,"#5e0f1f");mg.addColorStop(1,"#8a1828");
  ctx.fillStyle=mg;ctx.strokeStyle=`hsl(${hue},50%,18%)`;ctx.lineWidth=mw*.04;
  ctx.beginPath();ctx.ellipse(cx,my,mw*.5,mh,0,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.save();ctx.beginPath();ctx.ellipse(cx,my,mw*.5,mh,0,0,Math.PI*2);ctx.clip();
  const tg=ctx.createRadialGradient(cx,my+mh*.55,mh*.1,cx,my+mh*.6,mw*.4);
  tg.addColorStop(0,"#ff7d92");tg.addColorStop(1,"#d23a55");
  ctx.fillStyle=tg;ctx.beginPath();ctx.ellipse(cx,my+mh*.55,mw*.34,mh*.6,0,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle="rgba(150,20,40,.6)";ctx.lineWidth=mw*.02;
  ctx.beginPath();ctx.moveTo(cx,my+mh*.15);ctx.lineTo(cx,my+mh*.95);ctx.stroke();
  ctx.fillStyle="#f6f0e2";ctx.strokeStyle="rgba(120,90,60,.35)";ctx.lineWidth=mw*.01;
  for(let i=0;i<6;i++){
    const tx=cx-mw*.44+(i/5)*mw*.88,big=(i===1||i===4),tl=big?mh*(1+m):mh*(.5+srand(i+cx*.01)*.2),ww=mw*(big?.07:.055);
    ctx.beginPath();ctx.moveTo(tx-ww,my-mh);ctx.lineTo(tx+ww,my-mh);
    ctx.lineTo(tx+ww*.5,my-mh+tl);ctx.quadraticCurveTo(tx,my-mh+tl+mw*.01,tx-ww*.5,my-mh+tl);
    ctx.closePath();ctx.fill();ctx.stroke();
  }
  for(let i=0;i<4;i++){
    const tx=cx-mw*.34+(i/3)*mw*.68,big=(i===0||i===3),tl=big?mh*(.85+m*.7):mh*.45,ww=mw*.05;
    ctx.beginPath();ctx.moveTo(tx-ww,my+mh);ctx.lineTo(tx+ww,my+mh);ctx.lineTo(tx,my+mh-tl);ctx.closePath();ctx.fill();
  }
  ctx.restore();
}

function drawFace(cx,cy,r,hue,m,t,eyeCount){
  if(eyeCount===1){
    const er=r*.5;eyeball(cx,cy-r*.08,er,hue,m,t);brow(cx,cy-r*.08,er,hue,m,1);
  }else if(eyeCount===2){
    const er=r*.36,g=r*.7;
    eyeball(cx-g/2,cy-r*.06,er,hue,m,t);eyeball(cx+g/2,cy-r*.03,er*.9,hue,m,t);
    brow(cx-g/2,cy-r*.06,er,hue,m,-1);brow(cx+g/2,cy-r*.03,er*.9,hue,m,1);
  }else{
    const er=r*.3,g=r*.8;
    eyeball(cx-g/2,cy-r*.12,er,hue,m,t);eyeball(cx+g/2,cy-r*.1,er*.92,hue,m,t);eyeball(cx,cy+r*.06,er*.8,hue,m,t);
  }
  drawMouth(cx,cy+r*.55,r*1.0,r*.4*(1+m*.25),hue,m);
}

function horn(hx,hy,dir,scale,ph,m,R){
  const baseW=R*.13*scale,hlen=R*(.42+.34*scale+m*.35);
  const cxx=hx+dir*R*.13,tipx=hx+dir*R*.18,tipy=hy-hlen;
  const g=ctx.createLinearGradient(hx,hy,tipx,tipy);
  g.addColorStop(0,`hsl(${ph},48%,34%)`);g.addColorStop(.6,`hsl(${ph},42%,60%)`);g.addColorStop(1,`hsl(${ph},35%,88%)`);
  ctx.fillStyle=g;ctx.strokeStyle=`hsl(${ph},42%,20%)`;ctx.lineWidth=R*.012;
  ctx.beginPath();ctx.moveTo(hx-dir*baseW,hy);ctx.quadraticCurveTo(cxx-dir*baseW*.4,hy-hlen*.6,tipx,tipy);ctx.quadraticCurveTo(cxx+dir*baseW*.4,hy-hlen*.55,hx+dir*baseW,hy);ctx.closePath();ctx.fill();ctx.stroke();
}

function ear(x,y,r,hue){
  const g=ctx.createRadialGradient(x-r*.2,y-r*.2,r*.1,x,y,r);
  g.addColorStop(0,`hsl(${hue},66%,58%)`);g.addColorStop(1,`hsl(${hue},64%,40%)`);
  ctx.fillStyle=g;ctx.strokeStyle=`hsl(${hue},55%,24%)`;ctx.lineWidth=r*.14;
  ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.fillStyle=`hsl(${(hue+12)%360},50%,74%)`;ctx.beginPath();ctx.arc(x,y,r*.5,0,Math.PI*2);ctx.fill();
}

function arm(ex,ey,ang,len,hue,t,i,R){
  const tipx=ex+Math.cos(ang)*len+Math.sin(t/300+i)*R*.05,tipy=ey+Math.sin(ang)*len;
  const lg=ctx.createLinearGradient(ex,ey,tipx,tipy);
  lg.addColorStop(0,`hsl(${hue},60%,52%)`);lg.addColorStop(1,`hsl(${hue},58%,40%)`);
  ctx.strokeStyle=lg;ctx.lineWidth=R*.12;ctx.lineCap="round";
  ctx.beginPath();ctx.moveTo(ex,ey);ctx.quadraticCurveTo(ex+Math.cos(ang)*len*.6,ey+Math.sin(ang)*len*.6,tipx,tipy);ctx.stroke();
  ctx.fillStyle="#f6f0e2";ctx.strokeStyle="rgba(60,40,40,.5)";ctx.lineWidth=R*.008;
  for(let c=-1;c<=1;c++){const ca=ang+c*.4;ctx.beginPath();ctx.moveTo(tipx,tipy);ctx.lineTo(tipx+Math.cos(ca)*R*.12,tipy+Math.sin(ca)*R*.12);ctx.lineTo(tipx+Math.cos(ca+.22)*R*.05,tipy+Math.sin(ca+.22)*R*.05);ctx.closePath();ctx.fill();}
}

function foot(fx,fy,fw,fh,hue){
  const fg=ctx.createRadialGradient(fx,fy-fh*.3,fw*.1,fx,fy,fw);
  fg.addColorStop(0,`hsl(${hue},60%,52%)`);fg.addColorStop(1,`hsl(${hue},58%,38%)`);
  ctx.fillStyle=fg;ctx.beginPath();ctx.ellipse(fx,fy,fw,fh,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="#f6f0e2";
  for(let c=-1;c<=1;c++){ctx.beginPath();ctx.ellipse(fx+c*fw*.5,fy+fh*.6,fw*.18,fh*.3,0,0,Math.PI*2);ctx.fill();}
}

function tentacle(x,y,ang,len,w,hue,t,phase){
  const steps=7,nx=Math.cos(ang),ny=Math.sin(ang),tx=-ny,ty=nx,pts=[];
  for(let i=0;i<=steps;i++){
    const f=i/steps,wob=Math.sin(t/280+phase+f*4)*len*.12*f;
    pts.push([x+nx*len*f+tx*wob,y+ny*len*f+ty*wob,w*(1-f*.85)]);
  }
  ctx.beginPath();
  ctx.moveTo(pts[0][0]+tx*pts[0][2],pts[0][1]+ty*pts[0][2]);
  for(let i=1;i<pts.length;i++)ctx.lineTo(pts[i][0]+tx*pts[i][2],pts[i][1]+ty*pts[i][2]);
  for(let i=pts.length-1;i>=0;i--)ctx.lineTo(pts[i][0]-tx*pts[i][2],pts[i][1]-ty*pts[i][2]);
  ctx.closePath();
  const g=ctx.createLinearGradient(x,y,pts[steps][0],pts[steps][1]);
  g.addColorStop(0,`hsl(${hue},64%,50%)`);g.addColorStop(1,`hsl(${hue},66%,38%)`);
  ctx.fillStyle=g;ctx.strokeStyle=`hsl(${hue},55%,24%)`;ctx.lineWidth=w*.18;ctx.fill();ctx.stroke();
  ctx.fillStyle=`hsl(${(hue+20)%360},55%,74%)`;
  for(let i=1;i<pts.length-1;i++){const[px,py,ww]=pts[i];ctx.beginPath();ctx.arc(px-tx*ww*.3,py-ty*ww*.3,ww*.28,0,Math.PI*2);ctx.fill();}
}

function furEdge(cx,cy,rx,ry,seed,t,hue,m,R){
  const N=54;ctx.fillStyle=`hsl(${hue},58%,${32-m*6}%)`;
  for(let i=0;i<N;i++){
    const a=(i/N)*Math.PI*2,w=Math.sin(a*3+seed)*.05+Math.sin(t/700+a*2+seed)*.03;
    const bx=cx+Math.cos(a)*rx*(1+w),by=cy+Math.sin(a)*ry*(1+w),len=R*(.05+m*.06)*(.55+.45*Math.abs(Math.sin(i*2.3+seed)));
    const nx=Math.cos(a),ny=Math.sin(a),tx=-ny,ty=nx,wd=R*.032;
    ctx.beginPath();ctx.moveTo(bx+tx*wd,by+ty*wd);ctx.lineTo(bx+nx*len,by+ny*len);ctx.lineTo(bx-tx*wd,by-ty*wd);ctx.closePath();ctx.fill();
  }
}

function scaleEdge(cx,cy,rx,ry,seed,hue,R){
  const rows=5,cols=9;
  for(let r=0;r<rows;r++){
    for(let c=0;c<cols;c++){
      const nx=((c+.5)/cols-.5)*2,ny=(r/rows-.2),sl=Math.sqrt(nx*nx+ny*ny*1.4);
      if(sl>1.05)continue;
      const sx=cx+nx*rx,sy=cy+ny*ry*1.1,sc=R*(.09+srand(r*11+c+seed)*.04);
      const lh=(hue+srand(r*7+c)*30)%360;
      const sg=ctx.createRadialGradient(sx-sc*.3,sy-sc*.3,sc*.1,sx,sy,sc);
      sg.addColorStop(0,`hsl(${lh},72%,64%)`);sg.addColorStop(1,`hsl(${lh},65%,38%)`);
      ctx.fillStyle=sg;ctx.strokeStyle=`hsl(${lh},60%,22%)`;ctx.lineWidth=R*.008;
      ctx.beginPath();ctx.moveTo(sx-sc,sy);ctx.quadraticCurveTo(sx-sc,sy-sc,sx,sy-sc);ctx.quadraticCurveTo(sx+sc,sy-sc,sx+sc,sy);ctx.quadraticCurveTo(sx+sc*.5,sy+sc*.4,sx,sy+sc*.5);ctx.quadraticCurveTo(sx-sc*.5,sy+sc*.4,sx-sc,sy);ctx.closePath();ctx.fill();ctx.stroke();
    }
  }
}

function paintBody(cx,cy,rx,ry,hue,m,seed,t,opts){
  opts=opts||{};const R=Math.max(rx,ry);
  blob(cx,cy,rx,ry,seed,t);
  const bg=ctx.createRadialGradient(cx-rx*.32,cy-ry*.46,rx*.1,cx,cy+ry*.2,rx*1.35);
  bg.addColorStop(0,`hsl(${hue},74%,${70-m*8}%)`);bg.addColorStop(.55,`hsl(${hue},68%,${56-m*7}%)`);bg.addColorStop(1,`hsl(${hue},66%,${36-m*6}%)`);
  ctx.fillStyle=bg;ctx.fill();ctx.lineWidth=R*.045;ctx.strokeStyle=`hsl(${hue},55%,22%)`;ctx.stroke();
  ctx.save();blob(cx,cy,rx,ry,seed,t);ctx.clip();
  const ao=ctx.createLinearGradient(cx,cy+ry*.2,cx,cy+ry);ao.addColorStop(0,"rgba(0,0,0,0)");ao.addColorStop(1,"rgba(0,0,0,.22)");ctx.fillStyle=ao;ctx.fillRect(cx-rx,cy-ry,rx*2,ry*2);
  if(opts.belly){
    const bl=ctx.createRadialGradient(cx,cy+ry*.34,rx*.1,cx,cy+ry*.34,rx*.7);
    bl.addColorStop(0,`hsl(${hue},55%,82%)`);bl.addColorStop(1,`hsla(${hue},55%,78%,0)`);
    ctx.fillStyle=bl;ctx.beginPath();ctx.ellipse(cx,cy+ry*.34,rx*.6,ry*.52,0,0,Math.PI*2);ctx.fill();
  }
  if(opts.spotMode==="spots"){
    for(let i=0;i<14;i++){
      const a=srand(i+seed)*Math.PI*2,rad=.25+srand(i*3+seed)*.6;
      const sx=cx+Math.cos(a)*rx*rad,sy=cy+Math.sin(a)*ry*rad,sr=R*(.02+srand(i*7+seed)*.05);
      ctx.fillStyle=srand(i*5+seed)>.4?`hsla(${hue},55%,30%,.26)`:`hsla(${hue},60%,86%,.4)`;
      ctx.beginPath();ctx.arc(sx,sy,sr,0,Math.PI*2);ctx.fill();
    }
  }else if(opts.spotMode==="stripes"){
    ctx.strokeStyle=`hsla(${hue},55%,30%,.22)`;ctx.lineWidth=R*.06;
    for(let i=-3;i<=3;i++){ctx.beginPath();ctx.moveTo(cx-rx,cy+ry*.22*i);ctx.quadraticCurveTo(cx,cy+ry*.22*i-ry*.1,cx+rx,cy+ry*.22*i);ctx.stroke();}
  }
  const gl=ctx.createRadialGradient(cx-rx*.34,cy-ry*.46,rx*.05,cx-rx*.34,cy-ry*.46,rx*.7);
  gl.addColorStop(0,"rgba(255,255,255,.4)");gl.addColorStop(1,"rgba(255,255,255,0)");
  ctx.fillStyle=gl;ctx.beginPath();ctx.ellipse(cx-rx*.32,cy-ry*.44,rx*.42,ry*.32,-.5,0,Math.PI*2);ctx.fill();
  ctx.restore();
}

// ================================================================
//  12 ARKETYPER
// ================================================================

// 1. BLOB
function drawBlob(cx,cy,rx,ry,R,hue,m,seed,t,cr){
  const spikes=parts.filter(p=>p.type==="spike");
  spikes.slice(0,2).forEach((p,i)=>horn(cx+(i?1:-1)*rx*.42,cy-ry*.6,i?1:-1,.6+p.size*.5,p.hue,m,R));
  arm(cx-rx*.85,cy,Math.PI*.85,R*cr.armLen,hue,t,0,R);arm(cx+rx*.85,cy,Math.PI*.15,R*cr.armLen,hue,t,1,R);
  foot(cx-rx*.42,cy+ry*.9,rx*.26,ry*.17,hue);foot(cx+rx*.42,cy+ry*.9,rx*.26,ry*.17,hue);
  furEdge(cx,cy,rx,ry,seed,t,hue,m,R);
  paintBody(cx,cy,rx,ry,hue,m,seed,t,{belly:true,spotMode:cr.spotMode});
  drawFace(cx,cy-ry*.05,R*.62,hue,m,t,cr.eyeCount);
}

// 2. FLERHOVEDET
function drawMultihead(cx,cy,rx,ry,R,hue,m,seed,t,cr){
  const bCy=cy+ry*.28,bRx=rx,bRy=ry*.78,n=cr.heads,hr=R*(n===2?.4:.32);
  arm(cx-bRx*.8,bCy,Math.PI*.9,R*.85,hue,t,0,R);arm(cx+bRx*.8,bCy,Math.PI*.1,R*.85,hue,t,1,R);
  foot(cx-bRx*.4,bCy+bRy*.95,rx*.24,ry*.16,hue);foot(cx+bRx*.4,bCy+bRy*.95,rx*.24,ry*.16,hue);
  const heads=[];
  for(let i=0;i<n;i++){const f=(i/(n-1)-.5)*2,hx=cx+f*bRx*.62,hy=bCy-bRy*.7-R*.22;heads.push([hx,hy]);}
  heads.forEach(([hx,hy])=>{
    ctx.strokeStyle=`hsl(${hue},62%,46%)`;ctx.lineWidth=R*.16;ctx.lineCap="round";
    ctx.beginPath();ctx.moveTo(cx+(hx-cx)*.3,bCy-bRy*.3);ctx.lineTo(hx,hy+hr*.6);ctx.stroke();
  });
  furEdge(cx,bCy,bRx,bRy,seed,t,hue,m,R);
  paintBody(cx,bCy,bRx,bRy,hue,m,seed,t,{belly:true,spotMode:cr.spotMode});
  heads.forEach(([hx,hy],i)=>{
    paintBody(hx,hy,hr,hr,hue,m,seed+i*13,t,{spotMode:cr.spotMode});
    drawFace(hx,hy,hr*.92,hue,m,t,2);
    if(cr.hornStyle!=="none"){horn(hx-hr*.5,hy-hr*.7,-1,.38,(hue+40)%360,m,R*.7);horn(hx+hr*.5,hy-hr*.7,1,.38,(hue+40)%360,m,R*.7);}
  });
}

// 3. BLÆKSPRUTTE
function drawOctopus(cx,cy,rx,ry,R,hue,m,seed,t,cr){
  const hCy=cy-ry*.22,hRx=rx*.95,hRy=ry*.85,n=cr.tentacles;
  for(let i=0;i<n;i++){
    const f=(i/(n-1)-.5),ang=Math.PI*.5+f*1.6;
    tentacle(cx+f*hRx*1.05,hCy+hRy*.7,ang,R*(1.1+.35*Math.abs(f)),R*.12,hue,t,i*1.3);
  }
  paintBody(cx,hCy,hRx,hRy,hue,m,seed,t,{spotMode:cr.spotMode});
  drawFace(cx,hCy,R*.7,hue,m,t,cr.eyeCount);
}

// 4. BÆST / BJØRN
function drawBeast(cx,cy,rx,ry,R,hue,m,seed,t,cr){
  ear(cx-rx*.55,cy-ry*.8,R*.2,hue);ear(cx+rx*.55,cy-ry*.8,R*.2,hue);
  arm(cx-rx*.85,cy-ry*.1,Math.PI*.85,R*1.05,hue,t,0,R);arm(cx+rx*.85,cy-ry*.1,Math.PI*.15,R*1.05,hue,t,1,R);
  const spikes=parts.filter(p=>p.type==="spike");
  spikes.slice(0,2).forEach((p,i)=>horn(cx+(i?1:-1)*rx*.4,cy-ry*.78,i?1:-1,.6+p.size*.5,p.hue,m,R));
  foot(cx-rx*.4,cy+ry*.92,rx*.26,ry*.16,hue);foot(cx+rx*.4,cy+ry*.92,rx*.26,ry*.16,hue);
  furEdge(cx,cy,rx,ry,seed,t,hue,Math.min(1,m+.35),R);
  paintBody(cx,cy,rx,ry,hue,m,seed,t,{belly:true,spotMode:cr.spotMode});
  const sny=cy+ry*.22;
  const sg=ctx.createRadialGradient(cx,sny-R*.06,R*.05,cx,sny,R*.42);
  sg.addColorStop(0,`hsl(${hue},60%,72%)`);sg.addColorStop(1,`hsl(${hue},58%,52%)`);
  ctx.fillStyle=sg;ctx.strokeStyle=`hsl(${hue},55%,30%)`;ctx.lineWidth=R*.02;
  ctx.beginPath();ctx.ellipse(cx,sny,R*.42,R*.3,0,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.fillStyle="#20141a";ctx.beginPath();ctx.ellipse(cx,sny-R*.12,R*.1,R*.07,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="rgba(255,255,255,.4)";ctx.beginPath();ctx.ellipse(cx-R*.03,sny-R*.14,R*.03,R*.02,0,0,Math.PI*2);ctx.fill();
  drawMouth(cx,sny+R*.12,R*.6,R*.22*(1+m*.3),hue,m);
  const er=R*.22,g=R*.72;
  eyeball(cx-g/2,cy-ry*.1,er,hue,m,t);eyeball(cx+g/2,cy-ry*.08,er*.92,hue,m,t);
  brow(cx-g/2,cy-ry*.1,er,hue,m,-1);brow(cx+g/2,cy-ry*.08,er*.92,hue,m,1);
}

// 5. FISK
function drawFish(cx,cy,rx,ry,R,hue,m,seed,t,cr){
  // hale
  const tailW=R*cr.tailLen,tx=cx+rx*.7;
  const tg=ctx.createLinearGradient(tx,cy,tx+tailW,cy);
  tg.addColorStop(0,`hsl(${hue},68%,50%)`);tg.addColorStop(1,`hsl(${hue},65%,35%)`);
  ctx.fillStyle=tg;ctx.strokeStyle=`hsl(${hue},55%,24%)`;ctx.lineWidth=R*.015;
  ctx.beginPath();ctx.moveTo(tx,cy-ry*.22);ctx.quadraticCurveTo(tx+tailW*.6,cy,tx+tailW,cy-ry*.6);ctx.quadraticCurveTo(tx+tailW*.8,cy,tx+tailW,cy+ry*.6);ctx.quadraticCurveTo(tx+tailW*.6,cy,tx,cy+ry*.22);ctx.closePath();ctx.fill();ctx.stroke();
  // kroppen er vandret
  const bRx=rx*1.1,bRy=ry*.75;
  // brystfinner
  for(const s of[-1,1]){
    const fy=cy+s*bRy*.45,fR=R*.3;
    const fg=ctx.createRadialGradient(cx,fy,fR*.1,cx,fy,fR);
    fg.addColorStop(0,`hsl(${hue},70%,60%)`);fg.addColorStop(1,`hsl(${hue},65%,40%)`);
    ctx.fillStyle=fg;ctx.strokeStyle=`hsl(${hue},55%,26%)`;ctx.lineWidth=R*.01;
    ctx.beginPath();ctx.moveTo(cx-bRx*.2,fy);ctx.quadraticCurveTo(cx,fy+s*fR*.8,cx+bRx*.4,fy+s*fR*.2);ctx.quadraticCurveTo(cx+bRx*.2,fy,cx-bRx*.2,fy);ctx.closePath();ctx.fill();ctx.stroke();
  }
  // ryg-finne
  const rfg=ctx.createLinearGradient(cx-bRx*.3,cy-bRy,cx+bRx*.3,cy-bRy-R*.5);
  rfg.addColorStop(0,`hsl(${(hue+40)%360},72%,52%)`);rfg.addColorStop(1,`hsl(${(hue+40)%360},70%,72%)`);
  ctx.fillStyle=rfg;ctx.strokeStyle=`hsl(${(hue+40)%360},60%,32%)`;ctx.lineWidth=R*.01;
  ctx.beginPath();ctx.moveTo(cx-bRx*.35,cy-bRy*.8);
  for(let i=0;i<cr.fins;i++){const f=i/(cr.fins-1),fx=cx+(-bRx*.35+bRx*.7*f),spk=R*(.28+.1*Math.sin(i*2.1+seed));ctx.lineTo(fx,cy-bRy*.9-spk);}
  ctx.lineTo(cx+bRx*.35,cy-bRy*.8);ctx.closePath();ctx.fill();ctx.stroke();
  scaleEdge(cx,cy,bRx,bRy,seed,hue,R);
  paintBody(cx,cy,bRx,bRy,hue,m,seed,t,{spotMode:"spots"});
  // fiske-mund (bred, vandret)
  const mw=bRx*.55,mhy=cy+bRy*.1;
  ctx.fillStyle="#2a0710";ctx.strokeStyle=`hsl(${hue},45%,22%)`;ctx.lineWidth=R*.018;
  ctx.beginPath();ctx.ellipse(cx-bRx*.35,mhy,mw*.12,bRy*.14,0,0,Math.PI*2);ctx.fill();ctx.stroke();
  const er=R*.28,ey=cy-bRy*.18;
  eyeball(cx-bRx*.25,ey,er,hue,m,t);
  brow(cx-bRx*.25,ey,er,hue,m,-1);
}

// 6. FUGL
function drawBird(cx,cy,rx,ry,R,hue,m,seed,t,cr){
  // krop
  const bRx=rx*.85,bRy=ry;
  // vinger
  for(const s of[-1,1]){
    const wx=cx+s*bRx*.6,wy=cy-bRy*.1,wlen=R*1.1,wh=R*.55;
    const wg=ctx.createLinearGradient(wx,wy,wx+s*wlen,wy-wh*.3);
    wg.addColorStop(0,`hsl(${hue},65%,48%)`);wg.addColorStop(1,`hsl(${hue},62%,32%)`);
    ctx.fillStyle=wg;ctx.strokeStyle=`hsl(${hue},55%,24%)`;ctx.lineWidth=R*.012;
    ctx.beginPath();ctx.moveTo(wx,wy-wh*.3);
    for(let i=0;i<cr.feathers;i++){const f=i/(cr.feathers-1),fx=wx+s*wlen*f,spk=wh*(.5+.4*Math.sin(i*2.4+seed));ctx.lineTo(fx,wy+spk);}
    ctx.lineTo(wx+s*wlen*.9,wy-wh*.1);ctx.closePath();ctx.fill();ctx.stroke();
    // vingefjer-ribber
    ctx.strokeStyle=`hsl(${hue},55%,28%)`;ctx.lineWidth=R*.006;
    for(let i=0;i<cr.feathers;i++){const f=i/(cr.feathers-1),fx=wx+s*wlen*f,spk=wh*(.5+.4*Math.sin(i*2.4+seed));ctx.beginPath();ctx.moveTo(wx+s*wlen*(f-.05),wy-wh*.1);ctx.lineTo(fx,wy+spk);ctx.stroke();}
  }
  // hale-fjer
  for(let i=0;i<5;i++){
    const f=(i/4-.5),tlen=R*(.5+cr.tailLen*.3+Math.abs(f)*.2),fa=Math.PI*.5+f*.6;
    ctx.strokeStyle=`hsl(${(hue+i*15)%360},68%,52%)`;ctx.lineWidth=R*(.06-.01*Math.abs(i-2));ctx.lineCap="round";
    ctx.beginPath();ctx.moveTo(cx+Math.cos(fa)*bRx*.4,cy+bRy*.7);ctx.quadraticCurveTo(cx+Math.cos(fa)*bRx*.6,cy+bRy*.7+tlen*.5,cx+Math.cos(fa)*tlen,cy+bRy*.7+tlen*.8);ctx.stroke();
  }
  paintBody(cx,cy,bRx,bRy,hue,m,seed,t,{belly:true,spotMode:cr.spotMode});
  // næb
  const nh=(hue+50)%360;
  const ng=ctx.createLinearGradient(cx-bRx*.35,cy-bRy*.2,cx-bRx*.8,cy-bRy*.1);
  ng.addColorStop(0,`hsl(${nh},80%,55%)`);ng.addColorStop(1,`hsl(${nh},75%,40%)`);
  ctx.fillStyle=ng;ctx.strokeStyle=`hsl(${nh},65%,28%)`;ctx.lineWidth=R*.014;
  ctx.beginPath();ctx.moveTo(cx-bRx*.32,cy-bRy*.28);ctx.lineTo(cx-bRx*.85,cy-bRy*.1+m*R*.06);ctx.lineTo(cx-bRx*.32,cy-bRy*.06);ctx.closePath();ctx.fill();ctx.stroke();
  ctx.beginPath();ctx.moveTo(cx-bRx*.32,cy-bRy*.16);ctx.lineTo(cx-bRx*.85,cy-bRy*.1+m*R*.12);ctx.lineTo(cx-bRx*.32,cy+bRy*.04);ctx.closePath();ctx.fill();ctx.stroke();
  // top-fjer-kam
  for(let i=0;i<5;i++){
    const f=(i/4-.5),fx=cx+f*bRx*.28,clen=R*(.22+.12*(1-Math.abs(f)));
    const cg=ctx.createLinearGradient(fx,cy-bRy*.82,fx,cy-bRy*.82-clen);
    cg.addColorStop(0,`hsl(${(hue+80)%360},78%,52%)`);cg.addColorStop(1,`hsl(${(hue+80)%360},72%,78%)`);
    ctx.fillStyle=cg;ctx.beginPath();ctx.moveTo(fx-R*.025,cy-bRy*.82);ctx.quadraticCurveTo(fx,cy-bRy*.82-clen*1.1,fx+R*.025,cy-bRy*.82);ctx.closePath();ctx.fill();
  }
  const er=R*.26,ey=cy-bRy*.3;
  eyeball(cx-bRx*.12,ey,er,hue,m,t);brow(cx-bRx*.12,ey,er,hue,m,-1);
}

// 7. ORM / MADDIKE
function drawWorm(cx,cy,rx,ry,R,hue,m,seed,t,cr){
  const segs=cr.segments,sR=R*.62;
  const pts=[];
  for(let i=0;i<segs;i++){
    const f=i/(segs-1),wob=Math.sin(t/400+f*3.5+seed)*R*.18*f;
    pts.push([cx+(f-.5)*rx*1.6+wob,cy+f*ry*.7-ry*.2]);
  }
  // hale-spids
  const lp=pts[segs-1];
  ctx.strokeStyle=`hsl(${hue},55%,34%)`;ctx.lineWidth=R*.08;ctx.lineCap="round";
  ctx.beginPath();ctx.moveTo(lp[0],lp[1]);ctx.lineTo(lp[0]+R*.2,lp[1]+R*.18);ctx.stroke();
  // segmenter (bag -> front)
  for(let i=segs-1;i>=0;i--){
    const[sx,sy]=pts[i],f=i/(segs-1),sr=sR*(1.1-f*.5);
    const sg=ctx.createRadialGradient(sx-sr*.28,sy-sr*.3,sr*.1,sx,sy,sr);
    sg.addColorStop(0,`hsl(${hue},70%,${60+i*2}%)`);sg.addColorStop(1,`hsl(${hue},64%,${36+i}%)`);
    ctx.fillStyle=sg;ctx.strokeStyle=`hsl(${hue},55%,24%)`;ctx.lineWidth=R*.022;
    ctx.beginPath();ctx.arc(sx,sy,sr,0,Math.PI*2);ctx.fill();ctx.stroke();
    // ring-markeringer
    ctx.strokeStyle=`hsla(${hue},55%,28%,.5)`;ctx.lineWidth=R*.01;
    ctx.beginPath();ctx.arc(sx,sy,sr*.75,0,Math.PI*2);ctx.stroke();
  }
  // hoved
  const[hx,hy]=pts[0];
  const hr=sR*1.28;
  const hg=ctx.createRadialGradient(hx-hr*.3,hy-hr*.3,hr*.1,hx,hy,hr);
  hg.addColorStop(0,`hsl(${hue},72%,64%)`);hg.addColorStop(1,`hsl(${hue},66%,40%)`);
  ctx.fillStyle=hg;ctx.strokeStyle=`hsl(${hue},55%,22%)`;ctx.lineWidth=R*.025;
  ctx.beginPath();ctx.arc(hx,hy,hr,0,Math.PI*2);ctx.fill();ctx.stroke();
  eyeball(hx-hr*.35,hy-hr*.18,hr*.32,hue,m,t);eyeball(hx+hr*.18,hy-hr*.22,hr*.28,hue,m,t);
  drawMouth(hx,hy+hr*.42,hr*1.0,hr*.36*(1+m*.3),hue,m);
  // antenner
  for(const s of[-1,1]){
    ctx.strokeStyle=`hsl(${(hue+60)%360},70%,55%)`;ctx.lineWidth=R*.015;ctx.lineCap="round";
    const ax=hx+s*hr*.28,ay=hy-hr*.8,abx=ax+s*R*.24,aby=ay-R*.35+Math.sin(t/350+s)*R*.06;
    ctx.beginPath();ctx.moveTo(ax,ay);ctx.quadraticCurveTo(ax+s*R*.12,ay-R*.2,abx,aby);ctx.stroke();
    ctx.fillStyle=`hsl(${(hue+60)%360},75%,62%)`;ctx.beginPath();ctx.arc(abx,aby,R*.07,0,Math.PI*2);ctx.fill();
  }
}

// 8. RUMVÆSEN / ALIEN
function drawAlien(cx,cy,rx,ry,R,hue,m,seed,t,cr){
  // kæmpe hoved, lille krop
  const hR=R*.95,bRy=ry*.52,bRx=rx*.65;
  // antenner
  for(let i=0;i<cr.antennae;i++){
    const f=(i/(cr.antennae-1)-.5),ax=cx+f*hR*.7,ay=cy-hR*.72,alen=R*(.55+.2*Math.abs(f));
    const wob=Math.sin(t/300+i*1.4)*R*.08;
    ctx.strokeStyle=`hsl(${(hue+120)%360},80%,58%)`;ctx.lineWidth=R*.018;ctx.lineCap="round";
    ctx.beginPath();ctx.moveTo(ax,ay);ctx.quadraticCurveTo(ax+wob,ay-alen*.5,ax+f*R*.12+wob,ay-alen);ctx.stroke();
    const ab=(hue+120+i*30)%360;
    ctx.fillStyle=`hsl(${ab},90%,64%)`;ctx.shadowColor=`hsl(${ab},90%,64%)`;ctx.shadowBlur=14;
    ctx.beginPath();ctx.arc(ax+f*R*.12+wob,ay-alen,R*.08,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
  }
  // krop (lille)
  paintBody(cx,cy+ry*.38,bRx,bRy,hue,m,seed+5,t,{belly:false,spotMode:"none"});
  // spinkle arme
  arm(cx-bRx*.7,cy+ry*.28,Math.PI*.9,R*.7,hue,t,0,R*.8);arm(cx+bRx*.7,cy+ry*.28,Math.PI*.1,R*.7,hue,t,1,R*.8);
  // kæmpe rundt hoved
  const hg=ctx.createRadialGradient(cx-hR*.3,cy-hR*.3,hR*.1,cx,cy,hR);
  hg.addColorStop(0,`hsl(${hue},72%,${62-m*10}%)`);hg.addColorStop(.6,`hsl(${hue},68%,${46-m*8}%)`);hg.addColorStop(1,`hsl(${hue},66%,${28-m*6}%)`);
  ctx.fillStyle=hg;ctx.strokeStyle=`hsl(${hue},55%,20%)`;ctx.lineWidth=R*.04;
  ctx.beginPath();ctx.arc(cx,cy,hR,0,Math.PI*2);ctx.fill();ctx.stroke();
  // glans
  const gl=ctx.createRadialGradient(cx-hR*.35,cy-hR*.4,hR*.05,cx-hR*.35,cy-hR*.4,hR*.72);
  gl.addColorStop(0,"rgba(255,255,255,.38)");gl.addColorStop(1,"rgba(255,255,255,0)");
  ctx.fillStyle=gl;ctx.beginPath();ctx.ellipse(cx-hR*.3,cy-hR*.38,hR*.46,hR*.32,-.45,0,Math.PI*2);ctx.fill();
  // mandel-øjne (alien-store)
  for(const s of[-1,1]){
    const ex=cx+s*hR*.34,ey=cy-hR*.06,ew=hR*.38,eh=hR*.26;
    const eg=ctx.createRadialGradient(ex+s*ew*.12,ey-eh*.2,eh*.1,ex,ey,Math.max(ew,eh));
    eg.addColorStop(0,`hsl(${(hue+160)%360},90%,70%)`);eg.addColorStop(.6,`hsl(${(hue+160)%360},85%,42%)`);eg.addColorStop(1,"#050810");
    ctx.fillStyle="#050810";ctx.beginPath();ctx.ellipse(ex,ey,ew,eh,s*.2,0,Math.PI*2);ctx.fill();
    ctx.fillStyle=eg;ctx.beginPath();ctx.ellipse(ex,ey,ew*.82,eh*.82,s*.2,0,Math.PI*2);ctx.fill();
    ctx.fillStyle="rgba(255,255,255,.9)";ctx.beginPath();ctx.ellipse(ex-s*ew*.22,ey-eh*.3,ew*.14,eh*.12,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle=`hsl(${(hue+160)%360},80%,28%)`;ctx.lineWidth=R*.018;ctx.beginPath();ctx.ellipse(ex,ey,ew,eh,s*.2,0,Math.PI*2);ctx.stroke();
  }
  // lille mund
  const mw=hR*.3,mhy=cy+hR*.5;
  ctx.strokeStyle=`hsl(${hue},50%,24%)`;ctx.lineWidth=R*.022;ctx.lineCap="round";
  ctx.beginPath();ctx.moveTo(cx-mw,mhy);ctx.quadraticCurveTo(cx,mhy+(m>0.5?R*.1:-R*.06),cx+mw,mhy);ctx.stroke();
}

// 9. KRABBE
function drawCrab(cx,cy,rx,ry,R,hue,m,seed,t,cr){
  // 8 krabbekloer
  for(let i=0;i<4;i++){
    for(const s of[-1,1]){
      const f=i/3,ang=-Math.PI*.25+s*(Math.PI*.15+f*Math.PI*.5),len=R*(.6+f*.3+cr.armLen*.2);
      const ex=cx+s*rx*.6,ey=cy+ry*(-.3+f*.5);
      const wob=Math.sin(t/350+i*1.5)*R*.04;
      ctx.strokeStyle=`hsl(${hue},60%,50%)`;ctx.lineWidth=R*(.1-.02*i);ctx.lineCap="round";
      ctx.beginPath();ctx.moveTo(ex,ey);
      const midx=ex+Math.cos(ang)*len*.5+wob,midy=ey+Math.sin(ang)*len*.5;
      const tipx=ex+Math.cos(ang)*len+wob,tipy=ey+Math.sin(ang)*len;
      ctx.quadraticCurveTo(midx,midy,tipx,tipy);ctx.stroke();
      if(i===0){// klosaks
        ctx.fillStyle=`hsl(${hue},58%,44%)`;ctx.strokeStyle=`hsl(${hue},55%,28%)`;ctx.lineWidth=R*.01;
        ctx.beginPath();ctx.moveTo(tipx,tipy);ctx.lineTo(tipx+s*R*.16,tipy-R*.1);ctx.lineTo(tipx+s*R*.08,tipy+R*.04);ctx.closePath();ctx.fill();ctx.stroke();
        ctx.beginPath();ctx.moveTo(tipx,tipy);ctx.lineTo(tipx+s*R*.14,tipy+R*.12);ctx.lineTo(tipx+s*R*.06,tipy+R*.04);ctx.closePath();ctx.fill();ctx.stroke();
      }
    }
  }
  // flad bred krop
  const cRx=rx*1.1,cRy=ry*.7;
  scaleEdge(cx,cy,cRx,cRy,seed,hue,R);
  paintBody(cx,cy,cRx,cRy,hue,m,seed,t,{belly:false,spotMode:cr.spotMode});
  // klo-arme øverst
  for(const s of[-1,1]){arm(cx+s*cRx*.7,cy-cRy*.3,s>0?-.1:-Math.PI+.1,R*.5,(hue+30)%360,t,s,R*.7);}
  // øjne på stilke
  for(const s of[-1,1]){
    const ex=cx+s*cRx*.38,ey=cy-cRy*.62,stlen=R*.22,sty=ey-stlen;
    ctx.strokeStyle=`hsl(${hue},58%,44%)`;ctx.lineWidth=R*.06;ctx.lineCap="round";
    ctx.beginPath();ctx.moveTo(ex,ey);ctx.lineTo(ex+Math.sin(t/400+s)*R*.04,sty);ctx.stroke();
    eyeball(ex+Math.sin(t/400+s)*R*.04,sty,R*.19,hue,m,t);
  }
  // mund
  drawMouth(cx,cy+cRy*.3,cRx*.55,R*.18*(1+m*.3),hue,m);
}

// 10. DRAGE
function drawDragon(cx,cy,rx,ry,R,hue,m,seed,t,cr){
  // hale
  const tpts=[];
  for(let i=0;i<8;i++){const f=i/7;tpts.push([cx+rx*.4+f*R*1.1,cy+ry*.5+Math.sin(f*4+t/300)*R*.18+f*R*.3]);}
  ctx.strokeStyle=`hsl(${hue},62%,44%)`;ctx.lineWidth=R*(.22-.02*0);ctx.lineCap="round";
  for(let i=0;i<tpts.length-1;i++){
    ctx.lineWidth=R*(.22-.026*i);
    ctx.beginPath();ctx.moveTo(tpts[i][0],tpts[i][1]);ctx.lineTo(tpts[i+1][0],tpts[i+1][1]);ctx.stroke();
  }
  ctx.fillStyle=`hsl(${(hue+40)%360},72%,54%)`;ctx.beginPath();ctx.arc(tpts[7][0],tpts[7][1],R*.12,0,Math.PI*2);ctx.fill();
  // vinger
  for(const s of[-1,1]){
    const wx=cx+s*rx*.5,wy=cy-ry*.6,wlen=R*1.4;
    const wg=ctx.createLinearGradient(wx,wy,wx+s*wlen,wy-R*.4);
    wg.addColorStop(0,`hsl(${(hue+170)%360},60%,42%)`);wg.addColorStop(1,`hsla(${(hue+170)%360},58%,28%,.6)`);
    ctx.fillStyle=wg;ctx.strokeStyle=`hsl(${(hue+170)%360},55%,26%)`;ctx.lineWidth=R*.012;
    ctx.beginPath();ctx.moveTo(wx,wy+R*.1);ctx.lineTo(wx+s*wlen,wy-R*.4);ctx.lineTo(wx+s*wlen*.7,wy+R*.6);ctx.lineTo(wx+s*wlen*.35,wy+R*.35);ctx.lineTo(wx,wy+R*.1);ctx.closePath();ctx.fill();ctx.stroke();
    for(let i=1;i<=3;i++){ctx.strokeStyle=`hsla(${(hue+170)%360},55%,55%,.6)`;ctx.lineWidth=R*.008;ctx.beginPath();ctx.moveTo(wx,wy+R*.1);ctx.lineTo(wx+s*wlen*(i/3.5),wy+R*(.5-i*.15));ctx.stroke();}
  }
  arm(cx-rx*.8,cy,Math.PI*.8,R*.8,hue,t,0,R);arm(cx+rx*.8,cy,Math.PI*.2,R*.8,hue,t,1,R);
  foot(cx-rx*.35,cy+ry*.9,rx*.24,ry*.16,hue);foot(cx+rx*.35,cy+ry*.9,rx*.24,ry*.16,hue);
  // ryg-pigge
  for(let i=0;i<6;i++){const f=i/5,spx=cx+(-rx*.6+rx*1.2*f),spy=cy-ry*(.7+.1*Math.sin(f*Math.PI));
    const csh=(hue+40)%360,splen=R*(.2+.12*(1-Math.abs(f-.5)*2));
    const sg=ctx.createLinearGradient(spx,spy,spx,spy-splen);sg.addColorStop(0,`hsl(${csh},72%,52%)`);sg.addColorStop(1,`hsl(${csh},68%,76%)`);
    ctx.fillStyle=sg;ctx.strokeStyle=`hsl(${csh},60%,32%)`;ctx.lineWidth=R*.008;
    ctx.beginPath();ctx.moveTo(spx-R*.04,spy);ctx.lineTo(spx,spy-splen);ctx.lineTo(spx+R*.04,spy);ctx.closePath();ctx.fill();ctx.stroke();}
  paintBody(cx,cy,rx,ry,hue,m,seed,t,{belly:true,spotMode:"none"});
  // hoved på lang hals
  const nlen=R*.55,hx=cx-rx*.5-nlen*.6,hy=cy-ry*.55-nlen*.5;
  ctx.strokeStyle=`hsl(${hue},62%,46%)`;ctx.lineWidth=R*.2;ctx.lineCap="round";
  ctx.beginPath();ctx.moveTo(cx-rx*.45,cy-ry*.4);ctx.quadraticCurveTo(cx-rx*.7-nlen*.3,cy-ry*.5-nlen*.3,hx,hy);ctx.stroke();
  const hr=R*.38;
  const hg=ctx.createRadialGradient(hx-hr*.3,hy-hr*.3,hr*.1,hx,hy,hr);
  hg.addColorStop(0,`hsl(${hue},72%,64%)`);hg.addColorStop(1,`hsl(${hue},66%,38%)`);
  ctx.fillStyle=hg;ctx.strokeStyle=`hsl(${hue},55%,22%)`;ctx.lineWidth=R*.025;
  ctx.beginPath();ctx.ellipse(hx,hy,hr,hr*.78,-.3,0,Math.PI*2);ctx.fill();ctx.stroke();
  horn(hx-hr*.3,hy-hr*.5,-1,.38,(hue+40)%360,m,R*.7);horn(hx+hr*.08,hy-hr*.55,1,.38,(hue+40)%360,m,R*.7);
  eyeball(hx+hr*.28,hy-hr*.1,hr*.32,hue,m,t);
  brow(hx+hr*.28,hy-hr*.1,hr*.32,hue,m,1);
  drawMouth(hx-hr*.08,hy+hr*.28,hr*.85,hr*.28*(1+m*.4),hue,m);
  // ildpust
  if(m>0.55){
    ctx.save();ctx.globalAlpha=.6+Math.sin(t/120)*.2;
    for(let i=0;i<6;i++){
      const fa=-.4+(i/5)*.5,fl=R*(.5+i*.1+Math.random()*.15),fx=hx-hr*.6+Math.cos(fa)*fl,fy=hy+hr*.1+Math.sin(fa)*fl;
      const fg=ctx.createRadialGradient(hx-hr*.5,hy+hr*.15,0,fx,fy,R*.22);
      fg.addColorStop(0,"rgba(255,240,80,.9)");fg.addColorStop(.5,"rgba(255,100,20,.6)");fg.addColorStop(1,"rgba(255,40,0,0)");
      ctx.fillStyle=fg;ctx.beginPath();ctx.arc(fx,fy,R*.22,0,Math.PI*2);ctx.fill();
    }
    ctx.restore();
  }
}

// 11. KÆMPE ØJEMONSTER
function drawEyeball(cx,cy,rx,ry,R,hue,m,seed,t,cr){
  // ben-tentakler
  const nlegs=6+Math.floor(cr.tentacles/2);
  for(let i=0;i<nlegs;i++){
    const f=i/(nlegs-1),ang=Math.PI*.1+f*Math.PI*.8,len=R*(.7+.2*Math.sin(f*Math.PI));
    tentacle(cx+(f-.5)*rx*1.4,cy+ry*.6,ang,len,R*.1,(hue+80)%360,t,i*1.4);
  }
  // krop = kæmpe øje
  const eg=ctx.createRadialGradient(cx-rx*.35,cy-ry*.4,rx*.1,cx,cy,rx);
  eg.addColorStop(0,"#ffffff");eg.addColorStop(.55,"#e8f0ff");eg.addColorStop(1,"#bfc8e0");
  ctx.fillStyle=eg;ctx.strokeStyle=`hsl(${hue},45%,22%)`;ctx.lineWidth=R*.06;
  ctx.beginPath();ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);ctx.fill();ctx.stroke();
  // rød blodåre-net
  ctx.strokeStyle="rgba(200,40,40,.22)";ctx.lineWidth=R*.012;
  for(let i=0;i<10;i++){
    const a=srand(i+seed)*Math.PI*2,len=rx*(.4+srand(i*3+seed)*.4);
    ctx.beginPath();ctx.moveTo(cx+Math.cos(a)*rx*.15,cy+Math.sin(a)*ry*.15);ctx.quadraticCurveTo(cx+Math.cos(a+.4)*len*.6,cy+Math.sin(a+.4)*ry*.6,cx+Math.cos(a)*len,cy+Math.sin(a)*ry*.9);ctx.stroke();
  }
  // kæmpe iris
  const ir=rx*.72,ih=(hue+175)%360;
  const ig=ctx.createRadialGradient(cx-ir*.22,cy-ir*.22,ir*.1,cx,cy,ir);
  ig.addColorStop(0,`hsl(${ih},85%,68%)`);ig.addColorStop(.65,`hsl(${ih},80%,46%)`);ig.addColorStop(1,`hsl(${ih},78%,26%)`);
  ctx.fillStyle=ig;ctx.beginPath();ctx.arc(cx,cy,ir,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle=`hsl(${ih},75%,22%)`;ctx.lineWidth=R*.02;ctx.beginPath();ctx.arc(cx,cy,ir,0,Math.PI*2);ctx.stroke();
  // pupil
  ctx.fillStyle="#070a10";ctx.beginPath();ctx.ellipse(cx,cy,ir*lerp(.5,.28,m),ir*.7,0,0,Math.PI*2);ctx.fill();
  // catchlights
  ctx.fillStyle="rgba(255,255,255,.95)";ctx.beginPath();ctx.ellipse(cx-ir*.34,cy-ir*.3,ir*.16,ir*.14,0,0,Math.PI*2);ctx.fill();
  ctx.fillStyle="rgba(255,255,255,.55)";ctx.beginPath();ctx.arc(cx+ir*.24,cy+ir*.2,ir*.07,0,Math.PI*2);ctx.fill();
  // øjenlåg
  ctx.fillStyle=`hsl(${hue},55%,${40-m*10}%)`;ctx.strokeStyle=`hsl(${hue},50%,24%)`;ctx.lineWidth=R*.032;
  ctx.beginPath();ctx.moveTo(cx-rx,cy);ctx.quadraticCurveTo(cx,cy-ry*(lerp(.35,.85,m)),cx+rx,cy);ctx.quadraticCurveTo(cx,cy-ry*.1,cx-rx,cy);ctx.closePath();ctx.fill();ctx.stroke();
  // vipper
  for(let i=0;i<8;i++){const f=i/7-.5,vx=cx+f*rx*.9,vy=cy-ry*(lerp(.35,.85,m))*(.9-Math.abs(f)*.5);ctx.strokeStyle=`hsl(${hue},50%,20%)`;ctx.lineWidth=R*.018;ctx.lineCap="round";ctx.beginPath();ctx.moveTo(vx,vy);ctx.lineTo(vx+f*R*.06,vy-R*.12);ctx.stroke();}
  // lille mund i bunden
  drawMouth(cx,cy+ry*.62,rx*.5,R*.18*(1+m*.3),hue,m);
}

// 12. GELÉ / MANET
function drawJelly(cx,cy,rx,ry,R,hue,m,seed,t,cr){
  const pulse=Math.sin(t/400)*.05;
  const jRx=rx*(1+pulse),jRy=ry*(1-pulse);
  // sarte tråde
  const nthr=8+cr.tentacles;
  for(let i=0;i<nthr;i++){
    const f=i/(nthr-1)-.5,bx=cx+f*jRx*.8,by=cy+jRy*.7;
    const tlen=R*(.8+srand(i+seed)*.7),swob=Math.sin(t/320+i*1.2)*R*.12;
    const tg=ctx.createLinearGradient(bx,by,bx+swob,by+tlen);
    tg.addColorStop(0,`hsla(${hue},72%,60%,.8)`);tg.addColorStop(1,`hsla(${hue},65%,50%,0)`);
    ctx.strokeStyle=tg;ctx.lineWidth=R*(.025+srand(i*3+seed)*.018);ctx.lineCap="round";
    ctx.beginPath();ctx.moveTo(bx,by);ctx.quadraticCurveTo(bx+swob*.5,by+tlen*.45,bx+swob,by+tlen);ctx.stroke();
    // lysende bolde for enden
    if(srand(i*5+seed)>.5){ctx.fillStyle=`hsla(${(hue+i*20)%360},85%,65%,.7)`;ctx.shadowColor=`hsl(${(hue+i*20)%360},85%,65%)`;ctx.shadowBlur=10;ctx.beginPath();ctx.arc(bx+swob,by+tlen,R*.04,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;}
  }
  // gennemsigtig kuppel
  const jg=ctx.createRadialGradient(cx-jRx*.3,cy-jRy*.35,jRx*.05,cx,cy,jRx);
  jg.addColorStop(0,`hsla(${hue},70%,82%,.75)`);jg.addColorStop(.5,`hsla(${hue},65%,62%,.55)`);jg.addColorStop(1,`hsla(${hue},60%,40%,.35)`);
  ctx.fillStyle=jg;ctx.beginPath();ctx.ellipse(cx,cy-jRy*.1,jRx,jRy*.78,0,-Math.PI,0);ctx.closePath();ctx.fill();
  // kant-glød
  const rimG=ctx.createLinearGradient(cx-jRx,cy,cx+jRx,cy);
  rimG.addColorStop(0,`hsla(${hue},80%,70%,.6)`);rimG.addColorStop(.5,`hsla(${hue},80%,90%,.9)`);rimG.addColorStop(1,`hsla(${hue},80%,70%,.6)`);
  ctx.strokeStyle=rimG;ctx.lineWidth=R*.04;ctx.beginPath();ctx.ellipse(cx,cy-jRy*.1,jRx,jRy*.78,0,-Math.PI,0);ctx.stroke();
  // indre glans
  const gl=ctx.createRadialGradient(cx-jRx*.3,cy-jRy*.35,jRx*.05,cx-jRx*.3,cy-jRy*.35,jRx*.7);
  gl.addColorStop(0,"rgba(255,255,255,.45)");gl.addColorStop(1,"rgba(255,255,255,0)");
  ctx.fillStyle=gl;ctx.beginPath();ctx.ellipse(cx-jRx*.28,cy-jRy*.38,jRx*.42,jRy*.32,-.45,0,Math.PI*2);ctx.fill();
  // ringe inden i (anatomisk detalje)
  for(let r=1;r<=3;r++){ctx.strokeStyle=`hsla(${hue},65%,55%,.25)`;ctx.lineWidth=R*.015;ctx.beginPath();ctx.ellipse(cx,cy-jRy*.08,jRx*(r/4),jRy*.6*(r/4),0,-Math.PI,0);ctx.stroke();}
  // øjne
  const er=R*.2,eg=jRx*.45;
  eyeball(cx-eg/2,cy-jRy*.25,er,hue,m,t);eyeball(cx+eg/2,cy-jRy*.22,er*.88,hue,m,t);
  brow(cx-eg/2,cy-jRy*.25,er,hue,m,-1);brow(cx+eg/2,cy-jRy*.22,er*.88,hue,m,1);
  drawMouth(cx,cy+jRy*.12,jRx*.55,R*.18*(1+m*.3),hue,m);
}

// ================================================================
//  6 NYE HORROR-ARKETYPER
// ================================================================
// ================================================================
//  6 NYE HORROR-ARKETYPER
// ================================================================

// 13. VIRUS  — ikosaeder-kerne med spike-proteiner, glødende receptorer
function drawVirus(cx,cy,rx,ry,R,hue,m,seed,t,cr){
  const N=18+Math.floor(cr.antennae*2);
  // pulserende giftigt glød bag alt
  ctx.save();
  ctx.shadowColor=`hsl(${hue},90%,50%)`;ctx.shadowBlur=40+Math.sin(t/200)*18;
  ctx.fillStyle=`hsla(${hue},80%,42%,.18)`;
  ctx.beginPath();ctx.arc(cx,cy,rx*1.38,0,Math.PI*2);ctx.fill();
  ctx.restore();

  // spike-proteiner (trimmede trekantede arme i alle retninger)
  for(let i=0;i<N;i++){
    const a=(i/N)*Math.PI*2+t/3000,wobA=Math.sin(t/220+i*0.9)*0.08;
    const bx=cx+Math.cos(a+wobA)*rx*.78,by=cy+Math.sin(a+wobA)*ry*.78;
    const tip=R*(.38+.18*srand(i+seed)+m*.12);
    const nx=Math.cos(a+wobA),ny=Math.sin(a+wobA),tx=-ny,ty=nx,w=R*(.032+srand(i*3+seed)*.02);
    // stilk
    const sg=ctx.createLinearGradient(bx,by,bx+nx*tip,by+ny*tip);
    sg.addColorStop(0,`hsl(${hue},62%,44%)`);sg.addColorStop(1,`hsl(${(hue+80)%360},80%,68%)`);
    ctx.fillStyle=sg;ctx.strokeStyle=`hsl(${hue},55%,26%)`;ctx.lineWidth=R*.008;
    ctx.beginPath();
    ctx.moveTo(bx+tx*w,by+ty*w);
    ctx.lineTo(bx+nx*tip*.7,by+ny*tip*.7);
    // bulbet receptor-hoved
    ctx.arc(bx+nx*tip,by+ny*tip,w*1.8,0,Math.PI*2);
    ctx.lineTo(bx-tx*w,by-ty*w);
    ctx.closePath();ctx.fill();ctx.stroke();
    // glødende receptor
    if(i%3===0){
      ctx.save();
      ctx.shadowColor=`hsl(${(hue+120)%360},90%,65%)`;ctx.shadowBlur=14;
      ctx.fillStyle=`hsl(${(hue+120)%360},90%,68%)`;
      ctx.beginPath();ctx.arc(bx+nx*tip,by+ny*tip,w*1.4,0,Math.PI*2);ctx.fill();
      ctx.restore();
    }
  }

  // ikosaeder-kerne (hexagonal facet-look)
  const facets=7;
  for(let f=0;f<facets;f++){
    const fa=(f/facets)*Math.PI*2+t/2200;
    const fr=rx*lerp(.28,.68,f/facets);
    const fg=ctx.createRadialGradient(cx+Math.cos(fa)*fr*.3,cy+Math.sin(fa)*fr*.3,0,cx+Math.cos(fa)*fr,cy+Math.sin(fa)*fr,fr*.8);
    fg.addColorStop(0,`hsl(${hue},60%,${52-f*3}%)`);fg.addColorStop(1,`hsl(${hue},55%,${30-f*2}%)`);
    ctx.fillStyle=fg;ctx.strokeStyle=`hsl(${hue},50%,22%)`;ctx.lineWidth=R*.014;
    ctx.beginPath();
    for(let v=0;v<6;v++){const va=fa+(v/6)*Math.PI*2;ctx.lineTo(cx+Math.cos(fa)*fr+Math.cos(va)*fr*.55,cy+Math.sin(fa)*fr*.95+Math.sin(va)*fr*.45);}
    ctx.closePath();ctx.fill();ctx.stroke();
  }
  // kerne-glans
  const kg=ctx.createRadialGradient(cx-rx*.32,cy-ry*.38,rx*.05,cx,cy,rx*.85);
  kg.addColorStop(0,"rgba(255,255,255,.36)");kg.addColorStop(1,"rgba(255,255,255,0)");
  ctx.fillStyle=kg;ctx.beginPath();ctx.arc(cx,cy,rx*.85,0,Math.PI*2);ctx.fill();

  // RNA-streng synlig inde i kernen (rød slyng)
  ctx.save();ctx.globalAlpha=.55;
  ctx.strokeStyle=`hsl(${(hue+170)%360},80%,55%)`;ctx.lineWidth=R*.025;ctx.lineCap="round";
  ctx.beginPath();
  for(let i=0;i<=20;i++){const f=i/20,a=f*Math.PI*5+t/600,r2=rx*(.12+.28*Math.abs(Math.sin(f*Math.PI)));ctx.lineTo(cx+Math.cos(a)*r2,cy+Math.sin(a)*r2*.85);}
  ctx.stroke();ctx.restore();

  // to uhyggelige øjne
  const er=R*.16,eg=rx*.38;
  eyeball(cx-eg,cy-ry*.08,er,hue,m,t);eyeball(cx+eg,cy-ry*.06,er*.9,hue,m,t);
  brow(cx-eg,cy-ry*.08,er,hue,m,-1);brow(cx+eg,cy-ry*.06,er*.9,hue,m,1);
  drawMouth(cx,cy+ry*.38,rx*.52,R*.16*(1+m*.35),hue,m);
}

// 14. BAKTERIE  — aflangt med roterende flageller, pili, celleform
function drawBacteria(cx,cy,rx,ry,R,hue,m,seed,t,cr){
  const bRx=rx*1.25,bRy=ry*.72;

  // flageller (lange piskende haler bagpå)
  const nflag=3+Math.floor(cr.segments/3);
  for(let i=0;i<nflag;i++){
    const fph=i*2.1+t/180+seed;
    const fx=cx+bRx*.68,fy=cy+(-0.5+i/(nflag-1))*bRy*.6;
    const flen=R*(1.2+.3*i);
    ctx.strokeStyle=`hsl(${(hue+40)%360},65%,52%)`;ctx.lineWidth=R*.018;ctx.lineCap="round";
    ctx.beginPath();ctx.moveTo(fx,fy);
    const steps=12;
    for(let s=1;s<=steps;s++){
      const sf=s/steps,wx=Math.sin(fph+sf*Math.PI*3)*R*.22*sf;
      ctx.lineTo(fx+sf*flen,fy+wx);
    }
    ctx.stroke();
    // rotationsring ved base
    ctx.strokeStyle=`hsl(${hue},60%,42%)`;ctx.lineWidth=R*.032;
    ctx.beginPath();ctx.arc(fx,fy,R*.06,0,Math.PI*2);ctx.stroke();
  }

  // pili (fine hår over hele overfladen)
  const npili=28;
  for(let i=0;i<npili;i++){
    const a=(i/npili)*Math.PI*2,px=cx+Math.cos(a)*bRx*.82,py=cy+Math.sin(a)*bRy*.82;
    const plen=R*(.06+srand(i+seed)*.06);
    ctx.strokeStyle=`hsla(${hue},58%,48%,.7)`;ctx.lineWidth=R*.008;
    ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(px+Math.cos(a)*plen,py+Math.sin(a)*plen);ctx.stroke();
  }

  // delingsplan (som om den er ved at dele sig)
  ctx.save();ctx.setLineDash([R*.04,R*.03]);
  ctx.strokeStyle=`hsla(${hue},65%,62%,.6)`;ctx.lineWidth=R*.018;
  ctx.beginPath();ctx.moveTo(cx,cy-bRy*.9);ctx.lineTo(cx,cy+bRy*.9);ctx.stroke();
  ctx.setLineDash([]);ctx.restore();

  // cellevæg — halvt gjennomsigtig
  const cg=ctx.createRadialGradient(cx-bRx*.3,cy-bRy*.35,bRx*.08,cx,cy,bRx);
  cg.addColorStop(0,`hsl(${hue},66%,${64-m*10}%)`);
  cg.addColorStop(.6,`hsl(${hue},62%,${46-m*8}%)`);
  cg.addColorStop(1,`hsl(${hue},58%,${28-m*6}%)`);
  ctx.fillStyle=cg;ctx.strokeStyle=`hsl(${hue},55%,20%)`;ctx.lineWidth=R*.04;
  ctx.beginPath();ctx.ellipse(cx,cy,bRx,bRy,0,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.save();ctx.beginPath();ctx.ellipse(cx,cy,bRx,bRy,0,0,Math.PI*2);ctx.clip();

  // to nukleoid-legemer (mørke sløjfer inde i)
  for(const s of[-1,1]){
    const ng=ctx.createRadialGradient(cx+s*bRx*.22,cy,0,cx+s*bRx*.22,cy,bRx*.32);
    ng.addColorStop(0,`hsla(${(hue+180)%360},70%,28%,.7)`);ng.addColorStop(1,"rgba(0,0,0,0)");
    ctx.fillStyle=ng;ctx.beginPath();ctx.ellipse(cx+s*bRx*.24,cy,bRx*.28,bRy*.42,0,0,Math.PI*2);ctx.fill();
  }
  // inclusion bodies (lyse prikker)
  for(let i=0;i<6;i++){
    const ibx=cx+(-0.5+srand(i+seed))*.8*bRx,iby=cy+(-0.5+srand(i*3+seed))*.7*bRy;
    ctx.fillStyle=`hsla(${hue},60%,82%,.65)`;
    ctx.beginPath();ctx.arc(ibx,iby,R*(.025+srand(i*5+seed)*.025),0,Math.PI*2);ctx.fill();
  }
  // glans
  const gl=ctx.createRadialGradient(cx-bRx*.32,cy-bRy*.42,bRx*.04,cx-bRx*.32,cy-bRy*.42,bRx*.65);
  gl.addColorStop(0,"rgba(255,255,255,.42)");gl.addColorStop(1,"rgba(255,255,255,0)");
  ctx.fillStyle=gl;ctx.fillRect(cx-bRx,cy-bRy,bRx*2,bRy*2);
  ctx.restore();

  // uhyggelige øjne spredt asymmetrisk
  eyeball(cx-bRx*.3,cy-bRy*.22,R*.2,hue,m,t);
  eyeball(cx+bRx*.35,cy-bRy*.18,R*.16,hue,m,t);
  eyeball(cx-bRx*.08,cy+bRy*.1,R*.13,hue,m,t);
  drawMouth(cx+bRx*.12,cy+bRy*.42,bRx*.48,R*.15*(1+m*.4),hue,m);
}

// 15. SLANGE  — spiralsno, skæl, gifttænder der drypper, spalte-pupil
function drawSnake(cx,cy,rx,ry,R,hue,m,seed,t,cr){
  const coils=3+Math.floor(cr.segments/2);

  // snoet krop (spiral med aftagende radius)
  const pts=[];
  const npts=coils*24;
  for(let i=0;i<npts;i++){
    const f=i/npts,a=f*Math.PI*2*coils+t/800;
    const rad=rx*(.9-f*.5),w=R*(.22-f*.14);
    pts.push({x:cx+Math.cos(a)*rad,y:cy+Math.sin(a)*rad*.7,w,f});
  }
  // tegn krop bagfra
  for(let i=pts.length-2;i>=0;i--){
    const p=pts[i],n=pts[i+1];
    const lg=ctx.createLinearGradient(p.x,p.y,n.x,n.y);
    lg.addColorStop(0,`hsl(${hue},65%,${42+p.f*12}%)`);
    lg.addColorStop(1,`hsl(${hue},62%,${38+n.f*12}%)`);
    ctx.strokeStyle=lg;ctx.lineWidth=p.w*2;ctx.lineCap="round";
    ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(n.x,n.y);ctx.stroke();
  }
  // skæl-mønster på kroppen
  for(let i=0;i<pts.length-1;i+=3){
    const p=pts[i];
    const sa=(i/pts.length)*Math.PI*2*coils+t/800+Math.PI/2;
    const sw=p.w*.7,sl=p.w*.55;
    ctx.fillStyle=`hsl(${(hue+20)%360},60%,${36+p.f*10}%)`;
    ctx.beginPath();ctx.ellipse(p.x,p.y,sw,sl,sa,0,Math.PI*2);ctx.fill();
  }
  // hale-spids
  const tp=pts[pts.length-1];
  ctx.fillStyle=`hsl(${(hue+40)%360},68%,55%)`;
  ctx.beginPath();ctx.arc(tp.x,tp.y,R*.04,0,Math.PI*2);ctx.fill();

  // hoved
  const hp=pts[0];
  const hR=R*.38,hue2=(hue+10)%360;
  const hg=ctx.createRadialGradient(hp.x-hR*.3,hp.y-hR*.28,hR*.08,hp.x,hp.y,hR*1.1);
  hg.addColorStop(0,`hsl(${hue2},70%,58%)`);hg.addColorStop(1,`hsl(${hue2},64%,32%)`);
  ctx.fillStyle=hg;ctx.strokeStyle=`hsl(${hue2},55%,22%)`;ctx.lineWidth=R*.028;
  ctx.beginPath();ctx.ellipse(hp.x,hp.y,hR*1.1,hR*.78,0,0,Math.PI*2);ctx.fill();ctx.stroke();
  // skæl-plader på hoved
  ctx.save();ctx.beginPath();ctx.ellipse(hp.x,hp.y,hR*1.1,hR*.78,0,0,Math.PI*2);ctx.clip();
  for(let r=0;r<3;r++){
    ctx.strokeStyle=`hsla(${hue2},55%,28%,.4)`;ctx.lineWidth=R*.015;
    ctx.beginPath();ctx.arc(hp.x,hp.y,hR*(.3+r*.28),0,Math.PI*2);ctx.stroke();
  }
  // pande-mønster
  ctx.fillStyle=`hsla(${(hue+30)%360},65%,46%,.6)`;
  ctx.beginPath();ctx.ellipse(hp.x,hp.y-hR*.22,hR*.45,hR*.28,0,0,Math.PI*2);ctx.fill();
  ctx.restore();

  // gifttænder med dryppende gift
  const fangY=hp.y+hR*.5,fw=hR*.18,flen=hR*(0.55+m*.45);
  for(const s of[-1,1]){
    const fx=hp.x+s*hR*.32;
    const fg=ctx.createLinearGradient(fx,fangY,fx,fangY+flen);
    fg.addColorStop(0,"#f0ece2");fg.addColorStop(.7,"#d8d4c8");fg.addColorStop(1,`hsl(${(hue+120)%360},80%,55%)`);
    ctx.fillStyle=fg;ctx.strokeStyle="rgba(80,60,40,.5)";ctx.lineWidth=R*.008;
    ctx.beginPath();ctx.moveTo(fx-fw*.4,fangY);ctx.lineTo(fx+fw*.4,fangY);ctx.lineTo(fx+fw*.1,fangY+flen);ctx.lineTo(fx,fangY+flen+fw*.18);ctx.lineTo(fx-fw*.1,fangY+flen);ctx.closePath();ctx.fill();ctx.stroke();
    // giftdråber
    for(let d=0;d<3;d++){
      const dp=((t/400+d*.4+i*.7)%1);
      const dx=fx+s*R*.02*d,dy=fangY+flen+dp*R*.35;
      ctx.save();
      ctx.shadowColor=`hsl(${(hue+120)%360},85%,55%)`;ctx.shadowBlur=8;
      ctx.fillStyle=`hsla(${(hue+120)%360},80%,55%,${1-dp})`;
      ctx.beginPath();ctx.arc(dx,dy,R*(.02*(1-dp*.5)),0,Math.PI*2);ctx.fill();
      ctx.restore();
    }
  }
  // tunge (kløftet, flimrende)
  const tungX=hp.x-hR*.9,tungY=hp.y+hR*.08,tungLen=R*(.4+Math.sin(t/150)*.08);
  ctx.strokeStyle="#cc2244";ctx.lineWidth=R*.022;ctx.lineCap="round";
  ctx.beginPath();ctx.moveTo(hp.x-hR*.9,hp.y);ctx.lineTo(tungX-tungLen*.8,tungY);ctx.stroke();
  for(const s of[-1,1]){ctx.beginPath();ctx.moveTo(tungX-tungLen*.8,tungY);ctx.lineTo(tungX-tungLen*1.2,tungY+s*R*.1);ctx.stroke();}

  // spalte-øjne
  for(const s of[-1,1]){
    const ex=hp.x+s*hR*.4,ey=hp.y-hR*.12,er=R*.16;
    eyeball(ex,ey,er,hue,m,t);
    // overtegn med vertikal spalte-pupil
    ctx.fillStyle="#070a0e";ctx.beginPath();ctx.ellipse(ex,ey,er*.18,er*.58,0,0,Math.PI*2);ctx.fill();
  }
}

// 16. SKORPION  — carapax, 8 ben, klosakse, segmenteret hale med lysende brod
function drawScorpion(cx,cy,rx,ry,R,hue,m,seed,t,cr){
  // hale-segmenter (svinger bagud og op)
  const nSeg=6;
  const tailPts=[];
  for(let i=0;i<nSeg;i++){
    const f=i/nSeg,a=-Math.PI*.5+f*Math.PI*.7+Math.sin(t/500)*.12;
    const px=cx+rx*.25+f*R*(.6+cr.tailLen*.3)*Math.cos(a);
    const py=cy-f*R*(.7+cr.tailLen*.35)*Math.sin(-a*.6+.2);
    tailPts.push({x:px,y:py,w:R*(.14-.015*i)});
  }
  for(let i=0;i<tailPts.length-1;i++){
    const p=tailPts[i],n=tailPts[i+1];
    const sg=ctx.createLinearGradient(p.x,p.y,n.x,n.y);
    sg.addColorStop(0,`hsl(${hue},62%,${40+i*3}%)`);sg.addColorStop(1,`hsl(${hue},58%,${36+i*3}%)`);
    ctx.strokeStyle=sg;ctx.lineWidth=(p.w+n.w);ctx.lineCap="round";
    ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(n.x,n.y);ctx.stroke();
    // segment-ring
    ctx.strokeStyle=`hsl(${hue},55%,24%)`;ctx.lineWidth=R*.012;
    ctx.beginPath();ctx.arc((p.x+n.x)/2,(p.y+n.y)/2,(p.w+n.w)*.38,0,Math.PI*2);ctx.stroke();
  }
  // brod
  const lp=tailPts[nSeg-1];
  const bg=ctx.createLinearGradient(lp.x,lp.y,lp.x-R*.22,lp.y-R*.28);
  bg.addColorStop(0,`hsl(${(hue+100)%360},80%,55%)`);bg.addColorStop(1,"#f6f0e2");
  ctx.fillStyle=bg;ctx.strokeStyle=`hsl(${hue},50%,22%)`;ctx.lineWidth=R*.014;
  ctx.beginPath();ctx.moveTo(lp.x-R*.14,lp.y);ctx.quadraticCurveTo(lp.x-R*.04,lp.y-R*.14,lp.x-R*.26,lp.y-R*.32);ctx.quadraticCurveTo(lp.x-R*.16,lp.y-.08,lp.x,lp.y);ctx.closePath();ctx.fill();ctx.stroke();
  // gift-glød på brodens spids
  ctx.save();
  ctx.shadowColor=`hsl(${(hue+100)%360},90%,55%)`;ctx.shadowBlur=18+Math.sin(t/180)*8;
  ctx.fillStyle=`hsl(${(hue+100)%360},88%,60%)`;
  ctx.beginPath();ctx.arc(lp.x-R*.26,lp.y-R*.32,R*.055,0,Math.PI*2);ctx.fill();
  ctx.restore();

  // 8 ben (4 på hver side)
  for(let i=0;i<4;i++){
    for(const s of[-1,1]){
      const f=i/3,by=cy-ry*.3+f*ry*.8,bx=cx+s*rx*.55;
      const ang=s>0?-Math.PI*.12-f*.3:Math.PI*1.12+f*.3;
      const blen=R*(.55+f*.1);
      const wob=Math.sin(t/280+i*1.3+s)*R*.025;
      ctx.strokeStyle=`hsl(${hue},60%,40%)`;ctx.lineWidth=R*(.07-.01*i);ctx.lineCap="round";
      const kx=bx+Math.cos(ang)*blen*.5+wob,ky=by+Math.sin(ang)*blen*.4+R*.08;
      const ex=bx+Math.cos(ang)*blen+wob*.6,ey=by+Math.sin(ang)*blen+R*.1;
      ctx.beginPath();ctx.moveTo(bx,by);ctx.lineTo(kx,ky);ctx.lineTo(ex,ey);ctx.stroke();
    }
  }

  // klosakse (pedipalps)
  for(const s of[-1,1]){
    const clx=cx+s*rx*.62,cly=cy-ry*.55;
    const cang=s>0?-Math.PI*.2:-Math.PI*.8;
    const clen=R*.62;
    ctx.strokeStyle=`hsl(${hue},62%,46%)`;ctx.lineWidth=R*.1;ctx.lineCap="round";
    ctx.beginPath();ctx.moveTo(cx+s*rx*.42,cy-ry*.35);ctx.lineTo(clx,cly);ctx.stroke();
    // klosaks-blade
    ctx.fillStyle=`hsl(${hue},62%,50%)`;ctx.strokeStyle=`hsl(${hue},55%,28%)`;ctx.lineWidth=R*.012;
    for(const cs of[-1,1]){
      ctx.beginPath();ctx.moveTo(clx,cly);
      ctx.lineTo(clx+Math.cos(cang+cs*.5)*clen*.52,cly+Math.sin(cang+cs*.5)*clen*.52);
      ctx.lineTo(clx+Math.cos(cang)*clen*.42+s*R*.08,cly+Math.sin(cang)*clen*.42);
      ctx.closePath();ctx.fill();ctx.stroke();
    }
  }

  // krop — plad chitinpanser
  const cRx=rx*.85,cRy=ry*.72;
  const cg=ctx.createRadialGradient(cx-cRx*.28,cy-cRy*.32,cRx*.1,cx,cy,cRx*1.2);
  cg.addColorStop(0,`hsl(${hue},68%,${52-m*10}%)`);
  cg.addColorStop(.55,`hsl(${hue},64%,${38-m*8}%)`);
  cg.addColorStop(1,`hsl(${hue},60%,${22-m*6}%)`);
  ctx.fillStyle=cg;ctx.strokeStyle=`hsl(${hue},52%,20%)`;ctx.lineWidth=R*.04;
  ctx.beginPath();ctx.ellipse(cx,cy,cRx,cRy,0,0,Math.PI*2);ctx.fill();ctx.stroke();
  // panser-plader
  ctx.save();ctx.beginPath();ctx.ellipse(cx,cy,cRx,cRy,0,0,Math.PI*2);ctx.clip();
  ctx.strokeStyle=`hsl(${hue},52%,24%)`;ctx.lineWidth=R*.018;
  for(let r=1;r<=3;r++){ctx.beginPath();ctx.ellipse(cx,cy,cRx*(r/3.5),cRy*(r/3.5),0,0,Math.PI*2);ctx.stroke();}
  ctx.moveTo(cx,cy-cRy);ctx.lineTo(cx,cy+cRy);ctx.stroke();
  // glans
  const gl=ctx.createRadialGradient(cx-cRx*.3,cy-cRy*.38,0,cx-cRx*.3,cy-cRy*.38,cRx*.68);
  gl.addColorStop(0,"rgba(255,255,255,.38)");gl.addColorStop(1,"rgba(255,255,255,0)");
  ctx.fillStyle=gl;ctx.fillRect(cx-cRx,cy-cRy,cRx*2,cRy*2);
  ctx.restore();

  // 6 simple øjne på forreste kant
  const eyeRow=[-.4,-.15,.12];
  for(const ef of eyeRow){
    const ex=cx+ef*cRx,ey=cy-cRy*.62,er=R*.1;
    eyeball(ex,ey,er,hue,m,t);
  }
  drawMouth(cx,cy+cRy*.38,cRx*.5,R*.16*(1+m*.35),hue,m);
}

// 17. DINO / T-REX  — kæmpehoved, panserkrop, tykke lår, pludrearme
function drawDino(cx,cy,rx,ry,R,hue,m,seed,t,cr){
  // hale
  const htpts=[];
  for(let i=0;i<7;i++){const f=i/6,a=f*Math.PI*.35+Math.sin(t/500+f*2)*.1;htpts.push({x:cx+rx*.2+f*R*.85*Math.cos(a*.6),y:cy+ry*.3+f*R*.55*Math.sin(a+.5),w:R*(.2-f*.025)});}
  for(let i=0;i<htpts.length-1;i++){
    const p=htpts[i],n=htpts[i+1];
    ctx.strokeStyle=`hsl(${hue},62%,${40+i*2}%)`;ctx.lineWidth=(p.w+n.w)*1.05;ctx.lineCap="round";
    ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(n.x,n.y);ctx.stroke();
  }
  // rygsøjle-pigge
  for(let i=0;i<8;i++){
    const f=i/7,spx=cx+(-rx*.65+rx*1.3*f),spy=cy-ry*(.52+.06*Math.sin(f*Math.PI));
    const slen=R*(.14+.1*(1-Math.abs(f-.5)*2)+m*.08);
    const sg=ctx.createLinearGradient(spx,spy,spx,spy-slen);
    sg.addColorStop(0,`hsl(${(hue+50)%360},70%,46%)`);sg.addColorStop(1,`hsl(${(hue+50)%360},65%,72%)`);
    ctx.fillStyle=sg;ctx.strokeStyle=`hsl(${(hue+50)%360},55%,28%)`;ctx.lineWidth=R*.008;
    ctx.beginPath();ctx.moveTo(spx-R*.048,spy);ctx.lineTo(spx,spy-slen);ctx.lineTo(spx+R*.048,spy);ctx.closePath();ctx.fill();ctx.stroke();
  }
  // tykke lår+ben
  for(const s of[-1,1]){
    const thx=cx+s*rx*.38,thy=cy+ry*.52;
    ctx.strokeStyle=`hsl(${hue},60%,44%)`;ctx.lineWidth=R*.28;ctx.lineCap="round";
    ctx.beginPath();ctx.moveTo(thx,thy);ctx.lineTo(thx+s*R*.12,thy+R*.52);ctx.stroke();
    ctx.strokeStyle=`hsl(${hue},58%,38%)`;ctx.lineWidth=R*.2;
    ctx.beginPath();ctx.moveTo(thx+s*R*.12,thy+R*.52);ctx.lineTo(thx+s*R*.18+Math.sin(t/300+s)*R*.04,thy+R*.88);ctx.stroke();
    // kloer
    ctx.fillStyle="#e8e2d0";
    for(let c=0;c<3;c++){const ca=ang=>({x:thx+s*R*.18+Math.cos(ang)*R*.12,y:thy+R*.88+Math.sin(ang)*R*.12});const base=ca(Math.PI*.4+c*.4-s*.1);ctx.beginPath();ctx.moveTo(thx+s*R*.18,thy+R*.88);ctx.lineTo(base.x,base.y);ctx.lineTo(base.x+s*R*.08,base.y+R*.06);ctx.closePath();ctx.fill();}
  }
  // krop med skaelstruktur
  scaleEdge(cx,cy,rx,ry,seed,hue,R);
  paintBody(cx,cy,rx,ry,hue,m,seed,t,{belly:true,spotMode:"stripes"});

  // stumpe arme
  for(const s of[-1,1]){
    const ax=cx+s*rx*.6,ay=cy-ry*.1;
    ctx.strokeStyle=`hsl(${hue},60%,48%)`;ctx.lineWidth=R*.09;ctx.lineCap="round";
    const elen=R*.28,aang=s>0?-Math.PI*.08:-Math.PI*.92;
    ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(ax+Math.cos(aang)*elen,ay+Math.sin(aang)*elen+R*.1);ctx.stroke();
    // to kloer
    ctx.fillStyle="#e8e2d0";
    for(const cs of[-1,1]){ctx.beginPath();ctx.moveTo(ax+Math.cos(aang)*elen,ay+Math.sin(aang)*elen+R*.1);ctx.lineTo(ax+Math.cos(aang)*elen+s*R*.06,ay+Math.sin(aang)*elen+R*.1+cs*R*.07);ctx.lineTo(ax+Math.cos(aang)*elen+s*R*.1,ay+Math.sin(aang)*elen+R*.1);ctx.closePath();ctx.fill();}
  }

  // kæmpehoved (1/3 af total størrelse)
  const hR=R*.58,hx=cx-rx*.12,hy=cy-ry*.62;
  // hals
  ctx.strokeStyle=`hsl(${hue},62%,46%)`;ctx.lineWidth=R*.32;ctx.lineCap="round";
  ctx.beginPath();ctx.moveTo(cx-rx*.05,cy-ry*.22);ctx.lineTo(hx,hy+hR*.55);ctx.stroke();
  // hoved
  const hg=ctx.createRadialGradient(hx-hR*.3,hy-hR*.2,hR*.08,hx,hy,hR*1.1);
  hg.addColorStop(0,`hsl(${hue},70%,${60-m*10}%)`);hg.addColorStop(1,`hsl(${hue},64%,${34-m*8}%)`);
  ctx.fillStyle=hg;ctx.strokeStyle=`hsl(${hue},55%,22%)`;ctx.lineWidth=R*.03;
  ctx.beginPath();ctx.ellipse(hx,hy,hR*1.15,hR*.72,-.15,0,Math.PI*2);ctx.fill();ctx.stroke();
  // næsehorn
  const nh=(hue+50)%360;
  ctx.fillStyle=`hsl(${nh},65%,52%)`;
  ctx.beginPath();ctx.moveTo(hx-hR*.85,hy-hR*.18);ctx.lineTo(hx-hR*1.15,hy-hR*.4+m*R*.08);ctx.lineTo(hx-hR*.8,hy+hR*.05);ctx.closePath();ctx.fill();
  scaleEdge(hx,hy,hR*1.1,hR*.68,seed+99,hue,R*.85);
  // mund
  drawMouth(hx-hR*.08,hy+hR*.42,hR*1.3,hR*.38*(1+m*.5),hue,m);
  // øjne med panserskin-ring
  for(const s of[-1,1]){
    const ex=hx+s*hR*.44,ey=hy-hR*.2,er=R*.2;
    ctx.fillStyle=`hsl(${hue},55%,28%)`;ctx.beginPath();ctx.arc(ex,ey,er*1.35,0,Math.PI*2);ctx.fill();
    eyeball(ex,ey,er,hue,m,t);
    brow(ex,ey,er,hue,m,s);
  }
  // næsebor
  for(const s of[-1,1]){ctx.fillStyle=`rgba(0,0,0,.5)`;ctx.beginPath();ctx.ellipse(hx-hR*.72+s*hR*.1,hy-hR*.02,R*.04,R*.03,-0.4,0,Math.PI*2);ctx.fill();}
}

// 18. CELLE / AMØBE  — skiftende membran, pseudopoder, synlig kerne, organeller
function drawCell(cx,cy,rx,ry,R,hue,m,seed,t,cr){
  // udstikkende pseudopoder (det der gør amøben uhyggelig)
  const npseudo=5+Math.floor(cr.tentacles/2);
  for(let i=0;i<npseudo;i++){
    const a=(i/npseudo)*Math.PI*2+t/1800+srand(i+seed)*Math.PI;
    const plen=R*(.55+srand(i*3+seed)*.45+Math.sin(t/350+i*1.7)*.18);
    const pw=R*(.12+srand(i*5+seed)*.1);
    const bx=cx+Math.cos(a)*rx*.7,by=cy+Math.sin(a)*ry*.7;
    const tipx=cx+Math.cos(a)*plen*1.1,tipy=cy+Math.sin(a)*ry*.5+Math.sin(a)*plen*.65;
    const pg=ctx.createLinearGradient(bx,by,tipx,tipy);
    pg.addColorStop(0,`hsla(${hue},60%,52%,.72)`);pg.addColorStop(1,`hsla(${hue},58%,42%,.2)`);
    ctx.strokeStyle=pg;ctx.lineWidth=pw*2;ctx.lineCap="round";
    ctx.beginPath();ctx.moveTo(bx,by);ctx.quadraticCurveTo(bx+Math.cos(a+.5)*plen*.4,by+Math.sin(a+.5)*plen*.4,tipx,tipy);ctx.stroke();
    // vakuole i spidsen
    if(srand(i*7+seed)>.4){
      ctx.fillStyle=`hsla(${(hue+100)%360},65%,58%,.5)`;
      ctx.beginPath();ctx.arc(tipx,tipy,R*.06,0,Math.PI*2);ctx.fill();
    }
  }

  // ydre membran (uregelmæssig, skiftende)
  ctx.fillStyle=`hsla(${hue},58%,${48-m*10}%,.85)`;
  ctx.strokeStyle=`hsl(${hue},52%,28%)`;ctx.lineWidth=R*.038;
  ctx.beginPath();
  const N=28;
  for(let i=0;i<=N;i++){
    const a=(i/N)*Math.PI*2;
    const wr=1+Math.sin(t/380+a*3+seed)*.08+Math.sin(t/260+a*5+seed*.5)*.05;
    ctx.lineTo(cx+Math.cos(a)*rx*wr,cy+Math.sin(a)*ry*wr);
  }
  ctx.closePath();ctx.fill();ctx.stroke();

  // indre cytoplasma-indhold (klippet til celle-form)
  ctx.save();
  ctx.beginPath();
  for(let i=0;i<=N;i++){
    const a=(i/N)*Math.PI*2;
    const wr=1+Math.sin(t/380+a*3+seed)*.08+Math.sin(t/260+a*5+seed*.5)*.05;
    ctx.lineTo(cx+Math.cos(a)*rx*wr,cy+Math.sin(a)*ry*wr);
  }
  ctx.closePath();ctx.clip();

  // cytoplasma-gradienter (grumset intern look)
  const cg=ctx.createRadialGradient(cx,cy,rx*.1,cx,cy,rx);
  cg.addColorStop(0,`hsl(${hue},55%,${58-m*8}%)`);
  cg.addColorStop(.6,`hsl(${hue},52%,${44-m*6}%)`);
  cg.addColorStop(1,`hsl(${hue},50%,${30-m*5}%)`);
  ctx.fillStyle=cg;ctx.fillRect(cx-rx*1.3,cy-ry*1.3,rx*2.6,ry*2.6);

  // mitokondrier (ovale lysende organeller)
  for(let i=0;i<8;i++){
    const ma=srand(i+seed)*Math.PI*2,mr=rx*(.22+srand(i*3+seed)*.42);
    const mx=cx+Math.cos(ma)*mr,my=cy+Math.sin(ma)*ry*.8*(.22+srand(i*3+seed)*.42)/rx*rx;
    const mrot=srand(i*7+seed)*Math.PI;
    const mg=ctx.createRadialGradient(mx,my,0,mx,my,R*.08);
    mg.addColorStop(0,`hsla(${(hue+60)%360},72%,62%,.8)`);mg.addColorStop(1,`hsla(${(hue+60)%360},65%,42%,.4)`);
    ctx.fillStyle=mg;ctx.beginPath();ctx.ellipse(mx,my,R*.1,R*.055,mrot,0,Math.PI*2);ctx.fill();
    // mitokondriens indre folder
    ctx.strokeStyle=`hsla(${(hue+60)%360},65%,52%,.5)`;ctx.lineWidth=R*.007;
    ctx.beginPath();ctx.ellipse(mx,my,R*.065,R*.03,mrot,0,Math.PI*2);ctx.stroke();
  }

  // vakuoler (store tomme bobler)
  for(let i=0;i<4;i++){
    const va=srand(i*11+seed)*Math.PI*2,vr=rx*(.1+srand(i*13+seed)*.35);
    const vx=cx+Math.cos(va)*vr*.7,vy=cy+Math.sin(va)*ry*.6;
    const vrad=R*(.06+srand(i*17+seed)*.1);
    ctx.fillStyle=`hsla(${hue},45%,72%,.3)`;ctx.strokeStyle=`hsla(${hue},50%,50%,.5)`;ctx.lineWidth=R*.012;
    ctx.beginPath();ctx.arc(vx,vy,vrad,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.fillStyle="rgba(255,255,255,.2)";ctx.beginPath();ctx.arc(vx-vrad*.28,vy-vrad*.28,vrad*.3,0,Math.PI*2);ctx.fill();
  }

  // kerne (stor, tydelig, uhyggelig)
  const nR=rx*.42;
  const nuc=ctx.createRadialGradient(cx-nR*.25,cy-nR*.25,nR*.08,cx,cy,nR);
  nuc.addColorStop(0,`hsl(${(hue+180)%360},62%,${46-m*12}%)`);
  nuc.addColorStop(.65,`hsl(${(hue+180)%360},58%,${30-m*10}%)`);
  nuc.addColorStop(1,`hsl(${(hue+180)%360},55%,${18-m*8}%)`);
  ctx.fillStyle=nuc;ctx.strokeStyle=`hsl(${(hue+180)%360},50%,20%)`;ctx.lineWidth=R*.022;
  ctx.beginPath();ctx.ellipse(cx,cy,nR,nR*.88,t/2000,0,Math.PI*2);ctx.fill();ctx.stroke();
  // nukleoler (mørke indre kerner)
  for(const s of[-1,1]){
    ctx.fillStyle=`hsl(${(hue+180)%360},52%,16%)`;
    ctx.beginPath();ctx.ellipse(cx+s*nR*.24,cy-nR*.12,nR*.18,nR*.14,0,0,Math.PI*2);ctx.fill();
  }
  // kerne-glans
  ctx.fillStyle="rgba(255,255,255,.28)";
  ctx.beginPath();ctx.ellipse(cx-nR*.24,cy-nR*.3,nR*.32,nR*.2,-.5,0,Math.PI*2);ctx.fill();

  // membran-glans
  const gl=ctx.createRadialGradient(cx-rx*.32,cy-ry*.38,rx*.04,cx-rx*.32,cy-ry*.38,rx*.75);
  gl.addColorStop(0,"rgba(255,255,255,.35)");gl.addColorStop(1,"rgba(255,255,255,0)");
  ctx.fillStyle=gl;ctx.fillRect(cx-rx*1.3,cy-ry*1.3,rx*2.6,ry*2.6);
  ctx.restore();

  // øjne (stalkede, stikker ud af membranen)
  const eyeAngles=[-Math.PI*.38, -Math.PI*.62];
  eyeAngles.forEach((a,i)=>{
    const bex=cx+Math.cos(a)*rx*.88,bey=cy+Math.sin(a)*ry*.88;
    const er=R*.17+i*R*.03;
    const stlen=R*(.18+Math.sin(t/420+i)*.04);
    ctx.strokeStyle=`hsl(${hue},55%,44%)`;ctx.lineWidth=R*.04;ctx.lineCap="round";
    ctx.beginPath();ctx.moveTo(bex,bey);ctx.lineTo(bex+Math.cos(a)*stlen,bey+Math.sin(a)*stlen);ctx.stroke();
    eyeball(bex+Math.cos(a)*stlen,bey+Math.sin(a)*stlen,er,hue,m,t);
  });
  drawMouth(cx,cy+ry*.62,rx*.52,R*.16*(1+m*.35),hue,m);
}


function drawMonsterBig(t){
  if(!creature)creature=buildCreature();
  const prog=Math.min((t-revealStart)/720,1),pop=easeOutBack(prog);
  const cx=W/2,cy=H*.54,R=Math.min(W,H)*.30;
  const aspect=lerp(.85,1.3,base.body);
  const rx=R*Math.sqrt(aspect)*pop,ry=R/Math.sqrt(aspect)*pop;
  const hue=base.hue,seed=base.gap*7,m=menace,cr=creature;

  ctx.fillStyle="rgba(0,0,0,.28)";
  ctx.beginPath();ctx.ellipse(cx,cy+ry*1.02,rx*.95,ry*.16,0,0,Math.PI*2);ctx.fill();

  ctx.save();
  ctx.translate(cx,cy+(1-pop)*70);
  const idle=1+Math.sin(t/600)*.02;
  ctx.scale(idle,2-idle);
  ctx.translate(-cx,-cy);

  if(cr.type==="octopus")      drawOctopus(cx,cy,rx,ry,R,hue,m,seed,t,cr);
  else if(cr.type==="multihead") drawMultihead(cx,cy,rx,ry,R,hue,m,seed,t,cr);
  else if(cr.type==="beast")   drawBeast(cx,cy,rx,ry,R,hue,m,seed,t,cr);
  else if(cr.type==="fish")    drawFish(cx,cy,rx,ry,R,hue,m,seed,t,cr);
  else if(cr.type==="bird")    drawBird(cx,cy,rx,ry,R,hue,m,seed,t,cr);
  else if(cr.type==="worm")    drawWorm(cx,cy,rx,ry,R,hue,m,seed,t,cr);
  else if(cr.type==="alien")   drawAlien(cx,cy,rx,ry,R,hue,m,seed,t,cr);
  else if(cr.type==="crab")    drawCrab(cx,cy,rx,ry,R,hue,m,seed,t,cr);
  else if(cr.type==="dragon")  drawDragon(cx,cy,rx,ry,R,hue,m,seed,t,cr);
  else if(cr.type==="eyeball") drawEyeball(cx,cy,rx,ry,R,hue,m,seed,t,cr);
  else if(cr.type==="jelly")   drawJelly(cx,cy,rx,ry,R,hue,m,seed,t,cr);
  else if(cr.type==="virus")   drawVirus(cx,cy,rx,ry,R,hue,m,seed,t,cr);
  else if(cr.type==="bacteria")drawBacteria(cx,cy,rx,ry,R,hue,m,seed,t,cr);
  else if(cr.type==="snake")   drawSnake(cx,cy,rx,ry,R,hue,m,seed,t,cr);
  else if(cr.type==="scorpion")drawScorpion(cx,cy,rx,ry,R,hue,m,seed,t,cr);
  else if(cr.type==="dino")    drawDino(cx,cy,rx,ry,R,hue,m,seed,t,cr);
  else if(cr.type==="cell")    drawCell(cx,cy,rx,ry,R,hue,m,seed,t,cr);
  else                          drawBlob(cx,cy,rx,ry,R,hue,m,seed,t,cr);

  ctx.restore();

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
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const res = faceLandmarker.detectForVideo(video, t);
      if (res.faceLandmarks && res.faceLandmarks.length) sampleFace(res.faceLandmarks[0]);
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
  splashImg.style.display = "block";
  setPrompt(t("pressStart"));
  status("");
}

againBtn.addEventListener("click", () => {
  if (vstream && vstream.active) startRound();
  else backToStart();
});

setupCanvas();
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
splashImg.style.display = "block";
applyLang();
requestAnimationFrame(mainLoop);
