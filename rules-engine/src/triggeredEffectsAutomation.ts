/**
 * triggeredEffectsAutomation.ts
 * 
 * Automates triggered effects when cards enter the battlefield or other events occur.
 * 
 * This module handles:
 * - ETB (Enters the Battlefield) effects
 * - Dies triggers
 * - Combat triggers
 * - Forced choices (like Fleshbag Marauder's sacrifice)
 * 
 * Based on MTG Comprehensive Rules:
 * - Rule 603: Handling Triggered Abilities
 */

import type { BattlefieldPermanent, PlayerID, KnownCardRef } from '../../shared/src';

/**
 * Triggered effect types
 */
export enum TriggerType {
  ETB = 'etb',           // Enters the battlefield
  LTB = 'ltb',           // Leaves the battlefield
  DIES = 'dies',         // Goes to graveyard from battlefield
  ATTACKS = 'attacks',   // When attacks
  BLOCKS = 'blocks',     // When blocks
  CAST = 'cast',         // When cast
  DRAW = 'draw',         // When draws
  DISCARD = 'discard',   // When discards
  UPKEEP = 'upkeep',     // At beginning of upkeep
  END_STEP = 'end_step', // At beginning of end step
}

/**
 * Effect action types
 */
export enum EffectAction {
  // Self effects
  TAP_SELF = 'tap_self',             // Enters tapped
  SACRIFICE_SELF = 'sacrifice_self', // Sacrifice at end of turn
  
  // Target player effects
  DRAW_CARDS = 'draw_cards',
  DISCARD_CARDS = 'discard_cards',
  LOSE_LIFE = 'lose_life',
  GAIN_LIFE = 'gain_life',
  
  // Target permanent effects
  DESTROY = 'destroy',
  EXILE = 'exile',
  BOUNCE = 'bounce',                 // Return to hand
  TAP_TARGET = 'tap_target',
  UNTAP_TARGET = 'untap_target',
  
  // Forced choices (all players)
  EACH_SACRIFICE = 'each_sacrifice', // Each player sacrifices
  EACH_DISCARD = 'each_discard',     // Each player discards
  EACH_LOSE_LIFE = 'each_lose_life', // Each player loses life
  
  // Token creation
  CREATE_TOKEN = 'create_token',
  
  // Counter manipulation
  ADD_COUNTERS = 'add_counters',
  REMOVE_COUNTERS = 'remove_counters',
  
  // Search effects
  SEARCH_LIBRARY = 'search_library',
  
  // Modal/Choice effects
  CHOOSE_MODE = 'choose_mode',
}

/**
 * Target filter for effects
 */
export interface EffectTargetFilter {
  type?: 'creature' | 'artifact' | 'enchantment' | 'planeswalker' | 'land' | 'permanent';
  controller?: 'you' | 'opponent' | 'each' | 'any';
  subtype?: string;          // Creature type
  otherThanSelf?: boolean;   // Excludes source
  nonToken?: boolean;
}

/**
 * Triggered effect definition
 */
export interface TriggeredEffect {
  id: string;
  triggerType: TriggerType;
  action: EffectAction;
  targetFilter?: EffectTargetFilter;
  value?: number | string;
  optional?: boolean;        // "You may" effects
  selfOnly?: boolean;        // Only affects the triggering permanent
  eachPlayer?: boolean;      // Each player does this
  description: string;
}

/**
 * Pending trigger waiting to be resolved
 */
export interface PendingTrigger {
  id: string;
  sourceId: string;
  sourceName: string;
  sourceController: PlayerID;
  effect: TriggeredEffect;
  timestamp: number;
  resolved: boolean;
  requiresChoice: boolean;
  choiceOptions?: any[];
  selectedChoice?: any;
}

/**
 * Parse ETB effects from oracle text
 */
