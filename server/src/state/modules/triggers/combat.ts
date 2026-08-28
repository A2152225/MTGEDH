/**
 * triggers/combat.ts
 * 
 * Combat-related trigger detection and processing.
 * Includes beginning of combat, attack, end of combat, and combat damage triggers.
 * 
 * Combat phases:
 * - Beginning of Combat: detectBeginningOfCombatTriggers, getBeginningOfCombatTriggers
 * - Declare Attackers: detectAttackTriggers, getAttackTriggersForCreatures
 * - Combat Damage: detectCombatDamageTriggers, getCombatDamageTriggersForCreature
 * - End of Combat: detectEndOfCombatTriggers, getEndOfCombatTriggers
 */

import type { GameContext } from "../../context.js";
import { timingTriggerEffect } from './timing-effect-extraction.js';
import {
  findRegexMatchAcrossOracleLines,
  getOracleLines,
} from '../../../../../rules-engine/src/oracleLineRegexMatch.js';
import {
  KNOWN_COMBAT_DAMAGE_TRIGGERS,
  KNOWN_ATTACK_TRIGGERS,
  KNOWN_BEGINNING_COMBAT_TRIGGERS,
} from "./card-data-tables.js";
import type { BeginningOfCombatTrigger } from "./types.js";
import { escapeCardNameForRegex } from "./types.js";
import { debug, debugWarn, debugError } from "../../../utils/debug.js";
import { permanentHasCreatureType } from "../../../../../shared/src/creatureTypes.js";
import {
  extractQuotedAbilityTexts,
  parseAttachmentGrantedAbilityTextsFromOracle,
} from "../../../../../shared/src/attachmentAbilityGrants.js";
import { isInterveningIfSatisfied } from "./intervening-if.js";
import {
  inferCombatWhoseTurn,
  shouldQueuePhaseTriggerForActivePlayer,
} from "./phaseWhoseTurn.js";
import { detectKeywords } from "../keyword-detection.js";
import { getActualPowerToughness, normalizeCardNameForOracleText } from "../../utils.js";
import { getContinuousGrantedAbilitiesForPermanent } from "../staticEffectSpec.js";
import { parseAnyTargetThatIsntCreatureType } from "./damage-redirect-target-type.js";
import { detectAttackTriggers } from "./attack-detection.js";
import { detectBlockTriggers } from "./block-detection.js";
import type { BlockTrigger } from "./block-trigger-type.js";
import { detectCombatDamageTriggers } from "./combat-damage-detection.js";
import type { CombatTriggeredAbility } from "./combat-triggered-ability.js";

export { detectAttackTriggers, detectBlockTriggers, detectCombatDamageTriggers };
export type { BlockTrigger };

export {
  playerHasDungeonRoomAbilityDoubler,
  detectTriggerDoublers,
  applyTriggerDoublers,
  pushTriggerDoublerCopies,
  type TriggerDoublerEventContext,
} from "./trigger-doublers.js";

export type { CombatTriggeredAbility } from "./combat-triggered-ability.js";

export { isEnchantedByAuraYouControl } from "./enchanted-by-aura.js";

export { isAttackWatcherTriggerType, planAttackWatcherQueue } from "./attack-watcher-queue.js";

export {
  mergeCombatTriggerValue,
  extractCommanderOwnedGrantedAbilityTexts,
} from "./combat-attack-trigger-helpers.js";

export type { AttachmentAttackTrigger } from "./attachment-attack-detection.js";

const ATTACK_KEYWORD_REMINDER_LINE_PATTERN = /^(?:annihilator\s+\d+|firebending\s+(?:\d+|x(?:,\s*where x is [^.]+)?)|melee|myriad|exalted|battle cry|dethrone|mentor|training)\b/i;
const BLOCK_KEYWORD_REMINDER_LINE_PATTERN = /^(?:afflict\s+\d+|bushido\s+\d+|flanking|rampage\s+\d+)\b/i;

