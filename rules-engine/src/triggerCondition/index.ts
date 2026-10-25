// rules-engine/src/triggerCondition/index.ts
// Named re-exports for the shared trigger-condition IR.
// No implementations, no `export *`.

export type {
  TriggerCastZone,
  TriggerConditionAlternative,
  TriggerConditionEvent,
  TriggerConditionIR,
  TriggerControllerRelation,
  TriggerMatchContext,
  TriggerMatchPermanent,
  TriggerMatchSource,
  TriggerOrdinal,
  TriggerSourceRelation,
  TriggerSubjectFilter,
  TriggerSubjectGroup,
  TriggerTargetRelation,
  TriggerTokenRestriction,
  TriggerWhoseTurn,
} from './types.js';

export { parseDiesSubjectClause } from './parseDiesSubject.js';
export { parseSubjectPhrase, TRIGGER_SUBJECT_KEYWORDS } from './parseSubjectPhrase.js';
export {
  parseAttacksSubjectClause,
  parseBecomesTappedSubjectClause,
  parseBecomesUntappedSubjectClause,
  parseBlocksSubjectClause,
  parseEntersSubjectClause,
  parsePhaseTriggerClause,
  parseSpellCastClause,
  parseTriggerEventSentence,
  parseTriggerClause,
  splitTriggerEffectRiders,
  printedKeywordDeathAbilities,
} from './parseFamilies.js';
export type { ParsedTriggerEventSentence, ParsedTriggerClause, TriggerDelayedRider, TriggerReflexiveRider } from './parseFamilies.js';
export { triggerConditionMatches } from './match.js';
export { normalizeSelfNameInTriggerSentence, selfNameVariants } from './selfNameNormalize.js';