export function parseETBEffects(card: KnownCardRef, permanentId: string): TriggeredEffect[] {
  const effects: TriggeredEffect[] = [];
  const oracleText = (card.oracle_text || '').toLowerCase();
  const typeLine = (card.type_line || '').toLowerCase();
  
  // Check for "enters the battlefield tapped"
  if (oracleText.includes('enters the battlefield tapped') || 
      oracleText.includes('enters tapped')) {
    effects.push({
      id: `${permanentId}-etb-tapped`,
      triggerType: TriggerType.ETB,
      action: EffectAction.TAP_SELF,
      selfOnly: true,
      description: 'Enters the battlefield tapped',
    });
  }
  
  // Check for Fleshbag Marauder style "each player sacrifices a creature"
  if (oracleText.includes('each player sacrifices') || 
      oracleText.includes('each opponent sacrifices')) {
    const isOpponentOnly = oracleText.includes('each opponent');
    
    // Determine what needs to be sacrificed
    let targetType: 'creature' | 'artifact' | 'permanent' = 'creature';
    if (oracleText.includes('sacrifices a creature')) {
      targetType = 'creature';
    } else if (oracleText.includes('sacrifices an artifact')) {
      targetType = 'artifact';
    } else if (oracleText.includes('sacrifices a permanent')) {
      targetType = 'permanent';
    }
    
    effects.push({
      id: `${permanentId}-etb-each-sacrifice`,
      triggerType: TriggerType.ETB,
      action: EffectAction.EACH_SACRIFICE,
      targetFilter: {
        type: targetType,
        controller: isOpponentOnly ? 'opponent' : 'each',
      },
      eachPlayer: true,
      description: `Each ${isOpponentOnly ? 'opponent' : 'player'} sacrifices a ${targetType}`,
    });
  }
  
  // Check for draw effects
  const drawMatch = oracleText.match(/when .* enters.*draw\s+(\d+|a)\s+cards?/i);
  if (drawMatch) {
    const amount = drawMatch[1] === 'a' ? 1 : parseInt(drawMatch[1]);
    effects.push({
      id: `${permanentId}-etb-draw`,
      triggerType: TriggerType.ETB,
      action: EffectAction.DRAW_CARDS,
      value: amount,
      description: `Draw ${amount} card${amount > 1 ? 's' : ''}`,
    });
  }
  
  // Check for life gain
  const lifeGainMatch = oracleText.match(/when .* enters.*gain\s+(\d+)\s+life/i);
  if (lifeGainMatch) {
    const amount = parseInt(lifeGainMatch[1]);
    effects.push({
      id: `${permanentId}-etb-lifegain`,
      triggerType: TriggerType.ETB,
      action: EffectAction.GAIN_LIFE,
      value: amount,
      description: `Gain ${amount} life`,
    });
  }
  
  // Check for life loss effects on opponents
  const lifeLossMatch = oracleText.match(/when .* enters.*(?:each )?opponent(?:s)?\s+loses?\s+(\d+)\s+life/i);
  if (lifeLossMatch) {
    const amount = parseInt(lifeLossMatch[1]);
    effects.push({
      id: `${permanentId}-etb-lifeloss`,
      triggerType: TriggerType.ETB,
      action: EffectAction.EACH_LOSE_LIFE,
      value: amount,
      targetFilter: { controller: 'opponent' },
      eachPlayer: true,
      description: `Each opponent loses ${amount} life`,
    });
  }
  
  // Check for token creation
  if (oracleText.includes('when') && oracleText.includes('enters') && oracleText.includes('create')) {
    const tokenMatch = oracleText.match(/create\s+(?:a|an|(\d+))\s+(\d+\/\d+)?\s*([^.]+)\s+(?:creature )?tokens?/i);
    if (tokenMatch) {
      effects.push({
        id: `${permanentId}-etb-token`,
        triggerType: TriggerType.ETB,
        action: EffectAction.CREATE_TOKEN,
        value: tokenMatch[0],
        description: 'Create a token',
      });
    }
  }
  
  // Check for counter addition
  if (oracleText.includes('when') && oracleText.includes('enters') && oracleText.includes('+1/+1 counter')) {
    const counterMatch = oracleText.match(/put\s+(?:a|(\d+))\s+\+1\/\+1\s+counters?\s+on/i);
    if (counterMatch) {
      const amount = counterMatch[1] ? parseInt(counterMatch[1]) : 1;
      effects.push({
        id: `${permanentId}-etb-counter`,
        triggerType: TriggerType.ETB,
        action: EffectAction.ADD_COUNTERS,
        value: amount,
        description: `Put ${amount} +1/+1 counter${amount > 1 ? 's' : ''} on target`,
      });
    }
  }
  
  return effects;
}

/**
 * Parse dies triggers from oracle text
 */
