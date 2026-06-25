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
let drools = [];             // [{ mesh, baseY, len, phase }] dripping saliva
let hairs = [];              // [{ mesh, rest, phase }] swaying hair tufts
let jaws = [];               // [{ group, amt }] lower-jaw groups for growl
let builtSig = null;         // signature of the DNA we last built
let _w = 0, _h = 0;

const PILOT = new Set(["blob", "multihead", "octopus", "beast", "fish", "bird", "worm", "alien",
  "crab", "dragon", "eyeball", "jelly", "virus", "bacteria", "snake", "scorpion", "dino", "cell"]);
export const supports = (type) => PILOT.has(type);

// ---------------- helpers ----------------
const easeOutBack = (x) => { const c = 2.2; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

// HSL (h in 0..360) -> THREE.Color
function hsl(h, s, l) { return new THREE.Color().setHSL(((h % 360) + 360) % 360 / 360, s, l); }

// cheap smooth pseudo-noise for organic body lumps
function lump(x, y, z, seed) {
  return Math.sin(x * 1.7 + seed) * 0.5
       + Math.sin(y * 2.3 + seed * 1.3) * 0.32
       + Math.sin(z * 1.9 + seed * 0.7) * 0.4
       + Math.sin((x + y + z) * 1.1 + seed * 0.5) * 0.28;
}

// soft plush body material that darkens, saturates and starts to glow with danger
function bodyMat(hue, danger) {
  const light = clamp(0.58 - danger * 0.26, 0.22, 0.62);
  const sat = clamp(0.55 + danger * 0.3, 0.3, 0.95);
  const col = hsl(hue, sat, light);
  const m = new THREE.MeshPhysicalMaterial({
    color: col, roughness: clamp(0.6 - danger * 0.2, 0.3, 0.7), metalness: 0,
    clearcoat: 0.3, clearcoatRoughness: 0.5,
    sheen: 0.7, sheenRoughness: 0.85, sheenColor: hsl(hue, 0.6, 0.78),
    envMapIntensity: 0.9
  });
  if (danger > 0.55) {                       // faint hellish under-glow when furious
    m.emissive = hsl((hue + 6) % 360, 0.9, 0.5);
    m.emissiveIntensity = (danger - 0.55) * 0.5;
  }
  return m;
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

// one eye; opts = { pupil:"round"|"slit", glow, bloodshot } — returns { group, lid }
function makeEye(r, irisHue, opts) {
  opts = opts || {};
  const glow = opts.glow || 0, bloodshot = opts.bloodshot || 0;
  const group = new THREE.Group();

  // sclera tints toward bloody pink as it gets bloodshot
  const white = new THREE.Color(0xffffff).lerp(new THREE.Color(0xff9a9a), bloodshot * 0.7);
  const sclera = new THREE.Mesh(
    new THREE.SphereGeometry(r, 32, 32),
    new THREE.MeshPhysicalMaterial({
      color: white, roughness: 0.22, metalness: 0,
      clearcoat: 0.5, clearcoatRoughness: 0.22, envMapIntensity: 0.8
    })
  );
  sclera.castShadow = true;
  group.add(sclera);

  // a few red veins crawling across the sclera when bloodshot
  if (bloodshot > 0.35) {
    const veinMat = new THREE.MeshBasicMaterial({ color: 0xc0202a });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      const vein = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.018, r * 0.01, r * 0.9, 5), veinMat);
      vein.position.set(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.4, r * 0.78);
      vein.rotation.z = a + Math.PI / 2; vein.rotation.x = -0.4;
      group.add(vein);
    }
  }

  // iris — emissive (glowing) when furious
  const irisMat = new THREE.MeshStandardMaterial({ color: hsl(irisHue, 0.85, 0.45), roughness: 0.35 });
  if (glow > 0) { irisMat.emissive = hsl(irisHue, 0.95, 0.55); irisMat.emissiveIntensity = glow * 1.6; }
  const iris = new THREE.Mesh(new THREE.SphereGeometry(r * 0.5, 24, 24), irisMat);
  iris.position.z = r * 0.9; iris.scale.z = 0.4;
  group.add(iris);

  // pupil — round (calm) or a vertical reptilian slit (menacing)
  const pupil = new THREE.Mesh(
    new THREE.SphereGeometry(r * 0.26, 20, 20),
    new THREE.MeshStandardMaterial({ color: 0x05060a, roughness: 0.5 })
  );
  pupil.position.z = r * 1.0;
  if (opts.pupil === "slit") pupil.scale.set(0.32, 1.5, 0.4);
  else pupil.scale.z = 0.4;
  group.add(pupil);

  // catchlight (dimmer when the eye glows on its own)
  const spark = new THREE.Mesh(
    new THREE.SphereGeometry(r * 0.1, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1 - glow * 0.6 })
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

const toothMat = (danger) => new THREE.MeshStandardMaterial({
  color: new THREE.Color(0xfdf6e3).lerp(new THREE.Color(0xcdb878), danger * 0.5),
  roughness: 0.4
});

// translucent saliva strands hung from `anchorY`; animated to drip in render()
function makeDrool(mw, anchorY, count, danger) {
  if (count <= 0) return null;
  const group = new THREE.Group();
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xcfe9ff, roughness: 0.08, metalness: 0,
    transmission: 0.7, thickness: 0.4, ior: 1.33, transparent: true, opacity: 0.85
  });
  for (let i = 0; i < count; i++) {
    const x = (count === 1 ? 0 : (i / (count - 1) - 0.5) * 2) * mw * 0.7;
    const len = lerp(0.14, 0.5, danger) * (0.7 + Math.random() * 0.6);
    const strand = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 1, 4, 8), mat);
    strand.position.set(x, anchorY, 0.18);
    drools.push({ mesh: strand, baseY: anchorY, len, phase: Math.random() * Math.PI * 2 });
    group.add(strand);
  }
  return group;
}

