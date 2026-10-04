/**
 * The 15-viseme Oculus/Meta lip-sync convention — the de-facto industry
 * standard used by Meta avatars, Azure/Polly viseme streams, HeadTTS,
 * HeadAudio, OpenFaceFX, and our rig.
 *
 * IPA → viseme mapping is taken from HeadAudio Appendix A (MIT):
 * https://github.com/met4citizen/HeadAudio
 */

export const VISEMES = [
  'viseme_aa',
  'viseme_E',
  'viseme_I',
  'viseme_O',
  'viseme_U',
  'viseme_PP',
  'viseme_SS',
  'viseme_TH',
  'viseme_DD',
  'viseme_FF',
  'viseme_kk',
  'viseme_nn',
  'viseme_RR',
  'viseme_CH',
  'viseme_sil',
] as const;

export type VisemeId = (typeof VISEMES)[number];

export const VISeme_INDEX: Record<VisemeId, number> = Object.fromEntries(
  VISEMES.map((v, i) => [v, i]),
) as Record<VisemeId, number>;

export const NUM_VISEMES = VISEMES.length; // 15

const IPA_TO_VISEME: ReadonlyArray<readonly [string, VisemeId]> = [
  // --- low / open vowels → aa ---
  ['aa', 'viseme_aa'], ['a', 'viseme_aa'], ['aː', 'viseme_aa'],
  ['ɑ', 'viseme_aa'], ['ɑː', 'viseme_aa'], ['ɐ', 'viseme_aa'],
  ['aɪ', 'viseme_aa'], ['aʊ', 'viseme_aa'], ['ä', 'viseme_aa'],
  // --- mid vowels → E ---
  ['E', 'viseme_E'], ['ɛ', 'viseme_E'], ['ɛː', 'viseme_E'],
  ['e', 'viseme_E'], ['eː', 'viseme_E'], ['eɪ', 'viseme_E'],
  ['œ', 'viseme_E'], ['œː', 'viseme_E'], ['ɜ', 'viseme_E'],
  ['ɜː', 'viseme_E'], ['ʌ', 'viseme_E'], ['ə', 'viseme_E'],
  ['əː', 'viseme_E'], ['ɚ', 'viseme_E'], ['ɘ', 'viseme_E'], ['æ', 'viseme_E'],
  // --- close front → I ---
  ['I', 'viseme_I'], ['i', 'viseme_I'], ['iː', 'viseme_I'],
  ['ɪ', 'viseme_I'], ['ɨ', 'viseme_I'], ['y', 'viseme_I'],
  ['yː', 'viseme_I'], ['ʏ', 'viseme_I'],
  // --- back rounded → O ---
  ['O', 'viseme_O'], ['o', 'viseme_O'], ['oː', 'viseme_O'],
  ['ɔ', 'viseme_O'], ['ɔː', 'viseme_O'], ['ɒ', 'viseme_O'],
  ['ø', 'viseme_O'], ['øː', 'viseme_O'],
  ['oʊ', 'viseme_O'], ['oːʊ', 'viseme_O'],
  // --- close back → U ---
  ['U', 'viseme_U'], ['u', 'viseme_U'], ['uː', 'viseme_U'],
  ['ʊ', 'viseme_U'], ['ʊː', 'viseme_U'], ['ɯ', 'viseme_U'],
  ['ɯː', 'viseme_U'], ['ɤ', 'viseme_U'],
  // --- bilabial plosives/nasal → PP ---
  ['P', 'viseme_PP'], ['p', 'viseme_PP'], ['b', 'viseme_PP'],
  ['m', 'viseme_PP'],
  // --- sibilants + glottal → SS ---
  ['S', 'viseme_SS'], ['s', 'viseme_SS'], ['z', 'viseme_SS'],
  ['ʃ', 'viseme_SS'], ['ʒ', 'viseme_SS'], ['ɕ', 'viseme_SS'],
  ['ʑ', 'viseme_SS'], ['ç', 'viseme_SS'], ['ʝ', 'viseme_SS'],
  ['x', 'viseme_SS'], ['ɣ', 'viseme_SS'], ['h', 'viseme_SS'],
  // --- dental → TH ---
  ['TH', 'viseme_TH'], ['θ', 'viseme_TH'], ['ð', 'viseme_TH'],
  // --- alveolar stop → DD ---
  ['D', 'viseme_DD'], ['t', 'viseme_DD'], ['d', 'viseme_DD'],
  // --- labiodental → FF ---
  ['F', 'viseme_FF'], ['f', 'viseme_FF'], ['v', 'viseme_FF'],
  // --- velar stop → kk ---
  ['K', 'viseme_kk'], ['k', 'viseme_kk'], ['g', 'viseme_kk'],
  ['q', 'viseme_kk'], ['ɢ', 'viseme_kk'],
  // --- nasals → nn ---
  ['N', 'viseme_nn'], ['n', 'viseme_nn'], ['ŋ', 'viseme_nn'],
  ['ɲ', 'viseme_nn'], ['ɳ', 'viseme_nn'], ['m̩', 'viseme_nn'],
  // --- liquids / approximants → RR ---
  ['R', 'viseme_RR'], ['ɹ', 'viseme_RR'], ['r', 'viseme_RR'],
  ['ɾ', 'viseme_RR'], ['ɽ', 'viseme_RR'], ['l', 'viseme_RR'],
  ['ɫ', 'viseme_RR'], ['j', 'viseme_RR'], ['w', 'viseme_RR'],
  // --- affricates → CH ---
  ['CH', 'viseme_CH'], ['tʃ', 'viseme_CH'], ['dʒ', 'viseme_CH'],
  ['ts', 'viseme_CH'], ['dz', 'viseme_CH'],
  // --- silence ---
  ['sil', 'viseme_sil'], ['SIL', 'viseme_sil'],
  // --- Oculus viseme names (M2: HeadTTS emits these directly as `p`,
  //     so they pass straight through to buildTrack()). aa/E/I/O/U/TH/CH
  //     are already mapped above. ---
  ['PP', 'viseme_PP'], ['SS', 'viseme_SS'],
  ['DD', 'viseme_DD'], ['FF', 'viseme_FF'], ['kk', 'viseme_kk'],
  ['nn', 'viseme_nn'], ['RR', 'viseme_RR'],
];