/** Names used in oracle text (~, comma-short, or "Svyelun of Sea and Sky" -> "Svyelun"). */
function getCardNameVariantsForOracleMatching(cardName: string, oracleText?: string): string[] {
  const variants = new Set<string>();
  const full = String(cardName || '').trim();
  if (!full) return [];

  variants.add(full);

  const commaShort = normalizeCardNameForOracleText(full);
  if (commaShort) variants.add(commaShort);

  const ofPrefixMatch = full.match(/^([^\s,]+)\s+of\s+/i);
  if (ofPrefixMatch?.[1]) variants.add(ofPrefixMatch[1]);

  if (oracleText) {
    for (const line of getOracleLines(oracleText)) {
      const refMatch = line.match(/^Whenever\s+([A-Za-z][^\s,]+)(?:\s+enters(?:\s+the\s+battlefield)?\s+or)?\s+attacks\b/i);
      if (refMatch?.[1] && full.toLowerCase().startsWith(refMatch[1].toLowerCase())) {
        variants.add(refMatch[1]);
      }
    }
  }

  return Array.from(variants);
}

function normalizeOracleTextForInlineMatching(oracleText: string): string {
  return getOracleLines(oracleText).join(' ').replace(/\s+/g, ' ').trim();
}

function buildExertSelfReferencePattern(card: any): string {
  const variants = ['this creature', 'it'];
  const fullName = String(card?.name || '').trim();
  const oracleShortName = normalizeCardNameForOracleText(fullName);

  if (oracleShortName) {
    variants.push(escapeCardNameForRegex(oracleShortName));
  }
  if (fullName && fullName.toLowerCase() !== oracleShortName.toLowerCase()) {
    variants.push(escapeCardNameForRegex(fullName));
  }

  return `(?:${Array.from(new Set(variants)).join('|')})`;
}