// snarling mouth on the front face: dark maw + teeth (nubs->fangs) + tongue + drool.
// `width` = half-width in local units, faces +z. Returns { group, jaw }.
function makeMouth(width, danger, teeth, hue) {
  const group = new THREE.Group();
  const mw = width;
  const mh = lerp(0.12, 0.42, danger) * Math.max(width * 1.4, 0.5);

  const inMat = new THREE.MeshStandardMaterial({ color: 0x37060e, roughness: 0.7 });
  if (danger > 0.5) { inMat.emissive = new THREE.Color(0x8a0d1a); inMat.emissiveIntensity = (danger - 0.5) * 0.9; }
  const maw = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 20), inMat);
  maw.scale.set(mw, mh, 0.45); maw.position.z = -0.04;
  group.add(maw);

  const lip = new THREE.Mesh(new THREE.TorusGeometry(1, 0.12, 10, 28), bodyMat(hue, Math.min(1, danger + 0.15)));
  lip.scale.set(mw, mh, 0.6);
  group.add(lip);

  // lower jaw drops a little for a growl (animated)
  const jaw = new THREE.Group();
  group.add(jaw);

  const tongue = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xb43050, roughness: 0.5 }));
  tongue.scale.set(mw * 0.62, mh * 0.34, 0.3);
  tongue.position.set(0, -mh * 0.45, 0.12);
  jaw.add(tongue);

  const tMat = toothMat(danger);
  const n = Math.max(3, teeth | 0);
  for (let row = 0; row < 2; row++) {
    const upper = row === 0;
    for (let i = 0; i < n; i++) {
      const fx = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2;        // -1..1
      const arc = (1 - fx * fx) * mh * 0.3;
      const canine = Math.abs(fx) > 0.55 ? 1.5 : 1;            // longer fangs at the corners
      const tl = lerp(mh * 0.5, mh * 1.7, danger) * canine;
      const br = lerp(mw * 0.14, mw * 0.07, danger);
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(br, tl, 9), tMat);
      const gum = upper ? (mh - arc) : (-mh + arc);
      tooth.position.set(fx * mw * 0.82, gum + (upper ? -tl / 2 : tl / 2), 0.16);
      tooth.rotation.x = upper ? Math.PI : 0;                  // upper teeth point down
      (upper ? group : jaw).add(tooth);
    }
  }

  const drool = makeDrool(mw, -mh * 0.92, Math.round(lerp(0, 5, clamp((danger - 0.28) / 0.72, 0, 1))), danger);
  if (drool) jaw.add(drool);

  jaws.push({ group: jaw, amt: lerp(0.015, 0.11, danger) });
  return { group, jaw };
}

// hair tufts at the given scalp points ([x,y,z, dirx,diry,dirz]); sway in render()
function makeHair(points, danger, rough, hue) {
  const group = new THREE.Group();
  const shag = clamp((rough || 0) * 0.6 + danger * 0.6, 0, 1);
  const mat = new THREE.MeshStandardMaterial({ color: hsl(hue, 0.55, lerp(0.32, 0.12, danger)), roughness: 0.85 });
  points.forEach(([px, py, pz, dx, dy, dz]) => {
    const n = Math.round(lerp(2, 9, shag));
    for (let i = 0; i < n; i++) {
      const len = lerp(0.16, 0.62, shag) * (0.7 + Math.random() * 0.6);
      const hair = new THREE.Mesh(new THREE.ConeGeometry(0.035, len, 5), mat);
      const jx = (Math.random() - 0.5) * 0.3, jz = (Math.random() - 0.5) * 0.3;
      const dir = new THREE.Vector3(dx + jx * 1.5, dy, dz + jz * 1.5).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      hair.quaternion.copy(q);
      hair.position.set(px + jx, py, pz + jz).addScaledVector(dir, len * 0.5);
      hairs.push({ mesh: hair, rest: q.clone(), phase: Math.random() * Math.PI * 2 });
      group.add(hair);
    }
  });
  return group;
}

// a dorsal ridge of back-leaning spikes (reuses the horn primitive)
function spikeRow(count, danger, hue) {
  const group = new THREE.Group();
  const boneHue = (hue + 30) % 360;
  for (let i = 0; i < count; i++) {
    const f = count === 1 ? 0.5 : i / (count - 1);            // 0 = top-front .. 1 = back
    const len = lerp(0.5, 0.2, f) * lerp(0.5, 1.35, danger);
    const sp = horn(len, 0.1 + 0.05 * (1 - f), boneHue);
    sp.position.set(0, lerp(1.02, 0.1, f), lerp(0.25, -1.0, f));
    sp.rotation.x = lerp(-0.15, -0.95, f);
    group.add(sp);
  }
  return group;
}

// angry bony brow bar; inner end dips down to form a furious V as danger rises
function makeBrow(side, danger, hue) {
  const w = lerp(0.2, 0.42, danger), h = 0.07 + danger * 0.07;
  const brow = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.13),
    new THREE.MeshStandardMaterial({ color: hsl(hue, 0.5, lerp(0.3, 0.12, danger)), roughness: 0.7 }));
  brow.rotation.z = side * lerp(0.04, 0.7, danger);
  return brow;
}

// a tapered limb/tentacle/tail/neck segment (cylinder, axis +y, centred)
function taper(len, baseR, tipR, mat) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(tipR, baseR, len, 12), mat);
  m.castShadow = true;
  return m;
}

// orient `mesh` (a +y aligned shape) so its base sits at `base` pointing along `dir`
function placeFrom(mesh, base, dir, len) {
  const d = dir.clone().normalize();
  mesh.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d));
  mesh.position.copy(base).addScaledVector(d, len / 2);
  return mesh;
}

// a thin membrane wing (bat/dragon style) as an extruded shape
function makeWing(mat) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(0.7, 0.55, 1.5, 0.3);
  s.quadraticCurveTo(1.05, 0.05, 1.35, -0.45);
  s.quadraticCurveTo(0.85, -0.2, 0.55, -0.7);
  s.quadraticCurveTo(0.35, -0.25, 0, 0);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: false });
  geo.translate(0, 0, -0.025);
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

// common DNA unpacking shared by every builder
function dnaBits(dna) {
  const danger = clamp(dna.menace, 0, 1);
  return {
    base: dna.base, creature: dna.creature, parts: dna.parts || [],
    danger, rough: dna.voice ? dna.voice.rough : danger, bright: dna.voice ? dna.voice.bright : 0.5,
    hue: dna.base.hue, seed: dna.base.gap * 7 + dna.creature.sn * 0.013,
    mat: bodyMat(dna.base.hue, danger)
  };
}

// attach a danger-scaled snarling mouth to `g` at (x,y,z); width auto from face + danger
function attachMouth(g, base, danger, x, y, z, hue, widthScale) {
  const mw = lerp(0.26, 0.5, base.mouth * 0.5 + danger * 0.5) * (widthScale || 1);
  const teeth = Math.round(lerp(4, 11, base.mouth * 0.5 + danger * 0.6));
  const mouth = makeMouth(mw, danger, teeth, hue);
  mouth.group.position.set(x, y, z);
  g.add(mouth.group);
  return mouth;
}

