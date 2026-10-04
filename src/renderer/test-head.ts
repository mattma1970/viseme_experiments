/**
 * buildTestHead: a procedural, stylized 3D head with the 15 Oculus viseme
 * morph targets — a self-contained placeholder rig for developing and
 * verifying the phenome pipeline before we adopt a final character asset.
 *
 * The head is a deformed sphere (jaw taper, nose bump, eye sockets). Each
 * viseme is baked as a full-position morph target computed from a small
 * parameter table (openness / roundness / protrusion / width / lower-lip
 * raise) applied to the mouth-region vertices, plus a subtle jaw drop.
 *
 * three.js caps morph targets at 8 unless the material opts in — hence
 * `defines.MAX_MORPH_TARGETS = 15`.
 */

import * as THREE from 'three';
import { VISEMES, type VisemeId } from '../viseme-core/visemes.js';

export interface TestHead {
  group: THREE.Group;
  headMesh: THREE.Mesh;
  mouthInterior: THREE.Mesh;
  lips: THREE.Mesh;
}

interface MouthParams {
  o: number; // openness: lower lip drops, jaw follows
  r: number; // roundness: lip corners pulled in & forward
  p: number; // protrusion: whole mouth region pushed forward
  wide: number; // width: corners spread out
  lowerUp: number; // lower lip raised (FF "bite")
}

const PARAMS: Record<VisemeId, MouthParams> = {
  viseme_aa: { o: 1.0, r: 0.15, p: 0.1, wide: 0.5, lowerUp: 0 },
  viseme_E: { o: 0.45, r: 0.05, p: 0.05, wide: 0.35, lowerUp: 0 },
  viseme_I: { o: 0.2, r: 0.0, p: 0.0, wide: 1.0, lowerUp: 0 },
  viseme_O: { o: 0.35, r: 0.85, p: 0.25, wide: 0.0, lowerUp: 0 },
  viseme_U: { o: 0.15, r: 1.0, p: 0.5, wide: 0.0, lowerUp: 0 },
  viseme_PP: { o: 0.02, r: 0.6, p: 0.55, wide: 0.0, lowerUp: 0 },
  viseme_SS: { o: 0.1, r: 0.45, p: 0.4, wide: 0.15, lowerUp: 0 },
  viseme_TH: { o: 0.1, r: 0.1, p: 0.5, wide: 0.3, lowerUp: 0 },
  viseme_DD: { o: 0.06, r: 0.05, p: 0.3, wide: 0.0, lowerUp: 0 },
  viseme_FF: { o: 0.06, r: 0.1, p: 0.25, wide: 0.0, lowerUp: 1 },
  viseme_kk: { o: 0.05, r: 0.15, p: 0.1, wide: 0.0, lowerUp: 0 },
  viseme_nn: { o: 0.12, r: 0.1, p: 0.15, wide: 0.1, lowerUp: 0 },
  viseme_RR: { o: 0.15, r: 0.7, p: 0.35, wide: 0.0, lowerUp: 0 },
  viseme_CH: { o: 0.2, r: 0.4, p: 0.4, wide: 0.1, lowerUp: 0 },
  viseme_sil: { o: 0, r: 0, p: 0, wide: 0, lowerUp: 0 },
};

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function gauss(u: number): number {
  return Math.exp(-u * u);
}

/**
 * Per-frame 3D offset of the mouth center, mirroring what the morphs do to
 * the center line of the mouth region (average of upper/lower lip rows,
 * mouth weight ≈ 1, front weight ≈ 1, jaw weight ≈ 0.55). Used to keep the
 * mouth-opening sticker glued to the moving surface.
 */
export function mouthOffset(vals: ArrayLike<number>): { dy: number; dz: number } {
  let dy = 0;
  let dz = 0;
  for (let i = 0; i < VISEMES.length; i++) {
    const v = vals[i] ?? 0;
    if (v === 0) continue;
    const mp = PARAMS[VISEMES[i]];
    dy +=
      v *
      (-0.13 * mp.o * (0.5 + 0.15 * 0.5) +
        0.04 * mp.o * (0.5 + 0.1 * 0.5) -
        0.05 * mp.o * 0.55 +
        0.05 * 0.5 * mp.lowerUp);
    dz += v * (0.05 * mp.r + 0.1 * mp.p);
  }
  return { dy, dz };
}

