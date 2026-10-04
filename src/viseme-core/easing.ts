/** Small easing/envelope toolkit for viseme curves. Pure functions, no deps. */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Raised-cosine ramp: 0 → 1 over x ∈ [0, 1], with zero first derivative at
 * both ends (C1-smooth attack/release — no visible "snaps").
 */
export function raisedCosine(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return 0.5 - 0.5 * Math.cos(Math.PI * x);
}

/**
 * Envelope for one phoneme event: raised-cosine attack over `att` ms,
 * sustain at 1.0, raised-cosine release over `rel` ms after the event end.
 * Returns 0 outside [t0, t0 + d + rel].
 */
export function eventEnvelope(
  tMs: number,
  t0: number,
  d: number,
  att: number,
  rel: number,
): number {
  if (tMs < t0) return 0;
  const a = clamp(att, 0, Math.max(d, 1) * 0.8); // never let attack eat the hold
  if (tMs < t0 + a) return raisedCosine((tMs - t0) / a);
  const t1 = t0 + d;
  if (tMs <= t1) return 1;
  if (rel <= 0) return 0;
  if (tMs < t1 + rel) return 1 - raisedCosine((tMs - t1) / rel);
  return 0;
}

/**
 * One-pole (exponential) low-pass smoother, used to soften the final
 * per-channel curves. `tau` is the time constant in ms.
 */
export class OnePole {
  private y = 0;

  constructor(public tauMs: number) {}

  reset(): void {
    this.y = 0;
  }

  /** Step the filter by dtMs toward input x; returns the new output. */
  step(x: number, dtMs: number): number {
    const a = 1 - Math.exp(-dtMs / this.tauMs);
    this.y += (x - this.y) * a;
    return this.y;
  }
}
