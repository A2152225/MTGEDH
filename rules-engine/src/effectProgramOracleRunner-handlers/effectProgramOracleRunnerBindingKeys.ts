// Origin parent: rules-engine/src/effectProgramOracleRunner.ts
// Cluster moved: DerivedOracleIRContextBindings and LAST_* binding key constants.
// Public entry symbols: DerivedOracleIRContextBindings, LAST_GRANTED_GRAVEYARD_CARDS_BINDING,
// LAST_GRANTED_GRAVEYARD_PERMISSION_IDS_BINDING, LAST_ACTION_OUTCOME_BINDING,
// LAST_MOVED_CARDS_BINDING, LAST_REVEALED_CARD_COUNT_BINDING.
// Leaf must not import effectProgramOracleRunner.ts or effectProgramOracleRunner-handlers/index.ts.

export interface DerivedOracleIRContextBindings {
  targetCreatureId?: string;
  targetPermanentId?: string;
  targetSpellId?: string;
  lastClashWon?: boolean;
  selectorContext?: Record<string, unknown>;
}

export const LAST_GRANTED_GRAVEYARD_CARDS_BINDING = '__oracleLastGrantedGraveyardCards';
export const LAST_GRANTED_GRAVEYARD_PERMISSION_IDS_BINDING = '__oracleLastGrantedGraveyardPermissionIds';
export const LAST_ACTION_OUTCOME_BINDING = '__oracleLastActionOutcome';
export const LAST_MOVED_CARDS_BINDING = '__oracleLastMovedCards';
export const LAST_REVEALED_CARD_COUNT_BINDING = '__oracleLastRevealedCardCount';
