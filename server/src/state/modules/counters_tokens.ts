import type { PlayerID } from "../../../../shared/src";
import { countDevotionAmongPermanents } from "../../../../shared/src/devotionCount.js";
import { buildZoneObjectWithRetainedCounters } from "../../../../shared/src/zoneRetainedCounters";
import type { GameContext } from "../context";
import { applyStateBasedActions, evaluateAction } from "../../rules-engine";
import { uid, parsePT, parseWordNumber, triggerLifeGainEffects } from "../utils";
import { processLifeChange, recalculatePlayerEffects, processPendingEmptyLibraryDrawAttempts, applyAscendCitysBlessing } from "./game-state-effects.js";
import { evaluateCounterPlacementReplacementEvent, evaluateTokenCreationReplacementEvent } from "./replacement-effects.js";
import { getDeathTriggers, processLinkedExileReturns } from "./triggered-abilities.js";
import { pushTriggerDoublerCopies } from "./triggers/combat.js";
import { isInterveningIfSatisfied } from "./triggers/intervening-if.js";
import { getTokenImageUrls, buildTokenImageSpec, resolveTokenPrinting, applyTokenPrintingToCard, lookupExactTokenPrinting, getCommonToken } from "../../services/tokens.js";
import { deriveCreateTokenSourceFragment, extractCreateTokenGrantedAbilities } from "../../../../rules-engine/src/oracleReminderText.js";
import { debug, debugWarn, debugError } from "../../utils/debug.js";
import { appendEvent } from '../../db/index.js';
import { ResolutionQueueManager } from "../resolution/index.js";
import { ResolutionStepType } from "../resolution/types.js";
import { ensureInitialDayNightDesignationFromBattlefield } from "./day-night.js";
import { recordCardPutIntoGraveyardThisTurn } from "./turn-tracking.js";
import { cleanupCardLeavingExile } from "./playable-from-exile.js";
import { clearPreparedPermanent } from "./prepared.js";
import { applyShieldCounterDamagePrevention } from "./counter-common-effects.js";
import { pushCardToPlayerGraveyardWithReplacements } from "./graveyardEntryUtils.js";
import { inferManaValueConstraintFromText } from "./graveyard-mana-value.js";
import { detectKeywords } from "./keyword-detection.js";
import {
  applyLeaveBattlefieldReplacementLifeGain,
  tryApplyDeclarativeGraveyardDestinationReplacement,
  tryApplyDeclarativeLeaveBattlefieldDestinationReplacement,
} from "./zone-manipulation.js";
import { registerLinkedExile } from "./triggers/linked-exile.js";
import { inferCommanderExileFollowup } from "./commanderExileFollowup.js";
import { queueCounterPlacedTriggers, queueCounterRemovedTriggers } from "./triggers/counters.js";
import { orderTriggersByAPNAP } from "./triggers/ordering.js";
import { drawCards as drawCardsFromZone } from './zones.js';
import { repairCardIdAwayFromZones } from './stackReplayUtils.js';

export type UpdateCountersOptions = {
  deferRunSBA?: boolean;
  skipCounterModifications?: boolean;
  /** When true, do not append updateCounters to the event log (replay/applyEvent/oracle-IR batch paths). */
  skipEventPersistence?: boolean;
  /** Oracle IR already queued the placement trigger for the full modified amount. */
  skipCounterPlacedTriggers?: boolean;
};

