/**
 * loadGlbHead: loads a Ready-Player-Me-style GLB avatar (the vendored
 * `julia`/`david` heads from met4citizen/HeadAudio) and wires all of its
 * viseme morph meshes into a MultiMeshVisemeDriver.
 *
 * Convention notes (verified against the vendored files, see
 * public/avatars/ATTRIBUTION.md):
 *  - morph target names live in `mesh.extras.targetNames`; three.js
 *    GLTFLoader (r155+) reads that into morphTargetDictionary for us, so
 *    our 15 Oculus channel names bind with the identity map.
 *  - GLTF morphs are relative deltas: the loader sets
 *    geometry.morphTargetsRelative = true (unlike our hand-baked
 *    procedural head, whose targets are absolute positions).
 *  - three r169 auto-detects the morph count per geometry (texture-morph
 *    path), so the 72-morph face meshes work with no MAX_MORPH_TARGETS
 *    define.
 *
 * Camera framing: the avatar is a full-body rigged model (feet at y ≈ 0,
 * head around y ≈ 1.5–1.8 m). We locate the head and eyes by object name
 * (RPM: Wolf3D_Head / EyeLeft / EyeRight; MPFB: Human / Human.high-poly)
 * and park the camera ~0.45 m in front of the head at eye height.
 *
 * Texture quirk: the RPM avatars (julia/david) ship with solid-color
 * PLACEHOLDER textures (2×2 skin, 64×64 black eyes, 128×128 black teeth).
 * The geometry + morphs are the real deal, but the face looks featureless
 * ("no eyes/mouth"). loadGlbHead() detects those placeholder maps on the
 * eye/teeth materials and swaps in procedurally generated ones (colored
 * iris/pupil, ivory teeth) so the deformation is actually readable. The
 * mpfb avatar has real textures and is left untouched.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MultiMeshVisemeDriver, VisemeDriver } from './viseme-driver.js';

export interface GlbHead {
  id: string;
  group: THREE.Group;
  /** One driver per morph mesh that carries viseme names. */
  sink: MultiMeshVisemeDriver;
  /** Face-region materials (head, teeth, beard, eyes) for the wireframe toggle. */
  headMaterials: THREE.Material[];
  dispose(): void;
}

export async function loadGlbHead(
  url: string,
  id = url,
  onProgress?: (pct: number) => void,
): Promise<GlbHead> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(url, (e) => {
    if (e.total > 0) onProgress?.(Math.min(100, Math.round((e.loaded / e.total) * 100)));
  });
  const group = gltf.scene;

  const drivers: VisemeDriver[] = [];
  const headMaterials = new Set<THREE.Material>();
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const morphs = mesh.geometry?.morphAttributes?.position;
    if (morphs === undefined || morphs.length === 0) return;
    const d = new VisemeDriver(mesh);
    if (d.boundCount === 0) return; // morph mesh without our viseme names
    drivers.push(d);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) if (m !== null) headMaterials.add(m);
  });
  if (drivers.length === 0) {
    disposeGroup(group);
    throw new Error(`no viseme morph meshes found in ${id} — is this a viseme avatar?`);
  }

  patchPlaceholderTextures(group);
  sanitizeMorphInfluences(group);

  const sink = new MultiMeshVisemeDriver(drivers);
  return {
    id,
    group,
    sink,
    headMaterials: [...headMaterials],
    dispose(): void {
      disposeGroup(group);
    },
  };
}

function disposeGroup(group: THREE.Object3D): void {
  const mats = new Set<THREE.Material>();
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const m = mesh.material;
    if (Array.isArray(m)) for (const x of m) mats.add(x);
    else if (m !== null) mats.add(m);
  });
  for (const m of mats) {
    const anyM = m as THREE.MeshStandardMaterial;
    anyM.map?.dispose();
    anyM.normalMap?.dispose();
    anyM.roughnessMap?.dispose();
    anyM.metalnessMap?.dispose();
    anyM.aoMap?.dispose();
    anyM.emissiveMap?.dispose();
    m.dispose();
  }
}

// ---------------------------------------------------------------------------
// Morph-influence sanitation (defense in depth)
// ---------------------------------------------------------------------------

/**
 * In-place sanitize of morphTargetInfluences for every morph mesh.
 *
 * A NaN or undefined influence is fatal at render time: the GLSL morph
 * loop runs `if (morphTargetInfluences[i] != 0.0) transformed +=
 * getMorph(...) * inf`, and in IEEE-754 `NaN != 0.0` is TRUE — so a single
 * bad slot NaNs out every vertex of the mesh and the mesh renders
 * NOTHING. (This is exactly what took out MPFB's `Human` body mesh: the
 * old VisemeDriver wrote `values[meshIndex]` out of bounds into its
 * 15-slot buffer, producing `undefined` slots that uploaded as NaN.)
 * GLTFLoader initializes the array with zeros, but any writer that
 * touches the array can re-introduce holes, so we scrub it on every load.
 * The array is mutated in place (never replaced) because the renderer
 * caches a reference to it.
 */
