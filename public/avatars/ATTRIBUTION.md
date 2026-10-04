# Avatar assets

- `julia.glb` (identical to `brunette.glb` in met4citizen/TalkingHead) and
  `david.glb` — realistic Ready Player Me avatars (head, teeth, beard, hair,
  body), vendored from [met4citizen/HeadAudio](https://github.com/met4citizen/HeadAudio)
  (`avatars/`, repo license MIT) on 2026-10-04.
  - `julia.glb`: SHA-256 `8864c504b5c11daa2f0037afffdc0815bb0fa2e6062e37a584746116a3c2f538`
  - `david.glb`: SHA-256 `2875f23a2da5960fd860b0a1106e309a027226367e6c48761868426d16502b8e`

**Model license (the 3D assets, not the repos):** the avatars were created at
[Ready Player Me](https://readyplayer.me) (GLB `asset.generator = "Ready
Player Me"`). Per met4citizen's own attribution for the identical model
(TalkingHead README): *"free to all developers for non-commercial use under
the CC BY-NC 4.0 deed"* (https://creativecommons.org/licenses/by-nc/4.0/).

Consequence: phenomes must stay non-commercial while these files are
vendored. If that changes, swap in a permissive asset (e.g. the CC0
`mpfb.glb` from TalkingHead) or a self-made Ready Player Me avatar.

**Morph convention:** Ready Player Me stores morph target names in
`mesh.extras.targetNames` (an array parallel to `primitives[].targets`).
three.js GLTFLoader ≥ r155 reads that into `morphTargetDictionary`
automatically. Each face mesh (head, teeth, beard, eyes) carries 72 morphs:
`mouthOpen` + the 15 Oculus visemes (`viseme_sil, viseme_PP, … viseme_U`) +
56 ARKit face units. Morphs are relative deltas (`morphTargetsRelative =
true`), the standard GLTF convention.
