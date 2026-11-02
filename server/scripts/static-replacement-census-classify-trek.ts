/**
 * R32: Star Trek (trk/trc) census classifier entries (kept out of static-replacement-census-classify.ts for size).
 * Lines are lowercased with the card name replaced by "~" before matching.
 */
export const TREK_OTHER_SYSTEMS: Array<[string, RegExp]> = [
  ['assimilate keyword action (oracleIRParserAssimilateLowering)', /^assimilate\b/i],
  ['strange new worlds count basis (trekCountBases)', /\bnumber of differently named lands you control\b/i],
  ['federation count basis (trekCountBases)', /\bnumber of creature types among non-borg creatures you control\b/i],
  ['cloaking device type removal (staticEffectSpecOracleParsingTrekStatics)', /^(?:enchanted|equipped) (?:creature|permanent|artifact)[^.]*\bisn't a creature\b/i],
  ['saga reminder text fragment', /^step, add a lore counter\. sacrifice after [ivx]+\.?\)$/i],
];

/** Station lines ("9+ | ...") are gated text for the remainder; strip the threshold so triggers classify as triggers. */
export function stripStationThresholdPrefix(line: string): string {
  return String(line || '').replace(/^\s*\d+\+\s*\|\s*/, '');
}