function persistUpdateCountersEvent(
  ctx: GameContext,
  permanentId: string,
  effectiveDeltas: Record<string, number>,
  options?: Pick<UpdateCountersOptions, 'skipCounterModifications'>,
): void {
  if ((ctx as any).isReplaying) return;
  if (Object.keys(effectiveDeltas).length === 0) return;

  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown') return;

  try {
    appendEvent(
      gameId,
      Number((ctx as any).seq?.value ?? (ctx as any).seq ?? (ctx.state as any)?.seq ?? 0),
      'updateCounters',
      {
        permanentId,
        deltas: effectiveDeltas,
        ...(options?.skipCounterModifications ? { skipCounterModifications: true } : {}),
      },
    );
  } catch (err) {
    debugWarn(1, '[updateCounters] appendEvent(updateCounters) failed:', err);
  }
}
import { triggerETBEffectsForPermanent } from './triggerEtbPermanentEffects.js';
import { queueExiledFromBattlefieldTriggers } from "./triggers/zone-change.js";
import { processLTBTriggers } from "./triggerEmissionFamilyUtils.js";
import { buildWarpedExileCardMarkers, permanentShouldExileAsWarped } from "./warpDelayedEffects.js";
import { queueTokenCreatedTriggers } from "./triggers/tokens.js";
import { syncDerivedContinuousEffects } from "./staticEffectSpec.js";
import { applyStatefulPaperKeywordSBAs } from "./statefulPaperKeywords.js";
import { hydrateCardOracleInPlace, hydrateGameStateOracleText } from './cardOracleHydration.js';
import {
  applyCopyTokenOverrides,
  type CopyTokenOverrides,
} from '../../../../shared/src/copyTokenOverrides.js';
import { copyAsEntersCopiableChoicesFromSource } from '../../../../shared/src/copyTokenUtils.js';

function applyProcessedLifeGain(ctx: GameContext, playerId: PlayerID, amount: number): number {
  const numericAmount = Number(amount || 0);
  if (numericAmount <= 0) {
    return 0;
  }

  const state = (ctx as any).state;
  const startingLife = state?.startingLife || 40;
  const currentLife = state?.life?.[playerId] ?? startingLife;
  const result = processLifeChange(ctx, playerId, numericAmount, true);
  if (result.prevented || result.finalAmount === 0) {
    return 0;
  }

  if (!state.life) state.life = {};
  state.life[playerId] = currentLife + result.finalAmount;

  const player = Array.isArray(state.players)
    ? state.players.find((entry: any) => String(entry?.id || '') === String(playerId || ''))
    : undefined;
  if (player) {
    player.life = state.life[playerId];
  }

  try {
    if (result.finalAmount > 0) {
      (state as any).lifeGainedThisTurn = (state as any).lifeGainedThisTurn || {};
      (state as any).lifeGainedThisTurn[playerId] = ((state as any).lifeGainedThisTurn[playerId] || 0) + result.finalAmount;
      triggerLifeGainEffects(state, playerId, result.finalAmount);
    } else if (result.finalAmount < 0) {
      (state as any).lifeLostThisTurn = (state as any).lifeLostThisTurn || {};
      (state as any).lifeLostThisTurn[playerId] = ((state as any).lifeLostThisTurn[playerId] || 0) + Math.abs(result.finalAmount);
    }
  } catch {
    // Best-effort tracking only.
  }

  return result.finalAmount;
}

function clearPreparedStateOnBattlefieldExit(state: any, permanent: any): void {
  if (!permanent) {
    return;
  }

  try {
    const { unpairPermanent } = require('./soulbond.js') as typeof import('./soulbond.js');
    unpairPermanent(state, permanent);
  } catch {
    // best-effort soulbond cleanup
  }

  const hasPreparedState =
    permanent?.prepared === true ||
    permanent?.isPrepared === true ||
    Boolean(String(permanent?.preparedExileCopyCardId || '').trim()) ||
    permanent?.card?.prepared === true ||
    permanent?.card?.isPrepared === true ||
    Boolean(String(permanent?.card?.preparedExileCopyCardId || '').trim());

  if (!hasPreparedState) {
    return;
  }

  clearPreparedPermanent(state, permanent);
}

import { setCountersTokensHandlerDeps } from "./counters_tokens-handlers/countersTokensHandlerDeps.js";


