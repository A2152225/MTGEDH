// server/src/state/modules/turn.ts
// Turn / priority helpers used by server state. Full-file defensive implementation.
// Exports:
//  - passPriority(ctx, playerId)
//  - setTurnDirection(ctx, dir)
//  - nextTurn(ctx)
//  - nextStep(ctx)
//  - scheduleStepsAfterCurrent(ctx, steps)
//  - scheduleStepsAtEndOfTurn(ctx, steps)
//  - clearScheduledSteps(ctx)
//  - getScheduledSteps(ctx)
//  - removeScheduledSteps(ctx, steps)
//
// This implementation is intentionally defensive: it tolerates missing ctx fields,
// ensures ctx.seq exists, and avoids throwing when replaying older event streams.

import type { GameContext } from "../context.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import { appendEvent } from '../../db/index.js';
import { drawCards } from "./zones.js";
import { resetConvokeGrantsForNewTurn } from "./casting-modifiers.js";
import { recalculatePlayerEffects, canDamageBePrevented, clearTemporaryLandBonuses, calculateModifiedDamage, processLifeChange, resolveCombatDamageToOpponent } from "./game-state-effects.js";
import { triggerETBEffectsForPermanent } from './triggerEtbPermanentEffects.js';
import { detectEntersWithCounters } from './detectEntersWithCounters.js';
import { 
  getBeginningOfCombatTriggers, 
  getEndStepTriggers, 
  getPrecombatMainTriggers,
  getPostcombatMainTriggers,
  getEndOfCombatTriggers,
  getUntapStepEffects,
  applyUntapStepEffect,
  isPermanentPreventedFromUntapping,
  detectCombatDamageTriggers,
  checkDamageReceivedTrigger
} from "./triggered-abilities.js";
import { shouldSkipUntapStepForPlayer } from "./skipUntapStepUtils.js";
import { consumePlayerSkipNextUntapStep, playerHasSkipNextUntapStep } from "./skipUntapStepUtils.js";
import { dispatchDamageReceivedTrigger, processDamageReceivedTriggers } from "./triggers/damage-received.js";
import { queueBecomesUntappedTriggers } from "./triggers/tap-untap.js";
import { processSagaLoreCountersAtPrecombatMain } from "./triggerSagaLoreUtils.js";
import { processRadCountersAtPrecombatMain } from "./triggers/rad-counters.js";
import { processAttractionVisitRollAtPrecombatMain } from "./triggers/attraction-visit.js";
import { pushTriggerDoublerCopies } from "./triggers/combat.js";
import { isInterveningIfSatisfied } from "./triggers/intervening-if.js";
import { orderTriggersByAPNAP } from "./triggers/ordering.js";
import { parseCreatureKeywords } from "./combat-mechanics.js";
import {
  applyCreatureCombatDamageFromSource,
  creatureDiesFromCombatDamage,
  resolvePlayerCombatDamage,
} from "./combat-damage-processing.js";
import { queueCombatDamageChat } from "./combatDamageChat.js";
import { runSBA, createToken } from "./counters_tokens.js";
import { applyDamageToPermanentWithCounterEffects, applyShieldCounterDamagePrevention } from "./counter-common-effects.js";
import { calculateAllPTBonuses, calculateVariablePT, parsePT, uid, triggerLifeGainEffects } from "../utils.js";
import { canAct, canRespond, turnPlayerMustDeclareAttackers } from "./can-respond.js";
import {
  dequeuePendingNextEndStepZoneChangeTriggers,
  dequeuePendingEndOfCombatZoneChangeTriggers,
} from "./turn-handlers/pendingDelayedTriggerDequeues.js";
import { runTurnStepCleanup } from "./turn-handlers/turnStepCleanup.js";
import { runTurnStepUpkeep } from "./turn-handlers/turnStepUpkeep.js";
import { runTurnStepDraw } from "./turn-handlers/turnStepDraw.js";
import { runTurnStepUntap } from "./turn-handlers/turnStepUntap.js";
import { checkPendingInteractions } from "./turn-handlers/checkPendingInteractions.js";
import { getActivePriorityPlayers } from "./priorityEligibility.js";
import { clearTemporaryRetainedManaDuration } from "./turn-handlers/turnTemporaryRetainedMana.js";
import { clearManaPool } from "./turn-handlers/turnClearManaPool.js";
import { getCombatCreatureStats, applyCombatDamagePreventionEffects } from "./turn-handlers/turnCombatDamageStatsPrevention.js";
import {
  isCombatDamagePreventedForPermanent,
  modifyCombatDamageToPermanentAmount,
  applyCombatDamageToPlaneswalker,
} from "./turn-handlers/turnCombatDamagePermanentApply.js";
import { applyLifeGainViaProcessLifeChange } from "./turn-handlers/turnCombatDamageLifeGain.js";
import { queueDamageReceivedTrigger } from "./turn-handlers/turnCombatDamageReceivedQueue.js";
import {
  syncLifeAndCheckDefeat,
  trackCommanderDamage,
  trackCreatureDamageToPlayer,
  didCreatureDealDamageToPlayer,
  getCreaturesThatDealtDamageToPlayer,
} from "./turn-handlers/turnCombatDamageTracking.js";
import { applyDealCombatDamageAttackerLoop } from "./turn-handlers/turnCombatDamageAttackerLoop.js";
import { applyDealCombatDamageTriggerQueue } from "./turn-handlers/turnCombatDamageTriggerQueue.js";
import { captureNextTurnLastTurnInterveningIfState } from "./turn-handlers/turnNextTurnLastTurnCapture.js";
import { runNextTurnStartOfTurn } from "./turn-handlers/turnNextTurnStartOfTurn.js";
import {
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
} from "./turn-handlers/turnScheduledStepsAndExtras.js";
import { passPriority } from "./turn-handlers/turnPassPriority.js";
import { clearCombatState } from "./turn-handlers/turnClearCombatState.js";
import { processPendingFlickerReturnsAtBeginningOfEndStep } from "./turn-handlers/turnFlickerEndStepReturns.js";
import { processImpendingEndStepCounterRemoval } from "./impendingEffects.js";
import { computeNextStepPhaseAdvance } from "./turn-handlers/turnStepPhaseAdvance.js";
import { pushTurnStepTriggersToStack } from "./turn-handlers/turnStepPushTriggers.js";
import { grantTurnStepPriority } from "./turn-handlers/turnStepPriorityGrant.js";
import { runTurnStepMain1 } from "./turn-handlers/turnStepMain1.js";
import { runTurnStepDrawTurnAction } from "./turn-handlers/turnStepDrawTurnAction.js";
import { removeExpiredUntilNextTurnEffects } from "./turn-handlers/turnExpiredUntilNextTurnEffects.js";
import { untapPermanentsForPlayer } from "./turn-handlers/turnUntapPermanents.js";

