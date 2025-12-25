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
import {
  KNOWN_COMBAT_DAMAGE_TRIGGERS,
  KNOWN_ATTACK_TRIGGERS,
  KNOWN_BEGINNING_COMBAT_TRIGGERS,
} from "./card-data-tables.js";
import type { BeginningOfCombatTrigger, EndOfCombatTrigger } from "./types.js";
import { debug, debugWarn, debugError } from "../../../utils/debug.js";

// ============================================================================
// Local Type Definitions (compatible with types.ts but with additional fields)
// ============================================================================

/**
 * Combat trigger with additional fields for combat-specific processing
 */
export interface CombatTriggeredAbility {
  permanentId: string;
  cardName: string;
  controllerId?: string;
  triggerType?: string;
  description: string;
  effect?: string;
  value?: any;
  mandatory?: boolean;
  requiresTarget?: boolean;
  manaCost?: string;
  batched?: boolean;
}

export interface AttachmentAttackTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  attachedToId: string;
  effect: string;
  mandatory: boolean;
  searchesLibrary?: boolean;
  searchType?: string;
  createsToken?: boolean;
}

// Re-export types from types.ts for consumers
export type { BeginningOfCombatTrigger, EndOfCombatTrigger };

// ============================================================================
// Combat Damage Triggers
// ============================================================================

/**
 * Detect combat damage triggers from a permanent's abilities
 */
export function detectCombatDamageTriggers(card: any, permanent: any): CombatTriggeredAbility[] {
  const triggers: CombatTriggeredAbility[] = [];
  const oracleText = (card?.oracle_text || "");
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
  
  // Generic "whenever ~ deals combat damage to a player" detection
  const combatDamagePlayerMatch = oracleText.match(/whenever\s+(?:~|this creature)\s+deals\s+combat\s+damage\s+to\s+(?:a\s+)?(?:player|an?\s+opponent),?\s*([^.]+)/i);
  if (combatDamagePlayerMatch && !triggers.some(t => t.triggerType === 'deals_combat_damage')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'deals_combat_damage',
      description: combatDamagePlayerMatch[1].trim(),
      effect: combatDamagePlayerMatch[1].trim(),
      mandatory: true,
    });
  }
  
  // "Whenever one or more creatures you control deal combat damage to a player" (batched trigger)
  const batchedCombatDamageMatch = oracleText.match(/whenever\s+one\s+or\s+more\s+creatures\s+you\s+control\s+deal\s+combat\s+damage\s+to\s+(?:a\s+)?(?:player|an?\s+opponent),?\s*([^.]+)/i);
  if (batchedCombatDamageMatch && !triggers.some(t => t.triggerType === 'creatures_deal_combat_damage_batched')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creatures_deal_combat_damage_batched',
      description: batchedCombatDamageMatch[1].trim(),
      effect: batchedCombatDamageMatch[1].trim(),
      mandatory: true,
      batched: true,
    });
  }
  
  // "Whenever ~ deals damage to a player" (includes combat and non-combat)
  const damagePlayerMatch = oracleText.match(/whenever\s+(?:~|this creature)\s+deals\s+damage\s+to\s+(?:a\s+)?(?:player|an?\s+opponent),?\s*([^.]+)/i);
  if (damagePlayerMatch && !triggers.some(t => t.triggerType === 'deals_combat_damage' || t.triggerType === 'deals_damage')) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'deals_damage',
      description: damagePlayerMatch[1].trim(),
      effect: damagePlayerMatch[1].trim(),
      mandatory: true,
    });
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
): CombatTriggeredAbility[] {
  if (damageDealt <= 0) return [];
  
  return detectCombatDamageTriggers(attackingPermanent.card, attackingPermanent);
}

// ============================================================================
// Attack Triggers
// ============================================================================

/**
 * Detect attack triggers from a permanent's abilities
 */