export function trackPermanentSacrificedThisTurn(state: any, permanent: any): void {
  try {
    const controllerId = permanent?.controller != null ? String(permanent.controller) : '';
    if (!controllerId) return;

    const typeLine = String(permanent?.card?.type_line || '').toLowerCase();
    const cardName = String(permanent?.card?.name || '').toLowerCase();
    const stateAny = state as any;

    const isClue = typeLine.includes('clue') && (typeLine.includes('artifact') || typeLine.includes('token'));
    if (isClue && (cardName === 'clue' || typeLine.includes('— clue') || typeLine.includes('- clue') || typeLine.includes('clue'))) {
      stateAny.sacrificedCluesThisTurn = stateAny.sacrificedCluesThisTurn || {};
      stateAny.sacrificedCluesThisTurn[controllerId] = (stateAny.sacrificedCluesThisTurn[controllerId] || 0) + 1;

      stateAny.cluesSacrificedThisTurn = stateAny.cluesSacrificedThisTurn || {};
      stateAny.cluesSacrificedThisTurn[controllerId] = (stateAny.cluesSacrificedThisTurn[controllerId] || 0) + 1;

      stateAny.cluesSacrificedThisTurnCount = stateAny.cluesSacrificedThisTurnCount || {};
      stateAny.cluesSacrificedThisTurnCount[controllerId] = (stateAny.cluesSacrificedThisTurnCount[controllerId] || 0) + 1;
    }

    stateAny.permanentsSacrificedThisTurn = stateAny.permanentsSacrificedThisTurn || {};
    stateAny.permanentsSacrificedThisTurn[controllerId] = (stateAny.permanentsSacrificedThisTurn[controllerId] || 0) + 1;

    const isFood = typeLine.includes('food') && (typeLine.includes('artifact') || typeLine.includes('token'));
    if (isFood && (cardName === 'food' || typeLine.includes('— food') || typeLine.includes('- food') || typeLine.includes('food'))) {
      stateAny.foodsSacrificedThisTurn = stateAny.foodsSacrificedThisTurn || {};
      stateAny.foodsSacrificedThisTurn[controllerId] = (stateAny.foodsSacrificedThisTurn[controllerId] || 0) + 1;
    }
  } catch {
    // best-effort tracking only
  }
}

export function applyCounterModifications(
  gameState: any,
  targetPermanentId: string,
  deltas: Record<string, number>
): Record<string, number> {
  const targetPermanent = (gameState?.battlefield || []).find((p: any) => p.id === targetPermanentId);
  if (!targetPermanent) return deltas;

  const replacement = evaluateCounterPlacementReplacementEvent({
    state: gameState,
    targetPermanentId,
    controllerId: targetPermanent.controller,
    deltas,
  });
  return ((replacement.metadata as any)?.modifiedDeltas as Record<string, number> | undefined) || deltas;
}

const PLUS_ONE_COUNTER_ALIASES = new Set(['+1/+1', 'p1p1', 'plus_one', 'plusone', 'plus1plus1', '+1+1']);
const MINUS_ONE_COUNTER_ALIASES = new Set(['-1/-1', 'm1m1', 'minus_one', 'minusone', 'minus1minus1', '-1-1']);

/**
 * Canonical stored keys follow oracle text: '+1/+1' and '-1/-1'. P/T, SBA, and trigger
 * code read those keys, so legacy aliases (e.g. a sanitizer that stripped the slash into
 * '+1+1') must never reach `permanent.counters`. Other counter types pass through as-is.
 */
export function canonicalizeCounterKey(key: string): string {
  const raw = String(key || '').trim();
  const lower = raw.toLowerCase();
  if (PLUS_ONE_COUNTER_ALIASES.has(lower)) return '+1/+1';
  if (MINUS_ONE_COUNTER_ALIASES.has(lower)) return '-1/-1';
  return raw;
}

function canonicalizeCounterDeltas(deltas: Record<string, number>): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [key, value] of Object.entries(deltas || {})) {
    const canonical = canonicalizeCounterKey(key);
    if (!canonical) continue;
    next[canonical] = (next[canonical] || 0) + (Number(value) || 0);
  }
  return next;
}

/** Fold leftover '+1+1' / '-1-1' (and other aliases) onto the oracle-text keys. */
function canonicalizeStoredCounters(counters: Record<string, number> | undefined): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [key, value] of Object.entries(counters || {})) {
    const amount = Math.floor(Number(value) || 0);
    if (!amount) continue;
    const canonical = canonicalizeCounterKey(key);
    if (!canonical) continue;
    next[canonical] = (next[canonical] || 0) + amount;
    if (next[canonical] <= 0) delete next[canonical];
  }
  return next;
}

