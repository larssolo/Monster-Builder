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

const PILOT = new Set(["blob", "beast", "eyeball"]);
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