function isSupportedExertAttackRewardDescription(description: string): boolean {
  const normalized = String(description || '').trim();
  if (!normalized) return false;
  if (/additional combat phase|extra combat phase/i.test(normalized)) return true;
  if (/untap all other creatures you control/i.test(normalized)) return true;
  if (/draw a card/i.test(normalized)) return true;
  if (/(?:other )?creatures you control get [+-]\d+\/[+-]\d+(?: and gains? .+?)? until end of turn/i.test(normalized)) return true;
  if (/put (?:a|an)(?: [\w,\s]+)? creature card from your hand onto the battlefield/i.test(normalized)) return true;
  if (/return target creature card(?: with mana value \d+ or less)? from your graveyard to the battlefield/i.test(normalized)) return true;
  if (/target creature gets \+X\/\+X(?: and gains .+?)? until end of turn, where X is the number of counters on permanents you control/i.test(normalized)) return true;
  if (/exile the top \w+ cards? of your library\. until the end of your next turn, you may play those cards/i.test(normalized)) return true;
  if (/deals? \d+ damage to target/i.test(normalized)) return true;
  if (/prevent all combat damage that would be dealt to (?:it|this creature|he|she) this turn/i.test(normalized)) return true;
  if (/(?:it|this creature|he|she) can't be blocked by creatures with power 2 or less this turn/i.test(normalized)) return true;
  if (/create a tapped and attacking token that's a copy of target creature you control\. sacrifice the token at the beginning of the next end step/i.test(normalized)) return true;
  if (/(?:it|this creature|he|she) can't be blocked this turn(?: and you scry \d+)?/i.test(normalized)) return true;
  if (/(?:it|this creature|he|she) gets [+-]\d+\/[+-]\d+(?: and gains? .+?)? until end of turn/i.test(normalized)) return true;
  if (/(?:it|this creature|he|she) gains .+? until end of turn/i.test(normalized)) return true;
  if (/target creature can't block this turn/i.test(normalized)) return true;
  return false;
}

export function canExertAsItAttacks(card: any): boolean {
  const normalizedOracle = normalizeOracleTextForInlineMatching(String(card?.oracle_text || ''));
  if (!normalizedOracle) return false;

  const selfReferencePattern = buildExertSelfReferencePattern(card);

  return new RegExp(`(?:if [^.]+,\\s*)?you may exert ${selfReferencePattern} as (?:it|he|she) attacks\\.`, 'i').test(normalizedOracle);
}

export function getSupportedExertAttackReward(card: any): string | null {
  const normalizedOracle = normalizeOracleTextForInlineMatching(String(card?.oracle_text || ''));
  if (!normalizedOracle) return null;

  const selfReferencePattern = buildExertSelfReferencePattern(card);

  const exertRewardMatch = normalizedOracle.match(
    new RegExp(`(?:if [^.]+,\\s*)?you may exert ${selfReferencePattern} as (?:it|he|she) attacks\\. when you do, (.+?)(?:\\s*\\(an exerted creature won't untap during your next untap step\\.?\\))?$`, 'i'),
  );
  const rewardDescription = String(exertRewardMatch?.[1] || '')
    .replace(/\s*\(an exerted creature won't untap during your next untap step\.?\)\s*/ig, ' ')
    .replace(/\s*\{[WUBRGC\dP/\d]+\}(?:\{[WUBRGC\dP/\d]+\})*:\s*[\s\S]*$/i, '')
    .trim();
  if (!isSupportedExertAttackRewardDescription(rewardDescription)) {
    return null;
  }

  return rewardDescription;
}

function findGenericAttackTriggerLine(oracleText: string, cardName: string): RegExpMatchArray | null {
  const cardNameVariants = getCardNameVariantsForOracleMatching(cardName, oracleText)
    .map((value) => escapeCardNameForRegex(value));
  const attacksPattern = new RegExp(
    `whenever\\s+(?:~|this (?:creature(?:\\s+or\\s+equipped creature)?|vehicle|artifact|permanent)|${cardNameVariants.join('|')})\\s+(?:enters(?: the battlefield)?\\s+or\\s+)?attacks,?\\s*(.+)$`,
    'i'
  );

  return findRegexMatchAcrossOracleLines(
    oracleText,
    (line) => ATTACK_KEYWORD_REMINDER_LINE_PATTERN.test(line),
    (line) => line.match(attacksPattern),
  );
}

function findGenericAttacksOrBlocksLine(oracleText: string, cardName: string): RegExpMatchArray | null {
  const cardNameVariants = getCardNameVariantsForOracleMatching(cardName, oracleText)
    .map((value) => escapeCardNameForRegex(value));
  const attacksOrBlocksPattern = new RegExp(
    `whenever\\s+(?:~|this (?:creature|vehicle|artifact|permanent)|${cardNameVariants.join('|')})\\s+attacks or blocks,?\\s*(.+)$`,
    'i',
  );

  return findRegexMatchAcrossOracleLines(
    oracleText,
    (line) => ATTACK_KEYWORD_REMINDER_LINE_PATTERN.test(line),
    (line) => line.match(attacksOrBlocksPattern),
  );
}

function findGenericBlockTriggerLine(oracleText: string, cardName: string): RegExpMatchArray | null {
  const cardNameVariants = getCardNameVariantsForOracleMatching(cardName, oracleText)
    .map((value) => escapeCardNameForRegex(value));
  const blocksPattern = new RegExp(
    `whenever\\s+(?:~|this creature|${cardNameVariants.join('|')})\\s+blocks(?:\\s+a\\s+creature)?,?\\s*(.+)$`,
    'i'
  );

  return findRegexMatchAcrossOracleLines(
    oracleText,
    (line) => BLOCK_KEYWORD_REMINDER_LINE_PATTERN.test(line),
    (line) => line.match(blocksPattern),
  );
}

function countEnergySymbols(cost: string): number {
  return (String(cost || '').match(/\{e\}/gi) || []).length;
}

// Re-export types from types.ts for consumers
export type { BeginningOfCombatTrigger };
export type { EndOfCombatTrigger } from './end-combat.js';

// ============================================================================
// Combat Damage Triggers
// ============================================================================

// detectCombatDamageTriggers lives in combat-damage-detection.ts (leftover-merged).
/**
 * Get combat damage triggers for creatures that dealt damage
 */
export function getCombatDamageTriggersForCreature(
  ctx: GameContext,
  attackingPermanent: any,
  damageDealt: number,
  damagedPlayerId: string
): CombatTriggeredAbility[] {
  if (damageDealt <= 0) return [];
  
  return detectCombatDamageTriggers(attackingPermanent.card, attackingPermanent);
}

export { getAttackTriggersForCreatures } from "./attack-triggers-for-creatures.js";

export {
  detectAttachmentAttackTriggers,
  getAttachmentAttackTriggers,
  getAttachmentCombatDamageTriggers,
} from "./attachment-attack-detection.js";

// ============================================================================
// Beginning of Combat Triggers
// ============================================================================

/**
 * Detect beginning of combat triggers.
 * 
 * DYNAMIC-FIRST PATTERN: Uses regex-based oracle text parsing as the primary
 * detection mechanism. The KNOWN_BEGINNING_COMBAT_TRIGGERS table serves as an
 * optimization fallback for special handling.
 * 
 * Patterns detected:
 * - "At the beginning of combat on your turn, [effect]"
 * - "At the beginning of each combat, [effect]"
 */
export function detectBeginningOfCombatTriggers(card: any, permanent: any): BeginningOfCombatTrigger[] {
  const triggers: BeginningOfCombatTrigger[] = [];
  const oracleText = (card?.oracle_text || "");
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // ===== DYNAMIC DETECTION (Primary) =====
  
  // "At the beginning of combat on your turn" pattern
  const beginCombatMatch = oracleText.match(/at the beginning of combat on your turn,?\s*([^.]+)/i);
  if (beginCombatMatch) {
    const effectText = timingTriggerEffect(oracleText, beginCombatMatch);
    const requiresChoice = /\bchoose\b/i.test(effectText) || /\byou may\b/i.test(effectText);
    const createsToken = /\bcreate\b.*\btoken\b/i.test(effectText);
    
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: true,
      requiresChoice,
      createsToken,
      triggerType: 'your_combat_step',
    });
  }
  
  const nextCombatPhaseMatch = oracleText.match(
    /at the beginning of the next combat(?: phase)?(?: this turn)?,?\s*([^.]+)/i,
  );
  if (nextCombatPhaseMatch && !triggers.some((t) => (t as any).triggerType === 'next_combat_phase')) {
    const effectText = timingTriggerEffect(oracleText, nextCombatPhaseMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'next_combat_phase' as any,
    } as BeginningOfCombatTrigger);
  }

  // "At the beginning of each combat" - triggers on all players' combats
  const eachCombatMatch = oracleText.match(/at the beginning of each combat,?\s*([^.]+)/i);
  if (eachCombatMatch && triggers.length === 0) {
    const effectText = timingTriggerEffect(oracleText, eachCombatMatch);
    const requiresChoice = /\bchoose\b/i.test(effectText) || /\byou may\b/i.test(effectText);
    const createsToken = /\bcreate\b.*\btoken\b/i.test(effectText);

    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: true,
      requiresChoice,
      createsToken,
      triggerType: 'each_player_turn_combat',
    });
  }

  const thatCombatMatch = oracleText.match(/at the beginning of that combat,?\s*([^.]+)/i);
  if (thatCombatMatch && !triggers.some((t) => (t as any).triggerType === 'that_combat')) {
    const effectText = timingTriggerEffect(oracleText, thatCombatMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'that_combat' as any,
    } as BeginningOfCombatTrigger);
  }

  const opponentCombatMatch = oracleText.match(
    /at the beginning of combat on each opponent's turn,?\s*([^.]+)/i,
  );
  if (opponentCombatMatch && !triggers.some((t) => (t as any).triggerType === 'opponent_turn_combat')) {
    const effectText = timingTriggerEffect(oracleText, opponentCombatMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'opponent_turn_combat' as any,
    } as BeginningOfCombatTrigger);
  }

  const enchantedOpponentCombatMatch = oracleText.match(
    /at the beginning of combat on enchanted opponent's turn,?\s*([^.]+)/i,
  );
  if (
    enchantedOpponentCombatMatch &&
    !triggers.some((t) => (t as any).triggerType === 'enchanted_opponent_turn_combat')
  ) {
    const effectText = timingTriggerEffect(oracleText, enchantedOpponentCombatMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'enchanted_opponent_turn_combat' as any,
    } as BeginningOfCombatTrigger);
  }

  const eachPlayerCombatMatch = oracleText.match(
    /at the beginning of combat on each player's turn,?\s*([^.]+)/i,
  );
  if (eachPlayerCombatMatch && !triggers.some((t) => (t as any).triggerType === 'each_player_turn_combat')) {
    const effectText = timingTriggerEffect(oracleText, eachPlayerCombatMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'each_player_turn_combat' as any,
    } as BeginningOfCombatTrigger);
  }

  const combatThisTurnMatch = oracleText.match(/at the beginning of combat this turn,?\s*([^.]+)/i);
  if (combatThisTurnMatch && !triggers.some((t) => (t as any).triggerType === 'combat_this_turn')) {
    const effectText = timingTriggerEffect(oracleText, combatThisTurnMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'combat_this_turn' as any,
    } as BeginningOfCombatTrigger);
  }

  const combatStepMatch = oracleText.match(/at the beginning of your combat step,?\s*([^.]+)/i);
  if (combatStepMatch && !triggers.some((t) => (t as any).triggerType === 'your_combat_step')) {
    const effectText = timingTriggerEffect(oracleText, combatStepMatch);
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: effectText,
      effect: effectText,
      mandatory: !effectText.toLowerCase().includes('you may'),
      triggerType: 'your_combat_step' as any,
    } as BeginningOfCombatTrigger);
  }

  // KNOWN table fallback only when oracle regex did not match (legacy shorthand / odd wording)
  if (triggers.length === 0) {
    for (const [knownName, info] of Object.entries(KNOWN_BEGINNING_COMBAT_TRIGGERS)) {
      if (lowerName.includes(knownName)) {
        triggers.push({
          permanentId,
          cardName,
          controllerId,
          description: info.effect,
          effect: info.effect,
          mandatory: true,
          requiresChoice: info.requiresChoice,
          createsToken: info.createsToken,
        });
      }
    }
  }

  return triggers;
}