export function updateCounters(
  ctx: GameContext,
  permanentId: string,
  deltas: Record<string, number>,
  options?: UpdateCountersOptions,
) {
  const { state, bumpSeq } = ctx;
  const p = state.battlefield.find(b => b.id === permanentId);
  if (!p) return;

  const canonicalDeltas = canonicalizeCounterDeltas(deltas);

  // Apply counter modification effects (Vorinclex, Doubling Season, Hardened Scales, etc.)
  const modifiedDeltas = options?.skipCounterModifications
    ? canonicalDeltas
    : applyCounterModifications(state, permanentId, canonicalDeltas);

  trackCountersPlacedThisTurn(state, p, permanentId, modifiedDeltas);
  
  const current: Record<string, number> = canonicalizeStoredCounters(p.counters as Record<string, number> | undefined);
  const removedDeltas: Record<string, number> = {};
  const effectiveDeltas: Record<string, number> = {};
  for (const [k, vRaw] of Object.entries(modifiedDeltas)) {
    const v = Math.floor(Number(vRaw) || 0);
    if (!v) continue;
    if (v < 0) {
      const removed = Math.min(Number(current[k] || 0), Math.abs(v));
      if (removed > 0) {
        removedDeltas[k] = (removedDeltas[k] || 0) + removed;
        effectiveDeltas[k] = (effectiveDeltas[k] || 0) - removed;
      }
    } else {
      effectiveDeltas[k] = (effectiveDeltas[k] || 0) + v;
    }
    current[k] = (current[k] ?? 0) + v;
    if (current[k] <= 0) delete current[k];
  }
  p.counters = Object.keys(current).length ? current : undefined;
  // Keep top-level loyalty in sync for client display / PW ability checks.
  if (Object.prototype.hasOwnProperty.call(modifiedDeltas, 'loyalty')) {
    (p as any).loyalty = Number(current['loyalty'] || 0);
  }
  if (!options?.skipCounterPlacedTriggers) {
    queueCounterPlacedTriggers(ctx, p, permanentId, modifiedDeltas);
  }
  queueCounterRemovedTriggers(ctx, p, permanentId, removedDeltas);

  if (!options?.skipEventPersistence) {
    persistUpdateCountersEvent(ctx, permanentId, effectiveDeltas, {
      skipCounterModifications: options?.skipCounterModifications,
    });
  }

  bumpSeq();
  if (!options?.deferRunSBA) {
    runSBA(ctx);
  }
}

export function applyUpdateCountersBulk(
  ctx: GameContext,
  updates: { permanentId: string; deltas: Record<string, number> }[],
  options?: UpdateCountersOptions,
) {
  // Counters/damage on many permanents are one simultaneous change: SBA once at the end
  // (CR 704.3), matching live resolution, instead of a full pass per permanent.
  const list = Array.isArray(updates) ? updates : [];
  for (const u of list) {
    if (!u || !u.permanentId) continue;
    updateCounters(ctx, String(u.permanentId), u.deltas || {}, { ...options, deferRunSBA: true });
  }
  if (list.length > 0 && !options?.deferRunSBA) runSBA(ctx);
}

