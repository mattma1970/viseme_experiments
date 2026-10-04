/**
 * Core data types shared by the viseme pipeline.
 *
 * Timing convention: all times are milliseconds, phrase-relative in source
 * files and absolute (track-relative) in built tracks.
 */

/** A single spoken sound with its timing, e.g. { p: "ʃ", t: 1430, d: 70 }. */
export interface PhonemeEvent {
  /** IPA phoneme string ("sil" = silence/pause). */
  p: string;
  /** Start time, ms (relative to the enclosing phrase start). */
  t: number;
  /** Duration, ms. */
  d: number;
}

/** One spoken phrase/sentence: a contiguous phoneme timeline. */
export interface PhraseData {
  /** Original text (informational). */
  text?: string;
  phonemes: PhonemeEvent[];
}

/**
 * Canned phoneme timeline file.
 *
 * `format: "phenomes.phrase"` — our intermediate format. It mirrors the shape
 * of the HeadTTS / HeadAudio JSON ecosystem (per-phoneme `p`/`t`/`d`), so
 * M2 (HeadTTS) and M3 (audio classifier) can feed the same curve builder.
 */
export interface PhraseFile {
  format: string;
  version: number;
  text?: string;
  phrases: PhraseData[];
}

/**
 * A fully built viseme animation track: 15 channels (Oculus visemes)
 * sampled at a fixed frame rate, values in [0, 1].
 *
 * Layout: row-major — `frames[channelIndex + frame * 15]`.
 */
export interface VisemeTrack {
  /** Channel names, in VISEMES order ("viseme_aa", ..., "viseme_sil"). */
  channels: string[];
  fps: number;
  /** Interleaved per-frame values, length = frames * 15. */
  frames: Float32Array;
  /** Number of frames. */
  frameCount: number;
  /** Total duration, ms (= frameCount / fps * 1000, rounded up). */
  durationMs: number;
  /** Peak value reached per channel (diagnostics). */
  maxPerChannel: number[];
  /** Number of non-silence phoneme events that fed this track. */
  eventCount: number;
}

/** Options for building a VisemeTrack from phoneme events. */
export interface CurveOptions {
  /** Output frame rate. @default 60 */
  fps?: number;
  /** Rest gap inserted between phrases, ms. @default 140 */
  phraseGapMs?: number;
  /**
   * One-pole temporal smoothing constant, ms (0 = off). Smooths the final
   * per-channel curves; small values keep consonants crisp. @default 22
   */
  smoothTauMs?: number;
  /**
   * Attack length as a fraction of phoneme duration, clamped by
   * `attMinMs`/`attMaxMs`. @default 0.35
   */
  attackFrac?: number;
  /** Release (decay) length as a fraction of phoneme duration, clamped. */
  releaseFrac?: number;
}
