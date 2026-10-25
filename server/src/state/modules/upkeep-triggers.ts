/**
 * upkeep-triggers.ts
 * 
 * Handles upkeep-related triggered abilities and costs:
 * - "At the beginning of your upkeep" triggers (very common!)
 * - "At the beginning of each player's upkeep" triggers
 * - "At the beginning of each upkeep" triggers
 * - Cumulative upkeep
 * - Echo
 * - Fading / Vanishing
 * - Pacts (pay or lose)
 * - Phyrexian Arena, Sheoldred, Dark Confidant style effects
 */

import type { GameContext } from "../context.js";
import { debug, debugWarn, debugError } from "../../utils/debug.js";
import { isInterveningIfSatisfied } from "./triggers/intervening-if.js";
import { queueCounterRemovedTriggers } from "./triggers/counters.js";
import { queueSacrificeTriggers } from "./triggers/sacrifice.js";
import { movePermanentToGraveyard } from "./counters_tokens.js";
import { permanentCannotBeSacrificed } from "../../../../rules-engine/src/attackRestrictionText.js";
import {
  inferUpkeepWhoseTurn,
  shouldQueuePhaseTriggerForActivePlayer,
} from "./triggers/phaseWhoseTurn.js";
import type { UpkeepTrigger } from "./upkeep-triggers-handlers/upkeepTriggerDetectHelpers.js";
import { getLastUpkeepMarker } from "./upkeep-triggers-handlers/upkeepMarkerHelpers.js";
import { detectUpkeepTriggers } from "./upkeep-triggers-handlers/upkeepTriggerDetect.js";
import { collectMatchingParsedEventLines, parsedEffectDuplicates, sameTriggerSource } from "./triggers/triggerConditionFamilyMatch.js";
import { permanentHasTriggeredAbilities } from './triggers/triggeredAbilitySuppression.js';

export type { UpkeepTrigger };
export { detectUpkeepTriggers };

export function recordUpkeepBegan(state: any, playerId: string): number {
  const nextMarker = (Number(state?.upkeepMarkerCounter || 0) || 0) + 1;
  state.upkeepMarkerCounter = nextMarker;
  state.lastUpkeepMarkerByPlayer = state.lastUpkeepMarkerByPlayer || {};
  state.lastUpkeepMarkerByPlayer[String(playerId)] = nextMarker;
  return nextMarker;
}

export function stampPermanentControlEntryForEcho(state: any, permanent: any, controllerId: string): void {
  if (!state || !permanent || !controllerId) {
    return;
  }

  const lastUpkeepMarker = getLastUpkeepMarker(state, controllerId);
  (permanent as any).echoControlUpkeepMarker = lastUpkeepMarker;
  (permanent as any).echoPaid = false;

  if (permanent.card && typeof permanent.card === 'object') {
    (permanent.card as any).echoControlUpkeepMarker = lastUpkeepMarker;
  }
}

/**
 * Detect saga lore-counter turn-based triggers for precombat main (Rule 714.3b).
 */
export function detectSagaLoreCounterTrigger(card: any, permanent: any, gameState?: any): UpkeepTrigger | null {
  if (!permanentHasTriggeredAbilities(permanent, gameState, { event: 'counters' })) return null; // Humility / Torpor Orb gate
  const typeLine = String(card?.type_line || '').toLowerCase();
  if (!typeLine.includes('saga')) {
    return null;
  }

  const cardName = card?.name || 'Unknown';
  const permanentId = permanent?.id || '';
  const oracleText = card?.oracle_text || '';
  const counters = permanent?.counters || {};
  const currentLore = Number(counters['lore'] ?? 0) || 0;

  const chapterAbilities = parseSagaChapters(oracleText);
  const maxChapter = chapterAbilities.length > 0
    ? Math.max(...chapterAbilities.map((chapter) => chapter.chapter))
    : 3;

  if (currentLore >= maxChapter) {
    return null;
  }

  return {
    permanentId,
    cardName,
    triggerType: 'saga_lore_counter',
    description: `Add lore counter to ${cardName} (currently ${currentLore}/${maxChapter})`,
    effect: 'add_lore_counter',
    mandatory: true,
    controllerTrigger: true,
    anyPlayerTrigger: false,
    chapterAbilities,
    currentChapter: currentLore,
    maxChapter,
    imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
  };
}

/**
 * Rule 714.3b: Sagas gain a lore counter at the beginning of controller's precombat main phase.
 */
export function getSagaLoreCounterTriggers(ctx: GameContext, activePlayerId: string): UpkeepTrigger[] {
  const triggers: UpkeepTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];

  for (const permanent of battlefield) {
    if (!permanent?.card || permanent.controller !== activePlayerId) continue;
    const trigger = detectSagaLoreCounterTrigger(permanent.card, permanent, (ctx as any)?.state);
    if (trigger) {
      triggers.push(trigger);
    }
  }

  return triggers;
}

