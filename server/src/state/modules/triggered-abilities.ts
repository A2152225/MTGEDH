/**
 * triggered-abilities.ts
 * 
 * Handles various triggered abilities in Magic:
 * 
 * DEATH TRIGGERS:
 * - "When ~ dies" / "Whenever ~ dies"
 * - "Whenever a creature you control dies" (Grave Pact, Blood Artist)
 * - "Whenever a creature dies" (Massacre Wurm)
 * - Undying (return with +1/+1 counter)
 * - Persist (return with -1/-1 counter)
 * 
 * ATTACK TRIGGERS:
 * - "Whenever ~ attacks" (Annihilator, combat damage triggers)
 * - "Whenever a creature you control attacks"
 * - "Whenever one or more creatures attack"
 * 
 * ETB TRIGGERS:
 * - "When ~ enters the battlefield"
 * - "Whenever a creature enters the battlefield"
 * 
 * DAMAGE TRIGGERS:
 * - "Whenever ~ deals combat damage"
 * - "Whenever ~ deals damage to a player"
 * 
 * ACTIVATED ABILITIES (not triggers, but commonly referenced):
 * - Firebreathing: "{R}: +1/+0"
 * - Shade: "{B}: +1/+1"
 * - Flying/evasion abilities
 * 
 * NOTE: This file is being modularized. New code should be added to the 
 * appropriate submodule in the triggers/ directory instead.
 */

import type { GameContext } from "../context.js";
import {
  hydrateBattlefieldOracleText,
  hydratePermanentCardOracleInPlace,
} from "./cardOracleHydration.js";
import { getActivePermanentCardFace } from "./cardFaceOracle.js";
import { getEffectiveColors } from "./effectiveColors.js";
import { handleEldraziShuffle, hasGraveyardMassShuffleIntoLibraryTrigger } from "./zone-manipulation.js";

// Import card data tables from modularized submodule
import { debug, debugWarn, debugError } from "../../utils/debug.js";
import {
  KNOWN_DEATH_TRIGGERS,
  KNOWN_ATTACK_TRIGGERS,
  KNOWN_UNTAP_TRIGGERS,
  KNOWN_CAST_TYPE_TRIGGERS,
  KNOWN_TAP_UNTAP_ABILITIES,
  KNOWN_ETB_TRIGGERS,
  KNOWN_COMBAT_DAMAGE_TRIGGERS,
  KNOWN_BEGINNING_COMBAT_TRIGGERS,
  KNOWN_END_STEP_TRIGGERS,
  KNOWN_PRECOMBAT_MAIN_TRIGGERS,
} from "./triggers/card-data-tables.js";
import {
  escapeCardNameForRegex,
  type RegisteredTrigger,
  type TriggerTiming,
} from "./triggers/types.js";
import { isInterveningIfSatisfied } from "./triggers/intervening-if.js";
import { cardHasCreatureType, permanentHasCreatureTypeNow } from "../creatureTypeNow.js";
import { isEtbCreatureTypeChoiceOracle, parseChosenTypeCreatureEtbTrigger } from "./chosen-creature-type.js";
import { hasTrainingKeyword } from "../../../../rules-engine/src/keywordAbilities/training.js";
import { parseMillFromOracleText } from "../../../../rules-engine/src/keywordActions/mill.js";
import { timingTriggerEffect, findFirstRegexMatchAcrossOracleLines } from './triggers/timing-effect-extraction.js';
import { isEnchantedByAuraYouControl } from './triggers/combat.js';
import {
  buildRoomUnlockDoorRegisteredTrigger,
  detectRoomUnlockDoorTriggers,
} from './triggers/room.js';
import { getCurrentGoaders } from './goad-effects.js';
import { getActualPowerToughness, normalizeCardNameForOracleText } from '../utils.js';
import {
  oracleTextHasDoThisOnlyOnceEachTurn,
  oracleTextHasTriggersOnlyOnceEachTurn,
} from './triggerDoThisOnlyOnceEachTurn.js';
import { isModalChooseModesEffectText } from './inferTriggeredAbilityTargetMetadata.js';
import { aOrAnSpellType } from '../../../../rules-engine/src/indefiniteArticle.js';
import { stripReminderParentheticals } from "../../../../rules-engine/src/oracleReminderText.js";

function buildCardNameRegexAlternatives(cardName: string): string[] {
  const names = new Set<string>();
  const add = (value: string) => {
    const trimmed = String(value || '').trim();
    if (trimmed) names.add(escapeCardNameForRegex(trimmed));
  };
  add(cardName);
  add(normalizeCardNameForOracleText(cardName));
  if (/^the\s+/i.test(cardName)) {
    add(`the ${cardName}`);
  }
  const slashParts = String(cardName).split(/\s*\/\/\s*/);
  if (slashParts.length > 1) {
    add(slashParts.map((part) => String(part).split(',')[0].trim()).join('//'));
  }
  for (const part of slashParts) {
    add(part);
    add(String(part.split(',')[0] || '').trim());
    const ofHead = String(part).match(/^(.+?)\s+of\s+/i);
    if (ofHead) add(ofHead[1].trim());
    const theTitleHead = String(part).match(/^(.+?)\s+the\s+/i);
    if (theTitleHead) add(theTitleHead[1].trim());
    const thePrefix = String(part).match(/^the\s+(.+)$/i);
    if (thePrefix) {
      add(thePrefix[1].trim());
      add(`the ${thePrefix[1].trim()}`);
    }
    if (/^a-/i.test(part)) add(String(part).replace(/^a-/i, '').trim());
    const hyphenShort = String(part).match(/^([\w]+-[\w]+)/);
    if (hyphenShort) add(hyphenShort[1].trim());
    const words = String(part).trim().split(/\s+/);
    if (words.length > 1 && !/^the$/i.test(words[0])) {
      add(words[0]);
    }
    if (words.length > 2) {
      add(words[words.length - 1]);
    }
  }
  return Array.from(names);
}

// Re-export from modularized submodules
export { calculateDevotion, getDevotionManaAmount } from "./triggers/devotion.js";
export { 
  checkWinConditions, 
  checkUpkeepWinConditions,
  type WinCondition,
} from "./triggers/win-conditions.js";
export {
  detectLandfallTriggers,
  getLandfallTriggers,
  isLandfallEtbSubjectPhrase,
  type LandfallTrigger,
} from "./triggers/landfall.js";
import { isLandfallEtbSubjectPhrase } from "./triggers/landfall.js";
import {
  controllerGrantsKeywordToCreatures,
  permanentHasAttachmentGrantedKeyword,
} from '../../../../shared/src/attachmentKeywordGrants.js';
export {
  checkEndOfTurnTransforms,
  checkUpkeepTransforms,
  type TransformCheckResult,
} from "./triggers/transform.js";
export {
  detectCardDrawTriggers,
  getCardDrawTriggers,
  type CardDrawTrigger,
} from "./triggers/card-draw.js";
export {
  detectLinkedExileEffect,
  registerLinkedExile,
  processLinkedExileReturns,
  getLinkedExilesForPermanent,
  isCardLinkedExile,
  type LinkedExile,
} from "./triggers/linked-exile.js";
export {
  detectReanimateCard,
  type ReanimateCardInfo,
} from "./triggers/reanimate.js";
export {
  AURAS_THAT_RETURN_TO_HAND,
  checkAuraGraveyardReturn,
} from "./triggers/aura-graveyard.js";
export {
  // End step triggers
  detectEndStepTriggers,
  getEndStepTriggers,
  type EndStepTrigger,
  // Draw step triggers
  detectDrawStepTriggers,
  getDrawStepTriggers,
  type DrawStepTrigger,
  // Main phase triggers
  detectPrecombatMainTriggers,
  getPrecombatMainTriggers,
  detectPostcombatMainTriggers,
  getPostcombatMainTriggers,
  // Untap step effects
  detectUntapStepEffects,
  getUntapStepEffects,
  applyUntapStepEffect,
  type UntapStepEffect,
  // Doesn't untap effects
  detectDoesntUntapEffects,
  isPermanentPreventedFromUntapping,
  shouldSkipUntapStepForPlayer,
  type DoesntUntapEffect,
} from "./triggers/turn-phases.js";
// Control change effects (ETB under opponent control, etc.)
export {
  detectControlChangeEffects,
  hasControlChangeEffect,
  shouldEnterUnderOpponentControl,
  hasOptionalGiveControlETB,
  shouldGoadOnControlChange,
  mustAttackEachCombat,
  cantAttackOwner,
  applyControlChange,
  getAttackRestrictions as getControlChangeAttackRestrictions,
  getControlChangeConfig,
  isKnownControlChangeCard,
  logControlChange,
  KNOWN_CONTROL_CHANGE_CARDS,
  type ControlChangeType,
  type ControlChangeEffect as ETBControlChangeEffect,
} from "./triggers/control-change.js";

// Damage received triggers (Brash Taunter, Boros Reckoner, etc.)
export {
  checkDamageReceivedTrigger,
  type DamageReceivedTriggerInfo,
  detectBeginningOfCombatTriggers,
  getBeginningOfCombatTriggers,
  isEnchantedByAuraYouControl,
} from "./triggers/combat.js";
export type { BeginningOfCombatTrigger } from "./triggers/types.js";
export {
  detectEndOfCombatTriggers,
  getEndOfCombatTriggers,
  type EndOfCombatTrigger,
} from "./triggers/end-combat.js";

export type { RegisteredTrigger, TriggerTiming } from "./triggers/types.js";

function extendSpellCopyEffectText(
  oracleText: string,
  matchedText: string,
  effectText: string,
  matchIndex?: number,
): string {
  const baseEffect = String(effectText || '').trim();
  const lowerBaseEffect = baseEffect.toLowerCase();
  let extendedEffect = baseEffect;

  const normalizedOracle = String(oracleText || '');
  const safeIndex = Number.isFinite(matchIndex as number)
    ? Number(matchIndex)
    : normalizedOracle.toLowerCase().indexOf(String(matchedText || '').toLowerCase());

  if ((lowerBaseEffect.includes('copy that spell') || lowerBaseEffect.includes('copy it')) && !lowerBaseEffect.includes('choose new targets for the copy') && safeIndex >= 0) {
    const trailingText = normalizedOracle.slice(safeIndex + String(matchedText || '').length);
    const retargetSentenceMatch = trailingText.match(/^\s*\.\s*(You may choose new targets? for the copy\.)/i);
    if (retargetSentenceMatch) {
      extendedEffect = `${extendedEffect} ${retargetSentenceMatch[1].trim()}`.trim();
    }
  }

  if (
    (lowerBaseEffect.includes('copy that spell') || lowerBaseEffect.includes('copy it'))
    && !lowerBaseEffect.includes('choose new targets for the copy')
    && /you may choose new targets? for the copy\.?/i.test(normalizedOracle)
    && !extendedEffect.toLowerCase().includes('choose new targets for the copy')
  ) {
    extendedEffect = `${extendedEffect} You may choose new targets for the copy.`.trim();
  }

  if (
    safeIndex >= 0
    && /from (?:your|a|any|an opponent['’]s|target opponent['’]s) graveyard to the battlefield/i.test(extendedEffect)
  ) {
    let trailingText = normalizedOracle.slice(safeIndex + String(matchedText || '').length);
    const riderPatterns = [
      /^\s*(?:\.\s*)?(It gains [^.]+\.)/i,
      /^\s*(?:\.\s*)?(Exile it at the beginning of [^.]+\.)/i,
      /^\s*(?:\.\s*)?(If it would leave the battlefield, [^.]+\.)/i,
    ];
    let matchedRider = true;
    while (matchedRider) {
      matchedRider = false;
      for (const pattern of riderPatterns) {
        const riderMatch = trailingText.match(pattern);
        if (!riderMatch) continue;
        const riderSentence = String(riderMatch[1] || '').trim();
        if (riderSentence && !extendedEffect.toLowerCase().includes(riderSentence.toLowerCase())) {
          extendedEffect = `${extendedEffect} ${riderSentence}`.trim();
        }
        trailingText = trailingText.slice(riderMatch[0].length);
        matchedRider = true;
        break;
      }
    }
  }

  return extendedEffect;
}

function extractSpellCastEffect(
  oracleText: string,
  match: RegExpMatchArray,
  captureGroup: number,
): string {
  const matchIndex = Number.isFinite(match.index)
    ? Number(match.index)
    : oracleText.toLowerCase().indexOf(String(match[0] || '').toLowerCase());
  const execMatch = Object.assign([...match], {
    index: matchIndex >= 0 ? matchIndex : 0,
    input: oracleText,
  }) as RegExpExecArray;
  return extendSpellCopyEffectText(
    oracleText,
    match[0],
    timingTriggerEffect(oracleText, execMatch, captureGroup),
    matchIndex >= 0 ? matchIndex : undefined,
  );
}

function normalizeSpellCastEffectText(
  oracleText: string,
  matchedText: string,
  rawEffect: string,
  matchIndex?: number,
): { effectText: string; optionalPaymentCost?: string; mandatory: boolean } {
  let effectText = extendSpellCopyEffectText(oracleText, matchedText, rawEffect, matchIndex);
  const optionalPaymentPattern = /you may pay ((?:\{[^}]+\})+)\.\s*(?:if|when) you do,?\s*(.+)/is;
  let mayPayMatch = effectText.match(optionalPaymentPattern);

  const safeIndex = Number.isFinite(matchIndex as number)
    ? Number(matchIndex)
    : oracleText.toLowerCase().indexOf(String(matchedText || '').toLowerCase());

  if (!mayPayMatch && /^you may pay /i.test(effectText) && safeIndex >= 0) {
    const trailingText = oracleText.slice(safeIndex + String(matchedText || '').length);
    const continuationMatch = trailingText.match(/^\.\s*if you do,?\s*([^.]+)/i);
    if (continuationMatch) {
      effectText = `${effectText}. If you do, ${String(continuationMatch[1] || '').trim()}`;
      mayPayMatch = effectText.match(optionalPaymentPattern);
    }
  }

  if (mayPayMatch) {
    return {
      effectText: String(mayPayMatch[2] || '').trim(),
      optionalPaymentCost: String(mayPayMatch[1] || '').trim(),
      mandatory: false,
    };
  }

  return {
    effectText,
    mandatory: !effectText.toLowerCase().includes('you may'),
  };
}

/**
 * Analyze a card and return all triggers it has
 * This is called when a permanent enters the battlefield to register its triggers
 */
export function analyzeCardTriggers(card: any, permanentId: string, controllerId: string): RegisteredTrigger[] {
  const triggers: RegisteredTrigger[] = [];
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = card?.name || "Unknown";
  
  // Upkeep triggers (text is already lowercased, no need for /i flag)
  const upkeepMatch = oracleText.match(/at the beginning of (?:your )?upkeep,?\s*([^.]+)/);
  if (upkeepMatch) {
    const effect = timingTriggerEffect(oracleText, upkeepMatch);
    triggers.push({
      id: `${permanentId}_upkeep`,
      permanentId,
      controllerId,
      cardName,
      timing: 'upkeep',
      effect,
      mandatory: !effect.includes('you may'),
    });
  }
  
  // Precombat main phase triggers
  // Pattern: "At the beginning of each player's precombat main phase" (Magus of the Vineyard)
  const precombatMatch = oracleText.match(/at the beginning of (?:each player's |your )?(?:pre-?combat )?main (?:phase|step),?\s*([^.]+)/i);
  if (precombatMatch) {
    triggers.push({
      id: `${permanentId}_precombat_main`,
      permanentId,
      controllerId,
      cardName,
      timing: 'precombat_main',
      effect: timingTriggerEffect(oracleText, precombatMatch),
      mandatory: !timingTriggerEffect(oracleText, precombatMatch).includes('you may'),
    });
  }

  // Postcombat main phase triggers
  // Patterns:
  // - "At the beginning of your second main phase"
  // - "At the beginning of your postcombat main phase"
  // - "At the beginning of each of your postcombat main phases"
  const postcombatMatch = oracleText.match(/at the beginning of (?:(?:each of )?your )?(?:post-?combat|second) main phases?,?\s*([^.]+(?:\.\s*if you do,?\s*[^.]+)?)/i);
  if (postcombatMatch) {
    triggers.push({
      id: `${permanentId}_postcombat_main`,
      permanentId,
      controllerId,
      cardName,
      timing: 'postcombat_main',
      effect: timingTriggerEffect(oracleText, postcombatMatch),
      mandatory: !timingTriggerEffect(oracleText, postcombatMatch).includes('you may'),
    });
  }
  
  // End step triggers
  const endStepMatch = oracleText.match(/at the beginning of (?:your |each )?end step,?\s*([^.]+)/);
  if (endStepMatch) {
    const effect = timingTriggerEffect(oracleText, endStepMatch);
    triggers.push({
      id: `${permanentId}_end_step`,
      permanentId,
      controllerId,
      cardName,
      timing: 'end_step',
      effect,
      mandatory: !effect.includes('you may'),
    });
  }
  
  // ETB triggers (self) - text is already lowercased
  // Note: New Bloomburrow template uses "enters" instead of "enters the battlefield"
  // Matches: "When ~ enters the battlefield", "When this creature enters", etc.
  const etbSelfMatch = oracleText.match(/when (?:~|this creature|this permanent|this enchantment) enters(?: the battlefield)?,?\s*([^.]+)/);
  if (etbSelfMatch) {
    const effect = timingTriggerEffect(oracleText, etbSelfMatch);
    triggers.push({
      id: `${permanentId}_etb_self`,
      permanentId,
      controllerId,
      cardName,
      timing: 'etb',
      condition: 'self',
      effect,
      mandatory: !effect.includes('you may'),
    });
  }
  
  // ETB triggers (other creatures)
  // Note: New Bloomburrow template uses "enters" instead of "enters the battlefield"
  // Also handles plural forms: "creatures enter" (e.g., Satoru, the Infiltrator)
  // Handles: "a creature enters", "another creature enters", "one or more creatures enter", "other creatures enter"
  const etbCreatureMatch = oracleText.match(/whenever (?:a|an(?:other)?|one or more(?: other)?|other) (?:nontoken )?creatures? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/);
  if (etbCreatureMatch) {
    triggers.push({
      id: `${permanentId}_etb_creature`,
      permanentId,
      controllerId,
      cardName,
      timing: 'etb',
      condition: 'creature',
      effect: timingTriggerEffect(oracleText, etbCreatureMatch),
      mandatory: !timingTriggerEffect(oracleText, etbCreatureMatch).includes('you may'),
    });
  }
  
  // Attack triggers
  const attackMatch = oracleText.match(/whenever (?:~|this creature) attacks,?\s*([^.]+)/);
  if (attackMatch) {
    triggers.push({
      id: `${permanentId}_attack`,
      permanentId,
      controllerId,
      cardName,
      timing: 'declare_attackers',
      effect: timingTriggerEffect(oracleText, attackMatch),
      mandatory: !timingTriggerEffect(oracleText, attackMatch).includes('you may'),
    });
  }
  
  // Combat damage triggers
  const combatDamageMatch = oracleText.match(/whenever (?:~|this creature) deals combat damage to (?:a player|an opponent),?\s*([^.]+)/);
  if (combatDamageMatch) {
    triggers.push({
      id: `${permanentId}_combat_damage`,
      permanentId,
      controllerId,
      cardName,
      timing: 'combat_damage',
      effect: timingTriggerEffect(oracleText, combatDamageMatch),
      mandatory: !timingTriggerEffect(oracleText, combatDamageMatch).includes('you may'),
    });
  }
  
  // Death triggers
  const deathMatch = oracleText.match(/when (?:~|this creature) dies,?\s*([^.]+)/);
  if (deathMatch) {
    triggers.push({
      id: `${permanentId}_dies`,
      permanentId,
      controllerId,
      cardName,
      timing: 'dies',
      condition: 'self',
      effect: timingTriggerEffect(oracleText, deathMatch),
      mandatory: !timingTriggerEffect(oracleText, deathMatch).includes('you may'),
    });
  }
  
  // Whenever a creature you control dies
  const creatureDiesMatch = oracleText.match(/whenever (?:a|another) creature you control dies,?\s*([^.]+)/);
  if (creatureDiesMatch) {
    triggers.push({
      id: `${permanentId}_creature_dies`,
      permanentId,
      controllerId,
      cardName,
      timing: 'dies',
      condition: 'controlled_creature',
      effect: timingTriggerEffect(oracleText, creatureDiesMatch),
      mandatory: !timingTriggerEffect(oracleText, creatureDiesMatch).includes('you may'),
    });
  }
  
  // Tap triggers
  const tapMatch = oracleText.match(/whenever (?:~|this creature) becomes tapped,?\s*([^.]+)/);
  if (tapMatch) {
    triggers.push({
      id: `${permanentId}_tap`,
      permanentId,
      controllerId,
      cardName,
      timing: 'tap',
      effect: timingTriggerEffect(oracleText, tapMatch),
      mandatory: !timingTriggerEffect(oracleText, tapMatch).includes('you may'),
    });
  }
  
  // Draw triggers
  const drawMatch = oracleText.match(/whenever (?:you|a player|an opponent) draws? (?:a card|cards),?\s*([^.]+)/);
  if (drawMatch) {
    triggers.push({
      id: `${permanentId}_draw`,
      permanentId,
      controllerId,
      cardName,
      timing: 'draw',
      effect: timingTriggerEffect(oracleText, drawMatch),
      mandatory: !timingTriggerEffect(oracleText, drawMatch).includes('you may'),
    });
  }
  
  // Cast triggers
  const castMatch = oracleText.match(/whenever you cast (?:a |an )?(\w+)?\s*spell,?\s*([^.]+)/);
  if (castMatch) {
    triggers.push({
      id: `${permanentId}_cast`,
      permanentId,
      controllerId,
      cardName,
      timing: 'cast',
      condition: castMatch[1] || 'any',
      effect: timingTriggerEffect(oracleText, castMatch, 2),
      mandatory: !timingTriggerEffect(oracleText, castMatch, 2).includes('you may'),
    });
  }

  const roomUnlock = buildRoomUnlockDoorRegisteredTrigger(card, permanentId, controllerId);
  if (roomUnlock) {
    triggers.push(roomUnlock);
  }
  
  return triggers;
}

/**
 * Register all triggers for a permanent when it enters the battlefield
 */
export function registerPermanentTriggers(ctx: GameContext, permanent: any): void {
  const state = (ctx as any).state;
  if (!state) return;
  
  // Initialize trigger registry if needed
  state.triggerRegistry = state.triggerRegistry || {};
  
  const card = permanent?.card;
  const permanentId = permanent?.id;
  const controllerId = permanent?.controller;
  
  if (!card || !permanentId || !controllerId) return;
  
  const triggers = analyzeCardTriggers(card, permanentId, controllerId);
  
  for (const trigger of triggers) {
    // Register by timing for efficient lookup
    state.triggerRegistry[trigger.timing] = state.triggerRegistry[trigger.timing] || [];
    state.triggerRegistry[trigger.timing].push(trigger);
  }
  
  if (triggers.length > 0) {
    debug(2, `[registerPermanentTriggers] Registered ${triggers.length} trigger(s) for ${card.name}`);
  }
}

/**
 * Unregister all triggers for a permanent when it leaves the battlefield
 */
export function unregisterPermanentTriggers(ctx: GameContext, permanentId: string): void {
  const state = (ctx as any).state;
  if (!state?.triggerRegistry) return;
  
  for (const timing of Object.keys(state.triggerRegistry)) {
    state.triggerRegistry[timing] = state.triggerRegistry[timing].filter(
      (t: RegisteredTrigger) => t.permanentId !== permanentId
    );
  }
}

/**
 * Get all triggers that should fire for a given timing
 */
export function getTriggersForTiming(ctx: GameContext, timing: TriggerTiming, activePlayerId?: string): RegisteredTrigger[] {
  const state = (ctx as any).state;
  if (!state?.triggerRegistry?.[timing]) return [];
  
  const triggers = state.triggerRegistry[timing] as RegisteredTrigger[];
  
  // Filter by active player if needed (for "your upkeep" vs "each upkeep" triggers)
  if (activePlayerId) {
    return triggers.filter((t: RegisteredTrigger) => {
      // Check if this is the controller's trigger
      if (t.controllerId === activePlayerId) return true;
      // Check if it's an "each player" type trigger
      if (t.effect.includes('each player') || t.effect.includes('all players')) return true;
      return false;
    });
  }
  
  return triggers;
}

/**
 * Group triggers by controller for APNAP ordering
 * Active Player, Non-Active Player ordering for simultaneous triggers
 */
export function groupTriggersByController(
  triggers: RegisteredTrigger[], 
  activePlayerId: string,
  playerOrder: string[]
): Map<string, RegisteredTrigger[]> {
  const grouped = new Map<string, RegisteredTrigger[]>();
  
  // Initialize in APNAP order
  const orderedPlayers = [activePlayerId, ...playerOrder.filter(p => p !== activePlayerId)];
  for (const playerId of orderedPlayers) {
    grouped.set(playerId, []);
  }
  
  for (const trigger of triggers) {
    const existing = grouped.get(trigger.controllerId) || [];
    existing.push(trigger);
    grouped.set(trigger.controllerId, existing);
  }
  
  return grouped;
}

export interface TriggeredAbility {
  permanentId: string;
  cardName: string;
  // Trigger detectors are extensible and already emit hundreds of generic
  // runtime identifiers. Keep this aligned with the shared wire type instead
  // of maintaining a second, permanently stale literal union here.
  triggerType: string;
  description: string;
  effect?: string;
  value?: number | Record<string, any>; // For Annihilator N, or complex effect data
  millAmount?: number; // For mill triggers like Altar of the Brood
  manaCost?: string; // For "sacrifice unless you pay" triggers
  mandatory: boolean;
  oncePerTurn?: boolean;
  requiresTarget?: boolean;
  targetType?: string;
  targetConstraint?: 'opponent' | 'you' | undefined; // For targeting restrictions (e.g., "opponent controls" or "you control")
  requiresChoice?: boolean; // For triggers where player must choose
  creatureType?: string; // For "whenever you cast a [type] spell" triggers
  nontokenOnly?: boolean; // For triggers that only fire for nontoken creatures (Guardian Project)
  controlledOnly?: boolean; // For triggers that only fire when creature you control enters (Aura Shards)
  batched?: boolean; // For triggers that should only fire once per event even if multiple conditions met (Professional Face-Breaker)
  controllerId?: string; // Controller of the permanent with this trigger
  
  // Token creation options
  createTokensBasedOnCount?: {  // For Myrel, creates tokens based on count of permanents
    countType: string;  // e.g., "soldier" - counts permanents with this type
    power: number;
    toughness: number;
    type: string;
    color: string;
    isArtifact?: boolean;
    abilities?: string[];
  };
  createTokens?: { 
    count: number; 
    power: number; 
    toughness: number; 
    type: string; 
    color: string; 
    abilities?: string[] 
  };
  
  // Put card from hand options (Preeminent Captain)
  putFromHand?: boolean;
  tappedAndAttacking?: boolean;
  putCreatureType?: string;
}

interface BlockTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerType?: string;
  description: string;
  effect?: string;
  mandatory: boolean;
  blockedCreatureId?: string;
  createTokens?: {
    count: number;
    power: number;
    toughness: number;
    type: string;
    color: string;
    abilities?: string[];
  };
}

// Note: KNOWN_DEATH_TRIGGERS, KNOWN_ATTACK_TRIGGERS, KNOWN_UNTAP_TRIGGERS, 
// KNOWN_CAST_TYPE_TRIGGERS, KNOWN_TAP_UNTAP_ABILITIES, KNOWN_ETB_TRIGGERS,
// KNOWN_COMBAT_DAMAGE_TRIGGERS are now imported from ./triggers/card-data-tables.js


/**
 * Detect combat damage triggers from a permanent's abilities
 */
export function detectCombatDamageTriggers(card: any, permanent: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const oracleText = (card?.oracle_text || "");
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  
  // Check known cards
  for (const [knownName, info] of Object.entries(KNOWN_COMBAT_DAMAGE_TRIGGERS)) {
    if (lowerName.includes(knownName)) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'deals_combat_damage',
        description: info.effect,
        effect: info.effect,
        mandatory: true,
      });
    }
  }
  
  // Generic "when/whenever ~ deals combat damage to a player" detection
  const combatNameVariants = buildCardNameRegexAlternatives(cardName);
  const combatDamageSubject = `(?:~|this creature|this vehicle|this artifact|this land|this permanent|(?:${combatNameVariants.join('|')})|equipped creature|enchanted creature)`;
  const selfCombatDamageAnyMatch = oracleText.match(
    new RegExp(`when(?:ever)?\\s+${combatDamageSubject}\\s+deals\\s+combat\\s+damage(?!\\s+to),?\\s*([^.]+)`, 'i'),
  );
  if (
    selfCombatDamageAnyMatch &&
    !triggers.some((t) => t.triggerType === 'self_deals_combat_damage_any')
  ) {
    const effectText = timingTriggerEffect(oracleText, selfCombatDamageAnyMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'self_deals_combat_damage_any',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const combatDamagePlayerMatch = oracleText.match(
    new RegExp(`when(?:ever)?\\s+${combatDamageSubject}\\s+(?:enters(?: the battlefield)?\\s+or\\s+)?deals\\s+combat\\s+damage\\s+to\\s+(?:a\\s+)?(?:player|an?\\s+opponent),?\\s*([^.]+)`, 'i'),
  );
  if (combatDamagePlayerMatch && !triggers.some(t => t.triggerType === 'deals_combat_damage')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'deals_combat_damage',
      description: timingTriggerEffect(oracleText, combatDamagePlayerMatch),
      effect: timingTriggerEffect(oracleText, combatDamagePlayerMatch),
      mandatory: true,
    });
  }
  
  // "Whenever one or more creatures you control deal combat damage to a player" (batched trigger)
  // Examples: Professional Face-Breaker, Idol of Oblivion, etc.
  const opponentsDealtCombatDamageMatch = oracleText.match(
    /whenever your opponents are dealt combat damage,?\s*([^.]+)/i,
  );
  if (
    opponentsDealtCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'opponents_dealt_combat_damage')
  ) {
    const effectText = timingTriggerEffect(oracleText, opponentsDealtCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponents_dealt_combat_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const batchedCombatDamageMatch = oracleText.match(/when(?:ever)?\s+one\s+or\s+more\s+creatures\s+you\s+control\s+deal\s+combat\s+damage\s+to\s+(?:a\s+)?(?:player|an?\s+opponent),?\s*([^.]+)/i);
  if (batchedCombatDamageMatch && !triggers.some(t => t.triggerType === 'creatures_deal_combat_damage_batched')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creatures_deal_combat_damage_batched',
      description: timingTriggerEffect(oracleText, batchedCombatDamageMatch),
      effect: timingTriggerEffect(oracleText, batchedCombatDamageMatch),
      mandatory: true,
      batched: true,  // This trigger should only fire once per combat damage step if any creatures dealt damage
    });
  }

  const typedCreatureCombatDamageMatch = oracleText.match(
    /whenever an? (?:[\w]+\s+)+creature you control deals combat damage to (?:a player|an opponent),?\s*([^.]+)/i,
  );
  if (
    typedCreatureCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'typed_creature_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, typedCreatureCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'typed_creature_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureCombatDamageToYouMatch = oracleText.match(
    /whenever a creature deals combat damage to you,?\s*([^.]+)/i,
  );
  if (
    creatureCombatDamageToYouMatch &&
    !triggers.some((t) => t.triggerType === 'creature_combat_damage_to_you')
  ) {
    const effectText = timingTriggerEffect(oracleText, creatureCombatDamageToYouMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_combat_damage_to_you',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const ringBearerCombatDamageMatch = oracleText.match(
    /whenever your ring-bearer deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    ringBearerCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'ring_bearer_combat_damage')
  ) {
    const effectText = timingTriggerEffect(oracleText, ringBearerCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'ring_bearer_combat_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anyCreatureCombatDamageToPlayerMatch = oracleText.match(
    /whenever a creature deals combat damage to (?:a )?player,?\s*([^.]+)/i,
  );
  if (
    anyCreatureCombatDamageToPlayerMatch &&
    !lowerOracle.includes('creature you control deals combat damage') &&
    !triggers.some((t) => t.triggerType === 'any_creature_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, anyCreatureCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'any_creature_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const controlledCreatureCombatDamageMatch = oracleText.match(
    /whenever a (?:[\w]+\s+)*creature you control deals combat damage to (?:a player|an opponent),?\s*([^.]+)/i,
  );
  if (
    controlledCreatureCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'controlled_creature_deals_combat_damage')
  ) {
    const effectText = timingTriggerEffect(oracleText, controlledCreatureCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'controlled_creature_deals_combat_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const controlledCreatureCombatDamageAnyMatch = oracleText.match(
    /whenever a (?:[\w]+\s+)*creature you control deals combat damage(?: during your turn)?(?! to),?\s*([^.]+)/i,
  );
  if (
    controlledCreatureCombatDamageAnyMatch &&
    !triggers.some((t) => t.triggerType === 'controlled_creature_deals_combat_damage_any')
  ) {
    const effectText = timingTriggerEffect(oracleText, controlledCreatureCombatDamageAnyMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'controlled_creature_deals_combat_damage_any',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const controlledCreatureCombatDamageToPlaneswalkerMatch = oracleText.match(
    /whenever a (?:[\w]+\s+)*creature you control deals combat damage to a planeswalker,?\s*([^.]+)/i,
  );
  if (
    controlledCreatureCombatDamageToPlaneswalkerMatch &&
    !triggers.some((t) => t.triggerType === 'controlled_creature_combat_damage_to_planeswalker')
  ) {
    const effectText = timingTriggerEffect(oracleText, controlledCreatureCombatDamageToPlaneswalkerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'controlled_creature_combat_damage_to_planeswalker',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const controlledCreatureCombatDamageToThatPlayerMatch = oracleText.match(
    /whenever a creature you control deals combat damage to that player(?: this turn)?,?\s*([^.]+)/i,
  );
  if (
    controlledCreatureCombatDamageToThatPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'controlled_creature_combat_damage_to_that_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, controlledCreatureCombatDamageToThatPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'controlled_creature_combat_damage_to_that_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const counterCreatureCombatDamageToPlayerMatch = oracleText.match(
    /whenever a creature you control with a \+1\/\+1 counter on it deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    counterCreatureCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'counter_creature_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, counterCreatureCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'counter_creature_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anyCounterCreatureCombatDamageToPlayerMatch = oracleText.match(
    /whenever a creature you control with a counter on it deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    anyCounterCreatureCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'any_counter_creature_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, anyCounterCreatureCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'any_counter_creature_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisOrAnotherTypedCombatDamageToPlayerMatch = oracleText.match(
    /whenever this creature or another ([\w]+) you control deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherTypedCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_another_typed_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherTypedCombatDamageToPlayerMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_typed_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedCreatureCombatDamageToPlayerNoControlMatch = oracleText.match(
    /whenever a ([\w]+(?: or [\w]+)?) deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    typedCreatureCombatDamageToPlayerNoControlMatch &&
    !lowerOracle.includes('you control') &&
    !triggers.some((t) => t.triggerType === 'typed_creature_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, typedCreatureCombatDamageToPlayerNoControlMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'typed_creature_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedCreatureCombatDamageToPlayerMatch = oracleText.match(
    /whenever a ([\w]+(?: or [\w]+)?) you control deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    typedCreatureCombatDamageToPlayerMatch &&
    !lowerOracle.includes('creature you control deals combat damage') &&
    !triggers.some((t) => t.triggerType === 'typed_creature_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, typedCreatureCombatDamageToPlayerMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'typed_creature_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const vehicleCombatDamageToPlayerMatch = oracleText.match(
    /whenever a vehicle you control deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    vehicleCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'vehicle_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, vehicleCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'vehicle_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const combatDamageToYourOpponentMatch = oracleText.match(
    /whenever a creature deals combat damage to one of your opponents,?\s*([^.]+)/i,
  );
  if (
    combatDamageToYourOpponentMatch &&
    !triggers.some((t) => t.triggerType === 'combat_damage_to_your_opponent')
  ) {
    const effectText = timingTriggerEffect(oracleText, combatDamageToYourOpponentMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'combat_damage_to_your_opponent',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const combatDamageToEnchantedPlayerMatch = oracleText.match(
    /whenever a creature deals combat damage to enchanted player,?\s*([^.]+)/i,
  );
  if (
    combatDamageToEnchantedPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'combat_damage_to_enchanted_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, combatDamageToEnchantedPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'combat_damage_to_enchanted_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thatCreatureCombatDamageToPlayerThisTurnMatch = oracleText.match(
    /when(?:ever)? that creature deals combat damage to (?:a player|an opponent) or (?:a )?planeswalker this turn,?\s*([^.]+)/i,
  );
  if (
    thatCreatureCombatDamageToPlayerThisTurnMatch &&
    !triggers.some((t) => t.triggerType === 'that_creature_combat_damage_to_player_or_planeswalker_this_turn')
  ) {
    const effectText = timingTriggerEffect(oracleText, thatCreatureCombatDamageToPlayerThisTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'that_creature_combat_damage_to_player_or_planeswalker_this_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thatCreatureCombatDamageToPlayerOnlyThisTurnMatch = oracleText.match(
    /when(?:ever)? that creature deals combat damage to a player this turn,?\s*([^.]+)/i,
  );
  if (
    thatCreatureCombatDamageToPlayerOnlyThisTurnMatch &&
    !triggers.some((t) => t.triggerType === 'that_creature_combat_damage_to_player_this_turn')
  ) {
    const effectText = timingTriggerEffect(oracleText, thatCreatureCombatDamageToPlayerOnlyThisTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'that_creature_combat_damage_to_player_this_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thatCreatureCombatDamageThisTurnMatch = oracleText.match(
    /whenever that creature deals combat damage this turn,?\s*([^.]+)/i,
  );
  if (
    thatCreatureCombatDamageThisTurnMatch &&
    !triggers.some((t) => t.triggerType === 'that_creature_combat_damage_this_turn')
  ) {
    const effectText = timingTriggerEffect(oracleText, thatCreatureCombatDamageThisTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'that_creature_combat_damage_this_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const deathtouchCombatDamageToPlayerMatch = oracleText.match(
    /whenever a creature you control with deathtouch deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    deathtouchCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'deathtouch_creature_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, deathtouchCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'deathtouch_creature_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const assassinCombatDamageToPlayerMatch = oracleText.match(
    /whenever an? ([\w]+) you control deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    assassinCombatDamageToPlayerMatch &&
    !lowerOracle.includes('creature you control deals combat damage') &&
    !triggers.some((t) => t.triggerType === 'typed_creature_combat_damage_to_player')
  ) {
    const typedSubject = String(assassinCombatDamageToPlayerMatch[1] || '').trim().toLowerCase();
    if (!['creature', 'vehicle', 'permanent'].includes(typedSubject)) {
      const effectText = timingTriggerEffect(oracleText, assassinCombatDamageToPlayerMatch, 2);
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'typed_creature_combat_damage_to_player',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const thatCreatureCombatDamageThisCombatMatch = oracleText.match(
    /whenever that creature deals combat damage to a player this combat,?\s*([^.]+)/i,
  );
  if (
    thatCreatureCombatDamageThisCombatMatch &&
    !triggers.some((t) => t.triggerType === 'that_creature_combat_damage_to_player_this_combat')
  ) {
    const effectText = timingTriggerEffect(oracleText, thatCreatureCombatDamageThisCombatMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'that_creature_combat_damage_to_player_this_combat',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const skulkCombatDamageMatch = oracleText.match(
    /whenever a creature with skulk deals combat damage to one of your opponents,?\s*([^.]+)/i,
  );
  if (skulkCombatDamageMatch && !triggers.some((t) => t.triggerType === 'skulk_creature_combat_damage_to_opponent')) {
    const effectText = timingTriggerEffect(oracleText, skulkCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'skulk_creature_combat_damage_to_opponent',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const faceDownCreaturesCombatDamageMatch = oracleText.match(
    /whenever one or more face-down creatures you control deal combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    faceDownCreaturesCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'face_down_creatures_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, faceDownCreaturesCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'face_down_creatures_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creaturesPlayerControlsCombatDamageToYouMatch = oracleText.match(
    /whenever one or more creatures a player controls deal combat damage to you,?\s*([^.]+)/i,
  );
  if (
    creaturesPlayerControlsCombatDamageToYouMatch &&
    !triggers.some((t) => t.triggerType === 'creatures_player_controls_combat_damage_to_you')
  ) {
    const effectText = timingTriggerEffect(oracleText, creaturesPlayerControlsCombatDamageToYouMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creatures_player_controls_combat_damage_to_you',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const otherNontokenCreaturesCombatDamageToPlayerMatch = oracleText.match(
    /whenever one or more other nontoken creatures you control deal combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    otherNontokenCreaturesCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'other_nontoken_creatures_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, otherNontokenCreaturesCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'other_nontoken_creatures_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedCreaturesCombatDamageToOpponentsMatch = oracleText.match(
    /whenever one or more ([\w]+(?: or [\w]+)*) you control deal combat damage to one or more of your opponents,?\s*([^.]+)/i,
  );
  if (
    typedCreaturesCombatDamageToOpponentsMatch &&
    !triggers.some((t) => t.triggerType === 'typed_creatures_combat_damage_to_opponents')
  ) {
    const effectText = timingTriggerEffect(oracleText, typedCreaturesCombatDamageToOpponentsMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'typed_creatures_combat_damage_to_opponents',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedOrEquippedCombatDamageToPlayerMatch = oracleText.match(
    new RegExp(
      `whenever (?:${combatNameVariants.join('|')}) or equipped creature deals combat damage to a player,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedOrEquippedCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'named_or_equipped_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrEquippedCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_equipped_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedSelfCombatDamageToPlayerMatch = oracleText.match(
    new RegExp(
      `when(?:ever)? (?:${combatNameVariants.join('|')}) deal(?:s)? combat damage to a player,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedSelfCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'named_self_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedSelfCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_self_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedOrInstantSorceryDealsDamageMatch = oracleText.match(
    new RegExp(
      `whenever (?:${combatNameVariants.join('|')}) or an instant or sorcery spell you control deals damage to a player,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedOrInstantSorceryDealsDamageMatch &&
    !triggers.some((t) => t.triggerType === 'named_or_instant_sorcery_deals_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrInstantSorceryDealsDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_instant_sorcery_deals_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const nonHumanCreaturesCombatDamageMatch = oracleText.match(
    /when(?:ever)? one or more non-Human creatures you control deal combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    nonHumanCreaturesCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'non_human_creatures_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, nonHumanCreaturesCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'non_human_creatures_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      batched: true,
    });
  }

  const creatureTokensCombatDamageMatch = oracleText.match(
    /when(?:ever)? one or more creature tokens you control deal combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    creatureTokensCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'creature_tokens_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, creatureTokensCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_tokens_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      batched: true,
    });
  }

  const namedSelfCombatDamagePlayerOrBattleMatch = oracleText.match(
    new RegExp(
      `when (?:${combatNameVariants.join('|')}) deal(?:s)? combat damage to a player or battle,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedSelfCombatDamagePlayerOrBattleMatch &&
    !triggers.some((t) => t.triggerType === 'named_self_combat_damage_to_player_or_battle')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedSelfCombatDamagePlayerOrBattleMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_self_combat_damage_to_player_or_battle',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const deathtouchDealsDamageToPlayerOrPlaneswalkerMatch = oracleText.match(
    /whenever a creature you control with deathtouch deals damage to (?:a player|an opponent) or (?:a )?planeswalker,?\s*([^.]+)/i,
  );
  if (
    deathtouchDealsDamageToPlayerOrPlaneswalkerMatch &&
    !triggers.some((t) => t.triggerType === 'deathtouch_creature_deals_damage_to_player_or_planeswalker')
  ) {
    const effectText = timingTriggerEffect(oracleText, deathtouchDealsDamageToPlayerOrPlaneswalkerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'deathtouch_creature_deals_damage_to_player_or_planeswalker',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const deathtouchDealsDamageToPlaneswalkerMatch = oracleText.match(
    /whenever a creature you control with deathtouch deals damage to a planeswalker,?\s*([^.]+)/i,
  );
  if (
    deathtouchDealsDamageToPlaneswalkerMatch &&
    !triggers.some((t) => t.triggerType === 'deathtouch_creature_deals_damage_to_planeswalker')
  ) {
    const effectText = timingTriggerEffect(oracleText, deathtouchDealsDamageToPlaneswalkerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'deathtouch_creature_deals_damage_to_planeswalker',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureDealsDamageFirstTimeEachTurnMatch = oracleText.match(
    /whenever a creature deals damage to one or more players for the first time each turn,?\s*([^.]+)/i,
  );
  if (
    creatureDealsDamageFirstTimeEachTurnMatch &&
    !triggers.some((t) => t.triggerType === 'creature_deals_damage_first_time_each_turn')
  ) {
    const effectText = timingTriggerEffect(oracleText, creatureDealsDamageFirstTimeEachTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_deals_damage_first_time_each_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedCreatureCombatDamageToCreatureMatch = oracleText.match(
    /whenever an? ([\w]+) you control deals combat damage to a creature,?\s*([^.]+)/i,
  );
  if (
    typedCreatureCombatDamageToCreatureMatch &&
    !triggers.some((t) => t.triggerType === 'typed_creature_combat_damage_to_creature')
  ) {
    const typedSubject = String(typedCreatureCombatDamageToCreatureMatch[1] || '').trim().toLowerCase();
    if (!['creature', 'vehicle', 'permanent'].includes(typedSubject)) {
      const effectText = timingTriggerEffect(oracleText, typedCreatureCombatDamageToCreatureMatch, 2);
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'typed_creature_combat_damage_to_creature',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const redSourceDealsDamageMatch = oracleText.match(
    /whenever a red source you control deals damage to one or more permanents and\/or players,?\s*([^.]+)/i,
  );
  if (redSourceDealsDamageMatch && !triggers.some((t) => t.triggerType === 'red_source_deals_damage')) {
    const effectText = timingTriggerEffect(oracleText, redSourceDealsDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'red_source_deals_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const selfCombatDamageToDefendingPlayerMatch = oracleText.match(
    new RegExp(
      `whenever (?:~|this creature|(?:${combatNameVariants.join('|')})) deals combat damage to defending player,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    selfCombatDamageToDefendingPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'self_combat_damage_to_defending_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, selfCombatDamageToDefendingPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'self_combat_damage_to_defending_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const whenSelfDealsDamageMatch = oracleText.match(
    new RegExp(`when (?:~|this creature|(?:${combatNameVariants.join('|')})) deals damage,?\\s*([^.]+)`, 'i'),
  );
  if (whenSelfDealsDamageMatch && !triggers.some((t) => t.triggerType === 'when_self_deals_damage')) {
    const effectText = timingTriggerEffect(oracleText, whenSelfDealsDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'when_self_deals_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const basePowerCombatDamageToPlayerMatch = oracleText.match(
    /whenever one or more creatures you control with base power (\d+) deal combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    basePowerCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'base_power_creatures_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, basePowerCombatDamageToPlayerMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'base_power_creatures_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const legendaryEquipmentCombatDamageMatch = oracleText.match(
    /whenever a creature you control with a legendary Equipment attached to it deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    legendaryEquipmentCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'legendary_equipment_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, legendaryEquipmentCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'legendary_equipment_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const ninjasBossesCombatDamageMatch = oracleText.match(
    /whenever one or more Ninjas the bosses control deal combat damage to the heroes,?\s*([^.]+)/i,
  );
  if (
    ninjasBossesCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'ninjas_bosses_combat_damage_to_heroes')
  ) {
    const effectText = timingTriggerEffect(oracleText, ninjasBossesCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'ninjas_bosses_combat_damage_to_heroes',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const selfCombatDamageToBlockingMatch = oracleText.match(
    /whenever this creature deals combat damage to one or more blocking creatures,?\s*([^.]+)/i,
  );
  if (
    selfCombatDamageToBlockingMatch &&
    !triggers.some((t) => t.triggerType === 'self_combat_damage_to_blocking_creatures')
  ) {
    const effectText = timingTriggerEffect(oracleText, selfCombatDamageToBlockingMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'self_combat_damage_to_blocking_creatures',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const toxicCreatureCombatDamageMatch = oracleText.match(
    /whenever a creature you control with toxic deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    toxicCreatureCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'toxic_creature_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, toxicCreatureCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'toxic_creature_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enteredThisTurnCombatDamageMatch = oracleText.match(
    /whenever one or more creatures you control that entered this turn deal combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    enteredThisTurnCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'entered_this_turn_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, enteredThisTurnCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'entered_this_turn_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentControlsCombatDamageToYouMatch = oracleText.match(
    /whenever one or more creatures an opponent controls deal combat damage to you,?\s*([^.]+)/i,
  );
  if (
    opponentControlsCombatDamageToYouMatch &&
    !triggers.some((t) => t.triggerType === 'opponent_controls_combat_damage_to_you')
  ) {
    const effectText = timingTriggerEffect(oracleText, opponentControlsCombatDamageToYouMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_controls_combat_damage_to_you',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const assassinCombatDamageToOpponentMatch = oracleText.match(
    /whenever an Assassin you control deals combat damage to an opponent,?\s*([^.]+)/i,
  );
  if (
    assassinCombatDamageToOpponentMatch &&
    !triggers.some((t) => t.triggerType === 'assassin_combat_damage_to_opponent')
  ) {
    const effectText = timingTriggerEffect(oracleText, assassinCombatDamageToOpponentMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'assassin_combat_damage_to_opponent',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const selfOrEnchantedCombatDamageToPlayerMatch = oracleText.match(
    /whenever this creature or enchanted creature deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    selfOrEnchantedCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'self_or_enchanted_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, selfOrEnchantedCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'self_or_enchanted_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const attackingCreatureDealsDamageToYouMatch = oracleText.match(
    /whenever an attacking creature deals combat damage to you,?\s*([^.]+)/i,
  );
  if (
    attackingCreatureDealsDamageToYouMatch &&
    !triggers.some((t) => t.triggerType === 'attacking_creature_deals_combat_damage_to_you')
  ) {
    const effectText = timingTriggerEffect(oracleText, attackingCreatureDealsDamageToYouMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'attacking_creature_deals_combat_damage_to_you',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const instantSorceryTargetsSingleCreatureDealsDamageMatch = oracleText.match(
    /whenever an instant or sorcery spell you control that targets only a single creature deals damage to that creature,?\s*([^.]+)/i,
  );
  if (
    instantSorceryTargetsSingleCreatureDealsDamageMatch &&
    !triggers.some((t) => t.triggerType === 'instant_sorcery_targets_single_creature_deals_damage')
  ) {
    const effectText = timingTriggerEffect(oracleText, instantSorceryTargetsSingleCreatureDealsDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'instant_sorcery_targets_single_creature_deals_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const itDealsCombatDamageToPlayerThisTurnMatch = oracleText.match(
    /whenever it deals combat damage to a player this turn,?\s*([^.]+)/i,
  );
  if (
    itDealsCombatDamageToPlayerThisTurnMatch &&
    !triggers.some((t) => t.triggerType === 'it_deals_combat_damage_to_player_this_turn')
  ) {
    const effectText = timingTriggerEffect(oracleText, itDealsCombatDamageToPlayerThisTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'it_deals_combat_damage_to_player_this_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const seaCreatureCombatDamageToPlayerMatch = oracleText.match(
    /whenever a Kraken, Leviathan, Octopus, or Serpent you control deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    seaCreatureCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'sea_creature_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, seaCreatureCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'sea_creature_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const instantSorcerySpellDealsDamageMatch = oracleText.match(
    /whenever an instant or sorcery spell you control deals damage,?\s*([^.]+)/i,
  );
  if (
    instantSorcerySpellDealsDamageMatch &&
    !triggers.some((t) => t.triggerType === 'instant_sorcery_spell_deals_damage')
  ) {
    const effectText = timingTriggerEffect(oracleText, instantSorcerySpellDealsDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'instant_sorcery_spell_deals_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const sliverCombatDamageToCreatureMatch = oracleText.match(
    /whenever a Sliver deals combat damage to a creature,?\s*([^.]+)/i,
  );
  if (
    sliverCombatDamageToCreatureMatch &&
    !triggers.some((t) => t.triggerType === 'sliver_combat_damage_to_creature')
  ) {
    const effectText = timingTriggerEffect(oracleText, sliverCombatDamageToCreatureMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'sliver_combat_damage_to_creature',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentCreaturesCombatDamageToOpponentsMatch = oracleText.match(
    /whenever one or more creatures an opponent controls deal combat damage to one or more of your opponents,?\s*([^.]+)/i,
  );
  if (
    opponentCreaturesCombatDamageToOpponentsMatch &&
    !triggers.some((t) => t.triggerType === 'opponent_creatures_combat_damage_to_opponents')
  ) {
    const effectText = timingTriggerEffect(oracleText, opponentCreaturesCombatDamageToOpponentsMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_creatures_combat_damage_to_opponents',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const noncombatDamageToCreatureMatch = oracleText.match(
    /whenever a source you control deals noncombat damage to a creature,?\s*([^.]+)/i,
  );
  if (noncombatDamageToCreatureMatch && !triggers.some((t) => t.triggerType === 'noncombat_damage_to_creature')) {
    const effectText = timingTriggerEffect(oracleText, noncombatDamageToCreatureMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'noncombat_damage_to_creature',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const powerAboveBaseCombatDamageMatch = oracleText.match(
    /whenever one or more creatures you control each with power greater than its base power deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    powerAboveBaseCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'power_above_base_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, powerAboveBaseCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'power_above_base_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  // Ms. Marvel, Elastic Ally — singular creature with power > base power
  const singularPowerAboveBaseCombatDamageMatch = oracleText.match(
    /whenever a creature you control with power greater than its base power deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    singularPowerAboveBaseCombatDamageMatch
    && !triggers.some((t) => t.triggerType === 'power_above_base_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, singularPowerAboveBaseCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'power_above_base_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  // Delayed/reflexive: "whenever any of those creatures deals combat damage to a player"
  const thoseCreaturesCombatDamageMatch = oracleText.match(
    /whenever any of those creatures deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    thoseCreaturesCombatDamageMatch
    && !triggers.some((t) => t.triggerType === 'those_creatures_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, thoseCreaturesCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'those_creatures_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const trampleCreaturesCombatDamageToPlayerMatch = oracleText.match(
    /whenever one or more creatures you control with trample deal combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    trampleCreaturesCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'trample_creatures_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, trampleCreaturesCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'trample_creatures_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const chosenNameCombatDamageThisTurnMatch = oracleText.match(
    /whenever a creature with the chosen name deals combat damage to a player this turn,?\s*([^.]+)/i,
  );
  if (
    chosenNameCombatDamageThisTurnMatch &&
    !triggers.some((t) => t.triggerType === 'chosen_name_combat_damage_to_player_this_turn')
  ) {
    const effectText = timingTriggerEffect(oracleText, chosenNameCombatDamageThisTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'chosen_name_combat_damage_to_player_this_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedOrEnchantedCombatDamageToPlayerPattern = new RegExp(
    `whenever\\s+(?:${combatNameVariants.join('|')})\\s+or\\s+an\\s+enchanted\\s+creature\\s+you\\s+control\\s+deals\\s+combat\\s+damage\\s+to\\s+a\\s+player,?\\s*([^.]+)`,
    'i',
  );
  const namedOrEnchantedCombatDamageToPlayerMatch = oracleText.match(namedOrEnchantedCombatDamageToPlayerPattern);
  if (
    namedOrEnchantedCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'named_or_enchanted_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrEnchantedCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_enchanted_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const sourceDamageToOpponentMatch = oracleText.match(
    /whenever a source you control deals damage to an opponent,?\s*([^.]+)/i,
  );
  if (
    sourceDamageToOpponentMatch &&
    !triggers.some((t) => t.triggerType === 'source_damage_to_opponent')
  ) {
    const effectText = timingTriggerEffect(oracleText, sourceDamageToOpponentMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'source_damage_to_opponent',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const sourceDamageToAnotherPlayerMatch = oracleText.match(
    /whenever a source you control deals damage to another player,?\s*([^.]+)/i,
  );
  if (
    sourceDamageToAnotherPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'source_damage_to_another_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, sourceDamageToAnotherPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'source_damage_to_another_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const sourceDamageToYouMatch = oracleText.match(
    /whenever a source you control deals damage to you,?\s*([^.]+)/i,
  );
  if (
    sourceDamageToYouMatch &&
    !triggers.some((t) => t.triggerType === 'source_damage_to_you')
  ) {
    const effectText = timingTriggerEffect(oracleText, sourceDamageToYouMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'source_damage_to_you',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const lowPowerCreatureCombatDamageToPlayerMatch = oracleText.match(
    /whenever a creature you control with power (\d+) or less deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    lowPowerCreatureCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'low_power_creature_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, lowPowerCreatureCombatDamageToPlayerMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'low_power_creature_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creaturesWithCountersCombatDamageMatch = oracleText.match(
    /whenever one or more creatures you control with counters on them deal combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    creaturesWithCountersCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'creatures_with_counters_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, creaturesWithCountersCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creatures_with_counters_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      batched: true,
    });
  }

  const commanderYouControlCombatDamageToOpponentMatch = oracleText.match(
    /whenever a commander you control deals combat damage to an opponent,?\s*([^.]+)/i,
  );
  if (
    commanderYouControlCombatDamageToOpponentMatch &&
    !triggers.some((t) => t.triggerType === 'commander_you_control_combat_damage_to_opponent')
  ) {
    const effectText = timingTriggerEffect(oracleText, commanderYouControlCombatDamageToOpponentMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'commander_you_control_combat_damage_to_opponent',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const commanderCombatDamageToPlayerMatch = oracleText.match(
    /when (?:your )?commander deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    commanderCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'commander_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, commanderCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'commander_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentDealtCombatDamageByYourCreaturesMatch = oracleText.match(
    /whenever an opponent is dealt combat damage by one or more creatures you control,?\s*([^.]+)/i,
  );
  if (
    opponentDealtCombatDamageByYourCreaturesMatch &&
    !triggers.some((t) => t.triggerType === 'opponent_dealt_combat_damage_by_your_creatures')
  ) {
    const effectText = timingTriggerEffect(oracleText, opponentDealtCombatDamageByYourCreaturesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_dealt_combat_damage_by_your_creatures',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const chosenNameCombatDamageMatch = oracleText.match(
    /whenever a creature you control with the chosen name deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    chosenNameCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'chosen_name_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, chosenNameCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'chosen_name_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const faceUpCreatureCombatDamageMatch = oracleText.match(
    /whenever a creature you control that was turned face up this turn deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    faceUpCreatureCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'face_up_creature_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, faceUpCreatureCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'face_up_creature_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const sourceOtherThanSelfDamageToOpponentMatch = oracleText.match(
    /whenever a source you control other than this artifact deals damage to an opponent,?\s*([^.]+)/i,
  );
  if (
    sourceOtherThanSelfDamageToOpponentMatch &&
    !triggers.some((t) => t.triggerType === 'source_other_than_self_damage_to_opponent')
  ) {
    const effectText = timingTriggerEffect(oracleText, sourceOtherThanSelfDamageToOpponentMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'source_other_than_self_damage_to_opponent',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const noncreatureSourceDealsDamageMatch = oracleText.match(
    /whenever a noncreature source you control deals damage,?\s*([^.]+)/i,
  );
  if (noncreatureSourceDealsDamageMatch && !triggers.some((t) => t.triggerType === 'noncreature_source_deals_damage')) {
    const effectText = timingTriggerEffect(oracleText, noncreatureSourceDealsDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'noncreature_source_deals_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const flyingCreaturesCombatDamageToPlayerMatch = oracleText.match(
    /whenever one or more creatures you control with flying deal combat damage to a player(?: this turn)?,?\s*([^.]+)/i,
  );
  if (
    flyingCreaturesCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'flying_creatures_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, flyingCreaturesCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'flying_creatures_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const controlledCreatureCombatDamageToCreatureMatch = oracleText.match(
    /whenever a (?:[\w]+\s+)*creature you control deals combat damage to a creature,?\s*([^.]+)/i,
  );
  if (
    controlledCreatureCombatDamageToCreatureMatch &&
    !triggers.some((t) => t.triggerType === 'controlled_creature_combat_damage_to_creature')
  ) {
    const effectText = timingTriggerEffect(oracleText, controlledCreatureCombatDamageToCreatureMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'controlled_creature_combat_damage_to_creature',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const selfOrEquippedCombatDamageToPlayerMatch = oracleText.match(
    /whenever (?:~|this creature) or equipped creature deals combat damage to a player,?\s*([^.]+)/i,
  );
  if (
    selfOrEquippedCombatDamageToPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'self_or_equipped_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, selfOrEquippedCombatDamageToPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'self_or_equipped_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedCreaturesCombatDamageMatch = oracleText.match(
    /whenever one or more ([\w]+(?: or [\w]+)*) (?:creatures )?you control deal combat damage to (?:a player|an opponent)(?: or battle)?,?\s*([^.]+)/i,
  );
  if (
    typedCreaturesCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'typed_creatures_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, typedCreaturesCombatDamageMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'typed_creatures_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      batched: true,
    });
  }

  const batchedCombatDamageToPlayersMatch = oracleText.match(
    /whenever one or more creatures you control deal combat damage to one or more players(?: this turn)?,?\s*([^.]+)/i,
  );
  if (
    batchedCombatDamageToPlayersMatch &&
    !triggers.some((t) => t.triggerType === 'batched_combat_damage_to_players')
  ) {
    const effectText = timingTriggerEffect(oracleText, batchedCombatDamageToPlayersMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'batched_combat_damage_to_players',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      batched: true,
    });
  }

  // "When/Whenever you're dealt combat damage" detection
  const youAreDealtCombatDamageMatch = oracleText.match(/when(?:ever)?\s+you(?:'re| are)\s+dealt\s+combat\s+damage,?\s*([^.]+)/i);
  if (youAreDealtCombatDamageMatch && !triggers.some(t => t.triggerType === 'you_are_dealt_combat_damage')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'you_are_dealt_combat_damage',
      description: timingTriggerEffect(oracleText, youAreDealtCombatDamageMatch),
      effect: timingTriggerEffect(oracleText, youAreDealtCombatDamageMatch),
      mandatory: true,
    });
  }

  const youAreDealtDamageMatch = oracleText.match(/when(?:ever)?\s+you(?:'re| are)\s+dealt\s+damage,?\s*([^.]+)/i);
  if (youAreDealtDamageMatch && !triggers.some(t => t.triggerType === 'you_are_dealt_damage')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'you_are_dealt_damage',
      description: timingTriggerEffect(oracleText, youAreDealtDamageMatch),
      effect: timingTriggerEffect(oracleText, youAreDealtDamageMatch),
      mandatory: true,
    });
  }

  // "Whenever one or more creatures deal combat damage to you" (batched defender trigger)
  const creaturesDealCombatDamageToYouMatch = oracleText.match(/whenever\s+one\s+or\s+more\s+creatures\s+deal\s+combat\s+damage\s+to\s+you,?\s*([^.]+)/i);
  if (creaturesDealCombatDamageToYouMatch && !triggers.some(t => t.triggerType === 'creatures_deal_combat_damage_to_you_batched')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creatures_deal_combat_damage_to_you_batched',
      description: timingTriggerEffect(oracleText, creaturesDealCombatDamageToYouMatch),
      effect: timingTriggerEffect(oracleText, creaturesDealCombatDamageToYouMatch),
      mandatory: true,
      batched: true,
    });
  }
  
  const enchantedCreatureYouControlCombatDamageMatch = oracleText.match(
    /whenever an enchanted creature you control deals combat damage to (?:a player|an opponent),?\s*([^.]+)/i,
  );
  if (
    enchantedCreatureYouControlCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'enchanted_creature_controlled_combat_damage')
  ) {
    const effectText = timingTriggerEffect(oracleText, enchantedCreatureYouControlCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enchanted_creature_controlled_combat_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const combatDamageToCreatureMatch = oracleText.match(
    new RegExp(`whenever ${combatDamageSubject}\\s+deals combat damage to a creature,?\\s*([^.]+)`, 'i'),
  );
  if (combatDamageToCreatureMatch && !triggers.some((t) => t.triggerType === 'deals_combat_damage_to_creature')) {
    const effectText = timingTriggerEffect(oracleText, combatDamageToCreatureMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'deals_combat_damage_to_creature',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const equippedAnyCombatDamageMatch = oracleText.match(
    /whenever equipped creature deals combat damage(?! to),?\s*([^.]+)/i,
  );
  if (equippedAnyCombatDamageMatch && !triggers.some((t) => t.triggerType === 'equipment_combat_damage')) {
    const effectText = timingTriggerEffect(oracleText, equippedAnyCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'equipment_combat_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedDefendingPlayerDamageMatch = oracleText.match(
    /whenever enchanted creature deals combat damage to defending player,?\s*([^.]+)/i,
  );
  if (enchantedDefendingPlayerDamageMatch && !triggers.some((t) => t.triggerType === 'aura_combat_damage')) {
    const effectText = timingTriggerEffect(oracleText, enchantedDefendingPlayerDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'aura_combat_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedCreatureCombatDamageMatch = oracleText.match(
    /when(?:ever)?\s+enchanted creature deals (?:combat )?damage to (?:a player|an opponent),?\s*([^.]+)/i,
  );
  if (enchantedCreatureCombatDamageMatch && !triggers.some((t) => t.triggerType === 'deals_combat_damage' || t.triggerType === 'aura_combat_damage')) {
    const effectText = timingTriggerEffect(oracleText, enchantedCreatureCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'aura_combat_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const targetCreatureDealsDamageMatch = oracleText.match(
    /whenever target creature deals (?:combat )?damage,?\s*([^.]+)/i,
  );
  if (targetCreatureDealsDamageMatch && !triggers.some((t) => t.triggerType === 'target_creature_deals_damage')) {
    const effectText = timingTriggerEffect(oracleText, targetCreatureDealsDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'target_creature_deals_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedDealDamageToPlayerMatch = oracleText.match(
    /whenever one or more ([\w]+(?: or [\w]+)*) you control deal damage to a player,?\s*([^.]+)/i,
  );
  if (typedDealDamageToPlayerMatch && !triggers.some((t) => t.triggerType === 'typed_deal_damage_to_player')) {
    const effectText = timingTriggerEffect(oracleText, typedDealDamageToPlayerMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'typed_deal_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedDealDamageNoControlMatch = oracleText.match(
    /whenever a ([\w]+) deals damage,?\s*([^.]+)/i,
  );
  if (
    typedDealDamageNoControlMatch &&
    !lowerOracle.includes('you control') &&
    !triggers.some((t) => t.triggerType === 'typed_deal_damage')
  ) {
    const effectText = timingTriggerEffect(oracleText, typedDealDamageNoControlMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'typed_deal_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedDealDamageToOpponentsMatch = oracleText.match(
    /whenever one or more ([\w]+(?: or [\w]+)*) you control deal damage to your opponents,?\s*([^.]+)/i,
  );
  if (typedDealDamageToOpponentsMatch && !triggers.some((t) => t.triggerType === 'typed_deal_damage_to_opponents')) {
    const effectText = timingTriggerEffect(oracleText, typedDealDamageToOpponentsMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'typed_deal_damage_to_opponents',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedDealDamageToCreatureMatch = oracleText.match(
    /whenever an? ([\w]+) you control deals damage to a creature,?\s*([^.]+)/i,
  );
  if (typedDealDamageToCreatureMatch && !triggers.some((t) => t.triggerType === 'typed_deal_damage_to_creature')) {
    const effectText = timingTriggerEffect(oracleText, typedDealDamageToCreatureMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'typed_deal_damage_to_creature',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const spellYouControlDealsDamagePatterns = [
    /whenever a spell you control deals damage,?\s*([^.]+)/gi,
    /when a spell you control deals damage,?\s*([^.]+)/gi,
  ];
  for (const pattern of spellYouControlDealsDamagePatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effectText = timingTriggerEffect(oracleText, match);
      if (!effectText || triggers.some((t) => t.triggerType === 'spell_you_control_deals_damage' && t.effect === effectText)) {
        continue;
      }
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'spell_you_control_deals_damage',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const dealsDamageMatch = oracleText.match(
    new RegExp(`whenever\\s+${combatDamageSubject}\\s+deals damage,?\\s*([^.]+)`, 'i'),
  );
  if (dealsDamageMatch && !triggers.some((t) => t.triggerType === 'deals_damage')) {
    const effectText = timingTriggerEffect(oracleText, dealsDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'deals_damage',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  // "When/Whenever ~ deals damage to a player" (includes combat and non-combat)
  const damagePlayerMatch = oracleText.match(
    new RegExp(`when(?:ever)?\\s+(?:~|this creature|this vehicle|(?:${combatNameVariants.join('|')})|enchanted creature|equipped creature)\\s+deals\\s+damage\\s+to\\s+(?:a\\s+)?(?:player|an?\\s+opponent),?\\s*([^.]+)`, 'i'),
  );
  if (damagePlayerMatch && !triggers.some(t => t.triggerType === 'deals_combat_damage' || t.triggerType === 'deals_damage')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'deals_damage',
      description: timingTriggerEffect(oracleText, damagePlayerMatch),
      effect: timingTriggerEffect(oracleText, damagePlayerMatch),
      mandatory: true,
    });
  }
  
  return triggers;
}

/**
 * Detect "dealt damage" triggers (Arcbond, etc.)
 */
export function detectDealtDamageTriggers(card: any, permanent: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const oracleText = String(card?.oracle_text || '');
  const cardName = String(card?.name || 'Unknown');
  const permanentId = permanent?.id || '';
  const controllerId = permanent?.controller || '';
  const cardNameEscaped = escapeCardNameForRegex(cardName);

  const dealtDamageNameVariants = buildCardNameRegexAlternatives(cardName);
  const dealtDamageSubject = `(?:~|this creature|this permanent|equipped creature|(?:${dealtDamageNameVariants.join('|')}))`;

  const dealtDamagePatterns = [
    /whenever that creature is dealt damage(?: this turn)?,?\s*([^.]+)/gi,
    /whenever (?:~|this creature|this permanent|equipped creature) is dealt (?:combat )?damage,?\s*([^.]+)/gi,
    /whenever a source deals damage to (?:~|this creature),?\s*([^.]+)/gi,
    /when(?:ever)? enchanted creature is dealt damage,?\s*([^.]+)/gi,
    new RegExp(`whenever ${dealtDamageSubject} is dealt (?:combat )?damage,?\\s*([^.]+)`, 'gi'),
    new RegExp(`when(?:ever)? ${dealtDamageSubject} or a creature it'?s paired with is dealt damage,?\\s*([^.]+)`, 'gi'),
    /whenever (?:a |an )?creature is dealt damage,?\s*([^.]+)/gi,
    /whenever a creature you control is dealt damage,?\s*([^.]+)/gi,
    /whenever a creature you control with (?:flash or haste|haste or flash) is dealt damage,?\s*([^.]+)/gi,
    /whenever a creature you control with deathtouch deals damage to (?:a player|an opponent) or (?:a )?planeswalker,?\s*([^.]+)/gi,
    /whenever a ([\w]+) you control is dealt damage,?\s*([^.]+)/gi,
    /whenever a creature an opponent controls is dealt damage,?\s*([^.]+)/gi,
    /whenever an opponent is dealt damage,?\s*([^.]+)/gi,
    /whenever an opponent is dealt combat damage by one or more creatures you control,?\s*([^.]+)/gi,
    /whenever a source you control deals noncombat damage to (?:a creature equal to that creature's toughness|an opponent),?\s*([^.]+)/gi,
    /whenever a source you control deals noncombat damage to an opponent,?\s*([^.]+)/gi,
    /whenever damage is dealt to you,?\s*([^.]+)/gi,
    /whenever a creature deals damage to you,?\s*([^.]+)/gi,
    /whenever a ([\w]+) deals damage to you,?\s*([^.]+)/gi,
    /when (?:a |an )?source an opponent controls deals damage to you,?\s*([^.]+)/gi,
    /whenever (?:a |an )?source an opponent controls deals damage to you,?\s*([^.]+)/gi,
    /whenever enchanted player is dealt damage,?\s*([^.]+)/gi,
    /whenever a creature or planeswalker an opponent controls with a bounty counter on it is dealt damage,?\s*([^.]+)/gi,
    /when enchanted creature becomes tapped or is dealt damage,?\s*([^.]+)/gi,
    /whenever a source of the chosen color deals damage to you,?\s*([^.]+)/gi,
    /whenever a source an opponent controls deals damage to this creature,?\s*([^.]+)/gi,
  ];

  const damagePreventedMatch = oracleText.match(/when damage is prevented this way,?\s*([^.]+)/i);
  if (damagePreventedMatch && !triggers.some((t) => t.triggerType === 'damage_prevented')) {
    const effectText = timingTriggerEffect(oracleText, damagePreventedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'damage_prevented',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  for (const pattern of dealtDamagePatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effectText = String(match[match.length - 1] || '').trim();
      if (!effectText || triggers.some((trigger) => trigger.effect === effectText)) continue;
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'dealt_damage',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  return triggers;
}

/**
 * Get combat damage triggers for creatures that dealt damage
 */
export function getCombatDamageTriggersForCreature(
  ctx: GameContext,
  attackingPermanent: any,
  damageDealt: number,
  damagedPlayerId: string
): TriggeredAbility[] {
  if (damageDealt <= 0) return [];
  
  return detectCombatDamageTriggers(attackingPermanent.card, attackingPermanent);
}

function collectDeathTriggerEffectText(oracleText: string, match: RegExpMatchArray, effectCaptureIndex: number): string {
  const effect = String(match?.[effectCaptureIndex] || '').trim();
  if (!effect) {
    return effect;
  }

  const matchText = String(match?.[0] || '');
  const matchStart = typeof match?.index === 'number'
    ? match.index
    : String(oracleText || '').indexOf(matchText);
  if (matchStart < 0 || !matchText) {
    return effect;
  }

  const sameLineTail = String(oracleText || '')
    .slice(matchStart + matchText.length)
    .split(/\r?\n/)[0] || '';

  const collectsDirectReflexiveContinuation =
    /^you may pay\s+(?:any amount of\s+)?\{[^}]+\}(?:\{[^}]+\})*$/i.test(effect) ||
    /^you may exile (?:it|this card)$/i.test(effect);
  const collectsThenSelfExileContinuation = /^\s*\.\s*then\s+you\s+may\s+exile\s+this\s+card\.\s*(?:when|if)\s+you\s+do,?/i.test(sameLineTail);
  if (!collectsDirectReflexiveContinuation && !collectsThenSelfExileContinuation) {
    return effect;
  }

  const continuationMatch = collectsThenSelfExileContinuation
    ? sameLineTail.match(/^\s*\.\s*((?:then\s+you\s+may\s+exile\s+this\s+card\.\s*(?:when|if)\s+you\s+do,?\s+[^.]+\.)(?:\s+(?:if\s+it['’]?s|it['’]?s|then)\b[^.]+\.)*)/i)
    : sameLineTail.match(/^\s*\.\s*((?:(?:if|when)\s+you\s+do,?\s+[^.]+\.)(?:\s+(?:if\s+it['’]?s|it['’]?s|then)\b[^.]+\.)*)/i);
  const continuation = String(continuationMatch?.[1] || '').trim();
  return continuation ? `${effect}. ${continuation}` : effect;
}

/** Optional "enters or" before the non-ETB event in compound templates. */
const ENTERS_OR_OTHER_EVENT_PREFIX = '(?:enters(?: the battlefield)?\\s+or\\s+)?';

/**
 * Detect death triggers from a permanent's abilities.
 * 
 * DYNAMIC-FIRST PATTERN: Uses regex-based oracle text parsing as the primary
 * detection mechanism. The KNOWN_DEATH_TRIGGERS table serves as an optimization
 * fallback for special handling.
 * 
 * Patterns detected:
 * - "When ~ dies, [effect]" - self death trigger
 * - "Whenever a creature you control dies, [effect]" - controlled creature death
 * - "Whenever a creature dies, [effect]" - any creature death
 * - "Whenever a creature an opponent controls dies, [effect]" - opponent creature death
 * - "Undying" keyword
 * - "Persist" keyword
 */
export function detectDeathTriggers(card: any, permanent: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const oracleText = (card?.oracle_text || "");
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  const counters = permanent?.counters || {};
  
  // ===== DYNAMIC DETECTION (Primary) =====
  
  // Undying - if no +1/+1 counter, return with one
  if (lowerOracle.includes("undying")) {
    const hasPlusCounter = (counters["+1/+1"] || counters["plus1plus1"] || 0) > 0;
    if (!hasPlusCounter) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'undying',
        description: "Return to battlefield with +1/+1 counter",
        mandatory: true,
      });
    }
  }
  
  // Persist - if no -1/-1 counter, return with one
  if (lowerOracle.includes("persist")) {
    const hasMinusCounter = (counters["-1/-1"] || counters["minus1minus1"] || 0) > 0;
    if (!hasMinusCounter) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'persist',
        description: "Return to battlefield with -1/-1 counter",
        mandatory: true,
      });
    }
  }
  
  const dieNameVariants = buildCardNameRegexAlternatives(cardName);

  const namedOrNontokenDiesOrCombatDamageMatch = oracleText.match(
    new RegExp(
      `whenever (?:${dieNameVariants.join('|')}) or another nontoken ([\\w]+) you control dies or deals combat damage to a player,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedOrNontokenDiesOrCombatDamageMatch &&
    !triggers.some((t) => t.triggerType === 'named_or_nontoken_dies_or_combat_damage_to_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrNontokenDiesOrCombatDamageMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_nontoken_dies_or_combat_damage_to_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const dieSelfAlternatives = [
    '~',
    'this creature',
    'this permanent',
    'this artifact',
    'this enchantment',
    'this aura',
    'this equipment',
    'this vehicle',
    'this planeswalker',
    'this battle',
    'this land',
    ...dieNameVariants,
  ];

  const attacksOrDiesPattern = new RegExp(
    `whenever\\s+(?:${dieSelfAlternatives.join('|')})\\s+attacks\\s+or\\s+dies,?\\s*([^.]+)`,
    'i',
  );
  const attacksOrDiesMatch = oracleText.match(attacksOrDiesPattern);
  if (attacksOrDiesMatch && !triggers.some((t) => t.triggerType === 'attacks_or_dies')) {
    const effectText = timingTriggerEffect(oracleText, attacksOrDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'attacks_or_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thatCreatureDiesMatch = oracleText.match(/when (?:that|target|the) creature dies(?: this turn)?,?\s*([^.]+)/i);
  if (thatCreatureDiesMatch && !triggers.some((t) => t.triggerType === 'that_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, thatCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'that_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const auraPutIntoGraveyardMatch = oracleText.match(
    /when this aura is put into (?:a |your )?graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (auraPutIntoGraveyardMatch && !triggers.some((t) => t.triggerType === 'aura_ltb')) {
    const effectText = timingTriggerEffect(oracleText, auraPutIntoGraveyardMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'aura_ltb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const entersOrDiesPattern = new RegExp(
    `when(?:ever)?\\s+(?:${dieSelfAlternatives.join('|')})\\s+enters(?: the battlefield)?\\s+or\\s+dies,?\\s*([^.]+)`,
    'i',
  );
  const entersOrDiesMatch = oracleText.match(entersOrDiesPattern);
  if (entersOrDiesMatch && !triggers.some((t) => t.triggerType === 'enters_or_dies')) {
    const effectText = timingTriggerEffect(oracleText, entersOrDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enters_or_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const selfDiesPattern = new RegExp(
    `when(?:ever)?\\s+(?:${dieSelfAlternatives.join('|')})\\s+die(?:s)?,?\\s*([^.]+)`,
    'i',
  );
  const diesMatch = oracleText.match(selfDiesPattern);
  if (diesMatch && !triggers.some(t => t.triggerType === 'dies')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'dies',
      description: timingTriggerEffect(oracleText, diesMatch),
      effect: timingTriggerEffect(oracleText, diesMatch),
      mandatory: true,
    });
  }

  const namedOrAnotherDiesPattern = new RegExp(
    `whenever\\s+(?:${dieNameVariants.join('|')})\\s+or\\s+another\\s+(?:[\\w\\s]+?\\s+)?creature(?:s)?(?:\\s+you\\s+control)?\\s+dies,?\\s*([^.]+)`,
    'i',
  );
  const namedOrAnotherDiesMatch = oracleText.match(namedOrAnotherDiesPattern);
  if (namedOrAnotherDiesMatch && !triggers.some((t) => t.triggerType === 'named_or_another_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, namedOrAnotherDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_another_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const putIntoGraveyardPattern = new RegExp(
    `when(?:ever)?\\s+(?:${dieSelfAlternatives.join('|')})\\s+${ENTERS_OR_OTHER_EVENT_PREFIX}(?:is )?put into (?:a |your |its owner's )?graveyard from the battlefield,?\\s*([^.]+)`,
    'i',
  );
  const putIntoGraveyardMatch = oracleText.match(putIntoGraveyardPattern);
  if (putIntoGraveyardMatch && !triggers.some((trigger) => trigger.triggerType === 'dies')) {
    const effectText = timingTriggerEffect(oracleText, putIntoGraveyardMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const pronounGraveyardThisTurnMatch = oracleText.match(/when(?:ever)? it'?s put into (?:a )?graveyard this turn,?\s*([^.]+)/i);
  if (pronounGraveyardThisTurnMatch && !triggers.some((trigger) => trigger.triggerType === 'put_into_graveyard_this_turn')) {
    const effectText = timingTriggerEffect(oracleText, pronounGraveyardThisTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'put_into_graveyard_this_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const attachmentDiesPatterns = [
    /whenever (?:an )?enchanted (?:creature|permanent|land) dies,?\s*([^.]+)/i,
    /whenever equipped creature dies,?\s*([^.]+)/i,
    /when (?:an )?enchanted (?:creature|permanent|land) dies,?\s*([^.]+)/i,
    /when equipped creature dies,?\s*([^.]+)/i,
  ];
  for (const pattern of attachmentDiesPatterns) {
    const match = oracleText.match(pattern);
    if (!match) continue;
    const effectText = timingTriggerEffect(oracleText, match);
    if (!effectText || triggers.some((trigger) => trigger.effect === effectText && trigger.triggerType === 'attachment_dies')) {
      continue;
    }
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'attachment_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const dealtDamageDiesPattern = new RegExp(
    `when(?:ever)? (?:a |an )?creature(?: with flying)? dealt damage by (?:equipped creature|enchanted creature|${dieSelfAlternatives.join('|')}) this turn dies,?\\s*([^.]+)`,
    'i',
  );
  const dealtDamageDiesMatch = oracleText.match(dealtDamageDiesPattern);
  if (dealtDamageDiesMatch && !triggers.some((trigger) => trigger.triggerType === 'dealt_damage_dies')) {
    const effectText = timingTriggerEffect(oracleText, dealtDamageDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'dealt_damage_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }
  
  const enchantedPlayerNontokenCreatureDiesMatch = oracleText.match(
    /whenever a nontoken creature enchanted player controls dies,?\s*([^.]+)/i,
  );
  if (
    enchantedPlayerNontokenCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'enchanted_player_nontoken_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, enchantedPlayerNontokenCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enchanted_player_nontoken_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const genericCounterCreatureDiesMatch = oracleText.match(
    /whenever a creature you control with a counter on it dies,?\s*([^.]+)/i,
  );
  if (
    genericCounterCreatureDiesMatch &&
    !String(genericCounterCreatureDiesMatch[0] || '').toLowerCase().includes('+1/+1 counter') &&
    !triggers.some((t) => t.triggerType === 'counter_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, genericCounterCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'counter_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const counterCreatureDiesMatch = oracleText.match(
    /whenever a creature you control with a \+1\/\+1 counter on it dies,?\s*([^.]+)/i,
  );
  if (counterCreatureDiesMatch && !triggers.some((t) => t.triggerType === 'counter_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, counterCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'counter_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  // "Whenever/When a creature you control dies" - also handles "nontoken creature"
  const thisOrAnotherCreatureDiesAnyMatch = oracleText.match(
    /whenever this creature or another creature dies,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherCreatureDiesAnyMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_another_creature_dies_any')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherCreatureDiesAnyMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_creature_dies_any',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisOrAnotherCreatureDiesMatch = oracleText.match(
    /whenever this creature or another creature you control dies,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_another_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisOrAnotherTypedCreatureDiesMatch = oracleText.match(
    /whenever this creature or another ([\w]+(?: or [\w]+)*)(?: creature)? you control dies,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherTypedCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_another_typed_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherTypedCreatureDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_typed_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisOrAnotherPowerCreatureDiesMatch = oracleText.match(
    /whenever this creature or another creature you control with power (\d+) or greater dies,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherPowerCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_another_power_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherPowerCreatureDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_power_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisOrAnotherNontokenCreatureDiesMatch = oracleText.match(
    /whenever this creature or another nontoken creature you control dies,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherNontokenCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_another_nontoken_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherNontokenCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_nontoken_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedOrModifiedCreatureDiesMatch = oracleText.match(
    /whenever enchanted creature or another modified creature you control dies,?\s*([^.]+)/i,
  );
  if (
    enchantedOrModifiedCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'enchanted_or_modified_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, enchantedOrModifiedCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enchanted_or_modified_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedOrAnotherKeywordCreatureDiesPattern = new RegExp(
    `whenever\\s+(?:${dieNameVariants.join('|')}|this creature)\\s+or\\s+another\\s+creature\\s+you\\s+control\\s+with\\s+([\\w]+\\s+or\\s+[\\w]+|[\\w]+)\\s+dies,?\\s*([^.]+)`,
    'i',
  );
  const namedOrAnotherKeywordCreatureDiesMatch = oracleText.match(namedOrAnotherKeywordCreatureDiesPattern);
  if (
    namedOrAnotherKeywordCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'named_or_another_keyword_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrAnotherKeywordCreatureDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_another_keyword_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreOtherCreaturesOrArtifactsDieMatch = oracleText.match(
    /whenever one or more other creatures and\/or artifacts you control die,?\s*([^.]+)/i,
  );
  if (
    oneOrMoreOtherCreaturesOrArtifactsDieMatch &&
    !triggers.some((t) => t.triggerType === 'one_or_more_other_creatures_or_artifacts_die')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreOtherCreaturesOrArtifactsDieMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'one_or_more_other_creatures_or_artifacts_die',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisOrAnotherArtifactCreatureDiesMatch = oracleText.match(
    /whenever this creature or another artifact creature dies,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherArtifactCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_another_artifact_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherArtifactCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_artifact_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedEntersOrPlaneswalkerDiesMatch = oracleText.match(
    new RegExp(
      `whenever (?:${dieSelfAlternatives.join('|')}) enters or a planeswalker you control dies,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedEntersOrPlaneswalkerDiesMatch &&
    !triggers.some((t) => t.triggerType === 'named_enters_or_planeswalker_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedEntersOrPlaneswalkerDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_enters_or_planeswalker_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const planeswalkerYouControlDiesMatch = oracleText.match(
    /whenever a planeswalker you control dies,?\s*([^.]+)/i,
  );
  if (
    planeswalkerYouControlDiesMatch &&
    !triggers.some((t) => t.triggerType === 'planeswalker_you_control_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, planeswalkerYouControlDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'planeswalker_you_control_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedOrNontokenTypedCreatureDiesMatch = oracleText.match(
    new RegExp(
      `whenever (?:${dieSelfAlternatives.join('|')}) or another nontoken ([\\w]+(?: or [\\w]+)*) you control dies,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedOrNontokenTypedCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'named_or_nontoken_typed_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrNontokenTypedCreatureDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_nontoken_typed_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const bountyCounterCreatureDiesMatch = oracleText.match(
    /whenever a creature with a bounty counter on it dies,?\s*([^.]+)/i,
  );
  if (
    bountyCounterCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'bounty_counter_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, bountyCounterCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'bounty_counter_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureOrPlaneswalkerDiesMatch = oracleText.match(
    /whenever a creature or planeswalker you control dies,?\s*([^.]+)/i,
  );
  if (
    creatureOrPlaneswalkerDiesMatch &&
    !triggers.some((t) => t.triggerType === 'creature_or_planeswalker_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, creatureOrPlaneswalkerDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_or_planeswalker_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherCreatureOrPlaneswalkerDiesMatch = oracleText.match(
    /whenever another creature or planeswalker you control dies,?\s*([^.]+)/i,
  );
  if (
    anotherCreatureOrPlaneswalkerDiesMatch &&
    !triggers.some((t) => t.triggerType === 'another_creature_or_planeswalker_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherCreatureOrPlaneswalkerDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_creature_or_planeswalker_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisOrAnotherCreatureOrArtifactDiesMatch = oracleText.match(
    /whenever this creature or another creature or artifact you control dies,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherCreatureOrArtifactDiesMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_another_creature_or_artifact_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherCreatureOrArtifactDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_creature_or_artifact_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const nonTypeCreatureYouControlDiesMatch = oracleText.match(
    /when(?:ever)? (?:another )?(?:a )?non-([\w]+) creature you control dies,?\s*([^.]+)/i,
  );
  if (
    nonTypeCreatureYouControlDiesMatch &&
    !triggers.some((t) => t.triggerType === 'non_type_creature_you_control_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, nonTypeCreatureYouControlDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'non_type_creature_you_control_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherCreatureWithDeathtouchDiesMatch = oracleText.match(
    /whenever another creature you control with deathtouch dies,?\s*([^.]+)/i,
  );
  if (
    anotherCreatureWithDeathtouchDiesMatch &&
    !triggers.some((t) => t.triggerType === 'another_creature_with_deathtouch_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherCreatureWithDeathtouchDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_creature_with_deathtouch_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherNontokenMultiTypedDiesMatch = oracleText.match(
    /whenever another nontoken ([\w]+ or [\w]+) you control dies,?\s*([^.]+)/i,
  );
  if (
    anotherNontokenMultiTypedDiesMatch &&
    !triggers.some((t) => t.triggerType === 'another_nontoken_multi_typed_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherNontokenMultiTypedDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_nontoken_multi_typed_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creaturePowerOrToughnessOrLessDiesMatch = oracleText.match(
    /whenever a creature you control with power or toughness (\d+) or less dies,?\s*([^.]+)/i,
  );
  if (
    creaturePowerOrToughnessOrLessDiesMatch &&
    !triggers.some((t) => t.triggerType === 'creature_power_or_toughness_or_less_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, creaturePowerOrToughnessOrLessDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_power_or_toughness_or_less_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentGreatestPowerCreatureDiesMatch = oracleText.match(
    /whenever a creature an opponent controls with the greatest power among creatures that player controls dies,?\s*([^.]+)/i,
  );
  if (
    opponentGreatestPowerCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'opponent_greatest_power_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, opponentGreatestPowerCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_greatest_power_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const chosenTypeCreatureDiesMatch = oracleText.match(
    /whenever a creature of the chosen type dies,?\s*([^.]+)/i,
  );
  if (chosenTypeCreatureDiesMatch && !triggers.some((t) => t.triggerType === 'chosen_type_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, chosenTypeCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'chosen_type_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const notedTypeOpponentCreatureDiesMatch = oracleText.match(
    /whenever a creature an opponent controls of the noted type dies,?\s*([^.]+)/i,
  );
  if (
    notedTypeOpponentCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'noted_type_opponent_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, notedTypeOpponentCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'noted_type_opponent_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreAttackingCreaturesDieMatch = oracleText.match(
    /whenever one or more attacking creatures you control die,?\s*([^.]+)/i,
  );
  if (
    oneOrMoreAttackingCreaturesDieMatch &&
    !triggers.some((t) => t.triggerType === 'one_or_more_attacking_creatures_die')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreAttackingCreaturesDieMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'one_or_more_attacking_creatures_die',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherLegendaryPermanentGyFromBfMatch = oracleText.match(
    new RegExp(
      `whenever a legendary permanent other than (?:${dieNameVariants.join('|')}) is put into a graveyard from the battlefield,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    anotherLegendaryPermanentGyFromBfMatch &&
    !triggers.some((t) => t.triggerType === 'another_legendary_permanent_graveyard_from_battlefield')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherLegendaryPermanentGyFromBfMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_legendary_permanent_graveyard_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedCreatureGyFromBfMatch = oracleText.match(
    /whenever a ([\w]+) you control is put into a graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (
    typedCreatureGyFromBfMatch &&
    !lowerOracle.includes('nontoken') &&
    !triggers.some((t) => t.triggerType === 'typed_creature_graveyard_from_battlefield')
  ) {
    const effectText = timingTriggerEffect(oracleText, typedCreatureGyFromBfMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'typed_creature_graveyard_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherCreatureWithFlyingDiesMatch = oracleText.match(
    /whenever another creature you control with flying dies,?\s*([^.]+)/i,
  );
  if (
    anotherCreatureWithFlyingDiesMatch &&
    !triggers.some((t) => t.triggerType === 'another_creature_with_flying_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherCreatureWithFlyingDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_creature_with_flying_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentCreatureWithCounterDiesMatch = oracleText.match(
    /whenever a creature an opponent controls with a counter on it dies,?\s*([^.]+)/i,
  );
  if (
    opponentCreatureWithCounterDiesMatch &&
    !triggers.some((t) => t.triggerType === 'opponent_creature_with_counter_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, opponentCreatureWithCounterDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_creature_with_counter_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const nonblackCardPlayerGyMatch = oracleText.match(
    /whenever a nonblack card is put into a player's graveyard from anywhere,?\s*([^.]+)/i,
  );
  if (nonblackCardPlayerGyMatch && !triggers.some((t) => t.triggerType === 'nonblack_card_player_graveyard_from_anywhere')) {
    const effectText = timingTriggerEffect(oracleText, nonblackCardPlayerGyMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'nonblack_card_player_graveyard_from_anywhere',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisOrAnotherNontokenTypedDiesMatch = oracleText.match(
    /whenever this creature or another nontoken ([\w]+) you control dies,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherNontokenTypedDiesMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_another_nontoken_typed_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherNontokenTypedDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_nontoken_typed_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisOrAnotherNontokenArtifactGyMatch = oracleText.match(
    /whenever this artifact or another nontoken artifact you control is put into a graveyard from the battlefield(?: or is put into exile from the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherNontokenArtifactGyMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_another_nontoken_artifact_graveyard')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherNontokenArtifactGyMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_nontoken_artifact_graveyard',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const nontokenArtifactGyOrExileMatch = oracleText.match(
    /whenever this creature or another nontoken artifact you control is put into a graveyard from the battlefield or is put into exile from the battlefield,?\s*([^.]+)/i,
  );
  if (
    nontokenArtifactGyOrExileMatch &&
    !triggers.some((t) => t.triggerType === 'nontoken_artifact_graveyard_or_exile_from_battlefield')
  ) {
    const effectText = timingTriggerEffect(oracleText, nontokenArtifactGyOrExileMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'nontoken_artifact_graveyard_or_exile_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureWithShadowDiesMatch = oracleText.match(/whenever a creature with shadow dies,?\s*([^.]+)/i);
  if (creatureWithShadowDiesMatch && !triggers.some((t) => t.triggerType === 'creature_with_shadow_dies')) {
    const effectText = timingTriggerEffect(oracleText, creatureWithShadowDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_with_shadow_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const auraYouControlGyMatch = oracleText.match(
    /whenever an aura you control is put into your graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (auraYouControlGyMatch && !triggers.some((t) => t.triggerType === 'aura_you_control_graveyard_from_battlefield')) {
    const effectText = timingTriggerEffect(oracleText, auraYouControlGyMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'aura_you_control_graveyard_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const attackingMultiTypedGyMatch = oracleText.match(
    /whenever an attacking ([\w]+) or ([\w]+) is put into your graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (attackingMultiTypedGyMatch && !triggers.some((t) => t.triggerType === 'attacking_multi_typed_graveyard_from_battlefield')) {
    const effectText = timingTriggerEffect(oracleText, attackingMultiTypedGyMatch, 3);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'attacking_multi_typed_graveyard_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const permanentCardsYourGyWhileMatch = oracleText.match(
    /whenever one or more permanent cards are put into your graveyard from anywhere while [^,]+,?\s*([^.]+)/i,
  );
  if (permanentCardsYourGyWhileMatch && !triggers.some((t) => t.triggerType === 'permanent_cards_your_graveyard_while_condition')) {
    const effectText = timingTriggerEffect(oracleText, permanentCardsYourGyWhileMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'permanent_cards_your_graveyard_while_condition',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherCreatureYouOwnDiesMatch = oracleText.match(
    /whenever another creature you own dies,?\s*([^.]+)/i,
  );
  if (anotherCreatureYouOwnDiesMatch && !triggers.some((t) => t.triggerType === 'another_creature_you_own_dies')) {
    const effectText = timingTriggerEffect(oracleText, anotherCreatureYouOwnDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_creature_you_own_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const rollThirdDieMatch = oracleText.match(/whenever you roll your third die each turn,?\s*([^.]+)/i);
  if (rollThirdDieMatch && !triggers.some((t) => t.triggerType === 'roll_third_die_each_turn')) {
    const effectText = timingTriggerEffect(oracleText, rollThirdDieMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'roll_third_die_each_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentDrawsFirstCardMatch = oracleText.match(
    /whenever an opponent draws their first card each turn,?\s*([^.]+)/i,
  );
  if (opponentDrawsFirstCardMatch && !triggers.some((t) => t.triggerType === 'opponent_draws_first_card_each_turn')) {
    const effectText = timingTriggerEffect(oracleText, opponentDrawsFirstCardMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_draws_first_card_each_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const zombieOrMutantDiesMatch = oracleText.match(/whenever a ([\w]+) or ([\w]+) you control dies,?\s*([^.]+)/i);
  if (
    zombieOrMutantDiesMatch &&
    !triggers.some((t) => t.triggerType === 'multi_typed_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, zombieOrMutantDiesMatch, 3);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'multi_typed_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const foodGyFromBfMatch = oracleText.match(/whenever a food is put into a graveyard from the battlefield,?\s*([^.]+)/i);
  if (foodGyFromBfMatch && !triggers.some((t) => t.triggerType === 'food_graveyard_from_battlefield')) {
    const effectText = timingTriggerEffect(oracleText, foodGyFromBfMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'food_graveyard_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureTokenDiesMatch = oracleText.match(/whenever a creature token dies,?\s*([^.]+)/i);
  if (creatureTokenDiesMatch && !triggers.some((t) => t.triggerType === 'creature_token_dies')) {
    const effectText = timingTriggerEffect(oracleText, creatureTokenDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_token_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const permanentOwnedByAnotherPlayerGyMatch = oracleText.match(
    /whenever a permanent owned by another player is put into a graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (
    permanentOwnedByAnotherPlayerGyMatch &&
    !triggers.some((t) => t.triggerType === 'permanent_owned_by_another_player_graveyard_from_battlefield')
  ) {
    const effectText = timingTriggerEffect(oracleText, permanentOwnedByAnotherPlayerGyMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'permanent_owned_by_another_player_graveyard_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureWithCountersDiesMatch = oracleText.match(
    /whenever a creature you control with one or more counters on it dies,?\s*([^.]+)/i,
  );
  if (
    creatureWithCountersDiesMatch &&
    !triggers.some((t) => t.triggerType === 'creature_with_counters_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, creatureWithCountersDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_with_counters_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const equippedCreatureYouControlDiesMatch = oracleText.match(
    /whenever an equipped creature you control dies,?\s*([^.]+)/i,
  );
  if (
    equippedCreatureYouControlDiesMatch &&
    !triggers.some((t) => t.triggerType === 'equipped_creature_you_control_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, equippedCreatureYouControlDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'equipped_creature_you_control_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const heroesControlCreatureDiesMatch = oracleText.match(
    /whenever a creature the heroes control dies,?\s*([^.]+)/i,
  );
  if (heroesControlCreatureDiesMatch && !triggers.some((t) => t.triggerType === 'heroes_control_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, heroesControlCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'heroes_control_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const bossesControlCreatureDiesMatch = oracleText.match(
    /whenever a creature the bosses control dies,?\s*([^.]+)/i,
  );
  if (bossesControlCreatureDiesMatch && !triggers.some((t) => t.triggerType === 'bosses_control_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, bossesControlCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'bosses_control_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherCardGyFromAnywhereMatch = oracleText.match(
    /whenever another card is put into a graveyard from anywhere,?\s*([^.]+)/i,
  );
  if (
    anotherCardGyFromAnywhereMatch &&
    !triggers.some((t) => t.triggerType === 'another_card_graveyard_from_anywhere')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherCardGyFromAnywhereMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_card_graveyard_from_anywhere',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherGoblinGyFromBfMatch = oracleText.match(
    /whenever another Goblin you control is put into a graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (
    anotherGoblinGyFromBfMatch &&
    !triggers.some((t) => t.triggerType === 'another_goblin_graveyard_from_battlefield')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherGoblinGyFromBfMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_goblin_graveyard_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOfEnchantedCreaturesDiesMatch = oracleText.match(/when one of the enchanted creatures dies,?\s*([^.]+)/i);
  if (
    oneOfEnchantedCreaturesDiesMatch &&
    !triggers.some((t) => t.triggerType === 'one_of_enchanted_creatures_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOfEnchantedCreaturesDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'one_of_enchanted_creatures_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const birdYourGyFromBfMatch = oracleText.match(
    /whenever a Bird is put into your graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (birdYourGyFromBfMatch && !triggers.some((t) => t.triggerType === 'bird_your_graveyard_from_battlefield')) {
    const effectText = timingTriggerEffect(oracleText, birdYourGyFromBfMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'bird_your_graveyard_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const chosenPermanentGyFromBfMatch = oracleText.match(
    /when the chosen permanent is put into a graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (chosenPermanentGyFromBfMatch && !triggers.some((t) => t.triggerType === 'chosen_permanent_graveyard_from_battlefield')) {
    const effectText = timingTriggerEffect(oracleText, chosenPermanentGyFromBfMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'chosen_permanent_graveyard_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureDontOwnDiesMatch = oracleText.match(
    /whenever a creature you control but don't own dies,?\s*([^.]+)/i,
  );
  if (creatureDontOwnDiesMatch && !triggers.some((t) => t.triggerType === 'creature_you_control_dont_own_dies')) {
    const effectText = timingTriggerEffect(oracleText, creatureDontOwnDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_you_control_dont_own_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantmentOrNonlandGyMatch = oracleText.match(
    /whenever this enchantment or another nonland permanent you control is put into a graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (enchantmentOrNonlandGyMatch && !triggers.some((t) => t.triggerType === 'enchantment_or_nonland_graveyard_from_battlefield')) {
    const effectText = timingTriggerEffect(oracleText, enchantmentOrNonlandGyMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enchantment_or_nonland_graveyard_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const auraOrEquipmentGyMatch = oracleText.match(
    /whenever an Aura or Equipment you control is put into a graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (auraOrEquipmentGyMatch && !triggers.some((t) => t.triggerType === 'aura_or_equipment_graveyard_from_battlefield')) {
    const effectText = timingTriggerEffect(oracleText, auraOrEquipmentGyMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'aura_or_equipment_graveyard_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const spiderDealtDamageCreatureDiesMatch = oracleText.match(
    /whenever another creature dealt damage this turn by a Spider you controlled dies,?\s*([^.]+)/i,
  );
  if (
    spiderDealtDamageCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'spider_dealt_damage_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, spiderDealtDamageCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'spider_dealt_damage_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const spiritOrDisturbGyMatch = oracleText.match(
    /whenever a Spirit card or a card with disturb is put into your graveyard from anywhere,?\s*([^.]+)/i,
  );
  if (spiritOrDisturbGyMatch && !triggers.some((t) => t.triggerType === 'spirit_or_disturb_your_graveyard_from_anywhere')) {
    const effectText = timingTriggerEffect(oracleText, spiritOrDisturbGyMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'spirit_or_disturb_your_graveyard_from_anywhere',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureCardYourGyFromAnywhereMatch = oracleText.match(
    /whenever a creature card is put into your graveyard from anywhere,?\s*([^.]+)/i,
  );
  if (
    creatureCardYourGyFromAnywhereMatch &&
    !triggers.some((t) => t.triggerType === 'creature_card_your_graveyard_from_anywhere')
  ) {
    const effectText = timingTriggerEffect(oracleText, creatureCardYourGyFromAnywhereMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_card_your_graveyard_from_anywhere',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const blackCardOpponentGyMatch = oracleText.match(
    /whenever a black card is put into an opponent's graveyard from anywhere,?\s*([^.]+)/i,
  );
  if (blackCardOpponentGyMatch && !triggers.some((t) => t.triggerType === 'black_card_opponent_graveyard_from_anywhere')) {
    const effectText = timingTriggerEffect(oracleText, blackCardOpponentGyMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'black_card_opponent_graveyard_from_anywhere',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedOrAnotherTypedDiesPattern = new RegExp(
    `whenever\\s+(?:${dieNameVariants.join('|')}|this creature)\\s+or\\s+another\\s+(?:nontoken\\s+)?([\\w]+)\\s+you\\s+control\\s+dies,?\\s*([^.]+)`,
    'i',
  );
  const namedOrAnotherTypedDiesMatch = oracleText.match(namedOrAnotherTypedDiesPattern);
  if (
    namedOrAnotherTypedDiesMatch &&
    !triggers.some((t) => t.triggerType === 'named_or_another_typed_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrAnotherTypedDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_another_typed_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisOrAnotherTypedDiesNoControlMatch = oracleText.match(
    /whenever this creature or another ([\w]+) dies,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherTypedDiesNoControlMatch &&
    !lowerOracle.includes('you control') &&
    !triggers.some((t) => t.triggerType === 'this_or_another_typed_creature_dies_any')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherTypedDiesNoControlMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_typed_creature_dies_any',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const nontokenTypedDiesMatch = oracleText.match(
    /whenever (?:a |an )?nontoken ([\w]+) you control dies,?\s*([^.]+)/i,
  );
  if (nontokenTypedDiesMatch && !triggers.some((t) => t.triggerType === 'nontoken_typed_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, nontokenTypedDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'nontoken_typed_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherNontokenTypedDiesMatch = oracleText.match(
    /whenever another nontoken ([\w]+) you control dies,?\s*([^.]+)/i,
  );
  if (anotherNontokenTypedDiesMatch && !triggers.some((t) => t.triggerType === 'another_nontoken_typed_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, anotherNontokenTypedDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_nontoken_typed_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedEntersOrAnotherNontokenTypedDiesMatch = oracleText.match(
    new RegExp(
      `whenever (?:${dieSelfAlternatives.join('|')}) enters or another nontoken ([\\w]+) you control dies,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedEntersOrAnotherNontokenTypedDiesMatch &&
    !triggers.some((t) => t.triggerType === 'named_enters_or_another_nontoken_typed_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedEntersOrAnotherNontokenTypedDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_enters_or_another_nontoken_typed_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const flyingCreatureDiesMatch = oracleText.match(
    /whenever a creature with flying dies,?\s*([^.]+)/i,
  );
  if (flyingCreatureDiesMatch && !triggers.some((t) => t.triggerType === 'flying_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, flyingCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'flying_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreOtherTypedDieMatch = oracleText.match(
    /whenever one or more other ([\w]+(?: or [\w]+)*) you control die,?\s*([^.]+)/i,
  );
  if (oneOrMoreOtherTypedDieMatch && !triggers.some((t) => t.triggerType === 'one_or_more_other_typed_die')) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreOtherTypedDieMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'one_or_more_other_typed_die',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const nontokenNonTypeCreatureDiesMatch = oracleText.match(
    /whenever a nontoken, non-([\w]+) creature you control dies,?\s*([^.]+)/i,
  );
  if (nontokenNonTypeCreatureDiesMatch && !triggers.some((t) => t.triggerType === 'nontoken_non_type_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, nontokenNonTypeCreatureDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'nontoken_non_type_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureWithoutFlyingDiesMatch = oracleText.match(
    /whenever a creature you control without flying dies,?\s*([^.]+)/i,
  );
  if (creatureWithoutFlyingDiesMatch && !triggers.some((t) => t.triggerType === 'creature_without_flying_dies')) {
    const effectText = timingTriggerEffect(oracleText, creatureWithoutFlyingDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_without_flying_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const faceDownCreatureDiesMatch = oracleText.match(
    /whenever a face-down creature you control dies,?\s*([^.]+)/i,
  );
  if (faceDownCreatureDiesMatch && !triggers.some((t) => t.triggerType === 'face_down_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, faceDownCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'face_down_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const targetCreatureOtherThanSelfDiesThisTurnMatch = oracleText.match(
    /when target creature other than this creature dies this turn,?\s*([^.]+)/i,
  );
  if (
    targetCreatureOtherThanSelfDiesThisTurnMatch &&
    !triggers.some((t) => t.triggerType === 'target_creature_other_than_self_dies_this_turn')
  ) {
    const effectText = timingTriggerEffect(oracleText, targetCreatureOtherThanSelfDiesThisTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'target_creature_other_than_self_dies_this_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureOpponentGraveyardFromBattlefieldMatch = oracleText.match(
    /when a creature is put into an opponent's graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (
    creatureOpponentGraveyardFromBattlefieldMatch &&
    !triggers.some((t) => t.triggerType === 'creature_opponent_graveyard_from_battlefield')
  ) {
    const effectText = timingTriggerEffect(oracleText, creatureOpponentGraveyardFromBattlefieldMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_opponent_graveyard_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const nontokenTypedGraveyardFromBattlefieldMatch = oracleText.match(
    /whenever another nontoken ([\w]+) is put into your graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (
    nontokenTypedGraveyardFromBattlefieldMatch &&
    !triggers.some((t) => t.triggerType === 'nontoken_typed_graveyard_from_battlefield')
  ) {
    const effectText = timingTriggerEffect(oracleText, nontokenTypedGraveyardFromBattlefieldMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'nontoken_typed_graveyard_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedPermanentCardYourGyNotBattlefieldMatch = oracleText.match(
    /whenever a ([\w]+) permanent card is put into your graveyard from anywhere other than the battlefield,?\s*([^.]+)/i,
  );
  if (
    typedPermanentCardYourGyNotBattlefieldMatch &&
    !triggers.some((t) => t.triggerType === 'typed_permanent_card_your_graveyard_not_battlefield')
  ) {
    const effectText = timingTriggerEffect(oracleText, typedPermanentCardYourGyNotBattlefieldMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'typed_permanent_card_your_graveyard_not_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherCreatureOrArtifactDiesMatch = oracleText.match(
    /whenever another creature or artifact you control dies,?\s*([^.]+)/i,
  );
  if (
    anotherCreatureOrArtifactDiesMatch &&
    !triggers.some((t) => t.triggerType === 'another_creature_or_artifact_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherCreatureOrArtifactDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_creature_or_artifact_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherCommanderDiesMatch = oracleText.match(
    /whenever another [Cc]ommander dies,?\s*([^.]+)/i,
  );
  if (anotherCommanderDiesMatch && !triggers.some((t) => t.triggerType === 'another_commander_dies')) {
    const effectText = timingTriggerEffect(oracleText, anotherCommanderDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_commander_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const fromAnywhereGraveyardPattern = new RegExp(
    `when(?:ever)?\\s+(?:${dieSelfAlternatives.join('|')}|(?:${dieNameVariants.join('|')}))\\s+(?:is )?put into (?:a |your |its owner'?s )?graveyard from anywhere,?\\s*([^.]+)`,
    'i',
  );
  const fromAnywhereGraveyardMatch = oracleText.match(fromAnywhereGraveyardPattern);
  if (fromAnywhereGraveyardMatch && !triggers.some((t) => t.triggerType === 'put_into_graveyard_from_anywhere')) {
    const effectText = timingTriggerEffect(oracleText, fromAnywhereGraveyardMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'put_into_graveyard_from_anywhere',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const controlledDiesMatch = oracleText.match(/when(?:ever)? (?:a|another) (?:[\w]+\s+)*(?:nontoken\s+)?creature you control dies,?\s*([^.]+)/i);
  if (controlledDiesMatch && !triggers.some(t => t.triggerType === 'creature_dies')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_dies',
      description: timingTriggerEffect(oracleText, controlledDiesMatch),
      effect: timingTriggerEffect(oracleText, controlledDiesMatch),
      mandatory: true,
    });
  }

  const attackingCreatureDiesMatch = oracleText.match(
    /whenever an attacking creature(?: you control)? dies,?\s*([^.]+)/i,
  );
  if (attackingCreatureDiesMatch && !triggers.some((t) => t.triggerType === 'attacking_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, attackingCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'attacking_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherControlledEntersOrDiesMatch = oracleText.match(
    /whenever another creature you control enters or dies,?\s*([^.]+)/i,
  );
  if (
    anotherControlledEntersOrDiesMatch &&
    !triggers.some((t) => t.triggerType === 'another_controlled_enters_or_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherControlledEntersOrDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_controlled_enters_or_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const entersOrAnotherCreatureDiesPattern = new RegExp(
    `whenever\\s+(?:${dieSelfAlternatives.join('|')})\\s+enters(?: the battlefield)?\\s+or\\s+another\\s+creature\\s+dies,?\\s*([^.]+)`,
    'i',
  );
  const entersOrAnotherCreatureDiesMatch = oracleText.match(entersOrAnotherCreatureDiesPattern);
  if (
    entersOrAnotherCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'enters_or_another_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, entersOrAnotherCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enters_or_another_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }
  
  // "Whenever/When a creature dies" (any creature)
  const anyDiesMatch = oracleText.match(/when(?:ever)? (?:a|another) (?:[\w]+\s+)*(?:nontoken\s+)?creature dies,?\s*([^.]+)/i);
  if (anyDiesMatch && 
      !lowerOracle.includes('creature you control dies') && 
      !lowerOracle.includes('creature an opponent controls dies') &&
      !lowerOracle.includes("creature you don't control dies") &&
      !triggers.some(t => t.triggerType === 'any_creature_dies')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'any_creature_dies',
      description: timingTriggerEffect(oracleText, anyDiesMatch),
      effect: timingTriggerEffect(oracleText, anyDiesMatch),
      mandatory: true,
    });
  }
  
  // "Whenever a creature an opponent controls dies" or "Whenever a creature you don't control dies"
  const putIntoGraveyardFromBattlefieldMatch = oracleText.match(
    /when(?:ever)? (?:a|an|another) (?:[\w]+\s+)*(?:artifact|creature|enchantment|permanent|land)(?: you control)?(?: or (?:artifact|creature) you control)? is put into (?:a |your |its owner's )?graveyard from the battlefield,?\s*([^.]+)/i,
  );
  const anotherControlledArtifactOrCreatureGraveyardMatch = oracleText.match(
    /whenever another (?:artifact or creature|creature or artifact) you control is put into (?:a |your |its owner's )?graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (
    anotherControlledArtifactOrCreatureGraveyardMatch &&
    !triggers.some((t) => t.triggerType === 'another_controlled_artifact_or_creature_graveyard')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherControlledArtifactOrCreatureGraveyardMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_controlled_artifact_or_creature_graveyard',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }
  const anyEnchantmentGraveyardMatch = oracleText.match(
    /whenever an enchantment is put into (?:a |your |its owner's )?graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (
    anyEnchantmentGraveyardMatch &&
    !lowerOracle.includes('enchantment you control is put') &&
    !triggers.some((t) => t.triggerType === 'any_enchantment_graveyard')
  ) {
    const effectText = timingTriggerEffect(oracleText, anyEnchantmentGraveyardMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'any_enchantment_graveyard',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }
  const anotherArtifactOrCreatureGraveyardMatch = oracleText.match(
    /whenever another (?:artifact or creature|creature or artifact) is put into (?:a |your |its owner's )?graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (
    anotherArtifactOrCreatureGraveyardMatch &&
    !triggers.some((t) => t.triggerType === 'another_artifact_or_creature_graveyard')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherArtifactOrCreatureGraveyardMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_artifact_or_creature_graveyard',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }
  if (putIntoGraveyardFromBattlefieldMatch && !triggers.some((t) => t.triggerType === 'put_into_graveyard_from_battlefield')) {
    const effectText = timingTriggerEffect(oracleText, putIntoGraveyardFromBattlefieldMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'put_into_graveyard_from_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const legendaryOpponentDiesMatch = oracleText.match(
    /when a legendary creature an opponent controls dies,?\s*([^.]+)/i,
  );
  if (legendaryOpponentDiesMatch && !triggers.some((t) => t.triggerType === 'legendary_opponent_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, legendaryOpponentDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'legendary_opponent_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const controlNoneSacrificePattern = new RegExp(
    `when you control no ([^,]+),?\\s*sacrifice (?:${dieSelfAlternatives.join('|')})`,
    'i',
  );
  const controlNoneSacrificeMatch = oracleText.match(controlNoneSacrificePattern);
  if (controlNoneSacrificeMatch && !triggers.some((t) => t.triggerType === 'control_none_sacrifice')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'control_none_sacrifice',
      description: String(controlNoneSacrificeMatch[0] || '').trim(),
      effect: String(controlNoneSacrificeMatch[0] || '').trim(),
      mandatory: true,
    });
  }

  const graveyardZoneDiesPattern = new RegExp(
    `whenever (?:a |an )?(?:[\\w]+\\s+)*creature (?:an opponent controls|you don't control) dies while (?:${dieNameVariants.join('|')}) is in your graveyard,?\\s*([^.]+)`,
    'i',
  );
  const graveyardZoneDiesMatch = oracleText.match(graveyardZoneDiesPattern);
  if (graveyardZoneDiesMatch && !triggers.some((t) => t.triggerType === 'graveyard_zone_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, graveyardZoneDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'graveyard_zone_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentArtifactGraveyardMatch = oracleText.match(
    /whenever an artifact an opponent controls is put into (?:a )?graveyard from the battlefield,?\s*([^.]+)/i,
  );
  if (
    opponentArtifactGraveyardMatch &&
    !triggers.some((t) => t.triggerType === 'opponent_artifact_graveyard')
  ) {
    const effectText = timingTriggerEffect(oracleText, opponentArtifactGraveyardMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_artifact_graveyard',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentDiesMatch = oracleText.match(/whenever (?:a|another) (?:nontoken )?creature (?:an opponent controls|you don't control) dies,?\s*([^.]+)/i);
  if (opponentDiesMatch && !triggers.some(t => t.triggerType === 'opponent_creature_dies')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_creature_dies',
      description: timingTriggerEffect(oracleText, opponentDiesMatch),
      effect: timingTriggerEffect(oracleText, opponentDiesMatch),
      mandatory: true,
    });
  }

  const oneOrMoreOtherCreaturesDieMatch = oracleText.match(/whenever one or more other creatures die,?\s*([^.]+)/i);
  if (
    oneOrMoreOtherCreaturesDieMatch &&
    !triggers.some((t) => t.triggerType === 'one_or_more_other_creatures_die')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreOtherCreaturesDieMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'one_or_more_other_creatures_die',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreAttackingLegendaryCreaturesDieMatch = oracleText.match(
    /whenever one or more other attacking legendary creatures you control die,?\s*([^.]+)/i,
  );
  if (
    oneOrMoreAttackingLegendaryCreaturesDieMatch &&
    !triggers.some((t) => t.triggerType === 'one_or_more_attacking_legendary_creatures_die')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreAttackingLegendaryCreaturesDieMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'one_or_more_attacking_legendary_creatures_die',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreArtifactCreaturesDieMatch = oracleText.match(
    /whenever one or more artifact creatures you control die,?\s*([^.]+)/i,
  );
  if (
    oneOrMoreArtifactCreaturesDieMatch &&
    !triggers.some((t) => t.triggerType === 'one_or_more_artifact_creatures_die')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreArtifactCreaturesDieMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'one_or_more_artifact_creatures_die',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherMultiTypedCreatureDiesMatch = oracleText.match(
    /whenever another ([\w]+) or ([\w]+) you control dies,?\s*([^.]+)/i,
  );
  if (
    anotherMultiTypedCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'another_multi_typed_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherMultiTypedCreatureDiesMatch, 3);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_multi_typed_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisOrATypedCreatureDiesMatch = oracleText.match(
    /whenever this creature or a ([\w]+) you control dies,?\s*([^.]+)/i,
  );
  if (
    thisOrATypedCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_a_typed_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrATypedCreatureDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_a_typed_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  // Delayed fight/spell follow-up: "When the creature an opponent controls dies this turn, ..."
  const opponentCreatureDiesThisTurnMatch = oracleText.match(
    /when(?:ever)? the creature an opponent controls dies this turn,?\s*([^.]+)/i,
  );
  if (
    opponentCreatureDiesThisTurnMatch
    && !triggers.some((t) => t.triggerType === 'opponent_creature_dies_this_turn')
  ) {
    const effectText = timingTriggerEffect(oracleText, opponentCreatureDiesThisTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_creature_dies_this_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const itDiesThisTurnMatch = oracleText.match(/when it dies this turn,?\s*([^.]+)/i);
  if (itDiesThisTurnMatch && !triggers.some((t) => t.triggerType === 'it_dies_this_turn')) {
    const effectText = timingTriggerEffect(oracleText, itDiesThisTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'it_dies_this_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const permanentYouDontControlDiesThisTurnMatch = oracleText.match(
    /when the permanent you don't control dies this turn,?\s*([^.]+)/i,
  );
  if (
    permanentYouDontControlDiesThisTurnMatch &&
    !triggers.some((t) => t.triggerType === 'permanent_you_dont_control_dies_this_turn')
  ) {
    const effectText = timingTriggerEffect(oracleText, permanentYouDontControlDiesThisTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'permanent_you_dont_control_dies_this_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const nontokenCounterCreatureDiesMatch = oracleText.match(
    /whenever a nontoken creature you control with a \+1\/\+1 counter on it dies,?\s*([^.]+)/i,
  );
  if (
    nontokenCounterCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'nontoken_counter_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, nontokenCounterCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'nontoken_counter_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreControlledCreaturesDieMatch = oracleText.match(
    /whenever one or more creatures you control die,?\s*([^.]+)/i,
  );
  if (
    oneOrMoreControlledCreaturesDieMatch &&
    !lowerOracle.includes('one or more other creatures you control die') &&
    !triggers.some((t) => t.triggerType === 'one_or_more_controlled_creatures_die')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreControlledCreaturesDieMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'one_or_more_controlled_creatures_die',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreOtherControlledCreaturesDieMatch = oracleText.match(
    /whenever one or more other creatures you control die,?\s*([^.]+)/i,
  );
  if (
    oneOrMoreOtherControlledCreaturesDieMatch &&
    !triggers.some((t) => t.triggerType === 'one_or_more_other_controlled_creatures_die')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreOtherControlledCreaturesDieMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'one_or_more_other_controlled_creatures_die',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreNontokenControlledDieMatch = oracleText.match(
    /whenever one or more nontoken creatures you control die,?\s*([^.]+)/i,
  );
  if (
    oneOrMoreNontokenControlledDieMatch &&
    !triggers.some((t) => t.triggerType === 'one_or_more_nontoken_creatures_you_control_die')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreNontokenControlledDieMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'one_or_more_nontoken_creatures_you_control_die',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const cardPutIntoOpponentGyFromAnywhereMatch = oracleText.match(
    /whenever a card is put into an opponent's graveyard from anywhere,?\s*([^.]+)/i,
  );
  if (
    cardPutIntoOpponentGyFromAnywhereMatch &&
    !triggers.some((t) => t.triggerType === 'card_put_into_opponent_graveyard_from_anywhere')
  ) {
    const effectText = timingTriggerEffect(oracleText, cardPutIntoOpponentGyFromAnywhereMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'card_put_into_opponent_graveyard_from_anywhere',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreNontokenCreaturesDieMatch = oracleText.match(/whenever one or more nontoken creatures die,?\s*([^.]+)/i);
  if (
    oneOrMoreNontokenCreaturesDieMatch &&
    !lowerOracle.includes('nontoken creatures you control die') &&
    !triggers.some((t) => t.triggerType === 'one_or_more_nontoken_creatures_die')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreNontokenCreaturesDieMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'one_or_more_nontoken_creatures_die',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreCreaturesDieMatch = oracleText.match(/whenever one or more creatures die,?\s*([^.]+)/i);
  if (
    oneOrMoreCreaturesDieMatch &&
    !lowerOracle.includes('one or more other creatures die') &&
    !lowerOracle.includes('one or more nontoken creatures die') &&
    !triggers.some((t) => t.triggerType === 'one_or_more_creatures_die')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreCreaturesDieMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'one_or_more_creatures_die',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const hauntsCreatureDiesMatch = oracleText.match(
    new RegExp(
      `when(?:ever)? (?:(?:${dieSelfAlternatives.join('|')}) enters(?: the battlefield)? or )?the creature (?:this card|it) haunts dies,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (hauntsCreatureDiesMatch && !triggers.some((t) => t.triggerType === 'haunts_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, hauntsCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'haunts_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const toughnessCreatureDiesMatch = oracleText.match(
    /whenever a creature you control with toughness (\d+) or greater dies,?\s*([^.]+)/i,
  );
  if (toughnessCreatureDiesMatch && !triggers.some((t) => t.triggerType === 'toughness_creature_dies')) {
    const effectText = timingTriggerEffect(oracleText, toughnessCreatureDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'toughness_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureCardsYourGyFromAnywhereMatch = oracleText.match(
    /whenever one or more creature cards are put into your graveyard from anywhere,?\s*([^.]+)/i,
  );
  if (
    creatureCardsYourGyFromAnywhereMatch &&
    !triggers.some((t) => t.triggerType === 'creature_cards_your_graveyard_from_anywhere')
  ) {
    const effectText = timingTriggerEffect(oracleText, creatureCardsYourGyFromAnywhereMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_cards_your_graveyard_from_anywhere',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const landCardYourGyFromAnywhereMatch = oracleText.match(
    /whenever a land card is put into your graveyard from anywhere,?\s*([^.]+)/i,
  );
  if (
    landCardYourGyFromAnywhereMatch &&
    !triggers.some((t) => t.triggerType === 'land_card_your_graveyard_from_anywhere')
  ) {
    const effectText = timingTriggerEffect(oracleText, landCardYourGyFromAnywhereMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'land_card_your_graveyard_from_anywhere',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const landCardGyFromAnywhereMatch = oracleText.match(
    /whenever a land card is put into a graveyard from anywhere,?\s*([^.]+)/i,
  );
  if (
    landCardGyFromAnywhereMatch &&
    !lowerOracle.includes('put into your graveyard') &&
    !triggers.some((t) => t.triggerType === 'land_card_graveyard_from_anywhere')
  ) {
    const effectText = timingTriggerEffect(oracleText, landCardGyFromAnywhereMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'land_card_graveyard_from_anywhere',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const landCardsPutIntoGyFromAnywhereMatch = oracleText.match(
    /whenever one or more land cards are put into your graveyard from anywhere,?\s*([^.]+)/i,
  );
  if (
    landCardsPutIntoGyFromAnywhereMatch &&
    !triggers.some((t) => t.triggerType === 'land_cards_put_into_graveyard_from_anywhere')
  ) {
    const effectText = timingTriggerEffect(oracleText, landCardsPutIntoGyFromAnywhereMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'land_cards_put_into_graveyard_from_anywhere',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const dealtDamageThisWayDiesMatch = oracleText.match(
    /when(?:ever)? a creature(?: you control)? dealt damage this way dies this turn,?\s*([^.]+)/i,
  );
  if (dealtDamageThisWayDiesMatch && !triggers.some((t) => t.triggerType === 'dealt_damage_this_way_dies')) {
    const effectText = timingTriggerEffect(oracleText, dealtDamageThisWayDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'dealt_damage_this_way_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const minusCounterCreatureDiesMatch = oracleText.match(
    /whenever a creature with a -1\/-1 counter on it dies,?\s*([^.]+)/i,
  );
  if (
    minusCounterCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'minus_counter_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, minusCounterCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'minus_counter_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const impostorCounterCreatureDiesMatch = oracleText.match(
    /whenever a creature you control with an impostor counter on it dies,?\s*([^.]+)/i,
  );
  if (
    impostorCounterCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'impostor_counter_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, impostorCounterCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'impostor_counter_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const attackingOrBlockingCreatureDiesMatch = oracleText.match(
    /whenever an attacking creature you control or a blocking creature an opponent controls dies,?\s*([^.]+)/i,
  );
  if (
    attackingOrBlockingCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'attacking_or_blocking_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, attackingOrBlockingCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'attacking_or_blocking_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentsCreaturesDieMatch = oracleText.match(
    /whenever one or more creatures your opponents control die,?\s*([^.]+)/i,
  );
  if (
    opponentsCreaturesDieMatch &&
    !triggers.some((t) => t.triggerType === 'opponents_creatures_die')
  ) {
    const effectText = timingTriggerEffect(oracleText, opponentsCreaturesDieMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponents_creatures_die',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const itDiesUnderYourControlThisTurnMatch = oracleText.match(
    /when it dies under your control this turn,?\s*([^.]+)/i,
  );
  if (
    itDiesUnderYourControlThisTurnMatch &&
    !triggers.some((t) => t.triggerType === 'it_dies_under_your_control_this_turn')
  ) {
    const effectText = timingTriggerEffect(oracleText, itDiesUnderYourControlThisTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'it_dies_under_your_control_this_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const whenYouDoPayCreateMatch = oracleText.match(
    /when you do, you may pay \{[^}]+\}\. if you do, create[^.]+/i,
  );
  if (
    whenYouDoPayCreateMatch &&
    !triggers.some((t) => t.triggerType === 'when_you_do_pay_create')
  ) {
    const effectText = timingTriggerEffect(oracleText, whenYouDoPayCreateMatch, 0);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'when_you_do_pay_create',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentMinusCounterCreatureDiesMatch = oracleText.match(
    /whenever a creature an opponent controls with a -1\/-1 counter on it dies,?\s*([^.]+)/i,
  );
  if (
    opponentMinusCounterCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'opponent_minus_counter_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, opponentMinusCounterCreatureDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_minus_counter_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherTypedCreatureDiesMatch = oracleText.match(
    /whenever another ([\w]+) you control dies,?\s*([^.]+)/i,
  );
  if (
    anotherTypedCreatureDiesMatch &&
    !triggers.some((t) => t.triggerType === 'another_typed_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherTypedCreatureDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_typed_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedCreatureDiesMatch = oracleText.match(/whenever an? ([\w]+) you control dies,?\s*([^.]+)/i);
  const typedDieSubject = String(typedCreatureDiesMatch?.[1] || '').trim().toLowerCase();
  if (
    typedCreatureDiesMatch &&
    typedDieSubject !== 'creature' &&
    !lowerOracle.includes('creature you control dies') &&
    !triggers.some((t) => t.triggerType === 'typed_creature_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, typedCreatureDiesMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'typed_creature_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedArtifactGraveyardMatch = oracleText.match(
    /when enchanted artifact is put into (?:a )?graveyard,?\s*([^.]+)/i,
  );
  if (
    enchantedArtifactGraveyardMatch &&
    !triggers.some((t) => t.triggerType === 'enchanted_artifact_graveyard')
  ) {
    const effectText = timingTriggerEffect(oracleText, enchantedArtifactGraveyardMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enchanted_artifact_graveyard',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const cardPutIntoGyFromAnywhereMatch = oracleText.match(
    /when(?:ever)? a card is put into your graveyard from anywhere,?\s*([^.]+)/i,
  );
  if (
    cardPutIntoGyFromAnywhereMatch &&
    !triggers.some((t) => t.triggerType === 'card_put_into_graveyard_from_anywhere')
  ) {
    const effectText = timingTriggerEffect(oracleText, cardPutIntoGyFromAnywhereMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'card_put_into_graveyard_from_anywhere',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }
  
  // ===== KNOWN CARDS TABLE (Optimization/Enhancement) =====
  // Use the table to handle special cases and provide enhanced metadata
  // Only add if not already detected dynamically
  for (const [knownName, info] of Object.entries(KNOWN_DEATH_TRIGGERS)) {
    if (lowerName.includes(knownName)) {
      const triggerType = info.triggerOn === 'controlled' ? 'creature_dies' 
        : info.triggerOn === 'any' ? 'any_creature_dies' 
        : info.triggerOn === 'opponent' ? 'opponent_creature_dies'
        : 'dies';
      
      // Only add if not already detected by dynamic pattern
      if (!triggers.some(t => t.triggerType === triggerType)) {
        triggers.push({
          permanentId,
          cardName,
          triggerType,
          description: info.effect,
          effect: info.effect,
          mandatory: true,
        });
      }
    }
  }
  
  return triggers;
}

/**
 * Detect leaves-the-battlefield triggers from a card's oracle text.
 */
export function detectLTBTriggers(card: any, permanent?: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  // Detector regexes scan raw oracle text. Remove only recognized keyword
  // reminders first so a reminder's "when/whenever" cannot become a trigger.
  const oracleText = stripReminderParentheticals(String(card?.oracle_text || ''));
  const lowerOracle = oracleText.toLowerCase();
  const cardName = String(card?.name || 'Unknown');
  const permanentId = permanent?.id || '';
  const ltbAlternatives = [...LTB_STATIC_ALTERNATIVES, ...buildCardNameRegexAlternatives(cardName)];

  const selfLeavesPattern = new RegExp(
    `when(?:ever)?\\s+(?:${ltbAlternatives.join('|')})\\s+leaves(?: the battlefield)?,?\\s*([^.]+)`,
    'i',
  );
  const selfLeavesMatch = oracleText.match(selfLeavesPattern);
  if (selfLeavesMatch && !triggers.some((trigger) => trigger.triggerType === 'ltb')) {
    const effectText = timingTriggerEffect(oracleText, selfLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'ltb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      requiresChoice: effectText.toLowerCase().includes('you may'),
    });
  }

  const ltbAlternativesForEntersOrLeaves = [...LTB_STATIC_ALTERNATIVES, ...buildCardNameRegexAlternatives(cardName)];
  const selfEntersOrLeavesLtbPattern = new RegExp(
    `when(?:ever)?\\s+(?:${ltbAlternativesForEntersOrLeaves.join('|')})\\s+enters or leaves(?: the battlefield)?,?\\s*([^.]+)`,
    'i',
  );
  const selfEntersOrLeavesLtbMatch = oracleText.match(selfEntersOrLeavesLtbPattern);
  if (selfEntersOrLeavesLtbMatch && !triggers.some((trigger) => trigger.triggerType === 'self_enters_or_leaves')) {
    const effectText = timingTriggerEffect(oracleText, selfEntersOrLeavesLtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'self_enters_or_leaves',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const entersOrLeavesMatch = oracleText.match(
    /whenever (?:a |an )?permanent enters or leaves(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (entersOrLeavesMatch && !triggers.some((trigger) => trigger.triggerType === 'enters_or_leaves')) {
    const effectText = timingTriggerEffect(oracleText, entersOrLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enters_or_leaves',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anyPermanentLeavesMatch = oracleText.match(
    /whenever a permanent leaves(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    anyPermanentLeavesMatch &&
    !lowerOracle.includes('permanent you control leaves') &&
    !lowerOracle.includes('another permanent leaves') &&
    !triggers.some((trigger) => trigger.triggerType === 'any_permanent_ltb')
  ) {
    const effectText = timingTriggerEffect(oracleText, anyPermanentLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'any_permanent_ltb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const phasesOutOrLeavesMatch = oracleText.match(
    /when this creature phases out or leaves the battlefield,?\s*([^.]+)/i,
  );
  if (phasesOutOrLeavesMatch && !triggers.some((trigger) => trigger.triggerType === 'phases_out_or_leaves')) {
    const effectText = timingTriggerEffect(oracleText, phasesOutOrLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'phases_out_or_leaves',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherCreatureYouControlLeavesMatch = oracleText.match(
    /when another creature you control leaves the battlefield,?\s*([^.]+)/i,
  );
  if (
    anotherCreatureYouControlLeavesMatch &&
    !triggers.some((trigger) => trigger.triggerType === 'another_creature_you_control_leaves')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherCreatureYouControlLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_creature_you_control_leaves',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const targetedCreatureLeavesThisTurnMatch = oracleText.match(
    /when the targeted creature leaves the battlefield this turn,?\s*([^.]+)/i,
  );
  if (
    targetedCreatureLeavesThisTurnMatch &&
    !triggers.some((trigger) => trigger.triggerType === 'targeted_creature_leaves_this_turn')
  ) {
    const effectText = timingTriggerEffect(oracleText, targetedCreatureLeavesThisTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'targeted_creature_leaves_this_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const headLeavesMatch = oracleText.match(/when a Head leaves the battlefield,?\s*([^.]+)/i);
  if (headLeavesMatch && !triggers.some((trigger) => trigger.triggerType === 'head_leaves_battlefield')) {
    const effectText = timingTriggerEffect(oracleText, headLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'head_leaves_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedUntappedOrLeavesMatch = oracleText.match(
    new RegExp(
      `when (?:${ltbAlternatives.join('|')}) becomes untapped or leaves the battlefield,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (namedUntappedOrLeavesMatch && !triggers.some((trigger) => trigger.triggerType === 'named_untapped_or_leaves')) {
    const effectText = timingTriggerEffect(oracleText, namedUntappedOrLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_untapped_or_leaves',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const commanderLeavesMatch = oracleText.match(/when your commander leaves the battlefield,?\s*([^.]+)/i);
  if (commanderLeavesMatch && !triggers.some((trigger) => trigger.triggerType === 'commander_leaves')) {
    const effectText = timingTriggerEffect(oracleText, commanderLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'commander_leaves',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const tokenLeavesMatch = oracleText.match(/whenever a token you control leaves the battlefield,?\s*([^.]+)/i);
  if (tokenLeavesMatch && !triggers.some((trigger) => trigger.triggerType === 'token_ltb')) {
    const effectText = timingTriggerEffect(oracleText, tokenLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'token_ltb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureTokenLeavesMatch = oracleText.match(
    /whenever a creature token(?: you control)? leaves the battlefield,?\s*([^.]+)/i,
  );
  if (creatureTokenLeavesMatch && !triggers.some((trigger) => trigger.triggerType === 'creature_token_ltb')) {
    const effectText = timingTriggerEffect(oracleText, creatureTokenLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_token_ltb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedOrAnotherCreatureLeavesPattern = new RegExp(
    `whenever\\s+(?:${ltbAlternatives.join('|')})\\s+or\\s+another\\s+(?:nontoken\\s+)?creature\\s+you\\s+control\\s+leaves(?: the battlefield)?,?\\s*([^.]+)`,
    'i',
  );
  const thatTokenLeavesMatch = oracleText.match(
    /when that token leaves the battlefield,?\s*([^.]+)/i,
  );
  if (
    thatTokenLeavesMatch &&
    !triggers.some((trigger) => trigger.triggerType === 'that_token_leaves')
  ) {
    const effectText = timingTriggerEffect(oracleText, thatTokenLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'that_token_leaves',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const mysteryPutOntoBattlefieldLeavesMatch = oracleText.match(
    new RegExp(
      `when the creature put onto the battlefield with (?:${ltbAlternatives.join('|')}) leaves the battlefield,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    mysteryPutOntoBattlefieldLeavesMatch &&
    !triggers.some((trigger) => trigger.triggerType === 'mystery_put_creature_leaves')
  ) {
    const effectText = timingTriggerEffect(oracleText, mysteryPutOntoBattlefieldLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'mystery_put_creature_leaves',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedOrAnotherCreatureLeavesMatch = oracleText.match(namedOrAnotherCreatureLeavesPattern);
  if (namedOrAnotherCreatureLeavesMatch && !triggers.some((trigger) => trigger.triggerType === 'named_or_another_creature_ltb')) {
    const effectText = timingTriggerEffect(oracleText, namedOrAnotherCreatureLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_another_creature_ltb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const modifiedCreatureLeavesMatch = oracleText.match(
    /whenever a modified creature you control leaves the battlefield,?\s*([^.]+)/i,
  );
  if (modifiedCreatureLeavesMatch && !triggers.some((trigger) => trigger.triggerType === 'modified_creature_ltb')) {
    const effectText = timingTriggerEffect(oracleText, modifiedCreatureLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'modified_creature_ltb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const controlledLeavesMatch = oracleText.match(
    /whenever (?:a|another) (?:nontoken )?permanent you control leaves(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (controlledLeavesMatch && !triggers.some((trigger) => trigger.triggerType === 'controlled_ltb')) {
    const effectText = timingTriggerEffect(oracleText, controlledLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'controlled_ltb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const counterCreatureLeavesMatch = oracleText.match(
    /whenever a creature you control with a \+1\/\+1 counter on it leaves the battlefield,?\s*([^.]+)/i,
  );
  if (counterCreatureLeavesMatch && !triggers.some((trigger) => trigger.triggerType === 'counter_creature_ltb')) {
    const effectText = timingTriggerEffect(oracleText, counterCreatureLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'counter_creature_ltb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const gainControlMatch = oracleText.match(/whenever you gain control of (?:a |an )?([^,]+),?\s*([^.]+)/i);
  if (gainControlMatch && !triggers.some((trigger) => trigger.triggerType === 'gain_control')) {
    const effectText = timingTriggerEffect(oracleText, gainControlMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'gain_control',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const loseControlGenericMatch = oracleText.match(/whenever you lose control of (?:a |an )?([^,]+),?\s*([^.]+)/i);
  if (loseControlGenericMatch && !triggers.some((trigger) => trigger.triggerType === 'lose_control_generic')) {
    const effectText = timingTriggerEffect(oracleText, loseControlGenericMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'lose_control_generic',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const loseControlThatMatch = oracleText.match(/when(?:ever)? you lose control of that ([^,]+),?\s*([^.]+)/i);
  if (loseControlThatMatch && !triggers.some((trigger) => trigger.triggerType === 'lose_control_that')) {
    const effectText = timingTriggerEffect(oracleText, loseControlThatMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'lose_control_that',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const loseControlMatch = oracleText.match(/when you lose control of this (artifact|enchantment|permanent),?\s*([^.]+)/i);
  if (loseControlMatch && !triggers.some((trigger) => trigger.triggerType === 'lose_control')) {
    const effectText = timingTriggerEffect(oracleText, loseControlMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'lose_control',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherPermanentLeavesMatch = oracleText.match(
    /whenever another (?:[\w]+\s+)?permanent leaves(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    anotherPermanentLeavesMatch &&
    !lowerOracle.includes('permanent you control leaves') &&
    !triggers.some((trigger) => trigger.triggerType === 'another_permanent_ltb')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherPermanentLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_permanent_ltb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureLeavesMatch = oracleText.match(
    /whenever (?:a|another) (?:nontoken )?creature (?:you control )?leaves(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    creatureLeavesMatch &&
    !lowerOracle.includes('permanent you control leaves') &&
    !triggers.some((trigger) => trigger.triggerType === 'creature_ltb')
  ) {
    const effectText = timingTriggerEffect(oracleText, creatureLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_ltb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const chosenCreatureLeavesMatch = oracleText.match(
    /when(?:ever)? (?:the chosen|that) creature leaves(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (chosenCreatureLeavesMatch && !triggers.some((trigger) => trigger.triggerType === 'chosen_creature_ltb')) {
    const effectText = timingTriggerEffect(oracleText, chosenCreatureLeavesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'chosen_creature_ltb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const attachmentLeavesPatterns = [
    /when(?:ever)? enchanted creature leaves(?: the battlefield)?,?\s*([^.]+)/i,
    /when(?:ever)? equipped creature leaves(?: the battlefield)?,?\s*([^.]+)/i,
    /when(?:ever)? enchanted permanent leaves(?: the battlefield)?,?\s*([^.]+)/i,
  ];
  for (const pattern of attachmentLeavesPatterns) {
    const match = oracleText.match(pattern);
    if (!match) continue;
    const effectText = timingTriggerEffect(oracleText, match);
    if (!effectText || triggers.some((trigger) => trigger.triggerType === 'attachment_ltb' && trigger.effect === effectText)) {
      continue;
    }
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'attachment_ltb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  return triggers;
}

export function detectAbilityActivatedTriggers(card: any, permanent?: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const oracleText = String(card?.oracle_text || '');
  const cardName = String(card?.name || 'Unknown');
  const permanentId = permanent?.id || '';

  // Planechase phenomena/planes: "Whenever you planeswalk here, ..."
  const planeswalkHereMatch = oracleText.match(
    /whenever you planeswalk here,?\s*([^.]+)/i,
  );
  if (planeswalkHereMatch && !triggers.some((t) => t.triggerType === 'planeswalk_here')) {
    const effectText = timingTriggerEffect(oracleText, planeswalkHereMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'planeswalk_here',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const exhaustNextMatch = oracleText.match(
    /when you next activate an exhaust ability(?: that isn't a mana ability)?(?: this turn)?,?\s*([^.]+)/i,
  );
  if (exhaustNextMatch) {
    const effectText = timingTriggerEffect(oracleText, exhaustNextMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'exhaust_ability_next',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedExploitMatch = oracleText.match(
    new RegExp(
      `when (?:${buildCardNameRegexAlternatives(cardName).join('|')}) exploits a creature,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (namedExploitMatch && !triggers.some((t) => t.triggerType === 'named_exploit')) {
    const effectText = timingTriggerEffect(oracleText, namedExploitMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_exploit',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const exploitMatch = oracleText.match(/when this creature exploits a creature,?\s*([^.]+)/i);
  if (exploitMatch) {
    const effectText = timingTriggerEffect(oracleText, exploitMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'exploit',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentArtifactAbilityMatch = oracleText.match(
    /whenever an opponent activates an ability of an artifact they control,?\s*([^.]+)/i,
  );
  if (
    opponentArtifactAbilityMatch &&
    !triggers.some((t) => t.triggerType === 'opponent_artifact_ability_activated')
  ) {
    const effectText = timingTriggerEffect(oracleText, opponentArtifactAbilityMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_artifact_ability_activated',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentAbilityMatch = oracleText.match(
    /whenever an opponent activates an ability(?: of [^.]+?)?(?:,?\s*(?:if )?(?:it|that) isn'?t a mana ability),?\s*([^.]+)/i,
  );
  if (opponentAbilityMatch && !triggers.some((t) => t.triggerType === 'opponent_artifact_ability_activated')) {
    const effectText = timingTriggerEffect(oracleText, opponentAbilityMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_ability_activated',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const winCoinFlipMatch = oracleText.match(/whenever you win a coin flip,?\s*([^.]+)/i);
  if (winCoinFlipMatch && !triggers.some((t) => t.triggerType === 'win_coin_flip')) {
    const effectText = timingTriggerEffect(oracleText, winCoinFlipMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'win_coin_flip',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const dieRollThresholdMatch = oracleText.match(/whenever you roll a (\d+) or higher on a die,?\s*([^.]+)/i);
  if (dieRollThresholdMatch && !triggers.some((t) => t.triggerType === 'die_roll_threshold')) {
    const effectText = timingTriggerEffect(oracleText, dieRollThresholdMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'die_roll_threshold',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const beginningOfGameMatch = oracleText.match(/at the beginning of the game,?\s*([^.]+)/i);
  if (beginningOfGameMatch && !triggers.some((t) => t.triggerType === 'beginning_of_game')) {
    const effectText = timingTriggerEffect(oracleText, beginningOfGameMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'beginning_of_game',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const planarDieMatch = oracleText.match(/whenever you roll the planar die,?\s*([^.]+)/i);
  if (planarDieMatch && !triggers.some((t) => t.triggerType === 'planar_die_roll')) {
    const effectText = timingTriggerEffect(oracleText, planarDieMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'planar_die_roll',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const exhaustActivatedMatch = oracleText.match(/whenever you activate an exhaust ability,?\s*([^.]+)/i);
  if (exhaustActivatedMatch && !triggers.some((t) => t.triggerType === 'exhaust_ability_activated')) {
    const effectText = timingTriggerEffect(oracleText, exhaustActivatedMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'exhaust_ability_activated',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const nonManaAbilityActivatedMatch = oracleText.match(
    /whenever you activate an ability that isn't a mana ability,?\s*([^.]+)/i,
  );
  if (nonManaAbilityActivatedMatch && !triggers.some((t) => t.triggerType === 'non_mana_ability_activated')) {
    const effectText = timingTriggerEffect(oracleText, nonManaAbilityActivatedMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'non_mana_ability_activated',
      description: effectText,
      effect: effectText,
      // Optional pay-again / copy templates are always may-abilities.
      mandatory: false,
    });
  }

  const namedEncounterMatch = oracleText.match(/when you encounter ([^,]+),?\s*([^.]+)/i);
  if (namedEncounterMatch && !triggers.some((t) => t.triggerType === 'named_encounter')) {
    const effectText = timingTriggerEffect(oracleText, namedEncounterMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_encounter',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const dieRollSingleResultMatch = oracleText.match(/whenever you roll a (\d+)(?! or \d),?\s*([^.]+)/i);
  if (
    dieRollSingleResultMatch &&
    !triggers.some((t) => t.triggerType === 'die_roll_single_result')
  ) {
    const effectText = timingTriggerEffect(oracleText, dieRollSingleResultMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'die_roll_single_result',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const sixSidedDieRollMatch = oracleText.match(
    /whenever a (\d+) is rolled on a six-sided die,?\s*([^.]+)/i,
  );
  if (sixSidedDieRollMatch && !triggers.some((t) => t.triggerType === 'six_sided_die_roll')) {
    const effectText = timingTriggerEffect(oracleText, sixSidedDieRollMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'six_sided_die_roll',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const noCreaturesOnBattlefieldMatch = oracleText.match(
    /when there are no creatures on the battlefield,?\s*([^.]+)/i,
  );
  if (
    noCreaturesOnBattlefieldMatch &&
    !triggers.some((t) => t.triggerType === 'no_creatures_on_battlefield')
  ) {
    const effectText = timingTriggerEffect(oracleText, noCreaturesOnBattlefieldMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'no_creatures_on_battlefield',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const dieRollResultMatch = oracleText.match(/whenever you roll a (\d+) or (\d+),?\s*([^.]+)/i);
  if (dieRollResultMatch) {
    const effectText = timingTriggerEffect(oracleText, dieRollResultMatch, 3);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'die_roll_result',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const foretellMatch = oracleText.match(/whenever you foretell a card,?\s*([^.]+)/i);
  if (foretellMatch) {
    const effectText = timingTriggerEffect(oracleText, foretellMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'foretell',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const boastMatch = oracleText.match(/whenever you activate a boast ability,?\s*([^.]+)/i);
  if (boastMatch) {
    const effectText = timingTriggerEffect(oracleText, boastMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'boast_activated',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const crankMatch = oracleText.match(/whenever you crank(?: this contraption)?,?\s*([^.]+)/i);
  if (crankMatch && !triggers.some((t) => t.triggerType === 'crank_contraption')) {
    const effectText = timingTriggerEffect(oracleText, crankMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'crank_contraption',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const crewedMatch = oracleText.match(/whenever this vehicle becomes crewed(?: for the first time each turn)?,?\s*([^.]+)/i);
  if (crewedMatch) {
    const effectText = timingTriggerEffect(oracleText, crewedMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'vehicle_crewed',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const saddledMatch = oracleText.match(/whenever this creature becomes saddled(?: for the first time each turn)?,?\s*([^.]+)/i);
  if (saddledMatch && !triggers.some((t) => t.triggerType === 'creature_saddled')) {
    const effectText = timingTriggerEffect(oracleText, saddledMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_saddled',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const dieRollMatch = oracleText.match(/whenever you roll a die,?\s*([^.]+)/i);
  if (dieRollMatch) {
    const effectText = timingTriggerEffect(oracleText, dieRollMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'die_roll',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const rollDiceMatch = oracleText.match(/whenever you roll one or more (?:dice|die),?\s*([^.]+)/i);
  if (rollDiceMatch && !triggers.some((t) => t.triggerType === 'roll_one_or_more_dice')) {
    const effectText = timingTriggerEffect(oracleText, rollDiceMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'roll_one_or_more_dice',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const exertCreatureMatch = oracleText.match(/whenever you exert a creature,?\s*([^.]+)/i);
  if (exertCreatureMatch && !triggers.some((t) => t.triggerType === 'exert_creature')) {
    const effectText = timingTriggerEffect(oracleText, exertCreatureMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'exert_creature',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const payCostMatch = oracleText.match(/when you pay this cost one or more times,?\s*([^.]+)/i);
  if (payCostMatch && !triggers.some((t) => t.triggerType === 'pay_cost_one_or_more_times')) {
    const effectText = timingTriggerEffect(oracleText, payCostMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'pay_cost_one_or_more_times',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const ringTemptsMatch = oracleText.match(/whenever the ring tempts you,?\s*([^.]+)/i);
  if (ringTemptsMatch && !triggers.some((t) => t.triggerType === 'ring_tempts_you')) {
    const effectText = timingTriggerEffect(oracleText, ringTemptsMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'ring_tempts_you',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const encounterPhenomenonMatch = oracleText.match(/when(?:ever) you encounter this phenomenon,?\s*([^.]+)/i);
  if (encounterPhenomenonMatch && !triggers.some((t) => t.triggerType === 'encounter_phenomenon')) {
    const effectText = timingTriggerEffect(oracleText, encounterPhenomenonMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'encounter_phenomenon',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const exploresMatch = oracleText.match(/whenever a creature you control explores,?\s*([^.]+)/i);
  if (exploresMatch && !triggers.some((t) => t.triggerType === 'creature_explores')) {
    const effectText = timingTriggerEffect(oracleText, exploresMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_explores',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const expendMatch = oracleText.match(/whenever you expend(?: \d+)?,?\s*([^.]+)/i);
  if (expendMatch && !triggers.some((t) => t.triggerType === 'expend')) {
    const effectText = timingTriggerEffect(oracleText, expendMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'expend',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const shuffleLibraryMatch = oracleText.match(
    /whenever a spell or ability causes (?:its controller|you|a player) to shuffle (?:their|your) library,?\s*([^.]+)/i,
  );
  if (shuffleLibraryMatch) {
    const effectText = timingTriggerEffect(oracleText, shuffleLibraryMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'library_shuffled',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const rateArtMatch = oracleText.match(/when they rate the art,?\s*([^.]+)/i);
  if (rateArtMatch) {
    const effectText = timingTriggerEffect(oracleText, rateArtMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'rate_art',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const dayNightMatch = oracleText.match(/whenever day becomes night or night becomes day,?\s*([^.]+)/i);
  if (dayNightMatch && !triggers.some((t) => t.triggerType === 'day_night')) {
    const effectText = timingTriggerEffect(oracleText, dayNightMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'day_night',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const chaosEnsuesMatch = oracleText.match(/whenever chaos ensues,?\s*([^.]+)/i);
  if (chaosEnsuesMatch && !triggers.some((t) => t.triggerType === 'chaos_ensues')) {
    const effectText = timingTriggerEffect(oracleText, chaosEnsuesMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'chaos_ensues',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const equippedAbilityActivatedMatch = oracleText.match(
    /whenever an ability of equipped creature is activated,?\s*(?:if it isn't a mana ability,?\s*)?([^.]+)/i,
  );
  if (equippedAbilityActivatedMatch && !triggers.some((t) => t.triggerType === 'equipped_ability_activated')) {
    const effectText = timingTriggerEffect(oracleText, equippedAbilityActivatedMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'equipped_ability_activated',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const becomeMonarchMatch = oracleText.match(/whenever you become the monarch,?\s*([^.]+)/i);
  if (becomeMonarchMatch && !triggers.some((t) => t.triggerType === 'become_monarch')) {
    const effectText = timingTriggerEffect(oracleText, becomeMonarchMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'become_monarch',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const emptyHandMatch = oracleText.match(/whenever you have no cards in hand,?\s*([^.]+)/i);
  if (emptyHandMatch && !triggers.some((t) => t.triggerType === 'empty_hand')) {
    const effectText = timingTriggerEffect(oracleText, emptyHandMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'empty_hand',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const schemeInMotionMatch = oracleText.match(/when you set this scheme in motion,?\s*([^.]+)/i);
  if (schemeInMotionMatch && !triggers.some((t) => t.triggerType === 'scheme_in_motion')) {
    const effectText = timingTriggerEffect(oracleText, schemeInMotionMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'scheme_in_motion',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const youPayManaMatch = oracleText.match(/whenever you pay (\{[^}]+\}(?:\{[^}]+\})*),?\s*([^.]+)/i);
  if (youPayManaMatch && !triggers.some((t) => t.triggerType === 'you_pay_mana')) {
    const effectText = timingTriggerEffect(oracleText, youPayManaMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'you_pay_mana',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const saddleOrCrewMatch = oracleText.match(
    /whenever (?:~|this creature) saddles a mount or crews a vehicle during your main phase,?\s*([^.]+)/i,
  );
  if (saddleOrCrewMatch && !triggers.some((t) => t.triggerType === 'saddle_or_crew')) {
    const effectText = timingTriggerEffect(oracleText, saddleOrCrewMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'saddle_or_crew',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const crewVehicleMatch = oracleText.match(/when(?:ever)? (?:~|this creature) crews a vehicle,?\s*([^.]+)/i);
  if (crewVehicleMatch && !triggers.some((t) => t.triggerType === 'crew_vehicle')) {
    const effectText = timingTriggerEffect(oracleText, crewVehicleMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'crew_vehicle',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const finishVotingMatch = oracleText.match(/whenever players finish voting,?\s*([^.]+)/i);
  if (finishVotingMatch && !triggers.some((t) => t.triggerType === 'finish_voting')) {
    const effectText = timingTriggerEffect(oracleText, finishVotingMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'finish_voting',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const loyaltyAbilityPatterns = [
    /whenever you activate a loyalty ability of (?:a |an )?([\w]+) planeswalker,?\s*([^.]+)/gi,
    /whenever you activate a loyalty ability of enchanted planeswalker,?\s*([^.]+)/gi,
  ];
  for (const pattern of loyaltyAbilityPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effectText = String(match[match.length - 1] || '').trim();
      if (!effectText || triggers.some((t) => t.triggerType === 'loyalty_ability_activated' && t.effect === effectText)) {
        continue;
      }
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'loyalty_ability_activated',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const clashMatch = oracleText.match(/whenever you clash,?\s*([^.]+)/i);
  if (clashMatch && !triggers.some((t) => t.triggerType === 'clash')) {
    const effectText = timingTriggerEffect(oracleText, clashMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'clash',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const discoverMatch = oracleText.match(/whenever you discover,?\s*([^.]+)/i);
  if (discoverMatch && !triggers.some((t) => t.triggerType === 'discover')) {
    const effectText = timingTriggerEffect(oracleText, discoverMatch)
      .replace(/\s*This ability triggers only once each turn\.?/gi, '')
      .trim();
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'discover',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      oncePerTurn: /this ability triggers only once each turn/i.test(oracleText),
    });
  }

  const equipmentUnattachedMatch = oracleText.match(
    /whenever this equipment becomes unattached from a permanent,?\s*([^.]+)/i,
  );
  if (equipmentUnattachedMatch && !triggers.some((t) => t.triggerType === 'equipment_unattached')) {
    const effectText = timingTriggerEffect(oracleText, equipmentUnattachedMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'equipment_unattached',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const keywordActionPatterns: Array<{ pattern: RegExp; triggerType: string }> = [
    { pattern: /whenever you surveil,?\s*([^.]+)/gi, triggerType: 'surveil' },
    { pattern: /whenever you scry(?: \d+)?,?\s*([^.]+)/gi, triggerType: 'scry' },
    { pattern: /whenever you explore,?\s*([^.]+)/gi, triggerType: 'explore' },
    { pattern: /whenever you connive,?\s*([^.]+)/gi, triggerType: 'connive' },
    { pattern: /when(?:ever)? you proliferate,?\s*([^.]+)/gi, triggerType: 'proliferate' },
    { pattern: /when(?:ever)? you complete a dungeon,?\s*([^.]+)/gi, triggerType: 'complete_dungeon' },
    { pattern: /when(?:ever)? a player loses the game,?\s*([^.]+)/gi, triggerType: 'player_loses_game' },
    { pattern: /whenever you search your library,?\s*([^.]+)/gi, triggerType: 'search_library' },
    { pattern: /whenever an opponent searches their library,?\s*([^.]+)/gi, triggerType: 'opponent_search_library' },
    { pattern: /whenever an opponent shuffles their library,?\s*([^.]+)/gi, triggerType: 'opponent_shuffle_library' },
    { pattern: /whenever you shuffle your library,?\s*([^.]+)/gi, triggerType: 'shuffle_library' },
  ];
  for (const { pattern, triggerType } of keywordActionPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effectText = timingTriggerEffect(oracleText, match);
      if (!effectText || triggers.some((t) => t.triggerType === triggerType && t.effect === effectText)) continue;
      triggers.push({
        permanentId,
        cardName,
        triggerType,
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  return triggers;
}

export function detectMonstrousTriggers(card: any, permanent?: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const oracleText = String(card?.oracle_text || '');
  const cardName = String(card?.name || 'Unknown');
  const permanentId = permanent?.id || '';

  const monstrousNameVariants = buildCardNameRegexAlternatives(cardName);
  const monstrousMatch = oracleText.match(
    new RegExp(`when(?:ever)? (?:~|this creature|(?:${monstrousNameVariants.join('|')})) ${ENTERS_OR_OTHER_EVENT_PREFIX}becomes monstrous,?\\s*([^.]+)`, 'i'),
  );
  if (monstrousMatch && !triggers.some((t) => t.triggerType === 'became_monstrous')) {
    const effectText = timingTriggerEffect(oracleText, monstrousMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'became_monstrous',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  return triggers;
}

export function detectRoomTriggers(card: any, permanent?: any) {
  return detectRoomUnlockDoorTriggers(card, permanent);
}

export function detectTransformTriggers(card: any, permanent?: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const oracleText = String(card?.oracle_text || '');
  const cardName = String(card?.name || 'Unknown');
  const permanentId = permanent?.id || '';

  const transformNameVariants = buildCardNameRegexAlternatives(cardName);
  const transformPatterns = [
    /when (?:~|this creature|this card) specializes(?: from (?:your graveyard|any zone|the battlefield|exile))?[^,]*,?\s*([^.]+)/i,
    /whenever (?:~|this creature|this card) specializes(?: from (?:your graveyard|any zone|the battlefield|exile))?[^,]*,?\s*([^.]+)/i,
    /when(?:ever)? equipped creature transforms,?\s*([^.]+)/i,
    /when(?:ever)? enchanted creature transforms,?\s*([^.]+)/i,
    /when(?:ever)? this creature transforms into this permanent,?\s*([^.]+)/i,
    /when this creature has flying,?\s*flip it/i,
    new RegExp(`when this creature transforms into (?:${transformNameVariants.join('|')}),?\\s*([^.]+)`, 'i'),
    /when this creature transforms into [^,]+,?\s*([^.]+)/i,
    new RegExp(`when you have \\d+ or more life,?\\s*flip (?:${transformNameVariants.join('|')})`, 'i'),
    /when you have (\d+) or less life,?\s*(?:if [^,]+,\s*)?([^.]+)/i,
  ];
  for (const pattern of transformPatterns) {
    const match = oracleText.match(pattern);
    if (!match) continue;
    const effectText = String(match[match.length - 1] || match[0] || '').trim();
    if (!effectText || triggers.some((trigger) => trigger.effect === effectText)) continue;
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'transform',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  return triggers;
}

/**
 * Detect attack triggers from a permanent's abilities
 */
export function detectAttackTriggers(card: any, permanent: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const oracleText = stripReminderParentheticals(String(card?.oracle_text || ""));
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";

  const optionalManaPaymentPattern = /you may pay (\{[^}]+\}(?:\{[^}]+\})*)\.\s*if you do,?\s*(.+)/i;

  const attackKeywordReminderLinePattern = /^(?:annihilator\s+\d+|melee|myriad|exalted|battle cry|dethrone|mentor|training)\b/i;

  const attackNameVariants = buildCardNameRegexAlternatives(cardName);
  const attackSubjectPattern = `(?:~|this creature|this vehicle|this artifact|this land|this permanent|(?:${attackNameVariants.join('|')})|equipped creature|enchanted creature)`;

  const findGenericAttackTriggerLine = (): RegExpMatchArray | null =>
    findFirstRegexMatchAcrossOracleLines(
      oracleText,
      (line) => attackKeywordReminderLinePattern.test(line),
      [
        new RegExp(`whenever\\s+${attackSubjectPattern}\\s+attacks?,?\\s*(.+)$`, 'i'),
        new RegExp(`when\\s+${attackSubjectPattern}\\s+attacks?,?\\s*(.+)$`, 'i'),
        /whenever\s+equipped\s+creature\s+attacks,?\s*(.+)$/i,
        /whenever\s+enchanted\s+creature\s+attacks,?\s*(.+)$/i,
        /whenever\s+this\s+land\s+attacks,?\s*(.+)$/i,
      ],
    );
  
  // Check known cards
  for (const [knownName, info] of Object.entries(KNOWN_ATTACK_TRIGGERS)) {
    if (lowerName.includes(knownName)) {
      const trigger: TriggeredAbility = {
        permanentId,
        cardName,
        controllerId,
        triggerType: 'attacks',
        description: info.effect,
        effect: info.effect,
        value: info.value,
        mandatory: true,
      };

      // Some known-card entries encode optional mana payments (e.g. Casal):
      // "You may pay {1}{G}. If you do, transform her."
      // Treat these as optional prompts rather than mandatory auto-effects.
      const maybeOptionalPayment = String(info.effect || '').match(optionalManaPaymentPattern);
      if (maybeOptionalPayment) {
        (trigger as any).manaCost = maybeOptionalPayment[1];
        trigger.effect = String(maybeOptionalPayment[2] || '').trim();
        trigger.mandatory = false;
      }
      
      // Add create tokens based on count data (for Myrel, Shield of Argive, etc.)
      if (info.createTokensBasedOnCount) {
        trigger.createTokensBasedOnCount = info.createTokensBasedOnCount;
      }
      
      // Add put from hand data (for Preeminent Captain, etc.)
      if (info.putFromHand) {
        trigger.putFromHand = info.putFromHand;
        trigger.tappedAndAttacking = info.tappedAndAttacking;
        trigger.putCreatureType = info.putCreatureType;
      }
      
      // Add create tokens data (for fixed count token creation)
      if (info.createTokens) {
        trigger.createTokens = info.createTokens;
      }
      
      triggers.push(trigger);
    }
  }
  
  // Annihilator N
  const annihilatorMatch = oracleText.match(/annihilator\s+(\d+)/i);
  if (annihilatorMatch) {
    const n = parseInt(annihilatorMatch[1], 10);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'annihilator',
      description: `Defending player sacrifices ${n} permanent${n > 1 ? 's' : ''}`,
      value: n,
      mandatory: true,
      requiresTarget: false,
    });
  }
  
  // Melee
  if (lowerOracle.includes("melee")) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'melee',
      description: "+1/+1 for each opponent you attacked this combat",
      mandatory: true,
    });
  }
  
  // Myriad
  if (lowerOracle.includes("myriad")) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'myriad',
      description: "Create token copies attacking each other opponent",
      mandatory: true,
    });
  }
  
  // Exalted (triggers when a creature attacks alone)
  if (lowerOracle.includes("exalted")) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'exalted',
      description: "+1/+1 to attacking creature (when attacking alone)",
      mandatory: true,
    });
  }

  // Dethrone
  if (lowerOracle.includes("dethrone")) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'dethrone',
      description: 'Put a +1/+1 counter on this creature if attacking the player with the most life',
      mandatory: true,
    });
  }

  // Battle Cry
  if (lowerOracle.includes("battle cry")) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'battle_cry',
      description: 'Each other attacking creature gets +1/+0 until end of turn',
      mandatory: true,
    });
  }

  // Mentor
  if (lowerOracle.includes("mentor")) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'mentor',
      description: 'Put a +1/+1 counter on target attacking creature with lesser power',
      mandatory: true,
    });
  }

  // Training
  if (hasTrainingKeyword(card)) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'training',
      description: 'Put a +1/+1 counter on this creature if attacking with another creature with greater power',
      mandatory: true,
    });
  }

  const attacksWithGreaterPowerMatch = oracleText.match(
    /whenever this creature attacks with another creature with greater power,?\s*([^.]+)/i,
  );
  if (
    attacksWithGreaterPowerMatch &&
    !triggers.some((trigger) => trigger.triggerType === 'attacks_with_greater_power_creature')
  ) {
    const effectText = timingTriggerEffect(oracleText, attacksWithGreaterPowerMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'attacks_with_greater_power_creature',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }
  
  const battalionSubject = `(?:~|this(?: creature)?|${escapeCardNameForRegex(cardName)})`;
  const battalionPattern = new RegExp(
    `whenever\\s+${battalionSubject}\\s+(?:and at least two other creatures attack|attacks and at least two other creatures attack),?\\s*([^.]+)`,
    'i',
  );
  const battalionMatch = oracleText.match(battalionPattern);
  if (battalionMatch && !triggers.some((trigger) => trigger.triggerType === 'battalion')) {
    const effectText = timingTriggerEffect(oracleText, battalionMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'battalion',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  // Generic "whenever ~ attacks"
  const attacksMatch = findGenericAttackTriggerLine();
  if (attacksMatch && !triggers.some(t => t.triggerType === 'attacks' || t.triggerType === 'battalion')) {
    const effectText = timingTriggerEffect(oracleText, attacksMatch);
    
    // Check if this is an optional mana payment trigger (e.g., Casal)
    // Pattern: "you may pay {X}. If you do, ..."
    const mayPayMatch = effectText.match(optionalManaPaymentPattern);
    
    if (mayPayMatch) {
      // Optional mana payment trigger
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'attacks',
        description: effectText,
        effect: timingTriggerEffect(oracleText, mayPayMatch, 2), // The effect after "If you do,"
        manaCost: mayPayMatch[1], // The mana cost to pay
        mandatory: false, // Optional because of "may"
      });
    } else {
      // Regular mandatory attack trigger
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'attacks',
        description: effectText,
        effect: effectText,
        mandatory: true,
      });
    }
  }
  
  const attackPayWhenYouDoMatch = oracleText.match(
    /whenever you attack,?\s*you may pay (\{[^}]+\}(?:\{[^}]+\})*)\.\s*when you do,?\s*([^.]+)/i,
  );
  if (attackPayWhenYouDoMatch && !triggers.some((t) => t.triggerType === 'when_you_do')) {
    const effectText = timingTriggerEffect(oracleText, attackPayWhenYouDoMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'when_you_do',
      description: effectText,
      effect: effectText,
      manaCost: String(attackPayWhenYouDoMatch[1] || '').trim(),
      mandatory: false,
    });
  }

  const exertWhenYouDoMatch = oracleText.match(
    /you may exert this creature as it attacks\.\s*when you do,?\s*([^.]+)/i,
  );
  if (exertWhenYouDoMatch && !triggers.some((t) => t.triggerType === 'when_you_do' || t.triggerType === 'exert')) {
    const effectText = timingTriggerEffect(oracleText, exertWhenYouDoMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'exert',
      description: effectText,
      effect: effectText,
      mandatory: false,
    });
  }

  const whenYouDoPattern = /when you do,?\s*([^.]+)/gi;
  let whenYouDoMatch: RegExpExecArray | null;
  while ((whenYouDoMatch = whenYouDoPattern.exec(oracleText)) !== null) {
    const effectText = timingTriggerEffect(oracleText, whenYouDoMatch);
    if (!effectText) continue;
    if (triggers.some((t) => String(t.effect || '').trim().toLowerCase() === effectText.toLowerCase())) continue;
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'when_you_do',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const whenTheyDoPattern = /when they do,?\s*([^.]+)/gi;
  let whenTheyDoMatch: RegExpExecArray | null;
  while ((whenTheyDoMatch = whenTheyDoPattern.exec(oracleText)) !== null) {
    const effectText = timingTriggerEffect(oracleText, whenTheyDoMatch);
    if (!effectText) continue;
    if (triggers.some((t) => String(t.effect || '').trim().toLowerCase() === effectText.toLowerCase())) continue;
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'when_they_do',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const commanderAttacksMatch = oracleText.match(
    /whenever your commander (?:enters(?: the battlefield)?\s+or\s+)?attacks,?\s*([^.]+)/i,
  );
  if (commanderAttacksMatch && !triggers.some((t) => t.triggerType === 'commander_attacks')) {
    const effectText = timingTriggerEffect(oracleText, commanderAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'commander_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const bossesAttackMatch = oracleText.match(/whenever the bosses attack,?\s*([^.]+)/i);
  if (bossesAttackMatch && !triggers.some((t) => t.triggerType === 'bosses_attack')) {
    const effectText = timingTriggerEffect(oracleText, bossesAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'bosses_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const ringBearerAttacksMatch = oracleText.match(/whenever your ring-bearer attacks,?\s*([^.]+)/i);
  if (ringBearerAttacksMatch && !triggers.some((t) => t.triggerType === 'ring_bearer_attacks')) {
    const effectText = timingTriggerEffect(oracleText, ringBearerAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'ring_bearer_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const youAttackMatch = oracleText.match(/whenever you attack,?\s*([^.]+)/i);
  if (youAttackMatch && !triggers.some((t) => t.triggerType === 'you_attack')) {
    const effectText = timingTriggerEffect(oracleText, youAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'you_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const selfEntersOrAttacksPattern = new RegExp(
    `whenever\\s+(?:~|this creature|this vehicle|(?:${attackNameVariants.join('|')}))\\s+enters(?: the battlefield)?\\s+or\\s+attacks,?\\s*([^.]+)`,
    'i',
  );

  const vehicleAttacksOrBlocksMatch = oracleText.match(/whenever this vehicle attacks or blocks,?\s*([^.]+)/i);
  if (vehicleAttacksOrBlocksMatch && !triggers.some((t) => t.triggerType === 'attacks_or_blocks')) {
    const effectText = timingTriggerEffect(oracleText, vehicleAttacksOrBlocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'attacks_or_blocks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const attacksOrDiesAttackMatch = oracleText.match(
    new RegExp(`whenever\\s+(?:~|this creature|this vehicle|(?:${attackNameVariants.join('|')}))\\s+attacks\\s+or\\s+dies,?\\s*([^.]+)`, 'i'),
  );
  if (attacksOrDiesAttackMatch && !triggers.some((t) => t.triggerType === 'attacks_or_dies')) {
    const effectText = timingTriggerEffect(oracleText, attacksOrDiesAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'attacks_or_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreModifiedCreaturesAttackMatch = oracleText.match(
    /whenever one or more modified creatures you control attack,?\s*([^.]+)/i,
  );
  if (
    oneOrMoreModifiedCreaturesAttackMatch &&
    !triggers.some((t) => t.triggerType === 'one_or_more_modified_creatures_attack')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreModifiedCreaturesAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'one_or_more_modified_creatures_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const trampleCreatureAttacksMatch = oracleText.match(
    /whenever a creature you control with trample attacks,?\s*([^.]+)/i,
  );
  if (trampleCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'trample_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, trampleCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'trample_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const attackInBandMatch = oracleText.match(
    /whenever two or more creatures you control attack in a band,?\s*([^.]+)/i,
  );
  if (attackInBandMatch && !triggers.some((t) => t.triggerType === 'attack_in_band')) {
    const effectText = timingTriggerEffect(oracleText, attackInBandMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'attack_in_band',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const youAttackWithExactlyTwoCreaturesMatch = oracleText.match(
    /when you attack with exactly two creatures,?\s*([^.]+)/i,
  );
  if (
    youAttackWithExactlyTwoCreaturesMatch &&
    !triggers.some((t) => t.triggerType === 'you_attack_with_exactly_two_creatures')
  ) {
    const effectText = timingTriggerEffect(oracleText, youAttackWithExactlyTwoCreaturesMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'you_attack_with_exactly_two_creatures',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const teamExactlyTwoCreaturesAttackMatch = oracleText.match(
    /whenever your team attacks with exactly two creatures,?\s*([^.]+)/i,
  );
  if (
    teamExactlyTwoCreaturesAttackMatch &&
    !triggers.some((t) => t.triggerType === 'team_exactly_two_creatures_attack')
  ) {
    const effectText = timingTriggerEffect(oracleText, teamExactlyTwoCreaturesAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'team_exactly_two_creatures_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const vehicleCrewedByNameAttacksMatch = oracleText.match(
    new RegExp(
      `whenever a vehicle crewed by (?:${attackNameVariants.join('|')}) this turn attacks,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    vehicleCrewedByNameAttacksMatch &&
    !triggers.some((t) => t.triggerType === 'vehicle_crewed_by_name_attacks')
  ) {
    const effectText = timingTriggerEffect(oracleText, vehicleCrewedByNameAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'vehicle_crewed_by_name_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneLandAttacksAnotherMatch = oracleText.match(/when one land attacks another,?\s*([^.]+)/i);
  if (oneLandAttacksAnotherMatch && !triggers.some((t) => t.triggerType === 'one_land_attacks_another')) {
    const effectText = timingTriggerEffect(oracleText, oneLandAttacksAnotherMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'one_land_attacks_another',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const revelerAttacksMatch = oracleText.match(/whenever a Reveler attacks,?\s*([^.]+)/i);
  if (revelerAttacksMatch && !triggers.some((t) => t.triggerType === 'reveler_attacks')) {
    const effectText = timingTriggerEffect(oracleText, revelerAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'reveler_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const allNonWallAttackMatch = oracleText.match(
    /whenever all non-Wall creatures you control attack,?\s*([^.]+)/i,
  );
  if (allNonWallAttackMatch && !triggers.some((t) => t.triggerType === 'all_non_wall_creatures_attack')) {
    const effectText = timingTriggerEffect(oracleText, allNonWallAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'all_non_wall_creatures_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisAndTypedAttackMatch = oracleText.match(
    /whenever this creature and at least one other ([\w]+) attack,?\s*([^.]+)/i,
  );
  if (thisAndTypedAttackMatch && !triggers.some((t) => t.triggerType === 'this_and_typed_creature_attack')) {
    const effectText = timingTriggerEffect(oracleText, thisAndTypedAttackMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'this_and_typed_creature_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const nontokenCreatureAttacksMatch = oracleText.match(
    /whenever a nontoken creature(?: you control)? attacks,?\s*([^.]+)/i,
  );
  if (
    nontokenCreatureAttacksMatch &&
    !triggers.some((t) => t.triggerType === 'nontoken_creature_attacks')
  ) {
    const effectText = timingTriggerEffect(oracleText, nontokenCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'nontoken_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const itAttacksMatch = oracleText.match(/whenever it attacks,?\s*([^.]+)/i);
  if (itAttacksMatch && !triggers.some((t) => t.triggerType === 'it_attacks')) {
    const effectText = timingTriggerEffect(oracleText, itAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'it_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentsTwoOrMoreAttackMatch = oracleText.match(
    /whenever two or more creatures your opponents control attack,?\s*([^.]+)/i,
  );
  if (
    opponentsTwoOrMoreAttackMatch &&
    !triggers.some((t) => t.triggerType === 'opponents_two_or_more_creatures_attack')
  ) {
    const effectText = timingTriggerEffect(oracleText, opponentsTwoOrMoreAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'opponents_two_or_more_creatures_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherTypedCreatureAttacksMatch = oracleText.match(
    /whenever another ([\w]+) you control attacks,?\s*([^.]+)/i,
  );
  if (
    anotherTypedCreatureAttacksMatch &&
    !triggers.some((t) => t.triggerType === 'another_typed_creature_attacks')
  ) {
    const typedSubject = String(anotherTypedCreatureAttacksMatch[1] || '').trim().toLowerCase();
    if (!['creature', 'vehicle', 'permanent'].includes(typedSubject)) {
      const effectText = timingTriggerEffect(oracleText, anotherTypedCreatureAttacksMatch, 2);
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'another_typed_creature_attacks',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const modifiedCreatureAttacksMatch = oracleText.match(/whenever a modified creature you control attacks,?\s*([^.]+)/i);
  if (modifiedCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'modified_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, modifiedCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'modified_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  // Soulblade Corrupter: "Whenever a creature with a +1/+1 counter on it attacks one of your opponents"
  // Also covers "a creature you control with a +1/+1 counter on it attacks"
  const counterCreatureAttacksMatch = oracleText.match(
    /whenever a creature(?: you control)? with a \+1\/\+1 counter on it attacks(?:\s+(?:one of your opponents|an opponent|a player))?,?\s*([^.]+)/i,
  );
  if (counterCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'counter_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, counterCreatureAttacksMatch);
    const matchText = String(counterCreatureAttacksMatch[0] || '');
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'counter_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: /\ba creature you control\b/i.test(matchText),
      requiresOpponentDefender: /\battacks(?:\s+one of your opponents|\s+an opponent)/i.test(matchText),
    } as any);
  }

  const lowPowerCreatureAttacksMatch = oracleText.match(
    /whenever a creature you control with power \d+ or less attacks,?\s*([^.]+)/i,
  );
  if (lowPowerCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'low_power_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, lowPowerCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'low_power_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedAttacksAloneMatch = oracleText.match(
    /whenever a ([\w]+(?: or [\w]+)*) you control attacks alone,?\s*([^.]+)/i,
  );
  if (typedAttacksAloneMatch && !triggers.some((t) => t.triggerType === 'typed_attacks_alone')) {
    const effectText = timingTriggerEffect(oracleText, typedAttacksAloneMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'typed_attacks_alone',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureAttacksAloneMatch = oracleText.match(
    /whenever a creature you control attacks alone,?\s*([^.]+)/i,
  );
  if (creatureAttacksAloneMatch && !triggers.some((t) => t.triggerType === 'creature_attacks_alone')) {
    const effectText = timingTriggerEffect(oracleText, creatureAttacksAloneMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'creature_attacks_alone',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedPlayerAttackedMatch = oracleText.match(
    /whenever enchanted player is attacked,?\s*([^.]+)/i,
  );
  if (enchantedPlayerAttackedMatch && !triggers.some((t) => t.triggerType === 'enchanted_player_attacked')) {
    const effectText = timingTriggerEffect(oracleText, enchantedPlayerAttackedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'enchanted_player_attacked',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const curseAttackMatch = oracleText.match(
    /whenever a player attacks enchanted player with one or more creatures,?\s*([^.]+)/i,
  );
  if (curseAttackMatch && !triggers.some((t) => t.triggerType === 'curse_attack')) {
    const effectText = timingTriggerEffect(oracleText, curseAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'curse_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }
  const selfEntersOrAttacksMatch = oracleText.match(selfEntersOrAttacksPattern);
  if (selfEntersOrAttacksMatch && !triggers.some((t) => t.triggerType === 'self_enters_or_attacks')) {
    const effectText = timingTriggerEffect(oracleText, selfEntersOrAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'self_enters_or_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentCreatureAttacksMatch = oracleText.match(/whenever a creature an opponent controls attacks,?\s*([^.]+)/i);
  if (opponentCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'opponent_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, opponentCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'opponent_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const attacksOrBlocksMatch = oracleText.match(
    new RegExp(`when(?:ever)? (?:~|this creature|(?:${attackNameVariants.join('|')})) attacks or blocks,?\\s*([^.]+)`, 'i'),
  );
  if (attacksOrBlocksMatch && !triggers.some((t) => t.triggerType === 'attacks_or_blocks')) {
    const effectText = timingTriggerEffect(oracleText, attacksOrBlocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'attacks_or_blocks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anyCreatureAttacksOrBlocksMatch = oracleText.match(/whenever a creature attacks or blocks,?\s*([^.]+)/i);
  if (anyCreatureAttacksOrBlocksMatch && !triggers.some((t) => t.triggerType === 'any_creature_attacks_or_blocks')) {
    const effectText = timingTriggerEffect(oracleText, anyCreatureAttacksOrBlocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'any_creature_attacks_or_blocks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anyCreatureAttacksMatch = oracleText.match(/whenever a creature attacks(?! this turn)(?! or blocks),?\s*([^.]+)/i);
  if (
    anyCreatureAttacksMatch &&
    !triggers.some((t) => t.triggerType === 'any_creature_attacks' || t.triggerType === 'creature_attacks' || t.triggerType === 'creature_attacks_this_turn')
  ) {
    const effectText = timingTriggerEffect(oracleText, anyCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'any_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureAttacksThisTurnMatch = oracleText.match(/whenever a creature attacks this turn,?\s*([^.]+)/i);
  if (creatureAttacksThisTurnMatch && !triggers.some((t) => t.triggerType === 'creature_attacks_this_turn')) {
    const effectText = timingTriggerEffect(oracleText, creatureAttacksThisTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'creature_attacks_this_turn',
      description: effectText,
      effect: effectText,
      mandatory: true,
    });
  }

  const anotherCreatureAttacksMatch = oracleText.match(/whenever another creature you control attacks,?\s*([^.]+)/i);
  if (anotherCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'another_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, anotherCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const equippedCreatureAttacksMatch = oracleText.match(
    /whenever an equipped creature you control attacks,?\s*([^.]+)/i,
  );
  if (equippedCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'equipped_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, equippedCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'equipped_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedSubtypeAttacksMatch = oracleText.match(
    /whenever an? ([\w]+(?: or [\w]+)*) you control attacks,?\s*([^.]+)/i,
  );
  const typedSubtypeExcluded = new Set([
    'creature',
    'nontoken',
    'modified',
    'permanent',
    'vehicle',
    'land',
    'player',
    'spell',
    'token',
  ]);
  if (
    typedSubtypeAttacksMatch &&
    !typedSubtypeExcluded.has(String(typedSubtypeAttacksMatch[1] || '').trim().toLowerCase()) &&
    !/\bcreature\b/i.test(String(typedSubtypeAttacksMatch[1] || '')) &&
    !triggers.some((t) => t.triggerType === 'typed_subtype_attacks')
  ) {
    const effectText = timingTriggerEffect(oracleText, typedSubtypeAttacksMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'typed_subtype_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedCreatureAttacksMatch = oracleText.match(
    /whenever an? (?:[\w]+\s+)+creature you control attacks,?\s*([^.]+)/i,
  );
  if (
    typedCreatureAttacksMatch &&
    !lowerOracle.includes('a creature you control attacks') &&
    !lowerOracle.includes('nontoken creature you control attacks') &&
    !lowerOracle.includes('another creature you control attacks') &&
    !lowerOracle.includes('equipped creature you control attacks') &&
    !lowerOracle.includes('modified creature you control attacks') &&
    !triggers.some((t) => t.triggerType === 'typed_creature_attacks')
  ) {
    const effectText = timingTriggerEffect(oracleText, typedCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'typed_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const deathtouchCreatureAttacksMatch = oracleText.match(
    /whenever a creature you control with deathtouch attacks,?\s*([^.]+)/i,
  );
  if (deathtouchCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'deathtouch_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, deathtouchCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'deathtouch_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const chosenNameCreatureAttacksMatch = oracleText.match(
    /whenever a creature you control with the chosen name attacks,?\s*([^.]+)/i,
  );
  if (chosenNameCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'chosen_name_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, chosenNameCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'chosen_name_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedAndOtherCreatureAttackMatch = oracleText.match(
    new RegExp(
      `whenever (?:${attackNameVariants.join('|')}) and at least (?:one|two|three|\\d+) other (?:creature|warrior)s? attack,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedAndOtherCreatureAttackMatch &&
    !triggers.some((t) => t.triggerType === 'named_and_other_creature_attack')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedAndOtherCreatureAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'named_and_other_creature_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedEnterOrAttackMatch = oracleText.match(
    new RegExp(`whenever (?:${attackNameVariants.join('|')}) enter or attack,?\\s*([^.]+)`, 'i'),
  );
  if (namedEnterOrAttackMatch && !triggers.some((t) => t.triggerType === 'named_enter_or_attack')) {
    const effectText = timingTriggerEffect(oracleText, namedEnterOrAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'named_enter_or_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  // "Whenever/When a creature you control attacks"
  const creatureAttacksMatch = oracleText.match(/when(?:ever)? a creature you control attacks,?\s*([^.]+)/i);
  if (creatureAttacksMatch) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_attacks',
      description: timingTriggerEffect(oracleText, creatureAttacksMatch),
      effect: timingTriggerEffect(oracleText, creatureAttacksMatch),
      mandatory: true,
    });
  }

  const chosenTypeAttackMatch = oracleText.match(
    /whenever a creature you control of the chosen type enters or attacks,?\s*([^.]+)/i
  );
  if (chosenTypeAttackMatch && !triggers.some((t) => t.triggerType === 'chosen_type_creature_etb_or_attack')) {
    const effectText = timingTriggerEffect(oracleText, chosenTypeAttackMatch);
    if (effectText) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'chosen_type_creature_etb_or_attack',
        description: effectText,
        effect: effectText,
        mandatory: true,
      });
    }
  }

  const thatCreatureAttacksMatch = oracleText.match(/whenever that creature attacks,?\s*([^.]+)/i);
  if (thatCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'that_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, thatCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'that_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const selfOrEnchantedAttacksMatch = oracleText.match(
    /whenever this creature or enchanted creature attacks,?\s*([^.]+)/i,
  );
  if (
    selfOrEnchantedAttacksMatch &&
    !triggers.some((t) => t.triggerType === 'self_or_enchanted_attacks')
  ) {
    const effectText = timingTriggerEffect(oracleText, selfOrEnchantedAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'self_or_enchanted_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const whenVehicleAttacksMatch = oracleText.match(/when a vehicle you control attacks,?\s*([^.]+)/i);
  if (
    whenVehicleAttacksMatch &&
    !triggers.some((t) => t.triggerType === 'when_vehicle_attacks')
  ) {
    const effectText = timingTriggerEffect(oracleText, whenVehicleAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'when_vehicle_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisTokenAttacksMatch = oracleText.match(/when(?:ever)? this token attacks,?\s*([^.]+)/i);
  if (thisTokenAttacksMatch && !triggers.some((t) => t.triggerType === 'this_token_attacks')) {
    const effectText = timingTriggerEffect(oracleText, thisTokenAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'this_token_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const flyingOrHasteAttacksMatch = oracleText.match(
    /whenever a creature you control with flying and\/or haste attacks,?\s*([^.]+)/i,
  );
  if (
    flyingOrHasteAttacksMatch &&
    !triggers.some((t) => t.triggerType === 'flying_or_haste_attacks')
  ) {
    const effectText = timingTriggerEffect(oracleText, flyingOrHasteAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'flying_or_haste_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const powerEqualsToughnessAttacksMatch = oracleText.match(
    /whenever a creature you control with power equal to its toughness attacks,?\s*([^.]+)/i,
  );
  if (
    powerEqualsToughnessAttacksMatch &&
    !triggers.some((t) => t.triggerType === 'power_equals_toughness_attacks')
  ) {
    const effectText = timingTriggerEffect(oracleText, powerEqualsToughnessAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'power_equals_toughness_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const vehicleAttacksMatch = oracleText.match(/whenever a vehicle you control attacks,?\s*([^.]+)/i);
  if (vehicleAttacksMatch && !triggers.some((t) => t.triggerType === 'vehicle_attacks')) {
    const effectText = timingTriggerEffect(oracleText, vehicleAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'vehicle_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentAttacksWithCreaturesMatch = oracleText.match(
    /whenever an opponent attacks with (?:one or more )?creatures,?\s*([^.]+)/i,
  );
  if (
    opponentAttacksWithCreaturesMatch &&
    !triggers.some((t) => t.triggerType === 'opponent_attacks_with_creatures' || t.triggerType === 'opponent_attacks_with_one_or_more_creatures')
  ) {
    const effectText = timingTriggerEffect(oracleText, opponentAttacksWithCreaturesMatch);
    const triggerType = /one or more creatures/i.test(String(opponentAttacksWithCreaturesMatch[0] || ''))
      ? 'opponent_attacks_with_one_or_more_creatures'
      : 'opponent_attacks_with_creatures';
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const targetAttacksUnblockedMatch = oracleText.match(
    /when(?:ever)?(?: this turn, )? target creature you control attacks and isn't blocked,?\s*([^.]+)/i,
  );
  if (
    targetAttacksUnblockedMatch &&
    !triggers.some((t) => t.triggerType === 'target_creature_attacks_unblocked')
  ) {
    const effectText = timingTriggerEffect(oracleText, targetAttacksUnblockedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'target_creature_attacks_unblocked',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreTypedAttackMatch = oracleText.match(
    /whenever one or more ([\w]+(?: or [\w]+)*) you control attack,?\s*([^.]+)/i,
  );
  if (
    oneOrMoreTypedAttackMatch &&
    !triggers.some((t) => t.triggerType === 'one_or_more_typed_attack')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreTypedAttackMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'one_or_more_typed_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const creatureAttacksYouOrPlaneswalkerMatch = oracleText.match(
    /when(?:ever)? a creature attacks you or a planeswalker you control,?\s*([^.]+)/i,
  );
  if (
    creatureAttacksYouOrPlaneswalkerMatch &&
    !triggers.some((t) => t.triggerType === 'creature_attacks_you_or_planeswalker')
  ) {
    const effectText = timingTriggerEffect(oracleText, creatureAttacksYouOrPlaneswalkerMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'creature_attacks_you_or_planeswalker',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const toxicCreatureAttacksMatch = oracleText.match(
    /whenever another creature you control with toxic attacks,?\s*([^.]+)/i,
  );
  if (toxicCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'toxic_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, toxicCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'toxic_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const twoOrMoreCreaturesAttackMatch = oracleText.match(
    /whenever two or more creatures attack,?\s*([^.]+)/i,
  );
  if (twoOrMoreCreaturesAttackMatch && !triggers.some((t) => t.triggerType === 'two_or_more_creatures_attack')) {
    const effectText = timingTriggerEffect(oracleText, twoOrMoreCreaturesAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'two_or_more_creatures_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreNontokenTypedAttackMatch = oracleText.match(
    /whenever one or more nontoken ([\w]+(?: or [\w]+)*) you control attack,?\s*([^.]+)/i,
  );
  if (
    oneOrMoreNontokenTypedAttackMatch &&
    !triggers.some((t) => t.triggerType === 'one_or_more_nontoken_typed_attack')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreNontokenTypedAttackMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'one_or_more_nontoken_typed_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreArtifactCreaturesAttackMatch = oracleText.match(
    /whenever one or more artifact creatures you control attack,?\s*([^.]+)/i,
  );
  if (
    oneOrMoreArtifactCreaturesAttackMatch &&
    !triggers.some((t) => t.triggerType === 'one_or_more_artifact_creatures_attack')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreArtifactCreaturesAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'one_or_more_artifact_creatures_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const equippedCreatureOtherThanSelfAttacksOrDiesMatch = oracleText.match(
    new RegExp(
      `whenever an equipped creature you control other than (?:${attackNameVariants.join('|')}) attacks or dies,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    equippedCreatureOtherThanSelfAttacksOrDiesMatch &&
    !triggers.some((t) => t.triggerType === 'equipped_creature_other_than_self_attacks_or_dies')
  ) {
    const effectText = timingTriggerEffect(oracleText, equippedCreatureOtherThanSelfAttacksOrDiesMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'equipped_creature_other_than_self_attacks_or_dies',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const nonToyCreaturesAttackPlayerMatch = oracleText.match(
    /whenever one or more non-Toy creatures you control attack a player,?\s*([^.]+)/i,
  );
  if (
    nonToyCreaturesAttackPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'non_toy_creatures_attack_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, nonToyCreaturesAttackPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'non_toy_creatures_attack_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedOrEquippedAttacksMatch = oracleText.match(
    /whenever a creature you control that's enchanted or equipped attacks,?\s*([^.]+)/i,
  );
  if (
    enchantedOrEquippedAttacksMatch &&
    !triggers.some((t) => t.triggerType === 'enchanted_or_equipped_creature_attacks')
  ) {
    const effectText = timingTriggerEffect(oracleText, enchantedOrEquippedAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'enchanted_or_equipped_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedAndHumanAttackMatch = oracleText.match(
    new RegExp(
      `whenever (?:${attackNameVariants.join('|')}) and at least one Human attack,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedAndHumanAttackMatch &&
    !triggers.some((t) => t.triggerType === 'named_and_human_attack')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedAndHumanAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'named_and_human_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const attackEnchantedOpponentSacrificeMatch = oracleText.match(
    /when you attack enchanted opponent or a planeswalker they control or when they attack you or a planeswalker you control,?\s*([^.]+)/i,
  );
  if (
    attackEnchantedOpponentSacrificeMatch &&
    !triggers.some((t) => t.triggerType === 'attack_enchanted_opponent_sacrifice')
  ) {
    const effectText = timingTriggerEffect(oracleText, attackEnchantedOpponentSacrificeMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'attack_enchanted_opponent_sacrifice',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const twoOrMoreAttackPlayerMatch = oracleText.match(
    /whenever two or more creatures you control attack a player,?\s*([^.]+)/i,
  );
  if (
    twoOrMoreAttackPlayerMatch &&
    !triggers.some((t) => t.triggerType === 'two_or_more_creatures_attack_player')
  ) {
    const effectText = timingTriggerEffect(oracleText, twoOrMoreAttackPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'two_or_more_creatures_attack_player',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const playerAttacksMatch = oracleText.match(
    /whenever a player attacks(?! one of your opponents| you),?\s*([^.]+)/i,
  );
  if (playerAttacksMatch && !triggers.some((t) => t.triggerType === 'player_attacks')) {
    const effectText = timingTriggerEffect(oracleText, playerAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'player_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const typedAttacksThisTurnMatch = oracleText.match(
    /whenever a ([\w]+) attacks this turn,?\s*([^.]+)/i,
  );
  if (typedAttacksThisTurnMatch && !triggers.some((t) => t.triggerType === 'typed_attacks_this_turn')) {
    const effectText = timingTriggerEffect(oracleText, typedAttacksThisTurnMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'typed_attacks_this_turn',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const playerAttacksYouMatch = oracleText.match(/whenever a player attacks you,?\s*([^.]+)/i);
  if (playerAttacksYouMatch && !triggers.some((t) => t.triggerType === 'player_attacks_you')) {
    const effectText = timingTriggerEffect(oracleText, playerAttacksYouMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'player_attacks_you',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const playerAttacksYourOpponentMatch = oracleText.match(
    /whenever a player attacks one of your opponents,?\s*([^.]+)/i,
  );
  if (
    playerAttacksYourOpponentMatch &&
    !triggers.some((t) => t.triggerType === 'player_attacks_your_opponent')
  ) {
    const effectText = timingTriggerEffect(oracleText, playerAttacksYourOpponentMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'player_attacks_your_opponent',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentAttacksYouMatch = oracleText.match(/whenever an opponent attacks you,?\s*([^.]+)/i);
  if (opponentAttacksYouMatch && !triggers.some((t) => t.triggerType === 'opponent_attacks_you')) {
    const effectText = timingTriggerEffect(oracleText, opponentAttacksYouMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'opponent_attacks_you',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreEnchantedByAuraAttackMatch = oracleText.match(
    /whenever one or more creatures that are enchanted by an aura you control attack,?\s*([^.]+)/i,
  );
  if (
    oneOrMoreEnchantedByAuraAttackMatch &&
    !triggers.some((t) => t.triggerType === 'one_or_more_enchanted_by_aura_you_control_attack')
  ) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreEnchantedByAuraAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'one_or_more_enchanted_by_aura_you_control_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      batched: true,
    });
  }

  const oneOrMoreAttackMatch = oracleText.match(
    /whenever one or more creatures(?: you control)? attack(?! you),?\s*([^.]+)/i,
  );
  if (oneOrMoreAttackMatch && !triggers.some((t) => t.triggerType === 'one_or_more_creatures_attack')) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'one_or_more_creatures_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const oneOrMoreAttackYouMatch = oracleText.match(/whenever one or more creatures attack you,?\s*([^.]+)/i);
  if (oneOrMoreAttackYouMatch && !triggers.some((t) => t.triggerType === 'one_or_more_creatures_attack_you')) {
    const effectText = timingTriggerEffect(oracleText, oneOrMoreAttackYouMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'one_or_more_creatures_attack_you',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const noFlyingAttacksYouMatch = oracleText.match(
    /whenever a creature without flying attacks you(?: or a planeswalker you control)?,?\s*([^.]+)/i,
  );
  if (noFlyingAttacksYouMatch && !triggers.some((t) => t.triggerType === 'creature_without_flying_attacks_you')) {
    const effectText = timingTriggerEffect(oracleText, noFlyingAttacksYouMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'creature_without_flying_attacks_you',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const powerAttacksYouMatch = oracleText.match(
    /whenever a creature with power (\d+) or greater attacks you,?\s*([^.]+)/i,
  );
  if (powerAttacksYouMatch && !triggers.some((t) => t.triggerType === 'power_creature_attacks_you')) {
    const effectText = timingTriggerEffect(oracleText, powerAttacksYouMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'power_creature_attacks_you',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const youAttackWithTwoMatch = oracleText.match(/whenever you attack with two or more creatures,?\s*([^.]+)/i);
  if (youAttackWithTwoMatch && !triggers.some((t) => t.triggerType === 'you_attack_with_two_or_more')) {
    const effectText = timingTriggerEffect(oracleText, youAttackWithTwoMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'you_attack_with_two_or_more',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const uncontrolledAttacksMatch = oracleText.match(
    /whenever a creature you don't control attacks(?: a player| an opponent)?,?\s*([^.]+)/i,
  );
  if (uncontrolledAttacksMatch && !triggers.some((t) => t.triggerType === 'uncontrolled_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, uncontrolledAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'uncontrolled_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const attacksBattleMatch = oracleText.match(/whenever a creature attacks a battle,?\s*([^.]+)/i);
  if (attacksBattleMatch && !triggers.some((t) => t.triggerType === 'creature_attacks_battle')) {
    const effectText = timingTriggerEffect(oracleText, attacksBattleMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'creature_attacks_battle',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const attacksPlaneswalkerMatch = oracleText.match(/whenever a creature attacks a planeswalker,?\s*([^.]+)/i);
  if (attacksPlaneswalkerMatch && !triggers.some((t) => t.triggerType === 'creature_attacks_planeswalker')) {
    const effectText = timingTriggerEffect(oracleText, attacksPlaneswalkerMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'creature_attacks_planeswalker',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const multiTypedCreatureAttacksAnyMatch = oracleText.match(
    /when(?:ever)? a ([\w]+(?:, [\w]+)+, or [\w]+) attacks,?\s*([^.]+)/i,
  );
  if (
    multiTypedCreatureAttacksAnyMatch &&
    !lowerOracle.includes('you control') &&
    !triggers.some((t) => t.triggerType === 'multi_typed_creature_attacks_any')
  ) {
    const effectText = timingTriggerEffect(oracleText, multiTypedCreatureAttacksAnyMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'multi_typed_creature_attacks_any',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const reachCreatureAttacksMatch = oracleText.match(
    /whenever a creature you control with reach attacks,?\s*([^.]+)/i,
  );
  if (reachCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'reach_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, reachCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'reach_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const magnetCounterCreatureAttacksMatch = oracleText.match(
    /when(?:ever)? a creature with a magnet counter on it attacks,?\s*([^.]+)/i,
  );
  if (
    magnetCounterCreatureAttacksMatch &&
    !triggers.some((t) => t.triggerType === 'magnet_counter_creature_attacks')
  ) {
    const effectText = timingTriggerEffect(oracleText, magnetCounterCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'magnet_counter_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentAttacksBareMatch = oracleText.match(
    /whenever an opponent attacks(?:,|\s+if\b)/i,
  );
  if (
    opponentAttacksBareMatch &&
    !lowerOracle.includes('opponent attacks you') &&
    !lowerOracle.includes('opponent attacks with') &&
    !triggers.some((t) => t.triggerType === 'opponent_attacks')
  ) {
    const fullMatch = oracleText.match(/whenever an opponent attacks,?\s*([^.]+)/i);
    if (fullMatch) {
      const effectText = timingTriggerEffect(oracleText, fullMatch);
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'opponent_attacks',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const multiTypedYouControlAttacksMatch = oracleText.match(
    /whenever an? ([\w]+(?:, [\w]+)+, or [\w]+) you control attacks,?\s*([^.]+)/i,
  );
  if (
    multiTypedYouControlAttacksMatch &&
    !triggers.some((t) => t.triggerType === 'multi_typed_you_control_attacks')
  ) {
    const effectText = timingTriggerEffect(oracleText, multiTypedYouControlAttacksMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'multi_typed_you_control_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const youAttackWithThreeOrMoreMatch = oracleText.match(
    /when you attack with three or more creatures,?\s*([^.]+)/i,
  );
  if (
    youAttackWithThreeOrMoreMatch &&
    !triggers.some((t) => t.triggerType === 'you_attack_with_three_or_more_creatures')
  ) {
    const effectText = timingTriggerEffect(oracleText, youAttackWithThreeOrMoreMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'you_attack_with_three_or_more_creatures',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const legendaryAttacksUnblockedMatch = oracleText.match(
    /when a legendary creature you control attacks and isn't blocked,?\s*([^.]+)/i,
  );
  if (
    legendaryAttacksUnblockedMatch &&
    !triggers.some((t) => t.triggerType === 'legendary_creature_attacks_unblocked')
  ) {
    const effectText = timingTriggerEffect(oracleText, legendaryAttacksUnblockedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'legendary_creature_attacks_unblocked',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const spacecraftAttacksMatch = oracleText.match(/whenever this (?:Spacecraft|spacecraft) attacks,?\s*([^.]+)/i);
  if (spacecraftAttacksMatch && !triggers.some((t) => t.triggerType === 'spacecraft_attacks')) {
    const effectText = timingTriggerEffect(oracleText, spacecraftAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'spacecraft_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisAndOtherCreatureTokenAttackMatch = oracleText.match(
    /whenever this creature and at least one other creature token attack,?\s*([^.]+)/i,
  );
  if (
    thisAndOtherCreatureTokenAttackMatch &&
    !triggers.some((t) => t.triggerType === 'this_and_other_creature_token_attack')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisAndOtherCreatureTokenAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'this_and_other_creature_token_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedCreatureAttacksOpponentsMatch = oracleText.match(
    /whenever an enchanted creature attacks one of your opponents,?\s*([^.]+)/i,
  );
  if (
    enchantedCreatureAttacksOpponentsMatch &&
    !triggers.some((t) => t.triggerType === 'enchanted_creature_attacks_opponents')
  ) {
    const effectText = timingTriggerEffect(oracleText, enchantedCreatureAttacksOpponentsMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'enchanted_creature_attacks_opponents',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisOrCommanderAttacksAloneMatch = oracleText.match(
    /whenever this creature or a commander you control attacks alone,?\s*([^.]+)/i,
  );
  if (
    thisOrCommanderAttacksAloneMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_commander_attacks_alone')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrCommanderAttacksAloneMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'this_or_commander_attacks_alone',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const hasteCreatureAttacksMatch = oracleText.match(
    /whenever a creature you control with haste attacks,?\s*([^.]+)/i,
  );
  if (hasteCreatureAttacksMatch && !triggers.some((t) => t.triggerType === 'haste_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, hasteCreatureAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'haste_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const threeOrMoreFlyingAttackMatch = oracleText.match(
    /whenever three or more creatures you control with flying attack,?\s*([^.]+)/i,
  );
  if (threeOrMoreFlyingAttackMatch && !triggers.some((t) => t.triggerType === 'three_or_more_flying_creatures_attack')) {
    const effectText = timingTriggerEffect(oracleText, threeOrMoreFlyingAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'three_or_more_flying_creatures_attack',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const flyingAttacksMatch = oracleText.match(
    /whenever a creature(?: you control)? with flying attacks,?\s*([^.]+)/i,
  );
  if (flyingAttacksMatch && !triggers.some((t) => t.triggerType === 'flying_creature_attacks')) {
    const effectText = timingTriggerEffect(oracleText, flyingAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'flying_creature_attacks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const playerAttacksWithPattern = /whenever (?:a|another) player attacks with (?:\w+|\d+) or more creatures,?\s*([^.]+)/gi;
  let playerAttacksWithMatch: RegExpExecArray | null;
  while ((playerAttacksWithMatch = playerAttacksWithPattern.exec(oracleText)) !== null) {
    const effectText = timingTriggerEffect(oracleText, playerAttacksWithMatch);
    if (!effectText) continue;
    if (triggers.some((t) => String(t.effect || '').trim().toLowerCase() === effectText.toLowerCase())) continue;
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'player_attacks_with_creatures',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }
  
  // Join Forces attack trigger (Mana-Charged Dragon)
  // "Whenever ~ attacks, starting with you, each player may pay any amount of mana"
  if (lowerOracle.includes('join forces') && 
      lowerOracle.includes('whenever') && 
      lowerOracle.includes('attacks')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'join_forces_attack',
      description: 'Join forces - each player may pay any amount of mana',
      effect: oracleText,
      mandatory: true,
      value: {
        isJoinForces: true,
      },
    });
  }
  
  return triggers;
}

export function detectBlockTriggers(card: any, permanent: any): BlockTrigger[] {
  const triggers: BlockTrigger[] = [];
  const oracleText = (card?.oracle_text || "");
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";

  const blockKeywordReminderLinePattern = /^(?:afflict\s+\d+|bushido\s+\d+|flanking|rampage\s+\d+)\b/i;

  const findGenericBlockTriggerLine = (): RegExpMatchArray | null => {
    const blockNameVariants = buildCardNameRegexAlternatives(cardName);
    const blockSubjectPattern = `(?:~|this creature|this vehicle|(?:${blockNameVariants.join('|')}))`;
    return findFirstRegexMatchAcrossOracleLines(
      oracleText,
      (line) => blockKeywordReminderLinePattern.test(line),
      [
        new RegExp(`when(?:ever)?\\s+${blockSubjectPattern}\\s+blocks(?:\\s+a\\s+creature)?,?\\s*(.+)$`, 'i'),
      ],
    );
  };

  const anyCreatureBlocksMatch = oracleText.match(/whenever a creature blocks,?\s*([^.]+)/i);
  if (anyCreatureBlocksMatch && !triggers.some((t) => (t as any).triggerType === 'any_creature_blocks')) {
    const effectText = timingTriggerEffect(oracleText, anyCreatureBlocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'any_creature_blocks' as any,
    } as BlockTrigger);
  }

  const opponentCreatureBlocksMatch = oracleText.match(
    /whenever a creature an opponent controls blocks,?\s*([^.]+)/i,
  );
  if (
    opponentCreatureBlocksMatch &&
    !triggers.some((t) => (t as any).triggerType === 'opponent_creature_blocks')
  ) {
    const effectText = timingTriggerEffect(oracleText, opponentCreatureBlocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'opponent_creature_blocks' as any,
    } as BlockTrigger);
  }

  const equippedCreatureBlocksMatch = oracleText.match(/whenever equipped creature blocks a creature,?\s*([^.]+)/i);
  if (
    equippedCreatureBlocksMatch &&
    !triggers.some((t) => (t as any).triggerType === 'equipped_creature_blocks_creature')
  ) {
    const effectText = timingTriggerEffect(oracleText, equippedCreatureBlocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'equipped_creature_blocks_creature' as any,
    } as BlockTrigger);
  }

  const enchantedCreatureBecomesBlockedMatch = oracleText.match(
    /whenever a creature you control that's enchanted becomes blocked,?\s*([^.]+)/i,
  );
  if (
    enchantedCreatureBecomesBlockedMatch &&
    !triggers.some((t) => (t as any).triggerType === 'enchanted_creature_becomes_blocked')
  ) {
    const effectText = timingTriggerEffect(oracleText, enchantedCreatureBecomesBlockedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'enchanted_creature_becomes_blocked' as any,
    } as BlockTrigger);
  }

  const enchantedCreatureBlocksMatch = oracleText.match(/when(?:ever)? enchanted creature blocks,?\s*([^.]+)/i);
  if (enchantedCreatureBlocksMatch && !triggers.some((t) => (t as any).triggerType === 'enchanted_creature_blocks')) {
    const effectText = timingTriggerEffect(oracleText, enchantedCreatureBlocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'enchanted_creature_blocks' as any,
    } as BlockTrigger);
  }

  const controlledBecomeBlockedMatch = oracleText.match(
    /whenever one or more creatures you control become blocked,?\s*([^.]+)/i,
  );
  if (
    controlledBecomeBlockedMatch &&
    !triggers.some((t) => (t as any).triggerType === 'controlled_creatures_become_blocked')
  ) {
    const effectText = timingTriggerEffect(oracleText, controlledBecomeBlockedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'controlled_creatures_become_blocked' as any,
    } as BlockTrigger);
  }

  const menaceBecomeBlockedMatch = oracleText.match(
    /whenever a creature you control with menace becomes blocked,?\s*([^.]+)/i,
  );
  if (
    menaceBecomeBlockedMatch &&
    !triggers.some((t) => (t as any).triggerType === 'menace_creature_becomes_blocked')
  ) {
    const effectText = timingTriggerEffect(oracleText, menaceBecomeBlockedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'menace_creature_becomes_blocked' as any,
    } as BlockTrigger);
  }

  const ringBearerBlockedMatch = oracleText.match(
    /whenever your ring-bearer becomes blocked by a creature,?\s*([^.]+)/i,
  );
  if (
    ringBearerBlockedMatch &&
    !triggers.some((t) => (t as any).triggerType === 'ring_bearer_becomes_blocked')
  ) {
    const effectText = timingTriggerEffect(oracleText, ringBearerBlockedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'ring_bearer_becomes_blocked' as any,
    } as BlockTrigger);
  }

  const typedBecomeBlockedMatch = oracleText.match(
    /whenever a ([\w]+) becomes blocked,?\s*([^.]+)/i,
  );
  if (
    typedBecomeBlockedMatch &&
    !/\bcreature\b/i.test(String(typedBecomeBlockedMatch[1] || '')) &&
    !triggers.some((t) => (t as any).triggerType === 'typed_becomes_blocked')
  ) {
    const effectText = timingTriggerEffect(oracleText, typedBecomeBlockedMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'typed_becomes_blocked' as any,
    } as BlockTrigger);
  }

  const typedAnotherBecomeBlockedMatch = oracleText.match(
    /whenever another ([\w]+) you control becomes blocked,?\s*([^.]+)/i,
  );
  if (
    typedAnotherBecomeBlockedMatch &&
    !triggers.some((t) => (t as any).triggerType === 'typed_another_becomes_blocked')
  ) {
    const effectText = timingTriggerEffect(oracleText, typedAnotherBecomeBlockedMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'typed_another_becomes_blocked' as any,
    } as BlockTrigger);
  }

  const controlledCreatureBecomeBlockedMatch = oracleText.match(
    /whenever a creature you control becomes blocked,?\s*([^.]+)/i,
  );
  if (
    controlledCreatureBecomeBlockedMatch &&
    !triggers.some((t) => (t as any).triggerType === 'controlled_creature_becomes_blocked')
  ) {
    const effectText = timingTriggerEffect(oracleText, controlledCreatureBecomeBlockedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'controlled_creature_becomes_blocked' as any,
    } as BlockTrigger);
  }

  const controlledCreatureAttacksOrBlocksMatch = oracleText.match(
    /whenever a creature you control attacks or blocks,?\s*([^.]+)/i,
  );
  if (
    controlledCreatureAttacksOrBlocksMatch &&
    !triggers.some((t) => (t as any).triggerType === 'controlled_creature_attacks_or_blocks')
  ) {
    const effectText = timingTriggerEffect(oracleText, controlledCreatureAttacksOrBlocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'controlled_creature_attacks_or_blocks' as any,
    } as BlockTrigger);
  }

  const controlledCreatureBlocksMatch = oracleText.match(
    /whenever a creature you control blocks,?\s*([^.]+)/i,
  );
  if (
    controlledCreatureBlocksMatch &&
    !triggers.some((t) => (t as any).triggerType === 'controlled_creature_blocks')
  ) {
    const effectText = timingTriggerEffect(oracleText, controlledCreatureBlocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'controlled_creature_blocks' as any,
    } as BlockTrigger);
  }

  const enchantedAttacksOrBlocksMatch = oracleText.match(
    /when(?:ever)? enchanted creature attacks or blocks,?\s*([^.]+)/i,
  );
  if (
    enchantedAttacksOrBlocksMatch &&
    !triggers.some((t) => (t as any).triggerType === 'enchanted_creature_attacks_or_blocks')
  ) {
    const effectText = timingTriggerEffect(oracleText, enchantedAttacksOrBlocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'enchanted_creature_attacks_or_blocks' as any,
    } as BlockTrigger);
  }

  const blockNameVariantsEarly = buildCardNameRegexAlternatives(cardName);
  const attacksOrBlocksMatch = oracleText.match(
    new RegExp(`when(?:ever)? (?:~|this creature|this vehicle|(?:${blockNameVariantsEarly.join('|')})) attacks or blocks,?\\s*([^.]+)`, 'i'),
  );
  if (attacksOrBlocksMatch && !triggers.some((t) => (t as any).triggerType === 'attacks_or_blocks')) {
    const effectText = timingTriggerEffect(oracleText, attacksOrBlocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'attacks_or_blocks' as any,
    } as BlockTrigger);
  }

  const chefRoleAttacksOrBlocksMatch = oracleText.match(
    /whenever a creature you control enchanted by a Chef Role attacks or blocks,?\s*([^.]+)/i,
  );
  if (chefRoleAttacksOrBlocksMatch && !triggers.some((t) => t.triggerType === 'chef_role_attacks_or_blocks')) {
    const effectText = timingTriggerEffect(oracleText, chefRoleAttacksOrBlocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'chef_role_attacks_or_blocks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const equippedBlocksOrBecomesBlockedMatch = oracleText.match(
    /whenever equipped creature blocks or becomes blocked by one or more creatures,?\s*([^.]+)/i,
  );
  if (
    equippedBlocksOrBecomesBlockedMatch &&
    !triggers.some((t) => t.triggerType === 'equipped_blocks_or_becomes_blocked')
  ) {
    const effectText = timingTriggerEffect(oracleText, equippedBlocksOrBecomesBlockedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'equipped_blocks_or_becomes_blocked',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const equippedBlocksOrBlockedByVampireMatch = oracleText.match(
    /whenever equipped creature blocks or becomes blocked by a Vampire,?\s*([^.]+)/i,
  );
  if (
    equippedBlocksOrBlockedByVampireMatch &&
    !triggers.some((t) => t.triggerType === 'equipped_blocks_or_blocked_by_vampire')
  ) {
    const effectText = timingTriggerEffect(oracleText, equippedBlocksOrBlockedByVampireMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'equipped_blocks_or_blocked_by_vampire',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const defenderBlocksMatch = oracleText.match(
    /whenever a creature you control with defender blocks,?\s*([^.]+)/i,
  );
  if (defenderBlocksMatch && !triggers.some((t) => t.triggerType === 'defender_creature_blocks')) {
    const effectText = timingTriggerEffect(oracleText, defenderBlocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'defender_creature_blocks',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  // Brimaz, King of Oreskos: "Whenever Brimaz blocks a creature, create a 1/1 white Cat Soldier creature token with vigilance that's blocking that creature."
  if (lowerName.includes("brimaz")) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: "Create a 1/1 white Cat Soldier creature token with vigilance that's blocking that creature",
      effect: "Create a 1/1 white Cat Soldier creature token with vigilance that's blocking that creature",
      mandatory: true,
      createTokens: {
        count: 1,
        power: 1,
        toughness: 1,
        type: "Cat Soldier",
        color: "white",
        abilities: ["vigilance"],
      },
    });
  }

  const blocksMatch = findGenericBlockTriggerLine();

  if (blocksMatch && !triggers.some(t => t.permanentId === permanentId)) {
    const effectText = timingTriggerEffect(oracleText, blocksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: true,
    });
  }

  const anyCreatureAttacksOrBlocksBlockMatch = oracleText.match(/whenever a creature attacks or blocks,?\s*([^.]+)/i);
  if (anyCreatureAttacksOrBlocksBlockMatch && !triggers.some((t) => (t as any).triggerType === 'any_creature_attacks_or_blocks')) {
    const effectText = timingTriggerEffect(oracleText, anyCreatureAttacksOrBlocksBlockMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'any_creature_attacks_or_blocks' as any,
    } as BlockTrigger);
  }

  const blockNameVariants = buildCardNameRegexAlternatives(cardName);
  const typedBecomesBlockedMatch = oracleText.match(
    /whenever a ([\w]+) you control becomes blocked,?\s*([^.]+)/i,
  );
  if (typedBecomesBlockedMatch && !triggers.some((t) => (t as any).triggerType === 'typed_becomes_blocked')) {
    const effectText = timingTriggerEffect(oracleText, typedBecomesBlockedMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'typed_becomes_blocked' as any,
    } as BlockTrigger);
  }

  const selfOrEquippedBecomesBlockedMatch = oracleText.match(
    /whenever this creature or equipped creature becomes blocked,?\s*([^.]+)/i,
  );
  if (
    selfOrEquippedBecomesBlockedMatch &&
    !triggers.some((t) => (t as any).triggerType === 'self_or_equipped_becomes_blocked')
  ) {
    const effectText = timingTriggerEffect(oracleText, selfOrEquippedBecomesBlockedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'self_or_equipped_becomes_blocked' as any,
    } as BlockTrigger);
  }

  const becomesBlockedPatterns = [
    /when(?:ever)?\s+(?:~|this creature)\s+becomes blocked(?: this turn)?,?\s*([^.]+)/i,
    new RegExp(`when(?:ever)?\\s+(?:${blockNameVariants.join('|')})\\s+becomes blocked(?: this turn)?,?\\s*([^.]+)`, 'i'),
    /whenever\s+(?:~|this creature)\s+becomes blocked by (?:a |an )?creature,?\s*([^.]+)/i,
    /whenever\s+enchanted\s+creature\s+becomes\s+blocked,?\s*([^.]+)/i,
    /whenever\s+equipped\s+creature\s+becomes\s+blocked,?\s*([^.]+)/i,
    /whenever\s+equipped\s+creature\s+blocks\s+or\s+becomes\s+blocked\s+by\s+(?:a\s+)?creature,?\s*([^.]+)/i,
    /whenever\s+(?:~|this creature)\s+blocks\s+or\s+becomes\s+blocked,?\s*([^.]+)/i,
    /when\s+that\s+creature\s+becomes\s+blocked(?:\s+this\s+turn)?,?\s*([^.]+)/i,
  ];
  for (const pattern of becomesBlockedPatterns) {
    const match = oracleText.match(pattern);
    if (!match) continue;
    const effectText = timingTriggerEffect(oracleText, match);
    if (!effectText || triggers.some((trigger) => trigger.effect === effectText)) continue;
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  return triggers;
}

/**
 * Detect spell-countered triggers.
 * - controlled_spell_countered: Multani's Presence ("whenever a spell you've cast is countered")
 * - you_countered_spell: Baral / Lullmage ("whenever a spell or ability you control counters a spell")
 */
export function detectSpellCounteredTriggers(card: any, permanent: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const oracleText = String(card?.oracle_text || '');
  const cardName = String(card?.name || 'Unknown');
  const permanentId = permanent?.id || '';
  const controllerId = permanent?.controller || '';

  const pushTrigger = (
    match: RegExpExecArray,
    counterPerspective: 'controlled_spell_countered' | 'you_countered_spell',
  ) => {
    const effectText = timingTriggerEffect(oracleText, match);
    if (!effectText) return;
    if (triggers.some((trigger) =>
      trigger.effect === effectText
      && String((trigger as any).counterPerspective || '') === counterPerspective
    )) {
      return;
    }
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerType: 'spell_countered',
      counterPerspective,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    } as any);
  };

  const controlledSpellCounteredPatterns = [
    /whenever a spell you(?:'ve| have) cast is countered,?\s*([^.]+)/gi,
    /whenever a spell you control is countered,?\s*([^.]+)/gi,
  ];
  for (const pattern of controlledSpellCounteredPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      pushTrigger(match, 'controlled_spell_countered');
    }
  }

  const youCounteredSpellPatterns = [
    /whenever a spell or ability you control counters a spell,?\s*([^.]+)/gi,
    /whenever you counter a spell,?\s*([^.]+)/gi,
    /whenever a spell an opponent controls is countered by a spell or ability you control,?\s*([^.]+)/gi,
  ];
  for (const pattern of youCounteredSpellPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      pushTrigger(match, 'you_countered_spell');
    }
  }

  return triggers;
}

/**
 * Detect mutate triggers from oracle text.
 */
export function detectMutateTriggers(card: any, permanent: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const oracleText = String(card?.oracle_text || '');
  const cardName = String(card?.name || 'Unknown');
  const permanentId = permanent?.id || '';
  const controllerId = permanent?.controller || '';

  const mutatePatterns = [
    /whenever this creature mutates,?\s*([^.]+)/gi,
    /whenever (?:~|[\w ,']+?) mutates,?\s*([^.]+)/gi,
  ];
  for (const pattern of mutatePatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effectText = timingTriggerEffect(oracleText, match);
      if (!effectText || triggers.some((trigger) => trigger.effect === effectText)) continue;
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerType: 'mutates',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  return triggers;
}

/**
 * Detect discard triggers from oracle text.
 */
export function detectEquippedTriggers(card: any, permanent: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const oracleText = String(card?.oracle_text || '');
  const cardName = String(card?.name || 'Unknown');
  const permanentId = permanent?.id || '';

  const equippedPatterns = [
    /when this equipment becomes attached to a creature,?\s*([^.]+)/i,
    /whenever this equipment becomes attached to a creature,?\s*([^.]+)/i,
  ];
  for (const pattern of equippedPatterns) {
    const match = oracleText.match(pattern);
    if (!match) continue;
    const effectText = timingTriggerEffect(oracleText, match);
    if (!effectText || triggers.some((t) => t.effect === effectText)) continue;
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'equipped_attached',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  return triggers;
}

export function detectReturnedToHandTriggers(card: any, permanent: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const oracleText = String(card?.oracle_text || '');
  const cardName = String(card?.name || 'Unknown');
  const permanentId = permanent?.id || '';

  const returnedPatterns = [
    /whenever one or more noncreature permanents are returned to hand,?\s*([^.]+)/i,
    /whenever a permanent is returned to your hand,?\s*([^.]+)/i,
    /whenever a permanent is returned to a player's hand,?\s*([^.]+)/i,
    /whenever (?:a |an )?permanent you control is returned to your hand,?\s*([^.]+)/i,
    /whenever (?:another )?(?:nonland )?permanent you control is returned to (?:your|its owner's) hand,?\s*([^.]+)/i,
    /whenever (?:a |an )?creature is returned to your hand,?\s*([^.]+)/i,
    /whenever (?:~|this creature) or another creature is returned to your hand from the battlefield,?\s*([^.]+)/i,
    /whenever this creature or another creature is returned to your hand from the battlefield,?\s*([^.]+)/i,
  ];
  for (const pattern of returnedPatterns) {
    const match = oracleText.match(pattern);
    if (!match) continue;
    const effectText = timingTriggerEffect(oracleText, match);
    if (!effectText || triggers.some((t) => t.effect === effectText)) continue;
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'returned_to_hand',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  return triggers;
}

export function detectDiscardTriggers(card: any, permanent: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const oracleText = String(card?.oracle_text || '');
  const cardName = String(card?.name || 'Unknown');
  const permanentId = permanent?.id || '';

  const discardPatterns = [
    { pattern: /whenever you cycle or discard another card,?\s*([^.]+)/gi, triggerType: 'cycle_or_discard_another' as const },
    { pattern: /whenever you discard one or more ([\w]+) cards?,?\s*([^.]+)/gi, triggerType: 'discard_one_or_more_typed' as const },
    { pattern: /whenever you cycle or discard (?:a |an )?card,?\s*([^.]+)/gi, triggerType: 'cycle_or_discard' as const },
    { pattern: /whenever you discard (?:one or more )?cards?,?\s*([^.]+)/gi, triggerType: 'self_discard' as const },
    { pattern: /whenever you discard (?:a |an )?(creature|land|artifact|enchantment|instant|sorcery|planeswalker) cards?,?\s*([^.]+)/gi, triggerType: 'typed_self_discard' as const },
    { pattern: /whenever you discard (?:a |an )?card,?\s*([^.]+)/gi, triggerType: 'self_discard' as const },
    { pattern: /whenever an opponent discards (?:a |an )?(?:creature|land|noncreature) cards?,?\s*([^.]+)/gi, triggerType: 'opponent_discard' as const },
    { pattern: /whenever an opponent discards (?:a |an )?card,?\s*([^.]+)/gi, triggerType: 'opponent_discard' as const },
    { pattern: /whenever a player discards (?:a |an )?card,?\s*([^.]+)/gi, triggerType: 'any_player_discard' as const },
    { pattern: /whenever another player discards (?:a |an )?card,?\s*([^.]+)/gi, triggerType: 'other_player_discard' as const },
    { pattern: /whenever (?:a|one or more) players? discard(?:s)? (?:a |an |one or more )?cards?,?\s*([^.]+)/gi, triggerType: 'any_player_discard' as const },
    { pattern: /whenever a spell or ability causes you to discard (?:a |an )?card,?\s*([^.]+)/gi, triggerType: 'forced_discard' as const },
    { pattern: /whenever a spell or ability an opponent controls causes you to discard(?: cards?)?(?: this turn)?,?\s*([^.]+)/gi, triggerType: 'forced_discard' as const },
    { pattern: /when a spell or ability an opponent controls causes you to discard this card,?\s*([^.]+)/gi, triggerType: 'forced_discard' as const },
    { pattern: /when you discard an instant or sorcery card this way,?\s*([^.]+)/gi, triggerType: 'discard_instant_sorcery_this_way' as const },
    { pattern: /when you discard (?:a |an )?(?:nonland )?card this way,?\s*([^.]+)/gi, triggerType: 'discard_this_way' as const },
    { pattern: /when you discard (?:a |an )?creature card this way,?\s*([^.]+)/gi, triggerType: 'discard_creature_card_this_way' as const },
    { pattern: /when you discard this card,?\s*([^.]+)/gi, triggerType: 'discard_this_card' as const },
    { pattern: /whenever you discard (?:a |an )?nonland card,?\s*([^.]+)/gi, triggerType: 'discard_nonland_card' as const },
    { pattern: /whenever you discard an Island(?:, [\w]+(?:, or [\w]+)?)? card,?\s*([^.]+)/gi, triggerType: 'discard_island_or_typed' as const },
    { pattern: /whenever you discard a Spirit card or a card with disturb,?\s*([^.]+)/gi, triggerType: 'discard_spirit_or_disturb' as const },
  ];

  for (const { pattern, triggerType } of discardPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effectText = String(match[match.length - 1] || '').trim();
      if (!effectText || triggers.some((trigger) => trigger.triggerType === triggerType && trigger.effect === effectText)) {
        continue;
      }
      triggers.push({
        permanentId,
        cardName,
        triggerType,
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const forcedDiscardNamedCardMatch = oracleText.match(
    new RegExp(
      `when a spell or ability an opponent controls causes you to discard (?:${buildCardNameRegexAlternatives(cardName).join('|')}),?\\s*([^.]+)`,
      'i',
    ),
  );
  if (forcedDiscardNamedCardMatch && !triggers.some((t) => t.triggerType === 'forced_discard_named_card')) {
    const effectText = timingTriggerEffect(oracleText, forcedDiscardNamedCardMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'forced_discard_named_card',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const discardNamedCardMatch = oracleText.match(
    new RegExp(`when you discard (?:${buildCardNameRegexAlternatives(cardName).join('|')}),?\\s*([^.]+)`, 'i'),
  );
  if (discardNamedCardMatch && !triggers.some((t) => t.triggerType === 'discard_named_card')) {
    const effectText = timingTriggerEffect(oracleText, discardNamedCardMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'discard_named_card',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  return triggers;
}

/**
 * Detect becomes-the-target triggers from oracle text.
 */
export function detectTargetedTriggers(card: any, permanent: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const oracleText = String(card?.oracle_text || '');
  const cardName = String(card?.name || 'Unknown');
  const permanentId = permanent?.id || '';
  const cardNameEscaped = escapeCardNameForRegex(cardName);

  const targetedNameRefs = [
    '~',
    'this creature',
    'this permanent',
    'this artifact',
    'this enchantment',
    ...buildCardNameRegexAlternatives(cardName),
  ];
  const targetedPatterns = [
    /whenever you or (?:a |another )?permanent you control becomes the target of (?:a |an )?spell or ability an opponent controls,?\s*([^.]+)/i,
    /whenever another creature you control becomes the target of (?:a |an )?backup ability,?\s*([^.]+)/i,
    /whenever a ([\w]+) creature you control becomes the target of (?:a |an )?spell or ability(?: an opponent controls)?,?\s*([^.]+)/i,
    /whenever you and\/or at least one permanent you control becomes the target of (?:a |an )?spell or ability an opponent controls,?\s*([^.]+)/i,
    /whenever a creature you control with a \+1\/\+1 counter on it becomes the target of (?:a |an )?spell(?: or ability)? an opponent controls,?\s*([^.]+)/i,
    /whenever you become the target of (?:a |an )?spell or ability an opponent controls,?\s*([^.]+)/i,
    /whenever you become the target of (?:a |an )?spell,?\s*([^.]+)/i,
    /whenever a creature becomes the target of (?:a |an )?spell or ability,?\s*([^.]+)/i,
    /when(?:ever)? (?:a |an )?creature becomes the target of (?:a |an )?spell,?\s*([^.]+)/i,
    /when(?:ever)? (?:a |an )?creature (?:attacks or )?becomes the target of a spell an opponent controls,?\s*([^.]+)/i,
    new RegExp(`when(?:ever)? (?:${targetedNameRefs.join('|')}) (?:attacks or )?becomes the target of a spell an opponent controls,?\\s*([^.]+)`, 'i'),
    /when(?:ever)? (?:a |an )?creature you control becomes the target of (?:a |an )?(?:instant or sorcery )?spell,?\s*([^.]+)/i,
    /when(?:ever)? (?:a |an )?creature you control becomes the target of (?:a |an )?backup ability,?\s*([^.]+)/i,
    new RegExp(`whenever (?:${targetedNameRefs.join('|')}) becomes the target of an ability that targets only it,?\\s*(.+)$`, 'i'),
    new RegExp(`when(?:ever)? (?:${targetedNameRefs.join('|')}) becomes the target of (?:a |an )?spell,?\\s*([^.]+)`, 'i'),
    new RegExp(`when(?:ever)? (?:${targetedNameRefs.join('|')}) becomes the target of (?:a |an )?spell or ability,?\\s*([^.]+)`, 'i'),
    new RegExp(`whenever (?:${targetedNameRefs.join('|')}) becomes the target of (?:a |an )?spell or ability,?\\s*([^.]+)`, 'i'),
    /whenever (?:a |an |another )?creature you control becomes the target of (?:a |an )?spell or ability,?\s*([^.]+)/i,
    /when(?:ever)? enchanted creature becomes the target of (?:a |an )?spell,?\s*([^.]+)/i,
    /when(?:ever)? enchanted creature becomes the target of (?:a |an )?spell or ability,?\s*([^.]+)/i,
    /whenever (?:a |an )?(?:player or permanent|permanent or player) becomes the target of (?:an )?ability you control,?\s*([^.]+)/i,
    /whenever equipped creature becomes the target of (?:a |an )?spell or ability,?\s*([^.]+)/i,
    /whenever (?:a |an )?permanent you control becomes the target of (?:a |an )?spell or ability,?\s*([^.]+)/i,
    /whenever (?:a |an )?permanent becomes the target of (?:a |an )?spell or ability,?\s*([^.]+)/i,
    /whenever (?:a )?creature or planeswalker you control becomes the target of (?:a |an )?spell or ability(?: an opponent controls)?,?\s*([^.]+)/i,
    /whenever (?:a )?planeswalker or creature you control becomes the target of (?:a |an )?spell or ability(?: an opponent controls)?,?\s*([^.]+)/i,
    new RegExp(`whenever (?:${targetedNameRefs.join('|')}) or another [\\w]+ you control becomes the target of a spell,?\\s*([^.]+)`, 'i'),
    /whenever (?:a |an )?creature you control with menace becomes the target of (?:a |an )?spell or ability,?\s*([^.]+)/i,
    /whenever a creature you control or a creature spell you control becomes the target of (?:a |an )?spell or ability an opponent controls,?\s*([^.]+)/i,
    /whenever a ([\w]+) you control becomes the target of (?:a |an )?spell or ability an opponent controls,?\s*([^.]+)/i,
    /whenever a ([\w]+(?: or [\w]+)*) you control becomes the target of (?:an )?instant or sorcery spell,?\s*([^.]+)/i,
    /whenever (?:~|this creature) becomes the target of (?:an )?Aura spell,?\s*([^.]+)/i,
    /whenever another permanent you control becomes the target of (?:a |an )?spell or ability an opponent controls,?\s*([^.]+)/i,
    /when (?:the )?chosen player (?:is attacked or )?becomes the target of (?:a |an )?spell or ability,?\s*([^.]+)/i,
    /whenever (?:a |an )?player becomes the target of (?:a |an )?spell or ability,?\s*([^.]+)/i,
    /whenever a creature an opponent controls becomes the target of (?:a |an )?spell or ability you control,?\s*([^.]+)/i,
    /whenever another creature becomes the target of an ability of a land you control named ([^,]+),?\s*([^.]+)/i,
  ];

  for (const pattern of targetedPatterns) {
    const match = oracleText.match(pattern);
    if (!match) continue;
    const effectText = String(match[match.length - 1] || '').trim();
    if (!effectText || triggers.some((trigger) => trigger.effect === effectText)) continue;
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'targeted',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  return triggers;
}

function isHideawayLookEffectText(text: string): boolean {
  const t = String(text || '').toLowerCase();
  return /look at the top/.test(t) && /exile/.test(t) && /face\s*down/.test(t);
}

function isOracleIndexInsideParenthetical(oracleText: string, index: number): boolean {
  if (typeof index !== 'number' || index < 0) return false;
  let depth = 0;
  for (let i = 0; i < index && i < oracleText.length; i++) {
    const ch = oracleText[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
  }
  return depth > 0;
}

/**
 * ETB pattern alternatives (static to avoid recreating on every function call)
 */
const ETB_STATIC_ALTERNATIVES = [
  '~',
  'this creature',
  'this permanent',
  'this land',
  'this enchantment',
  'this aura',
  'this artifact',
  'this equipment',
  'this vehicle',
  'this token',
  'this planeswalker',
  'this battle',
  'this siege',
  'this class',
  'this spacecraft',
  'this case',
  'this attraction',
];

/**
 * Compound event after "enters or …". Must be consumed as timing, never as the effect
 * (Tivit / Stitcher's Supplier / Experimental Synthesizer class).
 * Longer phrases first so `dies` does not steal "a planeswalker you control dies".
 */
const ENTERS_OR_EVENT_SUFFIX =
  '(?:deals combat damage to a player(?: or planeswalker)?|is put into a graveyard from the battlefield|becomes the target of a spell or ability an opponent controls|becomes the target of an? aura spell|enchanted creature becomes the target of an? aura spell|the creature it haunts dies|a planeswalker you control dies|another nontoken [\\w]+ you control dies|another creature dies|when it(?:\'s| is) turned face up|is turned face up|becomes monstrous|becomes tapped|leaves(?: the battlefield)?|transforms(?: into [^,]+)?|specializes(?: from [^,]+)?|attacks|dies)';

function isSwallowedCompoundEnterEffect(effectText: string): boolean {
  return /^or\s+/i.test(String(effectText || '').trim());
}

const LTB_STATIC_ALTERNATIVES = [
  '~',
  'this creature',
  'this permanent',
  'this land',
  'this enchantment',
  'this aura',
  'this artifact',
  'this equipment',
  'this vehicle',
  'this token',
  'this planeswalker',
  'this battle',
];

/**
 * Detect ETB triggers from a card
 */
export function detectETBTriggers(card: any, permanent?: any): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const cardFaces = Array.isArray(card?.card_faces) ? card.card_faces : [];
  const isTransformCard = (card?.layout === 'transform' || card?.layout === 'double_faced_token') && cardFaces.length >= 2;
  const activeFaceIndex = (permanent as any)?.transformed ? 1 : 0;
  const activeFace = isTransformCard ? cardFaces[activeFaceIndex] || cardFaces[0] : undefined;
  const oracleText = stripReminderParentheticals(String(
    isTransformCard
      ? activeFace?.oracle_text || card?.oracle_text || ""
      : card?.oracle_text || ""
  ));
  const lowerOracle = oracleText.toLowerCase();
  const cardName = String(
    isTransformCard
      ? activeFace?.name || card?.name || "Unknown"
      : card?.name || "Unknown"
  );
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  
  // Check known ETB trigger cards first
  for (const [knownName, info] of Object.entries(KNOWN_ETB_TRIGGERS)) {
    if (!lowerName.includes(knownName)) continue;
    // Skip table rows that describe activated abilities (e.g. sacrifice costs), not ETB triggers.
    const hasSelfEtbInOracle = /\bwhen\b[^.]*\benters(?:\s+the\s+battlefield)?\b/i.test(oracleText);
    if (!hasSelfEtbInOracle && /^sacrifice\s+/i.test(String(info.effect || ''))) {
      continue;
    }

    let triggerType: TriggeredAbility['triggerType'];
    switch (info.triggerOn) {
      case 'another_permanent':
        triggerType = 'another_permanent_etb';
        break;
      case 'any_permanent':
        triggerType = 'permanent_etb';
        break;
      case 'creature':
        triggerType = 'creature_etb';
        break;
      default:
        triggerType = 'etb';
    }
    
    const trigger: TriggeredAbility = {
      permanentId,
      cardName,
      triggerType,
      description: info.effect,
      effect: info.effect,
      millAmount: info.millAmount,
      mandatory: !String(info.effect || '').toLowerCase().includes('you may'),
      requiresChoice: String(info.effect || '').toLowerCase().includes('you may'),
    };
    
    // Add search filter info if present
    if (info.searchFilter) {
      (trigger as any).searchFilter = info.searchFilter;
      (trigger as any).searchDestination = info.searchDestination || 'hand';
      (trigger as any).searchEntersTapped = info.searchEntersTapped || false;
    }
    
    triggers.push(trigger);
  }
  
  // "When ~ enters the battlefield" or "When [CARDNAME] enters the battlefield"
  // The ~ is used in some oracle text, but the actual card name is also used
  // Note: New Bloomburrow template uses "enters" instead of "enters the battlefield"
  // Use shared utility function for regex escaping
  const etbNameVariants = buildCardNameRegexAlternatives(cardName);
  // Combine static alternatives with dynamic card name variants
  const etbAlternatives = [...ETB_STATIC_ALTERNATIVES, ...etbNameVariants];
  const putOntoBattlefieldThisWayMatch = oracleText.match(
    /when a creature is put onto the battlefield this way,?\s*([^.]+)/i,
  );
  if (putOntoBattlefieldThisWayMatch && !triggers.some((t) => t.triggerType === 'put_onto_battlefield_this_way')) {
    const effectText = timingTriggerEffect(oracleText, putOntoBattlefieldThisWayMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'put_onto_battlefield_this_way',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  // Nested delayed ETB from "put onto battlefield this way" (Masterpiece Vault):
  // "When an Equipment enters this way, attach it to ..."
  const equipmentEntersThisWayMatch = oracleText.match(
    /when(?:ever)? an? equipments? enters this way,?\s*([^.]+)/i,
  );
  if (equipmentEntersThisWayMatch && !triggers.some((t) => t.triggerType === 'equipment_etb' || t.triggerType === 'equipment_enters_this_way')) {
    const effectText = timingTriggerEffect(oracleText, equipmentEntersThisWayMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'equipment_enters_this_way',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
      nontokenOnly: false,
    } as any);
  }

  const selfEntersOrLeavesPattern = new RegExp(
    `when(?:ever)?\\s+(?:${etbAlternatives.join('|')})\\s+enters or leaves(?: the battlefield)?,?\\s*([^.]+)`,
    'i',
  );
  const selfEntersOrLeavesEtbMatch = oracleText.match(selfEntersOrLeavesPattern);
  if (selfEntersOrLeavesEtbMatch && !triggers.some((t) => t.triggerType === 'self_enters_or_leaves')) {
    const effectText = timingTriggerEffect(oracleText, selfEntersOrLeavesEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'self_enters_or_leaves',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const entersOrLeavesEtbMatch = oracleText.match(
    /whenever (?:a |an )?permanent enters or leaves(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (entersOrLeavesEtbMatch && !triggers.some((t) => t.triggerType === 'enters_or_leaves')) {
    const effectText = timingTriggerEffect(oracleText, entersOrLeavesEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enters_or_leaves',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedAndOrOtherTypedEtbPattern = new RegExp(
    `whenever\\s+(?:${etbNameVariants.join('|')})\\s+and\\/or\\s+one\\s+or\\s+more\\s+other\\s+([\\w]+(?:\\s+or\\s+[\\w]+)*)\\s+you\\s+control\\s+enter,?\\s*([^.]+)`,
    'i',
  );
  const namedAndOrOtherTypedEtbMatch = oracleText.match(namedAndOrOtherTypedEtbPattern);
  if (
    namedAndOrOtherTypedEtbMatch &&
    !triggers.some((t) => t.triggerType === 'named_and_or_other_typed_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedAndOrOtherTypedEtbMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_and_or_other_typed_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const namedOrAnotherTypedEtbPattern = new RegExp(
    `whenever\\s+(?:${etbNameVariants.join('|')})\\s+or\\s+another\\s+([\\w]+(?:\\s+or\\s+[\\w]+)*)(?:\\s+you\\s+control)?\\s+enters?(?: the battlefield)?(?:\\s+under your control)?,?\\s*([^.]+)`,
    'i',
  );
  const namedOrAnotherTypedEtbMatch = oracleText.match(namedOrAnotherTypedEtbPattern);
  if (
    namedOrAnotherTypedEtbMatch &&
    !triggers.some((t) => t.triggerType === 'named_or_another_typed_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrAnotherTypedEtbMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_another_typed_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
      requiredTypePhrase: String(namedOrAnotherTypedEtbMatch[1] || '').trim(),
      doThisOnlyOnceEachTurn: oracleTextHasDoThisOnlyOnceEachTurn(oracleText),
      oncePerTurn: oracleTextHasTriggersOnlyOnceEachTurn(oracleText),
    } as any);
  }

  const namedOrCreaturePowerOrLessEtbMatch = oracleText.match(
    new RegExp(
      `whenever (?:${etbNameVariants.join('|')}) or another creature you control with power (\\d+) or less enters?(?: the battlefield)?,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedOrCreaturePowerOrLessEtbMatch &&
    !lowerOracle.includes('nontoken creature you control with power') &&
    !triggers.some((t) => t.triggerType === 'named_or_creature_power_or_less_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrCreaturePowerOrLessEtbMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_creature_power_or_less_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const namedOrNontokenCreaturePowerOrLessEtbMatch = oracleText.match(
    new RegExp(
      `whenever (?:${etbNameVariants.join('|')}) or another nontoken creature you control with power (\\d+) or less enters?(?: the battlefield)?,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedOrNontokenCreaturePowerOrLessEtbMatch &&
    !triggers.some((t) => t.triggerType === 'named_or_nontoken_creature_power_or_less_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrNontokenCreaturePowerOrLessEtbMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_nontoken_creature_power_or_less_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const multiTypedCreatureEtbMatch = oracleText.match(
    /whenever a ([\w]+(?:, [\w]+)+, or [\w]+) you control enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (multiTypedCreatureEtbMatch && !triggers.some((t) => t.triggerType === 'multi_typed_creature_etb')) {
    const effectText = timingTriggerEffect(oracleText, multiTypedCreatureEtbMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'multi_typed_creature_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const thisAttractionEtbMatch = oracleText.match(/when this attraction enters,?\s*([^.]+)/i);
  if (thisAttractionEtbMatch && !triggers.some((t) => t.triggerType === 'this_attraction_etb')) {
    const effectText = timingTriggerEffect(oracleText, thisAttractionEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_attraction_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedOrAnotherSameNamedPermanentEtbMatch = oracleText.match(
    new RegExp(
      `whenever (?:${etbNameVariants.join('|')}) or another permanent you control named (?:${etbNameVariants.join('|')}) enters?(?: the battlefield)?,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedOrAnotherSameNamedPermanentEtbMatch &&
    !triggers.some((t) => t.triggerType === 'named_or_another_same_named_permanent_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrAnotherSameNamedPermanentEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_another_same_named_permanent_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const thisOrAnotherNonTypeEtbMatch = oracleText.match(
    /whenever this creature or another non-([\w]+) creature you control enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherNonTypeEtbMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_another_non_type_creature_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherNonTypeEtbMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_non_type_creature_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const toughnessGreaterThanPowerEtbMatch = oracleText.match(
    /whenever this creature or another creature you control with toughness greater than its power enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    toughnessGreaterThanPowerEtbMatch &&
    !triggers.some((t) => t.triggerType === 'toughness_greater_than_power_creature_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, toughnessGreaterThanPowerEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'toughness_greater_than_power_creature_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const namedOrNontokenHistoricEtbMatch = oracleText.match(
    new RegExp(
      `whenever (?:${etbNameVariants.join('|')}) or another nontoken historic permanent you control enters?(?: the battlefield)?,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedOrNontokenHistoricEtbMatch &&
    !triggers.some((t) => t.triggerType === 'named_or_nontoken_historic_permanent_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrNontokenHistoricEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_nontoken_historic_permanent_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const entersFromGraveyardMatch = oracleText.match(
    /whenever this creature or another creature enters from your graveyard,?\s*([^.]+)/i,
  );
  if (
    entersFromGraveyardMatch &&
    !triggers.some((t) => t.triggerType === 'creature_enters_from_graveyard')
  ) {
    const effectText = timingTriggerEffect(oracleText, entersFromGraveyardMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_enters_from_graveyard',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const permanentEntersFromGraveyardMatch = oracleText.match(
    new RegExp(
      `whenever (?:${etbNameVariants.join('|')}|this creature|this permanent) or another permanent enters from a graveyard,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    permanentEntersFromGraveyardMatch &&
    !triggers.some((t) => t.triggerType === 'permanent_enters_from_graveyard')
  ) {
    const effectText = timingTriggerEffect(oracleText, permanentEntersFromGraveyardMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'permanent_enters_from_graveyard',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const artifactCreatureEnchantmentEntersMatch = oracleText.match(
    /whenever an artifact, creature, or enchantment enters(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    artifactCreatureEnchantmentEntersMatch &&
    !triggers.some((t) => t.triggerType === 'artifact_creature_or_enchantment_enters')
  ) {
    const effectText = timingTriggerEffect(oracleText, artifactCreatureEnchantmentEntersMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'artifact_creature_or_enchantment_enters',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const cleanupStepSacrificeMatch = oracleText.match(
    /sacrifices? it at the beginning of the next cleanup step/i,
  );
  if (cleanupStepSacrificeMatch && !triggers.some((t) => t.triggerType === 'cleanup_step_sacrifice')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'cleanup_step_sacrifice',
      description: 'Sacrifice at the beginning of the next cleanup step',
      effect: 'Sacrifice at the beginning of the next cleanup step',
      mandatory: true,
    });
  }

  const thisPermanentEtbMatch = oracleText.match(/when(?:ever)? this permanent enters(?: the battlefield)?(?!\s+or\s+),?\s*([^.]+)/i);
  if (thisPermanentEtbMatch && !triggers.some((t) => t.triggerType === 'this_permanent_etb')) {
    const effectText = timingTriggerEffect(oracleText, thisPermanentEtbMatch);
    if (effectText && !isSwallowedCompoundEnterEffect(effectText)) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'this_permanent_etb',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const entersThisWayMatch = oracleText.match(/when it enters this way,?\s*([^.]+)/i);
  if (entersThisWayMatch && !triggers.some((t) => t.triggerType === 'enters_this_way')) {
    const effectText = timingTriggerEffect(oracleText, entersThisWayMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enters_this_way',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedOrCreaturePowerOrGreaterEtbMatch = oracleText.match(
    new RegExp(
      `whenever (?:~|this creature|(?:${etbNameVariants.join('|')})) or another creature(?: you control)? with power (\\d+) or greater enters?(?: the battlefield)?,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedOrCreaturePowerOrGreaterEtbMatch &&
    !triggers.some((t) => t.triggerType === 'named_or_creature_power_or_greater_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrCreaturePowerOrGreaterEtbMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_creature_power_or_greater_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const teamTypedEtbMatch = oracleText.match(
    /whenever this creature or another ([\w]+) your team controls enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (teamTypedEtbMatch && !triggers.some((t) => t.triggerType === 'team_typed_creature_etb')) {
    const effectText = timingTriggerEffect(oracleText, teamTypedEtbMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'team_typed_creature_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const namedAndOrNontokenCreaturesEnterMatch = oracleText.match(
    new RegExp(
      `whenever (?:${etbNameVariants.join('|')}) and\\/or one or more other nontoken creatures you control enter,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedAndOrNontokenCreaturesEnterMatch &&
    !triggers.some((t) => t.triggerType === 'named_and_or_nontoken_creatures_enter')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedAndOrNontokenCreaturesEnterMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_and_or_nontoken_creatures_enter',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const namedOrAnotherNontokenTypedEtbMatch = oracleText.match(
    new RegExp(
      `whenever (?:${etbNameVariants.join('|')}) or another nontoken ([\\w]+) you control enters?(?: the battlefield)?,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedOrAnotherNontokenTypedEtbMatch &&
    !triggers.some((t) => t.triggerType === 'named_or_another_nontoken_typed_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrAnotherNontokenTypedEtbMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_another_nontoken_typed_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
      nontokenOnly: true,
      requiredTypePhrase: String(namedOrAnotherNontokenTypedEtbMatch[1] || '').trim(),
      doThisOnlyOnceEachTurn: oracleTextHasDoThisOnlyOnceEachTurn(oracleText),
      oncePerTurn: oracleTextHasTriggersOnlyOnceEachTurn(oracleText),
    } as any);
  }

  const thisOrAnotherTypedEtbAnyMatch = oracleText.match(
    /whenever this creature or another ([\w]+) enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherTypedEtbAnyMatch &&
    !lowerOracle.includes('you control') &&
    !triggers.some((t) => t.triggerType === 'this_or_another_typed_etb_any')
  ) {
    const tribalType = String(thisOrAnotherTypedEtbAnyMatch[1] || '').trim().toLowerCase();
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherTypedEtbAnyMatch, 2);
    if (effectText && !['creature', 'artifact', 'enchantment', 'permanent'].includes(tribalType)) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'this_or_another_typed_etb_any',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
        requiredTypePhrase: tribalType,
        doThisOnlyOnceEachTurn: oracleTextHasDoThisOnlyOnceEachTurn(oracleText),
        oncePerTurn: oracleTextHasTriggersOnlyOnceEachTurn(oracleText),
      } as any);
    }
  }

  const thisOrAnotherNontokenTypedEtbMatch = oracleText.match(
    /whenever this creature or another nontoken ([\w]+) you control enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherNontokenTypedEtbMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_another_nontoken_typed_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherNontokenTypedEtbMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_nontoken_typed_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
      nontokenOnly: true,
      requiredTypePhrase: String(thisOrAnotherNontokenTypedEtbMatch[1] || '').trim(),
      doThisOnlyOnceEachTurn: oracleTextHasDoThisOnlyOnceEachTurn(oracleText),
      oncePerTurn: oracleTextHasTriggersOnlyOnceEachTurn(oracleText),
    } as any);
  }

  const thisOrAnotherArtifactEtbAnyMatch = oracleText.match(
    /whenever this artifact or another artifact enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherArtifactEtbAnyMatch &&
    !lowerOracle.includes('you control') &&
    !triggers.some((t) => t.triggerType === 'this_or_another_artifact_etb_any')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherArtifactEtbAnyMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_artifact_etb_any',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisBossEtbMatch = oracleText.match(/when this boss enters,?\s*([^.]+)/i);
  if (thisBossEtbMatch && !triggers.some((t) => t.triggerType === 'this_boss_etb')) {
    const effectText = timingTriggerEffect(oracleText, thisBossEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_boss_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const multiTypedControlledEtbMatch = oracleText.match(
    new RegExp(
      `whenever (?:${etbNameVariants.join('|')}) or another ([\\w]+, [\\w]+, [\\w]+, or [\\w]+) enters the battlefield under your control,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    multiTypedControlledEtbMatch &&
    !triggers.some((t) => t.triggerType === 'multi_typed_controlled_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, multiTypedControlledEtbMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'multi_typed_controlled_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const counterSpellPlayedMatch = oracleText.match(
    /whenever a player plays a spell that counters a spell that has been played or a player plays a spell that comes into play with counters,?\s*([^.]+)/i,
  );
  if (
    counterSpellPlayedMatch &&
    !triggers.some((t) => t.triggerType === 'counter_spell_played')
  ) {
    const effectText = timingTriggerEffect(oracleText, counterSpellPlayedMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'counter_spell_played',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  // "When this Equipment enters…" is already covered by ETB_STATIC_ALTERNATIVES
  // ("this equipment") → triggerType 'etb'. Do NOT also emit this_equipment_etb
  // or Living Weapon / Job Select / Midnight Angel Armor-style clauses double-fire
  // (G1: etb + this_equipment_etb both ran Oracle IR create+attach).
  // Keep detection commented for grep/historical reference only.
  // const thisEquipmentEtbMatch = oracleText.match(/when(?:ever)? this equipment enters(?: the battlefield)?,?\s*([^.]+)/i);

  const thisOrAnotherTypedEtbMatch = oracleText.match(
    /whenever this creature or another ([\w]+) you control enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    thisOrAnotherTypedEtbMatch &&
    !triggers.some((t) => t.triggerType === 'this_or_another_typed_etb')
  ) {
    const tribalType = String(thisOrAnotherTypedEtbMatch[1] || '').trim().toLowerCase();
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherTypedEtbMatch, 2);
    if (
      effectText &&
      !['creature', 'artifact', 'enchantment', 'ally', 'permanent'].includes(tribalType)
    ) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'this_or_another_typed_etb',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
        controlledOnly: true,
        requiredTypePhrase: tribalType,
        doThisOnlyOnceEachTurn: oracleTextHasDoThisOnlyOnceEachTurn(oracleText),
        oncePerTurn: oracleTextHasTriggersOnlyOnceEachTurn(oracleText),
      } as any);
    }
  }

  const thisOrAnotherAllyEtbMatch = oracleText.match(
    /whenever this creature or another ally you control enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (thisOrAnotherAllyEtbMatch && !triggers.some((t) => t.triggerType === 'this_or_another_ally_etb')) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherAllyEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_ally_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const thisCreatureOrAnotherArtifactEtbMatch = oracleText.match(
    /whenever this (?:creature|permanent) or another artifact you control enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    thisCreatureOrAnotherArtifactEtbMatch &&
    !triggers.some((t) => t.triggerType === 'this_creature_or_another_artifact_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisCreatureOrAnotherArtifactEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_creature_or_another_artifact_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const thisEnchantmentOrAnotherNontokenEtbMatch = oracleText.match(
    /whenever this enchantment or another nontoken enchantment you control enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    thisEnchantmentOrAnotherNontokenEtbMatch &&
    !triggers.some((t) => t.triggerType === 'this_enchantment_or_another_nontoken_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisEnchantmentOrAnotherNontokenEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_enchantment_or_another_nontoken_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const thisOrAnotherArtifactEtbMatch = oracleText.match(
    /whenever this artifact or another artifact you control enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (thisOrAnotherArtifactEtbMatch && !triggers.some((t) => t.triggerType === 'this_or_another_artifact_etb')) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherArtifactEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_artifact_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const thisOrAnotherEnchantmentEtbMatch = oracleText.match(
    /whenever this enchantment or another enchantment you control enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (thisOrAnotherEnchantmentEtbMatch && !triggers.some((t) => t.triggerType === 'this_or_another_enchantment_etb')) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherEnchantmentEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_enchantment_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const thisCreatureOrAnotherEnchantmentEtbMatch = oracleText.match(
    /whenever this creature or another enchantment you control enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (
    thisCreatureOrAnotherEnchantmentEtbMatch &&
    !triggers.some((t) => t.triggerType === 'this_creature_or_another_enchantment_etb')
  ) {
    const effectText = timingTriggerEffect(oracleText, thisCreatureOrAnotherEnchantmentEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_creature_or_another_enchantment_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const counterThresholdMatch = oracleText.match(
    /when there are (?:\w+|\d+) or more (\w+) counters on (?:this \w+),?\s*([^.]+)/i,
  );
  if (counterThresholdMatch && !triggers.some((t) => t.triggerType === 'counter_threshold')) {
    const effectText = timingTriggerEffect(oracleText, counterThresholdMatch, 3);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'counter_threshold',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const thisOrAnotherCreatureEtbMatch = oracleText.match(
    /whenever this creature or another creature you control enters?(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (thisOrAnotherCreatureEtbMatch && !triggers.some((t) => t.triggerType === 'this_or_another_creature_etb')) {
    const effectText = timingTriggerEffect(oracleText, thisOrAnotherCreatureEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'this_or_another_creature_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const namedOrAnotherCreatureEtbPattern = new RegExp(
    `whenever\\s+(?:${etbNameVariants.join('|')}|this creature)\\s+or\\s+another\\s+(?:[\\w\\s]+?\\s+)?creature(?:s)?\\s+you\\s+control\\s+enters?(?: the battlefield)?,?\\s*([^.]+)`,
    'i',
  );
  const namedOrAnotherCreatureEtbMatch = oracleText.match(namedOrAnotherCreatureEtbPattern);
  if (namedOrAnotherCreatureEtbMatch && !triggers.some((t) => t.triggerType === 'named_or_another_creature_etb')) {
    const effectText = timingTriggerEffect(oracleText, namedOrAnotherCreatureEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_another_creature_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const namedOrAnotherEnchantmentEtbPattern = new RegExp(
    `whenever\\s+(?:${etbNameVariants.join('|')})\\s+or\\s+another\\s+enchantment(?:s)?\\s+you\\s+control\\s+enters?(?: the battlefield)?,?\\s*([^.]+)`,
    'i',
  );
  const namedOrAnotherEnchantmentEtbMatch = oracleText.match(namedOrAnotherEnchantmentEtbPattern);
  if (namedOrAnotherEnchantmentEtbMatch && !triggers.some((t) => t.triggerType === 'named_or_another_enchantment_etb')) {
    const effectText = timingTriggerEffect(oracleText, namedOrAnotherEnchantmentEtbMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_another_enchantment_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: true,
    });
  }

  const etbPattern = new RegExp(
    `when(?:ever)?\\s+(?:${etbAlternatives.join('|')})\\s+(?:enters(?: the battlefield)?|comes into play)(?:\\s+or\\s+${ENTERS_OR_EVENT_SUFFIX})?[,]?\\s*([^.]+)`,
    'i',
  );
  // Keyword reminders can contain a parenthetical "when this creature enters"
  // before the card's actual ETB ability (notably offspring and squad).
  // Do not stop at that reminder; it is intentionally skipped below and cannot
  // be the only candidate considered.
  const etbMatches = Array.from(
    oracleText.matchAll(new RegExp(etbPattern.source, 'gi')),
  );
  const etbMatch =
    etbMatches.find(
      (match) => !isOracleIndexInsideParenthetical(oracleText, Number(match.index ?? -1)),
    )
    ?? etbMatches[0]
    ?? null;
  if (etbMatch && !triggers.some(t => t.triggerType === 'etb' || t.triggerType === 'self_enters_or_attacks' || t.triggerType === 'self_enters_or_leaves' || t.triggerType === 'etb_sacrifice_unless_pay' || t.triggerType === 'this_equipment_etb' || t.triggerType === 'job_select' || t.triggerType === 'living_weapon')) {
    let effectText = timingTriggerEffect(oracleText, etbMatch);
    const fullMatchText = String(etbMatch[0] || '');
    const isSelfEntersOrAttacks = /\bor\s+attacks\b/i.test(fullMatchText);
    const matchIndex = typeof etbMatch.index === 'number' ? etbMatch.index : oracleText.indexOf(fullMatchText);
    const remainder = matchIndex >= 0 ? oracleText.slice(matchIndex + fullMatchText.length).trim() : '';

    // Necromancy-style ETB abilities can span multiple sentences:
    // the first sentence turns the source into an Aura, and the next sentence
    // contains the actual graveyard target clause. Preserve that continuation so
    // target metadata inference can see the graveyard target.
    if (!/\btarget\b/i.test(effectText) && /\bbecomes an aura\b/i.test(effectText)) {
      const continuationMatch = remainder.match(/^[.?!]\s*((?:put|return)\s+target\s+[^.?!]+(?:[.?!]|$))/i);
      if (continuationMatch) {
        effectText = `${effectText}. ${String(continuationMatch[1] || '').trim().replace(/[.?!]\s*$/, '')}`;
      }
    }

    const exileReplacementContinuationMatch = remainder.match(/^[.?!]\s*(if\s+(?:a|that|this)\s+(?:card|spell)(?:\s+cast\s+this\s+way)?\s+would\s+be\s+put\s+into\s+your\s+graveyard\s*,?\s*exile\s+it\s+instead(?:[.?!]|$))/i);
    if (exileReplacementContinuationMatch) {
      const continuation = String(exileReplacementContinuationMatch[1] || '').trim().replace(/[.?!]\s*$/, '');
      if (continuation && !new RegExp(`${continuation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i').test(effectText)) {
        effectText = `${effectText}. ${continuation}`;
      }
    }

    const ifYouDoContinuationMatch = remainder.match(/^[.?!]\s*(if\s+you\s+do,\s+[^.?!]+(?:[.?!]|$))/i);
    if (ifYouDoContinuationMatch) {
      const continuation = String(ifYouDoContinuationMatch[1] || '').trim().replace(/[.?!]\s*$/, '');
      if (continuation && !new RegExp(`${continuation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i').test(effectText)) {
        effectText = `${effectText}. ${continuation}`;
      }
    }

    const isEscapedSelfSacrificeTrigger = /sacrifice\s+(?:~|it|this\s+\w+)\s+unless\s+it\s+escaped/i.test(effectText);
    if (isEscapedSelfSacrificeTrigger && permanent?.escapedFrom) {
      effectText = '';
    }
    if (isSwallowedCompoundEnterEffect(effectText)) {
      effectText = '';
    }

    if (!effectText) {
      // Skip ETB self-sacrifice lines that no longer apply because the permanent already escaped.
    }
    
    // Keyword reminders such as Hideaway 4 (When this land enters, ...) must not
    // also register as a generic self-ETB — hideaway_etb is queued separately.
    else if (
      isOracleIndexInsideParenthetical(oracleText, matchIndex)
      || (detectHideawayAbility(card) && isHideawayLookEffectText(effectText))
    ) {
      // skip reminder / keyword-covered hideaway ETB
    }
    // Check for "sacrifice ~ unless you pay" pattern (Transguild Promenade, Gateway Plaza, Rupture Spire)
    else {
      const sacrificeUnlessPayMatch = effectText.match(/sacrifice\s+(?:~|it|this\s+\w+)\s+unless\s+you\s+pay\s+(\{[^}]+\})/i);
      if (sacrificeUnlessPayMatch) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'etb_sacrifice_unless_pay',
        description: effectText,
        effect: effectText,
        manaCost: sacrificeUnlessPayMatch[1],
        mandatory: true,
        requiresChoice: true,
      });
      } 
    // Check for bounce land pattern - "return a land you control to its owner's hand"
      else if (/return\s+a\s+land\s+you\s+control\s+to\s+its\s+owner's\s+hand/i.test(effectText)) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'etb_bounce_land',
        description: effectText,
        effect: effectText,
        mandatory: true,
        requiresChoice: true,
      });
      }
      else {
      // Detect if this trigger requires targeting. Modal choose-one effects pick
      // a mode first; only some modes have targets, so do not require a stack target.
      const modalChooseModes = isModalChooseModesEffectText(effectText);
      const targetType = modalChooseModes ? undefined : detectTargetType(effectText);
      const requiresTarget = !modalChooseModes && (/\btarget\b/i.test(effectText) || !!targetType);
      
      // Detect targeting constraint (e.g., "opponent controls" or "you control")
      let targetConstraint: 'opponent' | 'you' | undefined = undefined;
      if (requiresTarget) {
        const lowerEffect = effectText.toLowerCase();
        if (lowerEffect.includes('an opponent controls') || lowerEffect.includes('opponent controls')) {
          targetConstraint = 'opponent';
        } else if (lowerEffect.includes('you control')) {
          targetConstraint = 'you';
        }
      }
      
      triggers.push({
        permanentId,
        cardName,
        triggerType: isSelfEntersOrAttacks ? 'self_enters_or_attacks' : 'etb',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
        requiresTarget,
        targetType,
        targetConstraint,
      });
      }
    }
  }

  const etbOrAttackPattern = new RegExp(`whenever\\s+(?:${etbAlternatives.join('|')})\\s+enters(?: the battlefield)?\\s+or\\s+attacks[,]?\\s*([^.]+)`, 'i');
  const faceUpPattern = new RegExp(
    `when(?:ever)?\\s+(?:${etbAlternatives.join('|')})\\s+(?:enters(?: the battlefield)?\\s+or\\s+(?:when it(?:'s| is)\\s+)?)?(?:is\\s+)?turned face up,?\\s*([^.]+)`,
    'i',
  );
  const regenerateMatch = oracleText.match(/when it regenerates this way,?\s*([^.]+)/i);
  if (regenerateMatch && !triggers.some((trigger) => trigger.triggerType === 'regenerated')) {
    const effectText = timingTriggerEffect(oracleText, regenerateMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'regenerated',
      description: effectText,
      effect: effectText,
      mandatory: true,
    });
  }

  const commanderEtbMatch = oracleText.match(
    new RegExp(
      `when(?:ever)? your commander enters(?: the battlefield)?(?:\\s+or\\s+${ENTERS_OR_EVENT_SUFFIX})?,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (commanderEtbMatch && !triggers.some((trigger) => trigger.triggerType === 'commander_etb')) {
    const effectText = timingTriggerEffect(oracleText, commanderEtbMatch);
    if (effectText && !isSwallowedCompoundEnterEffect(effectText)) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'commander_etb',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const phasesInMatch = oracleText.match(/when(?:ever)? (?:~|this creature) phases in,?\s*([^.]+)/i);
  if (phasesInMatch && !triggers.some((trigger) => trigger.triggerType === 'phases_in')) {
    const effectText = timingTriggerEffect(oracleText, phasesInMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'phases_in',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anotherPermanentFaceUpMatch = oracleText.match(
    /whenever another permanent you control is turned face up,?\s*([^.]+)/i,
  );
  if (
    anotherPermanentFaceUpMatch &&
    !triggers.some((trigger) => trigger.triggerType === 'another_permanent_face_up')
  ) {
    const effectText = timingTriggerEffect(oracleText, anotherPermanentFaceUpMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_permanent_face_up',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantmentOrPermanentFaceUpMatch = oracleText.match(
    /whenever this enchantment or another permanent you control is turned face up,?\s*([^.]+)/i,
  );
  if (
    enchantmentOrPermanentFaceUpMatch &&
    !triggers.some((trigger) => trigger.triggerType === 'enchantment_or_permanent_turned_face_up')
  ) {
    const effectText = timingTriggerEffect(oracleText, enchantmentOrPermanentFaceUpMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enchantment_or_permanent_turned_face_up',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const faceDownControlledFaceUpMatch = oracleText.match(
    /whenever a face-down permanent you control is turned face up,?\s*([^.]+)/i,
  );
  if (
    faceDownControlledFaceUpMatch &&
    !triggers.some((trigger) => trigger.triggerType === 'face_down_controlled_turned_face_up')
  ) {
    const effectText = timingTriggerEffect(oracleText, faceDownControlledFaceUpMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'face_down_controlled_turned_face_up',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const namedOrAnotherPermanentFaceUpMatch = oracleText.match(
    new RegExp(
      `whenever (?:${etbAlternatives.join('|')}) or another permanent you control is turned face up,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedOrAnotherPermanentFaceUpMatch &&
    !triggers.some((trigger) => trigger.triggerType === 'named_or_another_permanent_face_up')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrAnotherPermanentFaceUpMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'named_or_another_permanent_face_up',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const selfOrAnotherPermanentFaceUpMatch = oracleText.match(
    /whenever this creature or another permanent is turned face up,?\s*([^.]+)/i,
  );
  if (
    selfOrAnotherPermanentFaceUpMatch &&
    !triggers.some((trigger) => trigger.triggerType === 'self_or_another_permanent_face_up')
  ) {
    const effectText = timingTriggerEffect(oracleText, selfOrAnotherPermanentFaceUpMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'self_or_another_permanent_face_up',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const controlledFaceUpMatch = oracleText.match(
    /whenever (?:this creature or another creature you control|a permanent you control) is turned face up,?\s*([^.]+)/i,
  );
  if (controlledFaceUpMatch && !triggers.some((trigger) => trigger.triggerType === 'controlled_permanent_face_up')) {
    const effectText = timingTriggerEffect(oracleText, controlledFaceUpMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'controlled_permanent_face_up',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anyPermanentFaceUpMatch = oracleText.match(/whenever a permanent is turned face up,?\s*([^.]+)/i);
  if (anyPermanentFaceUpMatch && !triggers.some((trigger) => trigger.triggerType === 'any_permanent_face_up')) {
    const effectText = timingTriggerEffect(oracleText, anyPermanentFaceUpMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'any_permanent_face_up',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedFaceUpMatch = oracleText.match(/when(?:ever)? enchanted creature is turned face up,?\s*([^.]+)/i);
  if (enchantedFaceUpMatch && !triggers.some((trigger) => trigger.triggerType === 'face_up')) {
    const effectText = timingTriggerEffect(oracleText, enchantedFaceUpMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'face_up',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const faceUpMatch = oracleText.match(faceUpPattern);
  if (faceUpMatch && !triggers.some((trigger) => trigger.triggerType === 'face_up')) {
    const effectText = timingTriggerEffect(oracleText, faceUpMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'face_up',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const etbOrAttackMatch = oracleText.match(etbOrAttackPattern);
  if (etbOrAttackMatch) {
    const effectText = timingTriggerEffect(oracleText, etbOrAttackMatch);
    const hasMatchingEtbEffect = triggers.some((trigger) =>
      (trigger.triggerType === 'etb' || trigger.triggerType === 'self_enters_or_attacks') &&
      String(trigger.effect || trigger.description || '').trim().toLowerCase() === effectText.toLowerCase()
    );

    if (effectText && !hasMatchingEtbEffect && !triggers.some((t) => t.triggerType === 'self_enters_or_attacks')) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'self_enters_or_attacks',
        description: effectText,
        effect: effectText,
        mandatory: true,
      });
    }
  }
  
  // "Whenever a creature enters the battlefield under your control" or "Whenever a nontoken creature enters..."
  // Note: New Bloomburrow template uses "enters" instead of "enters the battlefield"
  // Also handles "creature you control enters" (new template with "you control" before "enters")
  // Also handles plural forms: "creatures enter" / "creatures you control enter" (e.g., Satoru)
  // Handles: "a creature", "another creature", "one or more creatures", "other creatures"
  // IMPORTANT: Exclude opponent-controlled ETB templates (handled separately as opponent_creature_etb).
  // Without this guard, patterns like "Whenever a creature enters under an opponent's control, ..." can be
  // misclassified as generic creature_etb and then miss intervening-if context like "that player".
  const hasOpponentCreatureRestriction =
    /whenever (?:a|another) creature an opponent controls enters/i.test(oracleText) ||
    /\benters?(?: the battlefield)?\b[^.]{0,120}\bunder an opponent's control\b/i.test(oracleText) ||
    /\benters?(?: the battlefield)?\b[^.]{0,120}\bunder their control\b/i.test(oracleText);
  // Capture the required type phrase between the determiner (a/another/other/one or more) and "enters".
  // Examples captured: "creature", "nontoken creature", "token creature", "artifact creature", "Bear", "Assembly-Worker".
  const creatureETBMatch = oracleText.match(
    new RegExp(
      `when(?:ever)? (?:a|an(?:other)?|one or more(?: other)?|other) ([^,]+?) (?:you control )?(?:that [^,]+? )?(?:you control )?enters?(?: the battlefield)?(?: under your control)?(?:\\s+or\\s+[^,]+?)?(?:\\s+or\\s+${ENTERS_OR_EVENT_SUFFIX})?,?\\s*([^.]+)`,
      'i',
    ),
  );
  const thatPermanentEtbMatch = oracleText.match(
    /when that permanent enters(?: the battlefield)?,?\s*([^.]+)/i
  );
  if (thatPermanentEtbMatch && !triggers.some((t) => t.triggerType === 'another_permanent_etb' || t.triggerType === 'delayed_etb')) {
    const effectText = timingTriggerEffect(oracleText, thatPermanentEtbMatch);
    if (effectText) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'delayed_etb' as any,
        description: effectText,
        effect: effectText,
        mandatory: !lowerOracle.includes('you may'),
      });
    }
  }
  const chosenTypeEtbOrAttackMatch = oracleText.match(
    /whenever a creature you control of the chosen type enters or attacks,?\s*([^.]+)/i
  );
  const chosenTypeCreatureEtb = parseChosenTypeCreatureEtbTrigger(oracleText);
  if (
    chosenTypeCreatureEtb
    && !isSwallowedCompoundEnterEffect(chosenTypeCreatureEtb.effect)
    && !triggers.some((t) => t.triggerType === 'chosen_type_creature_etb')
    && !triggers.some((t) => t.triggerType === 'chosen_type_creature_etb_or_attack')
  ) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'chosen_type_creature_etb',
      description: chosenTypeCreatureEtb.effect,
      effect: chosenTypeCreatureEtb.effect,
      mandatory: chosenTypeCreatureEtb.mandatory,
      nontokenOnly: chosenTypeCreatureEtb.nontokenOnly,
      anotherOnly: chosenTypeCreatureEtb.anotherOnly,
      subjectKind: chosenTypeCreatureEtb.subjectKind,
    } as any);
  }

  if (chosenTypeEtbOrAttackMatch && !triggers.some((t) => t.triggerType === 'chosen_type_creature_etb_or_attack')) {
    const effectText = timingTriggerEffect(oracleText, chosenTypeEtbOrAttackMatch);
    if (effectText) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'chosen_type_creature_etb_or_attack',
        description: effectText,
        effect: effectText,
        mandatory: true,
      });
    }
  }

  if (creatureETBMatch && !hasOpponentCreatureRestriction && !triggers.some(t => t.triggerType === 'creature_etb')) {
    const requiredTypePhrase = creatureETBMatch[1].trim();
    const effectText = timingTriggerEffect(oracleText, creatureETBMatch, 2);
    // Land / land-subtype subjects belong to landfall detection, not creature_etb.
    // Otherwise Scute Swarm / Titania dual-classify and can double-fire on land-creatures.
    // Chosen-type "enters or attacks" is owned by chosen_type_creature_etb_or_attack.
    if (
      !isLandfallEtbSubjectPhrase(requiredTypePhrase)
      && !isSwallowedCompoundEnterEffect(effectText)
      && !/\bchosen type\b/i.test(requiredTypePhrase)
      && !triggers.some((t) => t.triggerType === 'chosen_type_creature_etb_or_attack')
      && !(/^\s*(?:nontoken\s+)?(?:artifact|enchantment|land|planeswalker|equipment|battle)s?\s*$/i.test(requiredTypePhrase))
    ) {
      const isNontokenOnly = /\b(?:nontoken|non-token)\b/i.test(requiredTypePhrase);
      const isTokenOnly = !isNontokenOnly && /\btoken\b/i.test(requiredTypePhrase);
      // Check if this trigger requires the creature to be controlled by the trigger's controller
      // Pattern: "you control" or "under your control" in the trigger text
      const hasControlRestriction = /creature(?:s)?\s+you\s+control|under your control/i.test(oracleText);
      const optionalTrigger = /\byou may\b/i.test(effectText);
      const t: TriggeredAbility = {
        permanentId,
        cardName,
        triggerType: 'creature_etb',
        description: effectText,
        effect: effectText,
        mandatory: !optionalTrigger,
        requiresChoice: optionalTrigger,
        nontokenOnly: isNontokenOnly,
        controlledOnly: hasControlRestriction,  // Flag for creatures that must be yours (e.g., Aura Shards)
      };
      (t as any).requiredTypePhrase = requiredTypePhrase;
      (t as any).tokenOnly = isTokenOnly;
      triggers.push(t);
    }
  }
  
  // "Whenever a nontoken Equipment you control enters" (Firion, Wild Rose Warrior)
  // Note: New Bloomburrow template uses "enters" instead of "enters the battlefield"
  // Also handles "equipment you control enters" (new template)
  // Also handles plural forms and "another"/"other" variants
  const equipmentETBMatch = oracleText.match(/whenever (?:a|an(?:other)?|one or more(?: other)?|other) (?:nontoken )?equipments? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/i);
  if (equipmentETBMatch && !triggers.some(t => t.triggerType === 'equipment_etb')) {
    const effectText = timingTriggerEffect(oracleText, equipmentETBMatch);
    const matchText = String(equipmentETBMatch[0] || '');
    const targetType = detectTargetType(effectText);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'equipment_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: /equipments?\s+you\s+control|under your control/i.test(matchText),
      nontokenOnly: /\b(?:nontoken|non-token)\b/i.test(matchText),
      requiresTarget: /\btarget\b/i.test(effectText) || !!targetType,
      targetType,
    });
  }
  
  // "Whenever an Artifact enters the battlefield under your control"
  // Also handles plural forms and "another"/"other" variants
  const artifactETBMatch = oracleText.match(
    new RegExp(
      `whenever (?:a|an(?:other)?|one or more(?: other)?|other) (?:nontoken )?artifacts? (?:you control )?enters?(?: the battlefield)?(?: under your control)?(?:\\s+or\\s+${ENTERS_OR_EVENT_SUFFIX})?,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (artifactETBMatch && !triggers.some(t => t.triggerType === 'artifact_etb')) {
    const effectText = timingTriggerEffect(oracleText, artifactETBMatch);
    if (effectText && !isSwallowedCompoundEnterEffect(effectText)) {
      const matchText = String(artifactETBMatch[0] || '');
      const targetType = detectTargetType(effectText);
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'artifact_etb',
        description: effectText,
        effect: effectText,
        mandatory: !effectText.toLowerCase().includes('you may'),
        controlledOnly: /artifacts?\s+you\s+control|under your control/i.test(matchText),
        nontokenOnly: /\b(?:nontoken|non-token)\b/i.test(matchText),
        requiresTarget: /\btarget\b/i.test(effectText) || !!targetType,
        targetType,
      });
    }
  }
  
  // "Whenever an Enchantment enters the battlefield under your control"
  // Also handles plural forms and "another"/"other" variants
  const enchantmentETBMatch = oracleText.match(/whenever (?:a|an(?:other)?|one or more(?: other)?|other) (?:nontoken )?enchantments? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/i);
  if (enchantmentETBMatch && !triggers.some(t => t.triggerType === 'enchantment_etb')) {
    const effectText = timingTriggerEffect(oracleText, enchantmentETBMatch);
    const matchText = String(enchantmentETBMatch[0] || '');
    const targetType = detectTargetType(effectText);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'enchantment_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: /enchantments?\s+you\s+control|under your control/i.test(matchText),
      nontokenOnly: /\b(?:nontoken|non-token)\b/i.test(matchText),
      requiresTarget: /\btarget\b/i.test(effectText) || !!targetType,
      targetType,
    });
  }

  // "Whenever a planeswalker you control enters" (Gatewatch Beacon, etc.)
  const planeswalkerETBMatch = oracleText.match(
    /whenever (?:a|an(?:other)?|one or more(?: other)?|other) planeswalkers? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/i,
  );
  if (planeswalkerETBMatch && !triggers.some((t) => t.triggerType === 'planeswalker_etb')) {
    const effectText = timingTriggerEffect(oracleText, planeswalkerETBMatch);
    const matchText = String(planeswalkerETBMatch[0] || '');
    const targetType = detectTargetType(effectText);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'planeswalker_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      controlledOnly: /planeswalkers?\s+you\s+control|under your control/i.test(matchText),
      nontokenOnly: /\b(?:nontoken|non-token)\b/i.test(matchText),
      requiresTarget: /\btarget\b/i.test(effectText) || !!targetType,
      targetType,
    });
  }
  
  // "Whenever you cast an Equipment spell" (for cast triggers vs ETB)
  const equipmentCastMatch = oracleText.match(/whenever you (?:cast|play) (?:a|an) equipment(?: spell)?,?\s*([^.]+)/i);
  if (equipmentCastMatch && !triggers.some(t => t.triggerType === 'equipment_cast')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'equipment_cast',
      description: timingTriggerEffect(oracleText, equipmentCastMatch),
      effect: timingTriggerEffect(oracleText, equipmentCastMatch),
      mandatory: !lowerOracle.includes('you may'),
    });
  }
  
  // "Whenever a legendary creature enters the battlefield under your control" (Hero's Blade, etc.)
  // This triggers when any legendary creature you control ETBs - used for auto-attach equipment
  const legendaryCreatureETBMatch = oracleText.match(/whenever (?:a|an(?:other)?) legendary creatures? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/i);
  if (legendaryCreatureETBMatch && !triggers.some(t => (t as any).triggerType === 'legendary_creature_etb')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'legendary_creature_etb' as any,
      description: timingTriggerEffect(oracleText, legendaryCreatureETBMatch),
      effect: timingTriggerEffect(oracleText, legendaryCreatureETBMatch),
      mandatory: !lowerOracle.includes('you may'),
      requiresChoice: lowerOracle.includes('you may'),
    });
  }
  
  // "Whenever another creature enters the battlefield" (Soul Warden, Auriok Champion, etc.)
  // This is CREATURE-ONLY - does NOT trigger on non-creature permanents like artifacts
  // NOTE: Soul Warden: "Whenever another creature enters the battlefield, you gain 1 life."
  // Auriok Champion: same trigger but optional ("you may gain 1 life"); protection from black/red is unrelated.
  // Supports both old template "enters the battlefield" and new Bloomburrow template "enters"
  // Also handles plural forms: "creatures enter" and "one or more other creatures enter"
  const anotherCreatureAnyETBMatch = oracleText.match(/whenever (?:another|one or more(?: other)?) (?:[\w\s]+)?creatures? enters?(?: the battlefield)?(?!.*under your control),?\s*([^.]+)/i);
  if (anotherCreatureAnyETBMatch && !triggers.some(t => t.triggerType === 'creature_etb')) {
    // Extract color qualifiers in the trigger clause only (e.g. "white creature"), not protection/reminder text.
    const colorRestrictionMatch = oracleText.match(/whenever (?:another|one or more(?: other)?) ([\w\s]+?) creatures? enters?/i);
    const rawColorRestriction = colorRestrictionMatch ? colorRestrictionMatch[1].trim().toLowerCase() : null;
    const colorRestriction = rawColorRestriction
      && rawColorRestriction !== 'another'
      && rawColorRestriction !== 'one or more'
      && rawColorRestriction !== 'creature'
      && /\b(white|blue|black|red|green|colorless)\b/.test(rawColorRestriction)
      ? rawColorRestriction
      : undefined;

    const effectClause = timingTriggerEffect(oracleText, anotherCreatureAnyETBMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_etb', // Use creature_etb so it only fires on creatures
      description: effectClause,
      effect: effectClause,
      mandatory: !/\byou may\b/i.test(effectClause),
      colorRestriction,
    } as any);
  }
  
  // "Whenever another permanent you control enters" - Altar of the Brood, etc.
  // This triggers on ANY permanent type (creature, artifact, enchantment, land, planeswalker) under YOUR control
  // Supports both old template "enters the battlefield" and new Bloomburrow template "enters"
  // Also handles plural forms
  // First check if there's a control restriction, then match the pattern
  const hasPermanentControlRestriction = /whenever (?:another|one or more(?: other)?) [\w\s]*permanents? (?:you control|under your control)/i.test(oracleText) ||
                                         /whenever (?:another|one or more(?: other)?) [\w\s]*permanents? (?:you control )?enters?(?: the battlefield)? under your control/i.test(oracleText);
  if (hasPermanentControlRestriction) {
    const anotherPermanentControlledETBMatch = oracleText.match(/whenever (?:another|one or more(?: other)?) (?:[\w\s]+)?permanents? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/i);
    if (anotherPermanentControlledETBMatch && !triggers.some(t => t.triggerType === 'another_permanent_etb')) {
      const effectClause = timingTriggerEffect(oracleText, anotherPermanentControlledETBMatch);
      const parsedMill = parseMillFromOracleText(effectClause);
      const millAmount = parsedMill && parsedMill.count > 0 ? parsedMill.count : undefined;
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'another_permanent_etb', // Triggers only on permanents you control
        description: effectClause,
        effect: effectClause,
        ...(millAmount != null ? { millAmount } : {}),
        mandatory: true,
      } as any);
    }
  }
  
  // "Whenever another permanent enters the battlefield" - ANY permanent from ANY player
  // This would be for cards that trigger on ANY permanent entering, regardless of controller
  // (Currently no known cards have this pattern, but included for completeness)
  // Explicitly check that it does NOT have "you control" or "under your control"
  // Supports both old template "enters the battlefield" and new Bloomburrow template "enters"
  // Also handles plural forms
  const anotherPermanentAnyETBMatch = oracleText.match(/whenever (?:another|one or more(?: other)?) (?:[\w\s]+)?permanents? enters?(?: the battlefield)?,?\s*([^.]+)/i);
  const hasNoControlRestriction = !/you control|under your control|an opponent controls|under an opponent's control/.test(oracleText);
  if (anotherPermanentAnyETBMatch && hasNoControlRestriction && !triggers.some(t => t.triggerType === 'permanent_etb')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'permanent_etb',
      description: timingTriggerEffect(oracleText, anotherPermanentAnyETBMatch),
      effect: timingTriggerEffect(oracleText, anotherPermanentAnyETBMatch),
      mandatory: true,
    } as any);
  }
  
  // "Whenever another creature enters the battlefield under your control" (Guide of Souls, etc.)
  // Also handles new Bloomburrow template: "another creature you control enters"
  // This is CREATURE-ONLY, triggers only on creatures YOU control
  // Also handles plural forms
  const anotherCreatureControlledETBMatch = oracleText.match(/whenever (?:another|one or more(?: other)?) (?:[\w\s]+)?creatures? (?:you control )?enters?(?: the battlefield)?(?: under your control)?,?\s*([^.]+)/i);
  // Ensure the pattern requires "under your control" or "you control" (oracleText is already lowercased)
  // oracleText is already lowercased - check for control restriction
  // Also handles plural forms
  const hasControlRestriction = /whenever (?:another|one or more(?: other)?) [\w\s]*creatures? (?:you control|under your control)/.test(oracleText) ||
                                 /whenever (?:another|one or more(?: other)?) [\w\s]*creatures? (?:you control )?enters?(?: the battlefield)? under your control/.test(oracleText);
  if (anotherCreatureControlledETBMatch && hasControlRestriction && !triggers.some(t => t.triggerType === 'another_permanent_etb' || t.triggerType === 'creature_etb')) {
    // Extract color qualifiers in the trigger clause only (e.g. "white creature").
    const colorRestrictionMatch = oracleText.match(/whenever (?:another|one or more(?: other)?) ([\w\s]+?) creatures?/i);
    const rawColorRestriction = colorRestrictionMatch ? colorRestrictionMatch[1].trim().toLowerCase() : null;
    const colorRestriction = rawColorRestriction
      && rawColorRestriction !== 'another'
      && rawColorRestriction !== 'one or more'
      && rawColorRestriction !== 'creature'
      && /\b(white|blue|black|red|green|colorless)\b/.test(rawColorRestriction)
      ? rawColorRestriction
      : undefined;

    const effectText = timingTriggerEffect(oracleText, anotherCreatureControlledETBMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'another_permanent_etb', // This is controlled creature, so another_permanent_etb is appropriate
      description: effectText,
      effect: effectText,
      mandatory: !/\byou may\b/i.test(effectText),
      colorRestriction,
      creatureOnly: true, // Flag to indicate this only triggers on creatures
    } as any);
  }
  
  const flyingControlledETBMatch = oracleText.match(
    /whenever (?:~|this creature) or another creature you control with flying enters(?: the battlefield)?,?\s*([^.]+)/i,
  );
  if (flyingControlledETBMatch && !triggers.some((t) => t.triggerType === 'flying_controlled_etb')) {
    const effectText = timingTriggerEffect(oracleText, flyingControlledETBMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'flying_controlled_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    } as any);
  }

  const opponentLandETBMatch = oracleText.match(
    /whenever a land (?:an opponent controls enters|enters(?: the battlefield)?(?: under)? an opponent'?s control),?\s*([^.]+)/i,
  );
  if (opponentLandETBMatch && !triggers.some((t) => t.triggerType === 'opponent_land_etb')) {
    const effectText = timingTriggerEffect(oracleText, opponentLandETBMatch);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_land_etb',
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
    } as any);
  }

  // "Whenever a creature an opponent controls enters" (Suture Priest second ability)
  // This triggers when OPPONENTS' creatures enter the battlefield
  // Also handles plural forms
  const opponentCreatureETBMatch = oracleText.match(/whenever (?:a|another|one or more(?: other)?) (?:[\w\s]+)?creatures? (?:an opponent controls )?enters?(?: the battlefield)?(?: under (?:an opponent's|their) control)?,?\s*([^.]+)/i);
  // oracleText is already lowercased
  const hasOpponentRestriction = /creatures? (?:an opponent controls|under an opponent's control)/.test(oracleText) ||
                                  /creatures? enters?(?: the battlefield)? under (?:an opponent's|their) control/.test(oracleText);
  if (opponentCreatureETBMatch && hasOpponentRestriction && !triggers.some(t => t.triggerType === 'opponent_creature_etb')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'opponent_creature_etb', // New type for opponent creature ETB
      description: timingTriggerEffect(oracleText, opponentCreatureETBMatch),
      effect: timingTriggerEffect(oracleText, opponentCreatureETBMatch),
      mandatory: !opponentCreatureETBMatch[1].toLowerCase().includes('you may'),
    } as any);
  }
  
  // "As [this] enters the battlefield, choose" - Modal permanents like Outpost Siege
  // Pattern: "As ~ enters the battlefield, choose Khans or Dragons."
  // Supports both old template "enters the battlefield" and new Bloomburrow template "enters"
  const modalETBMatch = oracleText.match(/as (?:~|this (?:creature|permanent|enchantment)) enters(?: the battlefield)?,?\s*choose\s+([^.]+)/i);
  if (modalETBMatch && !isEtbCreatureTypeChoiceOracle(oracleText)) {
    const choiceText = modalETBMatch[1].trim();
    // Parse the options (usually "X or Y" pattern)
    const options = choiceText.split(/\s+or\s+/i).map(opt => opt.trim().replace(/[.,]$/, ''));
    
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'etb_modal_choice',
      description: `Choose: ${options.join(' or ')}`,
      effect: choiceText,
      mandatory: true,
      requiresChoice: true,
      modalOptions: options,
    } as any);
  }
  
  // Job Select (Final Fantasy set) - When this Equipment enters, create a 1/1 colorless Hero creature token, then attach this to it.
  // Pattern: "Job select" or "job select" (keyword)
  // Only Job Select keyword or explicit Hero-token living-weapon-style reminder.
  // Do NOT treat "create a … Soldier/Rebel/… token, then attach" as Job Select
  // (Midnight Angel Armor / For Mirrodin! / generic equipment ETBs).
  const hasJobSelect = lowerOracle.includes('job select') ||
    (/create a 1\/1 colorless hero creature token/i.test(oracleText) &&
      /attach this(?: equipment)? to it/i.test(oracleText));
  if (hasJobSelect && !triggers.some(t => t.triggerType === 'job_select')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'job_select',
      description: 'Create a 1/1 colorless Hero creature token, then attach this Equipment to it.',
      effect: 'create_hero_token_and_attach',
      mandatory: true,
      tokenInfo: {
        name: 'Hero',
        power: 1,
        toughness: 1,
        types: ['Creature'],
        subtypes: ['Hero'],
        colors: [], // colorless
      },
    } as any);
  }
  
  // Living Weapon (Phyrexia) - When this Equipment enters, create a 0/0 black Phyrexian Germ creature token, then attach this to it.
  // Pattern: "Living weapon" (keyword)
  const hasLivingWeapon = lowerOracle.includes('living weapon') ||
    (lowerOracle.includes('create') && lowerOracle.includes('germ') && lowerOracle.includes('token') && lowerOracle.includes('attach'));
  if (hasLivingWeapon && !triggers.some(t => t.triggerType === 'living_weapon')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'living_weapon',
      description: 'Create a 0/0 black Phyrexian Germ creature token, then attach this Equipment to it.',
      effect: 'create_germ_token_and_attach',
      mandatory: true,
      tokenInfo: {
        name: 'Phyrexian Germ',
        power: 0,
        toughness: 0,
        types: ['Creature'],
        subtypes: ['Phyrexian', 'Germ'],
        colors: ['B'], // black
      },
    } as any);
  }
  
  // Hideaway - When land enters, look at top N cards, exile one face-down, put rest on bottom
  // Pattern: "Hideaway N" keyword or oracle text
  const hideawayInfo = detectHideawayAbility(card);
  if (hideawayInfo && !triggers.some(t => t.triggerType === 'hideaway_etb')) {
    for (let i = triggers.length - 1; i >= 0; i--) {
      const existing = triggers[i];
      if (
        (existing.triggerType === 'etb' || existing.triggerType === 'self_enters_or_attacks')
        && isHideawayLookEffectText(String(existing.effect || existing.description || ''))
      ) {
        triggers.splice(i, 1);
      }
    }
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'hideaway_etb',
      description: `Look at the top ${hideawayInfo.hideawayCount} cards of your library, exile one face down, then put the rest on the bottom in a random order.`,
      effect: 'hideaway_exile',
      mandatory: true,
      hideawayCount: hideawayInfo.hideawayCount,
      hideawayCondition: hideawayInfo.condition,
    } as any);
  }
  
  return triggers;
}

/**
 * Check if a permanent has ETB triggers that should fire when a permanent enters
 */
export function getETBTriggersForPermanent(card: any, permanent: any): TriggeredAbility[] {
  return detectETBTriggers(card, permanent);
}

/**
 * Check if a creature has flying or other evasion
 */
export function hasEvasionAbility(card: any): { flying: boolean; menace: boolean; trample: boolean; unblockable: boolean; shadow: boolean; horsemanship: boolean; fear: boolean; intimidate: boolean; skulk: boolean } {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const rawKeywords = card?.keywords;
  // Defensive: ensure keywords is an array
  const keywords = Array.isArray(rawKeywords) 
    ? rawKeywords.filter((k: any) => typeof k === 'string')
    : [];
  
  const checkKeyword = (kw: string) => 
    keywords.some((k: string) => k.toLowerCase() === kw.toLowerCase()) || oracleText.includes(kw.toLowerCase());
  
  return {
    flying: checkKeyword("Flying"),
    menace: checkKeyword("Menace"),
    trample: checkKeyword("Trample"),
    unblockable: oracleText.includes("can't be blocked") || oracleText.includes("unblockable"),
    shadow: checkKeyword("Shadow"),
    horsemanship: checkKeyword("Horsemanship"),
    fear: checkKeyword("Fear"),
    intimidate: checkKeyword("Intimidate"),
    skulk: checkKeyword("Skulk"),
  };
}

/**
 * Detect untap triggers from permanents on the battlefield
 * Used for Bear Umbra, Nature's Will, Sword of Feast and Famine, etc.
 */
export interface UntapTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerOn: string;
  untapType: string;
  effect: string;
}

export function detectUntapTriggers(card: any, permanent: any): UntapTrigger[] {
  const triggers: UntapTrigger[] = [];
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // Check known untap trigger cards
  for (const [knownName, info] of Object.entries(KNOWN_UNTAP_TRIGGERS)) {
    if (lowerName.includes(knownName)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        triggerOn: info.triggerOn,
        untapType: info.untapType,
        effect: info.effect,
      });
    }
  }
  
  // Generic detection: "Whenever enchanted creature attacks, untap all lands you control"
    const attackUntapLandsMatch = oracleText.match(/whenever (?:this creature|enchanted creature|equipped creature|~) attacks,?\s*(?:[^.]*)?untap all lands you control/i);
  if (attackUntapLandsMatch && !triggers.some(t => t.triggerOn === 'attack' && t.untapType === 'lands')) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerOn: 'attack',
      untapType: 'lands',
      effect: 'Untap all lands you control',
    });
  }
  
  // Generic detection: "Whenever ~ deals combat damage to a player, untap all lands you control"
    const combatDamageUntapMatch = oracleText.match(/whenever (?:this creature|~|enchanted creature|equipped creature) deals combat damage to (?:a player|an opponent),?\s*(?:[^.]*)?untap all lands you control/i);
  if (combatDamageUntapMatch && !triggers.some(t => t.triggerOn === 'combat_damage' && t.untapType === 'lands')) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerOn: 'combat_damage',
      untapType: 'lands',
      effect: 'Untap all lands you control',
    });
  }

  const untapStepMatch = oracleText.match(
    /whenever you untap one or more permanents during your untap step,?\s*([^.]+)/i,
  );
  if (untapStepMatch && !triggers.some((t) => t.triggerOn === 'untap_step')) {
    const effectText = timingTriggerEffect(oracleText, untapStepMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerOn: 'untap_step',
      untapType: 'controlled_permanent',
      effect: effectText,
    });
  }

  const controlledPermanentUntapMatch = oracleText.match(
    /whenever a permanent you control becomes untapped,?\s*([^.]+)/i,
  );
  if (
    controlledPermanentUntapMatch &&
    !triggers.some((t) => t.triggerOn === 'untap' && t.untapType === 'controlled_permanent')
  ) {
    const effectText = timingTriggerEffect(oracleText, controlledPermanentUntapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerOn: 'untap',
      untapType: 'controlled_permanent',
      effect: effectText,
    });
  }

  const permanentUntapMatch = oracleText.match(/whenever a permanent becomes untapped,?\s*([^.]+)/i);
  if (permanentUntapMatch && !triggers.some((t) => t.triggerOn === 'untap' && t.untapType === 'permanent')) {
    const effectText = timingTriggerEffect(oracleText, permanentUntapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerOn: 'untap',
      untapType: 'permanent',
      effect: effectText,
    });
  }

  const selfBecomesUntappedMatch = oracleText.match(
    /when this creature becomes untapped(?: or you lose control of this creature)?,?\s*([^.]+)/i,
  );
  if (selfBecomesUntappedMatch && !triggers.some((t) => t.triggerOn === 'untap' && t.untapType === 'self')) {
    const effectText = timingTriggerEffect(oracleText, selfBecomesUntappedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerOn: 'untap',
      untapType: 'self',
      effect: effectText,
    });
  }

  const equippedUntapMatch = oracleText.match(/whenever equipped creature becomes untapped,?\s*([^.]+)/i);
  if (equippedUntapMatch && !triggers.some((t) => t.triggerOn === 'untap' && t.untapType === 'equipped_creature')) {
    const effectText = timingTriggerEffect(oracleText, equippedUntapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerOn: 'untap',
      untapType: 'equipped_creature',
      effect: effectText,
    });
  }

  const selfUntapNameRefs = [
    '~',
    'this creature',
    'this permanent',
    'this artifact',
    'this land',
    ...buildCardNameRegexAlternatives(cardName).map((name) => name.toLowerCase()),
  ];
  const selfUntapPattern = new RegExp(
    `whenever (?:${selfUntapNameRefs.join('|')}) become(?:s)? untapped,?\\s*([^.]+)`,
    'i',
  );
  const selfUntapMatch = oracleText.match(selfUntapPattern);
  if (selfUntapMatch && !triggers.some((t) => t.triggerOn === 'untap' && t.untapType === 'self')) {
    const effectText = timingTriggerEffect(oracleText, selfUntapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerOn: 'untap',
      untapType: 'self',
      effect: effectText,
    });
  }

  const namedOrMvCreatureUntapMatch = oracleText.match(
    new RegExp(
      `whenever (?:${selfUntapNameRefs.join('|')}) or another creature you control with mana value (?:\\d+|[\\w]+) or greater becomes untapped,?\\s*([^.]+)`,
      'i',
    ),
  );
  if (
    namedOrMvCreatureUntapMatch &&
    !triggers.some((t) => t.triggerOn === 'untap' && t.untapType === 'named_or_mv_creature')
  ) {
    const effectText = timingTriggerEffect(oracleText, namedOrMvCreatureUntapMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      triggerOn: 'untap',
      untapType: 'named_or_mv_creature',
      effect: effectText,
    });
  }

  return triggers;
}

/**
 * Interface for equipment/aura attack triggers
 */
export interface AttachmentAttackTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  attachedToId: string;
  triggerType: 'attack' | 'combat_damage' | 'damage_to_player';
  effect: string;
  mandatory: boolean;
  // Specific effects
  searchesLibrary?: boolean;
  searchType?: 'basic_land' | 'land' | 'creature' | 'any';
  causesDiscard?: boolean;
  untapsLands?: boolean;
  drawsCards?: boolean;
  exilesCards?: boolean;
  createsToken?: boolean;
  // For Spirit Loop-style effects that trigger on any damage (not just combat)
  anyDamage?: boolean;
}

/**
 * Detect attack/combat damage triggers from equipment and auras
 * This handles cards like Sword of the Animist, Sword of Feast and Famine, etc.
 */
export function detectAttachmentAttackTriggers(card: any, permanent: any): AttachmentAttackTrigger[] {
  const triggers: AttachmentAttackTrigger[] = [];
  const oracleText = card?.oracle_text || "";
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  const attachedToId = permanent?.attachedTo || "";
  
  // Skip if not attached to anything
  if (!attachedToId) return triggers;
  
  // Pattern: "Whenever equipped creature attacks, ..."
  // Also supports "Whenever this creature or equipped creature attacks, ..."
  const equipAttackMatch = oracleText.match(/whenever (?:this creature or )?equipped creature attacks,?\s*([^\n]+)/i);
  if (equipAttackMatch) {
    const effectText = timingTriggerEffect(oracleText, equipAttackMatch);
    const lowerEffect = effectText.toLowerCase();
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      attachedToId,
      triggerType: 'attack',
      effect: effectText,
      mandatory: !lowerEffect.includes('you may'),
      searchesLibrary: lowerEffect.includes('search') && lowerEffect.includes('library'),
      searchType: lowerEffect.includes('basic land') ? 'basic_land' : 
                  lowerEffect.includes('land') ? 'land' : undefined,
      createsToken: /\bcreate\b.*\btoken\b/i.test(effectText),
    });
  }
  
  // Pattern: "Whenever enchanted creature attacks, ..."
  // Also supports granted quoted text on attached auras: "Whenever this creature attacks, ..."
  const auraAttackMatch = oracleText.match(/whenever (?:enchanted creature|this creature) attacks,?\s*([^.]+)/i);
  if (auraAttackMatch) {
    const effectText = timingTriggerEffect(oracleText, auraAttackMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      attachedToId,
      triggerType: 'attack',
      effect: effectText,
      mandatory: !effectText.includes('you may'),
      searchesLibrary: effectText.includes('search') && effectText.includes('library'),
      createsToken: effectText.includes('create') && effectText.includes('token'),
    });
  }
  
  const equipAnyCombatDamageMatch = oracleText.match(/whenever equipped creature deals combat damage(?! to),?\s*([^.]+)/i);
  if (equipAnyCombatDamageMatch) {
    const effectText = timingTriggerEffect(oracleText, equipAnyCombatDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      attachedToId,
      triggerType: 'combat_damage',
      effect: effectText,
      mandatory: !effectText.includes('you may'),
    });
  }

  // Pattern: "Whenever equipped creature deals combat damage to a player, ..."
  const equipDamageMatch = oracleText.match(/whenever equipped creature deals combat damage to (?:a player|an opponent),?\s*([^.]+)/i);
  if (equipDamageMatch) {
    const effectText = timingTriggerEffect(oracleText, equipDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      attachedToId,
      triggerType: 'combat_damage',
      effect: effectText,
      mandatory: !effectText.includes('you may'),
      causesDiscard: effectText.includes('discard'),
      untapsLands: effectText.includes('untap') && effectText.includes('land'),
      drawsCards: effectText.includes('draw'),
      exilesCards: effectText.includes('exile'),
    });
  }
  
  const enchantedDefendingPlayerMatch = oracleText.match(
    /whenever enchanted creature deals combat damage to defending player,?\s*([^.]+)/i,
  );
  if (enchantedDefendingPlayerMatch) {
    const effectText = timingTriggerEffect(oracleText, enchantedDefendingPlayerMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      attachedToId,
      triggerType: 'combat_damage',
      effect: effectText,
      mandatory: !effectText.includes('you may'),
    });
  }

  // Pattern: "Whenever enchanted creature deals combat damage to a player, ..."
  // Also matches "Whenever enchanted creature deals damage to a player, ..." (Spirit Loop)
  const auraDamageMatch = oracleText.match(/whenever enchanted creature deals (?:combat )?damage to (?:a player|an opponent),?\s*([^.]+)/i);
  if (auraDamageMatch) {
    const effectText = timingTriggerEffect(oracleText, auraDamageMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      attachedToId,
      triggerType: 'combat_damage',
      effect: effectText,
      mandatory: !effectText.includes('you may'),
      causesDiscard: effectText.includes('discard'),
      drawsCards: effectText.includes('draw'),
      exilesCards: effectText.includes('exile'),
      // Track if this is specifically combat damage or any damage
      anyDamage: !lowerOracle.includes('combat damage'),
    });
  }
  
  return triggers;
}

/**
 * Get all equipment/aura triggers that fire when an equipped/enchanted creature attacks
 */
export function getAttachmentAttackTriggers(
  ctx: GameContext,
  attackingCreature: any,
  attackingController: string
): AttachmentAttackTrigger[] {
  const triggers: AttachmentAttackTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  // Find all equipment/auras attached to the attacking creature
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const typeLine = (permanent.card.type_line || '').toLowerCase();
    const isEquipment = typeLine.includes('equipment');
    const isAura = typeLine.includes('aura');
    
    if (!isEquipment && !isAura) continue;
    
    // Check if attached to the attacking creature
    if (permanent.attachedTo !== attackingCreature.id) continue;
    
    // Detect triggers from this equipment/aura
    const attachmentTriggers = detectAttachmentAttackTriggers(permanent.card, permanent);
    for (const trigger of attachmentTriggers) {
      if (trigger.triggerType === 'attack') {
        triggers.push(trigger);
      }
    }
  }
  
  return triggers;
}

/**
 * Get all equipment/aura triggers that fire when equipped creature deals combat damage
 */
export function getAttachmentCombatDamageTriggers(
  ctx: GameContext,
  attackingCreature: any,
  attackingController: string
): AttachmentAttackTrigger[] {
  const triggers: AttachmentAttackTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  // Find all equipment/auras attached to the attacking creature
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const typeLine = (permanent.card.type_line || '').toLowerCase();
    const isEquipment = typeLine.includes('equipment');
    const isAura = typeLine.includes('aura');
    
    if (!isEquipment && !isAura) continue;
    
    // Check if attached to the attacking creature
    if (permanent.attachedTo !== attackingCreature.id) continue;
    
    // Detect triggers from this equipment/aura
    const attachmentTriggers = detectAttachmentAttackTriggers(permanent.card, permanent);
    for (const trigger of attachmentTriggers) {
      if (trigger.triggerType === 'combat_damage' || trigger.triggerType === 'damage_to_player') {
        triggers.push(trigger);
      }
    }
  }
  
  return triggers;
}

/**
 * Get all untap triggers that should fire when a creature attacks
 */
export function getAttackUntapTriggers(
  ctx: GameContext,
  attackingCreature: any,
  attackingController: string
): UntapTrigger[] {
  const triggers: UntapTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  // Check the attacking creature itself
  const selfTriggers = detectUntapTriggers(attackingCreature.card, attackingCreature);
  for (const trigger of selfTriggers) {
    if (trigger.triggerOn === 'attack') {
      triggers.push(trigger);
    }
  }
  
  // Check auras/equipment attached to the attacking creature
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== attackingController) continue;
    
    const typeLine = (permanent.card?.type_line || '').toLowerCase();
    const isAura = typeLine.includes('aura');
    const isEquipment = typeLine.includes('equipment');
    
    if (isAura || isEquipment) {
      // Check if this is attached to the attacking creature
      const attachedTo = permanent.attachedTo;
      if (attachedTo === attackingCreature.id) {
        const attachmentTriggers = detectUntapTriggers(permanent.card, permanent);
        for (const trigger of attachmentTriggers) {
          if (trigger.triggerOn === 'attack') {
            triggers.push(trigger);
          }
        }
      }
    }
  }
  
  return triggers;
}

/**
 * Get all untap triggers that should fire when a creature deals combat damage to a player
 */
export function getCombatDamageUntapTriggers(
  ctx: GameContext,
  attackingCreature: any,
  attackingController: string
): UntapTrigger[] {
  const triggers: UntapTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  // Check the attacking creature itself
  const selfTriggers = detectUntapTriggers(attackingCreature.card, attackingCreature);
  for (const trigger of selfTriggers) {
    if (trigger.triggerOn === 'combat_damage' || trigger.triggerOn === 'damage_to_player') {
      triggers.push(trigger);
    }
  }
  
  // Check auras/equipment attached to the attacking creature
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== attackingController) continue;
    
    const typeLine = (permanent.card?.type_line || '').toLowerCase();
    const isAura = typeLine.includes('aura');
    const isEquipment = typeLine.includes('equipment');
    
    if (isAura || isEquipment) {
      const attachedTo = permanent.attachedTo;
      if (attachedTo === attackingCreature.id) {
        const attachmentTriggers = detectUntapTriggers(permanent.card, permanent);
        for (const trigger of attachmentTriggers) {
          if (trigger.triggerOn === 'combat_damage' || trigger.triggerOn === 'damage_to_player') {
            triggers.push(trigger);
          }
        }
      }
    }
  }
  
  return triggers;
}

/**
 * Execute an untap trigger effect
 */
export function executeUntapTrigger(
  ctx: GameContext,
  trigger: UntapTrigger
): void {
  const battlefield = ctx.state?.battlefield || [];
  
  debug(2, `[executeUntapTrigger] ${trigger.cardName}: ${trigger.effect}`);
  
  switch (trigger.untapType) {
    case 'lands':
      // Untap all lands the controller owns
      for (const permanent of battlefield) {
        if (!permanent || permanent.controller !== trigger.controllerId) continue;
        const typeLine = (permanent.card?.type_line || '').toLowerCase();
        if (typeLine.includes('land') && permanent.tapped) {
          permanent.tapped = false;
          debug(2, `[executeUntapTrigger] Untapped ${permanent.card?.name || permanent.id}`);
        }
      }
      break;
      
    case 'creatures':
      // Untap all creatures the controller owns
      for (const permanent of battlefield) {
        if (!permanent || permanent.controller !== trigger.controllerId) continue;
        const typeLine = (permanent.card?.type_line || '').toLowerCase();
        if (typeLine.includes('creature') && permanent.tapped) {
          permanent.tapped = false;
          debug(2, `[executeUntapTrigger] Untapped ${permanent.card?.name || permanent.id}`);
        }
      }
      break;
      
    case 'all':
      // Untap all permanents the controller owns
      for (const permanent of battlefield) {
        if (!permanent || permanent.controller !== trigger.controllerId) continue;
        if (permanent.tapped) {
          permanent.tapped = false;
          debug(2, `[executeUntapTrigger] Untapped ${permanent.card?.name || permanent.id}`);
        }
      }
      break;
  }
  
  ctx.bumpSeq();
}

/**
 * Check if a creature has firebreathing or similar pump abilities
 */
export function detectPumpAbilities(card: any): { cost: string; effect: string }[] {
  const abilities: { cost: string; effect: string }[] = [];
  const oracleText = card?.oracle_text || "";
  
  // Firebreathing: {R}: +1/+0
  const firebreathingMatch = oracleText.match(/\{R\}:\s*(?:~|this creature)\s+gets?\s+\+1\/\+0/i);
  if (firebreathingMatch || oracleText.toLowerCase().includes("firebreathing")) {
    abilities.push({ cost: "{R}", effect: "+1/+0 until end of turn" });
  }
  
  // Shade: {B}: +1/+1
  const shadeMatch = oracleText.match(/\{B\}:\s*(?:~|this creature)\s+gets?\s+\+1\/\+1/i);
  if (shadeMatch) {
    abilities.push({ cost: "{B}", effect: "+1/+1 until end of turn" });
  }
  
  // Generic pump: {X}: +N/+M
  const pumpMatches = oracleText.matchAll(/(\{[^}]+\}):\s*(?:~|this creature)\s+gets?\s+(\+\d+\/\+\d+)/gi);
  for (const match of pumpMatches) {
    if (!abilities.some(a => a.cost === match[1])) {
      abilities.push({ cost: match[1], effect: `${match[2]} until end of turn` });
    }
  }
  
  return abilities;
}

/**
 * Process death triggers when a creature dies
 */
export function getDeathTriggersForCreature(
  ctx: GameContext, 
  dyingPermanent: any,
  dyingController: string
): TriggeredAbility[] {
  return getDeathTriggers(ctx, dyingPermanent, dyingController).map((result) => ({
    permanentId: result.source.permanentId,
    cardName: result.source.cardName,
    triggerType: result.triggerType || 'creature_dies',
    description: result.effect,
    effect: result.effect,
    mandatory: true,
    controllerId: result.source.controllerId,
    ...(typeof result.referenceAmount === 'number' ? { value: result.referenceAmount } : null),
  }));
}

/**
 * Process attack triggers when creatures attack
 */
export function getAttackTriggersForCreatures(
  ctx: GameContext,
  attackingCreatures: any[],
  attackingPlayer: string,
  defendingPlayer: string
): TriggeredAbility[] {
  const triggers: TriggeredAbility[] = [];
  const battlefield = ctx.state?.battlefield || [];
  const playerIds = Array.isArray((ctx as any).state?.players)
    ? (ctx as any).state.players.map((p: any) => String(p?.id || '')).filter(Boolean)
    : [];

  const getDefendingPlayerIdForAttacker = (attacker: any): string => {
    const attacking = typeof attacker?.attacking === 'string' ? String(attacker.attacking) : '';
    if (attacking && playerIds.includes(attacking)) return attacking;
    return String(defendingPlayer || '');
  };
  
  // Check each attacking creature for attack triggers
  for (const attacker of attackingCreatures) {
    const attackerTriggers = detectAttackTriggers(attacker.card, attacker);
    const selfEtbTriggers = detectETBTriggers(attacker.card, attacker).filter(
      (trigger) => trigger.triggerType === 'self_enters_or_attacks',
    );
    const defendingPlayerId = getDefendingPlayerIdForAttacker(attacker);
    for (const trigger of [...attackerTriggers, ...selfEtbTriggers]) {
      if (trigger.triggerType === 'one_or_more_enchanted_by_aura_you_control_attack') continue;
      if (trigger.triggerType === 'player_attacks_your_opponent') continue;
      // Preserve target player context for "that player" intervening-if templates.
      const existingValue = (trigger as any).value;
      const mergedValue =
        existingValue && typeof existingValue === 'object'
          ? { ...existingValue, defendingPlayerId, defendingPlayer: defendingPlayerId, attackingCreatureId: attacker.id }
          : { defendingPlayerId, defendingPlayer: defendingPlayerId, attackingCreatureId: attacker.id };
      triggers.push({ ...(trigger as any), value: mergedValue } as any);
    }
  }
  
  const attackedPlayerIds = Array.from(new Set(
    attackingCreatures.map((attacker: any) => getDefendingPlayerIdForAttacker(attacker)).filter(Boolean),
  ));
  if (attackedPlayerIds.length === 0 && defendingPlayer) {
    attackedPlayerIds.push(String(defendingPlayer));
  }

  // Check all permanents for "whenever a creature you control attacks" triggers
  for (const permanent of battlefield) {
    if (!permanent) continue;
    const isAttackingController = permanent.controller === attackingPlayer;
    
    const permTriggers = detectAttackTriggers(permanent.card, permanent);
    for (const trigger of permTriggers) {
      if (trigger.triggerType === 'player_attacks_your_opponent') {
        const sourceController = String((trigger as any).controllerId || permanent.controller || '');
        for (const attackedId of attackedPlayerIds) {
          if (!attackedId || attackedId === sourceController) continue;
          const existingValue = (trigger as any).value;
          const mergedValue =
            existingValue && typeof existingValue === 'object'
              ? { ...existingValue, defendingPlayerId: attackedId, defendingPlayer: attackedId, attackingPlayerId: attackingPlayer }
              : { defendingPlayerId: attackedId, defendingPlayer: attackedId, attackingPlayerId: attackingPlayer };
          triggers.push({ ...(trigger as any), value: mergedValue } as any);
        }
        continue;
      }
      if (!isAttackingController) continue;
      if (trigger.triggerType === 'creature_attacks') {
        // Trigger once for each attacking creature
        for (const attacker of attackingCreatures) {
          const defendingPlayerId = getDefendingPlayerIdForAttacker(attacker);
          const existingValue = (trigger as any).value;
          const mergedValue =
            existingValue && typeof existingValue === 'object'
              ? { ...existingValue, defendingPlayerId, defendingPlayer: defendingPlayerId, attackingCreatureId: attacker.id }
              : { defendingPlayerId, defendingPlayer: defendingPlayerId, attackingCreatureId: attacker.id };
          triggers.push({ ...(trigger as any), value: mergedValue } as any);
        }
      }
      if (trigger.triggerType === 'one_or_more_enchanted_by_aura_you_control_attack') {
        const anyEnchanted = attackingCreatures.some((attacker: any) =>
          isEnchantedByAuraYouControl(
            battlefield,
            String(attacker?.id || ''),
            String(permanent?.controller || attackingPlayer),
          ),
        );
        if (anyEnchanted) {
          triggers.push(trigger);
        }
      }
      if (trigger.triggerType === 'chosen_type_creature_etb_or_attack') {
        const chosenType = String((permanent as any)?.chosenCreatureType || '').trim();
        if (!chosenType) continue;
        for (const attacker of attackingCreatures) {
          if (!permanentHasCreatureTypeNow(attacker, chosenType)) continue;
          const defendingPlayerId = getDefendingPlayerIdForAttacker(attacker);
          const existingValue = (trigger as any).value;
          const mergedValue =
            existingValue && typeof existingValue === 'object'
              ? { ...existingValue, defendingPlayerId, defendingPlayer: defendingPlayerId, attackingCreatureId: attacker.id }
              : { defendingPlayerId, defendingPlayer: defendingPlayerId, attackingCreatureId: attacker.id };
          triggers.push({ ...(trigger as any), value: mergedValue } as any);
        }
      }
      
      if (trigger.triggerType === 'you_attack' && attackingCreatures.length > 0) {
        // "Whenever you attack, ..." — fires once when this player declares one or more attackers.
        triggers.push(trigger);
      }
      if (trigger.triggerType === 'exalted' && attackingCreatures.length === 1) {
        // Exalted only triggers when attacking alone
        triggers.push(trigger);
      }
    }
  }
  
  // Check for equipment/aura attack triggers on each attacking creature
  for (const attacker of attackingCreatures) {
    const attachmentTriggers = getAttachmentAttackTriggers(ctx, attacker, attackingPlayer);
    for (const attachTrigger of attachmentTriggers) {
      // Convert attachment trigger to TriggeredAbility format
      triggers.push({
        permanentId: attachTrigger.permanentId,
        cardName: attachTrigger.cardName,
        description: attachTrigger.effect,
        triggerType: 'equipment_attack',
        mandatory: attachTrigger.mandatory,
        value: {
          attachedToId: attachTrigger.attachedToId,
          searchesLibrary: attachTrigger.searchesLibrary,
          searchType: attachTrigger.searchType,
          createsToken: attachTrigger.createsToken,
        },
      });
    }
  }
  
  return triggers;
}

/**
 * Handle undying/persist return from graveyard
 */
export function processUndyingPersist(
  ctx: GameContext,
  card: any,
  owner: string,
  ability: 'undying' | 'persist'
): void {
  const battlefield = ctx.state?.battlefield || [];
  const counterType = ability === 'undying' ? '+1/+1' : '-1/-1';
  
  // Create permanent on battlefield with counter
  const newPermanent = {
    id: `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    controller: owner,
    owner: owner,
    tapped: false,
    counters: { [counterType]: 1 },
    card: { ...card, zone: "battlefield" },
    returnedWith: ability,
  };
  
  battlefield.push(newPermanent as any);
  ctx.bumpSeq();
}


// ============================================================================
// Death Trigger System
// ============================================================================

export interface DeathTriggerResult {
  source: {
    permanentId: string;
    cardName: string;
    controllerId: string;
    /** True when the trigger source is an emblem (not a battlefield permanent). */
    isEmblem?: boolean;
  };
  effect: string;
  targets?: string[]; // Player IDs affected
  requiresChoice?: boolean;
  modalOptions?: string[];
  requiresSacrificeSelection?: boolean;
  sacrificeFrom?: string; // Player ID who must sacrifice
  returnsUnderControl?: boolean; // For Grave Betrayal - return under your control
  dyingCreatureCard?: any; // The card that died, for reanimation effects
  /** Snapshotted "for each" amount (e.g. Auras attached as the creature died). */
  referenceAmount?: number;
  value?: any;
  triggerType?: string;
}

function getPermanentRulesTextFragments(perm: any): string[] {
  const fragments: string[] = [];

  const oracleText = String(perm?.card?.oracle_text || '').trim().toLowerCase();
  if (oracleText) {
    fragments.push(oracleText);
  }

  const grantedAbilities = Array.isArray(perm?.grantedAbilities) ? perm.grantedAbilities : [];
  for (const ability of grantedAbilities) {
    const text = String(ability || '').trim().toLowerCase();
    if (text) {
      fragments.push(text);
    }
  }

  const temporaryAbilities = Array.isArray(perm?.temporaryAbilities) ? perm.temporaryAbilities : [];
  for (const entry of temporaryAbilities) {
    const text = typeof entry === 'string'
      ? String(entry || '').trim().toLowerCase()
      : String(entry?.ability || '').trim().toLowerCase();
    if (text) {
      fragments.push(text);
    }
  }

  return fragments;
}

function deathTriggerPermanentHasKeyword(perm: any, keywordLower: string): boolean {
  const wanted = String(keywordLower || '').toLowerCase().trim();
  if (!wanted) return false;

  const counters = perm?.counters && typeof perm.counters === 'object' ? perm.counters : {};
  if (wanted === 'flying' && Number(counters?.flying || 0) > 0) {
    return true;
  }

  const keywordSets = [
    Array.isArray(perm?.keywords) ? perm.keywords : [],
    Array.isArray(perm?.grantedKeywords) ? perm.grantedKeywords : [],
    Array.isArray(perm?.card?.keywords) ? perm.card.keywords : [],
  ];
  for (const keywords of keywordSets) {
    if (keywords.some((keyword: any) => String(keyword || '').toLowerCase() === wanted)) {
      return true;
    }
  }

  return getPermanentRulesTextFragments(perm).some((text) => text.toLowerCase().includes(wanted));
}

function getPermanentSubtypeWords(typeLineValue: string): string[] {
  const typeLine = String(typeLineValue || '').toLowerCase();
  const subtypeSection = typeLine.includes('—')
    ? typeLine.split('—').slice(1).join(' ')
    : typeLine.includes('-')
      ? typeLine.split('-').slice(1).join(' ')
      : '';
  if (!subtypeSection) {
    return [];
  }

  return subtypeSection
    .split(/[^a-z0-9']+/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function sourcePermanentIdDamagedDyingCreatureThisTurn(ctx: GameContext, sourcePermanentId: string, dyingCreature: any): boolean {
  const sourceId = String(sourcePermanentId || '').trim();
  const dyingPermanentId = String(dyingCreature?.id || '').trim();
  if (!sourceId || !dyingPermanentId) {
    return false;
  }

  const damaged = (ctx as any)?.state?.creaturesDamagedByThisCreatureThisTurn;
  if (!damaged || typeof damaged !== 'object') {
    return false;
  }

  const victims = (damaged as any)[sourceId];
  return !!(victims && typeof victims === 'object' && victims[dyingPermanentId]);
}

function sourceDamagedDyingCreatureThisTurn(ctx: GameContext, sourcePermanent: any, dyingCreature: any): boolean {
  return sourcePermanentIdDamagedDyingCreatureThisTurn(ctx, String(sourcePermanent?.id || ''), dyingCreature);
}

function equippedCreatureDamagedDyingCreatureThisTurn(ctx: GameContext, sourcePermanent: any, dyingCreature: any): boolean {
  const equippedCreatureId = String((sourcePermanent as any)?.attachedTo || (sourcePermanent as any)?.equippedCreatureId || '').trim();
  if (!equippedCreatureId) {
    return false;
  }

  return sourcePermanentIdDamagedDyingCreatureThisTurn(ctx, equippedCreatureId, dyingCreature);
}

function deathTriggerDyingCreatureWasAttackingOrBlocking(dyingCreature: any): boolean {
  if (!dyingCreature) return false;

  const wasAttacking =
    (typeof dyingCreature.attacking === 'string' && dyingCreature.attacking.trim() !== '') ||
    dyingCreature.attacking === true ||
    dyingCreature.isAttacking === true ||
    dyingCreature.attackedThisTurn === true;

  const blocking = dyingCreature.blocking;
  const wasBlocking =
    (Array.isArray(blocking) && blocking.length > 0) ||
    (typeof blocking === 'string' && blocking.trim() !== '') ||
    blocking === true ||
    dyingCreature.blockedThisTurn === true;

  return wasAttacking || wasBlocking;
}

function isAuraPermanent(permanent: any): boolean {
  const typeLine = String(permanent?.card?.type_line || permanent?.type_line || '').toLowerCase();
  return typeLine.includes('aura');
}

function countControlledAurasAttachedTo(
  ctx: GameContext,
  controllerId: string,
  hostId: string,
): number {
  const battlefield = ctx.state?.battlefield || [];
  const host = String(hostId || '').trim();
  const controller = String(controllerId || '').trim();
  if (!host || !controller) return 0;
  return battlefield.filter((perm: any) => {
    if (!isAuraPermanent(perm)) return false;
    if (String(perm?.attachedTo || '').trim() !== host) return false;
    return String(perm?.controller || '').trim() === controller;
  }).length;
}

function dyingCreatureIsEnchanted(ctx: GameContext, dyingCreature: any): boolean {
  const dyingId = String(dyingCreature?.id || '').trim();
  if (!dyingId) return false;
  const battlefield = ctx.state?.battlefield || [];
  if (battlefield.some((perm: any) => isAuraPermanent(perm) && String(perm?.attachedTo || '').trim() === dyingId)) {
    return true;
  }
  const attachmentIds = Array.isArray(dyingCreature?.attachments) ? dyingCreature.attachments : [];
  if (attachmentIds.some((id: unknown) => {
    const attachmentId = String(id || '').trim();
    if (!attachmentId) return false;
    const attachment = battlefield.find((perm: any) => String(perm?.id || '') === attachmentId);
    return !attachment || isAuraPermanent(attachment);
  })) {
    return true;
  }
  return false;
}

function deathTriggerClauseMatchesDyingCreature(
  ctx: GameContext,
  clauseText: string,
  sourcePermanent: any,
  dyingCreature: any,
  dyingCreatureController: string,
): boolean {
  const clause = String(clauseText || '').replace(/[’]/g, "'").toLowerCase();
  if (!clause) return false;

  const damageMarkedDiesClause = /^a\s+creature\s+dealt\s+damage\s+by\s+this\s+creature\s+this\s+turn$/i.test(clause);
  const equippedDamageMarkedDiesClause = /^a\s+creature\s+dealt\s+damage\s+by\s+equipped\s+creature\s+this\s+turn$/i.test(clause);
  if (clause.includes('enchanted creature') || clause.includes('equipped creature')) {
    if (/^an?\s+enchanted creature$/.test(clause)) {
      if (!dyingCreatureIsEnchanted(ctx, dyingCreature)) return false;
    } else if (!equippedDamageMarkedDiesClause) {
      return false;
    }
  }
  const isThisOrAnotherControlledClause =
    /\bthis creature or another (?:nontoken )?creature you control\b/i.test(clause);
  if (
    !damageMarkedDiesClause
    && !isThisOrAnotherControlledClause
    && (clause.includes('this creature') || clause.includes('this permanent') || clause.includes('~'))
  ) {
    return false;
  }

  const sourceCardName = String(sourcePermanent?.card?.name || '').trim().toLowerCase();
  const isNamedOrAnotherClause = /\bor\s+another\b/i.test(clause);
  if (sourceCardName && clause.includes(sourceCardName) && !isNamedOrAnotherClause) return false;

  const sourcePermanentId = String(sourcePermanent?.id || '').trim();
  const dyingPermanentId = String(dyingCreature?.id || '').trim();
  if (clause.includes('another') && !isNamedOrAnotherClause && sourcePermanentId && sourcePermanentId === dyingPermanentId) return false;

  const sourceController = String(sourcePermanent?.controller || '').trim();
  if (clause.includes('you control') && dyingCreatureController !== sourceController) return false;
  if ((clause.includes("you don't control") || clause.includes('an opponent controls')) && dyingCreatureController === sourceController) return false;

  if (damageMarkedDiesClause && !sourceDamagedDyingCreatureThisTurn(ctx, sourcePermanent, dyingCreature)) return false;
  if (equippedDamageMarkedDiesClause && !equippedCreatureDamagedDyingCreatureThisTurn(ctx, sourcePermanent, dyingCreature)) return false;

  const typeLine = String(dyingCreature?.card?.type_line || '').toLowerCase();
  const subtypeWords = getPermanentSubtypeWords(typeLine);
  const clauseMentionsSubtype = subtypeWords.some((subtype) => clause.includes(subtype));
  const wantsCreature = /\bcreatures?\b/.test(clause);
  const wantsArtifact = /\bartifacts?\b/.test(clause);
  const wantsEnchantment = /\benchantments?\b/.test(clause);
  const wantsLand = /\blands?\b/.test(clause);
  const wantsPlaneswalker = /\bplaneswalkers?\b/.test(clause);
  const wantsVehicle = /\bvehicles?\b/.test(clause);
  const wantsPermanent = /\bpermanents?\b/.test(clause);
  const typeOk =
    wantsPermanent
    || (wantsCreature && typeLine.includes('creature'))
    || (wantsArtifact && typeLine.includes('artifact'))
    || (wantsEnchantment && typeLine.includes('enchantment'))
    || (wantsLand && typeLine.includes('land'))
    || (wantsPlaneswalker && typeLine.includes('planeswalker'))
    || (wantsVehicle && typeLine.includes('vehicle'))
    || clauseMentionsSubtype;
  if (!typeOk) return false;
  const counters = dyingCreature?.counters && typeof dyingCreature.counters === 'object' ? dyingCreature.counters : {};
  const ownerId = String(dyingCreature?.owner || dyingCreature?.card?.owner || '').trim();
  const isToken = Boolean(dyingCreature?.isToken || dyingCreature?.token || dyingCreature?.card?.isToken || dyingCreature?.card?.token);
  const isFaceDown = Boolean(dyingCreature?.faceDown || dyingCreature?.isFaceDown || dyingCreature?.card?.faceDown || dyingCreature?.card?.isFaceDown);

  if (clause.includes('nontoken') && isToken) return false;
  if (clause.includes('nonartifact') && typeLine.includes('artifact')) return false;
  if (clause.includes('non-angel') && typeLine.includes('angel')) return false;
  if (clause.includes("but don't own") && ownerId && ownerId === sourceController) return false;
  if (clause.includes('without flying') && deathTriggerPermanentHasKeyword(dyingCreature, 'flying')) return false;
  if (clause.includes('with a +1/+1 counter on it') && Number(counters['+1/+1'] || counters.plus1plus1 || 0) <= 0) return false;
  if (clause.includes('face-down') && !isFaceDown) return false;

  if (clause.includes('of the chosen type')) {
    const chosenType = String(sourcePermanent?.chosenCreatureType || '').trim();
    if (!chosenType) return false;
    return permanentHasCreatureTypeNow(dyingCreature, chosenType);
  }

  if (clause.includes('goaded')) {
    const battlefield = ctx.state?.battlefield || [];
    const currentTurn = ctx.state?.turn;
    if (getCurrentGoaders(dyingCreature, battlefield, currentTurn).length === 0) return false;
  }

  if (clause.includes('attacking or blocking')) {
    if (!deathTriggerDyingCreatureWasAttackingOrBlocking(dyingCreature)) return false;
  }

  return true;
}

function deathTriggerEffectKey(sourceId: string, effect: string): string {
  return `${String(sourceId || '')}::${String(effect || '').toLowerCase().replace(/\s+/g, ' ').trim()}`;
}

function deathResultsHaveEffect(results: DeathTriggerResult[], sourceId: string, effect: string): boolean {
  const key = deathTriggerEffectKey(sourceId, effect);
  return results.some((result) => (
    deathTriggerEffectKey(String(result?.source?.permanentId || ''), String(result?.effect || '')) === key
  ));
}

function pushDetectedDeathTrigger(
  results: DeathTriggerResult[],
  trigger: { permanentId?: string; cardName?: string; effect?: string; description?: string; triggerType?: string },
  controllerId: string,
  dyingCreatureCard?: any,
  extras?: Partial<DeathTriggerResult>,
): void {
  const effect = String(trigger.effect || trigger.description || '').trim();
  const sourceId = String(trigger.permanentId || '');
  if (!effect || !sourceId) return;
  if (deathResultsHaveEffect(results, sourceId, effect)) return;
  results.push({
    source: {
      permanentId: sourceId,
      cardName: String(trigger.cardName || 'Unknown'),
      controllerId: String(controllerId || ''),
    },
    effect,
    requiresSacrificeSelection: effect.toLowerCase().includes('sacrifice'),
    ...(trigger.triggerType ? { triggerType: String(trigger.triggerType) } : null),
    ...(dyingCreatureCard ? { dyingCreatureCard } : null),
    ...(extras || null),
  });
}

function extractDeathEventSubject(oracleText: string): string | null {
  const text = String(oracleText || '');
  const graveyardMatch = text.match(
    /when(?:ever)?\s+(.+?)\s+(?:is )?put into (?:a |your |its owner's )?graveyard(?: from (?:the battlefield|anywhere))?/i,
  );
  if (graveyardMatch?.[1]) {
    return String(graveyardMatch[1]).trim();
  }
  const diesMatch = text.match(/when(?:ever)?\s+(.+?)\s+dies/i);
  if (diesMatch?.[1]) {
    return String(diesMatch[1]).trim();
  }
  return null;
}

function extractDeathEventSubjects(oracleText: string): string[] {
  const chunks = String(oracleText || '').split(/(?:\n+|(?<=[.!?])\s+)/);
  const subjects: string[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const subject = extractDeathEventSubject(chunk);
    if (!subject) continue;
    const key = subject.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    subjects.push(subject);
  }
  return subjects;
}

function isSelfOnlyDeathTriggerType(triggerType: string): boolean {
  return triggerType === 'dies'
    || triggerType === 'enters_or_dies'
    || triggerType === 'put_into_graveyard_from_anywhere';
}

function shouldQueueDetectedDeathTrigger(
  ctx: GameContext,
  trigger: { triggerType?: string },
  sourcePermanent: any,
  dyingCreature: any,
  dyingCreatureController: string,
): boolean {
  const triggerType = String(trigger?.triggerType || '').trim();
  if (!triggerType) return false;
  if (
    triggerType === 'undying'
    || triggerType === 'persist'
    || triggerType === 'haunts_creature_dies'
    || triggerType === 'put_into_graveyard_this_turn'
    || triggerType === 'control_none_sacrifice'
    || triggerType === 'that_creature_dies'
    || triggerType === 'graveyard_zone_creature_dies'
    || triggerType === 'typed_permanent_card_your_graveyard_not_battlefield'
    || triggerType === 'black_card_opponent_graveyard_from_anywhere'
  ) {
    return false;
  }
  if (isSelfOnlyDeathTriggerType(triggerType)) {
    return false;
  }

  const sourceId = String(sourcePermanent?.id || '').trim();
  const dyingId = String(dyingCreature?.id || '').trim();
  const isSelf = Boolean(sourceId && dyingId && sourceId === dyingId);
  if (isSelf) {
    const selfAndOtherTypes = new Set([
      'this_or_another_creature_dies',
      'this_or_another_creature_dies_any',
      'this_or_another_typed_creature_dies',
      'this_or_another_typed_creature_dies_any',
      'this_or_another_power_creature_dies',
      'named_or_another_creature_dies',
      'named_or_another_typed_creature_dies',
      'named_or_another_keyword_creature_dies',
      'named_or_nontoken_dies_or_combat_damage_to_player',
    ]);
    if (!selfAndOtherTypes.has(triggerType)) {
      return false;
    }
    const oracle = String(sourcePermanent?.card?.oracle_text || '');
    if (
      triggerType === 'this_or_another_typed_creature_dies'
      && /whenever this creature or another creature you control dies/i.test(oracle)
    ) {
      return false;
    }
    if (
      triggerType === 'named_or_another_typed_creature_dies'
      && /or another creature(?:s)?(?: you control)? dies/i.test(oracle)
    ) {
      return false;
    }
  }

  if (triggerType === 'attachment_dies') {
    const attachedTo = String((sourcePermanent as any)?.attachedTo || '').trim();
    if (attachedTo && attachedTo === dyingId) {
      return true;
    }
    const oracle = String(sourcePermanent?.card?.oracle_text || '');
    if (/an enchanted (?:creature|permanent|land) dies/i.test(oracle)) {
      return dyingCreatureIsEnchanted(ctx, dyingCreature);
    }
    return false;
  }

  if (triggerType === 'dealt_damage_dies') {
    const oracle = String(sourcePermanent?.card?.oracle_text || '').toLowerCase();
    if (oracle.includes('equipped creature')) {
      return equippedCreatureDamagedDyingCreatureThisTurn(ctx, sourcePermanent, dyingCreature);
    }
    return sourceDamagedDyingCreatureThisTurn(ctx, sourcePermanent, dyingCreature);
  }

  const clauses = extractDeathEventSubjects(String(sourcePermanent?.card?.oracle_text || ''));
  if (clauses.length === 0) return false;
  return clauses.some((clause) => deathTriggerClauseMatchesDyingCreature(
    ctx,
    clause,
    sourcePermanent,
    dyingCreature,
    dyingCreatureController,
  ));
}

function appendDetectedDeathWatcherTriggers(
  ctx: GameContext,
  results: DeathTriggerResult[],
  permanentsToScan: any[],
  dyingCreature: any,
  dyingCreatureController: string,
): void {
  for (const permanent of permanentsToScan) {
    if (!permanent?.card) continue;
    const controllerId = String(permanent.controller || dyingCreatureController || '');
    for (const trigger of detectDeathTriggers(permanent.card, permanent)) {
      if (!shouldQueueDetectedDeathTrigger(ctx, trigger, permanent, dyingCreature, dyingCreatureController)) {
        continue;
      }
      const extras: Partial<DeathTriggerResult> = {};
      const effect = String(trigger.effect || trigger.description || '');
      if (/for each aura/i.test(effect) && dyingCreatureIsEnchanted(ctx, dyingCreature)) {
        extras.referenceAmount = countControlledAurasAttachedTo(
          ctx,
          controllerId,
          String(dyingCreature?.id || ''),
        );
        extras.value = {
          attachedAuraCount: extras.referenceAmount,
          dyingPermanentId: String(dyingCreature?.id || ''),
        };
      }
      const returnsUnderControl = /return/i.test(effect) && /under your control/i.test(effect);
      if (returnsUnderControl) {
        extras.returnsUnderControl = true;
        extras.dyingCreatureCard = dyingCreature?.card;
      }
      pushDetectedDeathTrigger(
        results,
        { ...trigger, permanentId: String(permanent.id || trigger.permanentId || '') },
        controllerId,
        dyingCreature?.card,
        extras,
      );
    }
  }
}

function appendDetectedSelfDeathTriggers(
  results: DeathTriggerResult[],
  dyingPermanent: any,
  dyingController: string,
): void {
  const card = dyingPermanent?.card;
  if (!card) return;
  const isCreature = String(card?.type_line || '').toLowerCase().includes('creature');
  for (const trigger of detectDeathTriggers(card, dyingPermanent)) {
    const triggerType = String(trigger.triggerType || '');
    if (triggerType === 'enters_or_dies') {
      pushDetectedDeathTrigger(results, trigger, dyingController);
      continue;
    }
    // "This/NAME or another creature you control dies" is a self-and-other
    // trigger. The live self-dies scan only matches NAME immediately before
    // "dies", so queue these here when the dying creature is the source.
    if (
      triggerType === 'this_or_another_creature_dies'
      || triggerType === 'this_or_another_creature_dies_any'
      || triggerType === 'this_or_another_typed_creature_dies'
      || triggerType === 'this_or_another_typed_creature_dies_any'
      || triggerType === 'named_or_another_creature_dies'
      || triggerType === 'named_or_another_typed_creature_dies'
      || triggerType === 'named_or_another_keyword_creature_dies'
    ) {
      pushDetectedDeathTrigger(results, trigger, dyingController);
      continue;
    }
    // Artifact/enchantment "enters or is put into a graveyard" uses triggerType `dies`.
    // Creature "When this creature dies" is already collected by the live self-dies scan.
    if (triggerType === 'dies' && !isCreature) {
      pushDetectedDeathTrigger(results, trigger, dyingController);
    }
  }
}

function hauntingTargetIdFromCard(cardOrPerm: any): string {
  return String(
    cardOrPerm?.hauntingPermanentId
    || cardOrPerm?.hauntedCard
    || cardOrPerm?.hauntingTargetId
    || cardOrPerm?.card?.hauntingPermanentId
    || cardOrPerm?.card?.hauntedCard
    || cardOrPerm?.card?.hauntingTargetId
    || '',
  ).trim();
}

function appendHauntLeaveDeathTriggers(
  ctx: GameContext,
  results: DeathTriggerResult[],
  dyingCreature: any,
): void {
  const dyingId = String(dyingCreature?.id || '').trim();
  if (!dyingId) return;

  const zones = (ctx.state as any)?.zones && typeof (ctx.state as any).zones === 'object'
    ? Object.values((ctx.state as any).zones)
    : [];
  for (const zone of zones) {
    const exile = Array.isArray((zone as any)?.exile) ? (zone as any).exile : [];
    for (const candidate of exile) {
      if (!candidate) continue;
      const targetId = hauntingTargetIdFromCard(candidate);
      if (!targetId || targetId !== dyingId) continue;
      const card = candidate?.oracle_text ? candidate : candidate?.card;
      if (!card?.oracle_text) continue;
      const sourceId = String(candidate?.id || card?.id || '');
      const controllerId = String(candidate?.owner || candidate?.controller || card?.owner || '');
      for (const trigger of detectDeathTriggers(card, { id: sourceId, controller: controllerId, card })) {
        if (String(trigger.triggerType || '') !== 'haunts_creature_dies') continue;
        pushDetectedDeathTrigger(
          results,
          { ...trigger, permanentId: sourceId },
          controllerId,
          dyingCreature?.card,
        );
      }
    }
  }
}

/**
 * Find all death triggers that should fire when a creature dies.
 * 
 * DYNAMIC-FIRST PATTERN: Uses regex-based oracle text parsing as the primary
 * detection mechanism. The KNOWN_DEATH_TRIGGERS table serves as an
 * optimization fallback for special handling.
 * 
 * @param ctx Game context
 * @param dyingCreature The creature that died
 * @param dyingCreatureController The controller of the dying creature
 * @returns Array of triggered abilities that should fire
 */
export function getDeathTriggers(
  ctx: GameContext,
  dyingCreature: any,
  dyingCreatureController: string
): DeathTriggerResult[] {
  const results: DeathTriggerResult[] = [];
  const battlefield = ctx.state?.battlefield || [];
  try {
    hydrateBattlefieldOracleText(battlefield);
    hydratePermanentCardOracleInPlace(dyingCreature);
  } catch {
    // best-effort: triggers must not depend on hydration succeeding
  }
  const dyingTypeLine = (dyingCreature?.card?.type_line || '').toLowerCase();
  const isCreature = dyingTypeLine.includes('creature');

  appendDetectedSelfDeathTriggers(results, dyingCreature, dyingCreatureController);

  const dyingCard = dyingCreature?.card;
  const dyingCardName = String(dyingCard?.name || 'Unknown');
  const lowerDyingCardName = dyingCardName.toLowerCase();
  const dyingPermanentId = String(dyingCreature?.id || '').trim();
  const permanentsToScan: any[] = [...battlefield];
  if (dyingPermanentId && !permanentsToScan.some((perm) => String(perm?.id || '') === dyingPermanentId)) {
    permanentsToScan.push(dyingCreature);
  }

  appendDetectedDeathWatcherTriggers(
    ctx,
    results,
    permanentsToScan,
    dyingCreature,
    dyingCreatureController,
  );

  if (!isCreature) {
    appendHauntLeaveDeathTriggers(ctx, results, dyingCreature);
    return results;
  }
  const extractChooseOneModalOptions = (effectText: string): string[] | undefined => {
    const effect = String(effectText || '').trim();
    if (!/^choose one\b/i.test(effect)) return undefined;

    const modalBody = effect.replace(/^choose one\s*[—:.-]\s*/i, '').trim();
    const hasBulletOptions = /(?:^|\n)\s*[•]\s*/.test(modalBody);
    const bulletOptions = hasBulletOptions
      ? modalBody
          .split(/(?:^|\n)\s*[•]\s*/)
          .map((option) => option.trim())
          .filter(Boolean)
      : [];
    if (bulletOptions.length > 0) {
      return bulletOptions;
    }

    const inlineOptions = modalBody
      .split(/\s*;\s*or\s+/i)
      .map((option) => option.trim())
      .filter(Boolean);
    return inlineOptions.length > 0 ? inlineOptions : undefined;
  };
  const selfDiesPattern = new RegExp(
    `when(?:ever)?\\s+(?:~|this creature|${escapeCardNameForRegex(dyingCardName)})(?:\\s+or\\s+another\\s+(?:nontoken\\s+)?creature(?:s)?(?:\\s+you\\s+control)?)?\\s+dies,?\\s*([^.]+)`,
    'ig'
  );
  const seenSelfEffects = new Set<string>();
  for (const rulesText of getPermanentRulesTextFragments(dyingCreature)) {
    const textForScan = stripReminderParentheticals(rulesText);
    const matches = textForScan.matchAll(selfDiesPattern);
    for (const match of matches) {
      let effect = collectDeathTriggerEffectText(textForScan, match as RegExpMatchArray, 1);
      if (/^choose one\b/i.test(effect)) {
        const matchText = String(match?.[0] || '');
        const matchIndex = typeof match?.index === 'number' ? match.index : -1;
        const effectOffset = matchText.lastIndexOf(effect);
        if (matchIndex >= 0 && effectOffset >= 0) {
          const remainder = String(rulesText || '').slice(matchIndex + effectOffset).trim();
          const collectedLines: string[] = [];
          for (const [index, lineValue] of remainder.split(/\n/).entries()) {
            const line = String(lineValue || '').trim();
            if (!line) continue;
            if (index === 0 || /^[•]/.test(line)) {
              collectedLines.push(line);
              continue;
            }
            break;
          }
          if (collectedLines.length > 0) {
            effect = collectedLines.join('\n').trim();
          }
        }
      }
      if (!effect) continue;
      const effectKey = effect.toLowerCase();
      if (seenSelfEffects.has(effectKey)) continue;
      seenSelfEffects.add(effectKey);
      const modalOptions = extractChooseOneModalOptions(effect);
      results.push({
        source: {
          permanentId: String(dyingCreature?.id || ''),
          cardName: dyingCardName,
          controllerId: String(dyingCreatureController || ''),
        },
        effect,
        ...(Array.isArray(modalOptions) && modalOptions.length > 0 ? { requiresChoice: true, modalOptions } : null),
        requiresSacrificeSelection: effectKey.includes('sacrifice'),
      });
    }
  }

  for (const [knownName, info] of Object.entries(KNOWN_DEATH_TRIGGERS)) {
    if (info.triggerOn !== 'own') continue;
    if (!lowerDyingCardName.includes(knownName)) continue;
    if (results.some((result) => String(result?.source?.permanentId || '') === String(dyingCreature?.id || ''))) {
      continue;
    }

    const effect = String(info.effect || '').trim();
    const modalOptions = extractChooseOneModalOptions(effect);
    results.push({
      source: {
        permanentId: String(dyingCreature?.id || ''),
        cardName: dyingCardName,
        controllerId: String(dyingCreatureController || ''),
      },
      effect,
      ...(Array.isArray(modalOptions) && modalOptions.length > 0 ? { requiresChoice: true, modalOptions } : null),
      requiresSacrificeSelection: effect.toLowerCase().includes('sacrifice'),
    });
  }
  
  // Check all permanents on the battlefield for death triggers
  for (const permanent of permanentsToScan) {
    if (!permanent) continue;
    
    const card = permanent.card;
    if (!card) continue;
    
    const cardName = (card.name || '').toLowerCase();
    const oracleText = getPermanentRulesTextFragments(permanent).join('\n');
    const lowerOracleText = oracleText.toLowerCase();
    const permanentController = String(permanent.controller || '').trim();
    const attachedTo = String((permanent as any)?.attachedTo || '').trim();
    
    // ===== DYNAMIC DETECTION (Primary) =====

    const anEnchantedCreatureDiesMatch = oracleText.match(/when(?:ever)? an enchanted creature dies,?\s*([^.]+)/i);
    if (anEnchantedCreatureDiesMatch && dyingCreatureIsEnchanted(ctx, dyingCreature)) {
      const effect = collectDeathTriggerEffectText(oracleText, anEnchantedCreatureDiesMatch, 1);
      if (effect && !results.some((result) => String(result?.source?.permanentId || '') === String(permanent.id || ''))) {
        const auraCount = countControlledAurasAttachedTo(
          ctx,
          permanentController,
          String(dyingCreature?.id || ''),
        );
        results.push({
          source: {
            permanentId: permanent.id,
            cardName: card.name,
            controllerId: permanentController,
          },
          effect,
          referenceAmount: auraCount,
          value: {
            attachedAuraCount: auraCount,
            dyingPermanentId: String(dyingCreature?.id || ''),
          },
          dyingCreatureCard: dyingCreature?.card,
        });
      }
    }

    if ((lowerOracleText.includes('when enchanted creature dies') || lowerOracleText.includes('whenever enchanted creature dies')) &&
        attachedTo && attachedTo === String(dyingCreature?.id || '')) {
      const effectMatch = oracleText.match(/when(?:ever)? enchanted creature dies,?\s*([^.]+)/i);
      if (effectMatch && !results.some(r => r.source.permanentId === permanent.id)) {
        const effect = collectDeathTriggerEffectText(oracleText, effectMatch, 1);
        results.push({
          source: {
            permanentId: permanent.id,
            cardName: card.name,
            controllerId: permanentController,
          },
          effect,
          requiresSacrificeSelection: effect.toLowerCase().includes('sacrifice'),
          dyingCreatureCard: dyingCreature?.card,
        });
      }
    }

    else if ((lowerOracleText.includes('when equipped creature dies') || lowerOracleText.includes('whenever equipped creature dies')) &&
        attachedTo && attachedTo === String(dyingCreature?.id || '')) {
      const effectMatch = oracleText.match(/when(?:ever)? equipped creature dies,?\s*([^.]+)/i);
      if (effectMatch && !results.some(r => r.source.permanentId === permanent.id)) {
        const effect = collectDeathTriggerEffectText(oracleText, effectMatch, 1);
        results.push({
          source: {
            permanentId: permanent.id,
            cardName: card.name,
            controllerId: permanentController,
          },
          effect,
          requiresSacrificeSelection: effect.toLowerCase().includes('sacrifice'),
          dyingCreatureCard: dyingCreature?.card,
        });
      }
    }

    else {
      const genericDiesMatch = oracleText.match(/when(?:ever)?\s+([^.]+?)\s+dies,?\s*([^.]+)/i);
      if (
        genericDiesMatch &&
        deathTriggerClauseMatchesDyingCreature(ctx, genericDiesMatch[1], permanent, dyingCreature, dyingCreatureController) &&
        !results.some(r => r.source.permanentId === permanent.id)
      ) {
        const effect = collectDeathTriggerEffectText(oracleText, genericDiesMatch, 2);
        const returnsUnderControl = effect.toLowerCase().includes('return') &&
          effect.toLowerCase().includes('under your control');
        results.push({
          source: {
            permanentId: permanent.id,
            cardName: card.name,
            controllerId: permanentController,
          },
          effect,
          requiresSacrificeSelection: effect.toLowerCase().includes('sacrifice'),
          returnsUnderControl,
          dyingCreatureCard: returnsUnderControl ? dyingCreature?.card : undefined,
        });
      }
    }
    
    // "Whenever a creature you control dies" or "Whenever another creature you control dies"
        if ((lowerOracleText.includes('whenever a creature you control dies') ||
          lowerOracleText.includes('whenever another creature you control dies') ||
          lowerOracleText.includes('whenever a nontoken creature you control dies') ||
          lowerOracleText.includes('whenever another nontoken creature you control dies')) && 
        dyingCreatureController === permanentController) {
      const effectMatch = oracleText.match(/whenever (?:a|another) (?:nontoken )?creature you control dies,?\s*([^.]+)/i);
      if (effectMatch && !results.some(r => r.source.permanentId === permanent.id)) {
        const effect = collectDeathTriggerEffectText(oracleText, effectMatch, 1);
        results.push({
          source: {
            permanentId: permanent.id,
            cardName: card.name,
            controllerId: permanentController,
          },
          effect,
          requiresSacrificeSelection: effect.toLowerCase().includes('sacrifice'),
        });
      }
    }
    
    // "Whenever a creature dies" (any creature, not specific to controller)
    else if (lowerOracleText.includes('whenever a creature dies') && 
      !lowerOracleText.includes('whenever a creature you control dies') &&
      !lowerOracleText.includes("whenever a creature you don't control dies") &&
      !lowerOracleText.includes("whenever a creature an opponent controls dies")) {
      const effectMatch = oracleText.match(/whenever a creature dies,?\s*([^.]+)/i);
      if (effectMatch && !results.some(r => r.source.permanentId === permanent.id)) {
        const effect = collectDeathTriggerEffectText(oracleText, effectMatch, 1);
        results.push({
          source: {
            permanentId: permanent.id,
            cardName: card.name,
            controllerId: permanentController,
          },
          effect,
          requiresSacrificeSelection: effect.toLowerCase().includes('sacrifice'),
        });
      }
    }
    
    // "Whenever a creature you don't control dies" or "Whenever a creature an opponent controls dies"
        else if ((lowerOracleText.includes("whenever a creature you don't control dies") ||
          lowerOracleText.includes("whenever a creature an opponent controls dies")) &&
        dyingCreatureController !== permanentController) {
      const effectMatch = oracleText.match(/whenever (?:a|another) (?:nontoken )?creature (?:you don't control|an opponent controls) dies,?\s*([^.]+)/i);
      if (effectMatch && !results.some(r => r.source.permanentId === permanent.id)) {
        const effect = collectDeathTriggerEffectText(oracleText, effectMatch, 1);
        const returnsUnderControl = effect.toLowerCase().includes('return') && 
                                    effect.toLowerCase().includes('under your control');
        results.push({
          source: {
            permanentId: permanent.id,
            cardName: card.name,
            controllerId: permanentController,
          },
          effect,
          requiresSacrificeSelection: effect.toLowerCase().includes('sacrifice'),
          returnsUnderControl,
          dyingCreatureCard: dyingCreature?.card,
        });
      }
    }
    
    // ===== KNOWN CARDS TABLE (Fallback/Enhancement) =====
    // Use the table only when dynamic oracle parsing did not already match this permanent.
    if (results.some((result) => String(result?.source?.permanentId || '') === String(permanent.id || ''))) {
      continue;
    }
    for (const [knownName, info] of Object.entries(KNOWN_DEATH_TRIGGERS)) {
      if (!cardName.includes(knownName)) continue;
        let shouldTrigger = false;
        
        switch (info.triggerOn) {
          case 'controlled':
            shouldTrigger = dyingCreatureController === permanentController;
            break;
          case 'any':
            shouldTrigger = true;
            break;
          case 'own':
            shouldTrigger = false;
            break;
          case 'opponent':
            shouldTrigger = dyingCreatureController !== permanentController;
            break;
        }
        
        if (shouldTrigger) {
          const requiresSacrifice = info.effect.toLowerCase().includes('sacrifice');
          const returnsUnderControl = info.effect.toLowerCase().includes('return') && 
                                      info.effect.toLowerCase().includes('under your control');
          
          results.push({
            source: {
              permanentId: permanent.id,
              cardName: card.name,
              controllerId: permanentController,
            },
            effect: info.effect,
            requiresSacrificeSelection: requiresSacrifice,
            returnsUnderControl,
            dyingCreatureCard: returnsUnderControl ? dyingCreature?.card : undefined,
          });
        }
    }
  }

  // Emblem death triggers (e.g. Sephiroth Super Nova emblem)
  const emblems = Array.isArray((ctx.state as any)?.emblems) ? (ctx.state as any).emblems : [];
  for (const emblem of emblems) {
    if (!emblem) continue;
    const emblemId = String(emblem.id || '').trim();
    const emblemController = String(emblem.controller || '').trim();
    const emblemEffect = String(emblem.effect || '').trim();
    const lowerEmblemEffect = emblemEffect.toLowerCase();
    if (!emblemId || !emblemController || !lowerEmblemEffect) continue;
    if (results.some((r) => String(r?.source?.permanentId || '') === emblemId)) continue;

    const emblemName = String(emblem.sourceName || 'Emblem').trim() || 'Emblem';
    const displayName = /emblem/i.test(emblemName) ? emblemName : `${emblemName} Emblem`;

    // "Whenever a creature you control dies"
    if (
      (lowerEmblemEffect.includes('whenever a creature you control dies')
        || lowerEmblemEffect.includes('whenever another creature you control dies'))
      && dyingCreatureController === emblemController
    ) {
      const effectMatch = emblemEffect.match(/whenever (?:a|another) (?:nontoken )?creature you control dies,?\s*([^.]+)/i);
      if (effectMatch) {
        results.push({
          source: {
            permanentId: emblemId,
            cardName: displayName,
            controllerId: emblemController,
            isEmblem: true,
          },
          effect: collectDeathTriggerEffectText(emblemEffect, effectMatch, 1),
        });
      }
      continue;
    }

    // "Whenever a creature dies" (any creature)
    if (
      lowerEmblemEffect.includes('whenever a creature dies')
      && !lowerEmblemEffect.includes('whenever a creature you control dies')
      && !lowerEmblemEffect.includes("whenever a creature you don't control dies")
      && !lowerEmblemEffect.includes('whenever a creature an opponent controls dies')
    ) {
      const effectMatch = emblemEffect.match(/whenever a creature dies,?\s*([^.]+)/i);
      if (effectMatch) {
        results.push({
          source: {
            permanentId: emblemId,
            cardName: displayName,
            controllerId: emblemController,
            isEmblem: true,
          },
          effect: collectDeathTriggerEffectText(emblemEffect, effectMatch, 1),
        });
      }
    }
  }

  appendHauntLeaveDeathTriggers(ctx, results, dyingCreature);
  return dedupeDeathTriggerResults(results);
}

function deathEffectsOverlap(left: string, right: string): boolean {
  const a = String(left || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const b = String(right || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const prefixLen = Math.min(48, a.length, b.length);
  return prefixLen >= 24 && a.slice(0, prefixLen) === b.slice(0, prefixLen);
}

function dedupeDeathTriggerResults(results: DeathTriggerResult[]): DeathTriggerResult[] {
  const deduped: DeathTriggerResult[] = [];
  for (const result of results) {
    const sourceId = String(result?.source?.permanentId || '');
    const effect = String(result?.effect || '');
    if (!sourceId || !effect) continue;
    if (deduped.some((existing) => (
      String(existing.source.permanentId) === sourceId
      && deathEffectsOverlap(String(existing.effect || ''), effect)
    ))) {
      continue;
    }
    deduped.push(result);
  }
  return deduped;
}

/**
 * Get list of players who need to sacrifice a creature due to Grave Pact-style effects
 * @param ctx Game context
 * @param triggerController The controller of the trigger source
 * @returns Array of player IDs who must sacrifice
 */
export function getPlayersWhoMustSacrifice(
  ctx: GameContext,
  triggerController: string
): string[] {
  const players = ctx.state?.players || [];
  return players
    .map((p: any) => p.id)
    .filter((pid: string) => pid !== triggerController);
}

// NOTE: End Step Trigger System has been moved to ./triggers/turn-phases.ts
// Re-exports are at the top of this file

// NOTE: Draw Step Trigger System has been moved to ./triggers/turn-phases.ts
// Re-exports are at the top of this file

// NOTE: Untap Step Effects System has been moved to ./triggers/turn-phases.ts
// Re-exports are at the top of this file

// ============================================================================
// ETB-Triggered Untap Effects (Intruder Alarm, Thornbite Staff, etc.)
// ============================================================================

export interface ETBUntapEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  untapType: 'all_creatures' | 'equipped_creature' | 'controller_creatures' | 'all_permanents';
  triggerCondition: 'creature_etb' | 'any_etb' | 'nontoken_creature_etb';
}

/**
 * Detect ETB-triggered untap effects from a card's oracle text
 * Handles cards like:
 * - Intruder Alarm: "Whenever a creature enters the battlefield, untap all creatures"
 * - Thornbite Staff: "Whenever a creature dies, untap equipped creature" (death trigger, but similar pattern)
 * - Jeskai Ascendancy: "Whenever you cast a noncreature spell, creatures you control get +1/+1 and untap"
 */
export function detectETBUntapEffects(card: any, permanent: any): ETBUntapEffect[] {
  const effects: ETBUntapEffect[] = [];
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // "Whenever a creature enters the battlefield, untap all creatures" (Intruder Alarm)
  if (oracleText.includes('whenever a creature enters') && oracleText.includes('untap all creatures')) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: "Whenever a creature enters the battlefield, untap all creatures",
      untapType: 'all_creatures',
      triggerCondition: 'creature_etb',
    });
  }
  
  // "Whenever a creature enters the battlefield under your control, untap" patterns
  // Supports both old "enters the battlefield" and new Bloomburrow "enters" templates
  if ((oracleText.includes('whenever a creature enters the battlefield under your control') ||
       oracleText.includes('whenever a creature enters under your control')) && 
      oracleText.includes('untap')) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: "Whenever a creature enters under your control, untap target creature",
      untapType: 'controller_creatures',
      triggerCondition: 'creature_etb',
    });
  }
  
  // Generic pattern: "whenever a creature enters the battlefield" + "untap"
  const creatureETBUntapMatch = oracleText.match(/whenever a creature enters (?:the battlefield)?[^.]*untap ([^.]+)/i);
  if (creatureETBUntapMatch && !effects.length) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever a creature enters the battlefield, untap ${creatureETBUntapMatch[1]}`,
      untapType: 'all_creatures',
      triggerCondition: 'creature_etb',
    });
  }
  
  // "Whenever a nontoken creature enters" patterns
  if (oracleText.includes('whenever a nontoken creature enters') && oracleText.includes('untap')) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: "Whenever a nontoken creature enters the battlefield, untap",
      untapType: 'all_creatures',
      triggerCondition: 'nontoken_creature_etb',
    });
  }
  
  return effects;
}

/**
 * Get ETB untap effects that should trigger when a creature enters
 */
export function getETBUntapEffects(
  ctx: GameContext,
  enteringPermanent: any,
  isToken: boolean
): ETBUntapEffect[] {
  const effects: ETBUntapEffect[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  // Check if the entering permanent is a creature
  const typeLine = (enteringPermanent?.card?.type_line || '').toLowerCase();
  const isCreature = typeLine.includes('creature');
  
  if (!isCreature) {
    return effects; // Only creature ETBs trigger these effects
  }
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    if (permanent.id === enteringPermanent?.id) continue; // Skip the entering permanent itself
    
    const permEffects = detectETBUntapEffects(permanent.card, permanent);
    
    for (const effect of permEffects) {
      // Check trigger condition
      if (effect.triggerCondition === 'creature_etb') {
        effects.push(effect);
      } else if (effect.triggerCondition === 'nontoken_creature_etb' && !isToken) {
        effects.push(effect);
      }
    }
  }
  
  return effects;
}

/**
 * Apply an ETB untap effect (actually untap the permanents)
 */
export function applyETBUntapEffect(ctx: GameContext, effect: ETBUntapEffect): number {
  const battlefield = ctx.state?.battlefield || [];
  let untappedCount = 0;
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.tapped) continue;
    
    const typeLine = (permanent.card?.type_line || '').toLowerCase();
    let shouldUntap = false;
    
    switch (effect.untapType) {
      case 'all_creatures':
        shouldUntap = typeLine.includes('creature');
        break;
      case 'controller_creatures':
        shouldUntap = typeLine.includes('creature') && permanent.controller === effect.controllerId;
        break;
      case 'all_permanents':
        shouldUntap = true;
        break;
      case 'equipped_creature':
        // Would need to track equipment attachment
        break;
    }
    
    if (shouldUntap) {
      permanent.tapped = false;
      untappedCount++;
    }
  }
  
  if (untappedCount > 0) {
    ctx.bumpSeq();
  }
  
  return untappedCount;
}

// ============================================================================
// Spell-Cast Untap Triggers (Jeskai Ascendancy, Paradox Engine)
// ============================================================================

export interface SpellCastUntapEffect {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  untapType: 'nonland_permanents' | 'creatures' | 'all';
  spellCondition: 'noncreature' | 'any' | 'instant_sorcery';
}

/**
 * Detect spell-cast untap triggers
 * - Paradox Engine: "Whenever you cast a spell, untap all nonland permanents you control"
 * - Jeskai Ascendancy: "Whenever you cast a noncreature spell, creatures you control get +1/+1 until end of turn. Untap those creatures."
 */
export function detectSpellCastUntapEffects(card: any, permanent: any): SpellCastUntapEffect[] {
  const effects: SpellCastUntapEffect[] = [];
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // "Whenever you cast a spell, untap all nonland permanents you control" (Paradox Engine - banned but pattern useful)
  if (oracleText.includes('whenever you cast a spell') && 
      oracleText.includes('untap all nonland permanents')) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: "Whenever you cast a spell, untap all nonland permanents you control",
      untapType: 'nonland_permanents',
      spellCondition: 'any',
    });
  }
  
  // "Whenever you cast a noncreature spell" + "untap" (Jeskai Ascendancy pattern)
  if (oracleText.includes('whenever you cast a noncreature spell') && 
      oracleText.includes('untap')) {
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: "Whenever you cast a noncreature spell, untap creatures you control",
      untapType: 'creatures',
      spellCondition: 'noncreature',
    });
  }
  
  // Generic "whenever you cast" + "untap" pattern
  const castUntapMatch = oracleText.match(/whenever you cast (?:a |an )?(\w+)?\s*spell[^.]*untap/i);
  if (castUntapMatch && !effects.length) {
    const spellType = castUntapMatch[1]?.toLowerCase() || 'any';
    let spellCondition: SpellCastUntapEffect['spellCondition'] = 'any';
    if (spellType === 'noncreature') spellCondition = 'noncreature';
    else if (spellType === 'instant' || spellType === 'sorcery') spellCondition = 'instant_sorcery';
    
    effects.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever you cast ${aOrAnSpellType(spellType)}, untap`,
      untapType: 'nonland_permanents',
      spellCondition,
    });
  }
  
  return effects;
}

/**
 * Get spell-cast untap effects for a player casting a spell
 */
export function getSpellCastUntapEffects(
  ctx: GameContext,
  casterId: string,
  spellCard: any
): SpellCastUntapEffect[] {
  const effects: SpellCastUntapEffect[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  const spellTypeLine = (spellCard?.type_line || '').toLowerCase();
  const isCreatureSpell = spellTypeLine.includes('creature');
  const isInstantOrSorcery = spellTypeLine.includes('instant') || spellTypeLine.includes('sorcery');
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    if (permanent.controller !== casterId) continue; // Only controller's permanents trigger
    
    const permEffects = detectSpellCastUntapEffects(permanent.card, permanent);
    
    for (const effect of permEffects) {
      let shouldTrigger = false;
      
      switch (effect.spellCondition) {
        case 'any':
          shouldTrigger = true;
          break;
        case 'noncreature':
          shouldTrigger = !isCreatureSpell;
          break;
        case 'instant_sorcery':
          shouldTrigger = isInstantOrSorcery;
          break;
      }
      
      if (shouldTrigger) {
        effects.push(effect);
      }
    }
  }
  
  return effects;
}

/**
 * Apply a spell-cast untap effect
 */
export function applySpellCastUntapEffect(ctx: GameContext, effect: SpellCastUntapEffect): number {
  const battlefield = ctx.state?.battlefield || [];
  let untappedCount = 0;
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.tapped) continue;
    if (permanent.controller !== effect.controllerId) continue;
    
    const typeLine = (permanent.card?.type_line || '').toLowerCase();
    let shouldUntap = false;
    
    switch (effect.untapType) {
      case 'nonland_permanents':
        shouldUntap = !typeLine.includes('land');
        break;
      case 'creatures':
        shouldUntap = typeLine.includes('creature');
        break;
      case 'all':
        shouldUntap = true;
        break;
    }
    
    if (shouldUntap) {
      permanent.tapped = false;
      untappedCount++;
    }
  }
  
  if (untappedCount > 0) {
    ctx.bumpSeq();
  }
  
  return untappedCount;
}

// ============================================================================
// General Spell-Cast Triggered Abilities
// (Merrow Reejerey, Deeproot Waters, Beast Whisperer, etc.)
// ============================================================================

export interface SpellCastTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  effect: string;
  spellCondition: 'any' | 'creature' | 'noncreature' | 'instant_sorcery' | 'colorless' | 'historic' | 'tribal_type' | 'color' | 'chosen_color' | 'artifact_or_creature';
  tribalType?: string; // For tribal triggers like "Merfolk spell" or color like "green"
  /** When set, the cast must have used mana produced by this permanent (Barracks-style). */
  requiresManaFromPermanentId?: string;
  copiesSpell?: boolean;
  firstSpellThisTurn?: boolean;
  firstSpellDuringOpponentTurn?: boolean;
  sourceZoneRequirement?: 'hand' | 'library' | 'exile' | 'graveyard' | 'not_hand';
  requiresTarget?: boolean;
  targetType?: string; // e.g., "permanent" for tap/untap effects
  createsToken?: boolean;
  tokenDetails?: {
    name: string;
    power: number;
    toughness: number;
    types: string;
    colors?: string[];
    abilities?: string[];
  };
  oncePerTurn?: boolean;
  replacementEffect?: {
    kind: 'bottom_spell_reveal_until_nonland';
    revealFromLibraryOf: 'controller';
    castWithoutPayingManaCost: boolean;
    randomizeBottomRemainder: boolean;
  };
  addsLoyaltyCounters?: number; // Number of loyalty counters to add (for planeswalkers like Ral, Crackling Wit)
  optionalPaymentCost?: string; // Optional mana payment before effect (Emperor Mihail II)
  /** Minimum printed power of the cast creature spell (Gwenna, Eyes of Gaea). */
  minSpellPower?: number;
  mandatory: boolean;
}

/**
 * Detect spell-cast triggered abilities from a card's oracle text
 * Handles cards like:
 * - Merrow Reejerey: "Whenever you cast a Merfolk spell, you may tap or untap target permanent"
 * - Deeproot Waters: "Whenever you cast a Merfolk spell, create a 1/1 blue Merfolk creature token with hexproof"
 * - Beast Whisperer: "Whenever you cast a creature spell, draw a card"
 * - Archmage Emeritus: "Magecraft — Whenever you cast or copy an instant or sorcery spell, draw a card"
 * - Harmonic Prodigy: "If an ability of a Shaman or Wizard you control triggers, that ability triggers an additional time"
 */
export function detectSpellCastTriggers(card: any, permanent: any, state?: unknown): SpellCastTrigger[] {
  const triggers: SpellCastTrigger[] = [];
  const { cardName, oracleText } = getActivePermanentCardFace(card, permanent, state);
  const lowerOracle = oracleText.toLowerCase();
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";

  // Increment: retain the full trigger condition so the common
  // spell-cast emitter can evaluate it both when triggering and resolving.
  if (/(?:^|\n)\s*increment\s*(?:\([^)]*\))?\s*(?:\n|$)/i.test(oracleText)) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: "Whenever you cast a spell, if this permanent is a creature and the amount of mana spent to cast that spell is greater than this creature's power or this creature's toughness, put a +1/+1 counter on this creature.",
      effect: 'Put a +1/+1 counter on this creature.',
      spellCondition: 'any',
      mandatory: true,
    });
  }

  const playerCastsCommanderOrAttacksMatch = oracleText.match(
    /whenever a player casts their commander or attacks with their commander,?\s*([^.]+)/i,
  );
  if (
    playerCastsCommanderOrAttacksMatch &&
    !triggers.some((t) => String(t.description || '').toLowerCase().includes('casts their commander or attacks'))
  ) {
    const effectText = timingTriggerEffect(oracleText, playerCastsCommanderOrAttacksMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever a player casts their commander or attacks with their commander, ${effectText}`,
      effect: effectText,
      spellCondition: 'any',
      tribalType: 'commander',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anyPlayerCrimeMatch = oracleText.match(/whenever a player commits a crime,?\s*([^.]+)/i);
  if (anyPlayerCrimeMatch && !triggers.some((t) => String(t.description || '').toLowerCase().includes('commits a crime'))) {
    const effectText = timingTriggerEffect(oracleText, anyPlayerCrimeMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever a player commits a crime, ${effectText}`,
      effect: effectText,
      spellCondition: 'any',
      tribalType: 'commit_a_crime',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const commitCrimeMatch = oracleText.match(/whenever you commit a crime,?\s*([^.]+)/i);
  if (commitCrimeMatch && !triggers.some((t) => String(t.description || '').toLowerCase().includes('commit a crime'))) {
    const effectText = timingTriggerEffect(oracleText, commitCrimeMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever you commit a crime, ${effectText}`,
      effect: effectText,
      spellCondition: 'any',
      tribalType: 'commit_a_crime',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const nonSliverCreatureSpellCastMatch = oracleText.match(
    /whenever you cast a non-Sliver creature spell,?\s*([^.]+)/i,
  );
  if (
    nonSliverCreatureSpellCastMatch &&
    !triggers.some((t) => String(t.description || '').toLowerCase().includes('non-sliver creature spell'))
  ) {
    const effectText = timingTriggerEffect(oracleText, nonSliverCreatureSpellCastMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever you cast a non-Sliver creature spell, ${effectText}`,
      effect: effectText,
      spellCondition: 'creature',
      tribalType: 'non-sliver',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const youCopySpellMatch = oracleText.match(/whenever you copy a spell,?\s*([^.]+)/i);
  if (youCopySpellMatch && !triggers.some((t) => String(t.description || '').toLowerCase().includes('copy a spell'))) {
    const effectText = timingTriggerEffect(oracleText, youCopySpellMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever you copy a spell, ${effectText}`,
      effect: effectText,
      spellCondition: 'any',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const cycleACardMatch = oracleText.match(/whenever you cycle a card,?\s*([^.]+)/i);
  if (cycleACardMatch && !triggers.some((t) => String(t.description || '').toLowerCase().includes('cycle a card'))) {
    const effectText = timingTriggerEffect(oracleText, cycleACardMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever you cycle a card, ${effectText}`,
      effect: effectText,
      spellCondition: 'any',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const cycleAnotherCardMatch = oracleText.match(/whenever you cycle another card,?\s*([^.]+)/i);
  if (cycleAnotherCardMatch && !triggers.some((t) => String(t.description || '').toLowerCase().includes('cycle another card'))) {
    const effectText = timingTriggerEffect(oracleText, cycleAnotherCardMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever you cycle another card, ${effectText}`,
      effect: effectText,
      spellCondition: 'any',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const cycleThisCardMatch = oracleText.match(/when(?:ever)? you cycle this card,?\s*([^.]+)/i);
  if (cycleThisCardMatch && !triggers.some((t) => String(t.description || '').toLowerCase().includes('cycle this card'))) {
    const effectText = timingTriggerEffect(oracleText, cycleThisCardMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `When you cycle this card, ${effectText}`,
      effect: effectText,
      spellCondition: 'any',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const youPlayACardMatch = oracleText.match(/whenever you play a card(?:,?\s*if\s+[^,]+)?,?\s*([^.]+)/i);
  if (youPlayACardMatch && !triggers.some((t) => String(t.description || '').toLowerCase().includes('you play a card'))) {
    const effectText = timingTriggerEffect(oracleText, youPlayACardMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever you play a card, ${effectText}`,
      effect: effectText,
      spellCondition: 'any',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const youPlayACardThisWayMatch = oracleText.match(/when you play a card this way,?\s*([^.]+)/i);
  if (youPlayACardThisWayMatch && !triggers.some((t) => String(t.description || '').toLowerCase().includes('play a card this way'))) {
    const effectText = timingTriggerEffect(oracleText, youPlayACardThisWayMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `When you play a card this way, ${effectText}`,
      effect: effectText,
      spellCondition: 'any',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  // Self-cast / Storm / Cascade ("When you cast this spell") are NOT permanent
  // spell-cast watchers. They fire only via resolveOnCastSpellTriggerDescriptions
  // when that card is cast as a spell. Registering them here with spellCondition
  // 'any' incorrectly re-fires Hatut/Storm/Cascade from battlefield permanents
  // whenever you cast any later spell (G1: Beast Within after Hatut copies).


  const getSpellCastConditionData = (spellType: string): Pick<SpellCastTrigger, 'spellCondition' | 'tribalType'> => {
    let spellCondition: SpellCastTrigger['spellCondition'] = 'any';
    let tribalType: string | undefined;

    const normalizedType = spellType.replace(/\s+/g, ' ').trim();
    if (normalizedType === 'creature' || (normalizedType.includes('creature') && !normalizedType.includes('noncreature'))) {
      spellCondition = 'creature';
    } else if (normalizedType === 'noncreature' || normalizedType.includes('noncreature')) {
      spellCondition = 'noncreature';
    } else if (normalizedType === 'colorless') {
      spellCondition = 'colorless';
    } else if (normalizedType === 'historic') {
      spellCondition = 'historic';
    } else if (
      normalizedType === 'instant' ||
      normalizedType === 'sorcery' ||
      normalizedType === 'instant or sorcery' ||
      /^instant,?\s*sorcery(?:,?\s*or\s+[\w\s]+)?$/i.test(normalizedType)
    ) {
      spellCondition = 'instant_sorcery';
      const wizardMatch = normalizedType.match(/or\s+(\w+)\s*$/i);
      if (wizardMatch && !['spell', 'sorcery', 'instant'].includes(wizardMatch[1].toLowerCase())) {
        spellCondition = 'tribal_type';
        tribalType = wizardMatch[1].toLowerCase();
      }
    } else if (['green', 'blue', 'red', 'white', 'black'].includes(normalizedType)) {
      spellCondition = 'color';
      tribalType = normalizedType;
    } else if (!['a', 'an', 'spell', ''].includes(normalizedType)) {
      spellCondition = 'tribal_type';
      tribalType = normalizedType;
    }

    return { spellCondition, tribalType };
  };

  const getSpellCastEffectMetadata = (effectText: string, tribalType?: string) => {
    const copiesSpell = effectText.toLowerCase().includes('copy that spell') || effectText.toLowerCase().includes('copy it');
    const isTapUntap = lowerOracle.includes('tap or untap') ||
      lowerOracle.includes('untap target') ||
      lowerOracle.includes('tap target');
    const tokenMatch = effectText.match(/create (?:a |an )?(\d+)\/(\d+)[^.]*token/i);
    let createsToken = false;
    let tokenDetails: SpellCastTrigger['tokenDetails'];

    if (tokenMatch || lowerOracle.includes('create a') && lowerOracle.includes('token')) {
      createsToken = true;
      const tokenPowerMatch = effectText.match(/(\d+)\/(\d+)/);
      if (tokenPowerMatch) {
        const typeMatch = effectText.match(/(\d+\/\d+)\s+(white|blue|black|red|green|colorless)?\s*((?:\w+\s+)*\w+)\s+(?:artifact\s+)?creature\s+token/i);
        const tokenColor = String(typeMatch?.[2] || '').trim().toLowerCase();
        const rawTokenType = String(typeMatch?.[3] || tribalType || 'Token').trim();
        const tokenTypeDisplay = rawTokenType
          .split(/\s+/)
          .filter(Boolean)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
          .join(' ') || 'Token';
        const abilityMatch = effectText.match(/token\s+with\s+([^.]+)/i);
        const abilities = abilityMatch
          ? abilityMatch[1]
              .split(/\s+and\s+|,\s*/i)
              .map((ability) => ability.trim().toLowerCase().replace(/^"+|"+$/g, '').replace(/\.$/, ''))
              .filter(Boolean)
          : undefined;
        const isArtifact = effectText.toLowerCase().includes('artifact creature token');

        tokenDetails = {
          // Color belongs on `colors`, not the display name ("Blue Merfolk" → "Merfolk").
          name: tokenTypeDisplay,
          power: parseInt(tokenPowerMatch[1]),
          toughness: parseInt(tokenPowerMatch[2]),
          types: `${isArtifact ? 'Artifact ' : ''}Creature — ${tokenTypeDisplay}`,
          ...(tokenColor ? { colors: [tokenColor] } : {}),
          abilities,
        };
      }
    }

    return {
      copiesSpell,
      isTapUntap,
      createsToken,
      tokenDetails,
      isOptional: effectText.toLowerCase().includes('you may'),
    };
  };

  const castUsingProducedManaMatch = oracleText.match(
    /whenever you cast an (?:artifact or creature|creature or artifact) spell using mana produced by ([^,]+),?\s*([^.]+)/i,
  );
  if (
    castUsingProducedManaMatch &&
    !triggers.some((trigger) => trigger.spellCondition === 'artifact_or_creature' && trigger.requiresManaFromPermanentId === permanentId)
  ) {
    const effectText = timingTriggerEffect(oracleText, castUsingProducedManaMatch, 2).trim();
    const { createsToken } = getSpellCastEffectMetadata(effectText);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever you cast an artifact or creature spell using mana produced by ${String(castUsingProducedManaMatch[1] || cardName).trim()}, ${effectText}`,
      effect: effectText,
      spellCondition: 'artifact_or_creature',
      requiresManaFromPermanentId: permanentId,
      createsToken,
      mandatory: true,
    });
  }
  
  const creatureSpellMinPowerMatch = oracleText.match(
    /(?:when|whenever) you cast a creature spell with power (\d+) or greater,?\s*([^.]+)/i,
  );
  if (
    creatureSpellMinPowerMatch &&
    !triggers.some((t) => t.minSpellPower != null && t.spellCondition === 'creature')
  ) {
    const minSpellPower = parseInt(creatureSpellMinPowerMatch[1], 10);
    const effectText = timingTriggerEffect(oracleText, creatureSpellMinPowerMatch, 2).trim();
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever you cast a creature spell with power ${minSpellPower} or greater, ${effectText}`,
      effect: effectText,
      spellCondition: 'creature',
      minSpellPower: Number.isFinite(minSpellPower) ? minSpellPower : undefined,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  // Pattern: "When/Whenever you cast a [TYPE] spell, [EFFECT]"
  const spellCastPatterns = [
    // Multi-word spell types: "nonlegendary creature", "instant or sorcery", tribal names
    /(?:when|whenever) you cast (?:a |an )?(?!this |that )([\w]+(?:\s+[\w]+)*?)\s+spell(?!\s+that\b),?\s*([^.]+)/gi,
    // "Whenever you cast an instant, sorcery, or Wizard spell"
    /(?:when|whenever) you cast an? instant, sorcery, or (\w+) spell,?\s*([^.]+)/gi,
  ];
  
  const untypedSpellCastPatterns = [
    /whenever you cast a spell(?:\s+that\s+targets\s+(?:~|this\s+(?:creature|permanent)))?,?\s*([^.]+)/gi,
    /when you cast a spell,?\s*([^.]+)/gi,
    /whenever you cast two or more spells[^,]*,?\s*([^.]+)/gi,
  ];
  for (const pattern of untypedSpellCastPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const lowerMatchText = String(match[0] || '').toLowerCase();
      if (
        lowerMatchText.includes('spell of the chosen type') ||
        lowerMatchText.includes('spell of that type') ||
        lowerMatchText.includes('spell with the chosen name') ||
        lowerMatchText.includes('spell from your library') ||
        lowerMatchText.includes('spell from your graveyard') ||
        lowerMatchText.includes('spell from exile') ||
        lowerMatchText.includes('spell from anywhere other than your hand')
      ) {
        continue;
      }
      const effectText = extractSpellCastEffect(oracleText, match, 1);
      // Name-specific "that targets ~" clauses are heroic / dedicated detectors.
      // Untyped "whenever you cast a spell, …" must not swallow them as the effect.
      if (/^that targets\b/i.test(String(effectText || '').trim())) {
        continue;
      }
      if (!triggers.some((trigger) => trigger.effect === effectText && trigger.spellCondition === 'any')) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: timingTriggerEffect(oracleText, match, 0),
          effect: effectText,
          spellCondition: 'any',
          mandatory: !effectText.toLowerCase().includes('you may'),
        });
      }
    }
  }

  for (const pattern of spellCastPatterns) {
    let match;
    pattern.lastIndex = 0; // Reset regex
    while ((match = pattern.exec(oracleText)) !== null) {
      const spellType = match[1].toLowerCase();
      const lowerMatchText = String(match[0] || '').toLowerCase();
      if (
        /\byour first\b/.test(spellType) ||
        /\bduring each\b/.test(spellType) ||
        lowerMatchText.includes('your first spell during each opponent') ||
        lowerMatchText.includes('your first spell each turn') ||
        /\bcreature spell with power \d+ or greater\b/.test(lowerMatchText)
      ) {
        continue;
      }
      const normalizedEffect = normalizeSpellCastEffectText(oracleText, match[0], timingTriggerEffect(oracleText, match, 2), match.index);
      const effectText = normalizedEffect.effectText;

      if (
        lowerMatchText.includes('spell of the chosen type') ||
        lowerMatchText.includes('spell from your library') ||
        lowerMatchText.includes('spell from your graveyard') ||
        lowerMatchText.includes('spell from exile') ||
        lowerMatchText.includes('spell from anywhere other than your hand')
      ) {
        continue;
      }
      const { spellCondition, tribalType } = getSpellCastConditionData(spellType);
      const { copiesSpell, isTapUntap, createsToken, tokenDetails } = getSpellCastEffectMetadata(effectText, tribalType);
      
      // Avoid duplicates
      if (!triggers.some((t) =>
        t.effect === effectText &&
        t.spellCondition === spellCondition &&
        t.sourceZoneRequirement === undefined
      )) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: `Whenever you cast ${aOrAnSpellType(tribalType || spellType)}, ${normalizedEffect.optionalPaymentCost ? `you may pay ${normalizedEffect.optionalPaymentCost}. If you do, ${effectText}` : effectText}`,
          effect: effectText,
          spellCondition,
          tribalType,
          requiresTarget: isTapUntap,
          targetType: isTapUntap ? 'permanent' : undefined,
          createsToken,
          tokenDetails,
          copiesSpell,
          optionalPaymentCost: normalizedEffect.optionalPaymentCost,
          mandatory: normalizedEffect.mandatory,
        });
      }
    }
  }

  const sourceQualifiedSpellCastPatterns = [
    {
      pattern: /whenever you cast (?:a |an )?(creature|noncreature|instant|sorcery|instant or sorcery|colorless|\w+) spell from your library,?\s*([^.]+)/gi,
      sourceZoneRequirement: 'library' as const,
    },
    {
      pattern: /whenever you cast (?:a |an )?(creature|noncreature|instant|sorcery|instant or sorcery|colorless|[\w]+(?:\s+[\w]+)*?) spell from (?:your )?graveyard,?\s*([^.]+)/gi,
      sourceZoneRequirement: 'graveyard' as const,
    },
    {
      pattern: /whenever you cast (?:a |an )?(creature|noncreature|instant|sorcery|instant or sorcery|colorless|[\w]+(?:\s+[\w]+)*?) spell from (?:the )?exile,?\s*([^.]+)/gi,
      sourceZoneRequirement: 'exile' as const,
    },
    {
      pattern: /whenever you cast (?:a |an )?(creature|noncreature|instant|sorcery|instant or sorcery|colorless|\w+) spell from exile,?\s*([^.]+)/gi,
      sourceZoneRequirement: 'exile' as const,
    },
    {
      pattern: /whenever you cast (?:a |an )?(creature|noncreature|instant|sorcery|instant or sorcery|colorless|\w+) spell from anywhere other than your hand,?\s*([^.]+)/gi,
      sourceZoneRequirement: 'not_hand' as const,
    },
    {
      pattern: /whenever you cast (?:a |an )?spell from anywhere other than your hand,?\s*([^.]+)/gi,
      sourceZoneRequirement: 'not_hand' as const,
      untypedSpell: true,
    },
    {
      pattern: /\bor you cast (?:a |an )?spell from anywhere other than your hand,?\s*([^.]+)/gi,
      sourceZoneRequirement: 'not_hand' as const,
      untypedSpell: true,
    },
  ];

  for (const entry of sourceQualifiedSpellCastPatterns) {
    const { pattern, sourceZoneRequirement } = entry;
    const untypedSpell = Boolean((entry as { untypedSpell?: boolean }).untypedSpell);
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const spellType = untypedSpell ? 'any' : match[1].toLowerCase();
      const effectCapture = timingTriggerEffect(oracleText, match, untypedSpell ? 1 : 2);
      const normalizedEffect = normalizeSpellCastEffectText(oracleText, match[0], effectCapture, match.index);
      const effectText = normalizedEffect.effectText;
      const { spellCondition, tribalType } = getSpellCastConditionData(spellType);
      const { copiesSpell, isTapUntap, createsToken, tokenDetails } = getSpellCastEffectMetadata(effectText, tribalType);

      if (!triggers.some((trigger) =>
        trigger.effect === effectText &&
        trigger.spellCondition === spellCondition &&
        trigger.sourceZoneRequirement === sourceZoneRequirement &&
        String(trigger.tribalType || '').toLowerCase() === String(tribalType || '').toLowerCase()
      )) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: sourceZoneRequirement === 'library'
            ? `Whenever you cast ${aOrAnSpellType(tribalType || spellType)} from your library, ${normalizedEffect.optionalPaymentCost ? `you may pay ${normalizedEffect.optionalPaymentCost}. If you do, ${effectText}` : effectText}`
            : sourceZoneRequirement === 'graveyard'
              ? `Whenever you cast ${aOrAnSpellType(tribalType || spellType)} from your graveyard, ${normalizedEffect.optionalPaymentCost ? `you may pay ${normalizedEffect.optionalPaymentCost}. If you do, ${effectText}` : effectText}`
            : sourceZoneRequirement === 'exile'
              ? `Whenever you cast ${aOrAnSpellType(tribalType || spellType)} from exile, ${normalizedEffect.optionalPaymentCost ? `you may pay ${normalizedEffect.optionalPaymentCost}. If you do, ${effectText}` : effectText}`
            : `Whenever you cast ${aOrAnSpellType(tribalType || spellType)} from anywhere other than your hand, ${normalizedEffect.optionalPaymentCost ? `you may pay ${normalizedEffect.optionalPaymentCost}. If you do, ${effectText}` : effectText}`,
          effect: effectText,
          spellCondition,
          tribalType,
          copiesSpell,
          sourceZoneRequirement,
          requiresTarget: isTapUntap,
          targetType: isTapUntap ? 'permanent' : undefined,
          createsToken,
          tokenDetails,
          optionalPaymentCost: normalizedEffect.optionalPaymentCost,
          mandatory: normalizedEffect.mandatory,
        });
      }
    }
  }

  const firstSpellEachTurnPatterns = [
    /whenever you cast your first (creature|noncreature|instant|sorcery|instant or sorcery) spell each turn,?\s*([^.]+)/gi,
    /whenever you cast your first (?:a |an )?([\w]+(?:\s+[\w]+)*?) spell each turn,?\s*([^.]+)/gi,
    /whenever you cast your first ([^.]+?) spell each turn,?\s*([^.]+)/gi,
  ];

  for (const pattern of firstSpellEachTurnPatterns) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const spellType = match[1].toLowerCase();
      const effectText = extractSpellCastEffect(oracleText, match, 2);
      const { spellCondition, tribalType } = getSpellCastConditionData(spellType);
      const { copiesSpell, isOptional } = getSpellCastEffectMetadata(effectText, tribalType);

      if (!triggers.some((trigger) =>
        trigger.effect === effectText &&
        trigger.spellCondition === spellCondition &&
        trigger.firstSpellThisTurn === true &&
        String(trigger.tribalType || '').toLowerCase() === String(tribalType || '').toLowerCase()
      )) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: `Whenever you cast your first ${tribalType || spellType} spell each turn, ${effectText}`,
          effect: effectText,
          spellCondition,
          tribalType,
          copiesSpell,
          firstSpellThisTurn: true,
          oncePerTurn: true,
          mandatory: !isOptional,
        });
      }
    }
  }

  const firstSourceQualifiedSpellEachTurnPatterns = [
    {
      pattern: /whenever you cast your first (creature|noncreature|instant|sorcery|instant or sorcery|colorless|\w+) spell from your graveyard each turn,?\s*([^.]+)/gi,
      sourceZoneRequirement: 'graveyard' as const,
    },
  ];

  for (const { pattern, sourceZoneRequirement } of firstSourceQualifiedSpellEachTurnPatterns) {
    let match;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const spellType = match[1].toLowerCase();
      const effectText = extractSpellCastEffect(oracleText, match, 2);
      const { spellCondition, tribalType } = getSpellCastConditionData(spellType);
      const { copiesSpell, isTapUntap, createsToken, tokenDetails, isOptional } = getSpellCastEffectMetadata(effectText, tribalType);

      if (!triggers.some((trigger) =>
        trigger.effect === effectText &&
        trigger.spellCondition === spellCondition &&
        trigger.firstSpellThisTurn === true &&
        trigger.sourceZoneRequirement === sourceZoneRequirement &&
        String(trigger.tribalType || '').toLowerCase() === String(tribalType || '').toLowerCase()
      )) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: `Whenever you cast your first ${tribalType || spellType} spell from your graveyard each turn, ${effectText}`,
          effect: effectText,
          spellCondition,
          tribalType,
          copiesSpell,
          firstSpellThisTurn: true,
          oncePerTurn: true,
          sourceZoneRequirement,
          requiresTarget: isTapUntap,
          targetType: isTapUntap ? 'permanent' : undefined,
          createsToken,
          tokenDetails,
          mandatory: !isOptional,
        });
      }
    }
  }

  const mayCastRevealedWithoutPaying =
    /you may cast (?:it|that card) without paying its mana cost/i.test(lowerOracle);
  const bottomRevealedRemainder =
    /put the rest on the bottom of your library in a random order/i.test(lowerOracle)
    || /put all revealed cards not cast this way on the bottom of your library in a random order/i.test(lowerOracle);

  const hasBottomRevealNonlandPattern =
    lowerOracle.includes('whenever you cast a spell') &&
    lowerOracle.includes('you may put it on the bottom of its owner') &&
    lowerOracle.includes('reveal cards from the top of your library until you reveal a nonland card') &&
    mayCastRevealedWithoutPaying &&
    bottomRevealedRemainder;

  if (hasBottomRevealNonlandPattern) {
    const oncePerTurn = lowerOracle.includes('this ability triggers only once each turn');
    for (let i = triggers.length - 1; i >= 0; i--) {
      if (triggers[i]?.effect?.toLowerCase().includes('you may put it on the bottom of its owner')) {
        triggers.splice(i, 1);
      }
    }

    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description:
        'Whenever you cast a spell, you may put it on the bottom of its owner\'s library. If you do, reveal cards from the top of your library until you reveal a nonland card. You may cast that card without paying its mana cost. Then put all revealed cards not cast this way on the bottom of your library in a random order.',
      effect:
        'you may put it on the bottom of its owner\'s library. If you do, reveal cards from the top of your library until you reveal a nonland card. You may cast that card without paying its mana cost. Then put all revealed cards not cast this way on the bottom of your library in a random order.',
      spellCondition: 'any',
      oncePerTurn,
      replacementEffect: {
        kind: 'bottom_spell_reveal_until_nonland',
        revealFromLibraryOf: 'controller',
        castWithoutPayingManaCost: true,
        randomizeBottomRemainder: true,
      },
      mandatory: false,
    });
  }
  
  // Beast Whisperer pattern: "Whenever you cast a creature spell, draw a card"
  if (lowerOracle.includes('whenever you cast a creature spell') && 
      lowerOracle.includes('draw a card') &&
      !triggers.some(t => t.spellCondition === 'creature' && t.effect.includes('draw'))) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: "Whenever you cast a creature spell, draw a card",
      effect: "draw a card",
      spellCondition: 'creature',
      mandatory: true,
    });
  }
  
  // Prowess is a creature keyword. Do not treat Equipment/Aura grant text
  // ("Equipped creature has prowess") as prowess on the attachment itself.
  const typeLineLower = String(card?.type_line || permanent?.card?.type_line || '').toLowerCase();
  const isDefinitelyNonCreature = Boolean(typeLineLower) && !typeLineLower.includes('creature');
  const canHaveProwess = !isDefinitelyNonCreature;
  const battlefield = Array.isArray((state as any)?.battlefield) ? (state as any).battlefield : [];
  const hasPrintedProwess = canHaveProwess && (
    /(^|\n)\s*prowess\b/i.test(oracleText)
    || /\bprowess\s*\(/i.test(oracleText)
  );
  // Explicit keyword line / keyword ability — not lord/attachment grant sentences.
  const hasNativeProwessKeyword = canHaveProwess && (
    hasPrintedProwess
    || (
      /\bprowess\b/i.test(oracleText)
      && !/\bcreatures you control have\b[^.]*\bprowess\b/i.test(oracleText)
      && !/\bequipped creature has\b[^.]*\bprowess\b/i.test(oracleText)
      && !/\benchanted creature has\b[^.]*\bprowess\b/i.test(oracleText)
    )
  );
  const hasGrantedProwess = canHaveProwess && (
    permanentHasAttachmentGrantedKeyword(permanent, battlefield, 'prowess')
    || controllerGrantsKeywordToCreatures(battlefield, controllerId, 'prowess')
    || (Array.isArray(permanent?.grantedAbilities)
      && permanent.grantedAbilities.some((a: unknown) => String(a || '').toLowerCase().includes('prowess')))
    || (Array.isArray(permanent?.grantedKeywords)
      && permanent.grantedKeywords.some((a: unknown) => String(a || '').toLowerCase() === 'prowess'))
  );

  if (hasNativeProwessKeyword || hasGrantedProwess) {
    const prowessEffect = 'This creature gets +1/+1 until end of turn.';
    if (!triggers.some((t) => t.spellCondition === 'noncreature' && t.effect === prowessEffect)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: 'Whenever you cast a noncreature spell, this creature gets +1/+1 until end of turn.',
        effect: prowessEffect,
        spellCondition: 'noncreature',
        mandatory: true,
      });
    }
  }

  const anotherSpellWithKeywordMatch = oracleText.match(
    /whenever you cast another spell that has (\w+),?\s*([^.]+)/i,
  );
  if (anotherSpellWithKeywordMatch) {
    const keyword = String(anotherSpellWithKeywordMatch[1] || '').trim().toLowerCase();
    const effectText = timingTriggerEffect(oracleText, anotherSpellWithKeywordMatch, 2);
    if (
      effectText &&
      !triggers.some((t) => t.effect === effectText && t.spellCondition === 'any' && t.tribalType === keyword)
    ) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: `Whenever you cast another spell that has ${keyword}, ${effectText}`,
        effect: effectText,
        spellCondition: 'any',
        tribalType: keyword,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  // Magecraft pattern (Archmage Emeritus)
  if (lowerOracle.includes('magecraft') || 
      (lowerOracle.includes('whenever you cast or copy') && lowerOracle.includes('instant or sorcery'))) {
    const effectMatch = oracleText.match(/(?:magecraft\s*[—-]\s*)?whenever you cast or copy an instant or sorcery spell,?\s*([^.]+)/i);
    if (effectMatch && !triggers.some((t) => t.effect === timingTriggerEffect(oracleText, effectMatch))) {
      const magecraftEffect = timingTriggerEffect(oracleText, effectMatch);
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: `Magecraft — Whenever you cast or copy an instant or sorcery spell, ${magecraftEffect}`,
        effect: magecraftEffect,
        spellCondition: 'instant_sorcery',
        mandatory: true,
      });
    }
  }

  // "Whenever you cast a spell of the chosen color, ..."
  {
    const chosenColorSpellPattern = /whenever you cast a spell of the chosen colou?r,?\s*([^.]+)/gi;
    let chosenMatch: RegExpExecArray | null;
    chosenColorSpellPattern.lastIndex = 0;
    while ((chosenMatch = chosenColorSpellPattern.exec(oracleText)) !== null) {
      const effectText = String(chosenMatch[1] || '').trim();
      if (!effectText) continue;
      if (!triggers.some((trigger) => trigger.spellCondition === 'chosen_color' && trigger.effect === effectText)) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: `Whenever you cast a spell of the chosen color, ${effectText}`,
          effect: effectText,
          spellCondition: 'chosen_color',
          mandatory: true,
        });
      }
    }
  }

  const coloredSpellOrLandfallPatterns = [
    /whenever you cast a (green|blue|red|white|black) spell(?:\s+or\b)/gi,
  ];
  for (const pattern of coloredSpellOrLandfallPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const color = String(match[1] || '').toLowerCase();
      const afterMatch = oracleText.slice(match.index + match[0].length);
      const orLandfall = afterMatch.match(/^\s*or\s+([^.]+)/i);
      const spellOnlyEffect = 'you gain 1 life';
      const effectText = orLandfall
        ? `${match[0].trim()} or ${orLandfall[1].trim()}`
        : spellOnlyEffect;
      if (!triggers.some((trigger) => trigger.spellCondition === 'color' && trigger.tribalType === color)) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: `Whenever you cast ${aOrAnSpellType(color)}${orLandfall ? ` or ${orLandfall[1].trim()}` : ''}`,
          effect: effectText,
          spellCondition: 'color',
          tribalType: color,
          mandatory: true,
        });
      }
    }
  }

  const firstSpellDuringOpponentTurnMatch = oracleText.match(
    /whenever you cast your first spell during each opponent's turn,?\s*([^.]+)/gi,
  );
  if (firstSpellDuringOpponentTurnMatch) {
    for (const rawMatch of firstSpellDuringOpponentTurnMatch) {
      const effectMatch = /whenever you cast your first spell during each opponent's turn,?\s*([^.]+)/i.exec(rawMatch);
      if (!effectMatch) continue;
      const effectText = extractSpellCastEffect(oracleText, effectMatch, 1);
      if (!triggers.some((trigger) => trigger.effect === effectText && trigger.firstSpellDuringOpponentTurn)) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: `Whenever you cast your first spell during each opponent's turn, ${effectText}`,
          effect: effectText,
          spellCondition: 'any',
          firstSpellDuringOpponentTurn: true,
          oncePerTurn: true,
          mandatory: !effectText.toLowerCase().includes('you may'),
        });
      }
    }
  }

  const firstSpellEachTurnUntypedMatch = oracleText.match(/whenever you cast your first spell each turn,?\s*([^.]+)/gi);
  if (firstSpellEachTurnUntypedMatch) {
    for (const rawMatch of firstSpellEachTurnUntypedMatch) {
      const effectMatch = /whenever you cast your first spell each turn,?\s*([^.]+)/i.exec(rawMatch);
      if (!effectMatch) continue;
      const effectText = extractSpellCastEffect(oracleText, effectMatch, 1);
      if (!triggers.some((trigger) => trigger.effect === effectText && trigger.firstSpellThisTurn && trigger.spellCondition === 'any')) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: `Whenever you cast your first spell each turn, ${effectText}`,
          effect: effectText,
          spellCondition: 'any',
          firstSpellThisTurn: true,
          oncePerTurn: true,
          mandatory: !effectText.toLowerCase().includes('you may'),
        });
      }
    }
  }

  const castInstantOrSorceryWithoutSpellWord = oracleText.match(
    /whenever you cast an? (instant|sorcery)(?! or )\b,?\s*([^.]+)/gi,
  );
  if (castInstantOrSorceryWithoutSpellWord) {
    for (const rawMatch of castInstantOrSorceryWithoutSpellWord) {
      const lowerRaw = String(rawMatch || '').toLowerCase();
      if (/\bspell\b/.test(lowerRaw) || /\binstant or sorcery\b/.test(lowerRaw)) {
        continue;
      }
      const effectMatch = /whenever you cast an? (instant|sorcery)(?! or )\b,?\s*([^.]+)/i.exec(rawMatch);
      if (!effectMatch) continue;
      const effectText = extractSpellCastEffect(oracleText, effectMatch, 2);
      if (!triggers.some((trigger) => trigger.effect === effectText && trigger.spellCondition === 'instant_sorcery')) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: `Whenever you cast an ${effectMatch[1]}, ${effectText}`,
          effect: effectText,
          spellCondition: 'instant_sorcery',
          mandatory: !effectText.toLowerCase().includes('you may'),
        });
      }
    }
  }

  const nextCastPatterns = [
    /you next cast an? ([\w\s]+?) spell this turn/gi,
    /you next cast an? ([\w\s]+?) spell with mana value (\d+) or less this turn/gi,
  ];
  for (const pattern of nextCastPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const rawType = String(match[1] || 'spell').trim().toLowerCase();
      const { spellCondition, tribalType } = getSpellCastConditionData(rawType);
      const effectText = timingTriggerEffect(oracleText, match, 0);
      if (!triggers.some((trigger) => trigger.effect === effectText)) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: effectText,
          effect: effectText,
          spellCondition,
          tribalType,
          mandatory: true,
        });
      }
    }
  }

  const manaCostQualifierPattern = /whenever you cast (?:your first )?(?:a |an )?([\w\s]*?) spell with (\{[^}]+\}) in its mana cost each turn,?\s*([^.]+)/gi;
  let manaCostMatch: RegExpExecArray | null;
  manaCostQualifierPattern.lastIndex = 0;
  while ((manaCostMatch = manaCostQualifierPattern.exec(oracleText)) !== null) {
    const rawType = String(manaCostMatch[1] || 'spell').trim().toLowerCase() || 'spell';
    const { spellCondition, tribalType } = getSpellCastConditionData(rawType);
    const effectText = extractSpellCastEffect(oracleText, manaCostMatch, 3);
    if (!triggers.some((trigger) => trigger.effect === effectText)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: timingTriggerEffect(oracleText, manaCostMatch, 0),
        effect: effectText,
        spellCondition,
        tribalType,
        oncePerTurn: true,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const castFromHandPattern = /whenever you cast (?:a |an )?spell from your hand,?\s*([^.]+)/gi;
  let castFromHandMatch: RegExpExecArray | null;
  castFromHandPattern.lastIndex = 0;
  while ((castFromHandMatch = castFromHandPattern.exec(oracleText)) !== null) {
    const effectText = extractSpellCastEffect(oracleText, castFromHandMatch, 1);
    if (!triggers.some((trigger) => trigger.effect === effectText && trigger.sourceZoneRequirement === 'hand')) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: timingTriggerEffect(oracleText, castFromHandMatch, 0),
        effect: effectText,
        spellCondition: 'any',
        sourceZoneRequirement: 'hand',
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const playLandOrCastPatterns = [
    /whenever you play a land or cast a spell,?\s*([^.]+)/gi,
    /whenever you play a land from exile or cast a spell from exile,?\s*([^.]+)/gi,
  ];
  for (const pattern of playLandOrCastPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effectText = extractSpellCastEffect(oracleText, match, 1);
      const isFromExile = /from exile/i.test(match[0]);
      if (!triggers.some((trigger) => trigger.effect === effectText)) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: timingTriggerEffect(oracleText, match, 0),
          effect: effectText,
          spellCondition: 'any',
          sourceZoneRequirement: isFromExile ? 'exile' : undefined,
          mandatory: !effectText.toLowerCase().includes('you may'),
        });
      }
    }
  }

  const playtestCastMatch = oracleText.match(/whenever you cast a playtest card,?\s*([^.]+)/i);
  if (playtestCastMatch) {
    const effectText = extractSpellCastEffect(oracleText, playtestCastMatch, 1);
    if (!triggers.some((trigger) => trigger.effect === effectText)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: timingTriggerEffect(oracleText, playtestCastMatch, 0),
        effect: effectText,
        spellCondition: 'tribal_type',
        tribalType: 'playtest',
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const entersAndCastMatch = oracleText.match(
    /when (?:~|this (?:creature|permanent)|[\w ,']+?) enters(?: the battlefield)? and whenever you cast (?:a |an )?([\w\s]+?) spell,?\s*([^.]+)/i,
  );
  if (entersAndCastMatch) {
    const rawType = String(entersAndCastMatch[1] || '').trim().toLowerCase();
    const { spellCondition, tribalType } = getSpellCastConditionData(rawType);
    const effectText = extractSpellCastEffect(oracleText, entersAndCastMatch, 2);
    if (!triggers.some((trigger) => trigger.effect === effectText && trigger.spellCondition === spellCondition)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: `Whenever you cast ${aOrAnSpellType(tribalType || rawType || 'spell')}, ${effectText}`,
        effect: effectText,
        spellCondition,
        tribalType,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const typedNoncreatureSelfCastPatterns = [
    /whenever you cast an? artifact, instant, or sorcery spell,?\s*([^.]+)/gi,
  ];
  for (const pattern of typedNoncreatureSelfCastPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effectText = extractSpellCastEffect(oracleText, match, 1);
      const copiesSpell = effectText.toLowerCase().includes('copy that spell') || effectText.toLowerCase().includes('copy it');
      if (!triggers.some((trigger) => trigger.effect === effectText && trigger.spellCondition === 'instant_sorcery')) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: timingTriggerEffect(oracleText, match, 0),
          effect: effectText,
          spellCondition: 'instant_sorcery',
          copiesSpell,
          mandatory: !effectText.toLowerCase().includes('you may'),
        });
      }
    }
  }

  const spellOfThatTypePattern = /whenever you cast a spell of that type this turn,?\s*([^.]+)/gi;
  let spellOfThatTypeMatch: RegExpExecArray | null;
  spellOfThatTypePattern.lastIndex = 0;
  while ((spellOfThatTypeMatch = spellOfThatTypePattern.exec(oracleText)) !== null) {
    const effectText = extractSpellCastEffect(oracleText, spellOfThatTypeMatch, 1);
    if (!triggers.some((trigger) => trigger.effect === effectText)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: timingTriggerEffect(oracleText, spellOfThatTypeMatch, 0),
        effect: effectText,
        spellCondition: 'any',
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const castFromThisPatterns = [
    /whenever you cast (?:a |an )?(creature|noncreature|instant|sorcery|[\w]+(?:\s+[\w]+)*?) spell from this(?: spell)?,?\s*([^.]+)/gi,
    /whenever you cast (?:a |an )?(creature|noncreature|instant|sorcery|[\w]+(?:\s+[\w]+)*?) spell from this (?:creature|permanent),?\s*([^.]+)/gi,
    /whenever you cast (?:a |an )?(creature|noncreature|instant|sorcery|[\w]+(?:\s+[\w]+)*?) spell from the (?:battlefield|stack),?\s*([^.]+)/gi,
  ];
  for (const pattern of castFromThisPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const rawType = String(match[1] || 'spell').trim().toLowerCase();
      const { spellCondition, tribalType } = getSpellCastConditionData(rawType);
      const effectText = extractSpellCastEffect(oracleText, match, 2);
      if (!triggers.some((trigger) => trigger.effect === effectText && trigger.description === match[0].trim())) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: timingTriggerEffect(oracleText, match, 0),
          effect: effectText,
          spellCondition,
          tribalType,
          mandatory: !effectText.toLowerCase().includes('you may'),
        });
      }
    }
  }

  const commanderCastMatch = oracleText.match(/(?:when|whenever) you cast your commander,?\s*([^.]+)/i);
  if (commanderCastMatch) {
    const effectText = extractSpellCastEffect(oracleText, commanderCastMatch, 1);
    if (!triggers.some((trigger) => trigger.effect === effectText)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: `Whenever you cast your commander, ${effectText}`,
        effect: effectText,
        spellCondition: 'any',
        tribalType: 'commander',
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const castShortTypePatterns = [
    /whenever you cast a (blue|green|red|white|black|cat|dog|kraken|pegasus|lesson)(?:\s+spell)?,?\s*([^.]+)/gi,
    /whenever you cast an (aura|artifact|enchantment|instant(?!\s+or\s+sorcery)|sorcery)(?:\s+spell)?,?\s*([^.]+)/gi,
  ];
  for (const pattern of castShortTypePatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const lowerMatchText = String(match[0] || '').toLowerCase();
      if (/\binstant or sorcery\b/.test(lowerMatchText)) {
        continue;
      }
      const rawType = String(match[1] || '').trim().toLowerCase();
      const effectText = extractSpellCastEffect(oracleText, match, 2);
      const { spellCondition, tribalType } = getSpellCastConditionData(rawType);
      if (!triggers.some((trigger) =>
        trigger.effect === effectText &&
        trigger.spellCondition === spellCondition &&
        String(trigger.tribalType || '').toLowerCase() === String(tribalType || '').toLowerCase()
      )) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: timingTriggerEffect(oracleText, match, 0),
          effect: effectText,
          spellCondition,
          tribalType,
          mandatory: !effectText.toLowerCase().includes('you may'),
        });
      }
    }
  }

  const firstTribalSpellPattern =
    /whenever you cast your first (?:a |an )?([\w]+) spell each turn,?\s*([^.]+)/gi;
  let firstTribalMatch: RegExpExecArray | null;
  firstTribalSpellPattern.lastIndex = 0;
  while ((firstTribalMatch = firstTribalSpellPattern.exec(oracleText)) !== null) {
    const rawType = String(firstTribalMatch[1] || '').trim().toLowerCase();
    const effectText = extractSpellCastEffect(oracleText, firstTribalMatch, 2);
    const { spellCondition, tribalType } = getSpellCastConditionData(rawType);
    if (!triggers.some((trigger) =>
      trigger.effect === effectText &&
      trigger.firstSpellThisTurn === true &&
      String(trigger.tribalType || '').toLowerCase() === String(tribalType || '').toLowerCase()
    )) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: timingTriggerEffect(oracleText, firstTribalMatch, 0),
        effect: effectText,
        spellCondition,
        tribalType,
        firstSpellThisTurn: true,
        oncePerTurn: true,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const castDuringYourTurnsPattern =
    /whenever you cast (?:a |an )?([\w\s]*?)spell during each of your turns,?\s*([^.]+)/gi;
  let castDuringTurnsMatch: RegExpExecArray | null;
  castDuringYourTurnsPattern.lastIndex = 0;
  while ((castDuringTurnsMatch = castDuringYourTurnsPattern.exec(oracleText)) !== null) {
    const rawType = String(castDuringTurnsMatch[1] || 'spell').trim().toLowerCase() || 'spell';
    const effectText = extractSpellCastEffect(oracleText, castDuringTurnsMatch, 2);
    const { spellCondition, tribalType } = getSpellCastConditionData(rawType);
    if (!triggers.some((trigger) => trigger.effect === effectText && trigger.description === castDuringTurnsMatch[0].trim())) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: timingTriggerEffect(oracleText, castDuringTurnsMatch, 0),
        effect: effectText,
        spellCondition,
        tribalType,
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const castOrCyclePattern = /when(?:ever)? you cast or cycle ([^,]+),?\s*([^.]+)/gi;
  let castOrCycleMatch: RegExpExecArray | null;
  castOrCyclePattern.lastIndex = 0;
  while ((castOrCycleMatch = castOrCyclePattern.exec(oracleText)) !== null) {
    const effectText = extractSpellCastEffect(oracleText, castOrCycleMatch, 2);
    if (!triggers.some((trigger) => trigger.effect === effectText)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: timingTriggerEffect(oracleText, castOrCycleMatch, 0),
        effect: effectText,
        spellCondition: 'any',
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const castItThisTurnMatch = oracleText.match(/when(?:ever)? you cast it this turn,?\s*([^.]+)/i);
  if (castItThisTurnMatch) {
    const effectText = extractSpellCastEffect(oracleText, castItThisTurnMatch, 1);
    if (!triggers.some((trigger) => trigger.effect === effectText)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: timingTriggerEffect(oracleText, castItThisTurnMatch, 0),
        effect: effectText,
        spellCondition: 'any',
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const castEnchantedCardMatch = oracleText.match(/when(?:ever)? you cast enchanted card,?\s*([^.]+)/i);
  if (castEnchantedCardMatch) {
    const effectText = extractSpellCastEffect(oracleText, castEnchantedCardMatch, 1);
    if (!triggers.some((trigger) => trigger.effect === effectText)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: timingTriggerEffect(oracleText, castEnchantedCardMatch, 0),
        effect: effectText,
        spellCondition: 'any',
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const castFromExileAmongPattern =
    /whenever you cast (?:a |an )?spell from among (?:the )?cards (?:they don't own )?exiled with [^,]+,?\s*([^.]+)/gi;
  let castFromExileAmongMatch: RegExpExecArray | null;
  castFromExileAmongPattern.lastIndex = 0;
  while ((castFromExileAmongMatch = castFromExileAmongPattern.exec(oracleText)) !== null) {
    const effectText = extractSpellCastEffect(oracleText, castFromExileAmongMatch, 1);
    if (!triggers.some((trigger) => trigger.effect === effectText && trigger.sourceZoneRequirement === 'exile')) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: timingTriggerEffect(oracleText, castFromExileAmongMatch, 0),
        effect: effectText,
        spellCondition: 'any',
        sourceZoneRequirement: 'exile',
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const castSpellFromThatMatch = oracleText.match(/whenever you cast (?:a |an )?spell from that,?\s*([^.]+)/i);
  if (castSpellFromThatMatch) {
    const effectText = extractSpellCastEffect(oracleText, castSpellFromThatMatch, 1);
    if (!triggers.some((trigger) => trigger.effect === effectText)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: timingTriggerEffect(oracleText, castSpellFromThatMatch, 0),
        effect: effectText,
        spellCondition: 'any',
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const landOrCastPatterns = [
    /whenever a player plays a land or casts a spell(?:,?\s*if\s+[^,]+)?,?\s*([^.]+)/gi,
    /whenever an opponent plays a land or casts a spell(?:,?\s*if\s+[^,]+)?,?\s*([^.]+)/gi,
  ];
  for (const pattern of landOrCastPatterns) {
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;
    while ((match = pattern.exec(oracleText)) !== null) {
      const effectText = extractSpellCastEffect(oracleText, match, 1);
      if (!triggers.some((trigger) => trigger.effect === effectText && trigger.description === match[0].trim())) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: timingTriggerEffect(oracleText, match, 0),
          effect: effectText,
          spellCondition: 'any',
          mandatory: !effectText.toLowerCase().includes('you may'),
        });
      }
    }
  }

  const namedCardCastPattern = new RegExp(
    `when you cast ${escapeCardNameForRegex(cardName)},?\\s*([^.]+)`,
    'i',
  );
  const namedCardCastMatch = oracleText.match(namedCardCastPattern);
  if (namedCardCastMatch) {
    const effectText = extractSpellCastEffect(oracleText, namedCardCastMatch, 1);
    if (!triggers.some((trigger) => trigger.effect === effectText)) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: timingTriggerEffect(oracleText, namedCardCastMatch, 0),
        effect: effectText,
        spellCondition: 'any',
        tribalType: cardName.toLowerCase(),
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }

  const chosenType = String((permanent as any)?.chosenCreatureType || '').trim();
  if (chosenType && lowerOracle.includes('whenever you cast a spell of the chosen type')) {
    const effectMatch = /whenever you cast a spell of the chosen type,?\s*([^.]+)/i.exec(oracleText);
    if (effectMatch) {
      let effect = String(effectMatch[1] || '').trim();
      const lowerEffect = effect.toLowerCase();
      if (
        (lowerEffect.includes('copy that spell') || lowerEffect.includes('copy it'))
        && !lowerEffect.includes('choose new targets for the copy')
        && /you may choose new targets? for the copy\.?/i.test(oracleText)
      ) {
        effect = `${effect} You may choose new targets for the copy.`.trim();
      }
      const copiesSpell = effect.toLowerCase().includes('copy that spell') || effect.toLowerCase().includes('copy it');
      const chosenTypeLower = chosenType.toLowerCase();

      if (!triggers.some((trigger) =>
        trigger.effect === effect &&
        trigger.spellCondition === 'tribal_type' &&
        String(trigger.tribalType || '').toLowerCase() === chosenTypeLower
      )) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: `Whenever you cast ${aOrAnSpellType(chosenType)}, ${effect}`,
          effect,
          spellCondition: 'tribal_type',
          tribalType: chosenType,
          copiesSpell,
          mandatory: !effect.toLowerCase().includes('you may'),
        });
      }
    }
  }
  
  return triggers;
}

/**
 * Get all spell-cast triggers that should fire when a spell is cast
 */
export function getSpellCastTriggers(
  ctx: GameContext,
  casterId: string,
  spellCard: any
): SpellCastTrigger[] {
  const triggers: SpellCastTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  const spellTypeLine = (spellCard?.type_line || '').toLowerCase();
  const isCreatureSpell = spellTypeLine.includes('creature');
  const isInstantOrSorcery = spellTypeLine.includes('instant') || spellTypeLine.includes('sorcery');
  const isHistoricSpell = spellTypeLine.includes('artifact') || spellTypeLine.includes('legendary') || spellTypeLine.includes('saga');
  const spellColors = Array.isArray(spellCard?.colors)
    ? spellCard.colors.map((color: string) => String(color).toLowerCase())
    : (Array.isArray(spellCard?.color_identity) ? spellCard.color_identity.map((color: string) => String(color).toLowerCase()) : []);
  // Check if this is a Kindred/Tribal spell (e.g., "Kindred Sorcery — Merfolk")
  const isKindredOrTribal = spellTypeLine.includes('kindred') || spellTypeLine.includes('tribal');
  
  // Extract creature types from the spell (for tribal triggers)
  // This works for both creature spells and Kindred/Tribal spells
  const spellCreatureTypes = extractCreatureTypes(spellTypeLine);
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    if (permanent.controller !== casterId) continue; // Only controller's permanents trigger
    
    const permTriggers = detectSpellCastTriggers(permanent.card, permanent, ctx.state);
    
    for (const trigger of permTriggers) {
      let shouldTrigger = false;
      
      switch (trigger.spellCondition) {
        case 'any':
          shouldTrigger = true;
          break;
        case 'creature':
          shouldTrigger = isCreatureSpell;
          break;
        case 'noncreature':
          shouldTrigger = !isCreatureSpell;
          break;
        case 'instant_sorcery':
          shouldTrigger = isInstantOrSorcery;
          break;
        case 'historic':
          shouldTrigger = isHistoricSpell;
          break;
        case 'artifact_or_creature':
          shouldTrigger = isCreatureSpell || spellTypeLine.includes('artifact');
          break;
        case 'tribal_type':
          // Check if the spell has the tribal type.
          // This includes:
          // 1. Creature spells with the subtype (e.g., "Creature — Merfolk Wizard")
          // 2. Kindred/Tribal spells with the subtype (e.g., "Kindred Sorcery — Merfolk")
          // 3. Cards with changeling, which have every creature type in every zone
          if (trigger.tribalType) {
            const tribalTypeLower = trigger.tribalType.toLowerCase();
            shouldTrigger = cardHasCreatureType(spellCard, tribalTypeLower)
              || spellCreatureTypes.includes(tribalTypeLower)
              || spellTypeLine.includes(tribalTypeLower);
            
            // Debug log for troubleshooting
            if (shouldTrigger) {
              debug(2, `[getSpellCastTriggers] Tribal trigger fired: ${trigger.cardName} for ${tribalTypeLower} spell`);
            }
          }
          break;
        case 'color':
          if (trigger.tribalType) {
            shouldTrigger = spellColors.includes(trigger.tribalType.toLowerCase());
          }
          break;
        case 'chosen_color': {
          const chosen = String(
            (permanent as any).chosenColor
            || (permanent as any).card?.chosenColor
            || '',
          ).trim().toLowerCase();
          const colorWordToSymbol: Record<string, string> = {
            white: 'w', blue: 'u', black: 'b', red: 'r', green: 'g',
            w: 'w', u: 'u', b: 'b', r: 'r', g: 'g',
          };
          const chosenSymbol = colorWordToSymbol[chosen] || chosen;
          const effectiveSpellColors = getEffectiveColors(spellCard, ctx.state).map((c) => c.toLowerCase());
          shouldTrigger = Boolean(chosenSymbol) && (
            effectiveSpellColors.includes(chosen)
            || effectiveSpellColors.includes(chosenSymbol)
          );
          break;
        }
      }

      if (shouldTrigger && trigger.firstSpellDuringOpponentTurn === true) {
        const activePlayer = String((ctx.state as any)?.activePlayer || '');
        const controllerId = String(permanent.controller || '');
        const spellsCastThisTurn = (Array.isArray(ctx.state?.spellsCastThisTurn) ? ctx.state.spellsCastThisTurn : [])
          .filter((castEntry: any) => String(castEntry?.casterId || '') === casterId);
        shouldTrigger = activePlayer !== controllerId && spellsCastThisTurn.length === 1;
      }
      
      if (shouldTrigger) {
        triggers.push(trigger);
      }
    }
  }
  
  return triggers;
}

/**
 * Extract creature types from a type line
 */
function extractCreatureTypes(typeLine: string): string[] {
  const types: string[] = [];
  const lowerTypeLine = typeLine.toLowerCase();
  
  // Common creature types
  const knownTypes = [
    'merfolk', 'goblin', 'elf', 'wizard', 'shaman', 'warrior', 'soldier', 'zombie',
    'vampire', 'dragon', 'angel', 'demon', 'beast', 'elemental', 'spirit', 'human',
    'knight', 'cleric', 'rogue', 'druid', 'pirate', 'dinosaur', 'cat', 'bird',
    'snake', 'spider', 'sliver', 'ally', 'rebel', 'mercenary', 'horror', 'faerie',
  ];
  
  for (const type of knownTypes) {
    if (lowerTypeLine.includes(type)) {
      types.push(type);
    }
  }
  
  return types;
}

// ============================================================================
// Tap/Untap Triggered Abilities
// (Judge of Currents, Emmara Soul of the Accord, Glare of Subdual, etc.)
// ============================================================================

export interface TapTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  effect: string;
  triggerCondition: string;
  affectedType: string;
  tribalType?: string; // For "Whenever a Merfolk becomes tapped"
  nontokenOnly?: boolean;
  mandatory: boolean;
  lifeGain?: number;
  createsToken?: boolean;
  tokenDetails?: {
    name: string;
    power: number;
    toughness: number;
    types: string;
  };
}

/**
 * Detect tap/untap triggered abilities from a card's oracle text
 * Handles cards like:
 * - Judge of Currents: "Whenever a Merfolk you control becomes tapped, you may gain 1 life"
 * - Emmara, Soul of the Accord: "Whenever Emmara, Soul of the Accord becomes tapped, create a 1/1 white Soldier creature token with lifelink"
 * - Fallowsage: "Whenever Fallowsage becomes tapped, you may draw a card"
 * - Opposition: Tap creatures to tap opponent's permanents
 */
export function detectTapTriggers(card: any, permanent: any): TapTrigger[] {
  const triggers: TapTrigger[] = [];
  const oracleText = (card?.oracle_text || "");
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // "Whenever a [TYPE] you control becomes tapped" pattern
  const tribalMultiTapMatch = oracleText.match(
    /whenever (?:one or more )?nontoken (\w+) you control become tapped,?\s*([^.]+)/i,
  );
  if (tribalMultiTapMatch) {
    const tribalType = tribalMultiTapMatch[1].toLowerCase();
    const effectText = timingTriggerEffect(oracleText, tribalMultiTapMatch, 2);
    const isOptional = effectText.toLowerCase().includes('you may');
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever one or more nontoken ${tribalType} you control become tapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'tribal_type',
      tribalType,
      mandatory: !isOptional,
    });
  }

  const youTapOpponentCreatureMatch = oracleText.match(
    /(?:when you (?:do, )?tap|you tap) (?:target |an )?(?:untapped )?creature an opponent controls/i,
  );
  if (youTapOpponentCreatureMatch && !triggers.some((t) => (t as any).affectedType === 'you_tap_opponent_creature')) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: 'When you tap an untapped creature an opponent controls',
      effect: 'tap target creature an opponent controls',
      triggerCondition: 'you_tap_opponent_creature',
      affectedType: 'you_tap_opponent_creature',
      mandatory: false,
    });
  }

  const opponentCreatureTapMatch = oracleText.match(
    /whenever a creature an opponent controls becomes tapped,?\s*([^.]+)/i,
  );
  if (opponentCreatureTapMatch) {
    const effectText = timingTriggerEffect(oracleText, opponentCreatureTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'opponent_creature_becomes_tapped',
      affectedType: 'opponent_creature',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const nontokenTribalTapMatch = oracleText.match(
    /whenever one or more nontoken (\w+) you control become tapped,?\s*([^.]+)/i,
  );
  if (nontokenTribalTapMatch) {
    const tribalType = nontokenTribalTapMatch[1].toLowerCase();
    const effectText = timingTriggerEffect(oracleText, nontokenTribalTapMatch, 2);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever one or more nontoken ${tribalType} you control become tapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'tribal_type',
      tribalType,
      nontokenOnly: true,
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const equippedCreatureBecomesTappedMatch = oracleText.match(
    /whenever equipped creature becomes tapped,?\s*([^.]+)/i,
  );
  if (
    equippedCreatureBecomesTappedMatch
    && !triggers.some((t) => String((t as any).affectedType || '') === 'equipped_creature')
  ) {
    const effectText = timingTriggerEffect(oracleText, equippedCreatureBecomesTappedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever equipped creature becomes tapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'equipped_creature',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedCreatureBecomesTappedMatch = oracleText.match(
    /whenever enchanted creature becomes tapped,?\s*([^.]+)/i,
  );
  if (
    enchantedCreatureBecomesTappedMatch
    && !triggers.some((t) => String((t as any).affectedType || '') === 'enchanted_creature')
  ) {
    const effectText = timingTriggerEffect(oracleText, enchantedCreatureBecomesTappedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever enchanted creature becomes tapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'enchanted_creature',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const tribalTapMatch = oracleText.match(/whenever (?:a |an )?(\w+) you control becomes tapped,?\s*([^.]+)/i);
  if (tribalTapMatch) {
    const tribalType = tribalTapMatch[1].toLowerCase();
    const effectText = timingTriggerEffect(oracleText, tribalTapMatch, 2);
    const isOptional = effectText.toLowerCase().includes('you may');
    
    // Check for life gain
    const lifeGainMatch = effectText.match(/gain (\d+) life/i);
    
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever a ${tribalType} you control becomes tapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'tribal_type',
      tribalType,
      mandatory: !isOptional,
      lifeGain: lifeGainMatch ? parseInt(lifeGainMatch[1]) : undefined,
    });
  }
  
  const selfTapNameRefs = [
    '~',
    'this creature',
    'this artifact',
    'this land',
    'this permanent',
    ...buildCardNameRegexAlternatives(cardName),
  ];
  const selfTapPattern = new RegExp(
    `when(?:ever)? (?:${selfTapNameRefs.join('|')}) ${ENTERS_OR_OTHER_EVENT_PREFIX}become(?:s)? tapped,?\\s*([^.]+)`,
    'i',
  );
  const selfTapMatch = oracleText.match(selfTapPattern);
  if (selfTapMatch) {
    const effectText = timingTriggerEffect(oracleText, selfTapMatch);
    const isOptional = effectText.toLowerCase().includes('you may');
    
    // Check for token creation
    const tokenMatch = effectText.match(/create (?:a |an )?(\d+)\/(\d+)/i);
    let createsToken = false;
    let tokenDetails: TapTrigger['tokenDetails'];
    
    if (tokenMatch || lowerOracle.includes('create') && lowerOracle.includes('token')) {
      createsToken = true;
      const powerMatch = effectText.match(/(\d+)\/(\d+)/);
      if (powerMatch) {
        tokenDetails = {
          name: 'Token',
          power: parseInt(powerMatch[1]),
          toughness: parseInt(powerMatch[2]),
          types: 'Creature',
        };
      }
    }
    
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever ${cardName} becomes tapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'self',
      mandatory: !isOptional,
      createsToken,
      tokenDetails,
    });
  }
  
  const thatLandTapMatch = oracleText.match(/whenever that land becomes tapped,?\s*([^.]+)/i);
  if (thatLandTapMatch && !triggers.some((t) => t.affectedType === 'that_land')) {
    const effectText = timingTriggerEffect(oracleText, thatLandTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever that land becomes tapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'that_land',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentArtifactTapForManaMatch = oracleText.match(
    /whenever an opponent taps an artifact for mana,?\s*([^.]+)/i,
  );
  if (opponentArtifactTapForManaMatch && !triggers.some((t) => (t as any).affectedType === 'opponent_artifact_tap_for_mana')) {
    const effectText = timingTriggerEffect(oracleText, opponentArtifactTapForManaMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'opponent_artifact_tap_for_mana',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentMountainTapForManaMatch = oracleText.match(
    /whenever an opponent taps a mountain for mana,?\s*([^.]+)/i,
  );
  if (opponentMountainTapForManaMatch && !triggers.some((t) => (t as any).affectedType === 'opponent_mountain_tap_for_mana')) {
    const effectText = timingTriggerEffect(oracleText, opponentMountainTapForManaMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'opponent_mountain_tap_for_mana',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentTapsLandForManaMatch = oracleText.match(
    /whenever an opponent taps a land for mana,?\s*([^.]+)/i,
  );
  if (opponentTapsLandForManaMatch && !triggers.some((t) => (t as any).affectedType === 'opponent_taps_land_for_mana')) {
    const effectText = timingTriggerEffect(oracleText, opponentTapsLandForManaMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'opponent_taps_land_for_mana',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const playerBasicLandTapMatch = oracleText.match(
    /whenever a player taps a basic land for mana,?\s*([^.]+)/i,
  );
  if (playerBasicLandTapMatch && !triggers.some((t) => (t as any).affectedType === 'player_basic_land_tap')) {
    const effectText = timingTriggerEffect(oracleText, playerBasicLandTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'player_basic_land_tap',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentIslandBecomesTappedMatch = oracleText.match(
    /whenever an island an opponent controls becomes tapped,?\s*([^.]+)/i,
  );
  if (opponentIslandBecomesTappedMatch && !triggers.some((t) => (t as any).affectedType === 'opponent_island_becomes_tapped')) {
    const effectText = timingTriggerEffect(oracleText, opponentIslandBecomesTappedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'opponent_island_becomes_tapped',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const artifactBecomesTappedOrActivatedMatch = oracleText.match(
    /whenever an artifact becomes tapped or a player activates an artifact's ability without \{T\} in its activation cost,?\s*([^.]+)/i,
  );
  if (
    artifactBecomesTappedOrActivatedMatch &&
    !triggers.some((t) => (t as any).affectedType === 'artifact_becomes_tapped_or_activated')
  ) {
    const effectText = timingTriggerEffect(oracleText, artifactBecomesTappedOrActivatedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'artifact_becomes_tapped_or_activated',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const itNextBecomesTappedMatch = oracleText.match(/whenever it next becomes tapped this turn,?\s*([^.]+)/i);
  if (itNextBecomesTappedMatch && !triggers.some((t) => (t as any).affectedType === 'it_next_becomes_tapped')) {
    const effectText = timingTriggerEffect(oracleText, itNextBecomesTappedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'it_next_becomes_tapped',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentMountainBecomesTappedMatch = oracleText.match(
    /whenever a mountain an opponent controls becomes tapped,?\s*([^.]+)/i,
  );
  if (opponentMountainBecomesTappedMatch && !triggers.some((t) => (t as any).affectedType === 'opponent_mountain_becomes_tapped')) {
    const effectText = timingTriggerEffect(oracleText, opponentMountainBecomesTappedMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'opponent_mountain_becomes_tapped',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const playerLandTypesTapMatch = oracleText.match(
    /whenever a player taps a (?:Mountain|Forest|Plains)(?:, (?:a )?(?:Mountain|Forest|Plains))*(?:, or (?:a )?(?:Mountain|Forest|Plains))? for mana,?\s*([^.]+)/i,
  );
  if (playerLandTypesTapMatch && !triggers.some((t) => (t as any).affectedType === 'player_land_types_tap')) {
    const effectText = timingTriggerEffect(oracleText, playerLandTypesTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'player_land_types_tap',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const playerNonbasicLandTapMatch = oracleText.match(
    /whenever a player taps a nonbasic land for mana,?\s*([^.]+)/i,
  );
  if (playerNonbasicLandTapMatch && !triggers.some((t) => (t as any).affectedType === 'player_nonbasic_land_tap')) {
    const effectText = timingTriggerEffect(oracleText, playerNonbasicLandTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'player_nonbasic_land_tap',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const playerPermanentTapForManaMatch = oracleText.match(
    /whenever a player taps a permanent for mana,?\s*([^.]+)/i,
  );
  if (playerPermanentTapForManaMatch && !triggers.some((t) => (t as any).affectedType === 'player_permanent_tap_for_mana')) {
    const effectText = timingTriggerEffect(oracleText, playerPermanentTapForManaMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'player_permanent_tap_for_mana',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentChosenLandTypeTapMatch = oracleText.match(
    /whenever a land of the chosen type an opponent controls becomes tapped,?\s*([^.]+)/i,
  );
  if (opponentChosenLandTypeTapMatch && !triggers.some((t) => (t as any).affectedType === 'opponent_chosen_land_type_tap')) {
    const effectText = timingTriggerEffect(oracleText, opponentChosenLandTypeTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'opponent_chosen_land_type_tap',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const artifactTappedOrAbilityMatch = oracleText.match(
    /whenever an artifact an opponent controls becomes tapped or an opponent activates an artifact's ability without \{T\} in its activation cost,?\s*([^.]+)/i,
  );
  if (
    artifactTappedOrAbilityMatch &&
    !triggers.some((t) => (t as any).affectedType === 'opponent_artifact_tapped_or_ability')
  ) {
    const effectText = timingTriggerEffect(oracleText, artifactTappedOrAbilityMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'opponent_artifact_tapped_or_ability',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const opponentForestTapMatch = oracleText.match(
    /whenever a forest an opponent controls becomes tapped,?\s*([^.]+)/i,
  );
  if (opponentForestTapMatch && !triggers.some((t) => (t as any).affectedType === 'opponent_forest_tap')) {
    const effectText = timingTriggerEffect(oracleText, opponentForestTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'opponent_forest_tap',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const playerSwampTapMatch = oracleText.match(/whenever a player taps a swamp for mana,?\s*([^.]+)/i);
  if (playerSwampTapMatch && !triggers.some((t) => (t as any).affectedType === 'player_swamp_tap')) {
    const effectText = timingTriggerEffect(oracleText, playerSwampTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'player_swamp_tap',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const playerIslandTapMatch = oracleText.match(/whenever a player taps an island for mana,?\s*([^.]+)/i);
  if (playerIslandTapMatch && !triggers.some((t) => (t as any).affectedType === 'player_island_tap')) {
    const effectText = timingTriggerEffect(oracleText, playerIslandTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever a player taps an Island for mana, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'player_island_tap',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const playerSnowLandTapMatch = oracleText.match(/whenever a player taps a snow land for mana,?\s*([^.]+)/i);
  if (playerSnowLandTapMatch && !triggers.some((t) => (t as any).affectedType === 'player_snow_land_tap')) {
    const effectText = timingTriggerEffect(oracleText, playerSnowLandTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'player_snow_land_tap',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const playerLandTapMatch = oracleText.match(/whenever a player taps a land for mana,?\s*([^.]+)/i);
  if (playerLandTapMatch && !triggers.some((t) => (t as any).affectedType === 'player_land_tap')) {
    const effectText = timingTriggerEffect(oracleText, playerLandTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever a player taps a land for mana, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'player_land_tap',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedLandManaTapMatch = oracleText.match(/whenever enchanted land is tapped for mana,?\s*([^.]+)/i);
  if (enchantedLandManaTapMatch && !triggers.some((t) => (t as any).affectedType === 'enchanted_land_mana')) {
    const effectText = timingTriggerEffect(oracleText, enchantedLandManaTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever enchanted land is tapped for mana, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'enchanted_land_mana',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedLandTapMatch = oracleText.match(/when(?:ever)? enchanted land becomes tapped,?\s*([^.]+)/i);
  if (enchantedLandTapMatch && !triggers.some((t) => t.affectedType === 'enchanted_land')) {
    const effectText = timingTriggerEffect(oracleText, enchantedLandTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever enchanted land becomes tapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'enchanted_land',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anyCreatureTapMatch = oracleText.match(/whenever (?:a|another) creature becomes tapped,?\s*([^.]+)/i);
  if (
    anyCreatureTapMatch &&
    !lowerOracle.includes('creature you control becomes tapped') &&
    !triggers.some((t) => t.affectedType === 'any_creature')
  ) {
    const effectText = timingTriggerEffect(oracleText, anyCreatureTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever a creature becomes tapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'any_creature',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const forestManaTapMatch = oracleText.match(/whenever a forest is tapped for mana,?\s*([^.]+)/i);
  if (forestManaTapMatch && !triggers.some((t) => (t as any).affectedType === 'forest_mana')) {
    const effectText = timingTriggerEffect(oracleText, forestManaTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever a Forest is tapped for mana, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'forest_mana',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedForestManaTapMatch = oracleText.match(/whenever enchanted forest is tapped for mana,?\s*([^.]+)/i);
  if (enchantedForestManaTapMatch && !triggers.some((t) => (t as any).affectedType === 'enchanted_forest_mana')) {
    const effectText = timingTriggerEffect(oracleText, enchantedForestManaTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever enchanted Forest is tapped for mana, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'enchanted_forest_mana',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const exiledNameLandTappedForManaMatch = oracleText.match(
    /whenever a land with the same name as the exiled card is tapped for mana,?\s*([^.]+)/i,
  );
  if (exiledNameLandTappedForManaMatch && !triggers.some((t) => (t as any).affectedType === 'exiled_name_land_tapped_for_mana')) {
    const effectText = timingTriggerEffect(oracleText, exiledNameLandTappedForManaMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'exiled_name_land_tapped_for_mana',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const basicLandTappedForManaMatch = oracleText.match(
    /whenever (?:a|an) basic land is tapped for mana(?: of the chosen color)?,?\s*([^.]+)/i,
  );
  if (basicLandTappedForManaMatch && !triggers.some((t) => (t as any).affectedType === 'basic_land_tapped_for_mana')) {
    const effectText = timingTriggerEffect(oracleText, basicLandTappedForManaMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'basic_land_tapped_for_mana',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const landManaAbilityTapMatch = oracleText.match(
    /whenever (?:a|an) (?:basic )?land(?:'s)? ability causes you to add(?: one or more)? mana(?: of the chosen color)?,?\s*([^.]+)/i,
  );
  if (landManaAbilityTapMatch && !triggers.some((t) => (t as any).affectedType === 'land_mana_ability')) {
    const effectText = timingTriggerEffect(oracleText, landManaAbilityTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'land_mana_ability',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const fortifiedLandTapMatch = oracleText.match(/whenever fortified land becomes tapped,?\s*([^.]+)/i);
  if (fortifiedLandTapMatch && !triggers.some((t) => t.affectedType === 'fortified_land')) {
    const effectText = timingTriggerEffect(oracleText, fortifiedLandTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever fortified land becomes tapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'fortified_land',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const anyPermanentTapMatch = oracleText.match(/whenever a permanent becomes tapped,?\s*([^.]+)/i);
  if (anyPermanentTapMatch && !triggers.some((t) => (t as any).affectedType === 'any_permanent_becomes_tapped')) {
    const effectText = timingTriggerEffect(oracleText, anyPermanentTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'any_permanent_becomes_tapped',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedPermanentTapMatch = oracleText.match(/when(?:ever)? enchanted permanent becomes tapped,?\s*([^.]+)/i);
  if (enchantedPermanentTapMatch && !triggers.some((t) => t.affectedType === 'enchanted_permanent')) {
    const effectText = timingTriggerEffect(oracleText, enchantedPermanentTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever enchanted permanent becomes tapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'enchanted_permanent',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedArtifactTapMatch = oracleText.match(/when(?:ever)? enchanted artifact becomes tapped,?\s*([^.]+)/i);
  if (enchantedArtifactTapMatch && !triggers.some((t) => t.affectedType === 'enchanted_artifact')) {
    const effectText = timingTriggerEffect(oracleText, enchantedArtifactTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever enchanted artifact becomes tapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'enchanted_artifact',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  const enchantedTapMatch = oracleText.match(/whenever enchanted creature becomes tapped,?\s*([^.]+)/i);
  if (enchantedTapMatch && !triggers.some((t) => t.affectedType === 'enchanted_creature')) {
    const effectText = timingTriggerEffect(oracleText, enchantedTapMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever enchanted creature becomes tapped, ${effectText}`,
      effect: effectText,
      triggerCondition: 'becomes_tapped',
      affectedType: 'enchanted_creature',
      mandatory: !effectText.toLowerCase().includes('you may'),
    });
  }

  // "Whenever a creature you control becomes tapped" (generic creature tap)
  if (lowerOracle.includes('whenever a creature you control becomes tapped') && 
      !triggers.some(t => t.affectedType === 'creature')) {
    const effectMatch = oracleText.match(/whenever a creature you control becomes tapped,?\s*([^.]+)/i);
    if (effectMatch) {
      const effectText = timingTriggerEffect(oracleText, effectMatch);
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        description: `Whenever a creature you control becomes tapped, ${effectText}`,
        effect: effectText,
        triggerCondition: 'becomes_tapped',
        affectedType: 'creature',
        mandatory: !effectText.toLowerCase().includes('you may'),
      });
    }
  }
  
  // "Whenever you tap a [TYPE] for mana" pattern (like Elvish Archdruid's friends)
  const tapForManaMatch = oracleText.match(/whenever you tap (?:a |an )?(\w+) for mana,?\s*([^.]+)/i);
  if (tapForManaMatch) {
    const tribalType = tapForManaMatch[1].toLowerCase();
    const effectText = timingTriggerEffect(oracleText, tapForManaMatch, 2);
    
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: `Whenever you tap a ${tribalType} for mana, ${effectText}`,
      effect: effectText,
      triggerCondition: 'taps_for_mana',
      affectedType: 'tribal_type',
      tribalType,
      mandatory: true,
    });
  }
  
  return triggers;
}

export { getTapTriggers } from './triggers/tap-untap.js';

// ============================================================================
// NOTE: "Doesn't Untap" Static Effects have been moved to ./triggers/turn-phases.ts
// Re-exports are at the top of this file

// ============================================================================
// Card Draw Trigger System - MOVED to ./triggers/card-draw.ts
// ============================================================================

// ============================================================================
// Mimic Vat and Imprint Triggers
// ============================================================================

export interface MimicVatTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  effect: string;
  dyingCreatureId: string;
  dyingCreatureName: string;
  dyingCreatureCard: any;
}

/**
 * Known cards with imprint-on-death triggers like Mimic Vat
 */
const KNOWN_IMPRINT_ON_DEATH_CARDS: Record<string, { effect: string; canExile: boolean }> = {
  "mimic vat": { 
    effect: "You may exile the dying creature. If you do, exile any card imprinted on Mimic Vat. Then you may pay {3} and tap to create a token copy with haste.", 
    canExile: true 
  },
  "soul foundry": {
    effect: "Imprint a creature card from your hand",
    canExile: false // Soul Foundry imprints from hand, not from dying creatures
  },
  "prototype portal": {
    effect: "Imprint an artifact card from your hand",
    canExile: false
  },
};

/**
 * Detect Mimic Vat-style imprint triggers from a permanent's oracle text
 * Pattern: "Whenever a nontoken creature dies, you may exile that card"
 */
export function detectMimicVatTriggers(card: any, permanent: any): boolean {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = (card?.name || "").toLowerCase();
  
  // Check known cards
  for (const [knownName, info] of Object.entries(KNOWN_IMPRINT_ON_DEATH_CARDS)) {
    if (cardName.includes(knownName) && info.canExile) {
      return true;
    }
  }
  
  // Generic pattern: "Whenever a nontoken creature dies, you may exile that card"
  // or "Whenever a creature dies, you may exile it"
  if (oracleText.includes('whenever') && 
      oracleText.includes('creature dies') && 
      oracleText.includes('you may exile')) {
    return true;
  }
  
  return false;
}

/**
 * Get all Mimic Vat-style triggers when a creature dies
 * @param ctx Game context
 * @param dyingCreature The creature that died
 * @param isToken Whether the dying creature is a token
 * @returns Array of triggers that can exile the dying creature
 */
export function getMimicVatTriggers(
  ctx: GameContext,
  dyingCreature: any,
  isToken: boolean
): MimicVatTrigger[] {
  const triggers: MimicVatTrigger[] = [];
  
  // Mimic Vat only works on nontoken creatures
  if (isToken) return triggers;
  
  const battlefield = ctx.state?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const hasMimicVatTrigger = detectMimicVatTriggers(permanent.card, permanent);
    
    if (hasMimicVatTrigger) {
      const cardName = (permanent.card.name || "").toLowerCase();
      const knownInfo = Object.entries(KNOWN_IMPRINT_ON_DEATH_CARDS)
        .find(([name]) => cardName.includes(name));
      
      triggers.push({
        permanentId: permanent.id,
        cardName: permanent.card.name,
        controllerId: permanent.controller,
        effect: knownInfo ? knownInfo[1].effect : "Exile the dying creature and imprint it",
        dyingCreatureId: dyingCreature.id,
        dyingCreatureName: dyingCreature.card?.name || "Unknown",
        dyingCreatureCard: dyingCreature.card,
      });
    }
  }
  
  return triggers;
}

// ============================================================================
// Kroxa-style ETB Auto-Sacrifice Triggers
// ============================================================================

/**
 * Known cards that sacrifice themselves on ETB unless cast with an alternate cost (Escape, etc.)
 */
const KNOWN_ETB_SACRIFICE_UNLESS: Record<string, { 
  effect: string; 
  alternateCostKeyword: string; 
  checkCondition: (permanent: any) => boolean;
}> = {
  "kroxa, titan of death's hunger": {
    effect: "When Kroxa enters the battlefield, sacrifice it unless it escaped.",
    alternateCostKeyword: "escape",
    checkCondition: (perm) => !perm.escapedFrom,
  },
  "uro, titan of nature's wrath": {
    effect: "When Uro enters the battlefield, sacrifice it unless it escaped.",
    alternateCostKeyword: "escape",
    checkCondition: (perm) => !perm.escapedFrom,
  },
  "ox of agonas": {
    effect: "When Ox of Agonas enters the battlefield, discard your hand, then draw three cards.",
    alternateCostKeyword: "escape",
    checkCondition: () => false, // Ox doesn't sacrifice, it has a different ETB
  },
  // Blitz creatures also have this pattern
  "jaxis, the troublemaker": {
    effect: "Sacrifice at end of turn if it entered with blitz",
    alternateCostKeyword: "blitz",
    checkCondition: (perm) => perm.blitzed === true,
  },
  // Ball Lightning style creatures
  "ball lightning": {
    effect: "At the beginning of the end step, sacrifice Ball Lightning.",
    alternateCostKeyword: "",
    checkCondition: () => true, // Always sacrifices at end step
  },
  "groundbreaker": {
    effect: "At the beginning of the end step, sacrifice Groundbreaker.",
    alternateCostKeyword: "",
    checkCondition: () => true,
  },
  "spark elemental": {
    effect: "At the beginning of the end step, sacrifice Spark Elemental.",
    alternateCostKeyword: "",
    checkCondition: () => true,
  },
};

/**
 * Check if a permanent should auto-sacrifice on ETB
 * Returns sacrifice info or null if it shouldn't sacrifice
 */
export function checkETBAutoSacrifice(card: any, permanent: any): { 
  shouldSacrifice: boolean; 
  reason: string;
  timing: 'immediate' | 'end_step';
} | null {
  const cardName = (card?.name || "").toLowerCase();
  const oracleText = (card?.oracle_text || "").toLowerCase();
  
  // Check known cards
  for (const [knownName, info] of Object.entries(KNOWN_ETB_SACRIFICE_UNLESS)) {
    if (cardName.includes(knownName)) {
      if (info.checkCondition(permanent)) {
        // Determine timing
        let timing: 'immediate' | 'end_step' = 'immediate';
        if (oracleText.includes('at the beginning of the end step') || 
            oracleText.includes('end of turn')) {
          timing = 'end_step';
        }
        
        return {
          shouldSacrifice: true,
          reason: info.effect,
          timing,
        };
      }
      return null; // Condition not met (e.g., escaped)
    }
  }
  
  // Generic pattern: "When ~ enters the battlefield, sacrifice it unless" or "When ~ enters, sacrifice it unless"
  // Supports both old "enters the battlefield" and new Bloomburrow "enters" templates
  const sacrificeUnlessMatch = oracleText.match(
    /when (?:~|this creature) enters(?: the battlefield)?,?\s*sacrifice (?:~|it) unless ([^.]+)/i
  );
  if (sacrificeUnlessMatch) {
    // Check if the condition is met (e.g., "unless it escaped")
    const condition = sacrificeUnlessMatch[1].toLowerCase();
    
    if (condition.includes('escaped') && !permanent.escapedFrom) {
      return {
        shouldSacrifice: true,
        reason: `Sacrifice unless it escaped`,
        timing: 'immediate',
      };
    }
    
    // Other conditions would need specific checking
  }
  
  // Pattern: "At the beginning of the end step, sacrifice ~"
  const endStepSacrificeMatch = oracleText.match(
    /at the beginning of (?:the )?end step,?\s*sacrifice (?:~|this creature)/i
  );
  if (endStepSacrificeMatch) {
    return {
      shouldSacrifice: true,
      reason: "Sacrifice at end of turn",
      timing: 'end_step',
    };
  }
  
  return null;
}

// ============================================================================
// Modal Spell Support
// ============================================================================

export interface ModalSpellMode {
  index: number;
  text: string;
  effect: string;
  requiresTarget?: boolean;
  targetType?: string;
}

export interface ModalSpellInfo {
  isModal: boolean;
  modeCount: number | 'any'; // 1, 2, 3, 'any'
  modes: ModalSpellMode[];
  isSpree: boolean;
  spreeCosts?: { modeIndex: number; cost: string }[];
}

/**
 * Parse modal spell options from oracle text
 * Handles:
 * - "Choose one —" / "Choose two —" / "Choose three —"
 * - "Choose any number —"
 * - Spree cards: "Spree (Choose one or more additional costs.)"
 * - Entwine: "You may choose both if you pay entwine cost"
 */
export function parseModalSpellOptions(card: any): ModalSpellInfo {
  const oracleText = card?.oracle_text || "";
  const lowerOracle = oracleText.toLowerCase();
  
  const result: ModalSpellInfo = {
    isModal: false,
    modeCount: 1,
    modes: [],
    isSpree: false,
  };
  
  // Check for Spree keyword
  if (lowerOracle.includes('spree')) {
    result.isModal = true;
    result.isSpree = true;
    result.modeCount = 'any';
    
    // Parse spree costs: "+ {cost} — Effect"
    const spreePattern = /\+\s*(\{[^}]+\})\s*[—-]\s*([^+]+?)(?=\+\s*\{|$)/gi;
    let match;
    let index = 0;
    while ((match = spreePattern.exec(oracleText)) !== null) {
      const cost = match[1];
      const effect = match[2].trim();
      
      result.modes.push({
        index,
        text: `Pay ${cost}: ${effect}`,
        effect,
        requiresTarget: effect.toLowerCase().includes('target'),
        targetType: detectTargetType(effect),
      });
      
      result.spreeCosts = result.spreeCosts || [];
      result.spreeCosts.push({ modeIndex: index, cost });
      index++;
    }
    
    return result;
  }
  
  // Check for standard modal patterns
  const chooseMatch = lowerOracle.match(/choose\s+(one|two|three|four|any number)\s*[—-]/i);
  if (chooseMatch) {
    result.isModal = true;
    const countWord = chooseMatch[1].toLowerCase();
    
    switch (countWord) {
      case 'one': result.modeCount = 1; break;
      case 'two': result.modeCount = 2; break;
      case 'three': result.modeCount = 3; break;
      case 'four': result.modeCount = 4; break;
      case 'any number': result.modeCount = 'any'; break;
      default: result.modeCount = 1;
    }
    
    // Parse individual modes (marked by • or numbered)
    // Pattern: "• Effect text" or lines after "Choose X —"
    const modePattern = /[•·]\s*([^•·]+?)(?=[•·]|$)/g;
    let modeMatch;
    let index = 0;
    
    // Find the modes section (after "Choose X —")
    const dashIndex = oracleText.search(/[—-]/);
    const modesSection = dashIndex >= 0 ? oracleText.slice(dashIndex + 1) : oracleText;
    
    while ((modeMatch = modePattern.exec(modesSection)) !== null) {
      const modeText = modeMatch[1].trim();
      if (modeText.length > 0) {
        result.modes.push({
          index,
          text: modeText,
          effect: modeText,
          requiresTarget: modeText.toLowerCase().includes('target'),
          targetType: detectTargetType(modeText),
        });
        index++;
      }
    }
    
    // Fallback: if no bullet points found, try to parse by sentence structure
    if (result.modes.length === 0) {
      // Some cards use newlines or semicolons to separate modes
      const altModes = modesSection.split(/[;\n]/).filter(m => m.trim().length > 0);
      for (const modeText of altModes) {
        const cleanMode = modeText.trim();
        if (cleanMode.length > 5) { // Avoid tiny fragments
          result.modes.push({
            index,
            text: cleanMode,
            effect: cleanMode,
            requiresTarget: cleanMode.toLowerCase().includes('target'),
            targetType: detectTargetType(cleanMode),
          });
          index++;
        }
      }
    }
  }
  
  // Check for Entwine
  if (lowerOracle.includes('entwine')) {
    const entwineMatch = lowerOracle.match(/entwine\s+(\{[^}]+\})/i);
    if (entwineMatch) {
      // Mark that both modes can be chosen with entwine cost
      (result as any).hasEntwine = true;
      (result as any).entwineCost = entwineMatch[1];
    }
  }
  
  return result;
}

/**
 * Helper to detect target type from effect text
 */
function detectTargetType(effectText: string): string | undefined {
  const lower = effectText.toLowerCase();
  
  if (lower.includes('target creature')) return 'creature';
  if (lower.includes('target player')) return 'player';
  if (lower.includes('target permanent')) return 'permanent';
  if (lower.includes('target spell')) return 'spell';
  if (lower.includes('target artifact')) return 'artifact';
  if (lower.includes('target enchantment')) return 'enchantment';
  if (lower.includes('target land')) return 'land';
  if (lower.includes('any target')) return 'any';
  
  return undefined;
}

// ============================================================================
// Devotion Mana Calculation - MOVED to ./triggers/devotion.ts
// ============================================================================

// ============================================================================
// Win/Loss Condition Detection - MOVED to ./triggers/win-conditions.ts
// ============================================================================

// ============================================================================
// Transform/Flip Triggers - MOVED to ./triggers/transform.ts
// ============================================================================

// ============================================================================
// Landfall Triggers - MOVED to ./triggers/landfall.ts
// ============================================================================

// ============================================================================
// Static Abilities and Keywords
// ============================================================================

/**
 * Check if a permanent has Split Second (can't be responded to)
 */
export function hasSplitSecond(card: any): boolean {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const keywords = card?.keywords || [];
  
  return keywords.some((k: string) => k.toLowerCase() === 'split second') ||
         oracleText.includes('split second');
}

/**
 * Check if a player has hexproof (Leyline of Sanctity, Shalai, etc.)
 */
export function playerHasHexproof(
  gameState: any,
  playerId: string
): boolean {
  const battlefield = gameState?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const oracleText = (permanent.card.oracle_text || "").toLowerCase();
    const cardName = (permanent.card.name || "").toLowerCase();
    
    // Leyline of Sanctity: "You have hexproof"
    if (cardName.includes('leyline of sanctity') && permanent.controller === playerId) {
      return true;
    }
    
    // Shalai, Voice of Plenty: "You and permanents you control have hexproof"
    if (cardName.includes('shalai') && oracleText.includes('you') && 
        oracleText.includes('hexproof') && permanent.controller === playerId) {
      return true;
    }
    
    // Aegis of the Gods: "You have hexproof"
    if (cardName.includes('aegis of the gods') && permanent.controller === playerId) {
      return true;
    }
    
    // Teyo, the Shieldmage: "You have hexproof"
    if (cardName.includes('teyo') && oracleText.includes('you have hexproof') && 
        permanent.controller === playerId) {
      return true;
    }
    
    // Orbs of Warding: "You have hexproof"
    if (cardName.includes('orbs of warding') && permanent.controller === playerId) {
      return true;
    }
    
    // Imperial Mask: "You have hexproof"
    if (cardName.includes('imperial mask') && permanent.controller === playerId) {
      return true;
    }
    
    // Generic pattern: "You have hexproof"
    if (oracleText.includes('you have hexproof') && permanent.controller === playerId) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get creatures with specific keywords in graveyard (Brawn, Anger, Wonder, Filth, Genesis)
 */
export function getGraveyardKeywordGranters(
  gameState: any,
  playerId: string
): { keyword: string; cardName: string; condition?: string }[] {
  const granters: { keyword: string; cardName: string; condition?: string }[] = [];
  const zones = gameState?.zones?.[playerId];
  const graveyard = zones?.graveyard || [];
  const battlefield = gameState?.battlefield || [];
  
  // Check if player controls a land of the required type
  const controlsForest = battlefield.some((p: any) => 
    p.controller === playerId && 
    (p.card?.type_line || '').toLowerCase().includes('forest')
  );
  const controlsIsland = battlefield.some((p: any) => 
    p.controller === playerId && 
    (p.card?.type_line || '').toLowerCase().includes('island')
  );
  const controlsMountain = battlefield.some((p: any) => 
    p.controller === playerId && 
    (p.card?.type_line || '').toLowerCase().includes('mountain')
  );
  const controlsSwamp = battlefield.some((p: any) => 
    p.controller === playerId && 
    (p.card?.type_line || '').toLowerCase().includes('swamp')
  );
  
  for (const card of graveyard) {
    const cardName = (card.name || "").toLowerCase();
    
    // Brawn: Creatures you control have trample (if you control a Forest)
    if (cardName.includes('brawn') && controlsForest) {
      granters.push({ keyword: 'trample', cardName: 'Brawn', condition: 'Control a Forest' });
    }
    
    // Anger: Creatures you control have haste (if you control a Mountain)
    if (cardName.includes('anger') && controlsMountain) {
      granters.push({ keyword: 'haste', cardName: 'Anger', condition: 'Control a Mountain' });
    }
    
    // Wonder: Creatures you control have flying (if you control an Island)
    if (cardName.includes('wonder') && controlsIsland) {
      granters.push({ keyword: 'flying', cardName: 'Wonder', condition: 'Control an Island' });
    }
    
    // Filth: Creatures you control have swampwalk (if you control a Swamp)
    if (cardName.includes('filth') && controlsSwamp) {
      granters.push({ keyword: 'swampwalk', cardName: 'Filth', condition: 'Control a Swamp' });
    }
    
    // Genesis: Return creature from graveyard at upkeep (if you control a Forest)
    if (cardName.includes('genesis') && controlsForest) {
      granters.push({ keyword: 'return_creature', cardName: 'Genesis', condition: 'Control a Forest' });
    }
  }
  
  return granters;
}

// ============================================================================
// Storm Mechanic Support
// ============================================================================

/**
 * Storm - When you cast this spell, copy it for each spell cast before it this turn.
 * Each copy goes on the stack with the same modes/targets (or new targets chosen)
 * 
 * Cards with Storm:
 * - Grapeshot
 * - Empty the Warrens
 * - Brain Freeze
 * - Tendrils of Agony
 * - Mind's Desire
 * - Temporal Fissure
 * - Hunting Pack
 * - Wing Shards
 * - Flusterstorm
 * - Crow Storm
 * - Dragonstorm
 * - Ignite Memories
 * - Sprouting Vines
 */
export interface StormTrigger {
  sourceCardId: string;
  sourceCardName: string;
  controllerId: string;
  stormCount: number;  // Number of copies to create
  originalSpellDetails: any;
}

export function detectStormAbility(card: any): boolean {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const keywords = card?.keywords || [];
  
  // Check keywords array
  if (keywords.some((k: string) => k.toLowerCase() === 'storm')) {
    return true;
  }
  
  // Check oracle text for storm reminder text
  // "Storm (When you cast this spell, copy it for each spell cast before it this turn.)"
  if (oracleText.includes('storm') && 
      oracleText.includes('copy it for each spell cast before it')) {
    return true;
  }
  
  return false;
}

export function getStormCount(gameState: any): number {
  // Storm count is the number of spells cast this turn before this spell
  const spellsCastThisTurn = gameState?.spellsCastThisTurn || [];
  // Subtract 1 because we don't count the storm spell itself
  return Math.max(0, spellsCastThisTurn.length - 1);
}

// ============================================================================
// Hideaway Support
// ============================================================================

/**
 * Hideaway - When this land enters, look at the top X cards of your library,
 * exile one face down, then put the rest on the bottom. When condition is met,
 * you may play the exiled card without paying its mana cost.
 * 
 * Original hideaway lands (hideaway 4):
 * - Mosswort Bridge (creatures with total power 10+)
 * - Windbrisk Heights (attacked with 3+ creatures)
 * - Shelldock Isle (library has 20 or fewer cards)
 * - Howltooth Hollow (each player has no cards in hand)
 * - Spinerock Knoll (dealt 7+ damage this turn)
 * 
 * Newer hideaway cards:
 * - Watcher for Tomorrow (hideaway 4, when it leaves)
 * - Hideaway lands in Streets of New Capenna
 */
export interface HideawayAbility {
  hideawayCount: number;  // How many cards to look at
  condition: string;
  permanentId: string;
  exiledCardId?: string;
}

export function detectHideawayAbility(card: any): HideawayAbility | null {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const keywords = card?.keywords || [];
  
  // Check for hideaway keyword
  const hasHideaway = keywords.some((k: string) => k.toLowerCase().includes('hideaway'));
  
  if (!hasHideaway && !oracleText.includes('hideaway')) {
    return null;
  }
  
  // Parse hideaway count - "hideaway 4" or "hideaway 5"
  const hideawayMatch = oracleText.match(/hideaway\s*(\d+)?/i);
  const hideawayCount = hideawayMatch && hideawayMatch[1] ? parseInt(hideawayMatch[1], 10) : 4;
  
  // Extract condition for playing the exiled card
  let condition = "unknown";
  const hasPattern = (pattern: RegExp) => pattern.test(oracleText);
  
  // Mosswort Bridge pattern
  if (
    hasPattern(/creatures with total power 10 or greater/i) ||
    hasPattern(/creatures you control have total power 10 or greater/i)
  ) {
    condition = "Control creatures with total power 10+";
  }
  // Windbrisk Heights pattern
  else if (hasPattern(/attacked with (three|3) or more creatures(?: this turn)?/i)) {
    condition = "Attacked with 3+ creatures this turn";
  }
  // Shelldock Isle pattern
  else if (hasPattern(/(?:a )?library has (twenty|20) or fewer cards(?: in it)?/i)) {
    condition = "A library has 20 or fewer cards";
  }
  // Howltooth Hollow pattern
  else if (hasPattern(/each player has no cards in hand/i)) {
    condition = "Each player has no cards in hand";
  }
  // Spinerock Knoll pattern
  else if (hasPattern(/(?:an )?opponent was dealt (7|seven) or more damage(?: this turn)?/i)) {
    condition = "An opponent was dealt 7+ damage this turn";
  }
  
  return {
    hideawayCount,
    condition,
    permanentId: '',  // Will be set when the permanent enters
  };
}

// ============================================================================
// Pariah and Damage Redirection Support
// ============================================================================

/**
 * Pariah effects redirect damage from a player to another permanent/creature
 * 
 * Cards:
 * - Pariah - "All damage that would be dealt to you is dealt to enchanted creature instead"
 * - Pariah's Shield - Equipment version
 * - Palisade Giant - "All damage that would be dealt to you is dealt to Palisade Giant instead"
 * - Stuffy Doll - Choose a player, all damage dealt to it is dealt to that player
 */
export interface DamageRedirection {
  permanentId: string;
  cardName: string;
  from: 'controller' | 'chosen_player';
  to: 'this_creature' | 'enchanted_creature' | 'equipped_creature' | 'chosen_player';
  chosenPlayerId?: string;
}

export function detectDamageRedirection(card: any, permanent: any): DamageRedirection | null {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = (card?.name || "").toLowerCase();
  
  // Pariah pattern
  if (cardName.includes('pariah') && !cardName.includes("pariah's shield")) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Pariah',
      from: 'controller',
      to: 'enchanted_creature',
    };
  }
  
  // Pariah's Shield pattern
  if (cardName.includes("pariah's shield")) {
    return {
      permanentId: permanent?.id || '',
      cardName: "Pariah's Shield",
      from: 'controller',
      to: 'equipped_creature',
    };
  }
  
  // Palisade Giant pattern
  if (cardName.includes('palisade giant')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Palisade Giant',
      from: 'controller',
      to: 'this_creature',
    };
  }
  
  // Stuffy Doll pattern - damage to Stuffy Doll is dealt to chosen player
  if (cardName.includes('stuffy doll')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Stuffy Doll',
      from: 'controller',  // Actually "to this creature"
      to: 'chosen_player',
      chosenPlayerId: permanent?.chosenPlayer,  // Set when entering
    };
  }
  
  // Generic pattern detection
  if (oracleText.includes('all damage that would be dealt to you') && 
      oracleText.includes('is dealt to')) {
    if (oracleText.includes('enchanted creature')) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || 'Unknown',
        from: 'controller',
        to: 'enchanted_creature',
      };
    }
    if (oracleText.includes('equipped creature')) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || 'Unknown',
        from: 'controller',
        to: 'equipped_creature',
      };
    }
  }
  
  return null;
}

// ============================================================================
// Empire Artifacts Support (Crown, Scepter, Throne of Empires)
// ============================================================================

/**
 * The Empires artifact cycle from Magic 2012:
 * - Crown of Empires: {3}, {T}: Tap target creature. Gain control if you control Scepter and Throne.
 * - Scepter of Empires: {T}: Deal 1 damage to target player. Deal 3 if you control Crown and Throne.
 * - Throne of Empires: {1}, {T}: Create a 1/1 Soldier. Create 5 if you control Crown and Scepter.
 */
export interface EmpiresBonus {
  hasFullSet: boolean;
  controlsCrown: boolean;
  controlsScepter: boolean;
  controlsThrone: boolean;
}

export function checkEmpiresSet(gameState: any, playerId: string): EmpiresBonus {
  const battlefield = gameState?.battlefield || [];
  const controlledPermanents = battlefield.filter((p: any) => p?.controller === playerId);
  
  let controlsCrown = false;
  let controlsScepter = false;
  let controlsThrone = false;
  
  for (const perm of controlledPermanents) {
    const cardName = (perm?.card?.name || "").toLowerCase();
    if (cardName.includes('crown of empires')) controlsCrown = true;
    if (cardName.includes('scepter of empires')) controlsScepter = true;
    if (cardName.includes('throne of empires')) controlsThrone = true;
  }
  
  return {
    hasFullSet: controlsCrown && controlsScepter && controlsThrone,
    controlsCrown,
    controlsScepter,
    controlsThrone,
  };
}

/**
 * Get the bonus effect for an Empires artifact
 */
export function getEmpiresEffect(card: any, gameState: any, controllerId: string): {
  normalEffect: string;
  bonusEffect: string;
  bonusActive: boolean;
} | null {
  const cardName = (card?.name || "").toLowerCase();
  const empires = checkEmpiresSet(gameState, controllerId);
  
  if (cardName.includes('crown of empires')) {
    return {
      normalEffect: "Tap target creature",
      bonusEffect: "Gain control of target creature",
      bonusActive: empires.controlsScepter && empires.controlsThrone,
    };
  }
  
  if (cardName.includes('scepter of empires')) {
    return {
      normalEffect: "Deal 1 damage to target player or planeswalker",
      bonusEffect: "Deal 3 damage to target player or planeswalker",
      bonusActive: empires.controlsCrown && empires.controlsThrone,
    };
  }
  
  if (cardName.includes('throne of empires')) {
    return {
      normalEffect: "Create a 1/1 white Soldier creature token",
      bonusEffect: "Create five 1/1 white Soldier creature tokens",
      bonusActive: empires.controlsCrown && empires.controlsScepter,
    };
  }
  
  return null;
}

// ============================================================================
// Chromatic Lantern and Mana Fixing Support
// ============================================================================

/**
 * Cards that grant mana abilities to other permanents:
 * - Chromatic Lantern: Lands you control have "T: Add one mana of any color"
 * - Cryptolith Rite: Creatures you control have "T: Add one mana of any color"
 * - Elven Chorus: Creatures you control have "T: Add one mana of any color"
 * - Song of Freyalise: Creatures you control have "T: Add one mana of any color"
 */
export interface ManaAbilityGranter {
  permanentId: string;
  cardName: string;
  grantsTo: 'lands' | 'creatures' | 'all_permanents';
  manaType: 'any_color' | 'specific_color';
  specificColor?: string;
}

export function detectManaAbilityGranter(card: any, permanent: any): ManaAbilityGranter | null {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = (card?.name || "").toLowerCase();
  
  // Chromatic Lantern: Lands have "T: Add any color"
  if (cardName.includes('chromatic lantern')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Chromatic Lantern',
      grantsTo: 'lands',
      manaType: 'any_color',
    };
  }
  
  // Cryptolith Rite: Creatures have "T: Add any color"
  if (cardName.includes('cryptolith rite')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Cryptolith Rite',
      grantsTo: 'creatures',
      manaType: 'any_color',
    };
  }
  
  // Elven Chorus: Creatures have "T: Add one mana of any color"
  if (cardName.includes('elven chorus')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Elven Chorus',
      grantsTo: 'creatures',
      manaType: 'any_color',
    };
  }
  
  // Song of Freyalise: Creatures have "T: Add any color"
  if (cardName.includes('song of freyalise')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Song of Freyalise',
      grantsTo: 'creatures',
      manaType: 'any_color',
    };
  }
  
  // Generic pattern: "Lands you control have" or "Creatures you control have"
  if (oracleText.includes('lands you control have') && 
      oracleText.includes('{t}: add')) {
    return {
      permanentId: permanent?.id || '',
      cardName: card?.name || 'Unknown',
      grantsTo: 'lands',
      manaType: oracleText.includes('any color') ? 'any_color' : 'specific_color',
    };
  }
  
  if (oracleText.includes('creatures you control have') && 
      oracleText.includes('{t}: add')) {
    return {
      permanentId: permanent?.id || '',
      cardName: card?.name || 'Unknown',
      grantsTo: 'creatures',
      manaType: oracleText.includes('any color') ? 'any_color' : 'specific_color',
    };
  }
  
  return null;
}

// ============================================================================
// Craterhoof Behemoth and Power/Toughness Boost Effects
// ============================================================================

/**
 * Cards that give +X/+X based on creature count:
 * - Craterhoof Behemoth: +X/+X where X is number of creatures you control
 * - Overwhelming Stampede: +X/+X where X is greatest power among creatures you control
 * - Thunderfoot Baloth: +2/+2 and trample while you control your commander
 * - End-Raze Forerunners: +2/+2, vigilance, trample until end of turn
 */
export interface MassBoostEffect {
  permanentId: string;
  cardName: string;
  boostType: 'creature_count' | 'greatest_power' | 'fixed' | 'conditional';
  fixedBoost?: { power: number; toughness: number };
  grantsKeywords?: string[];
  condition?: string;
  duration: 'until_eot' | 'static';
}

export function detectMassBoostEffect(card: any, permanent: any): MassBoostEffect | null {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = (card?.name || "").toLowerCase();
  
  // Craterhoof Behemoth: Creatures get +X/+X where X = creature count
  if (cardName.includes('craterhoof behemoth')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Craterhoof Behemoth',
      boostType: 'creature_count',
      grantsKeywords: ['trample'],
      duration: 'until_eot',
    };
  }
  
  // Overwhelming Stampede: +X/+X where X = greatest power
  if (cardName.includes('overwhelming stampede')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Overwhelming Stampede',
      boostType: 'greatest_power',
      grantsKeywords: ['trample'],
      duration: 'until_eot',
    };
  }
  
  // End-Raze Forerunners: +2/+2, vigilance, trample
  if (cardName.includes('end-raze forerunners')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'End-Raze Forerunners',
      boostType: 'fixed',
      fixedBoost: { power: 2, toughness: 2 },
      grantsKeywords: ['vigilance', 'trample'],
      duration: 'until_eot',
    };
  }
  
  // Thunderfoot Baloth: +2/+2 and trample while you control commander
  if (cardName.includes('thunderfoot baloth')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Thunderfoot Baloth',
      boostType: 'conditional',
      fixedBoost: { power: 2, toughness: 2 },
      grantsKeywords: ['trample'],
      condition: 'Control your commander',
      duration: 'static',
    };
  }
  
  return null;
}

/**
 * Calculate the boost amount for creature count or power-based effects
 */
export function calculateMassBoost(
  effect: MassBoostEffect,
  gameState: any,
  controllerId: string
): { power: number; toughness: number } {
  const battlefield = gameState?.battlefield || [];
  
  if (effect.boostType === 'fixed' && effect.fixedBoost) {
    return effect.fixedBoost;
  }
  
  if (effect.boostType === 'creature_count') {
    const creatureCount = battlefield.filter((p: any) => 
      p?.controller === controllerId &&
      (p.card?.type_line || '').toLowerCase().includes('creature')
    ).length;
    return { power: creatureCount, toughness: creatureCount };
  }
  
  if (effect.boostType === 'greatest_power') {
    let greatestPower = 0;
    for (const perm of battlefield) {
      if (!perm || perm.controller !== controllerId) continue;
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) continue;
      
      const power = perm.basePower ?? perm.card?.power ?? 0;
      const numPower = typeof power === 'string' ? parseInt(power, 10) || 0 : power;
      if (numPower > greatestPower) greatestPower = numPower;
    }
    return { power: greatestPower, toughness: greatestPower };
  }
  
  if (effect.boostType === 'conditional' && effect.fixedBoost) {
    // Check condition
    if (effect.condition === 'Control your commander') {
      const hasCommander = battlefield.some((p: any) => 
        p?.controller === controllerId && p.isCommander
      );
      if (hasCommander) return effect.fixedBoost;
    }
  }
  
  return { power: 0, toughness: 0 };
}

// ============================================================================
// Lure and Combat Forcing Effects
// ============================================================================

/**
 * Cards that force creatures to block:
 * - Lure: All creatures able to block enchanted creature must do so
 * - Nemesis Mask: Same as Lure
 * - Shinen of Life's Roar: Same as Lure (on itself)
 * - Engulfing Slagwurm: Must be blocked if able (implicit via oracle text)
 */
export interface MustBlockEffect {
  permanentId: string;
  cardName: string;
  affects: 'enchanted' | 'equipped' | 'self';
  scope: 'all_creatures' | 'able_creatures';
}

export function detectMustBlockEffect(card: any, permanent: any): MustBlockEffect | null {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = (card?.name || "").toLowerCase();
  
  // Lure
  if (cardName === 'lure') {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Lure',
      affects: 'enchanted',
      scope: 'all_creatures',
    };
  }
  
  // Nemesis Mask
  if (cardName.includes('nemesis mask')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Nemesis Mask',
      affects: 'equipped',
      scope: 'all_creatures',
    };
  }
  
  // Generic "all creatures able to block" pattern
  if (oracleText.includes('all creatures able to block') && 
      oracleText.includes('do so')) {
    const affects = oracleText.includes('enchanted creature') ? 'enchanted' :
                   oracleText.includes('equipped creature') ? 'equipped' : 'self';
    return {
      permanentId: permanent?.id || '',
      cardName: card?.name || 'Unknown',
      affects,
      scope: 'all_creatures',
    };
  }
  
  return null;
}

// ============================================================================
// Kira, Great Glass-Spinner and Spell/Ability Ward Effects
// ============================================================================

/**
 * Cards that counter the first spell/ability targeting creatures:
 * - Kira, Great Glass-Spinner: Counter the first spell or ability each turn
 * - Shalai, Voice of Plenty: Gives hexproof to you and your creatures
 * - Saryth, the Viper's Fang: Tapped creatures have deathtouch, untapped have hexproof
 */
export interface TargetingProtection {
  permanentId: string;
  cardName: string;
  protectionType: 'counter_first' | 'hexproof' | 'conditional_hexproof';
  affects: 'creatures_you_control' | 'you_and_creatures' | 'untapped_creatures' | 'tapped_creatures';
  counterPerTurn?: boolean;
}

export function detectTargetingProtection(card: any, permanent: any): TargetingProtection | null {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = (card?.name || "").toLowerCase();
  
  // Kira, Great Glass-Spinner
  if (cardName.includes('kira') && cardName.includes('glass-spinner')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Kira, Great Glass-Spinner',
      protectionType: 'counter_first',
      affects: 'creatures_you_control',
      counterPerTurn: true,
    };
  }
  
  // Shalai, Voice of Plenty
  if (cardName.includes('shalai') && cardName.includes('voice of plenty')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Shalai, Voice of Plenty',
      protectionType: 'hexproof',
      affects: 'you_and_creatures',
    };
  }
  
  // Saryth, the Viper's Fang
  if (cardName.includes('saryth') && cardName.includes("viper's fang")) {
    return {
      permanentId: permanent?.id || '',
      cardName: "Saryth, the Viper's Fang",
      protectionType: 'conditional_hexproof',
      affects: 'untapped_creatures',  // Also grants deathtouch to tapped
    };
  }
  
  return null;
}

// ============================================================================
// Serra Avatar and Power/Toughness Equal to Life Effects
// ============================================================================

/**
 * Cards with P/T equal to life total or other dynamic values:
 * - Serra Avatar: P/T equal to your life total
 * - Malignus: Power and toughness equal to half opponent's life (rounded up)
 * - Lord of Extinction: P/T equal to cards in all graveyards
 * - Multani, Yavimaya's Avatar: P/T equal to lands you control + lands in graveyard
 */
export interface DynamicPowerToughness {
  permanentId: string;
  cardName: string;
  baseOn: 'life_total' | 'half_opponent_life' | 'graveyard_cards' | 'lands_controlled_and_graveyard';
}

export function detectDynamicPT(card: any, permanent: any): DynamicPowerToughness | null {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = (card?.name || "").toLowerCase();
  
  // Serra Avatar
  if (cardName.includes('serra avatar')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Serra Avatar',
      baseOn: 'life_total',
    };
  }
  
  // Malignus
  if (cardName.includes('malignus')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Malignus',
      baseOn: 'half_opponent_life',
    };
  }
  
  // Lord of Extinction
  if (cardName.includes('lord of extinction')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Lord of Extinction',
      baseOn: 'graveyard_cards',
    };
  }
  
  // Multani, Yavimaya's Avatar
  if (cardName.includes('multani') && cardName.includes('yavimaya')) {
    return {
      permanentId: permanent?.id || '',
      cardName: "Multani, Yavimaya's Avatar",
      baseOn: 'lands_controlled_and_graveyard',
    };
  }
  
  // Generic pattern
  if (oracleText.includes("power and toughness are each equal to your life total")) {
    return {
      permanentId: permanent?.id || '',
      cardName: card?.name || 'Unknown',
      baseOn: 'life_total',
    };
  }
  
  return null;
}

/**
 * Calculate dynamic P/T for cards like Serra Avatar
 */
export function calculateDynamicPT(
  effect: DynamicPowerToughness,
  gameState: any,
  controllerId: string
): { power: number; toughness: number } {
  const life = gameState?.life?.[controllerId] || 40;
  const battlefield = gameState?.battlefield || [];
  
  switch (effect.baseOn) {
    case 'life_total':
      return { power: life, toughness: life };
      
    case 'half_opponent_life': {
      const players = gameState?.players || [];
      const opponents = players.filter((p: any) => p.id !== controllerId);
      // Get highest life total among opponents
      let highestOpponentLife = 0;
      for (const opp of opponents) {
        const oppLife = gameState?.life?.[opp.id] || 40;
        if (oppLife > highestOpponentLife) highestOpponentLife = oppLife;
      }
      const halfLife = Math.ceil(highestOpponentLife / 2);
      return { power: halfLife, toughness: halfLife };
    }
    
    case 'graveyard_cards': {
      let totalCards = 0;
      const players = gameState?.players || [];
      for (const player of players) {
        const graveyard = gameState?.zones?.[player.id]?.graveyard || [];
        totalCards += graveyard.length;
      }
      return { power: totalCards, toughness: totalCards };
    }
    
    case 'lands_controlled_and_graveyard': {
      const landsControlled = battlefield.filter((p: any) => 
        p?.controller === controllerId &&
        (p.card?.type_line || '').toLowerCase().includes('land')
      ).length;
      const graveyard = gameState?.zones?.[controllerId]?.graveyard || [];
      const landsInGraveyard = graveyard.filter((c: any) => 
        (c.type_line || '').toLowerCase().includes('land')
      ).length;
      const total = landsControlled + landsInGraveyard;
      return { power: total, toughness: total };
    }
  }
  
  return { power: 0, toughness: 0 };
}

// ============================================================================
// Traumatize and Mill Effects
// ============================================================================

/**
 * Cards that mill half library or large amounts:
 * - Traumatize: Mill half library (rounded down)
 * - Maddening Cacophony (kicked): Mill half library
 * - Fleet Swallower: Mill half library on combat damage
 */
export interface MassMillEffect {
  cardName: string;
  millType: 'half_library' | 'fixed_amount' | 'cards_in_hand';
  amount?: number;
  targetType: 'target_player' | 'all_opponents' | 'combat_damage_to_player';
}

export function detectMassMillEffect(card: any): MassMillEffect | null {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = (card?.name || "").toLowerCase();
  
  // Traumatize
  if (cardName.includes('traumatize')) {
    return {
      cardName: 'Traumatize',
      millType: 'half_library',
      targetType: 'target_player',
    };
  }
  
  // Maddening Cacophony
  if (cardName.includes('maddening cacophony')) {
    return {
      cardName: 'Maddening Cacophony',
      millType: 'half_library',  // When kicked
      targetType: 'all_opponents',
    };
  }
  
  // Fleet Swallower
  if (cardName.includes('fleet swallower')) {
    return {
      cardName: 'Fleet Swallower',
      millType: 'half_library',
      targetType: 'combat_damage_to_player',
    };
  }
  
  // Generic "mills half their library" pattern
  if (oracleText.includes('mills half') || 
      oracleText.includes('mill half') ||
      oracleText.includes('puts the top half')) {
    return {
      cardName: card?.name || 'Unknown',
      millType: 'half_library',
      targetType: oracleText.includes('target player') ? 'target_player' : 'all_opponents',
    };
  }
  
  return null;
}

// ============================================================================
// Archmage Ascension and Quest Counters
// ============================================================================

/**
 * Cards with quest/charge counter mechanics that trigger special effects:
 * - Archmage Ascension: 6 quest counters -> search library instead of draw
 * - Felidar Sovereign: Win at upkeep if 40+ life
 * - Quest for the Holy Relic: 5 quest counters -> search for Equipment
 */
export interface QuestCounter {
  permanentId: string;
  cardName: string;
  counterType: 'quest' | 'charge' | 'lore';
  threshold: number;
  thresholdEffect: string;
  triggerCondition: string;
}

export function detectQuestCounter(card: any, permanent: any): QuestCounter | null {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = (card?.name || "").toLowerCase();
  
  // Archmage Ascension
  if (cardName.includes('archmage ascension')) {
    return {
      permanentId: permanent?.id || '',
      cardName: 'Archmage Ascension',
      counterType: 'quest',
      threshold: 6,
      thresholdEffect: "Search your library for a card instead of drawing",
      triggerCondition: "Draw two or more cards in a turn",
    };
  }
  
  // Generic quest counter pattern
  if (oracleText.includes('quest counter')) {
    const thresholdMatch = oracleText.match(/(\d+) or more quest counters/);
    const threshold = thresholdMatch ? parseInt(thresholdMatch[1], 10) : 5;
    
    return {
      permanentId: permanent?.id || '',
      cardName: card?.name || 'Unknown',
      counterType: 'quest',
      threshold,
      thresholdEffect: "Special ability unlocked",
      triggerCondition: "Varies by card",
    };
  }
  
  return null;
}

// ============================================================================
// Utility Land Activated Abilities
// ============================================================================

/**
 * Lands with non-mana activated abilities:
 * - Ghost Quarter: Destroy target land. Its controller may search for a basic
 * - Homeward Path: Each player gains control of all creatures they own
 * - Rogue's Passage: Target creature can't be blocked this turn
 * - Nesting Grounds: Move a counter from one permanent to another
 * - Field of Ruin: Destroy target nonbasic land, each player searches for basic
 * - Detection Tower: Remove hexproof from opponent creatures
 * - Prahv, Spires of Order: Prevent all damage by target attacking/blocking creature
 */
export interface UtilityLandAbility {
  permanentId: string;
  cardName: string;
  cost: string;
  requiresTap: boolean;
  effect: string;
  targetType?: 'land' | 'nonbasic_land' | 'creature' | 'permanent' | 'counter';
  targetController?: 'any' | 'opponent' | 'you';
  additionalEffects?: string[];
  activationCondition?: 'attacked_with_two_or_more';  // For cards like Minas Tirith
}

const KNOWN_UTILITY_LANDS: Record<string, Omit<UtilityLandAbility, 'permanentId' | 'cardName'>> = {
  "ghost quarter": {
    cost: "{T}, Sacrifice ~",
    requiresTap: true,
    effect: "Destroy target land. Its controller may search for a basic land and put it onto the battlefield",
    targetType: 'land',
    targetController: 'any',
  },
  "homeward path": {
    cost: "{T}",
    requiresTap: true,
    effect: "Each player gains control of all creatures they own",
  },
  "rogue's passage": {
    cost: "{4}, {T}",
    requiresTap: true,
    effect: "Target creature can't be blocked this turn",
    targetType: 'creature',
    targetController: 'you',
  },
  "nesting grounds": {
    cost: "{1}, {T}",
    requiresTap: true,
    effect: "Move a counter from target permanent you control onto another target permanent",
    targetType: 'counter',
    targetController: 'you',
    additionalEffects: ["Requires two targets", "Counter types must match"],
  },
  "field of ruin": {
    cost: "{2}, {T}, Sacrifice ~",
    requiresTap: true,
    effect: "Destroy target nonbasic land. Each player searches for a basic land and puts it onto the battlefield",
    targetType: 'nonbasic_land',
    targetController: 'any',
  },
  "detection tower": {
    cost: "{1}, {T}",
    requiresTap: true,
    effect: "Until end of turn, creatures your opponents control lose hexproof and shroud",
  },
  "prahv, spires of order": {
    cost: "{4}{W}{U}, {T}",
    requiresTap: true,
    effect: "Prevent all damage that would be dealt by target attacking or blocking creature this turn",
    targetType: 'creature',
    targetController: 'any',
  },
  "maze of ith": {
    cost: "{T}",
    requiresTap: true,
    effect: "Untap target attacking creature. Prevent all combat damage dealt to and dealt by that creature this turn",
    targetType: 'creature',
    targetController: 'any',
  },
  "mystifying maze": {
    cost: "{4}, {T}",
    requiresTap: true,
    effect: "Exile target attacking creature. At end of combat, return it tapped",
    targetType: 'creature',
    targetController: 'any',
  },
  "thespian's stage": {
    cost: "{2}, {T}",
    requiresTap: true,
    effect: "This land becomes a copy of target land, except it has this ability",
    targetType: 'land',
    targetController: 'any',
  },
  "kessig wolf run": {
    cost: "{X}{R}{G}, {T}",
    requiresTap: true,
    effect: "Target creature gets +X/+0 and gains trample until end of turn",
    targetType: 'creature',
    targetController: 'you',
  },
  "alchemist's refuge": {
    cost: "{G}{U}, {T}",
    requiresTap: true,
    effect: "You may cast spells this turn as though they had flash",
  },
  "gavony township": {
    cost: "{2}{G}{W}, {T}",
    requiresTap: true,
    effect: "Put a +1/+1 counter on each creature you control",
  },
  "vault of the archangel": {
    cost: "{2}{W}{B}, {T}",
    requiresTap: true,
    effect: "Creatures you control gain deathtouch and lifelink until end of turn",
  },
  "slayers' stronghold": {
    cost: "{R}{W}, {T}",
    requiresTap: true,
    effect: "Target creature gets +2/+0 and gains vigilance and haste until end of turn",
    targetType: 'creature',
    targetController: 'you',
  },
  "minas tirith": {
    cost: "{1}{W}, {T}",
    requiresTap: true,
    effect: "Draw a card",
    activationCondition: 'attacked_with_two_or_more',
  },
};

export function detectUtilityLandAbility(card: any, permanent: any): UtilityLandAbility | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, abilityInfo] of Object.entries(KNOWN_UTILITY_LANDS)) {
    if (cardName.includes(knownName)) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || knownName,
        ...abilityInfo,
      };
    }
  }
  
  return null;
}

// ============================================================================
// Equipment Effects (Grafted Exoskeleton, Assault Suit, Umbral Mantle, Bear Umbra)
// ============================================================================

export interface EquipmentEffect {
  permanentId: string;
  cardName: string;
  equipCost: string;
  grantedKeywords?: string[];
  grantedPTBoost?: { power: number; toughness: number };
  grantedAbilities?: string[];
  specialEffect?: string;
  triggers?: string[];
  restrictions?: string[];
}

const KNOWN_EQUIPMENT_EFFECTS: Record<string, Omit<EquipmentEffect, 'permanentId' | 'cardName'>> = {
  "grafted exoskeleton": {
    equipCost: "{2}",
    grantedPTBoost: { power: 2, toughness: 2 },
    grantedKeywords: ['infect'],
    restrictions: ["When equipment becomes unattached, sacrifice creature"],
  },
  "assault suit": {
    equipCost: "{3}",
    grantedPTBoost: { power: 2, toughness: 2 },
    grantedKeywords: ['haste'],
    specialEffect: "At each opponent's upkeep, you may have them gain control of equipped creature until end of turn. It can't attack you or be sacrificed",
    restrictions: ["Equipped creature can't be sacrificed"],
  },
  "umbral mantle": {
    equipCost: "{0}",
    grantedPTBoost: { power: 2, toughness: 2 },
    grantedAbilities: ["{3}, Untap: This creature gets +2/+2 until end of turn"],
    specialEffect: "Equipped creature has '{3}, {Q}: This creature gets +2/+2 until end of turn'",
  },
  "sword of the animist": {
    equipCost: "{2}",
    grantedPTBoost: { power: 1, toughness: 1 },
    triggers: ["Whenever equipped creature attacks, search for a basic land and put it onto the battlefield tapped"],
  },
  "sword of feast and famine": {
    equipCost: "{2}",
    grantedPTBoost: { power: 2, toughness: 2 },
    grantedKeywords: ['protection from black', 'protection from green'],
    triggers: ["Whenever equipped creature deals combat damage to a player, that player discards a card and you untap all lands you control"],
  },
  "skullclamp": {
    equipCost: "{1}",
    grantedPTBoost: { power: 1, toughness: -1 },
    triggers: ["When equipped creature dies, draw two cards"],
  },
  "lightning greaves": {
    equipCost: "{0}",
    grantedKeywords: ['shroud', 'haste'],
  },
  "swiftfoot boots": {
    equipCost: "{1}",
    grantedKeywords: ['hexproof', 'haste'],
  },
  "helm of the host": {
    equipCost: "{5}",
    triggers: ["At the beginning of combat on your turn, create a token copy of equipped creature, except it's not legendary and gains haste"],
  },
};

export function detectEquipmentEffect(card: any, permanent: any): EquipmentEffect | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, effectInfo] of Object.entries(KNOWN_EQUIPMENT_EFFECTS)) {
    if (cardName.includes(knownName)) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || knownName,
        ...effectInfo,
      };
    }
  }
  
  return null;
}

// ============================================================================
// Aura Umbra Effects (Totem Armor)
// ============================================================================

export interface TotemArmorEffect {
  permanentId: string;
  cardName: string;
  grantedKeywords?: string[];
  grantedPTBoost?: { power: number; toughness: number };
  triggers?: string[];
}

const KNOWN_UMBRA_EFFECTS: Record<string, Omit<TotemArmorEffect, 'permanentId' | 'cardName'>> = {
  "bear umbra": {
    grantedPTBoost: { power: 2, toughness: 2 },
    triggers: ["Whenever enchanted creature attacks, untap all lands you control"],
  },
  "snake umbra": {
    grantedPTBoost: { power: 1, toughness: 1 },
    triggers: ["Whenever enchanted creature deals damage to a player, you may draw a card"],
  },
  "spider umbra": {
    grantedPTBoost: { power: 1, toughness: 1 },
    grantedKeywords: ['reach'],
  },
  "boar umbra": {
    grantedPTBoost: { power: 3, toughness: 3 },
  },
  "mammoth umbra": {
    grantedPTBoost: { power: 3, toughness: 3 },
    grantedKeywords: ['vigilance'],
  },
  "hyena umbra": {
    grantedPTBoost: { power: 1, toughness: 1 },
    grantedKeywords: ['first strike'],
  },
  "drake umbra": {
    grantedPTBoost: { power: 3, toughness: 3 },
    grantedKeywords: ['flying'],
  },
  "eel umbra": {
    grantedPTBoost: { power: 1, toughness: 1 },
    // Also has flash
  },
  "felidar umbra": {
    grantedPTBoost: { power: 1, toughness: 1 },
    grantedKeywords: ['lifelink'],
  },
};

export function detectUmbraEffect(card: any, permanent: any): TotemArmorEffect | null {
  const cardName = (card?.name || "").toLowerCase();
  const oracleText = (card?.oracle_text || "").toLowerCase();
  
  // Check if it has totem armor
  const hasTotemArmor = oracleText.includes('totem armor') || 
                        card?.keywords?.some((k: string) => k.toLowerCase() === 'totem armor');
  
  for (const [knownName, effectInfo] of Object.entries(KNOWN_UMBRA_EFFECTS)) {
    if (cardName.includes(knownName)) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || knownName,
        ...effectInfo,
      };
    }
  }
  
  // Generic umbra detection
  if (hasTotemArmor || cardName.includes('umbra')) {
    return {
      permanentId: permanent?.id || '',
      cardName: card?.name || 'Unknown Umbra',
    };
  }
  
  return null;
}

// ============================================================================
// Graveyard Triggers (Eldrazi mass shuffle, etc.)
// ============================================================================

/**
 * Check for graveyard triggers on a card
 * Returns true if a trigger was processed (like shuffling graveyard into library)
 */
export function checkGraveyardTrigger(ctx: any, card: any, ownerId: string): boolean {
  if (!hasGraveyardMassShuffleIntoLibraryTrigger(card)) {
    return false;
  }

  const shuffledCount = handleEldraziShuffle(ctx, ownerId, card);

  if (shuffledCount > 0) {
    if (ctx.bumpSeq && typeof ctx.bumpSeq === 'function') {
      ctx.bumpSeq();
    }

    return true;
  }

  return false;
}

// ============================================================================
// Control Change Effects (Reins of Power, Humble Defector, etc.)
// ============================================================================

export interface ControlChangeEffect {
  cardName: string;
  effectType: 'exchange_creatures' | 'give_control' | 'steal_control' | 'donate';
  duration: 'until_eot' | 'permanent' | 'until_condition';
  targets?: string;
  restrictions?: string[];
}

const KNOWN_CONTROL_CHANGE_EFFECTS: Record<string, ControlChangeEffect> = {
  "reins of power": {
    cardName: "Reins of Power",
    effectType: 'exchange_creatures',
    duration: 'until_eot',
    targets: "You and target opponent exchange control of all creatures",
    restrictions: ["Untap all creatures", "Creatures gain haste until end of turn"],
  },
  "humble defector": {
    cardName: "Humble Defector",
    effectType: 'give_control',
    duration: 'permanent',
    targets: "Target opponent gains control of Humble Defector",
    restrictions: ["Activate only as a sorcery", "Draw two cards first"],
  },
  "act of treason": {
    cardName: "Act of Treason",
    effectType: 'steal_control',
    duration: 'until_eot',
    targets: "Target creature",
    restrictions: ["Untap that creature", "It gains haste"],
  },
  "threaten": {
    cardName: "Threaten",
    effectType: 'steal_control',
    duration: 'until_eot',
    targets: "Target creature",
    restrictions: ["Untap that creature", "It gains haste"],
  },
  "dominate": {
    cardName: "Dominate",
    effectType: 'steal_control',
    duration: 'permanent',
    targets: "Target creature with mana value X or less",
  },
};

export function detectControlChangeEffect(card: any): ControlChangeEffect | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, effectInfo] of Object.entries(KNOWN_CONTROL_CHANGE_EFFECTS)) {
    if (cardName.includes(knownName)) {
      return effectInfo;
    }
  }
  
  return null;
}

// ============================================================================
// Infect and Poison Effects (Triumph of the Hordes, etc.)
// ============================================================================

export interface InfectGrantEffect {
  cardName: string;
  grantsTo: 'all_creatures' | 'target_creature' | 'equipped_creature';
  duration: 'until_eot' | 'permanent';
  additionalBoost?: { power: number; toughness: number };
  additionalKeywords?: string[];
}

const KNOWN_INFECT_GRANTS: Record<string, InfectGrantEffect> = {
  "triumph of the hordes": {
    cardName: "Triumph of the Hordes",
    grantsTo: 'all_creatures',
    duration: 'until_eot',
    additionalBoost: { power: 1, toughness: 1 },
    additionalKeywords: ['trample', 'infect'],
  },
  "tainted strike": {
    cardName: "Tainted Strike",
    grantsTo: 'target_creature',
    duration: 'until_eot',
    additionalBoost: { power: 1, toughness: 0 },
    additionalKeywords: ['infect'],
  },
  "grafted exoskeleton": {
    cardName: "Grafted Exoskeleton",
    grantsTo: 'equipped_creature',
    duration: 'permanent',
    additionalBoost: { power: 2, toughness: 2 },
    additionalKeywords: ['infect'],
  },
  "phyresis": {
    cardName: "Phyresis",
    grantsTo: 'equipped_creature', // Actually enchanted
    duration: 'permanent',
    additionalKeywords: ['infect'],
  },
};

export function detectInfectGrantEffect(card: any): InfectGrantEffect | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, effectInfo] of Object.entries(KNOWN_INFECT_GRANTS)) {
    if (cardName.includes(knownName)) {
      return effectInfo;
    }
  }
  
  return null;
}

// ============================================================================
// Temple Bell and Group Draw Effects
// ============================================================================

export interface GroupDrawEffect {
  permanentId: string;
  cardName: string;
  cost: string;
  drawAmount: number;
  affectedPlayers: 'all' | 'each_opponent' | 'you' | 'target_player';
  additionalEffects?: string[];
}

const KNOWN_GROUP_DRAW_EFFECTS: Record<string, Omit<GroupDrawEffect, 'permanentId' | 'cardName'>> = {
  "temple bell": {
    cost: "{T}",
    drawAmount: 1,
    affectedPlayers: 'all',
  },
  "howling mine": {
    cost: "Static (at draw step)",
    drawAmount: 1,
    affectedPlayers: 'all',
  },
  "font of mythos": {
    cost: "Static (at draw step)",
    drawAmount: 2,
    affectedPlayers: 'all',
  },
  "seizan, perverter of truth": {
    cost: "Static (at upkeep)",
    drawAmount: 2,
    affectedPlayers: 'all',
    additionalEffects: ["Each player loses 2 life"],
  },
  "master of the feast": {
    cost: "Static (at your upkeep)",
    drawAmount: 1,
    affectedPlayers: 'each_opponent',
  },
  "kami of the crescent moon": {
    cost: "Static (at draw step)",
    drawAmount: 1,
    affectedPlayers: 'all',
  },
};

export function detectGroupDrawEffect(card: any, permanent: any): GroupDrawEffect | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, effectInfo] of Object.entries(KNOWN_GROUP_DRAW_EFFECTS)) {
    if (cardName.includes(knownName)) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || knownName,
        ...effectInfo,
      };
    }
  }
  
  return null;
}

// ============================================================================
// Myriad Landscape and Multi-Target Land Search
// ============================================================================

/**
 * Lands that search for multiple lands with a shared type:
 * - Myriad Landscape: Search for 2 basic lands that share a land type
 * - Blighted Woodland: Search for 2 basic lands
 * - Krosan Verge: Search for a Forest and a Plains
 */
export interface MultiTargetLandSearch {
  permanentId: string;
  cardName: string;
  cost: string;
  searchCount: number;
  landTypeRestriction: 'share_type' | 'basic' | 'specific_types';
  specificTypes?: string[];
  putOntoTapped: boolean;
  requiresSacrifice: boolean;
}

const KNOWN_MULTI_TARGET_LAND_SEARCH: Record<string, Omit<MultiTargetLandSearch, 'permanentId' | 'cardName'>> = {
  "myriad landscape": {
    cost: "{2}, {T}, Sacrifice ~",
    searchCount: 2,
    landTypeRestriction: 'share_type',
    putOntoTapped: true,
    requiresSacrifice: true,
  },
  "blighted woodland": {
    cost: "{3}{G}, {T}, Sacrifice ~",
    searchCount: 2,
    landTypeRestriction: 'basic',
    putOntoTapped: true,
    requiresSacrifice: true,
  },
  "krosan verge": {
    cost: "{2}, {T}, Sacrifice ~",
    searchCount: 2,
    landTypeRestriction: 'specific_types',
    specificTypes: ['forest', 'plains'],
    putOntoTapped: true,
    requiresSacrifice: true,
  },
  "terminal moraine": {
    cost: "{2}, {T}, Sacrifice ~",
    searchCount: 1,
    landTypeRestriction: 'basic',
    putOntoTapped: false,
    requiresSacrifice: true,
  },
  "warped landscape": {
    cost: "{1}, {T}, Sacrifice ~",
    searchCount: 1,
    landTypeRestriction: 'basic',
    putOntoTapped: true,
    requiresSacrifice: true,
  },
};

export function detectMultiTargetLandSearch(card: any, permanent: any): MultiTargetLandSearch | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, searchInfo] of Object.entries(KNOWN_MULTI_TARGET_LAND_SEARCH)) {
    if (cardName.includes(knownName)) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || knownName,
        ...searchInfo,
      };
    }
  }
  
  return null;
}

/**
 * Validate that lands share a basic land type for Myriad Landscape
 */
export function validateSharedLandType(land1: any, land2: any): boolean {
  const typeLine1 = (land1?.card?.type_line || "").toLowerCase();
  const typeLine2 = (land2?.card?.type_line || "").toLowerCase();
  
  const basicTypes = ['plains', 'island', 'swamp', 'mountain', 'forest'];
  
  for (const basicType of basicTypes) {
    if (typeLine1.includes(basicType) && typeLine2.includes(basicType)) {
      return true;
    }
  }
  
  return false;
}

// ============================================================================
// Castle Garenbrig and Conditional ETB Tapped
// ============================================================================

/**
 * Lands that enter tapped unless a condition is met:
 * - Castle Garenbrig: Unless you control a Forest
 * - Castle Vantress: Unless you control an Island
 * - Castle Locthwain: Unless you control a Swamp
 * - Castle Embereth: Unless you control a Mountain
 * - Castle Ardenvale: Unless you control a Plains
 * - Checklands (Dragonskull Summit, etc.): Unless you control a [type]
 */
export interface ConditionalETBTapped {
  cardName: string;
  condition: string;
  requiredLandType?: string;
  requiredLandTypes?: string[];
  alternateCondition?: string;
}

const KNOWN_CONDITIONAL_ETB_TAPPED: Record<string, ConditionalETBTapped> = {
  // Castle lands (Eldraine)
  "castle garenbrig": {
    cardName: "Castle Garenbrig",
    condition: "Unless you control a Forest",
    requiredLandType: 'forest',
  },
  "castle vantress": {
    cardName: "Castle Vantress",
    condition: "Unless you control an Island",
    requiredLandType: 'island',
  },
  "castle locthwain": {
    cardName: "Castle Locthwain",
    condition: "Unless you control a Swamp",
    requiredLandType: 'swamp',
  },
  "castle embereth": {
    cardName: "Castle Embereth",
    condition: "Unless you control a Mountain",
    requiredLandType: 'mountain',
  },
  "castle ardenvale": {
    cardName: "Castle Ardenvale",
    condition: "Unless you control a Plains",
    requiredLandType: 'plains',
  },
  // Checklands (M10/Innistrad)
  "dragonskull summit": {
    cardName: "Dragonskull Summit",
    condition: "Unless you control a Swamp or a Mountain",
    requiredLandTypes: ['swamp', 'mountain'],
  },
  "drowned catacomb": {
    cardName: "Drowned Catacomb",
    condition: "Unless you control an Island or a Swamp",
    requiredLandTypes: ['island', 'swamp'],
  },
  "glacial fortress": {
    cardName: "Glacial Fortress",
    condition: "Unless you control a Plains or an Island",
    requiredLandTypes: ['plains', 'island'],
  },
  "rootbound crag": {
    cardName: "Rootbound Crag",
    condition: "Unless you control a Mountain or a Forest",
    requiredLandTypes: ['mountain', 'forest'],
  },
  "sunpetal grove": {
    cardName: "Sunpetal Grove",
    condition: "Unless you control a Forest or a Plains",
    requiredLandTypes: ['forest', 'plains'],
  },
  "clifftop retreat": {
    cardName: "Clifftop Retreat",
    condition: "Unless you control a Mountain or a Plains",
    requiredLandTypes: ['mountain', 'plains'],
  },
  "hinterland harbor": {
    cardName: "Hinterland Harbor",
    condition: "Unless you control a Forest or an Island",
    requiredLandTypes: ['forest', 'island'],
  },
  "isolated chapel": {
    cardName: "Isolated Chapel",
    condition: "Unless you control a Plains or a Swamp",
    requiredLandTypes: ['plains', 'swamp'],
  },
  "sulfur falls": {
    cardName: "Sulfur Falls",
    condition: "Unless you control an Island or a Mountain",
    requiredLandTypes: ['island', 'mountain'],
  },
  "woodland cemetery": {
    cardName: "Woodland Cemetery",
    condition: "Unless you control a Swamp or a Forest",
    requiredLandTypes: ['swamp', 'forest'],
  },
};

export function detectConditionalETBTapped(card: any): ConditionalETBTapped | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, condition] of Object.entries(KNOWN_CONDITIONAL_ETB_TAPPED)) {
    if (cardName.includes(knownName)) {
      return condition;
    }
  }
  
  // Dynamic detection from oracle text
  const oracleText = (card?.oracle_text || "").toLowerCase();
  
  // Pattern: "enters the battlefield tapped unless you control a [land type]" or "enters tapped unless..."
  // Supports both old "enters the battlefield tapped" and new Bloomburrow "enters tapped" templates
  const unlessControlMatch = oracleText.match(
    /(?:this land )?enters(?: the battlefield)? tapped unless you control (?:a|an) (\w+)(?: or (?:a|an) (\w+))?/i
  );
  
  if (unlessControlMatch) {
    const type1 = unlessControlMatch[1];
    const type2 = unlessControlMatch[2];
    
    if (type2) {
      return {
        cardName: card?.name || 'Unknown',
        condition: `Unless you control a ${type1} or a ${type2}`,
        requiredLandTypes: [type1, type2],
      };
    } else {
      return {
        cardName: card?.name || 'Unknown',
        condition: `Unless you control a ${type1}`,
        requiredLandType: type1,
      };
    }
  }
  
  return null;
}

/**
 * Check if the conditional ETB tapped condition is met (enters untapped)
 */
export function checkConditionalETBMet(
  condition: ConditionalETBTapped,
  gameState: any,
  playerId: string
): boolean {
  const battlefield = gameState?.battlefield || [];
  
  // Check if player controls the required land type(s)
  const controlledLands = battlefield.filter((p: any) => 
    p?.controller === playerId &&
    (p.card?.type_line || '').toLowerCase().includes('land')
  );
  
  if (condition.requiredLandType) {
    return controlledLands.some((land: any) => 
      (land.card?.type_line || '').toLowerCase().includes(condition.requiredLandType!)
    );
  }
  
  if (condition.requiredLandTypes) {
    return controlledLands.some((land: any) => {
      const typeLine = (land.card?.type_line || '').toLowerCase();
      return condition.requiredLandTypes!.some(type => typeLine.includes(type));
    });
  }
  
  return false;
}

// ============================================================================
// Genesis Wave and Library Reveal/Play Effects
// ============================================================================

/**
 * Cards that reveal cards from library and put them onto battlefield:
 * - Genesis Wave: Reveal X cards, put permanents with MV X or less onto battlefield
 * - Collected Company: Look at top 6, put 2 creatures (MV 3 or less) onto battlefield
 * - Finale of Devastation: Search for creature, put onto battlefield
 * - Chord of Calling: Search for creature with MV X or less
 * - Green Sun's Zenith: Search for green creature with MV X or less
 */
export interface LibraryRevealPlayEffect {
  cardName: string;
  revealCount: number | 'X';
  xMultiplier?: number;
  filterType: 'permanent_mv' | 'creature_mv' | 'land' | 'any';
  maxMV?: number | 'X';
  destination: 'battlefield' | 'hand' | 'graveyard' | 'bottom';
  additionalEffect?: string;
}

const KNOWN_LIBRARY_REVEAL_PLAY: Record<string, LibraryRevealPlayEffect> = {
  "genesis wave": {
    cardName: "Genesis Wave",
    revealCount: 'X',
    filterType: 'permanent_mv',
    maxMV: 'X',
    destination: 'battlefield',
    additionalEffect: "Put the rest on the bottom of your library in any order",
  },
  "collected company": {
    cardName: "Collected Company",
    revealCount: 6,
    filterType: 'creature_mv',
    maxMV: 3,
    destination: 'battlefield',
    additionalEffect: "Put up to 2 creatures onto the battlefield",
  },
  "finale of devastation": {
    cardName: "Finale of Devastation",
    revealCount: 'X',
    filterType: 'creature_mv',
    maxMV: 'X',
    destination: 'battlefield',
    additionalEffect: "If X is 10 or more, creatures get +X/+X and haste",
  },
  "chord of calling": {
    cardName: "Chord of Calling",
    revealCount: 0, // Searches directly, doesn't reveal
    filterType: 'creature_mv',
    maxMV: 'X',
    destination: 'battlefield',
  },
  "green sun's zenith": {
    cardName: "Green Sun's Zenith",
    revealCount: 0, // Searches directly
    filterType: 'creature_mv', // Green creature specifically
    maxMV: 'X',
    destination: 'battlefield',
    additionalEffect: "Shuffle this card into your library",
  },
  "natural order": {
    cardName: "Natural Order",
    revealCount: 0, // Searches directly
    filterType: 'creature_mv', // Green creature specifically
    destination: 'battlefield',
    additionalEffect: "Sacrifice a green creature as additional cost",
  },
  "see the unwritten": {
    cardName: "See the Unwritten",
    revealCount: 8,
    filterType: 'creature_mv',
    destination: 'battlefield',
    additionalEffect: "Ferocious: Put 2 creatures if you control creature with power 4+",
  },
};

export function detectLibraryRevealPlayEffect(card: any): LibraryRevealPlayEffect | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, effectInfo] of Object.entries(KNOWN_LIBRARY_REVEAL_PLAY)) {
    if (cardName.includes(knownName)) {
      return effectInfo;
    }
  }
  
  return null;
}

// NOTE: Reanimate Effects have been moved to ./triggers/reanimate.ts
// Re-exports are at the top of this file

// ============================================================================
// Eladamri and Top Card Viewing Effects
// ============================================================================

/**
 * Cards that let you look at the top card(s) of your library:
 * - Eladamri, Lord of Leaves: Look at top card, may play forests
 * - Courser of Kruphix: Play lands from top
 * - Oracle of Mul Daya: Play lands from top, additional land drop
 * - Vizier of the Menagerie: Cast creatures from top
 * - Future Sight: Play cards from top
 */
export interface TopCardViewEffect {
  permanentId: string;
  cardName: string;
  viewCount: number;
  revealToAll: boolean;
  canPlayTypes?: string[];
  additionalLandDrop?: boolean;
}

const KNOWN_TOP_CARD_VIEW: Record<string, Omit<TopCardViewEffect, 'permanentId' | 'cardName'>> = {
  "courser of kruphix": {
    viewCount: 1,
    revealToAll: true,
    canPlayTypes: ['land'],
  },
  "oracle of mul daya": {
    viewCount: 1,
    revealToAll: true,
    canPlayTypes: ['land'],
    additionalLandDrop: true,
  },
  "vizier of the menagerie": {
    viewCount: 1,
    revealToAll: false, // Can look, but only revealed when you cast
    canPlayTypes: ['creature'],
  },
  "future sight": {
    viewCount: 1,
    revealToAll: true,
    canPlayTypes: ['land', 'creature', 'artifact', 'enchantment', 'planeswalker', 'instant', 'sorcery'],
  },
  "precognition field": {
    viewCount: 1,
    revealToAll: false,
    canPlayTypes: ['instant', 'sorcery'],
  },
  "bolas's citadel": {
    viewCount: 1,
    revealToAll: true,
    canPlayTypes: ['land', 'creature', 'artifact', 'enchantment', 'planeswalker', 'instant', 'sorcery'],
    // Note: Pays life equal to MV instead of mana cost
  },
  "experimental frenzy": {
    viewCount: 1,
    revealToAll: true,
    canPlayTypes: ['land', 'creature', 'artifact', 'enchantment', 'planeswalker', 'instant', 'sorcery'],
    // Note: Can't play cards from hand
  },
  "radha, heart of keld": {
    viewCount: 1,
    revealToAll: false,
    canPlayTypes: ['land'],
  },
  "garruk's horde": {
    viewCount: 1,
    revealToAll: true,
    canPlayTypes: ['creature'],
  },
};

export function detectTopCardViewEffect(card: any, permanent: any): TopCardViewEffect | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, effectInfo] of Object.entries(KNOWN_TOP_CARD_VIEW)) {
    if (cardName.includes(knownName)) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || knownName,
        ...effectInfo,
      };
    }
  }
  
  return null;
}

// ============================================================================
// Traverse the Outlands and Power-Based Land Search
// ============================================================================

/**
 * Cards that search for lands based on creature power or other variable:
 * - Traverse the Outlands: Search for X basic lands where X = greatest power
 * - Boundless Realms: Search for basic lands up to number you control
 * - Reshape the Earth: Search for any 10 lands
 */
export interface PowerBasedLandSearch {
  cardName: string;
  searchBasis: 'greatest_power' | 'lands_controlled' | 'fixed';
  landType: 'basic' | 'any';
  fixedCount?: number;
  entersTapped: boolean;
}

const KNOWN_POWER_BASED_LAND_SEARCH: Record<string, PowerBasedLandSearch> = {
  "traverse the outlands": {
    cardName: "Traverse the Outlands",
    searchBasis: 'greatest_power',
    landType: 'basic',
    entersTapped: true,
  },
  "boundless realms": {
    cardName: "Boundless Realms",
    searchBasis: 'lands_controlled',
    landType: 'basic',
    entersTapped: true,
  },
  "reshape the earth": {
    cardName: "Reshape the Earth",
    searchBasis: 'fixed',
    landType: 'any',
    fixedCount: 10,
    entersTapped: true,
  },
  "scapeshift": {
    cardName: "Scapeshift",
    searchBasis: 'lands_controlled', // Sacrifice any number, search that many
    landType: 'any',
    entersTapped: false,
  },
};

export function detectPowerBasedLandSearch(card: any): PowerBasedLandSearch | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, searchInfo] of Object.entries(KNOWN_POWER_BASED_LAND_SEARCH)) {
    if (cardName.includes(knownName)) {
      return searchInfo;
    }
  }
  
  return null;
}

/**
 * Calculate the number of lands to search for based on game state
 */
export function calculateLandSearchCount(
  effect: PowerBasedLandSearch,
  gameState: any,
  playerId: string
): number {
  const battlefield = gameState?.battlefield || [];
  
  if (effect.searchBasis === 'fixed' && effect.fixedCount) {
    return effect.fixedCount;
  }
  
  if (effect.searchBasis === 'greatest_power') {
    let greatestPower = 0;
    for (const perm of battlefield) {
      if (!perm || perm.controller !== playerId) continue;
      const typeLine = (perm.card?.type_line || '').toLowerCase();
      if (!typeLine.includes('creature')) continue;
      
      // Use the canonical power calculation function
      const { power } = getActualPowerToughness(perm, gameState);
      if (power > greatestPower) greatestPower = power;
    }
    return greatestPower;
  }
  
  if (effect.searchBasis === 'lands_controlled') {
    return battlefield.filter((p: any) =>
      p?.controller === playerId &&
      (p.card?.type_line || '').toLowerCase().includes('land')
    ).length;
  }
  
  return 0;
}

// ============================================================================
// Charge Counter Support (Everflowing Chalice, Evendo, etc.)
// ============================================================================

/**
 * Permanents that use charge counters for effects:
 * - Everflowing Chalice: Add {C} for each charge counter
 * - Astral Cornucopia: Add mana equal to charge counters
 * - Lux Cannon: Remove 3 counters to destroy permanent
 * - Titan Forge: Remove 3 counters to create 9/9 Golem
 */
export interface ChargeCounterAbility {
  permanentId: string;
  cardName: string;
  addCounterCost?: string;
  useCountersCost?: string;
  useCountersAmount?: number;
  effect: string;
  effectType: 'mana_per_counter' | 'threshold_effect' | 'per_counter_effect';
}

const KNOWN_CHARGE_COUNTER_ABILITIES: Record<string, Omit<ChargeCounterAbility, 'permanentId' | 'cardName'>> = {
  "everflowing chalice": {
    effect: "Add {C} for each charge counter",
    effectType: 'mana_per_counter',
  },
  "astral cornucopia": {
    effect: "Add X mana of any one color where X is charge counters",
    effectType: 'mana_per_counter',
  },
  "lux cannon": {
    addCounterCost: "{T}",
    useCountersCost: "{T}, Remove 3 charge counters",
    useCountersAmount: 3,
    effect: "Destroy target permanent",
    effectType: 'threshold_effect',
  },
  "titan forge": {
    addCounterCost: "{3}, {T}",
    useCountersCost: "{T}, Remove 3 charge counters",
    useCountersAmount: 3,
    effect: "Create a 9/9 colorless Golem artifact creature token",
    effectType: 'threshold_effect',
  },
  "gemstone array": {
    addCounterCost: "{2}",
    useCountersCost: "Remove a charge counter",
    useCountersAmount: 1,
    effect: "Add one mana of any color",
    effectType: 'per_counter_effect',
  },
  "surge node": {
    addCounterCost: "{1}, {T}",
    useCountersCost: "{1}, {T}, Remove a charge counter",
    useCountersAmount: 1,
    effect: "Put a charge counter on target artifact",
    effectType: 'per_counter_effect',
  },
};

export function detectChargeCounterAbility(card: any, permanent: any): ChargeCounterAbility | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, abilityInfo] of Object.entries(KNOWN_CHARGE_COUNTER_ABILITIES)) {
    if (cardName.includes(knownName)) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || knownName,
        ...abilityInfo,
      };
    }
  }
  
  return null;
}

// ============================================================================
// Special Cards: Chameleon Colossus, March of the World Ooze, etc.
// ============================================================================

/**
 * Cards with unique activated or triggered abilities that need special handling:
 * - Chameleon Colossus: Double power/toughness activated ability
 * - March of the Ooze: Token creation based on counters
 * - Tale of Katara and Toph: Saga with unique effects
 * - The Seriema: Transform conditions
 */
export interface SpecialCardEffect {
  permanentId: string;
  cardName: string;
  effectType: 'double_pt' | 'counter_based_tokens' | 'saga' | 'transform' | 'protection_from_all' | 'changeling';
  activatedAbilityCost?: string;
  effect: string;
  additionalInfo?: Record<string, any>;
}

const KNOWN_SPECIAL_CARDS: Record<string, Omit<SpecialCardEffect, 'permanentId' | 'cardName'>> = {
  "chameleon colossus": {
    effectType: 'double_pt',
    activatedAbilityCost: "{2}{G}{G}",
    effect: "Chameleon Colossus gets +X/+X until end of turn, where X is its power",
    additionalInfo: {
      hasChangeling: true,
      hasProtectionFromBlack: true,
    },
  },
  "progenitus": {
    effectType: 'protection_from_all',
    effect: "Protection from everything",
    additionalInfo: {
      shuffleWhenToGraveyard: true,
    },
  },
  "mistform ultimus": {
    effectType: 'changeling',
    effect: "Is every creature type",
  },
  "morophon, the boundless": {
    effectType: 'changeling',
    effect: "Is every creature type, chosen type spells cost WUBRG less",
  },
};

export function detectSpecialCardEffect(card: any, permanent: any): SpecialCardEffect | null {
  const cardName = (card?.name || "").toLowerCase();
  const oracleText = (card?.oracle_text || "").toLowerCase();
  
  for (const [knownName, effectInfo] of Object.entries(KNOWN_SPECIAL_CARDS)) {
    if (cardName.includes(knownName)) {
      return {
        permanentId: permanent?.id || '',
        cardName: card?.name || knownName,
        ...effectInfo,
      };
    }
  }
  
  // Dynamic detection for changeling
  if (oracleText.includes('changeling') || 
      (card?.keywords || []).some((k: string) => k.toLowerCase() === 'changeling')) {
    return {
      permanentId: permanent?.id || '',
      cardName: card?.name || 'Unknown',
      effectType: 'changeling',
      effect: "Is every creature type",
    };
  }
  
  // Dynamic detection for protection from everything
  if (oracleText.includes('protection from everything')) {
    return {
      permanentId: permanent?.id || '',
      cardName: card?.name || 'Unknown',
      effectType: 'protection_from_all',
      effect: "Protection from everything",
    };
  }
  
  // Dynamic detection for double power/toughness
  if (oracleText.match(/gets?\s+\+x\/\+x.*where\s+x\s+is\s+its\s+power/i)) {
    const costMatch = oracleText.match(/(\{[^}]+\}(?:\{[^}]+\})*)\s*:/);
    return {
      permanentId: permanent?.id || '',
      cardName: card?.name || 'Unknown',
      effectType: 'double_pt',
      activatedAbilityCost: costMatch ? costMatch[1] : undefined,
      effect: "Gets +X/+X where X is its power",
    };
  }
  
  return null;
}

// ============================================================================
// Planeswalker Loyalty Ability Support
// ============================================================================

/**
 * Planeswalker loyalty abilities parsed from oracle text
 * 
 * Supports all standard planeswalker ability formats:
 * - [+N]: Add N loyalty (e.g., [+2]: Exile top three cards)
 * - [-N]: Remove N loyalty (e.g., [-3]: Return target creature)
 * - [0]: No loyalty change (e.g., [0]: Draw a card)
 * - [-X]: Variable loyalty cost (e.g., [-X]: Put a creature with MV X onto battlefield)
 * 
 * Examples from actual cards:
 * - Ashiok, Nightmare Weaver: [+2], [-X], [-10]
 * - Liliana of the Veil: [+1], [-2], [-6]
 * - Jace, the Mind Sculptor: [+2], [0], [-1], [-12]
 * - Nissa, Who Shakes the World: [+1], [-8]
 */
export interface LoyaltyAbility {
  cost: number | 'X'; // Positive = add loyalty, negative = remove, 0 = static, 'X' = variable
  costDisplay: string; // Original cost string for display ("+2", "-X", "0", etc.)
  effect: string;
  requiresTarget: boolean;
  targetType?: string;
  isUltimate?: boolean;
  isVariableCost?: boolean; // True for -X abilities
  xBasedEffect?: string; // Description of what X represents (e.g., "mana value")
}

export interface PlaneswalkerAbilities {
  permanentId: string;
  cardName: string;
  startingLoyalty: number;
  abilities: LoyaltyAbility[];
  hasStaticAbility?: boolean;
  staticAbilityText?: string;
}

/**
 * Parse planeswalker abilities from oracle text
 * 
 * Handles all 168+ planeswalkers including:
 * - Standard +N/-N abilities
 * - Variable -X abilities (Ashiok, Nissa Revane, etc.)
 * - Static abilities (Narset Transcendent, The Wanderer, etc.)
 * - Zero-cost abilities (Jace TMS, Teferi Hero of Dominaria, etc.)
 */
export function parsePlaneswalkerAbilities(card: any, permanent: any): PlaneswalkerAbilities | null {
  const oracleText = card?.oracle_text || "";
  const typeLine = (card?.type_line || "").toLowerCase();
  
  if (!typeLine.includes('planeswalker')) {
    return null;
  }
  
  const startingLoyalty = card?.loyalty ? parseInt(card.loyalty, 10) : 0;
  const abilities: LoyaltyAbility[] = [];
  
  // Check for static abilities (text before first loyalty ability)
  // Examples: "Your opponents can't cast noncreature spells during combat."
  // Static abilities don't have [+/-N]: format
  let hasStaticAbility = false;
  let staticAbilityText: string | undefined;
  
  // Find first loyalty ability marker
  const firstLoyaltyMatch = oracleText.match(/\[[+-]?(?:\d+|X)\]:/i);
  if (firstLoyaltyMatch && firstLoyaltyMatch.index && firstLoyaltyMatch.index > 0) {
    const textBeforeLoyalty = oracleText.substring(0, firstLoyaltyMatch.index).trim();
    // If there's substantial text before the first loyalty ability, it's likely a static ability
    if (textBeforeLoyalty.length > 10 && !textBeforeLoyalty.startsWith('—')) {
      hasStaticAbility = true;
      staticAbilityText = textBeforeLoyalty;
    }
  }
  
  // Parse loyalty abilities: +N:, -N:, 0:, -X:, +X: (Scryfall format WITHOUT brackets)
  // Pattern handles both numeric costs and X costs, and various dash characters
  // The Unicode minus sign (−, U+2212) is commonly used in Scryfall data
  // Examples: +2: Effect, −3: Effect, 0: Effect, −X: Effect
  // Note: Scryfall oracle text uses newlines to separate abilities, so we match from start of line
  const loyaltyPattern = /^([+−–—-]?\d+|[+−–—-]?X):\s*(.+)$/gim;
  let match;
  
  while ((match = loyaltyPattern.exec(oracleText)) !== null) {
    const rawCostString = match[1];
    const effect = match[2].trim();
    
    // Normalize the cost string by replacing Unicode minus/dash characters with standard minus
    const costString = rawCostString.replace(/[−–—]/g, '-');
    const isVariableCost = costString.toUpperCase().includes('X');
    
    // Parse the cost value
    let cost: number | 'X';
    if (isVariableCost) {
      cost = 'X';
    } else {
      cost = parseInt(costString, 10);
    }
    
    // Detect if this ability requires a target
    const effectLower = effect.toLowerCase();
    const requiresTarget = 
      effectLower.includes('target') ||
      effectLower.includes('choose');
    
    // Detect target type (expanded list)
    let targetType: string | undefined;
    if (requiresTarget) {
      if (effectLower.includes('target creature')) targetType = 'creature';
      else if (effectLower.includes('target player') || effectLower.includes("target opponent")) targetType = 'player';
      else if (effectLower.includes('target permanent')) targetType = 'permanent';
      else if (effectLower.includes('target land')) targetType = 'land';
      else if (effectLower.includes('target artifact')) targetType = 'artifact';
      else if (effectLower.includes('target enchantment')) targetType = 'enchantment';
      else if (effectLower.includes('target planeswalker')) targetType = 'planeswalker';
      else if (effectLower.includes('target spell')) targetType = 'spell';
      else if (effectLower.includes('target card')) targetType = 'card';
      else if (effectLower.includes('target nonland')) targetType = 'nonland permanent';
      else if (effectLower.includes('target noncreature')) targetType = 'noncreature permanent';
    }
    
    // For X abilities, try to detect what X represents
    let xBasedEffect: string | undefined;
    if (isVariableCost) {
      if (effectLower.includes('mana value x') || effectLower.includes('mana value equal')) {
        xBasedEffect = 'mana value';
      } else if (effectLower.includes('power x') || effectLower.includes('power equal')) {
        xBasedEffect = 'power';
      } else if (effectLower.includes('x damage')) {
        xBasedEffect = 'damage';
      } else if (effectLower.includes('x cards')) {
        xBasedEffect = 'cards';
      } else if (effectLower.includes('x target') || effectLower.includes('x creatures')) {
        xBasedEffect = 'targets';
      }
    }
    
    abilities.push({
      cost,
      costDisplay: costString.startsWith('+') || costString.startsWith('-') ? costString : `+${costString}`,
      effect,
      requiresTarget,
      targetType,
      isVariableCost,
      xBasedEffect,
    });
  }
  
  // Determine ultimate ability (typically the largest negative cost, or only negative ability)
  // For variable X costs, it's usually an ultimate if there are no other large negative costs
  if (abilities.length > 0) {
    let lowestCost = 0;
    let lowestCostIndex = -1;
    
    for (let i = 0; i < abilities.length; i++) {
      const ability = abilities[i];
      if (ability.cost === 'X') {
        // -X is often an ultimate or at least a significant ability
        // If it's the only negative ability, mark it as ultimate
        const hasOtherNegative = abilities.some((a, idx) => 
          idx !== i && typeof a.cost === 'number' && a.cost < 0
        );
        if (!hasOtherNegative) {
          ability.isUltimate = true;
        }
      } else if (typeof ability.cost === 'number' && ability.cost < lowestCost) {
        lowestCost = ability.cost;
        lowestCostIndex = i;
      }
    }
    
    // Mark the ability with lowest cost as ultimate (typically -6 or lower)
    if (lowestCostIndex >= 0 && lowestCost <= -5) {
      abilities[lowestCostIndex].isUltimate = true;
    } else if (lowestCostIndex >= 0 && abilities.length >= 3) {
      // For 3+ ability planeswalkers, the last negative ability is usually the ultimate
      // even if cost is lower than -5 (e.g., Liliana of the Veil's -6)
      abilities[lowestCostIndex].isUltimate = true;
    }
  }
  
  if (abilities.length === 0 && !hasStaticAbility) {
    return null;
  }
  
  return {
    permanentId: permanent?.id || '',
    cardName: card?.name || 'Unknown Planeswalker',
    startingLoyalty,
    abilities,
    hasStaticAbility,
    staticAbilityText,
  };
}

/**
 * Get the maximum number of loyalty ability activations per planeswalker per turn
 * 
 * Default is 1, but can be increased by:
 * - The Chain Veil: "At the beginning of your end step, if you didn't activate a loyalty ability
 *   of a planeswalker this turn, you lose 2 life. You may activate loyalty abilities of 
 *   planeswalkers you control twice each turn rather than only once."
 * - Oath of Teferi: "You may activate the loyalty abilities of planeswalkers you control twice
 *   each turn rather than only once."
 * - Teferi, Temporal Pilgrim emblem
 * - Carth the Lion (from graveyard)
 * - Nicol Bolas, Dragon-God (copying abilities)
 */
export function getLoyaltyActivationLimit(gameState: any, playerId: string): number {
  let limit = 1; // Default: once per turn
  
  const battlefield = gameState?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== playerId) continue;
    
    const cardName = (permanent.card?.name || "").toLowerCase();
    const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
    
    // The Chain Veil
    if (cardName === "the chain veil") {
      limit = Math.max(limit, 2);
    }
    
    // Oath of Teferi
    if (cardName === "oath of teferi") {
      limit = Math.max(limit, 2);
    }
    
    // Carth the Lion - "You may activate loyalty abilities of planeswalkers you control twice"
    if (cardName === "carth the lion") {
      limit = Math.max(limit, 2);
    }
    
    // Generic check for "loyalty abilities...twice each turn" or similar
    if (oracleText.includes("loyalty abilities") && 
        (oracleText.includes("twice each turn") || oracleText.includes("twice rather than only once"))) {
      limit = Math.max(limit, 2);
    }
    
    // Some effects might allow even more activations (theoretical future cards)
    const tripleMatch = oracleText.match(/loyalty abilities.*three times/i);
    if (tripleMatch) {
      limit = Math.max(limit, 3);
    }
  }
  
  // Check emblems (stored in a different location)
  const emblems = gameState?.emblems || [];
  for (const emblem of emblems) {
    if (!emblem || emblem.controller !== playerId) continue;
    
    const oracleText = (emblem.effect || "").toLowerCase();
    
    if (oracleText.includes("loyalty abilities") && 
        (oracleText.includes("twice") || oracleText.includes("additional"))) {
      limit = Math.max(limit, 2);
    }
  }
  
  return limit;
}

/**
 * Check if The Chain Veil trigger should fire (end step: lose 2 life if no loyalty activated)
 */
export function checkChainVeilEndStepTrigger(gameState: any, playerId: string): boolean {
  const battlefield = gameState?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== playerId) continue;
    
    const cardName = (permanent.card?.name || "").toLowerCase();
    
    if (cardName === "the chain veil") {
      // Check if any planeswalker loyalty ability was activated this turn
      const planeswalkers = battlefield.filter((p: any) => 
        p?.controller === playerId && 
        (p?.card?.type_line || "").toLowerCase().includes("planeswalker")
      );
      
      const anyActivated = planeswalkers.some((pw: any) => 
        (pw?.loyaltyActivationsThisTurn || 0) > 0
      );
      
      // If no loyalty ability was activated, trigger the 2 life loss
      return !anyActivated;
    }
  }
  
  return false;
}

/**
 * Check if a planeswalker can activate a specific ability
 * (Once per turn per planeswalker, at sorcery speed, loyalty requirement met)
 * 
 * Handles:
 * - Standard +N/-N abilities
 * - Variable -X abilities (can always activate if loyalty >= 1)
 * - Zero cost abilities
 * - The Chain Veil effect (additional loyalty activation)
 * - Oath of Teferi effect (activate loyalty twice per turn)
 * - Eidolon of Obstruction (loyalty abilities cost {1} more for opponents)
 * - Teferi's Talent emblem (instant speed loyalty activation)
 */
export function canActivateLoyaltyAbility(
  permanent: any,
  abilityIndex: number,
  gameState: any,
  playerId: string,
  xValue?: number // For -X abilities, what X value the player wants to use
): { canActivate: boolean; reason?: string; maxX?: number; additionalManaCost?: number } {
  // Check controller
  if (permanent?.controller !== playerId) {
    return { canActivate: false, reason: "Not your planeswalker" };
  }
  
  // Check if already activated this turn, considering Chain Veil and similar effects
  const activationsThisTurn = permanent?.loyaltyActivationsThisTurn || 0;
  const maxActivations = getLoyaltyActivationLimit(gameState, playerId);
  
  if (activationsThisTurn >= maxActivations) {
    return { canActivate: false, reason: "Already activated maximum loyalty abilities this turn" };
  }
  
  // Check current loyalty
  const currentLoyalty = permanent?.counters?.loyalty || permanent?.card?.loyalty || 0;
  const abilities = parsePlaneswalkerAbilities(permanent?.card, permanent);
  
  if (!abilities || abilityIndex >= abilities.abilities.length) {
    return { canActivate: false, reason: "Invalid ability" };
  }
  
  const ability = abilities.abilities[abilityIndex];
  
  // Calculate additional mana cost from effects like Eidolon of Obstruction
  const additionalManaCost = getLoyaltyAdditionalCost(gameState, playerId, permanent);
  
  // Handle variable X cost abilities
  if (ability.cost === 'X' || ability.isVariableCost) {
    // -X abilities can be activated with any X from 0 to current loyalty
    // The player chooses X when activating
    const maxX = currentLoyalty;
    
    if (xValue !== undefined) {
      // Validate the chosen X value
      if (xValue < 0) {
        return { canActivate: false, reason: "X cannot be negative", maxX, additionalManaCost };
      }
      if (xValue > currentLoyalty) {
        return { canActivate: false, reason: `X cannot exceed current loyalty (${currentLoyalty})`, maxX, additionalManaCost };
      }
    }
    
    // Can activate -X ability as long as we have any loyalty
    // (X can be 0 in some cases)
    return { canActivate: true, maxX, additionalManaCost };
  }
  
  // For minus abilities with fixed cost, check if we have enough loyalty
  if (typeof ability.cost === 'number' && ability.cost < 0 && currentLoyalty < Math.abs(ability.cost)) {
    return { canActivate: false, reason: `Not enough loyalty (have ${currentLoyalty}, need ${Math.abs(ability.cost)})`, additionalManaCost };
  }
  
  // Check timing restrictions
  const canActivateAtInstantSpeed = canActivateLoyaltyAtInstantSpeed(gameState, playerId);
  const phase = gameState?.phase || '';
  const stack = gameState?.stack || [];
  const activePlayer = gameState?.activePlayer;
  
  if (!canActivateAtInstantSpeed) {
    // Normal sorcery speed check (main phase, stack empty, have priority)
    if (!phase.includes('main') || stack.length > 0) {
      return { canActivate: false, reason: "Can only activate at sorcery speed", additionalManaCost };
    }
    
    if (activePlayer !== playerId) {
      return { canActivate: false, reason: "Not your turn", additionalManaCost };
    }
  }
  // If instant speed is allowed, skip the sorcery speed checks
  
  return { canActivate: true, additionalManaCost };
}

/**
 * Get additional mana cost for activating loyalty abilities
 * 
 * Effects that increase loyalty ability costs:
 * - Eidolon of Obstruction: "Loyalty abilities of planeswalkers your opponents control cost {1} more to activate"
 * - Suppression Field: "Activated abilities cost {2} more to activate" (includes loyalty abilities)
 */
export function getLoyaltyAdditionalCost(gameState: any, playerId: string, planeswalker: any): number {
  let additionalCost = 0;
  const battlefield = gameState?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent) continue;
    
    const cardName = (permanent.card?.name || "").toLowerCase();
    const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
    const controller = permanent.controller;
    
    // Eidolon of Obstruction - affects opponents' planeswalkers
    if (cardName === "eidolon of obstruction" && controller !== playerId) {
      // The planeswalker's controller is playerId, and Eidolon is controlled by opponent
      // So this makes playerId's loyalty abilities cost more
      additionalCost += 1;
    }
    
    // Also check for generic "loyalty abilities...cost...more" patterns
    // This handles similar future cards
    if (controller !== playerId && 
        oracleText.includes("loyalty abilities") && 
        oracleText.includes("opponents control") &&
        oracleText.includes("cost") && 
        oracleText.includes("more")) {
      // Try to extract the amount
      const costMatch = oracleText.match(/cost\s*\{(\d+)\}\s*more/);
      if (costMatch) {
        additionalCost += parseInt(costMatch[1], 10);
      }
    }
    
    // Suppression Field affects all activated abilities
    if (cardName === "suppression field") {
      additionalCost += 2;
    }
    
    // Aura Shards and similar - "Activated abilities...cost {N} more"
    if (oracleText.includes("activated abilities") && 
        oracleText.includes("cost") && 
        oracleText.includes("more")) {
      const costMatch = oracleText.match(/cost\s*\{(\d+)\}\s*more/);
      if (costMatch) {
        additionalCost += parseInt(costMatch[1], 10);
      }
    }
  }
  
  return additionalCost;
}

/**
 * Check if a player can activate loyalty abilities at instant speed
 * 
 * Effects that grant instant speed activation:
 * - Teferi's Talent emblem: "You may activate loyalty abilities of planeswalkers you control 
 *   on any player's turn any time you could cast an instant"
 * - Teferi, Temporal Archmage emblem (similar effect)
 * - The Peregrine Dynamo (can copy at instant speed, but not activate)
 */
export function canActivateLoyaltyAtInstantSpeed(gameState: any, playerId: string): boolean {
  // Check emblems
  const emblems = gameState?.emblems || [];
  for (const emblem of emblems) {
    if (!emblem || emblem.controller !== playerId) continue;
    
    const effect = (emblem.effect || "").toLowerCase();
    
    // Teferi's Talent emblem
    if (effect.includes("loyalty abilities") && 
        effect.includes("any player's turn") &&
        effect.includes("instant")) {
      return true;
    }
    
    // Teferi, Temporal Archmage emblem
    if (effect.includes("loyalty abilities") && 
        effect.includes("any time you could cast an instant")) {
      return true;
    }
  }
  
  // Check battlefield for permanents that grant this ability
  const battlefield = gameState?.battlefield || [];
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== playerId) continue;
    
    const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
    
    // Generic check for instant speed loyalty activation
    if (oracleText.includes("loyalty abilities") && 
        oracleText.includes("any time") &&
        oracleText.includes("instant")) {
      return true;
    }
  }
  
  return false;
}

/**
 * Handle Teferi's Talent draw trigger - add loyalty counter to enchanted planeswalker
 * Returns the planeswalker that should receive a loyalty counter, if any
 */
export function getTeferisTalentDrawTrigger(gameState: any, playerId: string): string | null {
  const battlefield = gameState?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== playerId) continue;
    
    const cardName = (permanent.card?.name || "").toLowerCase();
    
    if (cardName === "teferi's talent") {
      // Find the enchanted planeswalker
      const attachedTo = permanent.attachedTo;
      if (attachedTo) {
        return attachedTo;
      }
    }
  }
  
  return null;
}

/**
 * Calculate the loyalty change when activating an ability
 * Returns the amount to add (positive) or remove (negative) from loyalty
 */
export function calculateLoyaltyChange(ability: LoyaltyAbility, xValue?: number): number {
  if (ability.cost === 'X' || ability.isVariableCost) {
    // -X ability: remove X loyalty (xValue should be provided)
    return -(xValue || 0);
  }
  
  if (typeof ability.cost === 'number') {
    return ability.cost; // Already signed correctly (+N or -N)
  }
  
  return 0;
}

// NOTE: Aura Graveyard Triggers have been moved to ./triggers/aura-graveyard.ts
// Re-exports are at the top of this file

/**
 * Get all available loyalty abilities for a planeswalker with activation status
 * Useful for UI to display which abilities can be activated
 */
export function getAvailableLoyaltyAbilities(
  permanent: any,
  gameState: any,
  playerId: string
): Array<{
  index: number;
  ability: LoyaltyAbility;
  canActivate: boolean;
  reason?: string;
  maxX?: number;
}> {
  const abilities = parsePlaneswalkerAbilities(permanent?.card, permanent);
  if (!abilities) {
    return [];
  }
  
  return abilities.abilities.map((ability, index) => {
    const result = canActivateLoyaltyAbility(permanent, index, gameState, playerId);
    return {
      index,
      ability,
      canActivate: result.canActivate,
      reason: result.reason,
      maxX: result.maxX,
    };
  });
}

// NOTE: Linked Exile System has been moved to ./triggers/linked-exile.ts
// Re-exports are at the top of this file



