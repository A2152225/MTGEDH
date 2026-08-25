// server/src/socket/util.ts
// Socket helper utilities used by server socket handlers.
// Provides: ensureGame (create/replay), broadcastGame, appendGameEvent,
// priority timer scheduling (schedulePriorityTimeout + doAutoPass),
// clearPriorityTimer, parseManaCost helper, and transformDbEventsForReplay.
//
// This is a full-file authoritative implementation (no truncation).
//
// NOTE: Small, safe additions: normalizeViewForEmit + ensureStateZonesForPlayers
// and env-gated verbose logging when DEBUG_STATE=1.

import type { Server } from "socket.io";
import type { InMemoryGame } from "../state/types.js";
import type { PlayerID, ManaPool } from "../../../shared/src/index.js";
import { debug } from "../utils/debug.js";
import {
  pendingAutomationResumeTimers,
  clearScheduledHumanAutoPass,
  clearScheduledAutomationResume,
} from "./util-handlers/autoPassTimerState.js";
import { ts } from "./util-handlers/repairMissingPriorityIfStuck.js";
import { runCheckAndTriggerAutoPass } from "./util-handlers/checkAndTriggerAutoPass.js";
import { runBroadcastManaPoolUpdate } from "./util-handlers/broadcastManaPoolUpdate.js";
import { runSchedulePriorityTimeout } from "./util-handlers/priorityTimeoutAutoPass.js";
import { runBroadcastGame } from "./util-handlers/broadcastGame.js";

// ============================================================================
// Constants
// ============================================================================

// Auto-pass timer primitives moved to ./util-handlers/autoPassTimerState.js


function scheduleAutomationResume(
  io: Server,
  game: InMemoryGame,
  gameId: string,
  suppressUntil: number,
): void {
  const remainingMs = suppressUntil - Date.now();
  if (remainingMs <= 0) {
    const stateAny = (game.state as any) || {};
    if (Number(stateAny._suppressAutomationUntil || 0) === suppressUntil) {
      delete stateAny._suppressAutomationUntil;
    }
    clearScheduledAutomationResume(gameId);
    checkAndTriggerAI(io, game, gameId);
    checkAndTriggerAutoPass(io, game, gameId);
    return;
  }

  const existing = pendingAutomationResumeTimers.get(gameId);
  if (existing?.suppressUntil === suppressUntil) {
    return;
  }

  clearScheduledAutomationResume(gameId);
  const timeout = setTimeout(() => {
    const pending = pendingAutomationResumeTimers.get(gameId);
    if (!pending || pending.suppressUntil !== suppressUntil) {
      return;
    }
    pendingAutomationResumeTimers.delete(gameId);

    const stateAny = (game.state as any) || {};
    const currentSuppressUntil = Number(stateAny._suppressAutomationUntil || 0);
    if (currentSuppressUntil !== suppressUntil) {
      return;
    }

    if (Date.now() < suppressUntil) {
      scheduleAutomationResume(io, game, gameId, suppressUntil);
      return;
    }

    delete stateAny._suppressAutomationUntil;
    debug(2, `${ts()} [broadcastGame] Resuming deferred automation for ${gameId} after ${suppressUntil}`);
    checkAndTriggerAI(io, game, gameId);
    checkAndTriggerAutoPass(io, game, gameId);
  }, remainingMs);

  pendingAutomationResumeTimers.set(gameId, {
    suppressUntil,
    timeout,
  });
}

export function suppressAutomationOnNextBroadcast(game: InMemoryGame, delayMs = 0): void {
  try {
    const stateAny = (game.state as any) || {};
    stateAny._suppressAutomationOnNextBroadcast = true;
    if (delayMs > 0) {
      stateAny._suppressAutomationUntil = Date.now() + delayMs;
    } else {
      delete stateAny._suppressAutomationUntil;
    }
  } catch {
    // best-effort only
  }
}

export function pauseHumanAutoPassUntilAction(
  game: InMemoryGame,
  playerId?: PlayerID | string | null,
): void {
  try {
    const stateAny = (game.state as any) || {};
    const pausedPlayerId = String(playerId || stateAny.turnPlayer || '').trim();
    if (!pausedPlayerId) return;
    stateAny._pauseHumanAutoPassUntilActionFor = pausedPlayerId;

    const gameId = String((game as any)?.gameId || '').trim();
    if (gameId) {
      clearScheduledHumanAutoPass(gameId, pausedPlayerId);
    }
  } catch {
    // best-effort only
  }
}