/**
 * Get all beginning of combat triggers for the active player's combat step
 */
export function getBeginningOfCombatTriggers(
  ctx: GameContext,
  activePlayerId: string
): BeginningOfCombatTrigger[] {
  const triggers: BeginningOfCombatTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  const MAX_TRIGGERS_PER_STEP = 100;
  let triggerCount = 0;
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    if (triggerCount >= MAX_TRIGGERS_PER_STEP) {
      debugError(1, `[getBeginningOfCombatTriggers] SAFETY LIMIT: Stopped after ${MAX_TRIGGERS_PER_STEP} triggers`);
      break;
    }
    
    const permTriggers = detectBeginningOfCombatTriggers(permanent.card, permanent);
    const oracleText = String(permanent.card.oracle_text || '');
    
    for (const trigger of permTriggers) {
      if (!shouldQueuePhaseTriggerForActivePlayer({
        whose: inferCombatWhoseTurn(trigger, oracleText),
        activePlayerId,
        controllerId: String(trigger.controllerId || permanent.controller || ''),
        sourcePermanent: permanent,
        state: ctx.state,
      })) {
        continue;
      }

      const raw = String(trigger.effect || trigger.description || '').trim();
      let interveningText = raw;
      if (interveningText && !/^(?:when|whenever|at)\b/i.test(interveningText)) {
        interveningText = `At the beginning of combat, ${interveningText}`;
      }
      const needsThatPlayerRef = /\bthat player\b/i.test(interveningText) || /\btheir\b/i.test(interveningText);
      const ok = isInterveningIfSatisfied(
        ctx,
        trigger.controllerId || permanent.controller,
        interveningText,
        permanent,
        needsThatPlayerRef
          ? {
              thatPlayerId: activePlayerId,
              referencedPlayerId: activePlayerId,
              theirPlayerId: activePlayerId,
            }
          : undefined
      );
      if (ok !== false) {
        triggers.push(trigger);
        triggerCount++;
      }
    }
  }
  
  return triggers;
}

