/**
 * B100 census classifier entries. Only "other" for live on-cast / special-action
 * systems that are not declarative replacements or static parses. Ichor, Pursuit,
 * Krark, and Stasis are marked handled via collect or static parse, not this list.
 */
export const LATE_BATCH_OTHER_SYSTEMS_B100: Array<[string, RegExp]> = [
  [
    'bestowCollectEvidence',
    /bestow[—\-].*collect evidence|collect evidence \d+.*bestow/i,
  ],
  [
    'blitzAdditionalCost',
    /\bblitz[—\-].*(?:pay \d+ life|discard (?:a|one) card)/i,
  ],
  [
    'circlingVulturesDiscard',
    /you may discard (?:this card|~) any time you could (?:cast|play) an instant/i,
  ],
  [
    'madnessPayLife',
    /\bmadness[\u2014\-]\s*(?:\{[^}]+\}\s*)*(?:,\s*)?pay \d+ life/i,
  ],
];