// ---------------- build per-archetype ----------------
function addEyes(group, count, gap, y, z, hue, danger, bright, eyeScale) {
  const positions =
    count === 1 ? [[0, y]] :
    count === 2 ? [[-gap, y], [gap, y * 1.04]] :
                  [[-gap, y + 0.05], [gap, y + 0.08], [0, y - 0.28]];
  positions.forEach(([x, ey], i) => {
    // big round eyes when calm, smaller meaner eyes when furious; slight asymmetry per eye
    const baseR = count === 1 ? 0.55 : count === 2 ? 0.36 : 0.3;
    const r = baseR * lerp(1.15, 0.82, danger) * (eyeScale || 1) * (i % 2 ? 0.92 : 1);
    // different eyes: vary iris hue, pupil shape and glow per eye
    const irisHue = (hue + 175 + i * 38) % 360;
    const glow = danger > 0.4 ? clamp((danger - 0.4) / 0.6, 0, 1) * (0.6 + 0.5 * (bright || 0)) : 0;
    const bloodshot = clamp((danger - 0.3) / 0.7, 0, 1);
    const pupil = danger > 0.25 && (danger > 0.55 || i % 2 === 1) ? "slit" : "round";
    const eye = makeEye(r, irisHue, { pupil, glow, bloodshot });
    eye.group.position.set(x, ey, z);
    group.add(eye.group);
    eyes.push(eye);
    // angry brow above each eye
    const brow = makeBrow(x >= 0 ? 1 : -1, danger, hue);
    brow.position.set(x, ey + r * 1.05, z + r * 0.45);
    group.add(brow);
  });
}

function buildBlob(dna) {
  const { base, creature, parts } = dna;
  const danger = clamp(dna.menace, 0, 1);
  const rough = dna.voice ? dna.voice.rough : danger;
  const bright = dna.voice ? dna.voice.bright : 0.5;
  const g = new THREE.Group();
  const hue = base.hue, seed = base.gap * 7 + creature.sn * 0.013;
  const mat = bodyMat(hue, danger);

  const aspect = 0.85 + base.body * 0.4;
  const sx = Math.sqrt(aspect);
  const body = blobMesh(1.0, seed, 0.12 + danger * 0.06, mat);
  body.scale.set(sx, 1 / sx, 1);
  g.add(body);

  // arm + foot nubs
  const ax = 1.0 * sx;
  [[-ax, 0.0, Math.PI * 0.32], [ax, 0.0, -Math.PI * 0.32]].forEach(([x, y, rz]) => {
    const a = limb(0.5, 0.2, mat); a.position.set(x, y, 0.1); a.rotation.z = rz; g.add(a);
  });
  const fy = -1 / sx * 0.92;
  [[-0.45], [0.45]].forEach(([x]) => {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.3, 18, 18), mat);
    f.scale.set(1, 0.55, 1.2); f.position.set(x, fy, 0.25); f.castShadow = true; g.add(f);
  });

  // claws/horns from spike parts + a dorsal spike ridge that grows with danger
  const sparts = (parts || []).filter(p => p.type === "spike").slice(0, 2);
  sparts.forEach((p, i) => {
    const s = i ? 1 : -1;
    const h = horn(0.5 + p.size * 0.5, 0.16, (p.hue ?? hue));
    h.position.set(s * 0.45, 0.9, 0.1); h.rotation.z = -s * 0.35; g.add(h);
  });
  const spikeCount = Math.round(lerp(0, 6, danger)) + sparts.length;
  if (spikeCount > 0) { const sr = spikeRow(spikeCount, danger, hue); sr.position.z = -0.1; g.add(sr); }

  // hair tuft on top (shaggier with raspy voice)
  g.add(makeHair([[0, 0.95, 0.15, 0, 1, -0.25], [-0.28, 0.88, 0.1, -0.3, 1, -0.2], [0.28, 0.88, 0.1, 0.3, 1, -0.2]], danger, rough, hue));

  addEyes(g, creature.eyeCount, 0.46, 0.24, 0.98, hue, danger, bright, lerp(0.85, 1.18, base.eye));

  // snarling mouth (more + sharper teeth with a wider face / louder roar)
  const mw = lerp(0.32, 0.6, base.mouth * 0.5 + danger * 0.5);
  const teeth = Math.round(lerp(4, 12, base.mouth * 0.5 + danger * 0.6));
  const mouth = makeMouth(mw, danger, teeth, hue);
  mouth.group.position.set(0, -0.34, 0.9);
  g.add(mouth.group);

  return g;
}

function buildBeast(dna) {
  const { base, creature } = dna;
  const danger = clamp(dna.menace, 0, 1);
  const rough = dna.voice ? dna.voice.rough : danger;
  const bright = dna.voice ? dna.voice.bright : 0.5;
  const g = new THREE.Group();
  const hue = base.hue, seed = base.gap * 7 + creature.sn * 0.013;
  const mat = bodyMat(hue, danger);
  const furMat = bodyMat((hue + 8) % 360, Math.min(1, danger + 0.2));

  const body = blobMesh(1.0, seed, 0.14, mat);
  body.scale.set(1.05, 0.98, 1);
  g.add(body);

  // ears
  [-1, 1].forEach(s => {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.26, 18, 18), furMat);
    ear.position.set(s * 0.55, 0.85, 0.1); ear.scale.set(1, 1.1, 0.6); ear.castShadow = true; g.add(ear);
  });
  // snout + nose
  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.34, 22, 22),
    bodyMat(hue, Math.max(0, danger - 0.15)));
  snout.scale.set(1, 0.8, 0.8); snout.position.set(0, -0.1, 0.92); snout.castShadow = true; g.add(snout);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 16),
    new THREE.MeshStandardMaterial({ color: 0x1a1014, roughness: 0.4 }));
  nose.position.set(0, 0.02, 1.24); g.add(nose);

  // four legs
  [[-0.5, 0.2], [0.5, 0.2], [-0.5, -0.4], [0.5, -0.4]].forEach(([x, z]) => {
    const leg = limb(0.5, 0.18, mat); leg.position.set(x, -0.95, z); g.add(leg);
  });

  // horns
  if (creature.hornStyle !== "none" || danger > 0.4) {
    [-1, 1].forEach(s => { const h = horn(lerp(0.4, 0.7, danger), 0.15, (hue + 40) % 360); h.position.set(s * 0.42, 0.92, 0.1); h.rotation.z = -s * 0.4; g.add(h); });
  }

  // back mane (hair) + dorsal spikes
  g.add(makeHair([[0, 0.98, 0.05, 0, 1, -0.3], [0, 0.7, -0.45, 0, 0.8, -0.7], [0, 0.4, -0.85, 0, 0.5, -1], [-0.3, 0.75, -0.2, -0.4, 1, -0.4], [0.3, 0.75, -0.2, 0.4, 1, -0.4]], danger, rough, hue));
  const spikeCount = Math.round(lerp(0, 7, danger));
  if (spikeCount > 0) g.add(spikeRow(spikeCount, danger, hue));

  addEyes(g, creature.eyeCount, 0.42, 0.32, 1.0, hue, danger, bright, lerp(0.85, 1.15, base.eye));

  // fanged mouth on the snout
  const mw = lerp(0.26, 0.46, base.mouth * 0.5 + danger * 0.5);
  const teeth = Math.round(lerp(4, 10, base.mouth * 0.5 + danger * 0.6));
  const mouth = makeMouth(mw, danger, teeth, hue);
  mouth.group.position.set(0, -0.3, 1.1);
  g.add(mouth.group);

  return g;
}