export function clearHumanAutoPassPauseOnAction(
  game: InMemoryGame,
  playerId?: PlayerID | string | null,
  reason = 'action',
  // When true, also clears the "auto-pass rest of turn" flag. Set this for genuinely
  // voluntary player-initiated actions (ability activation, spell casting, land play) so
  // that the auto-pass preference is reset after the player re-engages with the game.
  clearAutoPassForTurn = false,
): boolean {
  try {
    const stateAny = (game.state as any) || {};
    const actingPlayerId = String(playerId || '').trim();
    const gameId = String((game as any)?.gameId || (game as any)?.id || '').trim();

    // Always cancel a scheduled human auto-pass for this player on voluntary actions.
    // Otherwise a MAIN1 idle auto-pass (already scheduled) can fire mid-Equip/target
    // prompt and advance into combat while the resolution queue is still open.
    if (clearAutoPassForTurn && actingPlayerId && gameId) {
      clearScheduledHumanAutoPass(gameId, actingPlayerId);
      if (stateAny._autoPassInProgress instanceof Set) {
        stateAny._autoPassInProgress.delete(actingPlayerId);
      }
    }

    // Clear autoPassForTurn when a player takes a voluntary action.
    // If the player actively chose to do something, they are no longer in "auto-pass rest of turn" mode.
    if (clearAutoPassForTurn && actingPlayerId && stateAny.autoPassForTurn?.[actingPlayerId]) {
      delete stateAny.autoPassForTurn[actingPlayerId];
      debug(2, `${ts()} [auto-pass] Cleared autoPassForTurn for ${actingPlayerId} after voluntary ${reason}`);
    }

    const pausedPlayerId = String(stateAny._pauseHumanAutoPassUntilActionFor || '').trim();
    if (!pausedPlayerId || !actingPlayerId || pausedPlayerId !== actingPlayerId) {
      return false;
    }

    delete stateAny._pauseHumanAutoPassUntilActionFor;

    if (gameId) {
      clearScheduledHumanAutoPass(gameId, actingPlayerId);
    }

    debug(2, `${ts()} [auto-pass] Cleared undo auto-pass pause for ${actingPlayerId} after ${reason}`);
    return true;
  } catch {
    return false;
  }
}

export { LAND_PLAY_AUTOMATION_SUPPRESSION_MS, clearScheduledHumanAutoPassForGame } from "./util-handlers/autoPassTimerState.js";

// ts / repairMissingPriorityIfStuck moved to ./util-handlers/repairMissingPriorityIfStuck.js


/* ------------------- Event transformation helpers ------------------- */

/**
 * Transform events from DB format { type, payload } to replay format { type, ...payload }
 * This is used when replaying events after a server restart or during undo.
 * 
 * DB format: { type: 'playLand', payload: { playerId: 'p1', cardId: 'c1' } }
 * Replay format: { type: 'playLand', playerId: 'p1', cardId: 'c1' }
 */
export function transformDbEventsForReplay(events: Array<{ type: string; payload?: any }>): any[] {
  return events.map((e: any) =>
    e && e.type
      ? e.payload && typeof e.payload === "object"
        ? { type: e.type, ...(e.payload as any) }
        : { type: e.type }
      : e
  );
}

export { millUntilLand } from "./util-handlers/playerStateZones.js";


export { getPlayableCardIds } from "./util-handlers/getPlayableCardIds.js";


export { getGraveyardAbilityHints } from "./util-handlers/getGraveyardAbilityHints.js";


export { isInMainPhase } from "./util-handlers/utilMainPhaseCheck.js";


export { optimizeBattlefieldTokensForEmit } from "./util-handlers/gameStateEmitNormalize.js";


export { getPlayerName } from "./util-handlers/getPlayerName.js";


import { ensureGame, ensureGameAsync } from "./util-handlers/ensureGame.js";
export type { EnsureGameOptions } from "./util-handlers/ensureGame.js";
export { ensureGame, ensureGameAsync };


export { emitStateToSocket } from "./util-handlers/emitStateToSocket.js";


export function broadcastGame(
  io: Server,
  game: InMemoryGame,
  gameId: string,
  options: { forceStateReplace?: boolean } = {},
) {
  runBroadcastGame(io, game, gameId, options, {
    scheduleAutomationResume,
    checkAndTriggerAutoPass,
  });
}


import {
  checkAndTriggerAI,
} from "./util-handlers/checkAndTriggerAI.js";
export { checkAndTriggerAI } from "./util-handlers/checkAndTriggerAI.js";


export function checkAndTriggerAutoPass(io: Server, game: InMemoryGame, gameId: string): void {
  runCheckAndTriggerAutoPass(io, game, gameId, {
    broadcastGame,
    appendGameEvent,
    persistAndResolveTopOfStack,
  });
}


import { appendGameEvent, persistAndResolveTopOfStack } from "./util-handlers/appendGameEvent.js";
export { appendGameEvent, persistAndResolveTopOfStack };


export { clearPriorityTimer } from "./util-handlers/priorityTimeoutAutoPass.js";
export function schedulePriorityTimeout(
  io: Server,
  game: InMemoryGame,
  gameId: string
) {
  runSchedulePriorityTimeout(io, game, gameId, {
    broadcastGame,
    appendGameEvent,
    persistAndResolveTopOfStack,
    suppressAutomationOnNextBroadcast,
  });
}


export { checkLibrarySearchRestrictions } from "./util-handlers/librarySearchHelpers.js";







// Mana color constants moved to ./util-handlers/manaColorConstants.js
export {
  MANA_COLOR_NAMES,
  MANA_COLORS,
  getManaColorName,
} from "./util-handlers/manaColorConstants.js";
export type { ManaColorSymbol } from "./util-handlers/manaColorConstants.js";

