/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: leftover attachment-attack detect/get + combat-untap getters/execute
 * Public: detectAttachmentAttackTriggers, getAttachmentAttackTriggers,
 *   getAttackUntapTriggers,
 *   getCombatDamageUntapTriggers, executeUntapTrigger
 */

import { debug } from "../../../utils/debug.js";
import type { GameContext } from "../../context.js";
import { timingTriggerEffect } from "./timing-effect-extraction.js";
import { detectUntapTriggers, type UntapTrigger } from "./untap-detection.js";
import { permanentHasTriggeredAbilities } from './triggeredAbilitySuppression.js';
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
export function detectAttachmentAttackTriggers(card: any, permanent: any, gameState?: any): AttachmentAttackTrigger[] {
  if (!permanentHasTriggeredAbilities(permanent, gameState, { event: 'attack' })) return []; // Humility / Torpor Orb gate
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
    const attachmentTriggers = detectAttachmentAttackTriggers(permanent.card, permanent, (ctx as any)?.state);
    for (const trigger of attachmentTriggers) {
      if (trigger.triggerType === 'attack') {
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
  const selfTriggers = detectUntapTriggers(attackingCreature.card, attackingCreature, (ctx as any)?.state);
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
        const attachmentTriggers = detectUntapTriggers(permanent.card, permanent, (ctx as any)?.state);
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
  const selfTriggers = detectUntapTriggers(attackingCreature.card, attackingCreature, (ctx as any)?.state);
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
        const attachmentTriggers = detectUntapTriggers(permanent.card, permanent, (ctx as any)?.state);
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