export { didCreatureDealDamageToPlayer, getCreaturesThatDealtDamageToPlayer };
export { passPriority };
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
};

/**
 * Rule 103.8: On turn 1, two-player games skip the starting player's draw step;
 * multiplayer (3+) starting players still draw.
 */
export function shouldPerformDrawStepTurnAction(ctx: GameContext, turnPlayer: string): boolean {
  const state = (ctx as any).state || {};
  const turnNumber = Number(state.turnNumber ?? state.turn ?? 0) || 0;
  if (turnNumber !== 1) return true;

  const activePlayers = (Array.isArray(state.players) ? state.players : [])
    .filter((p: any) => p && !p.spectator && !p.isSpectator);
  if (activePlayers.length !== 2) return true;

  const startingPlayer = String(
    state.startingPlayerId ?? state.startingPlayer ?? state.turnPlayer ?? ''
  ).trim();
  if (!startingPlayer) return true;

  return String(turnPlayer) !== startingPlayer;
}

/** Rule 502.1: false when Stasis-style effects skip the active player's untap step. */
export function shouldPerformUntapStepTurnAction(ctx: GameContext, turnPlayer: string): boolean {
  return !shouldSkipUntapStepForPlayer(ctx, turnPlayer);
}
import { cleanupCardLeavingExile } from "./playable-from-exile.js";
import { recordCardPutIntoGraveyardThisTurn } from "./turn-tracking.js";
import { removeExpiredGoads } from "./goad-effects.js";
import { tryAutoPass } from "./priority.js";
import { ResolutionQueueManager, ResolutionStepType } from "../resolution/index.js";
import { debug, debugWarn, debugError } from "../../utils/debug.js";
import { ensureInitialDayNightDesignationFromBattlefield, setDayNightState } from "./day-night.js";
import { resetDurablePermissionUsageForTurn } from "./durable-permissions.js";
import { evaluateDamageReplacementEvent } from "./replacement-effects.js";
import { resetExhaustAbilityActivations } from './keywordActivationState.js';
import { resetSpeedIncreasedThisTurn } from './statefulPaperKeywords.js';