export function detectAttackTriggers(card: any, permanent: any): CombatTriggeredAbility[] {
  const triggers: CombatTriggeredAbility[] = [];
  const oracleText = (card?.oracle_text || "");
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  
  // Also check grantedAbilities on the permanent for temporary abilities
  // These are abilities granted by other cards (e.g., "gains firebending 4 until end of turn")
  const grantedAbilities = Array.isArray(permanent?.grantedAbilities) ? permanent.grantedAbilities : [];
  const grantedText = grantedAbilities.join('\n').toLowerCase();
  
  // Check known cards
  for (const [knownName, info] of Object.entries(KNOWN_ATTACK_TRIGGERS)) {
    if (lowerName.includes(knownName)) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'attacks',
        description: info.effect,
        effect: info.effect,
        value: info.value,
        mandatory: true,
      });
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
  
  // Firebending N - Avatar set mechanic
  // Pattern: "Firebending N" or "firebending N"
  // Effect: "Whenever this creature attacks, add {R}{R}... (N times). This mana lasts until end of combat."
  // Check both oracle text AND granted abilities (for creatures that "gain firebending N")
  const firebendingMatch = oracleText.match(/firebending\s+(\d+)/i) || grantedText.match(/firebending\s+(\d+)/i);
  if (firebendingMatch) {
    const n = parseInt(firebendingMatch[1], 10);
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'firebending',
      description: `Add ${'{R}'.repeat(n)} (until end of combat)`,
      effect: `add_red_mana`,
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
  
  // Exalted
  if (lowerOracle.includes("exalted")) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'exalted',
      description: "+1/+1 to attacking creature (when attacking alone)",
      mandatory: true,
    });
  }
  
  // Generic "whenever ~ attacks" - also match actual card name (e.g., "Whenever Myrel attacks")
  // Create a pattern that matches: ~, this creature, or the actual card name
  const cardNamePattern = cardName.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '\\s+');
  const attacksPattern = new RegExp(`whenever\\s+(?:~|this creature|${cardNamePattern})\\s+attacks,?\\s*([^.]+)`, 'i');
  const attacksMatch = oracleText.match(attacksPattern);
  if (attacksMatch && !triggers.some(t => t.triggerType === 'attacks')) {
    const effectText = attacksMatch[1].trim();
    
    // Check for optional mana payment trigger
    const mayPayMatch = effectText.match(/you may pay (\{[^}]+\}(?:\{[^}]+\})*)\.\s*if you do,?\s*(.+)/i);
    
    if (mayPayMatch) {
      triggers.push({
        permanentId,
        cardName,
        triggerType: 'attacks',
        description: effectText,
        effect: mayPayMatch[2].trim(),
        manaCost: mayPayMatch[1],
        mandatory: false,
      });
    } else {
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
  
  // "Whenever a creature you control attacks"
  const creatureAttacksMatch = oracleText.match(/whenever a creature you control attacks,?\s*([^.]+)/i);
  if (creatureAttacksMatch) {
    triggers.push({
      permanentId,
      cardName,
      triggerType: 'creature_attacks',
      description: creatureAttacksMatch[1].trim(),
      effect: creatureAttacksMatch[1].trim(),
      mandatory: true,
    });
  }
  
  // Join Forces attack trigger
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
      value: { isJoinForces: true },
    });
  }
  
  return triggers;
}

/**
 * Process attack triggers when creatures attack
 */
