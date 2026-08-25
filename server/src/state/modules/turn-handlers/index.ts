// server/src/state/modules/turn-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// server/src/state/modules/turn.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays server/src/state/modules/turn.ts ("./turn.js").

// Drains state.pending* delayed schedules into trigger descriptors at step boundaries.
export {
  dequeuePendingNextEndStepZoneChangeTriggers,
  dequeuePendingUpkeepGraveyardReturnTriggers,
  dequeuePendingUpkeepDrawTriggers,
  dequeuePendingEndOfCombatZoneChangeTriggers,
} from "./pendingDelayedTriggerDequeues.js";

// Cleanup-step body from nextStep(): discard, Sundial pause, damage clear, EOT expiry.
export { runTurnStepCleanup } from "./turnStepCleanup.js";

// Upkeep-step body from nextStep(): delayed dequeues, initiative, suspend, rebound.
export { runTurnStepUpkeep } from "./turnStepUpkeep.js";

// Draw-step body from nextStep(): beginning-of-draw triggers (Rule 504.1).
export { runTurnStepDraw } from "./turnStepDraw.js";

// Untap-step body from nextStep(): leaving-UNTAP permanents + Unwinding Clock.
export { runTurnStepUntap } from "./turnStepUntap.js";

// ResolutionQueue + legacy pending* cleanup used by nextStep / getPendingInteractions.
export { checkPendingInteractions } from "./checkPendingInteractions.js";

// Temporary retained-mana buckets (Horizon Stone / Omnath / until-end-of-combat).
export {
  TEMPORARY_RETAINED_MANA_COLORS,
  getTemporaryRetainedManaForPlayer,
  syncTemporaryRetainedManaToPool,
  clearTemporaryRetainedManaDuration,
} from "./turnTemporaryRetainedMana.js";

// Rule 106.4 empty mana at step/phase boundaries.
export { clearManaPool } from "./turnClearManaPool.js";

// Persist nextStep trigger/trigger-order events for replay.
export { persistTurnStepTriggeredAbility, persistTurnStepTriggerOrderStep } from "./turnStepTriggerPersist.js";

// nextStep phase/step progression (pre_game abort, extra combat, first strike).
export { computeNextStepPhaseAdvance } from "./turnStepPhaseAdvance.js";
export type { NextStepPhaseAdvance } from "./turnStepPhaseAdvance.js";

// APNAP trigger push used by nextStep via a thin wrapper.
export { pushTurnStepTriggersToStack } from "./turnStepPushTriggers.js";

// Active-player priority grant after step-entry triggers.
export { grantTurnStepPriority } from "./turnStepPriorityGrant.js";

// MAIN1 step-entry: Paradigm, Saga lore, attraction visit, rad, precombat triggers.
export { runTurnStepMain1 } from "./turnStepMain1.js";

// Rule 504.1 draw turn-based action (base + additional draws) from nextStep.
export { runTurnStepDrawTurnAction } from "./turnStepDrawTurnAction.js";

// until-next-turn grant/restriction expiry at the start of a player's turn.
export { removeExpiredUntilNextTurnEffects } from "./turnExpiredUntilNextTurnEffects.js";

// Rule 502.3 untap of a player's permanents (stun / doesn't-untap skips).
export { untapPermanentsForPlayer } from "./turnUntapPermanents.js";

// Combat-damage helpers extracted from dealCombatDamage.
export { getCombatCreatureStats, applyCombatDamagePreventionEffects } from "./turnCombatDamageStatsPrevention.js";
export {
  isCombatDamagePreventedForPermanent,
  modifyCombatDamageToPermanentAmount,
  applyCombatDamageToPlaneswalker,
} from "./turnCombatDamagePermanentApply.js";
export { applyLifeGainViaProcessLifeChange } from "./turnCombatDamageLifeGain.js";
export { queueDamageReceivedTrigger } from "./turnCombatDamageReceivedQueue.js";
export {
  syncLifeAndCheckDefeat,
  trackCommanderDamage,
  trackCreatureDamageToPlayer,
  didCreatureDealDamageToPlayer,
  getCreaturesThatDealtDamageToPlayer,
} from "./turnCombatDamageTracking.js";
export { applyDealCombatDamageAttackerLoop } from "./turnCombatDamageAttackerLoop.js";
export type { DealCombatDamageResult } from "./turnCombatDamageAttackerLoop.js";
export { applyDealCombatDamageTriggerQueue } from "./turnCombatDamageTriggerQueue.js";
export { pushCombatDamageTriggerQueueEntries } from "./turnCombatDamageTriggerPersist.js";
export type { CombatDamageTriggerQueueEntry } from "./turnCombatDamageTriggerPersist.js";

// nextTurn peels.
export { captureNextTurnLastTurnInterveningIfState } from "./turnNextTurnLastTurnCapture.js";
export { runNextTurnStartOfTurn } from "./turnNextTurnStartOfTurn.js";

// Extra turns/combats and scheduled steps.
export {
  scheduleStepsAfterCurrent,
  scheduleStepsAtEndOfTurn,
  clearScheduledSteps,
  getScheduledSteps,
  removeScheduledSteps,
  addExtraTurn,
  getExtraTurns,
  addExtraCombat,
  hasExtraCombat,
  consumeExtraCombat,
  skipExtraTurn,
} from "./turnScheduledStepsAndExtras.js";

export { passPriority } from "./turnPassPriority.js";
export { clearCombatState } from "./turnClearCombatState.js";
export { processPendingFlickerReturnsAtBeginningOfEndStep } from "./turnFlickerEndStepReturns.js";