function buildEyeball(dna) {
  const { base } = dna;
  const danger = clamp(dna.menace, 0, 1);
  const rough = dna.voice ? dna.voice.rough : danger;
  const bright = dna.voice ? dna.voice.bright : 0.5;
  const g = new THREE.Group();
  const hue = base.hue;
  const irisHue = (hue + 175) % 360;

  // the body IS one giant eye, reacting strongly to danger (slit pupil, glow, bloodshot)
  const glow = danger > 0.35 ? clamp((danger - 0.35) / 0.65, 0, 1) * (0.7 + 0.5 * bright) : 0;
  const eye = makeEye(1.05, irisHue, {
    pupil: danger > 0.3 ? "slit" : "round", glow, bloodshot: clamp((danger - 0.2) / 0.8, 0, 1)
  });
  eye.group.position.set(0, 0.1, 0);
  g.add(eye.group);
  eyes.push(eye);

  // little stubby legs
  const mat = bodyMat(hue, danger);
  [[-0.45], [0.45]].forEach(([x]) => {
    const leg = limb(0.35, 0.14, mat); leg.position.set(x, -1.15, 0.3); g.add(leg);
  });

  // a crown of spikes fanned across the top — taller + more numerous with danger
  const crown = Math.max(3, Math.round(lerp(3, 9, danger)));
  for (let i = 0; i < crown; i++) {
    const a = (crown === 1 ? 0 : (i / (crown - 1) - 0.5)) * 1.7;
    const len = lerp(0.3, 0.78, danger);
    const sp = horn(len, 0.09, (hue + 200) % 360);
    const dir = new THREE.Vector3(Math.sin(a), Math.cos(a) * 0.9 + 0.2, 0.25).normalize();
    sp.quaternion.copy(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    sp.position.set(Math.sin(a) * 0.95, 0.1 + Math.cos(a) * 1.0, 0.2).addScaledVector(dir, len * 0.4);
    g.add(sp);
  }

  // hair lashes around the top + furrowed brows
  g.add(makeHair([[-0.5, 0.85, 0.42, -0.5, 0.9, 0.4], [0, 1.05, 0.32, 0, 1, 0.3], [0.5, 0.85, 0.42, 0.5, 0.9, 0.4]], danger, rough, hue));
  [-1, 1].forEach(s => { const b = makeBrow(s, danger, hue); b.position.set(s * 0.42, 1.0, 0.55); g.add(b); });

  // a snarling maw below the eye
  const mw = lerp(0.3, 0.5, danger);
  const mouth = makeMouth(mw, danger, Math.round(lerp(4, 10, danger)), hue);
  mouth.group.position.set(0, -0.82, 0.62);
  g.add(mouth.group);

  return g;
}

// small shared bits used by several builders below
const glowBall = (r, h) => new THREE.Mesh(new THREE.SphereGeometry(r, 12, 12),
  new THREE.MeshStandardMaterial({ color: hsl(h, 0.9, 0.6), emissive: hsl(h, 0.9, 0.55), emissiveIntensity: 1.2, roughness: 0.4 }));
const finMesh = (size, mat) => { const f = new THREE.Mesh(new THREE.ConeGeometry(size, size * 1.5, 6), mat); f.scale.z = 0.16; f.castShadow = true; return f; };

// 4. FLERHOVEDET — body with 2–3 fanged heads on necks
function buildMultihead(dna) {
  const { base, creature, danger, rough, bright, hue, seed, mat } = dnaBits(dna);
  const g = new THREE.Group();
  const body = blobMesh(1.0, seed, 0.13, mat); body.scale.set(1.12, 0.95, 1); g.add(body);
  [[-1.05, 0.36], [1.05, -0.36]].forEach(([x, rz]) => { const a = limb(0.5, 0.2, mat); a.position.set(x, -0.1, 0.1); a.rotation.z = rz; g.add(a); });
  [-0.45, 0.45].forEach(x => { const f = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 16), mat); f.scale.set(1, 0.5, 1.2); f.position.set(x, -1.0, 0.25); f.castShadow = true; g.add(f); });
  const n = creature.heads || 2;
  for (let i = 0; i < n; i++) {
    const fx = n === 1 ? 0 : (i / (n - 1) - 0.5) * (n === 2 ? 0.78 : 1.05);
    const headP = new THREE.Vector3(fx, 0.95, 0.18), baseP = new THREE.Vector3(fx * 0.55, 0.42, 0.18);
    const dir = headP.clone().sub(baseP), nl = dir.length();
    g.add(placeFrom(taper(nl, 0.17, 0.12, mat), baseP, dir, nl));
    const head = new THREE.Group(); head.position.copy(headP);
    head.add(blobMesh(0.42, seed + i * 7, 0.1, mat));
    addEyes(head, 2, 0.18, 0.12, 0.4, (hue + i * 22) % 360, danger, bright, 0.8);
    attachMouth(head, base, danger, 0, -0.16, 0.4, hue, 0.62);
    if (danger > 0.3) [-1, 1].forEach(s => { const hn = horn(lerp(0.25, 0.5, danger), 0.07, (hue + 40) % 360); hn.position.set(s * 0.22, 0.36, 0.1); hn.rotation.z = -s * 0.4; head.add(hn); });
    g.add(head);
  }
  g.add(makeHair([[0, 0.55, -0.4, 0, 1, -0.5]], danger, rough, hue));
  return g;
}

// 3. BLÆKSPRUTTE — domed head + splaying tentacles
function buildOctopus(dna) {
  const { base, creature, danger, rough, bright, hue, seed, mat } = dnaBits(dna);
  const g = new THREE.Group();
  const head = blobMesh(1.0, seed, 0.1, mat); head.scale.set(1.0, 1.08, 1.0); head.position.y = 0.3; g.add(head);
  const n = creature.tentacles || 6;
  for (let i = 0; i < n; i++) {
    const f = n === 1 ? 0 : i / (n - 1) - 0.5;
    const baseP = new THREE.Vector3(f * 1.7, -0.45, 0.2 + Math.cos(f * 3) * 0.1);
    const len = lerp(1.3, 2.0, Math.abs(f) + 0.2);
    g.add(placeFrom(taper(len, 0.17, 0.04, mat), baseP, new THREE.Vector3(f * 1.5, -1.0, 0.1), len));
  }
  addEyes(g, creature.eyeCount, 0.42, 0.45, 0.85, hue, danger, bright, lerp(0.85, 1.15, base.eye));
  attachMouth(g, base, danger, 0, 0.0, 0.92, hue, 1);
  g.add(makeHair([[0, 1.2, 0.1, 0, 1, -0.2]], danger, rough, hue));
  if (danger > 0.35) g.add(spikeRow(Math.round(lerp(0, 5, danger)), danger, hue));
  return g;
}

