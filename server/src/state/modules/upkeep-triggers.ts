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
import { timingTriggerEffect } from './triggers/timing-effect-extraction.js';
import { debug, debugWarn, debugError } from "../../utils/debug.js";
import { isInterveningIfSatisfied } from "./triggers/intervening-if.js";
import { queueCounterRemovedTriggers } from "./triggers/counters.js";
import { queueSacrificeTriggers } from "./triggers/sacrifice.js";
import { movePermanentToGraveyard } from "./counters_tokens.js";
import { isControllerOptionalTriggeredAbilityEffect } from "./trigger-runtime-wiring.js";
import { getActivePermanentCardFace } from "./cardFaceOracle.js";

// ============================================================================
// DYNAMIC PATTERN DETECTION REGEXES
// ============================================================================

/**
 * Pattern for "sacrifice a creature, if you can't sacrifice this" style triggers
 * Matches: "At the beginning of your upkeep, sacrifice a creature. If you can't, sacrifice ~"
 * Examples: Eldrazi Monument, Demonic Appetite
 * 
 * Breakdown:
 * - `at the beginning of your upkeep,?` - matches the upkeep timing
 * - `\s*sacrifice a creature\.?` - matches "sacrifice a creature" with optional period
 * - `\s*if you (?:can't|cannot),?` - matches "if you can't" or "if you cannot"
 * - `\s*sacrifice` - matches the start of "sacrifice this/~"
 */
const SACRIFICE_CREATURE_OR_SELF_PATTERN = /at the beginning of your upkeep,?\s*sacrifice a creature\.?\s*if you (?:can't|cannot),?\s*sacrifice/i;

/**
 * Pattern for "sacrifice a creature or sacrifice this" style triggers
 * Matches: "At the beginning of your upkeep, sacrifice a creature or sacrifice ~"
 * Examples: Jinxed Idol variants
 * 
 * Breakdown:
 * - `at the beginning of your upkeep,?` - matches the upkeep timing
 * - `\s*sacrifice a creature` - matches "sacrifice a creature"
 * - `\s+or\s+sacrifice` - matches "or sacrifice" with required whitespace
 */
const SACRIFICE_OR_PATTERN = /at the beginning of your upkeep,?\s*sacrifice a creature\s+or\s+sacrifice/i;

function normalizeUpkeepEffectText(effectText: string): string {
  return String(effectText || '')
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/g, '')
    .trim();
}

