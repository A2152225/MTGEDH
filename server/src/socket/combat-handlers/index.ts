// server/src/socket/combat-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of server/src/socket/combat.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays server/src/socket/combat.ts ("./combat.js").

// "Is it a creature right now" plus attack/block legality predicates.
export {
  isCurrentlyCreature,
  hasEffectiveAbility,
  getTemporaryCombatAbilityTexts,
  isFullyUnblockableRestriction,
  getOracleTextForCombatGate,
  getControlledCreatureGateViolationForPermanent,
  canPermanentAttack,
  canBlockAttacker,
} from "./combatLegalityGates.js";

// declareBlockers socket request plus the chat/persist helpers it closed over.
export {
  handleDeclareBlockers,
  lookupBattlefieldPermanentName,
  emitDeclareBlockersChat,
  persistTriggeredAbilityPush,
} from "./combatDeclareBlockersRequest.js";

// declare-attackers support helpers (chat, defender ids, optional attack-trigger payment).
export {
  emitDeclareAttackersChat,
  formatEnergyCost,
  getDefendingPlayerIdFromAttackDeclaration,
  getOwnerAttackRestrictionReason,
  hasLegalMustAttackDefender,
  isAttackingOwnerPlaneswalker,
  processAttackTriggersAfterDeclaration,
  resolveAttackTriggerManaPaymentChoice,
  resolveDefendingPlayerIdForAttackTarget,
} from "./combatDeclareAttackersSupport.js";
export type { PendingAttackTriggerManaPayment } from "./combatDeclareAttackersSupport.js";