/**
 * Target scale of the mouth opening: height from an openness proxy, width
 * from effective roundness (narrow) vs. width (I/aa spread). Mirrors the
 * additive morph behavior at the mouth center.
 */
export function mouthScale(vals: ArrayLike<number>): { w: number; h: number } {
  const OPEN: number[] = [1, 0.55, 0.4, 0.5, 0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0.3, 0];
  let o = 0;
  let r = 0;
  let wide = 0;
  for (let i = 0; i < VISEMES.length; i++) {
    const v = vals[i] ?? 0;
    if (v === 0) continue;
    const mp = PARAMS[VISEMES[i]];
    o = Math.max(o, v * OPEN[i]);
    r += v * mp.r;
    wide += v * mp.wide;
  }
  const w = Math.min(1.7, Math.max(0.35, 1 + 0.5 * wide - 0.55 * r));
  return { w, h: 0.15 + 1.9 * o };
}

/** Head-shaping: turn a unit sphere into a stylized head. */
function deformHead(p: THREE.Vector3, n: THREE.Vector3): void {
  // Proportions: slightly narrower, taller.
  let x = n.x * 0.82;
  let y = n.y * 1.06;
  let z = n.z * 0.94;
  // Flatten the back of the skull a touch.
  if (n.z < -0.25) z *= 0.93;

  // Jaw: lower-front vertices drop and taper toward a chin.
  const front = smoothstep(0.05, 0.9, n.z);
  const low = smoothstep(0.1, -0.85, n.y);
  const jaw = front * low;
  y -= 0.32 * jaw;
  x *= 1 - 0.16 * jaw;
  z += 0.06 * jaw;

  // Nose: a rounded bump front-center, above the midline.
  const noseY = smoothstep(-0.12, 0.12, n.y) * (1 - smoothstep(0.35, 0.6, n.y));
  z += 0.24 * gauss(n.x / 0.13) * noseY * smoothstep(0.5, 0.95, n.z);

  // Eye sockets: slight recess around the eyes.
  const eyeY = gauss((n.y - 0.18) / 0.16);
  const eyeG =
    Math.max(gauss((n.x - 0.34) / 0.13), gauss((n.x + 0.34) / 0.13)) *
    eyeY *
    smoothstep(0.5, 0.9, n.z);
  z -= 0.05 * eyeG;

  p.set(x, y, z);
}