const IPA_MAP: Map<string, VisemeId> = new Map(IPA_TO_VISEME);

/**
 * Map an IPA phoneme string to its Oculus viseme.
 * Falls back to stripping diacritics (length marks, etc.), then to
 * `viseme_sil` for anything unknown (e.g. stress marks, "SIL", numbers).
 */
export function phonemeToViseme(phoneme: string): VisemeId {
  const key = phoneme.trim();
  let v = IPA_MAP.get(key);
  if (v !== undefined) return v;
  // retry without length mark ː and other combining diacritics
  const stripped = key.replace(/[ːˈˌ]/g, '');
  v = IPA_MAP.get(stripped);
  if (v !== undefined) return v;
  if (/^[0-9 ]*$/.test(key)) return 'viseme_sil';
  return 'viseme_sil';
}

/**
 * Cohen–Massaro-style dominance priorities: when two visemes overlap in
 * time, the higher-priority one is shown more fully and the lower one is
 * scaled down. Plosives dominate vowels, affricates dominate fricatives, etc.
 * (values are relative, only ordering matters)
 */
export const PRIORITY: Record<VisemeId, number> = {
  viseme_PP: 10,
  viseme_CH: 9,
  viseme_kk: 8,
  viseme_DD: 8,
  viseme_TH: 7,
  viseme_FF: 7,
  viseme_SS: 6,
  viseme_nn: 5,
  viseme_RR: 4,
  viseme_aa: 3,
  viseme_E: 3,
  viseme_I: 3,
  viseme_O: 3,
  viseme_U: 3,
  viseme_sil: 0,
};

/**
 * Target amplitude per viseme at full activation (< 1 for subtle shapes).
 * Lets a "small" viseme (DD, nn) sit at a lower baseline than a full "aa".
 */
export const AMPLITUDE: Record<VisemeId, number> = {
  viseme_aa: 1.0,
  viseme_E: 0.8,
  viseme_I: 0.65,
  viseme_O: 0.8,
  viseme_U: 0.85,
  viseme_PP: 0.9,
  viseme_SS: 0.7,
  viseme_TH: 0.6,
  viseme_DD: 0.55,
  viseme_FF: 0.6,
  viseme_kk: 0.6,
  viseme_nn: 0.55,
  viseme_RR: 0.6,
  viseme_CH: 0.7,
  viseme_sil: 0.0,
};