/**
 * Parse saga chapter abilities from oracle text.
 * Format: "I — effect", "II, III — effect", "I, II — effect", etc.
 */
function parseSagaChapters(oracleText: string): { chapter: number; effect: string }[] {
  const chapters: { chapter: number; effect: string }[] = [];
  if (!oracleText) return chapters;
  
  // Map Roman numerals to numbers
  const romanToNum: Record<string, number> = {
    'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5,
    'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10
  };
  
  // Regex pattern explanation for saga chapter abilities:
  // ([IVX]+(?:\s*,\s*[IVX]+)*) - Capture group 1: Chapter numbers
  //   [IVX]+ - One or more Roman numeral characters (I, II, III, IV, V, etc.)
  //   (?:\s*,\s*[IVX]+)* - Optionally match comma-separated additional chapters (for multi-chapter abilities like "II, III — effect")
  // \s*[—-]\s* - Match the separator (em dash or hyphen) with optional whitespace
  // ([^IVX\n]+?) - Capture group 2: The effect text (non-greedy)
  //   [^IVX\n]+? - Any characters except Roman numerals or newlines
  // (?=\n[IVX]+\s*[—-]|$) - Lookahead: Stop at next chapter or end of string
  const chapterPattern = /([IVX]+(?:\s*,\s*[IVX]+)*)\s*[\u2014-]\s*([^\n]+?)(?=\n[IVX]+\s*[\u2014-]|$)/g;
  
  let match;
  while ((match = chapterPattern.exec(oracleText)) !== null) {
    const chapterNums = match[1];
    const effect = match[2].trim();
    
    // Parse the chapter numbers (may be comma-separated for multi-chapter abilities)
    const numericChapters = chapterNums
      .split(/\s*,\s*/)
      .map(roman => romanToNum[roman.trim()] || 0)
      .filter(n => n > 0);
    
    for (const num of numericChapters) {
      chapters.push({ chapter: num, effect });
    }
  }
  
  // Sort by chapter number
  chapters.sort((a, b) => a.chapter - b.chapter);
  
  return chapters;
}

/**
 * Get all upkeep triggers for the current player's upkeep
 */
export function getUpkeepTriggersForPlayer(ctx: GameContext, activePlayerId: string): UpkeepTrigger[] {
  const triggers: UpkeepTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  const players = Object.keys((ctx as any).zones || {});
  
  for (const permanent of battlefield) {
    if (!permanent) continue;
    
    const controller = permanent.controller;
    const cardTriggers = detectUpkeepTriggers(permanent.card, permanent, (ctx as any).state);
    
    for (const trigger of cardTriggers) {
      // Intervening-if (Rule 603.4): if the condition is false at the time the trigger
      // would trigger, the ability does not trigger and should not be put on the stack.
      // If the condition is unrecognized, keep the trigger (conservative fallback).
      const raw = String(trigger.effect || trigger.description || '').trim();
      let interveningText = raw;
      if (interveningText && !/^(?:when|whenever|at)\b/i.test(interveningText)) {
        // Many upkeep detectors store only the post-comma fragment (effect text).
        // Wrap with a synthetic trigger header so intervening-if extraction can run.
        if (trigger.anyPlayerTrigger || trigger.triggerType === 'each_player_upkeep') {
          interveningText = `At the beginning of each player's upkeep, ${interveningText}`;
        } else if (trigger.triggerType === 'each_upkeep') {
          interveningText = `At the beginning of each upkeep, ${interveningText}`;
        } else if (trigger.triggerType === 'opponent_upkeep') {
          interveningText = `At the beginning of each opponent's upkeep, ${interveningText}`;
        } else if (trigger.triggerType === 'saga_lore_counter') {
          interveningText = `At the beginning of your precombat main phase, ${interveningText}`;
        } else {
          interveningText = `At the beginning of your upkeep, ${interveningText}`;
        }
      }

      const needsThatPlayerRef = /\bthat player\b/i.test(interveningText);
      const needsTheirTurnRef = /\btheir\s+turn\b/i.test(interveningText) || /\bthat player's\s+turn\b/i.test(interveningText);

      const ok = isInterveningIfSatisfied(
        ctx,
        controller,
        interveningText,
        permanent,
        (needsThatPlayerRef || needsTheirTurnRef)
          ? {
              thatPlayerId: activePlayerId,
              referencedPlayerId: activePlayerId,
              theirPlayerId: activePlayerId,
            }
          : undefined
      );
      if (ok === false) continue;

      if (!shouldQueuePhaseTriggerForActivePlayer({
        whose: inferUpkeepWhoseTurn(trigger.triggerType),
        activePlayerId,
        controllerId: String(controller || ''),
        sourcePermanent: permanent,
        state: (ctx as any).state,
      })) {
        continue;
      }
      triggers.push(trigger);
    }

    for (const line of collectMatchingParsedEventLines({
      ctx,
      oracleText: String(permanent.card?.oracle_text || ''),
      event: 'beginning_of_upkeep',
      subjectPermanent: permanent,
      subjectControllerId: String(controller || ''),
      sourcePermanent: permanent,
      activePlayerId,
    })) {
      const normalized = line.effect.toLowerCase();
      if (triggers.some((existing) => (
        sameTriggerSource(existing, permanent)
        && parsedEffectDuplicates([existing.effect, existing.description], line)
      ))) continue;
      const turn = line.condition?.whoseTurn;
      triggers.push({
        permanentId: String(permanent.id || ''),
        cardName: String(permanent.card?.name || 'Unknown'),
        triggerType: turn === 'each_player' ? 'each_player_upkeep' : turn === 'each_opponent' ? 'opponent_upkeep' : 'upkeep_effect',
        description: line.effect,
        effect: line.effect,
        mandatory: !/\byou may\b/i.test(line.effect),
        controllerTrigger: turn !== 'each_player' && turn !== 'each_opponent',
        anyPlayerTrigger: turn === 'each_player',
      });
    }
  }
  
  // Sort by mandatory first, then by card name
  triggers.sort((a, b) => {
    if (a.mandatory !== b.mandatory) return a.mandatory ? -1 : 1;
    return a.cardName.localeCompare(b.cardName);
  });
  
  return triggers;
}

