/**
 * Interim audio for the demo: the browser's system TTS (speechSynthesis).
 *
 * Real spoken audio with zero model downloads. We listen to per-WORD
 * boundary events and use them to build a piecewise-linear remap from
 * "actual spoken time" to "canned track time", so the viseme animation
 * follows the voice's real pacing even when it speaks faster or slower
 * than our hand-timed track.
 *
 * This is a stopgap until M2 (HeadTTS / Kokoro in-browser TTS), which
 * provides both the audio and the phoneme timings natively — the demo's
 * wiring here (speak a text, remap the track clock) is the same seam.
 */

/** A measured correspondence: absolute track time ↔ spoken audio time. */
export interface Anchor {
  trackMs: number;
  audioMs: number;
}

/**
 * Piecewise-linear time remap between spoken-audio time and track time.
 * Anchors are added as word boundaries arrive (track time = the word's
 * position in the canned timeline; audio time = when the voice actually
 * started that word).
 */
export class TimeMap {
  private anchors: Anchor[] = [];

  /** Add/replace an anchor at an exact track time (merges duplicates). */
  add(trackMs: number, audioMs: number): void {
    const existing = this.anchors.find((a) => a.trackMs === trackMs);
    if (existing) {
      existing.audioMs = audioMs;
      return;
    }
    this.anchors.push({ trackMs, audioMs });
    this.anchors.sort((a, b) => a.trackMs - b.trackMs);
  }

  get size(): number {
    return this.anchors.length;
  }

  /**
   * Spoken-audio time → track time (drives the animation).
   * Before the first anchor: the first segment's slope (or identity).
   * After the last anchor: extrapolate with the last segment's slope.
   */
  toTrack(a: number): number {
    const A = this.anchors;
    if (A.length === 0) return a;
    if (A.length === 1) return a; // no pacing info yet: identity

    const slopeOf = (i: number): number => {
      const a0 = A[i - 1];
      const a1 = A[i];
      const dt = Math.max(1e-3, a1.audioMs - a0.audioMs);
      return (a1.trackMs - a0.trackMs) / dt;
    };

    if (a <= A[0].audioMs) {
      const s = slopeOf(1);
      return A[0].trackMs + (a - A[0].audioMs) * s;
    }
    for (let i = 1; i < A.length; i++) {
      if (a <= A[i].audioMs) {
        const a0 = A[i - 1];
        const a1 = A[i];
        const f = (a - a0.audioMs) / Math.max(1e-3, a1.audioMs - a0.audioMs);
        return a0.trackMs + (a1.trackMs - a0.trackMs) * f;
      }
    }
    const a0 = A[A.length - 2];
    const a1 = A[A.length - 1];
    const s = slopeOf(A.length - 1);
    return a1.trackMs + (a - a1.audioMs) * s;
  }
}

/** Thin wrapper over window.speechSynthesis with voice picking + callbacks. */
export class SystemSpeech {
  readonly available: boolean;
  private syn: SpeechSynthesis | null;
  private voice: SpeechSynthesisVoice | null = null;

  /** Called with (ms since speak() started, charIndex into the utterance). */
  onWord: (audioMs: number, charIndex: number) => void = () => {};
  /** Fired on end OR error (cancels included) — caller must guard state. */
  onFinished: () => void = () => {};

  constructor() {
    this.syn =
      typeof window !== 'undefined' && 'speechSynthesis' in window
        ? window.speechSynthesis
        : null;
    this.available = this.syn !== null;
    if (this.syn) {
      const pick = (): void => {
        const vs = this.syn!.getVoices();
        this.voice =
          vs.find((v) => v.lang === 'en-US') ??
          vs.find((v) => v.lang?.toLowerCase().startsWith('en')) ??
          vs[0] ??
          null;
      };
      pick();
      // Chrome populates voices asynchronously.
      this.syn.addEventListener?.('voiceschanged', pick);
    }
  }

  get voiceName(): string | null {
    return this.voice?.name ?? null;
  }

  /** Speak `text` from now. Returns false if unavailable. */
  speak(text: string): boolean {
    if (!this.syn || text.length === 0) return false;
    this.syn.cancel(); // Chrome quirk: a fresh speak() after activity needs this
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.rate = 1;
    const startAt = performance.now();
    u.onboundary = (e: SpeechSynthesisEvent) => {
      if (e.name === 'word' || e.name === undefined) {
        this.onWord(performance.now() - startAt, e.charIndex);
      }
    };
    const done = (): void => this.onFinished();
    u.onend = done;
    u.onerror = done;
    this.syn.speak(u);
    return true;
  }

  cancel(): void {
    this.syn?.cancel();
  }
}

/**
 * Split a sample's phoneme timeline into words:
 *  - wordStartMs: absolute track-time of each word's first phoneme
 *  - wordChars: the word text tokens (must match `text`)
 *  - charOffsets: character offset of each word in the full text
 */
export function wordSpans(text: string, phonemes: ArrayLike<{ p: string; t: number }>) {
  const words: string[] = text.split(/\s+/).filter((w) => w.length > 0);
  const charOffsets: number[] = [];
  {
    let off = 0;
    for (const w of words) {
      charOffsets.push(off);
      off += w.length + 1; // +1 for the separating space
    }
  }

  const wordStartMs: number[] = [];
  for (let i = 0; i < phonemes.length; i++) {
    const prevSil = i === 0 || phonemes[i - 1].p === 'sil';
    const curSil = phonemes[i].p === 'sil';
    if (!curSil && prevSil) wordStartMs.push(phonemes[i].t);
  }

  // Defensive: if the text and phoneme runs disagree in count, trust the
  // phoneme runs (they drive the animation) and map words onto them 1:1.
  const n = Math.min(words.length, wordStartMs.length);
  return {
    words: words.slice(0, n),
    charOffsets: charOffsets.slice(0, n),
    wordStartMs: wordStartMs.slice(0, n),
  };
}

/** Nearest word index for an absolute character offset (binary search). */
export function wordAtChar(charOffsets: number[], absChar: number): number {
  let lo = 0;
  let hi = charOffsets.length - 1;
  if (hi < 0) return 0;
  if (absChar < charOffsets[0]) return 0;
  if (absChar >= charOffsets[hi]) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (charOffsets[mid] <= absChar) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