// 5. FISK — body elongated toward the camera, fins + tail
function buildFish(dna) {
  const { base, danger, bright, hue, seed, mat } = dnaBits(dna);
  const g = new THREE.Group();
  const body = blobMesh(1.0, seed, 0.07, mat); body.scale.set(0.92, 0.98, 1.35); g.add(body);
  const finMat = bodyMat((hue + 40) % 360, danger);
  const tail = finMesh(0.85, finMat); tail.rotation.x = Math.PI / 2; tail.scale.set(1.1, 1.1, 0.16); tail.position.set(0, 0.1, -1.5); g.add(tail);
  const dorsal = finMesh(0.55, finMat); dorsal.position.set(0, 1.0, -0.2); g.add(dorsal);
  [-1, 1].forEach(s => { const pf = finMesh(0.45, finMat); pf.rotation.z = s * Math.PI / 2.2; pf.position.set(s * 0.95, -0.15, 0.35); g.add(pf); });
  addEyes(g, 2, 0.55, 0.32, 1.0, hue, danger, bright, lerp(0.85, 1.2, base.eye));
  attachMouth(g, base, danger, 0, -0.28, 1.18, hue, 1.1);
  if (danger > 0.35) g.add(spikeRow(Math.round(lerp(0, 5, danger)), danger, hue));
  return g;
}

// 6. FUGL — round body, wings, beak, crest, tail
function buildBird(dna) {
  const { base, creature, danger, rough, bright, hue, seed, mat } = dnaBits(dna);
  const g = new THREE.Group();
  const body = blobMesh(1.0, seed, 0.08, mat); body.scale.set(0.85, 1.05, 0.9); g.add(body);
  const wmat = new THREE.MeshStandardMaterial({ color: hsl(hue, 0.6, lerp(0.45, 0.28, danger)), roughness: 0.7, side: THREE.DoubleSide });
  [-1, 1].forEach(s => { const w = makeWing(wmat); w.scale.set(s * 1.15, 1.0, 1); w.position.set(s * 0.7, 0.1, -0.15); w.rotation.y = s * 0.5; w.rotation.z = s * 0.5; g.add(w); });
  // beak
  const beakMat = new THREE.MeshStandardMaterial({ color: hsl((hue + 50) % 360, 0.85, 0.5), roughness: 0.45 });
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.55, 12), beakMat); beak.rotation.x = Math.PI / 2; beak.position.set(0, 0.0, 1.05); g.add(beak);
  // tail feathers
  [-0.3, 0, 0.3].forEach((x, i) => { const tf = finMesh(0.4, mat); tf.position.set(x, -0.6, -0.9); tf.rotation.x = -0.6; g.add(tf); });
  addEyes(g, 2, 0.34, 0.42, 0.82, hue, danger, bright, lerp(0.85, 1.15, base.eye));
  g.add(makeHair([[0, 1.05, 0.1, 0, 1, -0.1], [-0.15, 1.0, 0.1, -0.2, 1, 0], [0.15, 1.0, 0.1, 0.2, 1, 0]], Math.min(1, danger + 0.2), rough, (hue + 80) % 360));
  if (danger > 0.45) attachMouth(g, base, danger, 0, -0.28, 0.92, hue, 0.7);
  return g;
}

// 7. ORM — chain of segment spheres along a curve + fanged head
function buildWorm(dna) {
  const { base, creature, danger, bright, hue, seed, mat } = dnaBits(dna);
  const g = new THREE.Group();
  const segs = creature.segments || 5;
  for (let i = segs - 1; i >= 0; i--) {
    const f = i / (segs - 1);
    const x = lerp(-0.2, 1.2, f), y = lerp(0.55, -0.9, f) + Math.sin(f * 4) * 0.12, z = lerp(0.3, -0.6, f);
    const r = lerp(0.62, 0.32, f);
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 16), mat); s.position.set(x, y, z); s.castShadow = true; g.add(s);
  }
  const head = new THREE.Group(); head.position.set(-0.25, 0.62, 0.35);
  head.add(blobMesh(0.6, seed, 0.08, mat));
  addEyes(head, 2, 0.24, 0.16, 0.55, hue, danger, bright, lerp(0.85, 1.15, base.eye));
  attachMouth(head, base, danger, 0, -0.18, 0.55, hue, 0.9);
  [-1, 1].forEach(s => { const a = taper(0.55, 0.05, 0.02, mat); placeFrom(a, new THREE.Vector3(s * 0.25, 0.5, 0.1), new THREE.Vector3(s * 0.4, 1, 0.1), 0.55); head.add(a); const b = glowBall(0.09, (hue + 60) % 360); b.position.set(s * 0.45, 1.0, 0.18); head.add(b); });
  g.add(head);
  return g;
}

// 8. ALIEN — huge head, tiny body, almond eyes, antennae
function buildAlien(dna) {
  const { base, danger, hue, seed, mat } = dnaBits(dna);
  const g = new THREE.Group();
  const headMat = bodyMat(hue, danger);
  const head = blobMesh(1.0, seed, 0.05, headMat); head.scale.set(0.95, 1.05, 0.9); head.position.y = 0.35; g.add(head);
  const body = blobMesh(0.5, seed + 3, 0.06, mat); body.scale.set(0.8, 0.9, 0.8); body.position.y = -0.85; g.add(body);
  [-1, 1].forEach(s => { const a = taper(0.7, 0.08, 0.04, mat); placeFrom(a, new THREE.Vector3(s * 0.4, -0.85, 0.1), new THREE.Vector3(s * 0.9, -0.5, 0.2), 0.7); g.add(a); });
  // almond black eyes
  [-1, 1].forEach(s => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.34, 24, 24), new THREE.MeshPhysicalMaterial({ color: 0x05070d, roughness: 0.1, clearcoat: 1, emissive: hsl((hue + 160) % 360, 0.9, 0.4), emissiveIntensity: danger * 0.9 }));
    e.scale.set(0.62, 1.05, 0.5); e.rotation.z = s * 0.4; e.position.set(s * 0.42, 0.45, 0.82); g.add(e);
  });
  [-1, 1].forEach(s => { const an = taper(0.7, 0.04, 0.02, mat); placeFrom(an, new THREE.Vector3(s * 0.3, 1.2, 0.1), new THREE.Vector3(s * 0.3, 1, 0), 0.7); g.add(an); const b = glowBall(0.1, (hue + 120) % 360); b.position.set(s * 0.4, 1.85, 0.1); g.add(b); });
  attachMouth(g, base, danger, 0, -0.15, 0.92, hue, 0.6);
  return g;
}

