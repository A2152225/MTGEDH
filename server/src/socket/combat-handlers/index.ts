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

// Derived must-be-blocked-if-able declare-blockers legality (Lure / Shinen / Nemesis Mask grants).
export {
  attackerHasMustBeBlockedIfAble,
  findMustBeBlockedIfAbleViolation,
  resolveMustBeBlockedIfAbleAssignments,
} from "./combatMustBeBlockedIfAble.js";

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

// exert/enlist choice enqueue, goad status, forced-attack check, tap-on-attack triggers.
export {
  enqueueSupportedEnlistChoiceSteps,
  enqueueSupportedExertChoiceSteps,
  findForcedAttackViolation,
  getCreatureGoadStatus,
  processTapTriggersForAttackers,
} from "./combatDeclareAttackersForceTapSupport.js";

// executeDeclareAttackers (AI / paid-attack / resolution-queue path).
export { executeDeclareAttackers } from "./combatDeclareAttackersExecute.js";

// Combat control effect snapshot on game.state.combat.
export {
  getCombatControl,
  setCombatControl,
} from "./combatControlState.js";
export type { CombatControlEffect } from "./combatControlState.js";

// declareAttackers socket request.
export { handleDeclareAttackers } from "./combatDeclareAttackersRequest.js";

// declareControlledAttackers socket request (Master Warcraft and similar).
export { handleDeclareControlledAttackers } from "./combatDeclareControlledAttackersRequest.js";