export function getAttackTriggersForCreatures(
  ctx: GameContext,
  attackingCreatures: any[],
  attackingPlayer: string,
  defendingPlayer: string
): CombatTriggeredAbility[] {
  const triggers: CombatTriggeredAbility[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  // Check each attacking creature for attack triggers
  for (const attacker of attackingCreatures) {
    const attackerTriggers = detectAttackTriggers(attacker.card, attacker);
    triggers.push(...attackerTriggers);
  }
  
  // Check all permanents for "whenever a creature you control attacks" triggers
  for (const permanent of battlefield) {
    if (!permanent || permanent.controller !== attackingPlayer) continue;
    
    const permTriggers = detectAttackTriggers(permanent.card, permanent);
    for (const trigger of permTriggers) {
      if (trigger.triggerType === 'creature_attacks') {
        for (const _ of attackingCreatures) {
          triggers.push({ ...trigger });
        }
      }
      if (trigger.triggerType === 'exalted' && attackingCreatures.length === 1) {
        triggers.push(trigger);
      }
    }
  }
  
  // Check for equipment/aura attack triggers on each attacking creature
  for (const attacker of attackingCreatures) {
    const attachmentTriggers = getAttachmentAttackTriggers(ctx, attacker, attackingPlayer);
    for (const attachTrigger of attachmentTriggers) {
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
  
  // Check for Background enchantments that grant abilities to commanders
  // Example: Agent of the Shadow Thieves - grants attack trigger to commanders
  const commandZone = (ctx.state as any).commandZone?.[attackingPlayer];
  const commanderIds = commandZone?.commanderIds || [];
  
  for (const attacker of attackingCreatures) {
    // Check if this attacking creature is a commander owned by the attacking player
    const isCommander = commanderIds.includes(attacker.card?.id) || 
                       (attacker.card?.name && commandZone?.commanderNames?.includes(attacker.card.name));
    
    if (isCommander) {
      // Check all permanents for backgrounds that grant abilities to commanders
      for (const permanent of battlefield) {
        if (!permanent || permanent.controller !== attackingPlayer) continue;
        
        const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
        const cardName = (permanent.card?.name || "").toLowerCase();
        const typeLine = (permanent.card?.type_line || "").toLowerCase();
        
        // Check if this is a Background enchantment
        if (!typeLine.includes('background')) continue;
        
        // Agent of the Shadow Thieves: "Commander creatures you own have 'Whenever this creature attacks a player...'"
        if (cardName.includes('agent of the shadow thieves') ||
            (oracleText.includes('commander creatures you own') && 
             oracleText.includes('whenever this creature attacks'))) {
          // Extract the granted ability
          const grantedAbilityMatch = oracleText.match(/commander creatures you own have "([^"]+)"/i);
          if (grantedAbilityMatch) {
            const grantedAbility = grantedAbilityMatch[1];
            triggers.push({
              permanentId: attacker.id,
              cardName: attacker.card?.name || 'Commander',
              description: grantedAbility,
              triggerType: 'attacks',
              mandatory: true,
              value: {
                grantedBy: permanent.id,
                grantedByName: permanent.card?.name,
                defendingPlayer: defendingPlayer, // Pass defending player for conditional check
              },
            });
            debug(2, `[getAttackTriggersForCreatures] Background ${permanent.card?.name} granted attack trigger to commander ${attacker.card?.name} (defending ${defendingPlayer})`);
          }
        }
      }
    }
  }
  
  return triggers;
}

/**
 * Detect attachment attack triggers
 */
export function detectAttachmentAttackTriggers(card: any, permanent: any): AttachmentAttackTrigger[] {
  const triggers: AttachmentAttackTrigger[] = [];
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  const attachedToId = permanent?.attachedTo || "";
  
  if (!attachedToId) return triggers;
  
  // Sword of X and Y style - "Whenever equipped creature deals combat damage to a player"
  if (oracleText.includes('whenever equipped creature deals combat damage to a player')) {
    const effectMatch = oracleText.match(/whenever equipped creature deals combat damage to a player,?\s*([^.]+)/i);
    if (effectMatch) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        attachedToId,
        effect: effectMatch[1].trim(),
        mandatory: true,
        searchesLibrary: oracleText.includes('search'),
        searchType: oracleText.includes('basic land') ? 'basic land' : undefined,
      });
    }
  }
  
  // "Whenever enchanted creature attacks"
  if (oracleText.includes('whenever enchanted creature attacks')) {
    const effectMatch = oracleText.match(/whenever enchanted creature attacks,?\s*([^.]+)/i);
    if (effectMatch) {
      triggers.push({
        permanentId,
        cardName,
        controllerId,
        attachedToId,
        effect: effectMatch[1].trim(),
        mandatory: true,
      });
    }
  }
  
  return triggers;
}

/**
 * Get attachment attack triggers for an attacking creature
 */
export function getAttachmentAttackTriggers(
  ctx: GameContext,
  attacker: any,
  attackingPlayer: string
): AttachmentAttackTrigger[] {
  const triggers: AttachmentAttackTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  // Find all attachments on this creature
  for (const permanent of battlefield) {
    if (!permanent || permanent.attachedTo !== attacker.id) continue;
    
    const attachTriggers = detectAttachmentAttackTriggers(permanent.card, permanent);
    triggers.push(...attachTriggers);
  }
  
  return triggers;
}

/**
 * Get attachment combat damage triggers
 */
export function getAttachmentCombatDamageTriggers(
  ctx: GameContext,
  attacker: any,
  attackingPlayer: string
): AttachmentAttackTrigger[] {
  const triggers: AttachmentAttackTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || permanent.attachedTo !== attacker.id) continue;
    
    const oracleText = (permanent.card?.oracle_text || "").toLowerCase();
    const cardName = permanent.card?.name || "Unknown";
    
    // "Whenever equipped creature deals combat damage to a player"
    if (oracleText.includes('whenever equipped creature deals combat damage to a player')) {
      const effectMatch = oracleText.match(/whenever equipped creature deals combat damage to a player,?\s*([^.]+)/i);
      if (effectMatch) {
        triggers.push({
          permanentId: permanent.id,
          cardName,
          controllerId: permanent.controller,
          attachedToId: attacker.id,
          effect: effectMatch[1].trim(),
          mandatory: true,
          searchesLibrary: oracleText.includes('search'),
        });
      }
    }
  }
  
  return triggers;
}