// 9. KRABBE — wide flat body, big claws, legs, eyestalks
function buildCrab(dna) {
  const { base, danger, bright, hue, seed, mat } = dnaBits(dna);
  const g = new THREE.Group();
  const body = blobMesh(1.0, seed, 0.08, mat); body.scale.set(1.3, 0.7, 1.0); g.add(body);
  // legs
  for (let i = 0; i < 3; i++) [-1, 1].forEach(s => {
    const by = 0.1 - i * 0.25, len = 0.8;
    g.add(placeFrom(taper(len, 0.08, 0.04, mat), new THREE.Vector3(s * 1.1, by, 0), new THREE.Vector3(s * 1.0, -0.5 - i * 0.2, 0.1), len));
  });
  // big claws
  [-1, 1].forEach(s => {
    const armLen = 0.7;
    g.add(placeFrom(taper(armLen, 0.13, 0.1, mat), new THREE.Vector3(s * 1.0, 0.2, 0.3), new THREE.Vector3(s * 1.1, 0.3, 0.6), armLen));
    const clawMat = bodyMat((hue + 20) % 360, danger);
    [-1, 1].forEach(cs => { const c = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.45, 10), clawMat); c.position.set(s * 1.55, 0.45 + cs * 0.12, 0.85); c.rotation.z = s * 0.5; c.rotation.x = -0.4; c.castShadow = true; g.add(c); });
  });
  // eyestalks
  [-1, 1].forEach(s => {
    g.add(placeFrom(taper(0.4, 0.06, 0.05, mat), new THREE.Vector3(s * 0.35, 0.45, 0.5), new THREE.Vector3(s * 0.2, 1, 0.2), 0.4));
    const eye = makeEye(0.26, (hue + 175) % 360, { pupil: danger > 0.4 ? "slit" : "round", glow: danger > 0.4 ? danger : 0, bloodshot: clamp((danger - 0.3) / 0.7, 0, 1) });
    eye.group.position.set(s * 0.32, 0.95, 0.6); g.add(eye.group); eyes.push(eye);
  });
  attachMouth(g, base, danger, 0, 0.05, 0.92, hue, 0.9);
  return g;
}

// 10. DRAGE — wings, horns, tail with spikes, long neck + fanged head, fire
function buildDragon(dna) {
  const { base, creature, danger, hue, seed, mat } = dnaBits(dna);
  const g = new THREE.Group();
  const body = blobMesh(1.0, seed, 0.1, mat); body.scale.set(1.05, 0.95, 1.05); g.add(body);
  // membrane wings
  const wmat = new THREE.MeshStandardMaterial({ color: hsl((hue + 170) % 360, 0.6, lerp(0.42, 0.26, danger)), roughness: 0.6, side: THREE.DoubleSide });
  [-1, 1].forEach(s => { const w = makeWing(wmat); w.scale.set(s * 1.7, 1.7, 1); w.position.set(s * 0.5, 0.55, -0.35); w.rotation.y = s * 0.6; w.rotation.z = s * 0.25; g.add(w); });
  // legs + tail
  [-0.4, 0.4].forEach(x => { const l = limb(0.5, 0.18, mat); l.position.set(x, -0.95, 0.25); g.add(l); });
  const tail = taper(1.6, 0.22, 0.03, mat); placeFrom(tail, new THREE.Vector3(0.2, -0.5, -0.6), new THREE.Vector3(0.7, -0.2, -1.2), 1.6); g.add(tail);
  g.add(spikeRow(Math.max(4, Math.round(lerp(4, 9, danger))), danger, hue));
  // neck + head
  const headP = new THREE.Vector3(-0.55, 0.95, 0.5), neckBase = new THREE.Vector3(-0.15, 0.3, 0.3);
  const dir = headP.clone().sub(neckBase), nl = dir.length();
  g.add(placeFrom(taper(nl, 0.26, 0.2, mat), neckBase, dir, nl));
  const head = new THREE.Group(); head.position.copy(headP); head.rotation.y = 0.3;
  const snout = blobMesh(0.5, seed + 2, 0.06, mat); snout.scale.set(1.2, 0.8, 1.1); head.add(snout);
  [-1, 1].forEach(s => { const h = horn(lerp(0.4, 0.7, danger), 0.1, (hue + 40) % 360); h.position.set(s * 0.22, 0.4, -0.2); h.rotation.z = -s * 0.3; h.rotation.x = -0.5; head.add(h); });
  addEyes(head, 2, 0.2, 0.18, 0.42, hue, danger, base ? 0.7 : 0.5, 0.85);
  attachMouth(head, base, danger, 0, -0.16, 0.5, hue, 1);
  g.add(head);
  if (danger > 0.5) {
    const fmat = new THREE.MeshStandardMaterial({ color: 0xffb030, emissive: 0xff4d00, emissiveIntensity: 1.6, roughness: 0.5, transparent: true, opacity: 0.85 });
    for (let k = 0; k < 3; k++) {
      const fl = new THREE.Mesh(new THREE.ConeGeometry(0.13 - k * 0.025, 0.55, 8), fmat);
      placeFrom(fl, new THREE.Vector3(-0.95 - k * 0.22, 0.85, 0.55), new THREE.Vector3(-1, -0.12, 0.45), 0.55);
      g.add(fl);
    }
  }
  return g;
}

// 12. GELÉ / MANET — translucent dome + trailing tentacles
function buildJelly(dna) {
  const { base, creature, danger, bright, hue, seed } = dnaBits(dna);
  const g = new THREE.Group();
  const domeMat = new THREE.MeshPhysicalMaterial({ color: hsl(hue, 0.7, 0.6), roughness: 0.1, transmission: 0.6, thickness: 0.8, ior: 1.3, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.0, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.6), domeMat);
  dome.scale.set(1.1, 1.0, 1.1); dome.position.y = 0.3; g.add(dome);
  const n = 8 + (creature.tentacles || 4);
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1) - 0.5;
    const baseP = new THREE.Vector3(f * 1.5, 0.0, Math.cos(f * 4) * 0.4);
    const len = lerp(1.2, 1.9, Math.random());
    const tmat = domeMat.clone(); tmat.opacity = 0.7;
    g.add(placeFrom(taper(len, 0.06, 0.02, tmat), baseP, new THREE.Vector3(f * 0.5, -1, 0.05), len));
    if (i % 2 === 0) { const b = glowBall(0.06, (hue + i * 20) % 360); b.position.copy(baseP).add(new THREE.Vector3(f * 0.5 * 0.9, -len * 0.9, 0)); g.add(b); }
  }
  addEyes(g, creature.eyeCount, 0.4, 0.45, 0.7, hue, danger, bright, lerp(0.85, 1.1, base.eye));
  attachMouth(g, base, danger, 0, 0.1, 0.78, hue, 0.85);
  return g;
}

