# phenomes

Local, in-browser **viseme** generation (what the project internally calls
"phenomes") for driving the mouth movement of 3D characters from
text-to-speech — the same pattern as Azure Speech's
`viseme_received` event, but running fully offline in the browser.

Research background: [`docs/viseme-generation-research.md`](docs/viseme-generation-research.md)

## Status

| Milestone | Scope | Status |
|---|---|---|
| **M0** | Scaffold (Vite + TypeScript) | ✅ done |
| **M1** | `viseme-core` (15-viseme set, IPA mapping, envelopes, dominance blending, keyframe builder) + procedural three.js test head with 15 Oculus morph targets, driven by canned phoneme JSON; audible speech via the interim system-voice bridge (`speechSynthesis` + word-boundary clock remap) | ✅ done |
| **M2** | HeadTTS (Kokoro-82M ONNX) in-browser TTS → real per-phoneme timings feed `viseme-core`; audio playback sync; WebGPU with WASM fallback; model fetch + local cache | ⬜ next |
| **M3** | HeadAudio-style MFCC/Gaussian viseme classifier as an `AudioWorklet` (`audio/viseme-worklet.ts`) — fallback for mic input & arbitrary audio, bootstrapped from the MIT-licensed `model-en-mixed.bin` | ⬜ |
| **M4** | Polish: smoothing/latency measurement, TTS-vs-audio A/B demo, final character asset integration via the driver's name-remap layer, docs | ⬜ |

## Quick start

```sh
npm install
npm run dev          # http://localhost:5173 — test head + canned tracks
```

> If your npm cache dir (`~/.npm`) isn't writable, use
> `npm install --cache ./.npm-cache`.

Verification (no browser needed):

```sh
npm run check        # viseme-core: coverage, smoothness, bounds
npm run check:head   # test head: morph targets, driver binding, jaw motion
npm run gen:samples  # regenerate public/samples/*.json
npm run build        # typecheck + production build
```

## Architecture

```
 text ──► TTS (M2: HeadTTS/Kokoro, in-browser)
             │  audio + per-phoneme timings (p, t, d)
             ▼
 viseme-core   phoneme → viseme map → envelopes → dominance blend → 15-ch track @60fps
             ▲
             │  (M3 fallback: audio only → MFCC → Gaussian prototypes → visemes/frame)
             ▼
 renderer/VisemeDriver ──► character mesh morphTargetInfluences["viseme_*"]
```

- `src/viseme-core/` — pure TS, no three.js, no DOM.
  - `visemes.ts` — the 15 Oculus visemes, IPA→viseme table (HeadAudio
    Appendix A), Cohen–Massaro-style dominance priorities, per-viseme
    amplitudes.
  - `easing.ts` — raised-cosine envelopes, one-pole smoother.
  - `curves.ts` — `buildTrack()`: phoneme events → 15-channel
    keyframe/sampled track. Attack 20–70 ms, release 35–130 ms,
    priority-weighted overlap blending, optional one-pole smoothing.
  - `types.ts` — `PhonemeEvent`, `PhraseFile` (`format: "phenomes.phrase"`),
    `VisemeTrack`, `CurveOptions`.
- `src/renderer/`
  - `viseme-driver.ts` — single mapping point: track or live values →
    `morphTargetInfluences`, with an optional name-remap table for rigs
    whose morphs aren't literally named `viseme_*`.
  - `test-head.ts` — procedural 1617-vertex head (jaw, nose, sockets) with
    all 15 morphs baked from a small parameter table; lip-colored mouth
    region plus an opening sticker and lip ring that track the morphs each
    frame (`mouthOffset` / `mouthScale`). Placeholder until a final
    character asset is chosen.
- `src/demo/speech-bridge.ts` — interim audio: wraps the browser's system
  TTS (`speechSynthesis`) and turns its per-word boundary events into a
  piecewise-linear `TimeMap` that remaps the voice's actual pacing onto the
  canned track, so sync can be judged by ear without any model. M2
  replaces this with HeadTTS through the same seam.
- `src/main.ts` — three.js demo: orbit controls, sample loader,
  play/pause/stop (resume re-speaks from the current word), 15-bar viseme
  meter, dominant-viseme readout, wireframe + sound toggles.
- `public/samples/` — canned phoneme timelines (hand-timed IPA; M2 will
  replace this source with real TTS timings).

## The 15 visemes (Oculus/Meta convention)

`aa, E, I, O, U` (vowels) · `PP, SS, TH, DD, FF, kk, nn, RR, CH`
(consonant classes) · `sil` — the set every modern avatar pipeline (Meta
avatars, Azure, HeadTTS/HeadAudio, OpenFaceFX) targets with one morph
target each, driven 0→1.

## The heuristic in one paragraph

For each phoneme event, map it to a viseme and raise that channel with a
raised-cosine attack-sustain-release envelope whose lengths scale with the
phoneme's duration. Where events overlap in time (natural co-articulation),
each channel's level is weighted by a Cohen–Massaro-style dominance
hierarchy (plosives > affricates > dental/fricatives > nasals/liquids >
vowels), so a "p" swallows its neighbor instead of both showing at full.
The result is smoothed with a one-pole low-pass and sampled to 60 fps. No
model, no audio analysis — just timing + a lookup table — which is why it
is the primary path when the spoken text is known (TTS output), with the
audio classifier (M3) reserved for mic/arbitrary audio.

## Licenses

- This repository: MIT (pending maintainer confirmation).
- `three.js` — MIT.
- **M2** will vendor code from **HeadTTS** (met4citizen, MIT) — the
  Kokoro-82M ONNX TTS with per-phoneme timestamps; model weights from
  `onnx-community/Kokoro-82M-v1.0-ONNX-timestamped` (license: check at
  fetch time; the community ONNX port of the Apache-2.0 Kokoro model).
- **M3** will vendor code from **HeadAudio** (met4citizen, MIT),
  including its `model-en-mixed.bin` classifier (MIT) as the starting
  point for retraining on our own TTS-generated labels.
- GPL-licensed tools (Bournemouth Forced Aligner, VisemeNet) are **not**
  used in this codebase; see the research doc for why.