export function buildTestHead(): TestHead {
  const group = new THREE.Group();

  // ---------- base geometry ----------
  const geom = new THREE.SphereGeometry(1, 48, 32);
  const pos = geom.attributes.position as THREE.BufferAttribute;
  const count = pos.count;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    n.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    deformHead(p, n);
    pos.setXYZ(i, p.x, p.y, p.z);
  }

  // ---------- mouth region weights ----------
  const mouthDir = new THREE.Vector3(0, -0.42, 1).normalize();
  const wM = new Float32Array(count); // mouth-region weight
  const upper = new Uint8Array(count); // 1 = above the mouth line
  const cornerW = new Float32Array(count); // 1 at the lip corners
  const jawW = new Float32Array(count); // jaw/chin region weight
  const front = new Float32Array(count);

  let mouthCenter = new THREE.Vector3();
  let bestDot = -2;
  let mouthSurfaceZ = 0;

  for (let i = 0; i < count; i++) {
    n.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    front[i] = smoothstep(0.05, 0.9, n.z);
    const low = smoothstep(0.1, -0.85, n.y);
    jawW[i] = front[i] * low;

    const angDist = Math.acos(
      Math.min(1, Math.max(-1, n.dot(mouthDir))),
    );
    wM[i] = Math.exp(-Math.pow(angDist / 0.45, 2)) * front[i];
    upper[i] = n.y > -0.4 ? 1 : 0;
    cornerW[i] = Math.exp(-Math.pow((Math.abs(n.x) - 0.19) / 0.07, 2));

    if (wM[i] > 0.55) {
      const d = n.dot(mouthDir);
      if (d > bestDot) {
        bestDot = d;
        mouthCenter = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
      }
      mouthSurfaceZ = Math.max(mouthSurfaceZ, pos.getZ(i));
    }
  }

  // ---------- bake the 15 viseme morph targets ----------
  const morphs: THREE.BufferAttribute[] = [];
  for (const name of VISEMES) {
    const mp = PARAMS[name];
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const wm = wM[i];
      const uw = upper[i];
      const lw = 1 - uw;

      let dx = 0;
      let dy = 0;
      let dz = 0;

      // Jaw follows big openings (subtle).
      dy -= mp.o * 0.05 * jawW[i];

      // Lips: lower drops, upper lifts slightly.
      dy -= mp.o * 0.13 * wm * (lw + 0.15 * uw);
      dy += mp.o * 0.04 * wm * (uw + 0.1 * lw);

      // FF: lower lip raised to the "bite" position.
      dy += mp.lowerUp * 0.05 * wm * lw;

      // Width: corners spread out (I, aa).
      dx += x * mp.wide * 0.22 * wm * (0.4 + 0.6 * cornerW[i]);

      // Roundness & protrusion: pull inward and push forward (O, U, PP, RR…).
      dx -= x * mp.r * 0.55 * wm;
      dz += (mp.r * 0.05 + mp.p * 0.1) * wm * front[i];

      arr[i * 3] = x + dx;
      arr[i * 3 + 1] = y + dy;
      arr[i * 3 + 2] = z + dz;
    }
    const attr = new THREE.Float32BufferAttribute(arr, 3);
    attr.name = name; // three builds morphTargetDictionary from attribute names
    morphs.push(attr);
  }
  geom.morphAttributes.position = morphs;
  geom.computeVertexNormals();

  // Vertex colors: skin everywhere, tinted toward a lip color across the
  // mouth region — makes the mouth readable even at rest.
  const colors = new Float32Array(count * 3);
  const skin = new THREE.Color(0xe3a97e);
  const lip = new THREE.Color(0x96524a);
  const cc = new THREE.Color();
  for (let i = 0; i < count; i++) {
    const t = Math.min(1, wM[i] * 1.1) * 0.85;
    cc.copy(skin).lerp(lip, t);
    colors[i * 3] = cc.r;
    colors[i * 3 + 1] = cc.g;
    colors[i * 3 + 2] = cc.b;
  }
  geom.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, // actual color comes from vertex colors
    vertexColors: true,
    roughness: 0.72,
    metalness: 0.02,
  });
  // three.js only wires up 8 morph targets by default — opt in to all 15.
  mat.defines.MAX_MORPH_TARGETS = 15;

  const headMesh = new THREE.Mesh(geom, mat);
  headMesh.updateMorphTargets();
  group.add(headMesh);

  // ---------- mouth: opening sticker + lip ring ----------
  // Stickers sit just IN FRONT of the head surface (behind it, they'd be
  // occluded by the skull mesh itself). The demo re-positions/scales them
  // each frame (mouthOffset / mouthScale) so they follow the morphs.
  const interior = new THREE.Mesh(
    new THREE.CircleGeometry(0.12, 28),
    new THREE.MeshBasicMaterial({ color: 0x2b0e0b }),
  );
  interior.position.set(mouthCenter.x, mouthCenter.y, mouthSurfaceZ + 0.01);
  interior.scale.set(0.8, 0.18, 1);
  group.add(interior);

  const lips = new THREE.Mesh(
    new THREE.TorusGeometry(0.145, 0.024, 10, 48),
    new THREE.MeshBasicMaterial({ color: 0x8a4a44 }),
  );
  lips.scale.z = 0.55;
  lips.position.set(mouthCenter.x, mouthCenter.y, mouthSurfaceZ + 0.005);
  group.add(lips);

  // ---------- eyes ----------
  for (const sx of [-1, 1]) {
    const dir = new THREE.Vector3(sx * 0.34, 0.2, 1).normalize();
    let best = -2;
    let eyePos = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      n.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
      if (n.z < 0.3) continue;
      const d = n.dot(dir);
      if (d > best) {
        best = d;
        eyePos.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      }
    }
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x1c1c22 }),
    );
    eye.position.copy(eyePos).multiplyScalar(1.02);
    group.add(eye);
  }

  return { group, headMesh, mouthInterior: interior, lips };
}
