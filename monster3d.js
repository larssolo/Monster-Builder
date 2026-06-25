// monster3d.js — 3D Pixar-style monster renderer (Three.js / WebGL).
// Pilot archetypes: blob, beast, eyeball. Driven by the same DNA the 2D
// renderer uses (base / parts / creature / menace). All Three.js lives here so
// app.js stays focused on flow + the 2D fallback path for the other archetypes.

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

// ---------------- module state ----------------
let renderer = null, scene = null, camera = null, envTex = null;
let keyLight = null, ground = null;
let monster = null;          // THREE.Group for the current creature
let eyes = [];               // [{ group, lid, lookTarget }]
let builtSig = null;         // signature of the DNA we last built
let _w = 0, _h = 0;

const PILOT = new Set(["blob", "beast", "eyeball"]);
export const supports = (type) => PILOT.has(type);

// ---------------- helpers ----------------
const easeOutBack = (x) => { const c = 2.2; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// HSL (h in 0..360) -> THREE.Color
function hsl(h, s, l) { return new THREE.Color().setHSL(((h % 360) + 360) % 360 / 360, s, l); }

// cheap smooth pseudo-noise for organic body lumps
function lump(x, y, z, seed) {
  return Math.sin(x * 1.7 + seed) * 0.5
       + Math.sin(y * 2.3 + seed * 1.3) * 0.32
       + Math.sin(z * 1.9 + seed * 0.7) * 0.4
       + Math.sin((x + y + z) * 1.1 + seed * 0.5) * 0.28;
}

// soft, matte plush body material
function bodyMat(hue, menace) {
  const light = clamp(0.56 - menace * 0.12, 0.32, 0.6);
  const col = hsl(hue, clamp(0.62 - menace * 0.1, 0.3, 0.7), light);
  return new THREE.MeshPhysicalMaterial({
    color: col, roughness: 0.55, metalness: 0,
    clearcoat: 0.3, clearcoatRoughness: 0.5,
    sheen: 0.7, sheenRoughness: 0.85, sheenColor: hsl(hue, 0.6, 0.78),
    envMapIntensity: 0.9
  });
}

// a blobby icosphere displaced by noise; returns a Mesh centred on origin
function blobMesh(radius, seed, lumpAmt, mat) {
  const geo = new THREE.IcosahedronGeometry(radius, 5);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = lump(v.x * 0.95, v.y * 0.95, v.z * 0.95, seed);
    const f = 1 + lumpAmt * n;
    v.multiplyScalar(f);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

// one glossy Pixar eye (with catchlight); returns { group, lid }
function makeEye(r, irisHue) {
  const group = new THREE.Group();

  const sclera = new THREE.Mesh(
    new THREE.SphereGeometry(r, 32, 32),
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0.22, metalness: 0,
      clearcoat: 0.5, clearcoatRoughness: 0.22, envMapIntensity: 0.8
    })
  );
  sclera.castShadow = true;
  group.add(sclera);

  // iris + pupil sit proud of the sclera surface so they're always visible
  const iris = new THREE.Mesh(
    new THREE.SphereGeometry(r * 0.5, 24, 24),
    new THREE.MeshStandardMaterial({ color: hsl(irisHue, 0.85, 0.45), roughness: 0.35 })
  );
  iris.position.z = r * 0.9;
  iris.scale.z = 0.4;
  group.add(iris);

  const pupil = new THREE.Mesh(
    new THREE.SphereGeometry(r * 0.26, 20, 20),
    new THREE.MeshStandardMaterial({ color: 0x05060a, roughness: 0.5 })
  );
  pupil.position.z = r * 1.0;
  pupil.scale.z = 0.4;
  group.add(pupil);

  // guaranteed catchlight (the Pixar sparkle)
  const spark = new THREE.Mesh(
    new THREE.SphereGeometry(r * 0.1, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  spark.position.set(-r * 0.26, r * 0.3, r * 1.08);
  group.add(spark);

  return { group, lid: group };
}

// horn / spike cone (bone coloured)
function horn(len, baseR, hue) {
  const m = new THREE.Mesh(
    new THREE.ConeGeometry(baseR, len, 18),
    new THREE.MeshStandardMaterial({ color: hsl(hue, 0.3, 0.82), roughness: 0.6 })
  );
  m.castShadow = true;
  return m;
}

function limb(len, r, mat) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 14), mat);
  m.castShadow = true;
  return m;
}

