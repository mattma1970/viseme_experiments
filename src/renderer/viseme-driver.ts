/**
 * VisemeDriver: the single mapping point between the viseme pipeline and a
 * character's morph targets.
 *
 * Supports two modes:
 *  - track mode:  play back a prebuilt VisemeTrack (phoneme-driven path)
 *  - live mode:   set viseme values on the fly (audio-driven fallback path,
 *                 e.g. the HeadAudio-style classifier in M3)
 *
 * If the character asset's morphs aren't named exactly "viseme_aa"…, pass a
 * `nameMap` to remap our channel names onto whatever the rig uses.
 */

import type * as THREE from 'three';
import { NUM_VISEMES, VISEMES, VISeme_INDEX } from '../viseme-core/visemes.js';
import type { VisemeId } from '../viseme-core/visemes.js';
import type { VisemeTrack } from '../viseme-core/types.js';
import { sampleTrack } from '../viseme-core/curves.js';

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export interface VisemeDriverOptions {
  /** Map our channel name → the asset's morph target name (identity by default). */
  nameMap?: Partial<Record<(typeof VISEMES)[number], string>>;
}

/**
 * The driver surface the demo (and the M3 audio path) talks to. A plain
 * VisemeDriver already satisfies it; MultiMeshVisemeDriver aggregates
 * several for assets where multiple meshes (head, teeth, beard, …) each
 * carry their own viseme morph targets.
 */
export interface VisemeSink {
  /** Number of our 15 channels resolved onto the rig (max across meshes). */
  readonly boundCount: number;
  setViseme(channel: string, v: number): void;
  setAll(values: ArrayLike<number>): void;
  updateTrack(tMs: number): void;
  loadTrack(track: VisemeTrack): void;
  setAllZero(): void;
  get(channel: string): number;
  readAll(out: Float32Array): Float32Array;
}

export class VisemeDriver implements VisemeSink {
  private mesh: THREE.Mesh;
  // channel name → morph-target index IN THIS MESH's morph array. The mesh
  // index can be anything (0..N of the asset's morphs); our value storage is
  // always indexed by channel (0..NUM_VISEMES-1). Mixing those two index
  // spaces is what corrupted the MPFB head (out-of-range writes into the
  // 15-slot values buffer → undefined → NaN uniform → invisible mesh).
  private map = new Map<string, number>();
  private values = new Float32Array(NUM_VISEMES); // indexed by channel
  private scratch = new Float32Array(NUM_VISEMES); // indexed by channel
  track: VisemeTrack | null = null;

  constructor(mesh: THREE.Mesh, opts: VisemeDriverOptions = {}) {
    this.mesh = mesh;

    // Make sure three has built the influences/dictionary from the geometry.
    if (
      !mesh.morphTargetDictionary ||
      Object.keys(mesh.morphTargetDictionary).length === 0
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mesh as any).updateMorphTargets?.();
    }

    for (const ch of VISEMES) {
      const name = opts.nameMap?.[ch] ?? ch;
      const idx = mesh.morphTargetDictionary?.[name];
      if (idx !== undefined) this.map.set(ch, idx);
    }
  }

  /** Number of our 15 channels that actually resolved onto the rig. */
  get boundCount(): number {
    return this.map.size;
  }

  /** Set a single channel by name (live mode). Value clamped to [0,1]. */
  setViseme(channel: string, v: number): void {
    if (!(channel in VISeme_INDEX) || !this.map.has(channel)) return;
    this.values[VISeme_INDEX[channel as VisemeId]] = clamp01(v);
    this.commit();
  }

  /** Set many channels at once (live mode). */
  setAll(values: ArrayLike<number>): void {
    for (let ci = 0; ci < NUM_VISEMES; ci++) {
      this.values[ci] = clamp01(values[ci] ?? 0);
    }
    this.commit();
  }

  /** Advance track playback to time tMs (track mode). */
  updateTrack(tMs: number): void {
    if (!this.track) return;
    sampleTrack(this.track, tMs, this.scratch);
    for (let ci = 0; ci < NUM_VISEMES; ci++) {
      this.values[ci] = clamp01(this.scratch[ci]);
    }
    this.commit();
  }

  loadTrack(track: VisemeTrack): void {
    this.track = track;
    this.setAllZero();
  }

  setAllZero(): void {
    this.values.fill(0);
    this.commit();
  }

  /** Current value of a channel (for UI meters etc.). */
  get(channel: string): number {
    if (!(channel in VISeme_INDEX) || !this.map.has(channel)) return 0;
    return this.values[VISeme_INDEX[channel as VisemeId]];
  }

  /** Copy current values into a caller-provided array of length NUM_VISEMES. */
  readAll(out: Float32Array): Float32Array {
    for (let ci = 0; ci < NUM_VISEMES; ci++) {
      const ch = VISEMES[ci];
      out[ci] = this.map.has(ch) ? this.values[ci] : 0;
    }
    return out;
  }

  private commit(): void {
    const inf = this.mesh.morphTargetInfluences;
    if (!inf) return;
    this.map.forEach((meshIdx, ch) => {
      const ci = VISeme_INDEX[ch as VisemeId];
      const v = this.values[ci];
      // Never allow a non-finite value into the influences array: a NaN
      // influence makes `inf != 0.0` true in GLSL and NaNs out every vertex
      // of the mesh (the mesh then renders nothing).
      inf[meshIdx] = typeof v === 'number' && Number.isFinite(v) ? v : 0;
    });
  }
}

/**
 * Drives the same 15-channel values into several morph meshes. Each mesh
 * keeps its own VisemeDriver (its own morph indices); a channel value is
 * written into every mesh that resolved that channel. Used for multi-part
 * avatar GLBs (e.g. the Ready Player Me heads, where head, teeth, beard
 * and eyes each carry the full Oculus viseme set).
 */
export class MultiMeshVisemeDriver implements VisemeSink {
  private scratch = new Float32Array(NUM_VISEMES);

  constructor(readonly drivers: VisemeDriver[]) {
    if (drivers.length === 0) {
      throw new Error('MultiMeshVisemeDriver: needs at least one driver');
    }
  }

  get boundCount(): number {
    let max = 0;
    for (const d of this.drivers) max = Math.max(max, d.boundCount);
    return max;
  }

  setViseme(channel: string, v: number): void {
    for (const d of this.drivers) d.setViseme(channel, v);
  }

  setAll(values: ArrayLike<number>): void {
    for (const d of this.drivers) d.setAll(values);
  }

  updateTrack(tMs: number): void {
    for (const d of this.drivers) d.updateTrack(tMs);
  }

  loadTrack(track: VisemeTrack): void {
    for (const d of this.drivers) d.loadTrack(track);
  }

  setAllZero(): void {
    for (const d of this.drivers) d.setAllZero();
  }

  get(channel: string): number {
    let max = 0;
    for (const d of this.drivers) max = Math.max(max, d.get(channel));
    return max;
  }

  readAll(out: Float32Array): Float32Array {
    out.fill(0);
    for (const d of this.drivers) {
      d.readAll(this.scratch);
      for (let i = 0; i < NUM_VISEMES; i++) {
        if (this.scratch[i] > out[i]) out[i] = this.scratch[i];
      }
    }
    return out;
  }
}