function normalizeUpkeepEffectKey(effectText: string): string {
  return normalizeUpkeepEffectText(effectText)
    .toLowerCase()
    .replace(/[\u2019']/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSacrificeCreatureOrSelfOracle(oracleText: string): boolean {
  return SACRIFICE_CREATURE_OR_SELF_PATTERN.test(oracleText) || SACRIFICE_OR_PATTERN.test(oracleText);
}

function hasMatchingUpkeepEffect(
  triggers: readonly UpkeepTrigger[],
  effectText: string,
  triggerTypes: readonly UpkeepTrigger['triggerType'][] = ['upkeep_effect'],
): boolean {
  const key = normalizeUpkeepEffectKey(effectText);
  if (!key) return false;
  return triggers.some((trigger) => {
    if (!triggerTypes.includes(trigger.triggerType)) return false;
    return normalizeUpkeepEffectKey(String(trigger.effect || trigger.description || '')) === key;
  });
}

export interface UpkeepTrigger {
  permanentId: string;
  cardName: string;
  triggerType: 
    | 'cumulative_upkeep' 
    | 'echo' 
    | 'fading' 
    | 'vanishing' 
    | 'pact' 
    | 'upkeep_cost' 
    | 'upkeep_effect'
    | 'each_upkeep'
    | 'each_player_upkeep'
    | 'opponent_upkeep'
    | 'upkeep_create_copy'  // Progenitor Mimic - create token copy at beginning of upkeep
    | 'saga_lore_counter'   // Saga - add lore counter at beginning of your precombat main phase (Rule 714.3b)
    | 'sacrifice_creature_or_self'  // Eldrazi Monument - sacrifice a creature or sacrifice this
    | 'next_turn_upkeep'
    | 'planeswalk_and_upkeep'
    | 'rebound'
    | 'your_next_upkeep'
    | 'enchanted_controller_upkeep'
    | 'enchanted_player_first_upkeep'
    | 'enchanted_player_upkeep'
    | 'first_upkeep'
    | 'your_first_upkeep'
    | 'chosen_player_upkeep'
    | 'each_participant_upkeep'
    | 'each_other_player_upkeep'
    | 'exiled_card_owner_upkeep'
    | 'each_of_that_player_upkeep';
  cost?: string;
  description: string;
  effect?: string;
  counters?: number;
  mandatory: boolean;
  consequence?: string;
  requiresChoice?: boolean;
  controllerTrigger: boolean; // True if triggers on controller's upkeep
  anyPlayerTrigger: boolean;  // True if triggers on any player's upkeep
  copySourceId?: string; // For copy effects - the permanent to copy
  // For sagas
  chapterAbilities?: { chapter: number; effect: string }[];
  currentChapter?: number;
  maxChapter?: number;
  // For sacrifice_creature_or_self - the type of permanent to sacrifice if no creatures
  sacrificeAlternativeType?: string;
  imageUrl?: string;
}

function getLastUpkeepMarker(state: any, playerId: string): number {
  const markers = state?.lastUpkeepMarkerByPlayer;
  const raw = markers && typeof markers === 'object' ? (markers as any)[String(playerId)] : undefined;
  return Number.isFinite(Number(raw)) ? Number(raw) : 0;
}

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

function shouldTriggerEcho(state: any, permanent: any): boolean {
  const controllerId = String(permanent?.controller || '').trim();
  const entryMarkerRaw =
    (permanent as any)?.echoControlUpkeepMarker ??
    (permanent as any)?.card?.echoControlUpkeepMarker;
  const entryMarker = Number(entryMarkerRaw);
  if (controllerId && Number.isFinite(entryMarker)) {
    return entryMarker === getLastUpkeepMarker(state, controllerId);
  }

  const recentControlFlags = [
    (permanent as any)?.cameUnderYourControlThisTurn,
    (permanent as any)?.gainedControlThisTurn,
    (permanent as any)?.cameUnderControlThisTurn,
    (permanent as any)?.enteredThisTurn,
    (permanent as any)?.enteredBattlefieldThisTurn,
    (permanent as any)?.card?.cameUnderYourControlThisTurn,
    (permanent as any)?.card?.gainedControlThisTurn,
    (permanent as any)?.card?.cameUnderControlThisTurn,
    (permanent as any)?.card?.enteredThisTurn,
    (permanent as any)?.card?.enteredBattlefieldThisTurn,
  ];

  if (recentControlFlags.some((flag) => flag === true)) {
    return true;
  }

  if (recentControlFlags.some((flag) => typeof flag === 'boolean')) {
    return false;
  }

  return false;
}

/**
 * Detect upkeep triggers from a card's oracle text
 */
export function detectUpkeepTriggers(card: any, permanent: any, state?: any): UpkeepTrigger[] {
  const triggers: UpkeepTrigger[] = [];
  const activeFace = getActivePermanentCardFace(card, permanent);
  const oracleText = activeFace.oracleText;
  const lowerOracle = oracleText.toLowerCase();
  const cardName = activeFace.cardName;
  const permanentId = permanent?.id || "";
  const counters = permanent?.counters || {};
  
  const sacrificeCreatureOrSelf = isSacrificeCreatureOrSelfOracle(oracleText);
  
  // Cumulative upkeep - adds age counter, pay cost for each
  const cumulativeMatch = oracleText.match(/cumulative upkeep[—\-\s]*(\{[^}]+\}(?:\s*\{[^}]+\})*|[^(.\n]+)/i);
  if (cumulativeMatch) {
    const ageCounters = (counters["age"] || 0) + 1;
    const cost = cumulativeMatch[1].trim();
    
    // Special case: Braid of Fire has "Cumulative upkeep—Add {R}" or similar
    // This ADDS mana instead of requiring payment
    // Match patterns like "Add {R}", "Add {R}{R}", "Add {R}{G}", "Add {C}", etc.
    // Supports {W}{U}{B}{R}{G}{C} for all mana types
    const isAddingMana = /^add\s+(?:\{[WUBRGC]\})+$/i.test(cost);
    
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'cumulative_upkeep',
      cost: cost,
      description: isAddingMana 
        ? `${cost} for each age counter (will be ${ageCounters})`
        : `Pay ${cost} for each age counter (will be ${ageCounters})`,
      counters: ageCounters,
      mandatory: isAddingMana, // Adding mana is mandatory, payment is optional
      consequence: isAddingMana ? undefined : `Sacrifice ${cardName}`,
      controllerTrigger: true,
      anyPlayerTrigger: false,
    });
  }
  
  // Echo - pay echo cost on first upkeep after entering
  if (lowerOracle.includes("echo") && !permanent?.echoPaid && shouldTriggerEcho(state, permanent)) {
    const echoMatch = oracleText.match(/echo\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
    if (echoMatch) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'echo',
        cost: echoMatch[1],
        description: `Pay ${echoMatch[1]} or sacrifice`,
        mandatory: false,
        consequence: `Sacrifice ${cardName}`,
        controllerTrigger: true,
        anyPlayerTrigger: false,
      });
    }
  }
  
  // Fading - remove fade counter, sacrifice when none left
  if (lowerOracle.includes("fading")) {
    const fadeCounters = counters["fade"] || 0;
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'fading',
      description: fadeCounters > 0 
        ? `Remove fade counter (${fadeCounters - 1} will remain)`
        : `No fade counters - sacrifice`,
      counters: fadeCounters,
      mandatory: true,
      consequence: fadeCounters <= 1 ? `Sacrifice ${cardName}` : undefined,
      controllerTrigger: true,
      anyPlayerTrigger: false,
    });
  }
  
  // Vanishing - remove time counter, sacrifice when none left
  if (lowerOracle.includes("vanishing")) {
    const timeCounters = counters["time"] || 0;
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'vanishing',
      description: timeCounters > 0
        ? `Remove time counter (${timeCounters - 1} will remain)`
        : `No time counters - sacrifice`,
      counters: timeCounters,
      mandatory: true,
      consequence: timeCounters <= 1 ? `Sacrifice ${cardName}` : undefined,
      controllerTrigger: true,
      anyPlayerTrigger: false,
    });
  }
  
  // Pacts - pay or lose the game
  if (lowerOracle.includes("pact") && lowerOracle.includes("lose the game")) {
    const pactMatch = oracleText.match(/pay\s*(\{[^}]+\}(?:\s*\{[^}]+\})*)/i);
    if (pactMatch) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'pact',
        cost: pactMatch[1],
        description: `Pay ${pactMatch[1]} or lose the game`,
        mandatory: true,
        consequence: 'You lose the game',
        controllerTrigger: true,
        anyPlayerTrigger: false,
      });
    }
  }
  
  const nextTurnUpkeepMatch = oracleText.match(
    /at the beginning of the next turn's upkeep,?\s*([^.]+)/i,
  );
  if (nextTurnUpkeepMatch && !triggers.some((t) => t.triggerType === 'next_turn_upkeep')) {
    const effectText = timingTriggerEffect(oracleText, nextTurnUpkeepMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'next_turn_upkeep',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controllerTrigger: true,
      anyPlayerTrigger: true,
    });
  }

  const embeddedNextTurnUpkeepMatch = oracleText.match(
    /([^.]+) at the beginning of the next turn's upkeep/i,
  );
  if (
    embeddedNextTurnUpkeepMatch &&
    !triggers.some((t) => t.triggerType === 'next_turn_upkeep')
  ) {
    const effectText = timingTriggerEffect(oracleText, embeddedNextTurnUpkeepMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'next_turn_upkeep',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controllerTrigger: true,
      anyPlayerTrigger: true,
    });
  }

  const planeswalkAndUpkeepMatch = oracleText.match(
    /when you planeswalk here and at the beginning (?:of )?your upkeep,?\s*([^.]+)/i,
  );
  if (planeswalkAndUpkeepMatch && !triggers.some((t) => t.triggerType === 'planeswalk_and_upkeep')) {
    const effectText = timingTriggerEffect(oracleText, planeswalkAndUpkeepMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'planeswalk_and_upkeep',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controllerTrigger: true,
      anyPlayerTrigger: false,
    });
  }

  const reboundUpkeepMatch = oracleText.match(
    /at the beginning of your next upkeep,?\s*you may cast this card from exile[^.]*\.?/i,
  );
  if (reboundUpkeepMatch && !triggers.some((trigger) => trigger.triggerType === 'rebound')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'rebound',
      description: 'You may cast this card from exile without paying its mana cost',
      effect: 'You may cast this card from exile without paying its mana cost',
      mandatory: false,
      requiresChoice: true,
      controllerTrigger: true,
      anyPlayerTrigger: false,
    });
  }

  if (
    /\brebound\b/i.test(oracleText) &&
    !triggers.some((trigger) => trigger.triggerType === 'rebound' || trigger.triggerType === 'your_next_upkeep')
  ) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'rebound',
      description: 'You may cast this card from exile without paying its mana cost at the beginning of your next upkeep',
      effect: 'You may cast this card from exile without paying its mana cost at the beginning of your next upkeep',
      mandatory: false,
      requiresChoice: true,
      controllerTrigger: true,
      anyPlayerTrigger: false,
    });
  }

  const enchantedControllerUpkeepMatch = oracleText.match(
    /at the beginning of the upkeep of enchanted (?:creature|land|enchantment|permanent|artifact)'s controller,?\s*([^.]+)/i,
  );
  if (enchantedControllerUpkeepMatch && !triggers.some((trigger) => trigger.triggerType === 'enchanted_controller_upkeep')) {
    const effectText = timingTriggerEffect(oracleText, enchantedControllerUpkeepMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enchanted_controller_upkeep',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      requiresChoice: effectText.toLowerCase().includes('you may'),
      controllerTrigger: false,
      anyPlayerTrigger: true,
    });
  }

  const yourUpkeepPatterns = [
    /at the beginning of each of your upkeeps?,?\s*([^.]+)/i,
    /at the beginning of your next upkeep,?\s*([^.]+)/i,
    /at the beginning of your upkeep,?\s*([^.]+)/i,
  ];
  let yourUpkeepMatch: RegExpMatchArray | null = null;
  for (const pattern of yourUpkeepPatterns) {
    yourUpkeepMatch = oracleText.match(pattern);
    if (yourUpkeepMatch) break;
  }
  // Sacrifice-or-self is typed separately; avoid truncated/paraphrase duplicates.
  if (yourUpkeepMatch && !sacrificeCreatureOrSelf) {
    const effectText = normalizeUpkeepEffectText(timingTriggerEffect(oracleText, yourUpkeepMatch));
    // Fading/vanishing keyword paths already own the remove-counter/sacrifice reminder.
    const isFadingOrVanishingReminder =
      /^(?:remove a (?:fade|time) counter from (?:it|this(?:\s+\w+)?)\.?\s*)(?:if you can'?t,?\s*sacrifice (?:it|this(?:\s+\w+)?)(?:\.|$))?/i.test(
        effectText,
      );
    const hasKeywordCounterUpkeep = triggers.some((t) =>
      t.triggerType === 'fading' || t.triggerType === 'vanishing',
    );
    if (!(isFadingOrVanishingReminder && hasKeywordCounterUpkeep)) {
      const hasCost = effectText.toLowerCase().includes("pay") || effectText.toLowerCase().includes("sacrifice");
      const isOptional = isControllerOptionalTriggeredAbilityEffect(effectText);
      if (!hasMatchingUpkeepEffect(triggers, effectText, ['upkeep_effect'])) {
        triggers.push({
          permanentId,
          cardName,
          triggerType: 'upkeep_effect',
          description: effectText,
          effect: effectText,
          mandatory: !isOptional,
          requiresChoice: isOptional || hasCost || /\beach player may\b/i.test(effectText),
          controllerTrigger: true,
          anyPlayerTrigger: false,
        });
      }
    }
  }
  
  const enchantedPlayerFirstUpkeepMatch = oracleText.match(
    /at the beginning of enchanted player's first upkeep each turn,?\s*([^.]+)/i,
  );
  if (
    enchantedPlayerFirstUpkeepMatch &&
    !triggers.some((t) => t.triggerType === 'enchanted_player_first_upkeep')
  ) {
    const effectText = timingTriggerEffect(oracleText, enchantedPlayerFirstUpkeepMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enchanted_player_first_upkeep',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controllerTrigger: false,
      anyPlayerTrigger: true,
    });
  }

  const enchantedPlayerUpkeepMatch = oracleText.match(/at the beginning of enchanted player's upkeep,?\s*([^.]+)/i);
  if (enchantedPlayerUpkeepMatch && !triggers.some((t) => t.triggerType === 'enchanted_player_upkeep')) {
    const effectText = timingTriggerEffect(oracleText, enchantedPlayerUpkeepMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enchanted_player_upkeep',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controllerTrigger: false,
      anyPlayerTrigger: true,
    });
  }

  const firstUpkeepMatch = oracleText.match(/at the beginning of the first upkeep,?\s*([^.]+)/i);
  if (firstUpkeepMatch && !triggers.some((t) => t.triggerType === 'first_upkeep')) {
    const effectText = timingTriggerEffect(oracleText, firstUpkeepMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'first_upkeep',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controllerTrigger: true,
      anyPlayerTrigger: false,
    });
  }

  const yourFirstUpkeepMatch = oracleText.match(/at the beginning of your first upkeep,?\s*([^.]+)/i);
  if (yourFirstUpkeepMatch && !triggers.some((t) => t.triggerType === 'your_first_upkeep')) {
    const effectText = timingTriggerEffect(oracleText, yourFirstUpkeepMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'your_first_upkeep',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controllerTrigger: true,
      anyPlayerTrigger: false,
    });
  }

  const chosenPlayerUpkeepMatch = oracleText.match(/at the beginning of the chosen player's upkeep,?\s*([^.]+)/i);
  if (chosenPlayerUpkeepMatch && !triggers.some((t) => t.triggerType === 'chosen_player_upkeep')) {
    const effectText = timingTriggerEffect(oracleText, chosenPlayerUpkeepMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'chosen_player_upkeep',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controllerTrigger: true,
      anyPlayerTrigger: true,
    });
  }

  // "At the beginning of each player's upkeep"
  const eachPlayerUpkeepMatch = oracleText.match(/at the beginning of each player's upkeep,?\s*([^.]+)/i);
  if (eachPlayerUpkeepMatch) {
    const effectText = normalizeUpkeepEffectText(timingTriggerEffect(oracleText, eachPlayerUpkeepMatch));
    if (!hasMatchingUpkeepEffect(triggers, effectText, ['each_player_upkeep', 'upkeep_effect'])) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'each_player_upkeep',
        description: effectText,
        effect: effectText,
        mandatory: true,
        controllerTrigger: true,
        anyPlayerTrigger: true,
      });
    }
  }
  
  // "At the beginning of each upkeep"
  const eachUpkeepMatch = oracleText.match(/at the beginning of each upkeep,?\s*([^.]+)/i);
  if (eachUpkeepMatch) {
    const effectText = normalizeUpkeepEffectText(timingTriggerEffect(oracleText, eachUpkeepMatch));
    if (!hasMatchingUpkeepEffect(triggers, effectText, ['each_upkeep', 'upkeep_effect', 'each_player_upkeep'])) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'each_upkeep',
        description: effectText,
        effect: effectText,
        mandatory: true,
        controllerTrigger: true,
        anyPlayerTrigger: true,
      });
    }
  }
  
  const eachParticipantUpkeepMatch = oracleText.match(
    /at the beginning of the upkeep of each participant in this game[^,]*,?\s*([^.]+)/i,
  );
  if (eachParticipantUpkeepMatch && !triggers.some((t) => t.triggerType === 'each_participant_upkeep')) {
    const effectText = timingTriggerEffect(oracleText, eachParticipantUpkeepMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'each_participant_upkeep',
      description: effectText,
      effect: effectText,
      mandatory: true,
      controllerTrigger: false,
      anyPlayerTrigger: true,
    });
  }

  const eachOtherPlayerUpkeepMatch = oracleText.match(
    /at the beginning of each other player's upkeep,?\s*([^.]+)/i,
  );
  if (eachOtherPlayerUpkeepMatch && !triggers.some((t) => t.triggerType === 'each_other_player_upkeep')) {
    const effectText = timingTriggerEffect(oracleText, eachOtherPlayerUpkeepMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'each_other_player_upkeep',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      requiresChoice: effectText.toLowerCase().includes('you may'),
      controllerTrigger: false,
      anyPlayerTrigger: true,
    });
  }

  const exiledCardOwnerUpkeepMatch = oracleText.match(
    /at the beginning of the upkeep of the exiled card's owner,?\s*([^.]+)/i,
  );
  if (exiledCardOwnerUpkeepMatch && !triggers.some((t) => t.triggerType === 'exiled_card_owner_upkeep')) {
    const effectText = timingTriggerEffect(oracleText, exiledCardOwnerUpkeepMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'exiled_card_owner_upkeep',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controllerTrigger: false,
      anyPlayerTrigger: true,
    });
  }

  const eachOfThatPlayerUpkeepsMatch = oracleText.match(
    /at the beginning of each of that player's upkeeps,?\s*([^.]+)/i,
  );
  if (eachOfThatPlayerUpkeepsMatch && !triggers.some((t) => t.triggerType === 'each_of_that_player_upkeep')) {
    const effectText = timingTriggerEffect(oracleText, eachOfThatPlayerUpkeepsMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'each_of_that_player_upkeep',
      description: effectText,
      effect: effectText,
      mandatory: true,
      controllerTrigger: false,
      anyPlayerTrigger: true,
    });
  }

  // "At the beginning of each opponent's upkeep"
  const opponentUpkeepMatch = oracleText.match(/at the beginning of each opponent's upkeep,?\s*([^.]+)/i);
  if (opponentUpkeepMatch) {
    const effectText = normalizeUpkeepEffectText(timingTriggerEffect(oracleText, opponentUpkeepMatch));
    if (!hasMatchingUpkeepEffect(triggers, effectText, ['opponent_upkeep', 'upkeep_effect'])) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'opponent_upkeep',
        description: effectText,
        effect: effectText,
        mandatory: true,
        controllerTrigger: false,
        anyPlayerTrigger: false, // Only on opponent's turns
      });
    }
  }
  
  // ============================================================================
  // SACRIFICE CREATURE OR SELF PATTERN (Dynamic Detection)
  // ============================================================================
  // Pattern: "At the beginning of your upkeep, sacrifice a creature. If you can't, sacrifice ~"
  // or: "sacrifice a creature or sacrifice ~"
  // Examples: Eldrazi Monument, Demonic Appetite, Jinxed Idol
  // 
  // Use module-level constants for these patterns (defined at top of file)
  if (
    sacrificeCreatureOrSelf
    && !triggers.some((trigger) => trigger.triggerType === 'sacrifice_creature_or_self')
  ) {
    // Determine what type of permanent this is for the alternative sacrifice
    const permTypeLine = (activeFace.typeLine || card?.type_line || '').toLowerCase();
    let sacrificeAlternativeType = 'this permanent';
    if (permTypeLine.includes('artifact')) {
      sacrificeAlternativeType = 'this artifact';
    } else if (permTypeLine.includes('enchantment')) {
      sacrificeAlternativeType = 'this enchantment';
    } else if (permTypeLine.includes('creature')) {
      sacrificeAlternativeType = 'this creature';
    }
    
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'sacrifice_creature_or_self',
      description: `Sacrifice a creature. If you can't, sacrifice ${cardName}.`,
      effect: 'sacrifice_creature_or_self',
      mandatory: true,
      requiresChoice: true,
      controllerTrigger: true,
      anyPlayerTrigger: false,
      consequence: `Sacrifice ${cardName}`,
      sacrificeAlternativeType,
      imageUrl: card?.image_uris?.small || card?.image_uris?.normal,
    });
  }
  
  return triggers;
}