export function parseDiesTriggers(card: KnownCardRef, permanentId: string): TriggeredEffect[] {
  const effects: TriggeredEffect[] = [];
  const oracleText = (card.oracle_text || '').toLowerCase();
  
  // Check for "when this dies" effects
  if (oracleText.includes('when') && (oracleText.includes('dies') || oracleText.includes('is put into a graveyard'))) {
    // Draw card on death
    if (oracleText.includes('draw a card') || oracleText.includes('draw 1 card')) {
      effects.push({
        id: `${permanentId}-dies-draw`,
        triggerType: TriggerType.DIES,
        action: EffectAction.DRAW_CARDS,
        value: 1,
        description: 'When this dies, draw a card',
      });
    }
    
    // Create token on death
    if (oracleText.includes('create')) {
      effects.push({
        id: `${permanentId}-dies-token`,
        triggerType: TriggerType.DIES,
        action: EffectAction.CREATE_TOKEN,
        description: 'When this dies, create a token',
      });
    }
  }
  
  return effects;
}

/**
 * Check if a permanent should enter tapped
 * Handles conditional ETB tapped effects:
 * - "enters the battlefield tapped" (always tapped)
 * - Fast lands: "unless you control two or fewer other lands" (tapped if 3+ lands)
 * - Slow lands: "unless you control two or more other lands" (tapped if 0-1 lands)
 * - Check lands: "unless you control a [type]" (tapped if no matching land)
 * - Shock lands: handled separately via player choice
 * 
 * @param card - The card entering the battlefield
 * @param controlledLandCount - Number of lands the player controls (optional)
 * @param controlledLandTypes - Array of land subtypes controlled (optional)
 * @returns true if the permanent should enter tapped
 */
export function shouldEnterTapped(
  card: KnownCardRef,
  controlledLandCount?: number,
  controlledLandTypes?: string[]
): boolean {
  const oracleText = (card.oracle_text || '').toLowerCase();
  const cardName = (card.name || '').toLowerCase();
  
  // Direct "enters the battlefield tapped" with no condition
  // But not "enters the battlefield tapped unless" (conditional)
  if ((oracleText.includes('enters the battlefield tapped') || 
       oracleText.includes('enters tapped')) &&
      !oracleText.includes('unless') &&
      !oracleText.includes('if you')) {
    return true;
  }
  
  // Shock lands and similar "pay life or enter tapped" - handled via player choice
  // Pattern: "pay 2 life" in oracle text with ETB condition
  // Don't auto-tap here; the choice modal handles this
  if (oracleText.includes('pay 2 life') && 
      (oracleText.includes('enters the battlefield tapped unless') || 
       oracleText.includes('as ~ enters the battlefield'))) {
    // Default to tapped; player choice will override if they pay life
    return true;
  }
  
  // Fast lands (Kaladesh, etc): "unless you control two or fewer other lands"
  // Examples: Blooming Marsh, Botanical Sanctum, Concealed Courtyard
  // Enters tapped if controlling 3+ other lands
  const fastLandPattern = /enters the battlefield tapped unless you control two or fewer other lands/i;
  if (fastLandPattern.test(oracleText)) {
    // If we have land count info, check condition
    if (controlledLandCount !== undefined) {
      // Fast lands enter tapped if you control 3+ OTHER lands (not counting itself)
      return controlledLandCount > 2;
    }
    // Without land count, we can't determine; assume tapped for safety
    return true;
  }
  
  // Slow lands (MID/VOW): "unless you control two or more other lands"
  // Examples: Deserted Beach, Haunted Ridge
  // Enters tapped if controlling 0-1 other lands
  const slowLandPattern = /enters the battlefield tapped unless you control two or more other lands/i;
  if (slowLandPattern.test(oracleText)) {
    if (controlledLandCount !== undefined) {
      // Slow lands enter tapped if you control 0-1 OTHER lands
      return controlledLandCount < 2;
    }
    return true;
  }
  
  // Check lands: "unless you control a [type]"
  // Examples: Dragonskull Summit (Swamp or Mountain)
  const checkLandPattern = /enters the battlefield tapped unless you control (?:a|an) ([\w\s]+)/i;
  const checkMatch = oracleText.match(checkLandPattern);
  if (checkMatch) {
    const requiredTypes = checkMatch[1].toLowerCase().split(/\s+or\s+/).map(t => t.trim());
    
    if (controlledLandTypes && controlledLandTypes.length > 0) {
      // Check if player controls any of the required types
      const hasRequiredType = requiredTypes.some(reqType => 
        controlledLandTypes.some(controlled => 
          controlled.toLowerCase().includes(reqType)
        )
      );
      return !hasRequiredType; // Tapped if no matching type
    }
    // Without type info, assume tapped
    return true;
  }
  
  // Generic "enters the battlefield tapped unless" (catch-all for unknown conditions)
  if (oracleText.includes('enters the battlefield tapped unless')) {
    // For unknown conditions, default to tapped for safety
    return true;
  }
  
  return false;
}

