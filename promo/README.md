# Monster Builder — promo film (9:16)

A 41-second vertical (1080×1920, 30 fps) presentation film for
[monster-builder.larssohl.dk](https://monster-builder.larssohl.dk/), cut to a 70 BPM
heartbeat. Everything is generated from this repo: the 3D monsters are the site's own
`monster3d.js` renderer, the logo is `monster-builder-splash.png`, and the phone shots are
real captures of the live site. Both picture and sound are rendered deterministically.

| File | What it is |
|:--|:--|
| `out/` (git-ignored) | Rendered films: `monster-builder-promo-{en,da}.mp4` (master, ~9 Mbps) and `-social.mp4` (~5 Mbps) |
| `film.html` / `film.js` | The film as a frame-by-frame canvas renderer |
| `m3d.js` | Loads isolated instances of `../monster3d.js` (no change to the site's code) |
| `music.py` | Score + sound design, synthesized with numpy/scipy on the same beat grid |
| `render.mjs` | Steps through the frames in headless Chromium and pipes them to ffmpeg |
| `assets/` | Face-landmark mesh (from MediaPipe's `canonical_face_model.obj`, Apache-2.0) + site captures for the phone |

## Storyboard (beats at 70 BPM, 1 beat = 0.857 s)

| Beats | Shot | Sound |
|:--|:--|:--|
| 0–8 | Glowing eyes open in the cave. *"Every face hides a monster."* Zoom into the pupil. | Heartbeat starts, deep drone, bell, riser into a hard cut |
| 8–16 | **01 Scan your face** — 3D landmark mesh assembles, scan line, HUD (LANDMARKS / BIOMETRIC / DNA LOCK), BODY·EYE·GAP·MOUTH readouts, DNA collapses into an orb | 16th-note data plucks, scan sweeps, lock chimes, suction riser |
| 16–24 | **02 Roar for 5 seconds** — GET READY!, ROAR!/SCREAM! 5-4-3-2-1 over the cauldron while the monster's silhouette grows; glitch; one beat of total silence with the eyes | Taiko hits + synthesized growls per slice, the site's beeps and 180→720 Hz riser, glitch stutter, silence + lone heartbeat |
| 24–31 | **03 Meet your monster** — the hero pops out on the spinning reveal background with confetti | Boom, the monster's roar, groove starts (kick, snare on 2 & 4, hats) |
| 31–37 | Roster: Octopus · Eye monster · Jelly · Dino · Virus · Beast — whip, iris, slime, glitch, whip, zoom transitions | A different transition sound + a creature call per cut |
| 37–40 | All 18 species pop into a grid. *"18 species. Endless mutations."* | 17 rising pops |
| 40–43 | The real site on a phone + No app · 100% private · Say "MONSTER!" | Breathing room, bells per feature |
| 43–48 | Logo splat, *"Scan. Roar. Birth a monster."*, Play now, URL types in, fade | Impact + slime splat, resolution to D minor, typing, last heartbeat |

Text keeps to the 9:16 safe area (roughly y 240–1640) so platform UI doesn't cover it.

## Re-render

Needs Node + Playwright (Chromium), Python 3 with numpy + scipy, and ffmpeg.

```bash
# from the repo root: serve the site (film.js fetches ../monster3d.js and the logo)
python3 -m http.server 8765 --bind 127.0.0.1 &

cd promo
python3 music.py /tmp/score.wav
node render.mjs --lang en --out /tmp/video_en.mp4          # ~1–2 s/frame with SwiftShader
ffmpeg -i /tmp/video_en.mp4 -i /tmp/score.wav -c:v copy -c:a aac -b:a 256k -movflags +faststart -shortest out/monster-builder-promo-en.mp4

# preview single frames
node render.mjs --lang da --frames 0,300,700 --preview /tmp/preview
```

`render.mjs --range a:b` renders a slice, so several workers can run in parallel and be
joined with ffmpeg's concat demuxer.
