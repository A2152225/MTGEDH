/**
 * triggers/tap-untap.ts
 * 
 * Tap/untap trigger detection and processing.
 * Includes triggers that fire when permanents become tapped or untapped.
 * 
 * Categories:
 * - Tap triggers: detectTapTriggers, getTapTriggers
 * - Untap triggers: detectUntapTriggers, getAttackUntapTriggers, getCombatDamageUntapTriggers
 * - Untap execution: executeUntapTrigger
 */

import type { GameContext } from "../../context.js";
import { KNOWN_UNTAP_TRIGGERS } from "./card-data-tables.js";

// Re-export detectDoesntUntapEffects from turn-phases for backwards compatibility
export { detectDoesntUntapEffects } from "./turn-phases.js";

// ============================================================================
// Type Definitions
// ============================================================================

export interface UntapTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  triggerOn: 'attack' | 'combat_damage' | 'damage_to_player';
  untapType: 'lands' | 'all' | 'creatures';
  effect: string;
}

export interface TapTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  description: string;
  effect: string;
  triggerCondition: 'becomes_tapped' | 'becomes_untapped' | 'taps_for_mana';
  affectedType: 'any' | 'creature' | 'tribal_type' | 'self';
  tribalType?: string;
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

// ============================================================================
// Untap Trigger Detection (Bear Umbra, Nature's Will, etc.)
// ============================================================================

/**
 * Detect untap triggers from permanents on the battlefield
 */
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
  const attackUntapLandsMatch = oracleText.match(/whenever (?:enchanted creature|equipped creature|~) attacks,?\s*(?:[^.]*)?untap all lands you control/i);
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
  const combatDamageUntapMatch = oracleText.match(/whenever (?:~|enchanted creature|equipped creature) deals combat damage to (?:a player|an opponent),?\s*(?:[^.]*)?untap all lands you control/i);
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
  
  console.log(`[executeUntapTrigger] ${trigger.cardName}: ${trigger.effect}`);
  
  switch (trigger.untapType) {
    case 'lands':
      // Untap all lands the controller owns
      for (const permanent of battlefield) {
        if (!permanent || permanent.controller !== trigger.controllerId) continue;
        const typeLine = (permanent.card?.type_line || '').toLowerCase();
        if (typeLine.includes('land') && permanent.tapped) {
          permanent.tapped = false;
          console.log(`[executeUntapTrigger] Untapped ${permanent.card?.name || permanent.id}`);
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
          console.log(`[executeUntapTrigger] Untapped ${permanent.card?.name || permanent.id}`);
        }
      }
      break;
      
    case 'all':
      // Untap all permanents the controller owns
      for (const permanent of battlefield) {
        if (!permanent || permanent.controller !== trigger.controllerId) continue;
        if (permanent.tapped) {
          permanent.tapped = false;
          console.log(`[executeUntapTrigger] Untapped ${permanent.card?.name || permanent.id}`);
        }
      }
      break;
  }
  
  ctx.bumpSeq();
}

// ============================================================================
// Tap Trigger Detection (Judge of Currents, Emmara, etc.)
// ============================================================================

/**
 * Extract creature types from a type line
 */
function extractCreatureTypes(typeLine: string): string[] {
  const types: string[] = [];
  const lowerTypeLine = typeLine.toLowerCase();
  
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

/**
 * Detect tap/untap triggered abilities from a card's oracle text
 */
export function detectTapTriggers(card: any, permanent: any): TapTrigger[] {
  const triggers: TapTrigger[] = [];
  const oracleText = (card?.oracle_text || "");
  const lowerOracle = oracleText.toLowerCase();
  const cardName = card?.name || "Unknown";
  const permanentId = permanent?.id || "";
  const controllerId = permanent?.controller || "";
  
  // "Whenever a [TYPE] you control becomes tapped" pattern
  const tribalTapMatch = oracleText.match(/whenever (?:a |an )?(\w+) you control becomes tapped,?\s*([^.]+)/i);
  if (tribalTapMatch) {
    const tribalType = tribalTapMatch[1].toLowerCase();
    const effectText = tribalTapMatch[2].trim();
    const isOptional = effectText.toLowerCase().includes('you may');
    
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
  
  // "Whenever ~ becomes tapped" pattern (self-referential like Emmara)
  const selfTapMatch = oracleText.match(/whenever (?:~|this creature) becomes tapped,?\s*([^.]+)/i);
  if (selfTapMatch) {
    const effectText = selfTapMatch[1].trim();
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
  
  // "Whenever a creature you control becomes tapped" (generic creature tap)
  if (lowerOracle.includes('whenever a creature you control becomes tapped') && 
      !triggers.some(t => t.affectedType === 'creature')) {
    const effectMatch = oracleText.match(/whenever a creature you control becomes tapped,?\s*([^.]+)/i);
    if (effectMatch) {
      const effectText = effectMatch[1].trim();
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
  
  // "Whenever you tap a [TYPE] for mana" pattern
  const tapForManaMatch = oracleText.match(/whenever you tap (?:a |an )?(\w+) for mana,?\s*([^.]+)/i);
  if (tapForManaMatch) {
    const tribalType = tapForManaMatch[1].toLowerCase();
    const effectText = tapForManaMatch[2].trim();
    
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

/**
 * Get all tap triggers that should fire when a permanent becomes tapped
 */
export function getTapTriggers(
  ctx: GameContext,
  tappedPermanent: any,
  tappedByPlayerId: string
): TapTrigger[] {
  const triggers: TapTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  
  const tappedTypeLine = (tappedPermanent?.card?.type_line || '').toLowerCase();
  const tappedCreatureTypes = extractCreatureTypes(tappedTypeLine);
  const isCreature = tappedTypeLine.includes('creature');
  
  for (const permanent of battlefield) {
    if (!permanent || !permanent.card) continue;
    
    const permTriggers = detectTapTriggers(permanent.card, permanent);
    
    for (const trigger of permTriggers) {
      // Only trigger for the controller's permanents becoming tapped
      if (permanent.controller !== tappedByPlayerId) continue;
      
      let shouldTrigger = false;
      
      switch (trigger.affectedType) {
        case 'any':
          shouldTrigger = true;
          break;
        case 'creature':
          shouldTrigger = isCreature;
          break;
        case 'tribal_type':
          if (trigger.tribalType) {
            shouldTrigger = tappedCreatureTypes.includes(trigger.tribalType.toLowerCase());
          }
          break;
        case 'self':
          // Self-referential triggers only fire when this specific permanent is tapped
          shouldTrigger = permanent.id === tappedPermanent.id;
          break;
      }
      
      if (shouldTrigger) {
        triggers.push(trigger);
      }
    }
  }
  
  return triggers;
}
