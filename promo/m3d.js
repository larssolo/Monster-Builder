// Loads an isolated instance of the site's real 3D renderer (../monster3d.js).
// Each call gets its own module instance (own renderer/scene/camera) by importing
// the source through a Blob URL, plus a few extra exports for camera control.
// No change to the production file is needed.

let SRC = null;

export async function loadInstance(canvas, w, h) {
  if (!SRC) SRC = await (await fetch(new URL("../monster3d.js", import.meta.url), { cache: "no-store" })).text();
  const extra = `
export function __cam(){ return camera; }
export function __scene(){ return scene; }
export function __renderer(){ return renderer; }
export function __monster(){ return monster; }
export function __ground(){ return ground; }
export function __eyes(){ return eyes; }
export function __three(){ return THREE; }
`;
  // The builders use Math.random() for hair/drool lengths. Swap it for a generator that is
  // re-seeded from the DNA on every build, so a creature looks identical on every frame,
  // in every instance and in every parallel render worker.
  const seeded = SRC
    .replaceAll("Math.random()", "__rand()")
    .replace("export function build(dna) {", "export function build(dna) {\n  __seed = 1 + Math.abs(Math.floor(dna.creature.sn * 7919)) % 2147483645;");
  const prelude = "let __seed = 1;\nfunction __rand() { __seed = (__seed * 16807) % 2147483647; return (__seed - 1) / 2147483646; }\n";
  const url = URL.createObjectURL(new Blob([prelude + seeded + extra], { type: "text/javascript" }));
  const mod = await import(url);
  mod.init(canvas);
  mod.__renderer().setPixelRatio(1);
  mod.resize(w, h);
  return mod;
}

// Same seeded generator as app.js so a DNA "seed" gives a stable creature.
function makeRng(seed) { let s = ((Math.floor(seed) % 233280) + 233280) % 233280 || 1; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }

export function makeDNA({ type, hue = 200, menace = 0.5, seed = 1, body = 0.5, eye = 0.5, gap = 0.5, mouth = 0.6, bright = 0.5, parts = [] }) {
  const rng = makeRng(seed * 977 + 13);
  const pick = (a) => a[Math.floor(rng() * a.length)];
  const creature = {
    type, rng, sn: seed * 131 + 7,
    heads: pick([2, 2, 3]), eyeCount: pick([1, 2, 2, 2, 3]),
    tentacles: 4 + Math.floor(rng() * 5), hornStyle: pick(["curved", "curved", "none"]),
    armLen: 0.8 + rng() * 0.6, spotMode: pick(["spots", "spots", "stripes", "none"]),
    tailLen: 0.7 + rng() * 0.8, feathers: 5 + Math.floor(rng() * 5), segments: 4 + Math.floor(rng() * 4),
    antennae: 2 + Math.floor(rng() * 3), fins: 3 + Math.floor(rng() * 4), coils: 3 + Math.floor(rng() * 3),
    spikes: 6 + Math.floor(rng() * 10), pseudopods: 5 + Math.floor(rng() * 5)
  };
  return {
    base: { body, eye, gap, mouth, hue, captured: true },
    parts, creature, menace,
    voice: { loud: menace, rough: menace, bright }
  };
}
