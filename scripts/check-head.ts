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

// ------------------------------------------------------------------
// vendored GLB avatars (Ready Player Me): JSON-chunk level validation
// (no GPU needed — we only need the morph name metadata to be intact)
// ------------------------------------------------------------------
interface GlbMesh {
  name?: string;
  extras?: { targetNames?: string[] };
  primitives?: { targets?: unknown[] }[];
}
interface GlbJson {
  asset?: { generator?: string };
  meshes?: GlbMesh[];
}

function glbJsonChunk(buf: Buffer): GlbJson {
  if (buf.toString('utf8', 0, 4) !== 'glTF') throw new Error('not a GLB file');
  if (buf.readUInt32LE(4) !== 2) throw new Error('not GLB version 2');
  const len = buf.readUInt32LE(8);
  const end = 12 + len;
  let off = 12;
  while (off + 8 <= end) {
    const clen = buf.readUInt32LE(off);
    const ctype = buf.readUInt32LE(off + 4);
    if (ctype === 0x4e4f534a) { // 'JSON'
      return JSON.parse(
        buf.subarray(off + 8, off + 8 + clen).toString('utf8'),
      ) as GlbJson;
    }
    off += 8 + clen;
  }
  throw new Error('no JSON chunk');
}

console.log('== GLB avatars (vendored) ==');
for (const name of ['julia.glb', 'david.glb']) {
  let json: GlbJson;
  try {
    json = glbJsonChunk(readFileSync(join(root, 'public', 'avatars', name)));
  } catch (e) {
    check(`${name}: present and valid`, false, e instanceof Error ? e.message : String(e));
    continue;
  }
  check(
    `${name}: generated by Ready Player Me`,
    json.asset?.generator === 'Ready Player Me',
    String(json.asset?.generator),
  );
  const meshes = json.meshes ?? [];
  const byName = (n: string): GlbMesh | undefined => meshes.find((m) => m.name === n);
  const namesOf = (m?: GlbMesh): string[] => m?.extras?.targetNames ?? [];
  const targetsOf = (m?: GlbMesh): number =>
    m?.primitives?.[0]?.targets?.length ?? 0;
  for (const part of ['Wolf3D_Head', 'Wolf3D_Teeth']) {
    const mesh = byName(part);
    const names = namesOf(mesh);
    const targets = targetsOf(mesh);
    const missing = VISEMES.filter((v) => !names.includes(v));
    check(
      `${name}: ${part} targetNames match morph count and cover all 15 visemes`,
      names.length === targets && targets > 0 && missing.length === 0,
      `${names.length} names / ${targets} targets${missing.length ? `; missing: ${missing.join(',')}` : ''}`,
    );
  }
}

// MPFB avatar (CC0, from TalkingHead): different naming convention.
// The face mesh 'base' must cover all 14 non-sil viseme channels
// (viseme_sil is the rest no-op and legitimately absent); teeth/tongue
// carry a partial subset and are still driven.
{
  const name = 'mpfb.glb';
  let json: GlbJson;
  try {
    json = glbJsonChunk(readFileSync(join(root, 'public', 'avatars', name)));
  } catch (e) {
    check(`${name}: present and valid`, false, e instanceof Error ? e.message : String(e));
    json = undefined as unknown as GlbJson;
  }
  if (json) {
    const meshes = json.meshes ?? [];
    const byName = (n: string): GlbMesh | undefined => meshes.find((m) => m.name === n);
    const namesOf = (m?: GlbMesh): string[] => m?.extras?.targetNames ?? [];
    const targetsOf = (m?: GlbMesh): number =>
      m?.primitives?.[0]?.targets?.length ?? 0;

    const face = byName('base');
    const fNames = namesOf(face);
    const fTargets = targetsOf(face);
    const missing = VISEMES.filter((v) => v !== 'viseme_sil' && !fNames.includes(v));
    check(
      `${name}: face mesh 'base' covers all 14 non-sil visemes (sil optional)`,
      fNames.length === fTargets && fTargets > 0 && missing.length === 0,
      `${fNames.length} names / ${fTargets} targets${missing.length ? `; missing: ${missing.join(',')}` : ''}`,
    );
    for (const part of ['teeth_base', 'tongue01']) {
      const mesh = byName(part);
      const names = namesOf(mesh);
      const targets = targetsOf(mesh);
      const visemeNames = names.filter((n) => n.startsWith('viseme_'));
      check(
        `${name}: ${part} has partial viseme binding`,
        names.length === targets && targets > 0 && visemeNames.length >= 4,
        `${names.length} names / ${targets} targets; visemes: ${visemeNames.join(', ')}`,
      );
    }
    const eyes = byName('high-poly');
    check(
      `${name}: eye mesh 'high-poly' has eyeLook morphs (drives no visemes)`,
      (eyes?.primitives?.[0]?.targets?.length ?? 0) > 0 &&
        namesOf(eyes).every((n) => !n.startsWith('viseme_')),
      `${namesOf(eyes).length} names`,
    );
  }
}

console.log(failures === 0 ? '\nall head checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
