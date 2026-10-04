# Viseme ("Phenome") Generation — Research Notes

Date: 2026-10-04 · Status: research complete, awaiting plan decision

Terminology note: what we've been calling **phenomes** are standardly called
**visemes** — the visual mouth shape associated with a spoken sound. A
*phoneme* is the sound unit; the *viseme* is what the mouth looks like while
making it. The industry also has a *phoneme* API convention (Azure's synthesis
API literally emits `viseme_id` events). This doc uses **viseme**.

**Goals this research was asked to answer**

1. Are there existing viseme/phoneme models that can run locally?
2. Beyond "sophisticated" (deep-learning) methods, are there simpler heuristics?

**User constraints added later (dominate the ranking):** generate visemes
**locally, in the browser**; prioritize **simplicity, low latency, real-time**.

---

## 0. TL;DR

- **Yes, local models exist, and two of them are fully in-browser, real-time,
  MIT-licensed, and deliberately simple.**
  - **HeadAudio** (met4citizen) — audio → visemes in an AudioWorklet. Not a
    deep net: MFCC features + Gaussian prototypes + Mahalanobis distance.
    ~14 kB model, <0.1 ms per 128-sample block, ~50 ms end-to-end latency,
    zero dependencies, pre-trained model included, and a documented ~30-second
    retraining recipe.
  - **HeadTTS** (met4citizen) — the *Azure pattern, but local and in-browser*:
    Kokoro-82M ONNX TTS (WebGPU/WASM) that emits audio **plus per-phoneme
    timestamps and Oculus visemes** in one pass. The TTS itself is the
    viseme generator, exactly like Azure's.
- **Simpler heuristics absolutely exist and are the industry norm for
  real-time work.** The spectrum, simplest → most sophisticated:
  1. energy/loudness → jaw-open (a few lines of Web Audio),
  2. phoneme→viseme lookup tables + duration heuristics (no ML at all —
     OpenFaceFX does this deterministically; Rhubarb does the energy variant),
  3. statistical audio classifier (HeadAudio — the middle ground),
  4. small CNN on spectrograms (VisemeNet),
  5. heavy learned full-face models (NVIDIA Audio2Face — local but not
     browser-friendly, CUDA-oriented).
- **Key insight:** when the speech is TTS (we *know* the text), the
  *phoneme-driven* route (option 2/3 above, fed by the TTS's own phoneme
  timings) is simultaneously the **simplest and the most accurate** — there is
  no need to re-derive mouth shapes from audio. Audio-driven classification is
  only needed for **arbitrary/unknown audio** (mic, recorded voice).
- The de-facto output convention across all of these is the **15-viseme
  Oculus/Meta lip-sync set** (see §1), which maps cleanly onto morph targets /
  blendshapes. Everything converges there, so our "our model" integration is
  format-agnostic.

---

## 1. The de-facto viseme set (what everything maps to)

All practical systems (Meta/Oculus, Azure, AWS Polly per community adapters,
HeadTTS, HeadAudio, OpenFaceFX) use the **15-viseme Oculus/Meta convention**:
5 vowels + 9 consonant groups + silence. Documented IPA→viseme mapping
(from HeadAudio Appendix A):

| ID | Viseme | Shape | IPA phonemes grouped |
|----|--------|-------|----------------------|
| 0 | `viseme_aa` | open / low | a, aː, ɑ, ɑː, ɐ, aɪ, aʊ, ä |
| 1 | `viseme_E` | mid front + central | ɛ, e, eɪ, œ, ɜ, ʌ, ə, ɚ, ɘ |
| 2 | `viseme_I` | close front | i, iː, ɪ, ɨ, y, yː, ʏ |
| 3 | `viseme_O` | mid back | o, oː, ɔ, ɒ, ø |
| 4 | `viseme_U` | close back | u, uː, ʊ, ɯ, ɤ |
| 5 | `viseme_PP` | bilabial plosives | p, b, m |
| 6 | `viseme_SS` | sibilant fricatives | s, z, ʃ, ʒ, ɕ, ʑ, ç, x, ɣ, h |
| 7 | `viseme_TH` | dental | θ, ð |
| 8 | `viseme_DD` | alveolar stop | t, d |
| 9 | `viseme_FF` | labiodental | f, v |
| 10 | `viseme_kk` | velar stop | k, g, q |
| 11 | `viseme_nn` | nasal | n, ŋ, ɲ |
| 12 | `viseme_RR` | liquid / approximant | r, ɹ, ɾ, l, j, w |
| 13 | `viseme_CH` | affricate | tʃ, dʒ, ts, dz |
| 14 | `viseme_sil` | silence | (none) |