/**
 * Create pending triggers for ETB effects
 */
export function createETBTriggers(
  permanent: BattlefieldPermanent,
  allPlayers: PlayerID[]
): PendingTrigger[] {
  const card = permanent.card as KnownCardRef;
  if (!card) return [];
  
  const effects = parseETBEffects(card, permanent.id);
  const timestamp = Date.now();
  
  return effects.map((effect, index) => ({
    id: `trigger-${permanent.id}-${timestamp}-${index}`,
    sourceId: permanent.id,
    sourceName: card.name || 'Unknown',
    sourceController: permanent.controller,
    effect,
    timestamp: timestamp + index, // Ensure ordering
    resolved: false,
    requiresChoice: effect.action === EffectAction.EACH_SACRIFICE ||
                    effect.action === EffectAction.CHOOSE_MODE,
    choiceOptions: effect.eachPlayer ? allPlayers : undefined,
  }));
}

/**
 * Auto-resolve simple triggers that don't require choices
 */
export function autoResolveTrigger(
  trigger: PendingTrigger,
  gameState: any
): { resolved: boolean; actions: any[] } {
  const actions: any[] = [];
  
  switch (trigger.effect.action) {
    case EffectAction.TAP_SELF:
      // Auto-tap the permanent
      actions.push({
        type: 'tap',
        targetId: trigger.sourceId,
      });
      return { resolved: true, actions };
      
    case EffectAction.DRAW_CARDS:
      actions.push({
        type: 'draw',
        playerId: trigger.sourceController,
        amount: trigger.effect.value || 1,
      });
      return { resolved: true, actions };
      
    case EffectAction.GAIN_LIFE:
      actions.push({
        type: 'gainLife',
        playerId: trigger.sourceController,
        amount: trigger.effect.value || 0,
      });
      return { resolved: true, actions };
      
    case EffectAction.EACH_LOSE_LIFE:
      // Each opponent loses life - auto-resolve
      actions.push({
        type: 'eachOpponentLosesLife',
        sourceController: trigger.sourceController,
        amount: trigger.effect.value || 0,
      });
      return { resolved: true, actions };
      
    case EffectAction.EACH_SACRIFICE:
      // Requires player choices - cannot auto-resolve
      return { resolved: false, actions: [] };
      
    default:
      // Unknown trigger type - mark as requiring manual resolution
      return { resolved: false, actions: [] };
  }
}

/**
 * Collect all triggers from a game event
 */
export function collectTriggers(
  eventType: TriggerType,
  eventData: any,
  battlefield: BattlefieldPermanent[],
  allPlayers: PlayerID[]
): PendingTrigger[] {
  const triggers: PendingTrigger[] = [];
  const timestamp = Date.now();
  
  for (const perm of battlefield) {
    const card = perm.card as KnownCardRef;
    if (!card) continue;
    
    let effects: TriggeredEffect[] = [];
    
    switch (eventType) {
      case TriggerType.ETB:
        if (eventData.permanentId === perm.id) {
          effects = parseETBEffects(card, perm.id);
        }
        break;
        
      case TriggerType.DIES:
        effects = parseDiesTriggers(card, perm.id);
        break;
    }
    
    for (let i = 0; i < effects.length; i++) {
      triggers.push({
        id: `trigger-${perm.id}-${timestamp}-${i}`,
        sourceId: perm.id,
        sourceName: card.name || 'Unknown',
        sourceController: perm.controller,
        effect: effects[i],
        timestamp: timestamp + i,
        resolved: false,
        requiresChoice: effects[i].action === EffectAction.EACH_SACRIFICE ||
                        effects[i].action === EffectAction.CHOOSE_MODE,
        choiceOptions: effects[i].eachPlayer ? allPlayers : undefined,
      });
    }
  }
  
  return triggers;
}

export default {
  parseETBEffects,
  parseDiesTriggers,
  shouldEnterTapped,
  createETBTriggers,
  autoResolveTrigger,
  collectTriggers,
};
