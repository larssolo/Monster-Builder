<div align="center">

<img src="monster-builder-splash.png" alt="Monster Builder" width="560">

---

### 🎤 Scan your face · Scream for 5 seconds · Birth a monster

[![Play Now](https://img.shields.io/badge/▶%20PLAY%20NOW-monster--builder-7ef060?style=for-the-badge&logo=google-chrome&logoColor=black)](https://monster-builder-larssolo.vercel.app)
&nbsp;
[![Language](https://img.shields.io/badge/🌍-Danish%20%7C%20English-9ad0ff?style=for-the-badge)](https://monster-builder-larssolo.vercel.app)
&nbsp;
[![No install](https://img.shields.io/badge/📦%20Install-none-ff2e63?style=for-the-badge)](https://monster-builder-larssolo.vercel.app)

</div>

---

## 🎮 How to play

<div align="center">

| | |
|:--:|:--|
| **1** | Click the Monster Builder logo |
| **2** | Hold your face still while it's scanned |
| **3** | **ROAR · SCREAM · ROAR** for 5 seconds 🔊 |
| **4** | Watch your monster be born with a glitch-reveal 👹 |
| **5** | Say **MONSTER!** to play again |

</div>

---

## 👾 Meet the monster roster

```
  BLOB              MULTI-HEAD          TENTACLE
  ╭━━━━━╮           ╭╮   ╭╮             ╭━━━━━╮
  │ ◉ ◉ │          (◉) (◉)(◉)          │ ◉ ◉ │
  │  ▽  │           ╰━━━━━╯            ╰━━━━━╯
  ╰~~~~~╯          ╭━━━━━━━╮         ∫∫∫│││∫∫∫
  ░░░░░░░░         │ ▽▽▽▽▽ │          ∫∫∫∫∫∫∫∫

  ALIEN             DRAGON              EYE MONSTER
   ∧___∧           ╱▔▔╲╱▔▔╲            ╭━━━━━╮
  (⊙   ⊙)        ╱  ◉  ◉  ╲         ╭──│◎◎◎◎│──╮
   ╰━▽━╯        ╱____________╲        ╰──╰━━━━╯──╯
   ╱┃┃┃╲        ▓▓▓▓▓▓▓▓▓▓▓▓▓       ░░░░░░░░░░░░
```

**18 unique archetypes:** Blob · Multi-head · Tentacle · Beast · Fish · Bird · Worm · Alien · Crab · Dragon · Eye Monster · Jelly · Virus · Bacteria · Snake · Scorpion · Dino · Amoeba

---

## ✨ Features

- 🎭 **Face → Monster** — MediaPipe scans your face shape and uses it as monster DNA
- 🔊 **Voice → Personality** — Your voice's volume, pitch and rhythm shape the monster's look
- 🌍 **Danish + English** — Auto-detects your browser language, or tap 🌍 to switch
- 👆 **One click** — Tap the logo, everything else happens by itself
- 🔒 **100% private** — No data ever leaves your browser
- 📱 **No install** — Open in Chrome or Edge and play

---

## 🛠 Tech stack

| Component | Technology |
|:--|:--|
| Face scanning | MediaPipe FaceLandmarker (on-device WASM) |
| Audio analysis | Web Audio API (RMS · spectral centroid · onsets) |
| Voice recognition | Web Speech API (`en-US` / `da-DK`) |
| Monster rendering | **3D Three.js / WebGL** — all 18 archetypes, voice/face-reactive (cute → terrifying) with teeth, drool, varied eyes, hair & spikes |
| Reveal effect | SVG conic-gradient + CSS glitch animation |
| Hover effects | 3 random: slime-wobble · electric glitch · monster pulse |
| Deployment | GitHub → Vercel (auto) |
| Dependencies | No build step — **Three.js** is loaded straight from a CDN (like MediaPipe) for the 3D monsters |

---

## 🔒 Privacy

> Everything runs in your browser. No image or audio is stored or transmitted — only geometric measurements are used (face shape, volume and pitch). No facial recognition, no emotion detection. The monster's roar is a new sound generated from your audio data.

---

## 🚀 Run locally

```bash
git clone https://github.com/larssolo/Monster-Builder.git
cd Monster-Builder
python3 -m http.server 8000
# Open http://localhost:8000 in Chrome
```

> Requires **Chrome** or **Edge** — Web Speech API is not supported in Firefox or Safari

---

## 📁 Project structure

```
Monster-Builder/
├── index.html                 ← HTML + CSS (layout, animations, fonts)
├── app.js                     ← All JavaScript (logic, canvas, speech, audio)
├── monster3d.js               ← 3D Pixar-style monster renderer (Three.js / WebGL)
├── monster-builder-splash.png ← Splash logo with slime effect
├── monster.png                ← Favicon
└── README.md
```

---

<div align="center">

Made with 👹 roars and ❤️ love

**[larssolo](https://github.com/larssolo)** · Powered by MediaPipe + Web APIs + Canvas

</div>