// 13. VIRUS — icosphere core + radiating spike proteins with glowing tips
function buildVirus(dna) {
  const { base, creature, danger, bright, hue, seed, mat } = dnaBits(dna);
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.95, 1), mat); core.castShadow = true; g.add(core);
  const n = 16 + (creature.antennae || 2) * 2;
  const spikeMat = bodyMat((hue + 30) % 360, danger);
  for (let i = 0; i < n; i++) {
    // spread points on a sphere
    const y = 1 - (i / (n - 1)) * 2, rr = Math.sqrt(1 - y * y), th = i * 2.399;
    const dir = new THREE.Vector3(Math.cos(th) * rr, y, Math.sin(th) * rr);
    const len = lerp(0.35, 0.62, danger);
    g.add(placeFrom(taper(len, 0.07, 0.05, spikeMat), dir.clone().multiplyScalar(0.9), dir, len));
    const b = glowBall(0.1, (hue + 120) % 360); b.position.copy(dir.clone().multiplyScalar(0.9 + len)); g.add(b);
  }
  addEyes(g, 2, 0.32, 0.12, 0.95, hue, danger, bright, lerp(0.8, 1.1, base.eye));
  attachMouth(g, base, danger, 0, -0.3, 0.9, hue, 0.7);
  return g;
}

// 14. BAKTERIE — rod body, whipping flagella, pili spikes, scattered eyes
function buildBacteria(dna) {
  const { base, creature, danger, bright, hue, seed, mat } = dnaBits(dna);
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.7, 1.4, 8, 20), mat); body.rotation.z = Math.PI / 2; body.castShadow = true; g.add(body);
  // flagella
  const nf = 3 + Math.floor((creature.segments || 4) / 3);
  for (let i = 0; i < nf; i++) {
    const y = (i / (nf - 1) - 0.5) * 0.8;
    g.add(placeFrom(taper(1.5, 0.05, 0.02, bodyMat((hue + 40) % 360, danger)), new THREE.Vector3(-1.35, y, 0), new THREE.Vector3(-1.2, y * 1.5, 0.1), 1.5));
  }
  // pili spikes around
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2; const dir = new THREE.Vector3(Math.cos(a) * 0.5, Math.sin(a), Math.sin(a * 1.3) * 0.5).normalize();
    const base2 = new THREE.Vector3(Math.cos(a) * 1.0, Math.sin(a) * 0.7, 0.0);
    g.add(placeFrom(taper(lerp(0.12, 0.3, danger), 0.03, 0.01, mat), base2, dir, 0.2));
  }
  [[-0.4, 0.25, 0.62], [0.5, 0.1, 0.55], [0.0, -0.2, 0.6]].forEach(([x, y, z], i) => {
    const eye = makeEye(0.2 - i * 0.02, (hue + 175 + i * 30) % 360, { pupil: i % 2 ? "slit" : "round", glow: danger > 0.4 ? danger : 0, bloodshot: clamp((danger - 0.3) / 0.7, 0, 1) });
    eye.group.position.set(x, y, z); g.add(eye.group); eyes.push(eye);
  });
  attachMouth(g, base, danger, 0.15, -0.35, 0.6, hue, 0.7);
  return g;
}

// 15. SLANGE — reared cobra: coiled base, rising neck, fanged head + forked tongue
function buildSnake(dna) {
  const { base, creature, danger, bright, hue, seed, mat } = dnaBits(dna);
  const g = new THREE.Group();
  const N = 64;
  for (let i = 0; i < N; i++) {
    const f = i / (N - 1);
    let x, y, z;
    if (f < 0.55) {                              // loose coil at the base
      const a = (f / 0.55) * Math.PI * 2 * 1.5, rad = 0.85 * (1 - (f / 0.55) * 0.35);
      x = Math.cos(a) * rad; y = -1.15 + (f / 0.55) * 0.35; z = Math.sin(a) * rad * 0.55;
    } else {                                      // neck rears up toward the camera
      const u = (f - 0.55) / 0.45;
      x = lerp(0.5, 0, u); y = lerp(-0.8, 1.0, u); z = lerp(0.1, 0.55, u);
    }
    const s = new THREE.Mesh(new THREE.SphereGeometry(lerp(0.36, 0.17, f), 14, 12), mat);
    s.position.set(x, y, z); s.castShadow = true; g.add(s);
  }
  const head = new THREE.Group(); head.position.set(0, 1.18, 0.6); head.rotation.x = 0.25;
  const hb = blobMesh(0.5, seed, 0.05, mat); hb.scale.set(1.15, 0.8, 1.25); head.add(hb);
  addEyes(head, 2, 0.22, 0.16, 0.42, hue, Math.max(0.55, danger), bright, 0.7); // snakes always look mean
  attachMouth(head, base, danger, 0, -0.17, 0.46, hue, 0.9);
  const tongueMat = new THREE.MeshStandardMaterial({ color: 0xcc2244, roughness: 0.5 });
  [-1, 1].forEach(s => { const tk = taper(0.45, 0.03, 0.01, tongueMat); placeFrom(tk, new THREE.Vector3(0, -0.2, 0.5), new THREE.Vector3(s * 0.35, -0.25, 1), 0.45); head.add(tk); });
  g.add(head);
  return g;
}

// 16. SKORPION — flat body, pincers, segmented tail arcing over with glowing stinger
function buildScorpion(dna) {
  const { base, creature, danger, bright, hue, seed, mat } = dnaBits(dna);
  const g = new THREE.Group();
  const body = blobMesh(1.0, seed, 0.08, mat); body.scale.set(1.0, 0.6, 1.2); g.add(body);
  // legs
  for (let i = 0; i < 3; i++) [-1, 1].forEach(s => {
    const len = 0.7; g.add(placeFrom(taper(len, 0.07, 0.03, mat), new THREE.Vector3(s * 0.85, -0.1, 0.4 - i * 0.4), new THREE.Vector3(s * 1.0, -0.6, 0.2 - i * 0.3), len));
  });
  // pincers (forward)
  [-1, 1].forEach(s => {
    g.add(placeFrom(taper(0.7, 0.1, 0.08, mat), new THREE.Vector3(s * 0.6, 0.05, 0.7), new THREE.Vector3(s * 0.6, 0.1, 1.2), 0.7));
    const cm = bodyMat((hue + 20) % 360, danger);
    [-1, 1].forEach(cs => { const c = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.4, 8), cm); c.position.set(s * 0.7, 0.15 + cs * 0.1, 1.35); c.rotation.x = -1.2; c.castShadow = true; g.add(c); });
  });
  // segmented tail arcing up and over the back
  const segN = 6; let p = new THREE.Vector3(0, 0.2, -0.9);
  for (let i = 0; i < segN; i++) {
    const ang = lerp(-0.2, 1.5, i / (segN - 1));
    const dir = new THREE.Vector3(0, Math.sin(ang), -Math.cos(ang) * 0.6 + 0.2);
    const len = 0.35; const seg = taper(len, 0.16 - i * 0.015, 0.13 - i * 0.015, mat);
    placeFrom(seg, p, dir, len); g.add(seg);
    p = p.clone().addScaledVector(dir.clone().normalize(), len);
  }
  const sting = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.4, 10), glowBall(0.01, (hue + 100) % 360).material); sting.material = new THREE.MeshStandardMaterial({ color: hsl((hue + 100) % 360, 0.9, 0.6), emissive: hsl((hue + 100) % 360, 0.9, 0.55), emissiveIntensity: 1.8, roughness: 0.4 });
  sting.position.copy(p); sting.rotation.x = 2.4; g.add(sting);
  addEyes(g, 3, 0.22, 0.18, 0.95, hue, Math.max(0.5, danger), bright, 0.7);
  attachMouth(g, base, danger, 0, 0.0, 0.95, hue, 0.7);
  return g;
}

