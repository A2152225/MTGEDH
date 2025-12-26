/**
 * triggers/damage-received.ts
 * 
 * Centralized damage-received trigger system.
 * Handles "whenever [this creature/enchanted creature/equipped creature] is dealt damage" triggers.
 * 
 * This module provides a scalable, dynamic solution that works for:
 * - Combat damage (attackers, blockers)
 * - Fight abilities
 * - Spell damage (Lightning Bolt, Fireball, etc.)
 * - Ability damage (Prodigal Pyromancer, etc.)
 * 
 * Cards supported:
 * - Brash Taunter: "Whenever this creature is dealt damage, it deals that much damage to target opponent."
 * - Boros Reckoner: "Whenever Boros Reckoner is dealt damage, it deals that much damage to any target."
 * - Blazing Sunsteel: "Whenever equipped creature is dealt damage, it deals that much damage to any target."
 * - And many more similar cards
 */

import type { GameContext } from "../../context.js";
import { KNOWN_DAMAGE_RECEIVED_TRIGGERS, KNOWN_DAMAGE_RECEIVED_AURAS, KNOWN_DAMAGE_RECEIVED_EQUIPMENT } from "./card-data-tables.js";

/**
 * Information about a damage trigger that needs target selection
 */
export interface DamageTriggerInfo {
  triggerId: string;
  sourceId: string;
  sourceName: string;
  controller: string;
  damageAmount: number;
  triggerType: 'dealt_damage';
  targetType: 'opponent' | 'any' | 'each_opponent' | 'any_non_dragon' | 'controller';
  targetRestriction?: string;
  effect: string;
}

/**
 * Check if a permanent has a damage-received trigger.
 * Checks both the permanent's own oracle text and any granted triggers from attachments.
 * 
 * @param permanent The permanent that was dealt damage
 * @param state Game state
 * @returns Trigger info if found, null otherwise
 */
export function getDamageReceivedTrigger(
  permanent: any,
  state: any
): { targetType: string; effect: string; targetRestriction?: string } | null {
  if (!permanent) return null;

  const card = permanent.card || {};
  const oracleText = (card.oracle_text || "").toLowerCase();
  const creatureName = (card.name || "").toLowerCase();

  // Check known cards table first (for optimization)
  if (KNOWN_DAMAGE_RECEIVED_TRIGGERS[creatureName]) {
    const triggerInfo = KNOWN_DAMAGE_RECEIVED_TRIGGERS[creatureName];
    return {
      targetType: triggerInfo.targetType,
      effect: triggerInfo.effect,
    };
  }

  // Check if this permanent has attachments that grant damage-received triggers
  if (permanent.attachments && permanent.attachments.length > 0) {
    for (const attachmentId of permanent.attachments) {
      const attachment = state.battlefield?.find((p: any) => p.id === attachmentId);
      if (attachment) {
        const attachmentName = (attachment.card?.name || "").toLowerCase();
        
        if (KNOWN_DAMAGE_RECEIVED_AURAS[attachmentName]) {
          const triggerInfo = KNOWN_DAMAGE_RECEIVED_AURAS[attachmentName];
          return {
            targetType: triggerInfo.targetType,
            effect: triggerInfo.effect,
          };
        }
        
        if (KNOWN_DAMAGE_RECEIVED_EQUIPMENT[attachmentName]) {
          const triggerInfo = KNOWN_DAMAGE_RECEIVED_EQUIPMENT[attachmentName];
          return {
            targetType: triggerInfo.targetType,
            effect: triggerInfo.effect,
          };
        }
      }
    }
  }

  // Dynamic pattern matching for unknown cards
  // Pattern: "Whenever this creature is dealt damage" or "Whenever ~ is dealt damage"
  if (oracleText.includes("whenever this creature is dealt damage") ||
      oracleText.includes(`whenever ${creatureName} is dealt damage`) ||
      oracleText.includes("whenever enchanted creature is dealt damage") ||
      oracleText.includes("whenever equipped creature is dealt damage")) {
    
    // Determine target type from oracle text
    let targetType = 'any'; // Default to any target
    let targetRestriction = '';
    
    if (oracleText.includes("target opponent")) {
      targetType = 'opponent';
      targetRestriction = 'opponent';
    } else if (oracleText.includes("each opponent")) {
      targetType = 'each_opponent';
      targetRestriction = 'each opponent';
    } else if (oracleText.includes("any target that isn't a dragon")) {
      targetType = 'any_non_dragon';
      targetRestriction = "that isn't a Dragon";
    } else if (oracleText.includes("target player")) {
      targetType = 'any';
      targetRestriction = 'player';
    }
    
    // Extract effect description
    let effect = "Deals that much damage to target";
    if (oracleText.includes("deals that much damage to")) {
      const match = oracleText.match(/deals that much damage to ([^.]+)/);
      if (match) {
        effect = `Deals that much damage to ${match[1]}`;
      }
    }
    
    return {
      targetType,
      effect,
      targetRestriction,
    };
  }

  return null;
}

