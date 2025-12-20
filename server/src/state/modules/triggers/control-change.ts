/**
 * control-change.ts
 * 
 * Handles control change effects in Magic: The Gathering.
 * 
 * Supports patterns like:
 * - "enters under the control of an opponent of your choice" (Xantcha, Sleeper Agent)
 * - "you may have an opponent gain control of it" (Vislor Turlough)
 * - "an opponent gains control of it" (Akroan Horse)
 * - "put onto the battlefield under your control" (Acquire, Desertion)
 * - "return to the battlefield under your control" (Grave Betrayal, Animate Dead)
 * - "whenever an opponent sacrifices" control effects (It That Betrays)
 * - "whenever a creature you don't control dies" (Grave Betrayal)
 * 
 * Design Philosophy:
 * - Use regex patterns for scalable detection across 100+ cards
 * - Support both ETB and death/sacrifice triggers
 * - Handle goading when control changes (Vislor Turlough)
 * - Support AI decision making for control changes
 */

import type { BattlefieldPermanent, PlayerID } from '../../../../../shared/src/types';
import { debug, debugWarn, debugError } from "../../../utils/debug.js";

// ============================================================================
// Control Change Effect Types
// ============================================================================

export type ControlChangeType = 
  | 'enters_under_opponent_control'    // Xantcha, Akroan Horse
  | 'may_give_control_to_opponent'     // Vislor Turlough
  | 'opponent_gains_control'           // Humble Defector
  | 'put_under_your_control'           // Acquire, Desertion
  | 'return_under_your_control'        // Grave Betrayal, Animate Dead
  | 'opponent_sacrifice_steal'         // It That Betrays
  | 'opponent_creature_dies_steal';    // Grave Betrayal

export interface ControlChangeEffect {
  permanentId: string;
  cardName: string;
  type: ControlChangeType;
  description: string;
  isOptional: boolean;
  isETB: boolean;              // True if triggers on ETB
  isDeathTrigger: boolean;     // True if triggers on death
  isSacrificeTrigger: boolean; // True if triggers on sacrifice
  goadsOnChange?: boolean;     // Vislor Turlough goads when control changes
  additionalEffects?: string;  // For things like "draw a card", "+1/+1 counter", etc.
  targetRestriction?: string;  // "nontoken", "creature", etc.
  delayedTrigger?: boolean;    // Grave Betrayal delays until end step
  permanentType?: string;      // "creature", "artifact", etc.
}

// ============================================================================
// Regex Patterns for Control Change Detection
// ============================================================================

/**
 * Pattern: "enters under the control of an opponent of your choice"
 * Examples: Xantcha, Sleeper Agent
 */
const ENTERS_OPPONENT_CHOICE_PATTERN = /(?:~|this creature|this permanent) enters (?:the battlefield )?under the control of an opponent of your choice/i;

/**
 * Pattern: "enters under the control of an opponent" (no choice - random/specific)
 * Examples: Some cards where opponent is determined
 */
const ENTERS_OPPONENT_PATTERN = /(?:~|this creature|this permanent) enters (?:the battlefield )?under (?:the control of )?an opponent/i;

/**
 * Pattern: "you may have an opponent gain control of it"
 * Examples: Vislor Turlough
 */
const MAY_GIVE_CONTROL_PATTERN = /you may have an opponent gain control of (?:it|~|this creature|this permanent)/i;

/**
 * Pattern: "an opponent gains control of it" (mandatory)
 * Examples: Akroan Horse
 */
const OPPONENT_GAINS_CONTROL_PATTERN = /an opponent gains control of (?:it|~|this creature|this permanent)/i;

/**
 * Pattern: "target opponent gains control of ~"
 * Examples: Humble Defector
 */
const TARGET_OPPONENT_GAINS_CONTROL_PATTERN = /target opponent gains control of (?:~|this creature|this permanent)/i;

/**
 * Pattern: "put onto the battlefield under your control"
 * Examples: Acquire, Desertion, Animate Dead
 */