/** Small helper to prepend ISO timestamp to debug logs */
function ts() {
  return new Date().toISOString();
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Turn-step triggerTypes persisted by nextStep (see pushTriggersToStack / initiative / rebound / etc.). */
const TURN_STEP_TRIGGER_TYPES = new Set([
  'upkeep',
  'draw_step',
  'precombat_main',
  'postcombat_main',
  'begin_combat',
  'end_combat',
  'end_step',
  'rebound',
  'paradigm',
  'saga_chapter',
]);

function isTurnStepPersistedTriggerEvent(event: any): boolean {
  if (!event || String(event.type || '') !== 'pushTriggeredAbility') return false;
  const triggerType = String(event.triggerType || '').trim().toLowerCase();
  return TURN_STEP_TRIGGER_TYPES.has(triggerType);
}

/**
 * During replay, nextStep must not live-push turn-step triggers when those pushes
 * already exist as persisted events.
 *
 * Two event orderings appear in the wild:
 * - Correct / test style: nextStep, then pushTriggeredAbility (lookahead)
 * - Live socket style (historical): nextStep() runs and persists pushes, THEN
 *   appendEvent(nextStep) — so pushTriggeredAbility lands *before* the nextStep
 *   event (lookbehind). Without lookbehind, replay double-pushes and orphans leak
 *   across turns (blocks sorcery-speed casts after restart).
 */
function shouldUsePersistedTurnStepTriggersDuringReplay(ctx: GameContext): boolean {
  if (!(ctx as any).isReplaying) return false;
  const nextType = String((ctx as any)._replayNextEventType || '').trim();
  if (nextType === 'pushTriggeredAbility' || nextType === 'queueTriggerOrderStep') {
    return true;
  }

  // Historical live sockets appended nextStep *after* nextStep() had already
  // persisted a burst of pushTriggeredAbility events. Other sync events (mills,
  // optional choices, etc.) can sit between the last turn-step push and the
  // nextStep marker — scan a short window, not only the immediate predecessor.
  const events = (ctx as any)._replayEvents;
  const index = Number((ctx as any)._replayEventIndex);
  if (Array.isArray(events) && Number.isFinite(index) && index > 0) {
    const start = Math.max(0, index - 48);
    for (let i = index - 1; i >= start; i--) {
      const ev = events[i];
      const type = String((ev as any)?.type || '').trim();
      if (type === 'nextStep' || type === 'nextTurn') break;
      if (isTurnStepPersistedTriggerEvent(ev) || type === 'queueTriggerOrderStep') {
        return true;
      }
    }
    return false;
  }

  const prev = (ctx as any)._replayPreviousEvent;
  if (isTurnStepPersistedTriggerEvent(prev)) return true;
  if (prev && String(prev.type || '') === 'queueTriggerOrderStep') return true;
  return false;
}

function shouldUsePersistedCombatDamageTriggersDuringReplay(ctx: GameContext): boolean {
  if (!(ctx as any).isReplaying) return false;
  const nextType = String((ctx as any)._replayNextEventType || '').trim();
  if (nextType === 'pushTriggeredAbility') return true;
  const prev = (ctx as any)._replayPreviousEvent;
  if (!prev || String(prev.type || '') !== 'pushTriggeredAbility') return false;
  const triggerType = String(prev.triggerType || '').trim().toLowerCase();
  return triggerType === 'combat_damage' || triggerType === 'dealt_damage' || triggerType === 'you_are_dealt_damage';
}









// Delayed-trigger dequeue helpers moved to ./turn-handlers/pendingDelayedTriggerDequeues.js
// (imported at the top of this file; they stay module-private to turn.ts).


/**
 * Ensure seq helper object present on ctx
 */
function ensureSeq(ctx: any) {
  if (!ctx) return;
  if (!ctx.seq) {
    ctx.seq = { value: 0 };
  } else if (typeof ctx.seq === "number") {
    ctx.seq = { value: ctx.seq };
  } else if (typeof ctx.seq === "object" && !("value" in ctx.seq)) {
    (ctx.seq as any).value = 0;
  }
}

/**
 * Bump sequence safely
 */
function safeBumpSeq(ctx: any) {
  try {
    ensureSeq(ctx);
    if (ctx.seq && typeof ctx.seq === "object") ctx.seq.value++;
    else if (typeof ctx.seq === "number") ctx.seq++;
  } catch {
    // ignore
  }
}


/**
 * Utility: get ordered active players (non-inactive) from ctx.state.players
 */
function activePlayers(ctx: GameContext): string[] {
  try {
    return getActivePriorityPlayers(ctx).map((p) => p.id);
  } catch {
    return [];
  }
}

/**
 * Find next player id in turn order after given player
 */
function nextPlayerInOrder(ctx: GameContext, fromId?: PlayerID) {
  const players = Array.isArray(ctx.state.players) ? (ctx.state.players as any[]) : [];
  if (!players.length) return undefined;
  const ids = players.map((p) => p.id);
  if (!fromId) return ids[0];
  const idx = ids.indexOf(fromId);
  if (idx === -1) return ids[0];
  return ids[(idx + 1) % ids.length];
}


/**
 * Set turn direction (+1 or -1)
 */
export function setTurnDirection(ctx: GameContext, dir: 1 | -1) {
  try {
    (ctx as any).state = (ctx as any).state || {};
    (ctx as any).state.turnDirection = dir;
    ctx.bumpSeq();
  } catch (err) {
    debugWarn(1, `${ts()} setTurnDirection failed:`, err);
  }
}



/**
 * Deal combat damage during the DAMAGE step.
 * Rule 510: Combat damage is assigned and dealt simultaneously.
 * 
 * Handles:
 * - Unblocked attackers deal damage to defending player
 * - Blocked attackers deal damage to blockers (with damage assignment order)
 * - Blockers deal damage to attackers they block
 * - Trample: Excess damage from blocked attacker goes to defending player
 * - Lifelink: Controller gains life equal to damage dealt
 * - Deathtouch: Any damage is lethal (kills creature)
 * - First Strike / Double Strike: Handled in separate damage steps
 * 
 * @param ctx Game context
 * @param isFirstStrikePhase If true, only first strike/double strike creatures deal damage.
 *                          If false (or undefined), regular damage phase - all creatures deal damage,
 *                          but first strike-only creatures are skipped (they already dealt damage).
 * 
 * Returns summary of damage dealt for logging/notification.
 */
function dealCombatDamage(ctx: GameContext, isFirstStrikePhase?: boolean): {
  damageToPlayers: Record<string, number>;
  lifeGainForPlayers: Record<string, number>;
  creaturesDestroyed: string[];
  attackersThatDealtDamage?: Record<string, Set<string>>; // defendingPlayerId -> Set of attacker IDs
  attackerDamageToPlayers?: Record<string, Record<string, number>>; // defendingPlayerId -> attackerId -> damage amount
} {
  debug(2, `${ts()} [COMBAT_DAMAGE] ========== ENTERING dealCombatDamage (firstStrike=${isFirstStrikePhase}) ==========`);
  
  const result = {
    damageToPlayers: {} as Record<string, number>,
    lifeGainForPlayers: {} as Record<string, number>,
    creaturesDestroyed: [] as string[],
    attackersThatDealtDamage: {} as Record<string, Set<string>>,
    attackerDamageToPlayers: {} as Record<string, Record<string, number>>,
  };
  
  try {
    const battlefield = (ctx as any).state?.battlefield;
    const state = (ctx as any).state;
    if (!Array.isArray(battlefield)) {
      debug(2, `${ts()} [COMBAT_DAMAGE] No battlefield array, returning early`);
      return result;
    }
    
    // Find all attacking creatures
    const attackers = battlefield.filter((perm: any) => perm && perm.attacking);
    debug(2, `${ts()} [COMBAT_DAMAGE] Found ${attackers.length} attackers`);
    
    // Log attacker details
    for (const att of attackers) {
      const blockedBy = att.blockedBy || [];
      debug(1, `${ts()} [COMBAT_DAMAGE] Attacker: ${att.card?.name || att.id}, blocked by ${blockedBy.length} creatures: [${blockedBy.join(', ')}]`);
    }
    
    if (attackers.length === 0) {
      debug(2, `${ts()} [COMBAT_DAMAGE] No attackers, skipping combat damage`);
      return result;
    }
    
    // Get life totals object - ensure we're using the same object that ctx.life references
    // Initialize if needed to avoid creating a new unlinked object
    if (!(ctx as any).state.life) {
      (ctx as any).state.life = {};
    }
    const life = (ctx as any).state.life;
    const startingLife = (ctx as any).state?.startingLife || 40;
    
    applyDealCombatDamageAttackerLoop(ctx, attackers, battlefield, state, life, startingLife, result, isFirstStrikePhase);
    
    // Update life state
    (ctx as any).state.life = life;
    
    // Sync life to player objects and check for player defeat (SBA Rule 704.5a)
    const defeatedPlayers = syncLifeAndCheckDefeat(ctx);
    if (defeatedPlayers.length > 0) {
      debug(1, `${ts()} [dealCombatDamage] Players defeated due to combat damage: ${defeatedPlayers.join(', ')}`);
      // Store defeated players for the socket layer to broadcast
      (ctx as any).state.lastCombatDefeat = defeatedPlayers;
    }
    
    // Move dead creatures to graveyard (state-based actions)
    // This should be handled separately by SBA processing, but we mark them here
    for (const deadId of result.creaturesDestroyed) {
      const deadPerm = battlefield.find((p: any) => p?.id === deadId);
      if (deadPerm) {
        deadPerm.markedForDestruction = true;
      }
    }
    
    debug(2, `${ts()} [dealCombatDamage] Combat damage complete. Damage to players: ${JSON.stringify(result.damageToPlayers)}, Life gained: ${JSON.stringify(result.lifeGainForPlayers)}, Creatures destroyed: ${result.creaturesDestroyed.length}`);

    applyDealCombatDamageTriggerQueue(ctx, battlefield, result);
    
    // Run state-based actions to destroy creatures that have lethal damage
    // This will move creatures with 0 or less toughness (after damage) to the graveyard
    try {
      runSBA(ctx);
    } catch (sbaErr) {
      debugWarn(1, `${ts()} [dealCombatDamage] SBA failed:`, sbaErr);
    }
    
  } catch (err) {
    debugWarn(1, `${ts()} dealCombatDamage failed:`, err);
  }
  
  return result;
}


/**
 * Clear summoning sickness from all permanents controlled by the specified player.
 * Rule 302.6: A creature's activated ability with tap/untap symbol can't be
 * activated unless the creature has been under its controller's control continuously
 * since their most recent turn began.
 * 
 * This is called at the start of the player's turn. Once a creature has been
 * controlled since the turn began, it no longer has summoning sickness.
 */
function clearSummoningSicknessForPlayer(ctx: GameContext, playerId: string) {
  try {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return;

    let clearedCount = 0;

    for (const permanent of battlefield) {
      if (!permanent || permanent.controller !== playerId) continue;
      if (permanent.summoningSickness || permanent.enteredThisTurn) {
        permanent.summoningSickness = false;
        delete permanent.enteredThisTurn;
        clearedCount++;
      }
    }

    if (clearedCount > 0) {
      debug(2, `${ts()} [clearSummoningSicknessForPlayer] Cleared summoning sickness from ${clearedCount} permanent(s) for ${playerId}`);
    }
  } catch (err) {
    debugWarn(1, `${ts()} clearSummoningSicknessForPlayer failed:`, err);
  }
}

/**
 * Untap all permanents controlled by the specified player.
 * This implements Rule 502.3: During the untap step, the active player
 * untaps all their permanents simultaneously.
 * 
 * Special handling:
 * - Stun counters (Rule 122.1c): Instead of untapping, remove a stun counter
 * - "Doesn't untap" effects: Skip untapping for permanents with this flag
 * - Static effects: Check for cards like Intruder Alarm that prevent untapping
 */
/**
 * Untap all lands controlled by a specific player
 * Used for Nature's Will, Bear Umbra, Sword of Feast and Famine, etc.
 */
function untapLandsForPlayer(ctx: GameContext, playerId: string) {
  try {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return;

    let untappedCount = 0;

    for (const permanent of battlefield) {
      if (!permanent || permanent.controller !== playerId) continue;
      if (!permanent.tapped) continue;
      
      const typeLine = (permanent.card?.type_line || '').toLowerCase();
      if (!typeLine.includes('land')) continue;

      // Untap the land
      permanent.tapped = false;
      queueBecomesUntappedTriggers(ctx, permanent);
      untappedCount++;
    }

    if (untappedCount > 0) {
      debug(2, 
        `${ts()} [untapLandsForPlayer] Untapped ${untappedCount} lands for player ${playerId}`
      );
    }
  } catch (err) {
    debugWarn(1, `${ts()} untapLandsForPlayer failed:`, err);
  }
}


/**
 * Rule 502.3: untap step turn action — untap active player's permanents plus
 * other-players'-turn untap effects (Unwinding Clock, Seedborn Muse, etc.).
 */
export function performUntapStepTurnAction(ctx: GameContext, turnPlayer: string): string[] {
  const untappedPermanentIds: string[] = [];
  if (!shouldPerformUntapStepTurnAction(ctx, turnPlayer)) {
    if (playerHasSkipNextUntapStep(ctx, turnPlayer)) {
      consumePlayerSkipNextUntapStep(ctx, turnPlayer);
    }
    return untappedPermanentIds;
  }
  try {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return untappedPermanentIds;

    const tappedBefore = new Set<string>();
    for (const permanent of battlefield) {
      if (permanent && permanent.controller === turnPlayer && permanent.tapped) {
        tappedBefore.add(String(permanent.id || ''));
      }
    }

    untapPermanentsForPlayer(ctx, turnPlayer);

    const untapEffects = getUntapStepEffects(ctx, turnPlayer);
    for (const effect of untapEffects) {
      applyUntapStepEffect(ctx, effect);
    }

    for (const permanent of battlefield) {
      if (!permanent) continue;
      const id = String(permanent.id || '');
      if (tappedBefore.has(id) && !permanent.tapped) {
        untappedPermanentIds.push(id);
      }
    }
  } catch (err) {
    debugWarn(1, `${ts()} performUntapStepTurnAction failed:`, err);
  }
  return untappedPermanentIds;
}

/**
 * nextTurn: advance to next player's turn
 * - Checks for extra turns first (Rule 500.7)
 * - Updates turnPlayer to the next player in order
 * - Resets phase to "beginning" (start of turn)
 * - Sets step to "UNTAP" 
 * - Clears summoning sickness for the new active player's creatures (Rule 302.6)
 * - Leaves the game at UNTAP (nextStep will advance to UPKEEP)
 * - Gives priority to the active player (tests rely on this even though players normally don't get priority during untap)
 * - Resets landsPlayedThisTurn for all players
 */
export function nextTurn(ctx: GameContext) {
  try {
    (ctx as any).state = (ctx as any).state || {};
    const wasPreGame = String((ctx as any).state?.phase || '').toLowerCase() === 'pre_game';
    const allPlayers = Array.isArray((ctx as any).state.players)
      ? (ctx as any).state.players.map((p: any) => p.id)
      : [];
    if (!allPlayers.length) return;
    
    // Living players only (hasLost / 0 life / poison / inactive), not merely ctx.inactive.
    const players = getActivePriorityPlayers(ctx).map((p) => p.id);
    if (!players.length) {
      debug(2, `${ts()} [nextTurn] No active players remaining, game should end`);
      return;
    }
    
    const current = (ctx as any).state.turnPlayer;

    clearTemporaryRetainedManaDuration((ctx as any).state, 'untilEndTurn');
    clearManaPool(ctx);
    
    // Increment turn number
    (ctx as any).state.turnNumber = ((ctx as any).state.turnNumber || 0) + 1;
    const turnNumber = (ctx as any).state.turnNumber;

    // Best-effort cleanup: prune expired impulse-style "playable from exile" windows.
    // Semantics: numeric entries represent "playable until >= turnNumber"; once turnNumber advances,
    // any entry with value < turnNumber is no longer usable.
    try {
      const stateAny = (ctx as any).state as any;
      const pfeAll = stateAny?.playableFromExile;
      if (pfeAll && typeof pfeAll === 'object') {
        for (const [pid, entry] of Object.entries(pfeAll)) {
          if (!entry) continue;
          if (Array.isArray(entry)) continue;
          if (typeof entry !== 'object') continue;
          for (const [cardId, until] of Object.entries(entry as any)) {
            if (typeof until === 'number' && until < turnNumber) {
              delete (entry as any)[cardId];
            }
          }
        }
      }
    } catch {
      // best-effort only
    }

    // Legacy alias used by older client/replay consumers.
    (ctx as any).state.turn = turnNumber;
    
    // Rule 500.7: Check for extra turns
    // Extra turns are stored in a LIFO stack (most recently created is taken first)
    let next: string;
    const extraTurns = (ctx as any).state.extraTurns as any[] || [];
    
    if (extraTurns.length > 0) {
      // Take the first extra turn from the stack
      const extraTurn = extraTurns.shift();
      next = extraTurn.playerId;
      // Skip extra turn if player is out of the game
      if (!players.includes(next)) {
        debug(1, `${ts()} [nextTurn] Skipping extra turn for inactive player ${next}`);
        // Recursive call to get next turn
        nextTurn(ctx);
        return;
      }
      debug(2, `${ts()} [nextTurn] Taking extra turn for ${next} (turn ${turnNumber})`);
    } else if (wasPreGame) {
      // Pre-game start: turnPlayer already designates the starting player.
      next = (current && players.includes(current)) ? current : players[0];
      debug(2, `${ts()} [nextTurn] Starting game — first active player: ${next}`);
    } else {
      // Normal turn progression - find next active player
      const currentIdx = players.indexOf(current);
      // If current player is inactive or not found, start from first active player
      if (currentIdx === -1) {
        next = players[0];
      } else {
        next = players[(currentIdx + 1) % players.length];
      }
    }

    captureNextTurnLastTurnInterveningIfState(ctx, String(current || ''));
    
    (ctx as any).state.turnPlayer = next;

    // Legacy alias: some templates still reference `activePlayer`.
    try {
      (ctx as any).state.activePlayer = next;
    } catch {
      // best-effort only
    }
    runNextTurnStartOfTurn(ctx, next, String(current || ''), turnNumber, players, removeExpiredUntilNextTurnEffects, clearSummoningSicknessForPlayer);

    ctx.bumpSeq();
  } catch (err) {
    debugWarn(1, `${ts()} nextTurn failed:`, err);
  }
}


/**
 * nextStep: advance to next step within the current turn
 * Simple progression through main phases and steps.
 * Full step/phase automation would be more complex, but this provides basic progression.
 * 
 * Replay/undo determinism note:
 * - Replaying persisted events must reproduce the same state as live execution.
 * - Most turn-based actions (untap, draw step draw, step-entry triggers, combat damage)
 *   are NOT persisted as separate events, so they must still run during replay.
 * - We keep the pending-interaction blocker disabled during replay to avoid stale
 *   ResolutionQueue state preventing forward progress.
 */
export function nextStep(ctx: GameContext) {
  try {
    // ========================================================================
    // DEBUG: Track nextStep calls to diagnose auto-pass skip issues
    // ========================================================================
    const debugInfo = {
      timestamp: Date.now(),
      gameId: (ctx as any).gameId || 'unknown',
      currentPhase: String((ctx as any).state?.phase || "beginning"),
      currentStep: String((ctx as any).state?.step || ""),
      priority: (ctx as any).state?.priority,
      turnPlayer: (ctx as any).state?.turnPlayer,
      stackTrace: new Error().stack?.split('\n').slice(2, 6).join('\n    ') || 'no stack'
    };
    const nextStepLogLevel = String(debugInfo.gameId).startsWith('undo_probe_') ? 3 : 2;
    
    debug(nextStepLogLevel, `${ts()} [nextStep] ========== CALLED ==========`);
    debug(nextStepLogLevel, `${ts()} [nextStep] Game: ${debugInfo.gameId}`);
    debug(nextStepLogLevel, `${ts()} [nextStep] Current: ${debugInfo.currentPhase}/${debugInfo.currentStep}`);
    debug(nextStepLogLevel, `${ts()} [nextStep] Priority: ${debugInfo.priority}, Turn: ${debugInfo.turnPlayer}`);
    debug(nextStepLogLevel, `${ts()} [nextStep] Call stack:\n    ${debugInfo.stackTrace}`);
    // ========================================================================
    
    (ctx as any).state = (ctx as any).state || {};
    const currentPhase = String((ctx as any).state.phase || "beginning");
    const currentStep = String((ctx as any).state.step || "");
    
    // Check if we're in replay mode - if so, skip side effects
    const isReplaying = !!(ctx as any).isReplaying;

    // ========================================================================
    // PENDING INTERACTION CHECK
    // 
    // Before advancing to the next step/phase, ensure all pending UI interactions
    // are resolved. This prevents game state from advancing while players still
    // need to make choices (modal selections, target selections, etc.).
    // 
    // Skip this check during replay mode since those interactions were already
    // handled when the events were originally recorded.
    // ========================================================================
    if (!isReplaying) {
      const pendingCheck = checkPendingInteractions(ctx);
      if (pendingCheck.hasPending) {
        debug(1, `${ts()} [nextStep] BLOCKED: Cannot advance step - pending interactions: ${pendingCheck.pendingTypes.join(', ')}`);
        
        // Store the blocking reason in state for UI feedback
        (ctx as any).state.stepAdvanceBlocked = {
          blocked: true,
          reason: pendingCheck.pendingTypes,
          details: pendingCheck.details,
          timestamp: Date.now(),
        };
        
        // Don't advance - return early
        return;
      }
      
      // Clear any previous blocked state since we're now able to advance
      if ((ctx as any).state.stepAdvanceBlocked) {
        delete (ctx as any).state.stepAdvanceBlocked;
      }
    }

    // Simple step progression logic
    // beginning phase: UNTAP -> UPKEEP -> DRAW
    // precombatMain phase: MAIN1
    // combat phase: BEGIN_COMBAT -> DECLARE_ATTACKERS -> DECLARE_BLOCKERS -> DAMAGE -> END_COMBAT
    // postcombatMain phase: MAIN2
    // ending phase: END -> CLEANUP

    const phaseAdvance = computeNextStepPhaseAdvance(ctx, currentPhase, currentStep, dealCombatDamage);
    if (!phaseAdvance) return;
    let nextPhase = phaseAdvance.nextPhase;
    let nextStep = phaseAdvance.nextStep;
    let shouldDraw = phaseAdvance.shouldDraw;
    let shouldAdvanceTurn = phaseAdvance.shouldAdvanceTurn;
    let shouldUntap = phaseAdvance.shouldUntap;

    // Update phase and step
    (ctx as any).state.phase = nextPhase;
    (ctx as any).state.step = nextStep;

    // Clear mana pool when phase changes (Rule 106.4)
    // Mana empties from mana pools at the end of each step and phase
    if (nextPhase !== currentPhase) {
      if (currentPhase === 'combat' && nextPhase !== 'combat') {
        clearTemporaryRetainedManaDuration((ctx as any).state, 'untilEndCombat');
      }
      clearManaPool(ctx);
    }

    debug(2, 
      `${ts()} [nextStep] Advanced to phase=${nextPhase}, step=${nextStep}`
    );

    // ========================================================================
    // DRAW STEP SPECIAL HANDLING (Rule 504.1)
    // 
    // Per Rule 504.1: "First, the active player draws a card. This turn-based
    // action doesn't use the stack."
    // 
    // The draw happens BEFORE triggers are processed. This is critical for
    // triggers like "at the beginning of your draw step" which should see
    // the card that was just drawn.
    // ========================================================================
    if (shouldDraw) {
      runTurnStepDrawTurnAction(ctx, shouldPerformDrawStepTurnAction);
    }

    // ========================================================================
    // STEP-ENTRY TRIGGER PROCESSING (Per MTG Rules 503-514)
    // 
    // Per Rule 116.2a: Triggered abilities go on the stack the next time a 
    // player would receive priority. When entering a new step/phase, all 
    // "at the beginning of [X]" triggers are put on the stack BEFORE any 
    // player receives priority.
    //
    // This section processes triggers for the NEW step we just entered.
    // The order is:
    // 1. Phase/Step is updated (done above)
    // 2. Triggers for the new step are detected and pushed to stack
    // 3. Active player receives priority (done at end of nextStep or in socket layer)
    // ========================================================================
    {
      const turnPlayer = (ctx as any).state?.turnPlayer;
      if (turnPlayer) {
        (ctx as any).state.stack = (ctx as any).state.stack || [];
        const usePersistedTurnStepTriggers = shouldUsePersistedTurnStepTriggersDuringReplay(ctx);
        
        // Helper function to process triggers with APNAP ordering
        // Per MTG Rule 101.4: When multiple triggered abilities controlled by the same player
        // trigger at the same time, that player chooses the order to put them on the stack.
        const pushTriggersToStack = (triggers: any[], triggerType: string, idPrefix: string) => {
          pushTurnStepTriggersToStack(ctx, turnPlayer, usePersistedTurnStepTriggers, triggers, triggerType, idPrefix);
        };
        
        // Rule 504.1: Upkeep step - "at the beginning of your upkeep" triggers
        if (nextStep === "UPKEEP") {
          runTurnStepUpkeep(ctx, turnPlayer, usePersistedTurnStepTriggers, pushTriggersToStack);
        }
        
        // Rule 504.1 (Draw): "at the beginning of your draw step" triggers
        else if (nextStep === "DRAW") {
          runTurnStepDraw(ctx, turnPlayer, pushTriggersToStack);
        }
        
        // Rule 505.4: Beginning of precombat main phase - "at the beginning of your precombat main phase" triggers
        // This includes cards like Black Market Connections, Saga lore counters (Rule 714.3b), etc.
        // NOTE: Only process if we didn't just auto-advance from DRAW (checked via flag)
        else if (nextStep === "MAIN1" && !(ctx as any)._skipMain1TriggerCheck) {
          runTurnStepMain1(ctx, turnPlayer, usePersistedTurnStepTriggers, pushTriggersToStack);
        }

        // Beginning of postcombat main phase / second main phase triggers.
        else if (nextStep === "MAIN2") {
          const postcombatMainTriggers = getPostcombatMainTriggers(ctx, turnPlayer);
          pushTriggersToStack(postcombatMainTriggers, 'postcombat_main', 'main');
          debug(2, `${ts()} [nextStep] Checking postcombat main triggers for ${turnPlayer}, found ${postcombatMainTriggers.length} trigger(s)`);
        }
        
        // Clear the skip flag after processing triggers
        if ((ctx as any)._skipMain1TriggerCheck) {
          delete (ctx as any)._skipMain1TriggerCheck;
        }
        
        // Rule 507.1: Beginning of combat - "at the beginning of combat" triggers
        // CRITICAL: These MUST fire before players can declare attackers
        // This includes cards like Ouroboroid, Hakbal, Delina that create tokens with haste
        else if (nextStep === "BEGIN_COMBAT") {
          const combatTriggers = getBeginningOfCombatTriggers(ctx, turnPlayer);
          pushTriggersToStack(combatTriggers, 'begin_combat', 'combat');
        }
        
        // Rule 511.1: End of combat - "at end of combat" triggers
        else if (nextStep === "END_COMBAT") {
          const delayedCombatCleanupTriggers = dequeuePendingEndOfCombatZoneChangeTriggers(ctx);
          const endCombatTriggers = [
            ...getEndOfCombatTriggers(ctx, turnPlayer),
            ...delayedCombatCleanupTriggers,
          ];
          pushTriggersToStack(endCombatTriggers, 'end_combat', 'endcombat');
          processPendingFlickerReturnsAtBeginningOfEndStep(ctx, turnPlayer, 'end_combat');
        }
        
        // Rule 513.1: End step - "at the beginning of your end step" triggers
        // This includes cards like Case of the Locked Hothouse, Meren, Atraxa
        else if (nextStep === "END") {
          const endStepTriggers = getEndStepTriggers(ctx, turnPlayer);
          const delayedCleanupTriggers = dequeuePendingNextEndStepZoneChangeTriggers(ctx);
          pushTriggersToStack([...endStepTriggers, ...delayedCleanupTriggers], 'end_step', 'endstep');

          // Best-effort delayed return processing (planeswalker templates, etc.)
          processPendingFlickerReturnsAtBeginningOfEndStep(ctx, turnPlayer);
          // Impending (CR 702.176): remove a time counter at the beginning of your end step.
          processImpendingEndStepCounterRemoval(ctx);
        }
        
        grantTurnStepPriority(ctx, turnPlayer, nextStep, isReplaying);
      }
    }

    // If we should advance to next turn, call nextTurn instead
    if (shouldAdvanceTurn) {
      const cleanupResult = runTurnStepCleanup(ctx, isReplaying);
      if (cleanupResult.shouldCallNextTurn) {
        nextTurn(ctx);
      }
      return;
    }

    // If we're leaving the UNTAP step, untap all permanents controlled by the active player (Rule 502.3)
    // Note: Summoning sickness is already cleared at the beginning of the turn (in nextTurn)
    if (shouldUntap) {
      runTurnStepUntap(ctx, shouldPerformUntapStepTurnAction, untapPermanentsForPlayer);
    }

    ctx.bumpSeq();
  } catch (err) {
    debugWarn(1, `${ts()} nextStep failed:`, err);
  }
}


/**
 * Public API to check for pending interactions
 * This is exposed so the socket layer can inform players why step advancement is blocked
 */
export function getPendingInteractions(ctx: GameContext): {
  hasPending: boolean;
  pendingTypes: string[];
  details: Record<string, any>;
} {
  return checkPendingInteractions(ctx);
}

export default {
  passPriority,
  setTurnDirection,
  nextTurn,
  nextStep,
  scheduleStepsAfterCurrent,
  scheduleStepsAtEndOfTurn,
  clearScheduledSteps,
  getScheduledSteps,
  removeScheduledSteps,
  addExtraTurn,
  getExtraTurns,
  skipExtraTurn,
  getPendingInteractions,
  didCreatureDealDamageToPlayer,
  getCreaturesThatDealtDamageToPlayer,
};