// ============================================================================
// End of Combat Triggers (canonical implementation in end-combat.ts)
// ============================================================================

export {
  detectEndOfCombatTriggers,
  getEndOfCombatTriggers,
} from './end-combat.js';

// ============================================================================
// Damage Received Triggers
// ============================================================================

/**
 * Information about a damage received trigger that needs to be queued for resolution
 */
export interface DamageReceivedTriggerInfo {
  triggerId: string;
  sourceId: string;
  sourceName: string;
  controller: string;
  damageAmount: number;
  targetType: 'opponent' | 'any' | `any_non_${string}` | 'chosen_player' | 'each_opponent' | 'controller' | 'opponent_or_planeswalker';
  targetRestriction?: string;
}

/**
 * Check if a permanent has a "whenever this creature is dealt damage" trigger
 * and return the trigger information if it does.
 * 
 * This supports cards like:
 * - Brash Taunter: "Whenever Brash Taunter is dealt damage, it deals that much damage to target opponent."
 * - Boros Reckoner: "Whenever Boros Reckoner is dealt damage, it deals that much damage to any target."
 * - Stuffy Doll: "Whenever Stuffy Doll is dealt damage, it deals that much damage to the chosen player."
 */
export function checkDamageReceivedTrigger(
  permanent: any,
  damageAmount: number
): DamageReceivedTriggerInfo | null {
  if (!permanent || damageAmount <= 0) return null;
  
  const card = permanent.card;
  if (!card) return null;
  
  const oracleText = (card.oracle_text || "").toLowerCase();
  const creatureName = card.name || "Unknown";
  const lowerName = creatureName.toLowerCase();
  
  // Check if this card has a damage received trigger
  // Pattern 1: "Whenever this creature is dealt damage"
  // Pattern 2: "Whenever [CardName] is dealt damage"
  const hasTrigger = 
    oracleText.includes("whenever this creature is dealt damage") ||
    oracleText.includes("whenever this creature is dealt combat damage") ||
    oracleText.includes(`whenever ${lowerName} is dealt damage`) ||
    oracleText.includes(`whenever ${lowerName} is dealt combat damage`);
  
  if (!hasTrigger) return null;
  
  // Determine target type from oracle text
  let targetType: 'opponent' | 'any' | `any_non_${string}` | 'chosen_player' | 'each_opponent' | 'controller' | 'opponent_or_planeswalker' = 'any';
  let targetRestriction = '';
  
  const anyNonType = parseAnyTargetThatIsntCreatureType(oracleText);
  if (oracleText.includes("target opponent or planeswalker")) {
    targetType = 'opponent_or_planeswalker';
    targetRestriction = 'opponent or planeswalker';
  } else if (oracleText.includes("target opponent")) {
    targetType = 'opponent';
    targetRestriction = 'opponent';
  } else if (anyNonType) {
    targetType = anyNonType.targetType;
    targetRestriction = anyNonType.targetRestriction;
  } else if (oracleText.includes("the chosen player")) {
    targetType = 'chosen_player';
    targetRestriction = 'chosen player';
  } else if (oracleText.includes("each opponent")) {
    targetType = 'each_opponent';
    targetRestriction = 'each opponent';
  } else if (oracleText.includes("any target")) {
    targetType = 'any';
  }
  
  const triggerId = `damage_trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  return {
    triggerId,
    sourceId: permanent.id,
    sourceName: creatureName,
    controller: permanent.controller,
    damageAmount,
    targetType,
    targetRestriction,
  };
}

// ============================================================================
// Block Triggers
// ============================================================================

// detectBlockTriggers + BlockTrigger live in block-detection.ts / block-trigger-type.ts (leftover-merged).

/**
 * Get block triggers for creatures that are blocking
 * @param ctx - Game context
 * @param blockingCreatures - Array of creatures that are blocking
 * @param blockingPlayer - Player who is declaring blockers
 * @returns Array of triggered abilities
 */
export function getBlockTriggersForCreatures(
  ctx: GameContext,
  blockingCreatures: any[],
  blockingPlayer: string
): CombatTriggeredAbility[] {
  const triggers: CombatTriggeredAbility[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  // Check each blocking creature for block triggers
  for (const blocker of blockingCreatures) {
    const blockerTriggers = detectBlockTriggers(blocker.card, blocker);
    const keywordText = String(blocker?.card?.oracle_text || '') ||
      (Array.isArray(blocker?.card?.keywords) ? (blocker?.card?.keywords || []).join('\n') : '');
    const blockKeywordTriggers = detectKeywords(keywordText, blocker?.card?.name || 'Unknown').keywords
      .filter((keyword) => keyword.timing === 'blocks' && keyword.keyword === 'bushido');
    
    for (const trigger of blockerTriggers) {
      triggers.push({
        permanentId: trigger.permanentId,
        cardName: trigger.cardName,
        controllerId: trigger.controllerId,
        triggerType: 'blocks',
        description: trigger.description,
        effect: trigger.effect,
        mandatory: trigger.mandatory,
        value: {
          blockedCreatureId: blocker.blocking?.[0], // The attacker being blocked
          createTokens: trigger.createTokens,
        },
      });
    }

    for (const keyword of blockKeywordTriggers) {
      triggers.push({
        permanentId: blocker.id,
        cardName: blocker.card?.name || 'Unknown',
        controllerId: blocker.controller,
        triggerType: keyword.keyword,
        description: keyword.effect,
        effect: keyword.effect,
        mandatory: keyword.mandatory,
        value: {
          blockedCreatureId: blocker.blocking?.[0],
        },
      });
    }
  }
  
  return triggers;
}

function permanentHasKeyword(permanent: any, keywordName: string): boolean {
  const normalizedKeyword = String(keywordName || '').trim().toLowerCase();
  if (!normalizedKeyword) return false;

  const cardKeywords = Array.isArray(permanent?.card?.keywords)
    ? permanent.card.keywords
    : [];
  if (cardKeywords.some((entry: any) => String(entry || '').trim().toLowerCase() === normalizedKeyword)) {
    return true;
  }

  const oracleText = String(permanent?.card?.oracle_text || '').toLowerCase();
  return oracleText.includes(normalizedKeyword);
}

/**
 * Get block triggers for attacking creatures that became blocked.
 * Covers keyword abilities like afflict, flanking, bushido, and rampage that trigger on the attacker.
 */
export function getBlockedTriggersForCreatures(
  ctx: GameContext,
  blockedCreatures: any[],
  defendingPlayer: string
): CombatTriggeredAbility[] {
  const triggers: CombatTriggeredAbility[] = [];
  const battlefield = ctx.state?.battlefield || [];

  for (const attacker of blockedCreatures) {
    if (!attacker) continue;

    const grantedKeywordText = [
      ...(Array.isArray(attacker?.grantedAbilities) ? attacker.grantedAbilities : []),
      ...getContinuousGrantedAbilitiesForPermanent(attacker, ctx.state),
    ].join('\n');
    const keywordText = [
      String(attacker?.card?.oracle_text || ''),
      Array.isArray(attacker?.card?.keywords) ? (attacker?.card?.keywords || []).join('\n') : '',
      grantedKeywordText,
    ].filter(Boolean).join('\n');
    const blockKeywords = detectKeywords(keywordText, attacker?.card?.name || 'Unknown').keywords
      .filter((keyword) => keyword.timing === 'blocks');
    if (blockKeywords.length === 0) continue;

    const blockedByIds = Array.isArray(attacker?.blockedBy)
      ? attacker.blockedBy.map((value: any) => String(value || '').trim()).filter(Boolean)
      : (attacker?.blockedBy ? [String(attacker.blockedBy).trim()] : []);
    const blockingCreatures = blockedByIds
      .map((blockingCreatureId) => battlefield.find((perm: any) => perm && String(perm.id || '') === blockingCreatureId))
      .filter(Boolean);

    for (const keyword of blockKeywords) {
      if (keyword.keyword === 'afflict') {
        triggers.push({
          permanentId: attacker.id,
          cardName: attacker.card?.name || 'Unknown',
          controllerId: attacker.controller,
          triggerType: 'afflict',
          description: keyword.effect,
          effect: keyword.effect,
          mandatory: keyword.mandatory,
          value: {
            blockingCreatureIds: blockedByIds,
            defendingPlayer,
          },
        });
      } else if (keyword.keyword === 'flanking') {
        for (const blockingCreature of blockingCreatures) {
          if (permanentHasKeyword(blockingCreature, 'flanking')) continue;
          triggers.push({
            permanentId: attacker.id,
            cardName: attacker.card?.name || 'Unknown',
            controllerId: attacker.controller,
            triggerType: 'flanking',
            description: keyword.effect,
            effect: keyword.effect,
            mandatory: keyword.mandatory,
            value: {
              blockingCreatureIds: [String(blockingCreature.id || '')],
              defendingPlayer,
            },
          });
        }
      } else if (keyword.keyword === 'bushido') {
        triggers.push({
          permanentId: attacker.id,
          cardName: attacker.card?.name || 'Unknown',
          controllerId: attacker.controller,
          triggerType: 'bushido',
          description: keyword.effect,
          effect: keyword.effect,
          mandatory: keyword.mandatory,
          value: {
            blockingCreatureIds: blockedByIds,
            defendingPlayer,
          },
        });
      } else if (keyword.keyword === 'rampage') {
        triggers.push({
          permanentId: attacker.id,
          cardName: attacker.card?.name || 'Unknown',
          controllerId: attacker.controller,
          triggerType: 'rampage',
          description: keyword.effect,
          effect: keyword.effect,
          mandatory: keyword.mandatory,
          value: {
            blockingCreatureIds: blockedByIds,
            defendingPlayer,
          },
        });
      }
    }
  }

  return triggers;
}