Each viseme = one morph target / blendshape on the character rig, driven
0→1 with easing. This is the integration surface regardless of which
generation method we pick.

---

## 2. Question 1 — Existing models that run locally

### 2.1 TTS-native: the synthesis engine emits visemes alongside audio (the Azure pattern)

This is the approach Azure uses: request synthesis with an SSML
`<mstts:viseme type="redlips_front"/>` tag and the SDK fires
`viseme_received` events carrying `audio_offset` + `viseme_id` in the same
stream as the audio (community reference implementation:
[jetfontanilla/azure-viseme-json](https://github.com/jetfontanilla/azure-viseme-json) —
`speech_synthesizer.viseme_received.connect(cb)`). AWS Polly has an equivalent
viseme event stream. Both are **cloud** services, but they define the pattern.

Local/in-browser equivalents:

| Project | What it is | Runs where | Notes |
|---|---|---|---|
| **[HeadTTS](https://github.com/met4citizen/HeadTTS)** (181★, MIT) | Kokoro-82M ONNX TTS (**timestamped** variant from HuggingFace `onnx-community/Kokoro-82M-v1.0-ONNX-timestamped`) | **In-browser (WebGPU or WASM)**, or Node.js WS/REST server (WebGPU/CPU) | Returns `audio` + per-phoneme timestamps (`ps[].t/.d`) + visemes + word timings in one call. RTF < 1 (well faster than real-time on a laptop per README benchmarks; WASM fallback slower). English only today. MIT stack — explicitly **no eSpeak/GPL**. This is the closest thing to "Azure, but 100% local in the browser." |
| Piper / Coqui-TTS / other open TTS | Most open TTS expose **phoneme lists with durations** | local (Node/Python/CPU) | One more mapping step (phoneme→viseme) to finish the pipeline; heavier to set up than HeadTTS. |

### 2.2 Audio-driven: audio in → visemes out (no text required)

| Project | What it is | Runs where | Notes |
|---|---|---|---|
| **[HeadAudio](https://github.com/met4citizen/HeadAudio)** (MIT, 2025–26) | **AudioWorklet processor**: pre-emphasis → downsample to 16 kHz → MFCC (12 coeff, 512-sample frames/256 hop) → **Gaussian-prototype classifier with Mahalanobis distance** → 15 Oculus viseme values with easing | **Fully in-browser**, real-time; works on any audio node (TTS output, mic, file) | **~14 kB `.bin` model** (pre-trained, English mixed voices). Measured <0.1 ms per 128-sample block; ~50 ms end-to-end viseme latency. Zero dependencies. Retraining is documented: generate labeled audio with HeadTTS (~10 min per voice), compile prototypes in ~30 s. Author's honest caveat: VAD/accuracy is good-not-great at low SNR, and audio-driven is inherently less accurate than text-driven. |
| **[Amoner/lipsync-engine](https://github.com/Amoner/lipsync-engine)** (66★, MIT, 2026) | Zero-dependency, renderer-agnostic **streaming** lip-sync for 2D browser animation; real-time viseme detection via AudioWorklet + Web Audio API | In-browser | Newer/smoaller than HeadAudio; 2D-oriented but the detection core is portable. |
| **[VisemeNet](https://github.comyzhou359/VisemeNet_tensorflow)** (197★, **GPL-3.0**, 2016) | Small CNN over log-mel spectrograms → 8 viseme classes (trained on LJSpeech) | CPU (Python; various inference ports) | The classic "small ML model" answer to Q1. Works fine locally, but GPL, older, and less accurate than the text-driven route; not browser-native (no maintained TF.js port found). |
| **[NVIDIA Audio2Face](https://developer.nvidia.com/audio2face)** | Learned model: audio features → **full 52-ARKit-morph + eye/head** animation | Local (Windows/CUDA; CPU works but slow) | Highest *quality* of the audio-driven family, but: **not** browser-based, GPU-hungry, free **non-commercial only**. The "sophisticated" pole of Q1 — included for contrast, not as a recommended path. |

### 2.3 Forced aligners (text + audio → precise phoneme timings; offline/precompute)

Useful when we have recorded or TTS audio and want *measured* (not predicted)
phoneme timings:

| Project | Speed | Notes |
|---|---|---|
| **[Bournemouth Forced Aligner (BFA)](https://github.com/tabahi/bournemouth-forced-aligner)** (167★, **GPLv3**) | **~0.2 s to align 10 s of audio on CPU** (≈50× real-time) | 80+ languages via espeak-ng phonemes; JSON/Praat output; arXiv 2509.23147; v1.1 (Feb 2026) added silence anchoring + confidence flags. Very fast, very local. |
| **Montreal Forced Aligner** / **Gentle** / **NVIDIA NeMo FA** | real-time-ish, heavier setup | The standards; Kaldi/wav2vec2-based; more moving parts; OpenFaceFX wraps MFA/Gentle/Whisper rather than reimplementing. |

### 2.4 G2P (text → phonemes, no audio at all)

The deterministic front-half of every phoneme-driven pipeline:

- **espeak-ng** — local G2P for 100+ languages (also a WASM port for browsers).
- **CMUdict + rule fallback** — what **HeadTTS** and **OpenFaceFX** bundle for
  English (OpenFaceFX warns which words fell through to rules and emits a
  reviewable dictionary of guesses).
- **g2pMFA / englist / phonemizer** — Python G2P stacks, more accuracy, less portable.

### 2.5 Ready-made consumers (for reference / possible reuse)

- **[TalkingHead](https://github.com/met4citizen/TalkingHead)** (1310★, MIT) —
  three.js rigged 3D avatar; consumes the Oculus viseme morph names directly
  (`viseme_aa` … `viseme_sil`); real-time in-browser; used in production apps
  (EdgeSpeaker, DialogLab, etc.). The natural "render side" companion to
  HeadTTS/HeadAudio.
- [AntiAnti/MetahumVisemeCurves](https://github.com/AntiAnti/MetahumVisemeCurves)
  — viseme pose assets for MetaHuman (Unreal) rigs.
- [jetfontanilla/canvas-talking-head-model](https://github.com/jetfontanilla/canvas-talking-head-model)
  — 2D canvas talking head driven by Azure viseme JSON.

---

## 3. Question 2 — Simpler heuristics (beyond sophisticated modeling)

Yes — and for **real-time in-browser** work, the simple heuristics are what the
industry actually ships. Ranked from simplest to most sophisticated:

### 3.1 Energy / loudness-driven (a few lines of code)
RMS energy envelope → one "jaw open" blendshape (optionally spectral tilt /
low-band content → lip rounding). This is the SALSA/Moho/Live2D "amplitude
fallback" — see OpenFaceFX's `energy` mode ("no models (SRT supplies its own
transcript…)… amplitude fallback in the spirit of SALSA/Moho/Live2D").
**Simplest possible, truly real-time (AnalyserNode), but coarse**: it never
distinguishes "s" from "p", so it only looks convincing at distance / on
stylized characters.

### 3.2 Deterministic phoneme→viseme mapping (no ML anywhere)
Text → G2P (dictionary + rules) → phonemes with **duration heuristics** (prior
durations per phoneme, stretched to fit the utterance) → 15-viseme table →
blendshape keyframes with attack/decay easing + **co-articulation blending**
(Cohen–Massaro-style dominance hierarchy so a plosive "swallows" the
neighboring vowel). **[OpenFaceFX](https://github.com/OpenFaceFX/OpenFaceFX)**
(MIT, numpy-only, alpha, 2026) is exactly this, productized: `naive` mode
needs *no models and no downloads* (`text + duration → viseme track`), has
`from-timing` mode that consumes **Azure/Polly viseme streams, Piper, espeak
`.pho`** directly (skip any aligner), an `mfa`/`gentle`/`whisper` adapter for
measured timings, and exporters for glTF, VRM, Live2D, Godot, Unity, Unreal,
Spine, Rhubarb TSV. Its Studio even runs **in-browser via Pyodide**. It is a
batch/precompute tool, not a real-time stream — but the G2P→viseme→curve math
is exactly the simple core we can port to JS.

### 3.3 Rhubarb-style audio cues (batch heuristic, famous)
[Rhubarb LipSync](https://github.com/DanielSWolf/rhubarb-lip-sync) — the
classic free offline tool: audio energy + optional transcript → 8 viseme
cues (A, B, F, I, L, O, R, U) as TSV, feeding 2D/3D mouth rigs. Not streaming
and not in-browser, but the algorithm is trivially simple and its TSV is the
other de-facto exchange format.

### 3.4 Statistical audio classifier (HeadAudio) — the practical middle ground
Not a deep net and not a dumb threshold: **12-dim MFCC vs. ~50 Gaussian
prototypes, Mahalanobis distance, argmin** — a classic 1990s pattern
recognizer that happens to be perfect for real-time browser audio threads
(<0.1 ms/block, 14 kB, no deps). This is the answer to "is there something
simpler than VisemeNet/Audio2Face that still *looks* phoneme-like": **yes**.

### 3.5 Learned models (for contrast)
VisemeNet (small CNN, local, GPL) and NVIDIA Audio2Face (full-face, CUDA,
non-commercial) sit at the "sophisticated" end. Nothing we need for the
stated priorities, but they're the quality ceiling if the character ever needs
full-face animation from arbitrary audio.

### Practical quality/effort hierarchy for *our* case

| Speech source | Best fit | Why |
|---|---|---|
| **TTS (we know the text)** | **phoneme-driven** (TTS's own phoneme/viseme timings → viseme table → eased blendshapes) | Simplest code, *most accurate possible* (it's the ground truth the audio was made from), zero classification error, zero audio processing. |
| **Mic / arbitrary audio** | **audio-driven** (HeadAudio-style MFCC+Mahalanobis worklet) | Only viable approach without text; ~50 ms latency, good at normal SNR. |
| **Offline pre-baked clips** | deterministic G2P+duration (OpenFaceFX-style) or aligner-based (BFA) | Can spend more computation per utterance; highest offline polish. |

---

## 4. Comparison matrix (against our stated priorities)

| Option | Local | In-browser | Real-time / latency | Needs text? | ML complexity | Size | License | Maturity |
|---|---|---|---|---|---|---|---|---|
| **HeadTTS** (Kokoro, TTS+visemes) | ✅ | ✅ (WebGPU/WASM) | ✅ (RTF < 1; streams) | yes (it's TTS) | 82M-param TTS (opaque but *produces* visemes, no extra classifier) | ~100s MB model | MIT | 181★, production apps |
| **HeadAudio** (worklet classifier) | ✅ | ✅ | ✅ **~50 ms** | no (any audio) | **none** (Gaussian prototypes) | **14 kB** | MIT | small but real, tested on 4 browsers + mobile |
| **OpenFaceFX** (deterministic G2P) | ✅ | ⚠️ (Pyodide Studio) | batch/precompute, not streaming | yes | **none** | ~0 (numpy-only) | MIT | alpha (Jul 2026) |
| **Amoner/lipsync-engine** | ✅ | ✅ | ✅ | no | low | tiny | MIT | new (2026), 66★ |
| **Rhubarb** | ✅ | ❌ (CLI) | batch | optional | none (energy+rules) | tiny | free/source | decade-old standard |
| **BFA aligner** | ✅ | ❌ (Python) | 50× real-time, offline | yes | medium (wav2vec2-ish) | ~100s MB | **GPLv3** | 167★, v1.1 2026 |
| **VisemeNet** | ✅ | ❌ | near-RT on CPU | no | small CNN | ~MB | **GPL-3.0** | 197★, 2016 |
| **NVIDIA Audio2Face** | ✅ | ❌ | ~RT on GPU | no | heavy (GRU/transformer) | GB-class | non-commercial | commercial product |
| Azure/Polly viseme stream | ❌ (cloud) | via SDK | ✅ | yes | opaque | — | proprietary | mature |

---

## 5. Assessment against the stated priorities

> "Generate visemes **locally in the browser**; if viseme generation is a
> sufficiently simple task, prioritize **simplicity, low latency, real-time**."

1. **Viseme generation *is* a simple task** — the phoneme→viseme mapping is a
   lookup table plus easing; even the audio-driven version is a 12-feature
   nearest-Gaussian classifier, not a neural net. Nothing here requires a GPU
   or a server.
2. **Best architecture for us (recommended direction):**
   - **Primary path — phoneme-driven:** text → local TTS in the browser
     (**HeadTTS/Kokoro**, WebGPU) → its per-phoneme timestamps + visemes →
     map to the 15 Oculus viseme morphs with easing/co-articulation → drive
     the character's mouth. One MIT-licensed stack, all in-browser, TTS is
     already >4× faster than real-time, so visemes never wait on synthesis.
   - **Fallback path — audio-driven:** the **HeadAudio** worklet in parallel
     (or instead), so *any* audio source (mic, third-party TTS, playback)
     still gets lip-sync with ~50 ms latency, no text needed.
   - Both paths converge on the **same 15-viseme morph targets** — one rig,
     two generators, swappable.
3. **What we can drop for these priorities:** Audio2Face (not browser,
   non-commercial), VisemeNet (GPL, older, redundant given HeadAudio), MFA
   (heavy; BFA is the lighter aligner *if* we ever need measured alignments
   offline), and raw-energy jaw-only (too coarse — keep only as a last-resort
   fallback).

---

## 6. Open decisions (to settle before/while planning)

1. **Speech source**: local in-browser TTS (HeadTTS/Kokoro) · existing Azure
   TTS (cloud audio + local visemes from text) · mic/arbitrary audio · all of
   the above (design for both paths)?
2. **Primary generation approach**: phoneme-driven (TTS timings → table →
   blendshapes) · audio-driven (HeadAudio-style worklet) · deterministic G2P
   heuristic (no audio) · hybrid · or "build a live demo first, then decide"?
3. **Character / output format**: three.js + Oculus viseme morph targets
   (TalkingHead-style) · glTF/VRM asset with morph targets · Live2D/2D ·
   other engine? (OpenFaceFX-style exporters exist for all of them, so the
   generator stays reusable.)

---

## Sources

- HeadTTS — https://github.com/met4citizen/HeadTTS (README: Kokoro-82M
  ONNX-timestamped, WebGPU/WASM/Node, benchmark table)
- HeadAudio — https://github.com/met4citizen/HeadAudio (README: MFCC +
  Gaussian prototypes + Mahalanobis; Appendix A viseme table; Appendix C
  performance numbers; training recipe)
- TalkingHead — https://github.com/met4citizen/TalkingHead
- OpenFaceFX — https://github.com/OpenFaceFX/OpenFaceFX (README: naive/mfa/
  from-timing/energy modes; Oculus 15-viseme; exporter matrix; Pyodide Studio)
- Azure viseme usage example —
  https://github.com/jetfontanilla/azure-viseme-json (`mstts:viseme` +
  `viseme_received`)
- Bournemouth Forced Aligner — https://github.com/tabahi/bournemouth-forced-aligner
  (arXiv:2509.23147)
- VisemeNet — https://github.com/yzhou359/VisemeNet_tensorflow
- Rhubarb Lip Sync — https://github.com/DanielSWolf/rhubarb-lip-sync
- Amoner lipsync-engine — https://github.com/Amoner/lipsync-engine
- NVIDIA Audio2Face — https://developer.nvidia.com/audio2face