// ---------------- build per-archetype ----------------
function addEyes(group, cfg, count, gap, y, z, hue) {
  const irisHue = (hue + 175) % 360;
  const positions =
    count === 1 ? [[0, y]] :
    count === 2 ? [[-gap, y], [gap, y * 1.04]] :
                  [[-gap, y + 0.05], [gap, y + 0.08], [0, y - 0.28]];
  positions.forEach(([x, ey], i) => {
    const r = count === 1 ? 0.55 : count === 2 ? 0.36 : 0.3;
    const eye = makeEye(r, irisHue);
    eye.group.position.set(x, ey, z);
    group.add(eye.group);
    eyes.push(eye);
  });
}

function buildBlob(dna) {
  const { base, menace, creature, parts } = dna;
  const g = new THREE.Group();
  const hue = base.hue, seed = base.gap * 7 + creature.sn * 0.013;
  const mat = bodyMat(hue, menace);

  const aspect = 0.85 + base.body * 0.4;
  const body = blobMesh(1.0, seed, 0.12, mat);
  body.scale.set(Math.sqrt(aspect), 1 / Math.sqrt(aspect), 1);
  g.add(body);

  // arm + foot nubs
  const ax = 1.0 * Math.sqrt(aspect);
  [[-ax, 0.0, Math.PI * 0.32], [ax, 0.0, -Math.PI * 0.32]].forEach(([x, y, rz]) => {
    const a = limb(0.5, 0.2, mat); a.position.set(x, y, 0.1); a.rotation.z = rz; g.add(a);
  });
  const fy = -1 / Math.sqrt(aspect) * 0.92;
  [[-0.45], [0.45]].forEach(([x]) => {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.3, 18, 18), mat);
    f.scale.set(1, 0.55, 1.2); f.position.set(x, fy, 0.25); f.castShadow = true; g.add(f);
  });

  // horns from spike parts
  const spikes = (parts || []).filter(p => p.type === "spike").slice(0, 2);
  spikes.forEach((p, i) => {
    const s = i ? 1 : -1;
    const h = horn(0.5 + p.size * 0.5, 0.16, (p.hue ?? hue));
    h.position.set(s * 0.45, 0.9, 0.1); h.rotation.z = -s * 0.35; g.add(h);
  });

  addEyes(g, creature, creature.eyeCount, 0.46, 0.22, 0.98, hue);
  return g;
}

function buildBeast(dna) {
  const { base, menace, creature, parts } = dna;
  const g = new THREE.Group();
  const hue = base.hue, seed = base.gap * 7 + creature.sn * 0.013;
  const mat = bodyMat(hue, menace);
  const furMat = bodyMat((hue + 8) % 360, Math.min(1, menace + 0.2));

  const body = blobMesh(1.0, seed, 0.14, mat);
  body.scale.set(1.05, 0.98, 1);
  g.add(body);

  // ears
  [-1, 1].forEach(s => {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.26, 18, 18), furMat);
    ear.position.set(s * 0.55, 0.85, 0.1); ear.scale.set(1, 1.1, 0.6); ear.castShadow = true; g.add(ear);
  });
  // snout
  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.34, 22, 22),
    bodyMat(hue, Math.max(0, menace - 0.15)));
  snout.scale.set(1, 0.8, 0.8); snout.position.set(0, -0.18, 0.86); snout.castShadow = true; g.add(snout);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0x1a1014, roughness: 0.4 }));
  nose.position.set(0, -0.12, 1.18); g.add(nose);

  // four legs
  [[-0.5, 0.2], [0.5, 0.2], [-0.5, -0.4], [0.5, -0.4]].forEach(([x, z]) => {
    const leg = limb(0.5, 0.18, mat); leg.position.set(x, -0.95, z); g.add(leg);
  });

  // optional horns
  if (creature.hornStyle !== "none") {
    [-1, 1].forEach(s => { const h = horn(0.55, 0.15, (hue + 40) % 360); h.position.set(s * 0.42, 0.92, 0.1); h.rotation.z = -s * 0.4; g.add(h); });
  }

  addEyes(g, creature, creature.eyeCount, 0.42, 0.3, 1.0, hue);
  return g;
}

function buildEyeball(dna) {
  const { base, menace, creature } = dna;
  const g = new THREE.Group();
  const hue = base.hue;
  const irisHue = (hue + 175) % 360;

  // the body IS one giant glossy eye
  const eye = makeEye(1.05, irisHue);
  // tint the iris toward the monster hue and react to menace
  eye.group.position.set(0, 0.1, 0);
  g.add(eye.group);
  eyes.push(eye);

  // little stubby legs for charm
  const mat = bodyMat(hue, menace);
  [[-0.45], [0.45]].forEach(([x]) => {
    const leg = limb(0.35, 0.14, mat); leg.position.set(x, -1.15, 0.3); g.add(leg);
  });

  // a couple of spiky lashes / brows for personality
  [-1, 1].forEach(s => {
    const h = horn(0.4, 0.08, (hue + 200) % 360);
    h.position.set(s * 0.5, 1.05, 0.4); h.rotation.z = -s * 0.6; g.add(h);
  });
  return g;
}