export { parseManaCost } from "./util-handlers/parseManaCost.js";


export { paymentActivationCostHasUnsupportedAdditionalCosts } from "./util-handlers/paymentActivationCostHasUnsupportedAdditionalCosts.js";

export type { ParsedRemoveCounterActivationCost } from "./util-handlers/manaRemoveCounterCostParse.js";
export {
  parseRemoveCounterActivationCost,
  getPermanentCounterKeyCandidates,
  getPermanentCounterAmount,
  resolvePermanentCounterKey,
} from "./util-handlers/manaRemoveCounterCostParse.js";


export { permanentHasManaBatteryCounterLoop } from "./util-handlers/permanentHasManaBatteryCounterLoop.js";



export { consumeManaFromPool } from "./util-handlers/consumeManaFromPool.js";


export type { AvailableSourceManaPaymentResult } from "./util-handlers/genericManaPaymentFromSources.js";
export {
  getMaxGenericManaAvailable,
  payGenericManaWithAvailableSources,
  canPayManaCostStringWithAvailableSources,
  payManaCostWithAvailableSources,
  refundGenericManaPayment,
} from "./util-handlers/genericManaPaymentFromSources.js";


// Mana provenance lower-bound tracking moved to ./util-handlers/manaProvenanceLowerBounds.js
export {
  recordTreasureManaProduced,
  snapshotTreasureManaLowerBound,
  applyManaSpendToTreasureLowerBound,
  deriveManaFromTreasureSpent,
  recordCreatureSpellHasteManaProduced,
  snapshotCreatureSpellHasteManaLowerBound,
  applyManaSpendToCreatureSpellHasteManaLowerBound,
  deriveCreatureSpellHasteFromManaSpent,
  recordManaProducedByPermanentSource,
  snapshotManaProducedByPermanentLowerBound,
  applyManaSpendToManaProducedByPermanentLowerBound,
  deriveCastUsedManaFromPermanentSource,
} from "./util-handlers/manaProvenanceLowerBounds.js";

// Mana pool state operations moved to ./util-handlers/manaPoolStateOperations.js
export {
  getOrInitManaPool,
  getOrInitPersistentManaPool,
  detectManaRetentionEffects,
  addPersistentMana,
  processManaDrain,
  clearManaPool,
  clearPersistentManaPool,
  clearAllManaPools,
  getTotalManaPool,
  calculateTotalAvailableMana,
  validateManaPayment,
} from "./util-handlers/manaPoolStateOperations.js";
export type { ManaRetentionEffect } from "./util-handlers/manaPoolStateOperations.js";

export type { ResolveManaCostForPoolPaymentResult } from "./util-handlers/manaPoolCostPayment.js";
export {
  validateAndConsumeManaCostFromPool,
  resolvePaymentManaAbilitySpendRestriction,
  restrictedManaSpendRestrictionAllowsPurpose,
  buildActivatedAbilityRestrictedManaPurpose,
  validateAbilityManaCostFromPool,
  payAbilityManaCostFromPool,
  addCastSpellPaymentProducedMana,
  resolveManaCostForPoolPayment,
} from "./util-handlers/manaPoolCostPayment.js";


export type { ManaProductionInfo } from "./util-handlers/manaProductionTypes.js";


export {
  resolveActivatedAbilityLineById,
  resolveClientStyleManaAbilityById,
} from "./util-handlers/manaAbilityLineResolvers.js";


export { shouldApplyDevotionColorChoiceMana } from "./util-handlers/manaProductionDevotionHelpers.js";


export { calculateManaProduction } from "./util-handlers/calculateManaProduction.js";


export { getEffectivePower, getEffectiveToughness } from "./util-handlers/getEffectivePowerToughness.js";


export { emitToPlayer } from "./util-handlers/emitToPlayer.js";


// Restricted mana pool operations moved to ./util-handlers/manaRestrictedPoolOperations.js
export {
  getManaEntryColor,
  addRestrictedManaToPool,
  removeRestrictedManaFromPool,
  setManaPoolDoesNotEmpty,
  removeManaPoolDoesNotEmpty,
  getTotalManaInPool,
  getTotalManaOfColorInPool,
  canUseRestrictedMana,
  parseFloatingPaymentPermanentId,
  getFloatingPaymentPoolColorKey,
  validateSelectedFloatingPoolMana,
  buildManaTotalsIncludingEligibleRestricted,
} from "./util-handlers/manaRestrictedPoolOperations.js";
export type { RestrictedManaSpendPurpose } from "./util-handlers/manaRestrictedPoolOperations.js";

export { consumeManaFromPoolForPurpose } from "./util-handlers/consumeManaFromPoolForPurpose.js";


export function broadcastManaPoolUpdate(
  io: Server,
  gameId: string,
  playerId: string,
  manaPool: ManaPool,
  reason?: string,
  game?: any
): void {
  runBroadcastManaPoolUpdate(io, gameId, playerId, manaPool, reason, game, {
    ensureGame,
    broadcastGame,
  });
}