// 17. DINO / T-REX — bulky body, huge fanged head, tiny arms, thick legs, tail, spikes
function buildDino(dna) {
  const { base, creature, danger, bright, hue, seed, mat } = dnaBits(dna);
  const g = new THREE.Group();
  const body = blobMesh(1.0, seed, 0.09, mat); body.scale.set(1.0, 1.0, 1.15); g.add(body);
  // thick legs
  [-0.45, 0.45].forEach(x => { const l = limb(0.7, 0.24, mat); l.position.set(x, -0.85, 0.2); g.add(l); const foot = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 12), mat); foot.scale.set(1, 0.5, 1.4); foot.position.set(x, -1.4, 0.45); g.add(foot); });
  // tiny arms
  [-1, 1].forEach(s => { const a = limb(0.25, 0.07, mat); a.position.set(s * 0.55, 0.0, 0.55); a.rotation.z = s * 0.6; g.add(a); });
  // tail
  const tail = taper(1.5, 0.32, 0.04, mat); placeFrom(tail, new THREE.Vector3(0, -0.4, -0.7), new THREE.Vector3(0, -0.1, -1.4), 1.5); g.add(tail);
  g.add(spikeRow(Math.max(3, Math.round(lerp(3, 8, danger))), danger, hue));
  // huge head on a short neck
  const headP = new THREE.Vector3(-0.15, 0.85, 0.55);
  const head = new THREE.Group(); head.position.copy(headP);
  const hb = blobMesh(0.62, seed + 2, 0.05, mat); hb.scale.set(1.15, 0.85, 1.25); head.add(hb);
  addEyes(head, 2, 0.28, 0.26, 0.5, hue, Math.max(0.45, danger), bright, lerp(0.85, 1.1, base.eye));
  attachMouth(head, base, danger, 0, -0.22, 0.6, hue, 1.25);
  g.add(head);
  return g;
}

// 18. CELLE / AMØBE — wobbly translucent membrane + pseudopods + visible nucleus
function buildCell(dna) {
  const { base, creature, danger, bright, hue, seed } = dnaBits(dna);
  const g = new THREE.Group();
  const memMat = new THREE.MeshPhysicalMaterial({ color: hsl(hue, 0.55, lerp(0.5, 0.32, danger)), roughness: 0.25, transmission: 0.45, thickness: 1.0, ior: 1.2, transparent: true, opacity: 0.9 });
  const mem = blobMesh(1.0, seed, 0.16 + danger * 0.05, memMat); g.add(mem);
  // pseudopods
  const n = 5 + Math.floor((creature.tentacles || 4) / 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2; const dir = new THREE.Vector3(Math.cos(a), Math.sin(a) * 0.9, Math.sin(a * 1.7) * 0.5).normalize();
    const len = lerp(0.5, 0.95, Math.random());
    g.add(placeFrom(taper(len, 0.18, 0.05, memMat.clone()), dir.clone().multiplyScalar(0.85), dir, len));
  }
  // visible nucleus
  const nuc = new THREE.Mesh(new THREE.SphereGeometry(0.45, 20, 18), new THREE.MeshStandardMaterial({ color: hsl((hue + 180) % 360, 0.6, 0.3), roughness: 0.5 })); nuc.position.set(0, 0, 0.1); g.add(nuc);
  // organelles
  for (let i = 0; i < 5; i++) { const o = glowBall(0.08, (hue + 60) % 360); o.material.emissiveIntensity = 0.6; const a = i * 1.7; o.position.set(Math.cos(a) * 0.55, Math.sin(a) * 0.45, 0.3); g.add(o); }
  addEyes(g, creature.eyeCount, 0.4, 0.2, 0.95, hue, danger, bright, lerp(0.85, 1.1, base.eye));
  attachMouth(g, base, danger, 0, -0.35, 0.92, hue, 0.8);
  return g;
}

const BUILDERS = {
  blob: buildBlob, beast: buildBeast, eyeball: buildEyeball,
  multihead: buildMultihead, octopus: buildOctopus, fish: buildFish, bird: buildBird,
  worm: buildWorm, alien: buildAlien, crab: buildCrab, dragon: buildDragon,
  jelly: buildJelly, virus: buildVirus, bacteria: buildBacteria, snake: buildSnake,
  scorpion: buildScorpion, dino: buildDino, cell: buildCell
};

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
  const v = dna.voice || {};
  const sig = dna.creature.sn + "|" + dna.creature.type + "|" + dna.menace.toFixed(3)
    + "|" + (v.rough || 0).toFixed(2) + "|" + (v.bright || 0).toFixed(2);
  if (sig === builtSig && monster) return;
  builtSig = sig;
  disposeMonster();
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

  // dripping drool: strands stretch and shrink, hanging from the lower lip
  for (const d of drools) {
    const h = d.len * (0.6 + 0.4 * Math.sin(t / 600 + d.phase));
    d.mesh.scale.y = h;
    d.mesh.position.y = d.baseY - 0.54 * h;
  }
  // gentle hair sway
  for (const h of hairs) {
    const s = Math.sin(t / 520 + h.phase) * 0.12;
    h.mesh.quaternion.copy(h.rest);
    h.mesh.rotateZ(s); h.mesh.rotateX(s * 0.5);
  }
  // lower-jaw growl (bigger amplitude the more dangerous the monster)
  for (const j of jaws) j.group.position.y = -Math.abs(Math.sin(t / 240)) * j.amt;

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
  eyes = []; drools = []; hairs = []; jaws = [];
}

// release the current creature but keep the renderer/scene warm for reuse
export function clear() {
  disposeMonster();
  builtSig = null;
}