export function trackCountersPlacedThisTurn(
  state: any,
  permanent: any,
  permanentId: string,
  deltas: Record<string, number>
): void {
  const isPlusOneCounterKey = (key: string): boolean => {
    const normalized = String(key || '').trim().toLowerCase();
    if (!normalized) return false;
    return normalized === '+1/+1' || normalized === 'p1p1' || normalized === 'plus_one' || normalized === 'plusone' || normalized === 'plus1plus1' || normalized === '+1+1';
  };

  // Turn-tracking for intervening-if templates like:
  // "if a +1/+1 counter was put on a permanent under your control this turn".
  try {
    const controllerId = String((permanent as any)?.controller || '').trim();
    if (controllerId) {
      const placedPlusOne = Object.entries(deltas).some(
        ([counterType, amount]) => isPlusOneCounterKey(counterType) && Number(amount) > 0
      );
      if (placedPlusOne) {
        const stateAny = state as any;
        stateAny.putPlusOneCounterOnPermanentThisTurn = stateAny.putPlusOneCounterOnPermanentThisTurn || {};
        stateAny.putPlusOneCounterOnPermanentThisTurn[controllerId] = true;
        stateAny.placedPlusOneCounterOnPermanentThisTurn = stateAny.placedPlusOneCounterOnPermanentThisTurn || {};
        stateAny.plusOneCounterPlacedOnPermanentThisTurn = stateAny.plusOneCounterPlacedOnPermanentThisTurn || {};
        stateAny.placedPlusOneCounterOnPermanentThisTurn[controllerId] = true;
        stateAny.plusOneCounterPlacedOnPermanentThisTurn[controllerId] = true;
      }
    }
  } catch {
    // best-effort only
  }

  // Turn-tracking for intervening-if templates like:
  // "if you put a counter on a creature this turn".
  try {
    const controllerId = String((permanent as any)?.controller || '').trim();
    if (controllerId) {
      const typeLine = String((permanent as any)?.card?.type_line || '').toLowerCase();
      const isCreature = typeLine.includes('creature');
      const anyPositive = Object.values(deltas).some((amount) => Number(amount) > 0);
      if (isCreature && anyPositive) {
        const stateAny = state as any;
        stateAny.putCounterOnCreatureThisTurn = stateAny.putCounterOnCreatureThisTurn || {};
        stateAny.placedCounterOnCreatureThisTurn = stateAny.placedCounterOnCreatureThisTurn || {};
        stateAny.countersPlacedOnCreaturesThisTurn = stateAny.countersPlacedOnCreaturesThisTurn || {};
        stateAny.putCounterOnCreatureThisTurn[controllerId] = true;
        stateAny.placedCounterOnCreatureThisTurn[controllerId] = true;
        stateAny.countersPlacedOnCreaturesThisTurn[controllerId] = true;
      }
    }
  } catch {
    // best-effort only
  }

  // Event-count tracking for "first time counters were put on that permanent this turn"-style checks.
  try {
    const stateAny = state as any;
    const anyPositive = Object.values(deltas).some((amount) => Number(amount) > 0);
    if (anyPositive) {
      stateAny.putCounterOnPermanentThisTurnByPermanentId = stateAny.putCounterOnPermanentThisTurnByPermanentId || {};
      stateAny.putCounterOnPermanentThisTurnByPermanentId[String(permanentId)] = true;
      stateAny.countersPutThisTurnByPermanentId = stateAny.countersPutThisTurnByPermanentId || {};
      stateAny.countersPutThisTurnByPermanentId[String(permanentId)] =
        Number(stateAny.countersPutThisTurnByPermanentId[String(permanentId)] || 0) + 1;
    }

    const plusOnePositive = Object.entries(deltas).some(
      ([counterType, amount]) => isPlusOneCounterKey(counterType) && Number(amount) > 0
    );
    if (plusOnePositive) {
      stateAny.plusOneCountersPutThisTurnByPermanentId = stateAny.plusOneCountersPutThisTurnByPermanentId || {};
      stateAny.plusOneCountersPutThisTurnByPermanentId[String(permanentId)] =
        Number(stateAny.plusOneCountersPutThisTurnByPermanentId[String(permanentId)] || 0) + 1;
    }
  } catch {
    // best-effort only
  }
}

export function getTokenDoublerMultiplier(controller: PlayerID, state: any): number {
  let multiplier = 1;
  const battlefield = state.battlefield || [];

  for (const perm of battlefield) {
    const permName = (perm.card?.name || '').toLowerCase();
    const permOracle = (perm.card?.oracle_text || '').toLowerCase();

    if (permName.includes('primal vigor')) {
      multiplier *= 2;
      continue;
    }

    if (perm.controller !== controller) continue;

    if (permName.includes('ojer taq') ||
        (permOracle.includes('three times that many') && permOracle.includes('token'))) {
      multiplier *= 3;
    }

    if (permName.includes('anointed procession') ||
        permName.includes('parallel lives') ||
        permName.includes('doubling season') ||
        permName.includes('mondrak, glory dominus') ||
        permName.includes('adrix and nev') ||
        (permName.includes('elspeth') && permOracle.includes('twice that many')) ||
        (permOracle.includes('twice that many') && permOracle.includes('token'))) {
      multiplier *= 2;
    }
  }

  return multiplier;
}