function sanitizeMorphInfluences(group: THREE.Group): void {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const inf = mesh.morphTargetInfluences;
    if (!inf) return;
    for (let i = 0; i < inf.length; i++) {
      if (typeof inf[i] !== 'number' || !Number.isFinite(inf[i])) inf[i] = 0;
    }
  });
}

// Vendored avatars use different node-naming conventions:
//  - Ready Player Me (julia.glb / david.glb): head mesh 'Wolf3D_Head',
//    separate eye meshes 'EyeLeft' / 'EyeRight'.
//  - MPFB (mpfb.glb): one full-body face mesh 'base' (node 'Human') and a
//    combined eye mesh node 'Human.high-poly'. NOTE: three.js GLTFLoader
//    sanitizes object names by stripping dots, so the eye node is found as
//    'Humanhigh-poly' — both spellings are listed.
const HEAD_NAME_CANDIDATES = ['Wolf3D_Head', 'Human'];
const EYE_NAME_CANDIDATES = ['EyeLeft', 'EyeRight', 'Human.high-poly', 'Humanhigh-poly'];

/**
 * Computes the camera-framing anchors for a GLB avatar:
 *  - eyeCenter:  mean center of the named eye meshes (null if none found)
 *  - headCenter: center of the head region — the head object's vertices
 *    with y ≥ eyeCenter.y − 0.22, so the jaw is included but a full-body
 *    mesh's torso/legs (MPFB's 'base' mesh) are not
 *  - faceDir:    direction from headCenter to the front-most vertex of
 *    that region (one refinement pass starting from a +Z guess; all
 *    vendored avatars face +Z at rest)
 */
export function computeHeadFraming(group: THREE.Group): {
  headCenter: THREE.Vector3;
  faceDir: THREE.Vector3;
  eyeCenter: THREE.Vector3 | null;
} | null {
  group.updateMatrixWorld(true);

  // 1) eye centers (RPM: two meshes → averaged; MPFB: one combined mesh)
  const eyeC = new THREE.Vector3();
  let eyeCount = 0;
  const tmp = new THREE.Vector3();
  for (const name of EYE_NAME_CANDIDATES) {
    const eye = group.getObjectByName(name);
    if (eye) {
      new THREE.Box3().setFromObject(eye).getCenter(tmp);
      eyeC.add(tmp);
      eyeCount++;
    }
  }
  const eyeCenter = eyeCount > 0 ? eyeC.clone().divideScalar(eyeCount) : null;

  // 2) meshes whose vertices form the head region
  const headObj = HEAD_NAME_CANDIDATES
    .map((n) => group.getObjectByName(n))
    .find((o) => o !== null);
  const meshes: THREE.Mesh[] = [];
  if (headObj) {
    headObj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry?.attributes?.position) meshes.push(mesh);
    });
  }
  if (meshes.length === 0) {
    // fallback: all morph meshes (unknown avatar conventions)
    group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (
        mesh.isMesh &&
        mesh.geometry?.morphAttributes?.position?.length &&
        mesh.geometry?.attributes?.position
      ) {
        meshes.push(mesh);
      }
    });
    if (meshes.length === 0) return null;
  }

  // 3) head-region bounding box (jaw included, torso/legs excluded)
  const yMin = eyeCenter ? eyeCenter.y - 0.22 : -Infinity;
  const box = new THREE.Box3();
  const wp = new THREE.Vector3();
  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      wp.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld);
      if (wp.y < yMin) continue;
      box.expandByPoint(wp);
    }
  }
  if (box.isEmpty()) return null;
  const headCenter = box.getCenter(new THREE.Vector3());

  // 4) face direction: refine the +Z guess toward the front-most vertex
  let faceDir = new THREE.Vector3(0, 0, 1);
  let best = -Infinity;
  const bestP = new THREE.Vector3();
  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      wp.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld);
      if (wp.y < yMin) continue;
      const d = tmp.copy(wp).sub(headCenter).dot(faceDir);
      if (d > best) {
        best = d;
        bestP.copy(wp);
      }
    }
  }
  const toFront = bestP.sub(headCenter);
  if (toFront.lengthSq() > 1e-6) faceDir = toFront.normalize();

  return { headCenter, faceDir, eyeCenter };
}

/**
 * Points the camera at the avatar's head: ~0.45 m in front of the face
 * (per computeHeadFraming) and at eye height, orbiting on the head center.
 */