/**
 * Process damage dealt to a permanent and check for damage-received triggers.
 * This is the main entry point called from combat, spells, abilities, etc.
 * 
 * @param ctx Game context
 * @param permanent The permanent that was dealt damage
 * @param damageAmount Amount of damage dealt
 * @param onTriggerDetected Callback when a trigger is detected (for queueing/emitting to client)
 */
export function processDamageReceivedTriggers(
  ctx: GameContext,
  permanent: any,
  damageAmount: number,
  onTriggerDetected: (triggerInfo: DamageTriggerInfo) => void
): void {
  if (!permanent || damageAmount <= 0) return;

  const state = (ctx as any).state;
  const triggerInfo = getDamageReceivedTrigger(permanent, state);
  
  if (!triggerInfo) return;

  const card = permanent.card || {};
  const creatureName = card.name || "Unknown";
  const triggerId = `damage_trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Create trigger info
  const damageTrigger: DamageTriggerInfo = {
    triggerId,
    sourceId: permanent.id,
    sourceName: creatureName,
    controller: permanent.controller,
    damageAmount,
    triggerType: 'dealt_damage',
    targetType: triggerInfo.targetType as any,
    targetRestriction: triggerInfo.targetRestriction,
    effect: triggerInfo.effect,
  };

  // Call the callback to handle queueing and client notification
  onTriggerDetected(damageTrigger);
}

/**
 * Resolve a damage trigger by dealing damage to the selected target(s).
 * Called when player selects a target for the damage trigger.
 * 
 * @param ctx Game context
 * @param triggerInfo The trigger information
 * @param targetId The selected target (player ID, permanent ID, or null for "each opponent")
 * @returns Chat message describing what happened
 */
export function resolveDamageTrigger(
  ctx: GameContext,
  triggerInfo: DamageTriggerInfo,
  targetId?: string
): string {
  const state = (ctx as any).state;
  const life = state.life || {};
  
  // Handle "each opponent" targeting
  if (triggerInfo.targetType === 'each_opponent') {
    const controller = triggerInfo.controller;
    const opponents = Object.keys(life).filter(pid => pid !== controller);
    
    for (const opponentId of opponents) {
      life[opponentId] = (life[opponentId] || 40) - triggerInfo.damageAmount;
    }
    
    return `${triggerInfo.sourceName} dealt ${triggerInfo.damageAmount} damage to each opponent.`;
  }
  
  // Handle single target
  if (!targetId) {
    return `${triggerInfo.sourceName} trigger failed - no target selected.`;
  }
  
  // Check if target is a player
  if (life.hasOwnProperty(targetId)) {
    life[targetId] = (life[targetId] || 40) - triggerInfo.damageAmount;
    return `${triggerInfo.sourceName} dealt ${triggerInfo.damageAmount} damage to player.`;
  }
  
  // Check if target is a permanent (planeswalker, creature, etc.)
  const targetPerm = state.battlefield?.find((p: any) => p.id === targetId);
  if (targetPerm) {
    // Mark damage on the permanent
    targetPerm.damageMarked = (targetPerm.damageMarked || 0) + triggerInfo.damageAmount;
    
    const targetName = targetPerm.card?.name || "target";
    return `${triggerInfo.sourceName} dealt ${triggerInfo.damageAmount} damage to ${targetName}.`;
  }
  
  return `${triggerInfo.sourceName} dealt ${triggerInfo.damageAmount} damage.`;
}