export { createToken, createCopyTokensOfCard } from "./counters_tokens-handlers/countersTokensCreateToken.js";
export type { CreateTokenOptions } from "./counters_tokens-handlers/countersTokensCreateToken.js";


import { movePermanentToGraveyard } from "./counters_tokens-handlers/countersTokensMoveToGraveyard.js";
export { movePermanentToGraveyard };

export function destroyPermanent(ctx: GameContext, permanentId: string, triggerDeathEffects = true): boolean {
  const { state, bumpSeq } = ctx;
  const normalizedId = String(permanentId || '').trim();
  if (!normalizedId) return false;

  const perm = Array.isArray(state.battlefield)
    ? state.battlefield.find((entry: any) => entry && String(entry.id || '') === normalizedId)
    : null;
  if (!perm) return false;

  if (applyShieldCounterDamagePrevention(perm)) {
    bumpSeq();
    return true;
  }

  return movePermanentToGraveyard(ctx, normalizedId, triggerDeathEffects);
}

export function removePermanent(ctx: GameContext, permanentId: string) {
  const { state, bumpSeq } = ctx;
  const idx = state.battlefield.findIndex(p => p.id === permanentId);
  if (idx >= 0) {
    const perm = state.battlefield.splice(idx,1)[0];
    clearPreparedStateOnBattlefieldExit(state, perm);
    const removedPermanentId = String((perm as any)?.id || permanentId || '').trim();
    const controller = String((perm as any)?.controller || (perm as any)?.owner || '').trim();
    const owner = String((perm as any)?.owner || controller || '').trim();
    try {
      if (controller) {
        (state as any).permanentLeftBattlefieldThisTurn = (state as any).permanentLeftBattlefieldThisTurn || {};
        (state as any).permanentLeftBattlefieldThisTurn[controller] = true;
      }
    } catch {
      // best-effort tracking only
    }

    const leaveReplacement = tryApplyDeclarativeLeaveBattlefieldDestinationReplacement(
      ctx,
      perm,
      owner,
      {
        intendedDestination: 'graveyard',
        controller,
        permanentId: removedPermanentId,
        cause: 'leave',
      },
    );
    if (leaveReplacement.handled) {
      applyLeaveBattlefieldReplacementLifeGain(ctx, leaveReplacement, controller);
      if (removedPermanentId) {
        processLinkedExileReturns(ctx, removedPermanentId);
      }
      if (leaveReplacement.replacementDestination !== 'exile') {
        bumpSeq();
      }
      runSBA(ctx);
      try {
        recalculatePlayerEffects(ctx);
      } catch (err) {
        debugWarn(1, '[removePermanent] Failed to recalculate player effects after replacement:', err);
      }
      return;
    }

    if (removedPermanentId) {
      processLinkedExileReturns(ctx, removedPermanentId);
    }

    bumpSeq();
    runSBA(ctx);
    
    // Recalculate player effects when permanents leave (for Exploration, Font of Mythos, etc.)
    try {
      recalculatePlayerEffects(ctx);
    } catch (err) {
      debugWarn(1, '[removePermanent] Failed to recalculate player effects:', err);
    }
  }
}

export { movePermanentToExile } from "./counters_tokens-handlers/countersTokensMoveToExile.js";


import { resolveLegendRuleChoice, runSBA } from "./counters_tokens-handlers/countersTokensStateBasedActions.js";
export { resolveLegendRuleChoice, runSBA };

export function applyEngineEffects(ctx: GameContext, effects: readonly any[]) {
  if (!effects.length) return;
  for (const eff of effects) {
    switch (eff.kind) {
      case "AddCounters": updateCounters(ctx, eff.permanentId, { [eff.counter]: eff.amount }); break;
      case "DestroyPermanent": destroyPermanent(ctx, eff.permanentId); break;
    }
  }
}

/**
 * Calculate devotion to a color for a player based on their permanents
 * Devotion = sum of all instances of the color's mana symbol in mana costs of permanents they control
 * 
 * @param ctx Game context
 * @param playerId Player to calculate devotion for
 * @param color Color symbol (W, U, B, R, G)
 * @returns Total devotion to that color
 */