const PUT_UNDER_YOUR_CONTROL_PATTERN = /put (?:that card|it|the card|target [\w\s]+ card) (?:from [\w\s']+ )?onto the battlefield under your control/i;

/**
 * Pattern: "return to the battlefield under your control"
 * Examples: Grave Betrayal, Unholy Indenture
 */
const RETURN_UNDER_YOUR_CONTROL_PATTERN = /return (?:that card|it|the card|enchanted creature|target [\w\s]+ card) (?:from [\w\s']+ )?(?:to|onto) the battlefield under your control/i;

/**
 * Pattern: "whenever an opponent sacrifices" + control change
 * Examples: It That Betrays
 */
const OPPONENT_SACRIFICE_STEAL_PATTERN = /whenever an opponent sacrifices (?:a |an )?([\w\s]+)(?:permanent|creature|artifact|enchantment)?,?\s*(?:put that card onto the battlefield under your control|you may put that card onto the battlefield under your control)/i;

/**
 * Pattern: "whenever a creature you don't control dies" + return under your control
 * Examples: Grave Betrayal
 */
const OPPONENT_CREATURE_DIES_STEAL_PATTERN = /whenever (?:a|an) (?:nontoken )?creature (?:you don't control|an opponent controls) dies,?\s*([^.]+)?return (?:it|that creature|that card) (?:to|onto) the battlefield under your control/i;

/**
 * Pattern: "it's goaded for as long as they control it"
 * Examples: Vislor Turlough
 */
const GOADED_ON_CONTROL_CHANGE_PATTERN = /it's goaded (?:for )?as long as (?:they|that player|the opponent) controls? it/i;

/**
 * Pattern: "attacks each combat if able" - forced attack restriction
 * Examples: Xantcha
 */
const ATTACKS_EACH_COMBAT_PATTERN = /(?:~|this creature|it) attacks each combat if able/i;

/**
 * Pattern: "can't attack its owner or planeswalkers its owner controls"
 * Examples: Xantcha
 */
const CANT_ATTACK_OWNER_PATTERN = /can't attack its owner|can't attack you/i;

// ============================================================================
// Detection Functions
// ============================================================================

/**
 * Detect all control change effects from a card's oracle text
 */
export function detectControlChangeEffects(card: any, permanent?: any): ControlChangeEffect[] {
  const effects: ControlChangeEffect[] = [];
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  
  // Check for "enters under opponent's control of your choice"
  if (ENTERS_OPPONENT_CHOICE_PATTERN.test(oracleText)) {
    const goadsOnChange = GOADED_ON_CONTROL_CHANGE_PATTERN.test(oracleText);
    effects.push({
      permanentId,
      cardName,
      type: 'enters_under_opponent_control',
      description: `${cardName} enters under an opponent's control of your choice`,
      isOptional: false,
      isETB: true,
      isDeathTrigger: false,
      isSacrificeTrigger: false,
      goadsOnChange,
    });
  }
  
  // Check for "may have an opponent gain control"
  if (MAY_GIVE_CONTROL_PATTERN.test(oracleText)) {
    const goadsOnChange = GOADED_ON_CONTROL_CHANGE_PATTERN.test(oracleText);
    effects.push({
      permanentId,
      cardName,
      type: 'may_give_control_to_opponent',
      description: `You may have an opponent gain control of ${cardName}`,
      isOptional: true,
      isETB: true,
      isDeathTrigger: false,
      isSacrificeTrigger: false,
      goadsOnChange,
    });
  }
  
  // Check for "an opponent gains control of it" (mandatory ETB)
  if (OPPONENT_GAINS_CONTROL_PATTERN.test(oracleText) && !MAY_GIVE_CONTROL_PATTERN.test(oracleText)) {
    effects.push({
      permanentId,
      cardName,
      type: 'opponent_gains_control',
      description: `An opponent gains control of ${cardName}`,
      isOptional: false,
      isETB: true,
      isDeathTrigger: false,
      isSacrificeTrigger: false,
    });
  }
  
  // Check for "target opponent gains control" (activated ability like Humble Defector)
  if (TARGET_OPPONENT_GAINS_CONTROL_PATTERN.test(oracleText)) {
    effects.push({
      permanentId,
      cardName,
      type: 'opponent_gains_control',
      description: `Target opponent gains control of ${cardName}`,
      isOptional: false,
      isETB: false, // Activated ability, not ETB
      isDeathTrigger: false,
      isSacrificeTrigger: false,
    });
  }
  
  // Check for "whenever an opponent sacrifices" + steal
  const sacrificeMatch = oracleText.match(OPPONENT_SACRIFICE_STEAL_PATTERN);
  if (sacrificeMatch) {
    const permanentType = sacrificeMatch[1]?.trim() || 'permanent';
    effects.push({
      permanentId,
      cardName,
      type: 'opponent_sacrifice_steal',
      description: `When an opponent sacrifices a ${permanentType}, put it under your control`,
      isOptional: oracleText.includes('you may'),
      isETB: false,
      isDeathTrigger: false,
      isSacrificeTrigger: true,
      permanentType,
    });
  }
  
  // Check for "creature you don't control dies" + return under your control
  const creatureDiesMatch = oracleText.match(OPPONENT_CREATURE_DIES_STEAL_PATTERN);
  if (creatureDiesMatch) {
    const additionalEffects = creatureDiesMatch[1]?.trim();
    const isDelayed = oracleText.includes('at the beginning of the next end step') || 
                      oracleText.includes('beginning of your next end step');
    
    effects.push({
      permanentId,
      cardName,
      type: 'opponent_creature_dies_steal',
      description: `When an opponent's creature dies, return it under your control`,
      isOptional: false,
      isETB: false,
      isDeathTrigger: true,
      isSacrificeTrigger: false,
      delayedTrigger: isDelayed,
      additionalEffects,
      targetRestriction: oracleText.includes('nontoken') ? 'nontoken' : undefined,
    });
  }
  
  // Check for "put under your control" (spells/effects)
  if (PUT_UNDER_YOUR_CONTROL_PATTERN.test(oracleText)) {
    effects.push({
      permanentId,
      cardName,
      type: 'put_under_your_control',
      description: `Put a permanent onto the battlefield under your control`,
      isOptional: oracleText.includes('you may'),
      isETB: false,
      isDeathTrigger: false,
      isSacrificeTrigger: false,
    });
  }
  
  // Check for "return under your control" (reanimation)
  if (RETURN_UNDER_YOUR_CONTROL_PATTERN.test(oracleText)) {
    const isDelayed = oracleText.includes('at the beginning of the next end step') ||
                      oracleText.includes('beginning of your next end step');
    
    effects.push({
      permanentId,
      cardName,
      type: 'return_under_your_control',
      description: `Return a permanent to the battlefield under your control`,
      isOptional: oracleText.includes('you may'),
      isETB: false,
      isDeathTrigger: oracleText.includes('dies') || oracleText.includes('when enchanted creature dies'),
      isSacrificeTrigger: false,
      delayedTrigger: isDelayed,
    });
  }
  
  return effects;
}

/**
 * Check if a card has any control change effects
 */
export function hasControlChangeEffect(card: any): boolean {
  const effects = detectControlChangeEffects(card);
  return effects.length > 0;
}

/**
 * Check if a permanent should enter under an opponent's control
 */
export function shouldEnterUnderOpponentControl(card: any): boolean {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  return ENTERS_OPPONENT_CHOICE_PATTERN.test(oracleText) || 
         (ENTERS_OPPONENT_PATTERN.test(oracleText) && !oracleText.includes('if you do'));
}

/**
 * Check if a permanent has an optional "give control" ETB
 */
export function hasOptionalGiveControlETB(card: any): boolean {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  return MAY_GIVE_CONTROL_PATTERN.test(oracleText);
}

/**
 * Check if control change should goad the permanent
 */
export function shouldGoadOnControlChange(card: any): boolean {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  return GOADED_ON_CONTROL_CHANGE_PATTERN.test(oracleText);
}

/**
 * Check if creature must attack each combat (Xantcha)
 */
export function mustAttackEachCombat(card: any): boolean {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  return ATTACKS_EACH_COMBAT_PATTERN.test(oracleText);
}

/**
 * Check if creature can't attack its owner (Xantcha)
 */
export function cantAttackOwner(card: any): boolean {
  const oracleText = (card?.oracle_text || "").toLowerCase();
  return CANT_ATTACK_OWNER_PATTERN.test(oracleText);
}

// ============================================================================
// Control Change Application Functions
// ============================================================================

/**
 * Apply control change to a permanent
 */
export function applyControlChange(
  permanent: BattlefieldPermanent,
  newController: PlayerID,
  options?: {
    goad?: boolean;
    goaderId?: PlayerID;
    goadExpiryTurn?: number;
    mustAttack?: boolean;
    cantAttackOwner?: boolean;
  }
): BattlefieldPermanent {
  const updated = { ...permanent };
  
  // Change controller
  updated.controller = newController;
  
  // Apply goad if specified
  if (options?.goad && options.goaderId) {
    const existingGoaders = updated.goadedBy || [];
    if (!existingGoaders.includes(options.goaderId)) {
      updated.goadedBy = [...existingGoaders, options.goaderId];
    }
    
    if (options.goadExpiryTurn) {
      // Create a new object for the readonly record
      const newGoadedUntil: Record<string, number> = {
        ...(updated.goadedUntil || {}),
        [options.goaderId]: options.goadExpiryTurn,
      };
      updated.goadedUntil = newGoadedUntil;
    }
  }
  
  // Apply must-attack flag
  if (options?.mustAttack) {
    (updated as any).mustAttackEachCombat = true;
  }
  
  // Apply can't attack owner flag
  if (options?.cantAttackOwner) {
    (updated as any).cantAttackOwner = true;
  }
  
  return updated;
}

/**
 * Get attack restriction info for Xantcha-style creatures
 */
export function getAttackRestrictions(permanent: BattlefieldPermanent): {
  mustAttack: boolean;
  cantAttackOwner: boolean;
  cantAttackPlaneswalkers: boolean;
} {
  const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
  
  return {
    mustAttack: ATTACKS_EACH_COMBAT_PATTERN.test(oracleText),
    cantAttackOwner: CANT_ATTACK_OWNER_PATTERN.test(oracleText),
    cantAttackPlaneswalkers: oracleText.includes("planeswalkers its owner controls"),
  };
}

// ============================================================================
// Known Cards with Control Change Effects (Optimization Cache)
// ============================================================================

/**
 * Known cards with specific control change effects for faster lookup
 */
export const KNOWN_CONTROL_CHANGE_CARDS: Record<string, {
  type: ControlChangeType;
  isOptional: boolean;
  goadsOnChange?: boolean;
  mustAttackEachCombat?: boolean;
  cantAttackOwner?: boolean;
  anyPlayerCanActivate?: boolean;
  additionalEffects?: string[];
}> = {
  "vislor turlough": {
    type: 'may_give_control_to_opponent',
    isOptional: true,
    goadsOnChange: true,
  },
  "xantcha, sleeper agent": {
    type: 'enters_under_opponent_control',
    isOptional: false,
    mustAttackEachCombat: true,
    cantAttackOwner: true,
    anyPlayerCanActivate: true, // {3}: Xantcha's controller loses 2 life and you draw a card. Any player may activate this ability.
  },
  "akroan horse": {
    type: 'opponent_gains_control',
    isOptional: false,
  },
  "humble defector": {
    type: 'opponent_gains_control',
    isOptional: false,
    additionalEffects: ['draw 2 cards'],
  },
  "it that betrays": {
    type: 'opponent_sacrifice_steal',
    isOptional: false,
  },
  "grave betrayal": {
    type: 'opponent_creature_dies_steal',
    isOptional: false,
    additionalEffects: ['+1/+1 counter', 'becomes black Zombie'],
  },
  "endless whispers": {
    type: 'opponent_creature_dies_steal',
    isOptional: false,
    additionalEffects: ['choose target opponent'],
  },
  "unholy indenture": {
    type: 'return_under_your_control',
    isOptional: false,
    additionalEffects: ['+1/+1 counter'],
  },
  "animate dead": {
    type: 'return_under_your_control',
    isOptional: false,
    additionalEffects: ['-1/-0'],
  },
  "desertion": {
    type: 'put_under_your_control',
    isOptional: false,
    additionalEffects: ['counter spell first'],
  },
  "acquire": {
    type: 'put_under_your_control',
    isOptional: false,
    additionalEffects: ['search opponent library for artifact'],
  },
  "druidic satchel": {
    type: 'put_under_your_control',
    isOptional: false,
    additionalEffects: ['reveal top card', 'if land'],
  },
  "chorale of the void": {
    type: 'put_under_your_control',
    isOptional: false,
    additionalEffects: ['from defending player graveyard', 'tapped and attacking'],
  },
};

/**
 * Get control change config for a known card
 */
export function getControlChangeConfig(cardName: string): typeof KNOWN_CONTROL_CHANGE_CARDS[string] | undefined {
  return KNOWN_CONTROL_CHANGE_CARDS[cardName.toLowerCase()];
}

/**
 * Check if a card is a known control change card
 */
export function isKnownControlChangeCard(cardName: string): boolean {
  return cardName.toLowerCase() in KNOWN_CONTROL_CHANGE_CARDS;
}

// ============================================================================
// Logging
// ============================================================================

export function logControlChange(
  cardName: string,
  fromPlayer: string,
  toPlayer: string,
  reason: string = 'effect'
): void {
  debug(2, `[control-change] ${cardName} control changed from ${fromPlayer} to ${toPlayer} (${reason})`);
}