const BUILDERS = { blob: buildBlob, beast: buildBeast, eyeball: buildEyeball };

// ---------------- public API ----------------
export function init(canvas) {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  camera.position.set(0, 0.25, 6.4);
  camera.lookAt(0, 0.05, 0);

  // soft procedural environment (top white catchlight + cool/warm fills)
  envTex = buildEnv();
  scene.environment = envTex;

  // 3-point light rig
  keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(3.5, 5, 4);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.near = 1; keyLight.shadow.camera.far = 20;
  keyLight.shadow.camera.left = -4; keyLight.shadow.camera.right = 4;
  keyLight.shadow.camera.top = 4; keyLight.shadow.camera.bottom = -4;
  keyLight.shadow.bias = -0.0006;
  keyLight.shadow.radius = 4;
  scene.add(keyLight);

  const fill = new THREE.DirectionalLight(0x9bc4ff, 0.8);
  fill.position.set(-4, 1.5, 3);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xffd9a0, 1.1);
  rim.position.set(-2, 3, -5);
  scene.add(rim);

  scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x202028, 0.5));

  // ground that only catches a soft contact shadow
  ground = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.ShadowMaterial({ opacity: 0.28 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.45;
  ground.receiveShadow = true;
  scene.add(ground);
}

function buildEnv() {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x2a3340);
  const box = (x, y, z, c, sz) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sz, sz, sz),
      new THREE.MeshBasicMaterial({ color: c }));
    m.position.set(x, y, z); s.add(m);
  };
  box(0, 7, 2, 0xffffff, 7);     // key catchlight from above
  box(-6, 2, 4, 0x88aaff, 5);    // cool fill
  box(5, -1, -5, 0xffd9a0, 5);   // warm rim
  const tex = pmrem.fromScene(s, 0.08).texture;
  pmrem.dispose();
  s.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  return tex;
}

export function build(dna) {
  if (!renderer) return;
  const sig = dna.creature.sn + "|" + dna.creature.type + "|" + dna.menace.toFixed(3);
  if (sig === builtSig && monster) return;
  builtSig = sig;
  disposeMonster();
  eyes = [];
  const make = BUILDERS[dna.creature.type] || buildBlob;
  monster = make(dna);
  scene.add(monster);
}

export function render(t, prog, menace) {
  if (!renderer || !monster) return;
  const pop = clamp(easeOutBack(clamp(prog, 0, 1)), 0.02, 1.3);

  // birth pop + idle breathing + gentle turn
  const breath = 1 + Math.sin(t / 620) * 0.025;
  monster.scale.setScalar(pop);
  monster.scale.y *= breath;
  monster.position.y = (1 - clamp(prog, 0, 1)) * -1.2 + Math.sin(t / 700) * 0.04;
  monster.rotation.y = Math.sin(t / 1500) * 0.18;
  monster.rotation.z = (menace - 0.5) * 0.1;

  // time-based blink (FPS-independent): mostly open, a quick close every ~3.4s
  const bt = (t + 1700) % 3400;
  const lid = bt < 150 ? Math.max(0.12, Math.abs(Math.cos((bt / 150) * Math.PI))) : 1;
  const lookX = Math.sin(t / 900) * 0.12, lookY = Math.cos(t / 1300) * 0.06;
  eyes.forEach(e => {
    e.group.scale.y = lid;
    e.group.rotation.y = lookX;
    e.group.rotation.x = -lookY;
  });

  renderer.render(scene, camera);
}

export function resize(wCss, hCss) {
  if (!renderer) return;
  _w = wCss; _h = hCss;
  renderer.setSize(wCss, hCss, false);
  camera.aspect = wCss / Math.max(1, hCss);
  camera.updateProjectionMatrix();
}

function disposeMonster() {
  if (!monster) return;
  scene.remove(monster);
  monster.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      ms.forEach(m => m.dispose());
    }
  });
  monster = null;
  eyes = [];
}

// release the current creature but keep the renderer/scene warm for reuse
export function clear() {
  disposeMonster();
  builtSig = null;
}