export function calculateDevotion(ctx: GameContext, playerId: PlayerID, color: string): number {
  const { state } = ctx;
  const battlefield = state.battlefield || [];
  
  let devotion = 0;
  const colorUpper = color.toUpperCase();
  
  for (const perm of battlefield) {
    if (perm.controller !== playerId) continue;
    
    const manaCost = (perm.card as any)?.mana_cost || '';
    
    // Count occurrences of the color symbol
    const regex = new RegExp(`\\{${colorUpper}\\}`, 'gi');
    const matches = manaCost.match(regex);
    if (matches) devotion += matches.length;
    
    // Also check hybrid mana symbols (e.g., {W/U}, {R/G})
    const hybridRegex = /\{([WUBRG])\/([WUBRG])\}/gi;
    let hybridMatch;
    while ((hybridMatch = hybridRegex.exec(manaCost)) !== null) {
      if (hybridMatch[1].toUpperCase() === colorUpper || hybridMatch[2].toUpperCase() === colorUpper) {
        devotion++;
      }
    }
    
    // Phyrexian hybrid mana (e.g., {W/P})
    const phyrexianRegex = /\{([WUBRG])\/P\}/gi;
    let phyrexMatch;
    while ((phyrexMatch = phyrexianRegex.exec(manaCost)) !== null) {
      if (phyrexMatch[1].toUpperCase() === colorUpper) {
        devotion++;
      }
    }
  }
  
  return devotion;
}

/**
 * Update all Theros-style gods on the battlefield based on devotion
 * Gods are creatures only when devotion to their color(s) meets the threshold
 * 
 * @param ctx Game context
 */
export function updateGodCreatureStatus(ctx: GameContext): void {
  const { state, bumpSeq } = ctx;
  const battlefield = state.battlefield || [];
  
  let changed = false;
  
  for (const perm of battlefield) {
    const typeLine = ((perm.card as any)?.type_line || '').toLowerCase();
    const oracleText = ((perm.card as any)?.oracle_text || '').toLowerCase();
    
    // Check if this is a Theros-style god
    if (!typeLine.includes('god') || !typeLine.includes('creature')) continue;
    
    // Check for devotion requirement pattern
    // Support both digit and word numbers (five, six, seven, etc.)
    const devotionMatch = oracleText.match(/devotion to (\w+)(?:\s+and\s+(\w+))? is less than (\d+|one|two|three|four|five|six|seven|eight|nine|ten)/i);
    if (!devotionMatch) continue;
    
    const color1 = devotionMatch[1].toLowerCase();
    const color2 = devotionMatch[2]?.toLowerCase();
    const thresholdStr = devotionMatch[3];
    
    // Use shared utility for word-to-number conversion
    const threshold = parseWordNumber(thresholdStr, 5);
    
    // Map color words to mana symbols
    const colorToSymbol: Record<string, string> = {
      'white': 'W', 'blue': 'U', 'black': 'B', 'red': 'R', 'green': 'G'
    };
    const symbol1 = colorToSymbol[color1] || color1.charAt(0).toUpperCase();
    const symbol2 = color2 ? (colorToSymbol[color2] || color2.charAt(0).toUpperCase()) : null;
    
    // Two-color devotion counts each symbol once ({R/W} is 1, not 2).
    const devotion = countDevotionAmongPermanents(
      battlefield,
      perm.controller as PlayerID,
      symbol2 ? [symbol1, symbol2] : [symbol1],
    );
    
    // Store calculated devotion for reference
    (perm as any).calculatedDevotion = devotion;
    
    // Determine if god is a creature
    const wasCreature = !(perm as any).notCreature;
    const isCreature = devotion >= threshold;
    
    if (isCreature !== wasCreature) {
      (perm as any).notCreature = !isCreature;
      changed = true;
      debug(2, `[updateGodCreatureStatus] ${(perm.card as any)?.name}: devotion ${devotion}/${threshold} - ${isCreature ? 'IS' : 'NOT'} a creature`);
    }
  }
  
  if (changed) bumpSeq();
}

setCountersTokensHandlerDeps({
  runSBA,
  movePermanentToGraveyard,
  applyCounterModifications,
  clearPreparedStateOnBattlefieldExit,
  updateGodCreatureStatus,
});
