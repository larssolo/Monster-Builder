# Monster Builder 👹

Et stemme- og kameradrevet monstergenerator-spil til børn (3-6 år).

## Filer

```
monster-builder/
├── index.html    ← HTML + CSS (UI og layout)
├── app.js        ← Alt JavaScript (logik, tegning, tale-genkendelse)
├── monster.png   ← Favicon
└── README.md
```

## Kom i gang

Da spillet bruger kamera og mikrofon kræves en **sikker kontekst** (`https://` eller `localhost`).

### Lokalt med Python

```bash
cd monster-builder
python3 -m http.server 8000
```

Åbn derefter **http://localhost:8000** i Chrome.

### Git

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/<dig>/<repo>.git
git push -u origin main
```

## Gameplay

1. Klik **Start** (én gang — giver kamera- og mikrofon-tilladelse)
2. Sig **"MONSTER"** — ansigts-scan starter automatisk
3. **Brøl, skrig og griiig** i 5 sekunder
4. **Glitch → kæmpe monster** på regnbue-baggrund
5. Sig **"MONSTER"** igen → nyt spil

Ingen knapklik nødvendige efter første start.

## Teknik

| Komponent | Teknologi |
|---|---|
| Ansigts-scan | MediaPipe FaceLandmarker (on-device, WASM) |
| Lyd-analyse | Web Audio API (RMS, spectral centroid, onsets) |
| Stemme-genkendelse | Web Speech API (`da-DK`, kun Chrome/Edge) |
| Tegning | HTML Canvas 2D |
| Afhængigheder | Ingen — én HTML + én JS-fil |

## Privatliv

- Alt kører i browseren — intet billede eller lyd sendes nogen steder
- Kun geometriske mål (ansigtets form, lydstyrke/toneleje) bruges
- Ingen ansigts- eller følelsegenkendelse

## 18 monster-arketyper

Blob · Flerhovedet · Blæksprutte · Bæst/bjørn · Fisk · Fugl · Orm/maddike ·
Alien · Krabbe · Drage · Kæmpe øjemonster · Gelé/manet ·
Virus · Bakterie · Slange · Skorpion · Dino/T-Rex · Celle/amøbe

## Browser-support

Chrome og Edge (Chromium) anbefales — Web Speech API virker ikke i Firefox eller Safari.
