# Avatar assets

- `julia.glb` (identical to `brunette.glb` in met4citizen/TalkingHead) and
  `david.glb` — realistic Ready Player Me avatars (head, teeth, beard, hair,
  body), vendored from [met4citizen/HeadAudio](https://github.com/met4citizen/HeadAudio)
  (`avatars/`, repo license MIT) on 2026-10-04.
  - `julia.glb`: SHA-256 `8864c504b5c11daa2f0037afffdc0815bb0fa2e6062e37a584746116a3c2f538`
  - `david.glb`: SHA-256 `2875f23a2da5960fd860b0a1106e309a027226367e6c48761868426d16502b8e`

  **Texture quirk:** RPM ships these with solid-color *placeholder*
  textures (2×2 skin, 64×64 solid-black eyes, 128×128 solid-black teeth).
  The geometry + 72 morph targets per face mesh are the real deal, but the
  face renders featureless out of the box — `glb-head.ts` detects those
  placeholder maps at load and swaps in procedurally generated ones (sclera
  + iris + pupil for the eyes, ivory for the teeth).

- `mpfb.glb` — a fully textured Blender/MPFB female character (face albedo,
  brown iris, teeth, tongue, ponytail, casual suit), vendored from
  [met4citizen/TalkingHead](https://github.com/met4citizen/TalkingHead)
  (`avatars/`, repo license MIT) on 2026-10-05. The best option for judging
  viseme/jaw deformation quality: real facial detail, and the only
  permissively licensed avatar here.
  - `mpfb.glb`: SHA-256 `63c645a2a863b9972e9a9c2ed576a1de4c390b8475508e1473e69c87a3ee299c`

**Model licenses (the 3D assets, not the repos):**
- julia/david: created at
  [Ready Player Me](https://readyplayer.me) (GLB `asset.generator = "Ready
  Player Me"`). Per met4citizen's own attribution for the identical model
  (TalkingHead README): *"free to all developers for non-commercial use
  under the CC BY-NC 4.0 deed"*
  (https://creativecommons.org/licenses/by-nc/4.0/). **Non-commercial.**
- mpfb: created with [Blender](https://www.blender.org/) + the
  [MPFB](https://static.makehumancommunity.org/mpfb.html) extension. Per the
  TalkingHead README: *"The avatar is licensed under CC0"*
  (https://creativecommons.org/public-domain/cc0/). **Public domain —
  unrestricted, no attribution required.**

Consequence: phenomes must stay non-commercial while julia.glb / david.glb
are vendored. A commercial build can simply drop those two and keep `mpfb.glb`
(CC0).

**Morph conventions:**
- RPM (julia/david): morph target names in `mesh.extras.targetNames` (array
  parallel to `primitives[].targets`); three.js GLTFLoader ≥ r155 reads that
  into `morphTargetDictionary` automatically. Each face mesh (head, teeth,
  beard, eyes) carries 72 morphs: `mouthOpen` + the 15 Oculus visemes
  (`viseme_sil, viseme_PP, … viseme_U`) + 56 ARKit face units.
- MPFB (mpfb): same `targetNames` convention. The face mesh (`base`) carries
  66 morphs: 14 of the 15 Oculus visemes (`viseme_sil` absent — the rest
  no-op, fine) + 52 ARKit-style face units (incl. `jawOpen`, `eyeBlink*`);
  the eye mesh (`high-poly`) carries 8 `eyeLook*` morphs; teeth/tongue carry
  a subset of 8 viseme names each (aa, PP, DD, TH, E, O, kk, nn).