export function frameCameraOnHead(
  group: THREE.Group,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
): void {
  const f = computeHeadFraming(group);
  if (!f) return;

  const camPos = f.headCenter.clone().addScaledVector(f.faceDir, 0.45);
  // The head region includes the hair volume, so its center sits a bit low;
  // park the camera at eye height instead.
  if (f.eyeCenter) camPos.y = f.eyeCenter.y;
  camera.position.copy(camPos);
  camera.up.set(0, 1, 0);
  controls.target.copy(f.headCenter);
  controls.update();
}

// ---------------------------------------------------------------------------
// Placeholder-texture patching (RPM avatars only; no-op for real textures)
// ---------------------------------------------------------------------------

/**
 * Replaces the solid-color placeholder textures that the RPM avatars ship
 * with (2×2 skin, 64×64 solid-black eyes, 128×128 solid-black teeth) so the
 * face is actually readable: eyes get a sclera + iris + pupil, teeth get
 * an ivory map. Materials with real textures (e.g. mpfb.glb) are left
 * untouched.
 */
function patchPlaceholderTextures(group: THREE.Group): void {
  if (typeof document === 'undefined') return; // node/devcheck: no canvas

  group.updateMatrixWorld(true);
  const headObj = HEAD_NAME_CANDIDATES
    .map((n) => group.getObjectByName(n))
    .find((o) => o !== null);
  const headBox = new THREE.Box3().setFromObject(
    headObj ?? group,
  );
  const headCenter = headBox.getCenter(new THREE.Vector3());

  const patched = new Set<THREE.Material>();
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const m = mat as THREE.MeshStandardMaterial;
      if (m === null || patched.has(m) || !m.map) continue;
      const name = m.name ?? '';
      const kind = /eye/i.test(name) ? 'eye' : /teeth/i.test(name) ? 'teeth' : null;
      if (!kind || !isPlaceholderImage(m.map.image)) continue;
      if (kind === 'teeth') {
        m.map.dispose();
        m.map = makeTeethTexture();
      } else {
        const uv = findFrontUV(mesh, headCenter);
        if (!uv) continue;
        m.map.dispose();
        m.map = makeEyeTexture(256, uv.u, uv.v);
      }
      m.needsUpdate = true;
      patched.add(m);
    }
  });
}

/** True for (nearly) single-color images — the RPM placeholder texture. */
function isPlaceholderImage(img: unknown): boolean {
  const image = img as { width?: number; height?: number };
  const w = image.width;
  const h = image.height;
  if (typeof w !== 'number' || typeof h !== 'number' || w === 0 || h === 0) {
    return false;
  }
  if (w * h <= 4) return true; // 2×2 → definitely flat
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(img as CanvasImageSource, 0, 0, 32, 32);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, 32, 32).data;
  } catch {
    return false;
  }
  const colors = new Set<number>();
  for (let i = 0; i < data.length; i += 16) {
    colors.add(((data[i] >> 4) << 8) | (data[i + 1] >> 4));
  }
  return colors.size <= 2;
}

/** UV of the vertex on the eye mesh that faces away from the head center. */
function findFrontUV(
  mesh: THREE.Mesh,
  headCenter: THREE.Vector3,
): { u: number; v: number } | null {
  const pos = mesh.geometry.getAttribute('position');
  const uv = mesh.geometry.getAttribute('uv');
  if (!pos || !uv) return null;
  mesh.updateMatrixWorld(true);
  const eyeCenter = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
  const dir = eyeCenter.clone().sub(headCenter).normalize();
  const wp = new THREE.Vector3();
  let best = -Infinity;
  let bestUv: { u: number; v: number } | null = null;
  for (let i = 0; i < pos.count; i++) {
    wp.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld);
    const d = wp.sub(eyeCenter).dot(dir);
    if (d > best) {
      best = d;
      bestUv = { u: uv.getX(i), v: uv.getY(i) };
    }
  }
  return bestUv;
}

/** Procedural eyeball map: sclera + iris + pupil centered on the front UV. */
function makeEyeTexture(size: number, u: number, v: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f4f2ec'; // sclera
  ctx.fillRect(0, 0, size, size);
  const cx = u * size;
  const cy = (1 - v) * size; // CanvasTexture flips Y
  const r = size * 0.24;
  const g = ctx.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
  g.addColorStop(0, '#3a2a18');
  g.addColorStop(0.55, '#6b4a2a');
  g.addColorStop(1, '#4a3018');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#141210'; // pupil
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; // specular
  ctx.beginPath();
  ctx.arc(cx - r * 0.35, cy - r * 0.35, size * 0.03, 0, Math.PI * 2);
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Flat ivory map for teeth. */
function makeTeethTexture(size = 64): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f0ebe0';
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
