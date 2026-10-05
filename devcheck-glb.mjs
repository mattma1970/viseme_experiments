// Headless reproduction of the browser GLB head load (run with tsx so the
// production src/renderer/glb-head.ts code paths are exercised directly):
// GLTFLoader parse + VisemeDriver-style binding + computeHeadFraming.
//   Run: npx tsx devcheck-glb.mjs
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { computeHeadFraming } from './src/renderer/glb-head.ts';

// ---- browser-ish stubs three's ImageLoader / GLTFLoader need ------------
class FakeImage {
  addEventListener(type, fn) {
    if (type === 'load') this._load = () => fn();
    else if (type === 'error') this._err = () => fn(new Error('image load (stub)'));
  }
  removeEventListener() {}
  set src(_v) {
    queueMicrotask(() => { this.width = 8; this.height = 8; this._load?.(); });
  }
  get src() { return 'data:image/png;base64,'; }
}
globalThis.document = {
  baseURI: 'http://localhost:5173/',
  createElementNS: () => new FakeImage(),
};
globalThis.window = { location: { origin: 'http://localhost:5173' }, URL, webkitURL: URL };
globalThis.self = globalThis.window;

const VISEMES = ['viseme_sil','viseme_PP','viseme_FF','viseme_TH','viseme_DD','viseme_kk','viseme_CH','viseme_SS','viseme_nn','viseme_RR','viseme_aa','viseme_E','viseme_I','viseme_O','viseme_U'];
// viseme_sil is the rest no-op and may legitimately be absent (mpfb).
const NON_SIL = VISEMES.filter((v) => v !== 'viseme_sil');

// Per-avatar expectations. The face mesh is the driven mesh with the most
// viseme names; it must carry every non-sil channel. Other driven meshes
// (teeth, tongue) may carry a partial subset. `eyes` are the object names
// frameCameraOnHead/computeHeadFraming look up (three.js strips dots from
// node names, so the MPFB eye node appears as 'Humanhigh-poly').
const AVATARS = [
  { file: 'julia.glb', head: 'Wolf3D_Head', eyes: 2, minDriven: 2 },
  { file: 'david.glb', head: 'Wolf3D_Head', eyes: 2, minDriven: 2 },
  { file: 'mpfb.glb', head: 'Human', eyes: 1, minDriven: 3 },
];

const root = '/home/mattma/repos/phenomes';
let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

for (const av of AVATARS) {
  console.log(`== ${av.file} ==`);
  const buf = readFileSync(`${root}/public/avatars/${av.file}`);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const loader = new GLTFLoader();
  const t0 = Date.now();
  let gltf;
  try {
    gltf = await loader.parseAsync(ab, '');
  } catch (e) {
    check('GLTFLoader.parseAsync', false, `${e?.message ?? e}\n${e?.stack ?? ''}`.split('\n').slice(0, 4).join(' | '));
    continue;
  }
  check('GLTFLoader.parseAsync', true, `${Date.now() - t0} ms`);

  // what loadGlbHead does: find morph meshes
  const scene = gltf.scene;
  const morphMeshes = [];
  scene.traverse((o) => {
    if (o.isMesh && o.geometry?.morphAttributes?.position?.length > 0) morphMeshes.push(o);
  });
  check('viseme morph meshes found', morphMeshes.length > 0, morphMeshes.map((m) => m.name).join(', '));
  if (morphMeshes.length === 0) continue;

  // bind check (same logic as VisemeDriver: GLTFLoader already populated the
  // dictionary from mesh.extras.targetNames; three's *core*
  // updateMorphTargets() would wipe it, which is why the driver only calls
  // it when the dictionary is empty). Driver contract: every mesh with
  // ≥1 viseme name is driven; meshes with no viseme names (outfits, eyes,
  // brows) are excluded.
  let drivenMeshes = [];
  for (const m of morphMeshes) {
    check(`  ${m.name}: morph targets are relative deltas`, m.geometry.morphTargetsRelative === true);
    const present = VISEMES.filter((v) => m.morphTargetDictionary?.[v] !== undefined);
    if (present.length === 0) {
      check(`  ${m.name}: no viseme names → excluded from sink`, true,
        `(${m.geometry.morphAttributes.position.length} morphs)`);
    } else {
      drivenMeshes.push({ mesh: m, present });
      check(`  ${m.name}: binding ok`, true,
        `${present.length}/15 names, ${m.geometry.morphAttributes.position.length} morphs`);
    }
  }
  check('driven morph meshes', drivenMeshes.length >= av.minDriven, drivenMeshes.map((d) => d.mesh.name).join(', '));

  // the face mesh (most viseme names) must cover every non-sil channel
  const face = drivenMeshes.reduce((a, b) => (b.present.length > a.present.length ? b : a));
  const faceMissing = NON_SIL.filter((v) => face.mesh.morphTargetDictionary?.[v] === undefined);
  check(`face mesh ${face.mesh.name} covers all 14 non-sil channels`, faceMissing.length === 0,
    faceMissing.length === 0 ? `${face.present.length}/15 names` : `missing: ${faceMissing.join(', ')}`);

  // write present viseme channels to 1 on every driven mesh (relative deltas — safe)
  let bad = 0;
  for (const { mesh: m } of drivenMeshes) {
    const inf = m.morphTargetInfluences;
    if (!inf) { bad++; continue; }
    for (const v of VISEMES) {
      const idx = m.morphTargetDictionary[v];
      if (idx === undefined) continue; // channel not on this mesh — fine
      inf[idx] = 1;
    }
    for (const i of inf) if (i < 0 || i > 1) bad++;
  }
  check('influence writes land in [0,1]', bad === 0);

  // camera framing — the production computeHeadFraming()
  const f = computeHeadFraming(scene);
  check('computeHeadFraming returns anchors', !!f);
  if (!f) continue;
  const finite = (v) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
  check('head center finite', finite(f.headCenter),
    `(${f.headCenter.x.toFixed(3)}, ${f.headCenter.y.toFixed(3)}, ${f.headCenter.z.toFixed(3)})`);
  // head center must be in the head region (not the torso of a full-body mesh)
  check('head center in head region (y > 1.3)', f.headCenter.y > 1.3, `y=${f.headCenter.y.toFixed(3)}`);
  check(`eye center found (expected ${av.eyes} eye object(s))`, f.eyeCenter !== null,
    f.eyeCenter ? `(${f.eyeCenter.x.toFixed(3)}, ${f.eyeCenter.y.toFixed(3)}, ${f.eyeCenter.z.toFixed(3)})` : 'none');
  check('face direction finite & unit & facing +Z',
    finite(f.faceDir) && Math.abs(f.faceDir.length() - 1) < 1e-6 && f.faceDir.z > 0.5,
    `(${f.faceDir.x.toFixed(3)}, ${f.faceDir.y.toFixed(3)}, ${f.faceDir.z.toFixed(3)})`);
}

console.log(failures === 0 ? '\nglb parse checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