/**
 * Detect saga lore-counter turn-based triggers for precombat main (Rule 714.3b).
 */
export function detectSagaLoreCounterTrigger(card: any, permanent: any): UpkeepTrigger | null {
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
    const trigger = detectSagaLoreCounterTrigger(permanent.card, permanent);
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

      // Check if this trigger applies to the current upkeep
      const isControllerUpkeep = controller === activePlayerId;
      const isOpponentUpkeep = controller !== activePlayerId;
      
      if (trigger.anyPlayerTrigger) {
        // Triggers on any player's upkeep
        triggers.push(trigger);
      } else if (trigger.controllerTrigger && isControllerUpkeep) {
        // Triggers only on controller's upkeep
        triggers.push(trigger);
      } else if (trigger.triggerType === 'opponent_upkeep' && isOpponentUpkeep) {
        // Triggers on opponent's upkeep
        triggers.push(trigger);
      }
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
export function autoProcessCumulativeUpkeepMana(ctx: GameContext, activePlayerId: string): Array<{permanentId: string, cardName: string, manaAdded: Record<string, number>, ageCounters: number}> {
  const processed: Array<{permanentId: string, cardName: string, manaAdded: Record<string, number>, ageCounters: number}> = [];
  const battlefield = ctx.state?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== activePlayerId) continue;
    
    const card = permanent.card;
    const oracleText = card?.oracle_text || '';
    
    // Check for cumulative upkeep with "Add {X}" pattern (e.g., Braid of Fire)
    // Note: The pattern should capture one or more mana symbols (can be mixed)
    // Includes {W}{U}{B}{R}{G}{C} for white, blue, black, red, green, colorless
    const cumulativeMatch = oracleText.match(/cumulative upkeep[—\-\s]*add\s+((?:\{[WUBRGC]\})+)/i);
    if (!cumulativeMatch) continue;
    
    const manaSymbols = cumulativeMatch[1];
    const counters = permanent.counters || {};
    
    // Add age counter first
    const newAgeCounters = (counters["age"] || 0) + 1;
    (permanent as any).counters = { ...counters, age: newAgeCounters };
    
    // Parse all mana symbols (e.g., {R} or {R}{R} or {R}{G})
    // Supports {W}{U}{B}{R}{G}{C} for white, blue, black, red, green, colorless
    const symbolMatches = Array.from(manaSymbols.matchAll(/\{([WUBRGC])\}/g));
    const manaPerCounter: Record<string, number> = {};
    
    for (const match of symbolMatches) {
      const symbol = match[1];
      const manaType = symbol === 'W' ? 'white' :
                       symbol === 'U' ? 'blue' :
                       symbol === 'B' ? 'black' :
                       symbol === 'R' ? 'red' :
                       symbol === 'G' ? 'green' :
                       symbol === 'C' ? 'colorless' :
                       null; // Invalid symbol - skip it
      
      if (manaType) {
        manaPerCounter[manaType] = (manaPerCounter[manaType] || 0) + 1;
      }
    }
    
    // Calculate total mana: (mana per counter) * (age counters)
    const manaToAdd: Record<string, number> = {};
    for (const [manaType, perCounter] of Object.entries(manaPerCounter)) {
      manaToAdd[manaType] = perCounter * newAgeCounters;
    }
    
    // Initialize mana pool if needed
    if (!ctx.state.manaPool) {
      (ctx.state as any).manaPool = {};
    }
    if (!(ctx.state as any).manaPool[activePlayerId]) {
      (ctx.state as any).manaPool[activePlayerId] = {
        white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
      };
    }
    
    // Add mana to pool
    const pool = (ctx.state as any).manaPool[activePlayerId];
    for (const [manaType, amount] of Object.entries(manaToAdd)) {
      pool[manaType] = (pool[manaType] || 0) + amount;
    }
    
    processed.push({
      permanentId: permanent.id,
      cardName: card?.name || 'Unknown',
      manaAdded: manaToAdd,
      ageCounters: newAgeCounters
    });
  }
  
  if (processed.length > 0) {
    ctx.bumpSeq();
  }
  
  return processed;
}