/**
 * Process cumulative upkeep - add age counter
 */
export function addAgeCounter(ctx: GameContext, permanentId: string): number {
  const battlefield = ctx.state?.battlefield || [];
  const permanent = battlefield.find((p: any) => p?.id === permanentId);
  
  if (permanent) {
    const counters = { ...(permanent.counters || {}) };
    counters["age"] = (counters["age"] || 0) + 1;
    (permanent as any).counters = counters;
    ctx.bumpSeq();
    return counters["age"];
  }
  return 0;
}

/**
 * Process fading - remove fade counter
 */
export function removeFadeCounter(ctx: GameContext, permanentId: string): boolean {
  const battlefield = ctx.state?.battlefield || [];
  const permanent = battlefield.find((p: any) => p?.id === permanentId);
  
  if (permanent && permanent.counters?.["fade"] > 0) {
    const counters = { ...(permanent.counters || {}) };
    counters["fade"] -= 1;
    (permanent as any).counters = counters;
    queueCounterRemovedTriggers(ctx, permanent, permanentId, { fade: 1 });
    ctx.bumpSeq();
    return counters["fade"] > 0;
  }
  return false;
}

/**
 * Process vanishing - remove time counter
 */
export function removeTimeCounter(ctx: GameContext, permanentId: string): boolean {
  const battlefield = ctx.state?.battlefield || [];
  const permanent = battlefield.find((p: any) => p?.id === permanentId);
  
  if (permanent && permanent.counters?.["time"] > 0) {
    const counters = { ...(permanent.counters || {}) };
    counters["time"] -= 1;
    (permanent as any).counters = counters;
    queueCounterRemovedTriggers(ctx, permanent, permanentId, { time: 1 });
    ctx.bumpSeq();
    return counters["time"] > 0;
  }
  return false;
}

/**
 * Mark echo as paid
 */
export function markEchoPaid(ctx: GameContext, permanentId: string): void {
  const battlefield = ctx.state?.battlefield || [];
  const permanent = battlefield.find((p: any) => p?.id === permanentId);
  
  if (permanent) {
    permanent.echoPaid = true;
    ctx.bumpSeq();
  }
}

/**
 * Sacrifice a permanent
 */