// ============================================================================
// Beginning of Combat Triggers
// ============================================================================

/**
 * Detect beginning of combat triggers
 */
export function detectBeginningOfCombatTriggers(card: any, permanent: any): BeginningOfCombatTrigger[] {
  const triggers: BeginningOfCombatTrigger[] = [];
  const oracleText = (card?.oracle_text || "");
  const cardName = card?.name || "Unknown";
  const lowerName = cardName.toLowerCase();
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // Check known cards
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
      });
    }
  }
  
  // Generic "at the beginning of combat on your turn" detection
  // ONLY add if not already in known cards list to prevent duplicates
  const beginCombatMatch = oracleText.match(/at the beginning of combat on your turn,?\s*([^.]+)/i);
  if (beginCombatMatch && triggers.length === 0) {
    // No known trigger found, use generic detection
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: beginCombatMatch[1].trim(),
      effect: beginCombatMatch[1].trim(),
      mandatory: true,
    });
  }
  
  // "At the beginning of each combat" - triggers on all players' combats
  // ONLY add if not already in known cards list to prevent duplicates
  const eachCombatMatch = oracleText.match(/at the beginning of each combat,?\s*([^.]+)/i);
  if (eachCombatMatch && triggers.length === 0) {
    // No known trigger found, use generic detection
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: eachCombatMatch[1].trim(),
      effect: eachCombatMatch[1].trim(),
      mandatory: true,
    });
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
    
    for (const trigger of permTriggers) {
      const lowerOracle = (permanent.card.oracle_text || '').toLowerCase();
      
      const hasOnYourTurn = lowerOracle.includes('on your turn') || 
                           lowerOracle.includes('on his or her turn') ||
                           lowerOracle.includes('on their turn');
      
      const hasEachCombat = lowerOracle.includes('each combat') ||
                           lowerOracle.includes('each player\'s combat') ||
                           lowerOracle.includes('every combat');
      
      if (hasOnYourTurn) {
        if (permanent.controller === activePlayerId) {
          triggers.push(trigger);
          triggerCount++;
        }
      } else if (hasEachCombat) {
        triggers.push(trigger);
        triggerCount++;
      } else if (permanent.controller === activePlayerId) {
        triggers.push(trigger);
        triggerCount++;
      }
    }
  }
  
  return triggers;
}

// ============================================================================
// End of Combat Triggers
// ============================================================================

/**
 * Detect end of combat triggers from a card's oracle text
 */
export function detectEndOfCombatTriggers(card: any, permanent: any): EndOfCombatTrigger[] {
  const triggers: EndOfCombatTrigger[] = [];
  const oracleText = (card?.oracle_text || "");
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // "At end of combat" or "At the end of combat"
  const endCombatMatch = oracleText.match(/at (?:the )?end of combat,?\s*([^.]+)/i);
  if (endCombatMatch) {
    triggers.push({
      permanentId,
      cardName,
      controllerId,
      description: endCombatMatch[1].trim(),
      effect: endCombatMatch[1].trim(),
      mandatory: true,
    });
  }
  
  return triggers;
}

/**
 * Get all end of combat triggers
 */
export function getEndOfCombatTriggers(
  ctx: GameContext,
  activePlayerId: string
): EndOfCombatTrigger[] {
  const triggers: EndOfCombatTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const permTriggers = detectEndOfCombatTriggers(permanent.card, permanent);
    triggers.push(...permTriggers);
  }
  
  return triggers;
}

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
  targetType: 'opponent' | 'any' | 'any_non_dragon' | 'chosen_player' | 'each_opponent' | 'controller';
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
    oracleText.includes(`whenever ${lowerName} is dealt damage`);
  
  if (!hasTrigger) return null;
  
  // Determine target type from oracle text
  let targetType: 'opponent' | 'any' | 'any_non_dragon' | 'chosen_player' | 'each_opponent' | 'controller' = 'any';
  let targetRestriction = '';
  
  if (oracleText.includes("target opponent")) {
    targetType = 'opponent';
    targetRestriction = 'opponent';
  } else if (oracleText.includes("any target that isn't a dragon")) {
    targetType = 'any_non_dragon';
    targetRestriction = "that isn't a Dragon";
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

