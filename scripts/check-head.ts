/**
 * Headless smoke test for the procedural test head + VisemeDriver
 * (three.js geometry & morph targets work without a browser/GPU).
 * Run: npm run check:head
 *
 * Verifies:
 *  - all 15 morph attributes exist, are named, and match vertex count
 *  - updateMorphTargets() resolves all 15 names in morphTargetDictionary
 *  - VisemeDriver binds all 15 channels and writes influences in [0,1]
 *  - at the peak-"aa" frame of sentence 1, the aa influence is near 1
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { buildTestHead } from '../src/renderer/test-head.js';
import { VisemeDriver } from '../src/renderer/viseme-driver.js';
import { buildTrack, VISEMES, type PhraseFile } from '../src/viseme-core/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  — ${detail}` : ''}`);
  if (!ok) failures++;
}

const head = buildTestHead();
const mesh = head.headMesh;
const geom = mesh.geometry;

console.log('== geometry ==');
const pos = geom.attributes.position as THREE.BufferAttribute;
check('base mesh has vertices', pos.count > 100, `${pos.count} verts`);
check('15 morph position attributes', geom.morphAttributes.position?.length === 15);
check(
  'morph names correct',
  (geom.morphAttributes.position ?? []).every((a, i) => a.name === VISEMES[i]),
);
check(
  'morph vertex counts match base',
  (geom.morphAttributes.position ?? []).every((a) => a.count === pos.count),
);

console.log('== morph targets ==');
mesh.updateMorphTargets();
const inf = mesh.morphTargetInfluences;
const dict = mesh.morphTargetDictionary;
check(
  'morphTargetInfluences length 15',
  inf?.length === 15,
  `${inf?.length}`,
);
check(
  'morphTargetDictionary has all 15 names',
  VISEMES.every((v) => dict?.[v] !== undefined),
);
if (inf === undefined || dict === undefined) {
  console.log('\nmorph targets missing — aborting');
  process.exit(1);
}

console.log('== driver ==');
const driver = new VisemeDriver(mesh);
check('driver bound 15/15', driver.boundCount === 15, `${driver.boundCount}`);

const doc = JSON.parse(
  readFileSync(join(root, 'public', 'samples', 'sentence-1.json'), 'utf8'),
) as PhraseFile;
const track = buildTrack(doc);
driver.loadTrack(track);

let min = Infinity;
let max = -Infinity;
for (let f = 0; f < track.frameCount; f++) {
  driver.updateTrack((f / track.fps) * 1000);
  for (const i of inf) {
    if (i < min) min = i;
    if (i > max) max = i;
  }
}
check('influences within [0,1] over full track', min >= 0 && max <= 1,
  `min=${min.toFixed(3)} max=${max.toFixed(3)}`);

// peak aa frame: find where channel aa is maximal
let aaFrame = 0;
for (let f = 0; f < track.frameCount; f++) {
  if (track.frames[f * 15] > track.frames[aaFrame * 15]) aaFrame = f;
}
driver.updateTrack((aaFrame / track.fps) * 1000);
const aaInf = inf[dict['viseme_aa']];
check('aa influence ≈ track peak at peak frame',
  Math.abs(aaInf - track.frames[aaFrame * 15]) < 0.02,
  `influence=${aaInf.toFixed(3)} track=${track.frames[aaFrame * 15].toFixed(3)}`);

// jaw check: the aa morph displaces lower-front (jaw) vertices downward
const aaAttr = geom.morphAttributes.position![0];
const v = new THREE.Vector3();
let jawDropped = false;
for (let i = 0; i < pos.count; i++) {
  v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
  if (v.y < -0.6 && v.z > 0.5) {
    if (aaAttr.getY(i) < pos.getY(i) - 0.01) {
      jawDropped = true;
      break;
    }
  }
}
check('aa morph drops the jaw region', jawDropped);

console.log(failures === 0 ? '\nall head checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