export function sacrificePermanent(ctx: GameContext, permanentId: string, playerId: string): string | null {
  const battlefield = ctx.state?.battlefield || [];
  const idx = battlefield.findIndex((p: any) => p?.id === permanentId);
  
  if (idx !== -1) {
    const permanent = battlefield[idx];
    if (permanentCannotBeSacrificed(permanent, battlefield)) {
      return null;
    }
    const cardName = permanent.card?.name || "Unknown";

    // Per-turn tracking for intervening-if templates like:
    // - "if you sacrificed a permanent this turn"
    // - "if you sacrificed a Food this turn"
    try {
      const stateAny = ctx.state as any;
      const key = String(playerId || permanent?.controller || '').trim();
      if (key) {
        stateAny.permanentsSacrificedThisTurn = stateAny.permanentsSacrificedThisTurn || {};
        stateAny.permanentsSacrificedThisTurn[key] = (stateAny.permanentsSacrificedThisTurn[key] || 0) + 1;

        const tl = String(permanent?.card?.type_line || '').toLowerCase();
        const nm = String(permanent?.card?.name || '').toLowerCase();
        const isFood = tl.includes('food') && (tl.includes('artifact') || tl.includes('token'));
        if (isFood && (nm === 'food' || tl.includes('— food') || tl.includes('- food') || tl.includes('food'))) {
          stateAny.foodsSacrificedThisTurn = stateAny.foodsSacrificedThisTurn || {};
          stateAny.foodsSacrificedThisTurn[key] = (stateAny.foodsSacrificedThisTurn[key] || 0) + 1;
        }
      }
    } catch {
      // best-effort only
    }

    try {
      queueSacrificeTriggers(ctx, String(playerId || permanent?.controller || ''), permanent);
    } catch (err) {
      debugWarn(1, '[sacrificePermanent] Failed to queue sacrifice triggers:', err);
    }

    if (movePermanentToGraveyard(ctx, permanentId, true)) {
      return cardName;
    }
  }
  return null;
}

/**
 * Add a lore counter to a saga and return the new chapter abilities that should trigger.
 * Per Rule 714.3b, a lore counter is added at the beginning of controller's precombat main phase.
 * Per Rule 714.3c, each chapter ability triggers when a lore counter is added if that counter
 * brings the saga to that chapter number.
 */
export function addLoreCounter(ctx: GameContext, permanentId: string): { 
  newChapter: number; 
  triggeredAbility: { chapter: number; effect: string } | null;
  shouldSacrifice: boolean;
} {
  const battlefield = ctx.state?.battlefield || [];
  const permanent = battlefield.find((p: any) => p?.id === permanentId);
  
  if (!permanent) {
    return { newChapter: 0, triggeredAbility: null, shouldSacrifice: false };
  }
  
  const counters = (permanent as any).counters = (permanent as any).counters || {};
  counters['lore'] = (counters['lore'] || 0) + 1;
  const newLoreCount = counters['lore'];
  
  // Parse chapter abilities
  const oracleText = permanent.card?.oracle_text || '';
  const chapters = parseSagaChapters(oracleText);
  const maxChapter = chapters.length > 0 
    ? Math.max(...chapters.map(c => c.chapter)) 
    : 3;
  
  // Find the chapter ability that triggers for this lore count
  const triggeredChapter = chapters.find(c => c.chapter === newLoreCount);
  
  // Check if saga has reached final chapter (Rule 714.3d)
  // Note: Saga is sacrificed when final chapter ability LEAVES the stack (after resolving),
  // not when the lore counter is added. We return this flag to let the caller handle timing.
  const atFinalChapter = newLoreCount >= maxChapter;
  
  debug(2, `[addLoreCounter] ${permanent.card?.name || permanentId} now has ${newLoreCount} lore counter(s)${atFinalChapter ? ' (final chapter)' : ''}`);
  
  ctx.bumpSeq();
  
  return { 
    newChapter: newLoreCount, 
    triggeredAbility: triggeredChapter || null,
    shouldSacrifice: atFinalChapter // True if at final chapter - sacrifice after ability resolves
  };
}

/**
 * Check if a saga should be sacrificed (at final chapter and ability resolved).
 */
export function checkSagaSacrifice(ctx: GameContext, permanentId: string): boolean {
  const battlefield = ctx.state?.battlefield || [];
  const permanent = battlefield.find((p: any) => p?.id === permanentId);
  
  if (!permanent) return false;
  
  const typeLine = (permanent.card?.type_line || '').toLowerCase();
  if (!typeLine.includes('saga')) return false;
  
  const loreCounters = permanent.counters?.['lore'] || 0;
  const oracleText = permanent.card?.oracle_text || '';
  const chapters = parseSagaChapters(oracleText);
  const maxChapter = chapters.length > 0 
    ? Math.max(...chapters.map(c => c.chapter)) 
    : 3;
  
  return loreCounters >= maxChapter;
}

/**
 * Automatically process cumulative upkeep for mana-adding effects like Braid of Fire
 * This should be called at the beginning of upkeep, before triggers go on the stack
 * 
 * Returns: List of permanents that had mana-adding cumulative upkeep processed
 */
export function autoProcessCumulativeUpkeepMana(_ctx: GameContext, _activePlayerId: string): Array<{permanentId: string, cardName: string, manaAdded: Record<string, number>, ageCounters: number}> {
  // Superseded: "Cumulative upkeep—Add {X}" now resolves as a normal cumulative
  // upkeep trigger (add mana or sacrifice) in cumulativeUpkeepPayment.ts.
  return [];
}

