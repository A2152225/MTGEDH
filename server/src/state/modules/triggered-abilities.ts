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
import { getActivePermanentCardFace } from "./cardFaceOracle.js";
import { getEffectiveColors } from "./effectiveColors.js";

// Import card data tables from modularized submodule
import { debug, debugWarn, debugError } from "../../utils/debug.js";
import {
  KNOWN_UNTAP_TRIGGERS,
  KNOWN_CAST_TYPE_TRIGGERS,
  KNOWN_TAP_UNTAP_ABILITIES,
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
import { parseMillFromOracleText } from "../../../../rules-engine/src/keywordActions/mill.js";
import { timingTriggerEffect, findFirstRegexMatchAcrossOracleLines } from './triggers/timing-effect-extraction.js';
import { isEnchantedByAuraYouControl } from './triggers/combat.js';
import {
  buildRoomUnlockDoorRegisteredTrigger,
  detectRoomUnlockDoorTriggers,
} from './triggers/room.js';
import { getActualPowerToughness, normalizeCardNameForOracleText } from '../utils.js';
import {
  oracleTextHasDoThisOnlyOnceEachTurn,
  oracleTextHasTriggersOnlyOnceEachTurn,
} from './triggerDoThisOnlyOnceEachTurn.js';
import { isModalChooseModesEffectText } from './inferTriggeredAbilityTargetMetadata.js';
import { aOrAnSpellType } from '../../../../rules-engine/src/indefiniteArticle.js';
import { stripReminderParentheticals } from "../../../../rules-engine/src/oracleReminderText.js";
import type { TriggeredAbility } from "./triggers/detectorTriggeredAbility.js";
import { buildCardNameRegexAlternatives } from "./triggers/cardNameRegexAlternatives.js";
import { ENTERS_OR_OTHER_EVENT_PREFIX } from "./triggers/enters-or-other-event-prefix.js";
import { detectTargetType } from "./triggers/detect-target-type.js";
import { detectETBTriggers } from "./triggers/etb-detection.js";
import { detectCombatDamageTriggers } from "./triggers/combat-damage-detection.js";


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

// extendSpellCopyEffectText, extractSpellCastEffect, normalizeSpellCastEffectText live in spell-cast-effect-text.ts

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

export type { TriggeredAbility } from "./triggers/detectorTriggeredAbility.js";

export type { BlockTrigger } from "./triggers/block-trigger-type.js";

// Note: KNOWN_DEATH_TRIGGERS, KNOWN_ATTACK_TRIGGERS, KNOWN_UNTAP_TRIGGERS, 
// KNOWN_CAST_TYPE_TRIGGERS, KNOWN_TAP_UNTAP_ABILITIES, KNOWN_ETB_TRIGGERS,
// KNOWN_COMBAT_DAMAGE_TRIGGERS are now imported from ./triggers/card-data-tables.js


export { detectCombatDamageTriggers } from "./triggers/combat-damage-detection.js";


export { detectDealtDamageTriggers } from "./triggers/dealt-damage-detection.js";
export { getCombatDamageTriggersForCreature } from "./triggers/combat.js";

export { detectDeathTriggers } from "./triggers/zone-changes.js";


export { detectLTBTriggers } from "./triggers/zone-changes.js";


export { detectAbilityActivatedTriggers } from "./triggers/ability-activated-detection.js";

export { detectMonstrousTriggers, detectRoomTriggers, detectTransformTriggers } from "./triggers/status-keyword-detection.js";

export { detectAttackTriggers } from "./triggers/zone-changes.js";


export { detectBlockTriggers } from "./triggers/block-detection.js";

export {
  detectSpellCounteredTriggers,
  detectMutateTriggers,
  detectEquippedTriggers,
} from "./triggers/status-event-detection.js";

export { detectReturnedToHandTriggers } from "./triggers/returned-to-hand-detection.js";
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

export { detectETBTriggers, getETBTriggersForPermanent } from "./triggers/zone-changes.js";


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

export { detectUntapTriggers, type UntapTrigger } from "./triggers/untap-detection.js";

export {
  type AttachmentAttackTrigger,
  detectAttachmentAttackTriggers,
  getAttachmentAttackTriggers,
  getAttachmentCombatDamageTriggers,
  getAttackUntapTriggers,
  getCombatDamageUntapTriggers,
  executeUntapTrigger,
} from "./triggers/attachment-attack-detection.js";

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

export { getDeathTriggers, getDeathTriggersForCreature, processUndyingPersist, getPlayersWhoMustSacrifice, type DeathTriggerResult } from "./triggers/zone-changes.js";

export { getAttackTriggersForCreatures } from "./triggers/attack-triggers-for-creatures.js";





// NOTE: End Step Trigger System has been moved to ./triggers/turn-phases.ts
// Re-exports are at the top of this file

// NOTE: Draw Step Trigger System has been moved to ./triggers/turn-phases.ts
// Re-exports are at the top of this file

// NOTE: Untap Step Effects System has been moved to ./triggers/turn-phases.ts
// Re-exports are at the top of this file

export { detectETBUntapEffects, getETBUntapEffects, applyETBUntapEffect, type ETBUntapEffect } from "./triggers/zone-changes.js";


// ============================================================================
// Spell-Cast Untap Triggers (Jeskai Ascendancy, Paradox Engine)
// ============================================================================

export {
  type SpellCastUntapEffect,
  detectSpellCastUntapEffects,
  getSpellCastUntapEffects,
  applySpellCastUntapEffect,
} from "./triggers/spell-cast-untap-detection.js";

export type { SpellCastTrigger } from "./triggers/spell-cast-trigger-type.js";

export { detectSpellCastTriggers } from "./triggers/spell-cast-detection.js";

export { getSpellCastTriggers } from "./triggers/spell-cast-get-triggers.js";

export { detectTapTriggers, type TapTrigger } from "./triggers/tap-detection.js";

export { getTapTriggers } from './triggers/tap-untap.js';

// ============================================================================
// NOTE: "Doesn't Untap" Static Effects have been moved to ./triggers/turn-phases.ts
// Re-exports are at the top of this file

// ============================================================================
// Card Draw Trigger System - MOVED to ./triggers/card-draw.ts
// ============================================================================

export {
  type MimicVatTrigger,
  detectMimicVatTriggers,
  getMimicVatTriggers,
  type ModalSpellMode,
  type ModalSpellInfo,
  parseModalSpellOptions,
  hasSplitSecond,
  playerHasHexproof,
  getGraveyardKeywordGranters,
  type StormTrigger,
  detectStormAbility,
  getStormCount,
} from "./triggers/mimic-vat-modal-and-storm.js";

export type { HideawayAbility } from "./triggers/hideaway-ability.js";
export { detectHideawayAbility } from "./triggers/hideaway-ability.js";
export { checkETBAutoSacrifice } from "./triggers/zone-changes.js";


export {
  type DamageRedirection,
  detectDamageRedirection,
  type EmpiresBonus,
  checkEmpiresSet,
  getEmpiresEffect,
  type ManaAbilityGranter,
  detectManaAbilityGranter,
  type MassBoostEffect,
  detectMassBoostEffect,
  calculateMassBoost,
  type MustBlockEffect,
  detectMustBlockEffect,
  type TargetingProtection,
  detectTargetingProtection,
  type DynamicPowerToughness,
  detectDynamicPT,
  calculateDynamicPT,
  type MassMillEffect,
  detectMassMillEffect,
  type QuestCounter,
  detectQuestCounter,
} from "./triggers/static-special-effect-detectors.js";

export {
  type UtilityLandAbility,
  detectUtilityLandAbility,
  type EquipmentEffect,
  detectEquipmentEffect,
  type TotemArmorEffect,
  detectUmbraEffect,
  checkGraveyardTrigger,
  type ControlChangeEffect,
  detectControlChangeEffect,
  type InfectGrantEffect,
  detectInfectGrantEffect,
  type GroupDrawEffect,
  detectGroupDrawEffect,
  type MultiTargetLandSearch,
  detectMultiTargetLandSearch,
  validateSharedLandType,
  type ConditionalETBTapped,
  detectConditionalETBTapped,
  checkConditionalETBMet,
  type LibraryRevealPlayEffect,
  detectLibraryRevealPlayEffect,
  type TopCardViewEffect,
  detectTopCardViewEffect,
  type PowerBasedLandSearch,
  detectPowerBasedLandSearch,
  calculateLandSearchCount,
  type ChargeCounterAbility,
  detectChargeCounterAbility,
  type SpecialCardEffect,
  detectSpecialCardEffect,
} from "./triggers/special-card-effect-tables.js";

export {
  type LoyaltyAbility,
  type PlaneswalkerAbilities,
  parsePlaneswalkerAbilities,
  getLoyaltyActivationLimit,
  checkChainVeilEndStepTrigger,
  canActivateLoyaltyAbility,
  getLoyaltyAdditionalCost,
  canActivateLoyaltyAtInstantSpeed,
  getTeferisTalentDrawTrigger,
  calculateLoyaltyChange,
  getAvailableLoyaltyAbilities,
} from "./triggers/planeswalker-loyalty.js";

// NOTE: Linked Exile System has been moved to ./triggers/linked-exile.ts
// Re-exports are at the top of this file



