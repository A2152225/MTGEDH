/**
 * triggers/lifegain.ts
 * 
 * Lifegain triggered abilities.
 * Handles "whenever you gain life" triggers like:
 * - Ratchet, Field Medic (Transformers): Convert and return artifact from graveyard
 * - Ajani's Pridemate: Gain +1/+1 counter
 * - Heliod, Sun-Crowned: Put +1/+1 counter on creature or enchantment
 * - Well of Lost Dreams: Pay X to draw X cards
 * - Dawn of Hope: Pay 2 to create 1/1 Soldier token
 * - Archangel of Thune: Put +1/+1 counter on each creature you control
 * - Resplendent Angel: Create 4/4 Angel token if you gained 5+ life this turn
 * - Nykthos Paragon: Put +1/+1 counter on each creature you control (once per turn)
 * - Voice of the Blessed: Gain +1/+1 counter
 * - Trelasarra, Moon Dancer: Gain +1/+1 counter and scry 1
 */

import type { GameContext } from "../../context.js";

/**
 * Helper to extract card ID from various card formats in zones
 */
function extractCardId(card: unknown): string {
  if (typeof card === 'string') return card;
  if (card && typeof card === 'object' && 'id' in card) {
    return (card as { id: string }).id;
  }
  return '';
}

/**
 * Helper to extract card data from various formats
 */
function extractCardData(card: unknown): { id: string; name?: string; type_line?: string; cmc?: number } {
  if (typeof card === 'string') return { id: card };
  if (card && typeof card === 'object') {
    return card as { id: string; name?: string; type_line?: string; cmc?: number };
  }
  return { id: '' };
}

/**
 * Lifegain trigger definition
 */
export interface LifegainTrigger {
  permanentId: string;
  cardName: string;
  controllerId: string;
  effect: string;
  effectType: LifegainEffectType;
  isMayAbility: boolean;
  /** For Ratchet: max artifact MV that can be returned */
  maxArtifactMV?: number;
  /** For cards like Resplendent Angel: minimum life gained this turn */
  requiresMinLifeGained?: number;
  /** For cards that only trigger once per turn */
  oncePerTurn?: boolean;
}

/**
 * Type of effect from lifegain trigger
 */
export type LifegainEffectType = 
  | 'add_counter'           // Ajani's Pridemate, Voice of the Blessed
  | 'add_counter_all'       // Archangel of Thune
  | 'draw_cards'            // Well of Lost Dreams
  | 'create_token'          // Dawn of Hope, Resplendent Angel
  | 'convert_and_return'    // Ratchet, Field Medic
  | 'scry'                  // Trelasarra
  | 'custom';

/**
 * Known cards with lifegain triggers
 */
export const KNOWN_LIFEGAIN_TRIGGERS: Record<string, {
  effect: string;
  effectType: LifegainEffectType;
  isMayAbility: boolean;
  oncePerTurn?: boolean;
  requiresMinLifeGained?: number;
  maxArtifactMV?: number;
}> = {
  // Counter gainers
  "ajani's pridemate": {
    effect: 'Put a +1/+1 counter on Ajani\'s Pridemate',
    effectType: 'add_counter',
    isMayAbility: false,
  },
  "voice of the blessed": {
    effect: 'Put a +1/+1 counter on Voice of the Blessed',
    effectType: 'add_counter',
    isMayAbility: false,
  },
  "trelasarra, moon dancer": {
    effect: 'Put a +1/+1 counter on Trelasarra, scry 1',
    effectType: 'add_counter',
    isMayAbility: false,
  },
  "heliod, sun-crowned": {
    effect: 'Put a +1/+1 counter on target creature or enchantment you control',
    effectType: 'add_counter',
    isMayAbility: false,
  },
  "archangel of thune": {
    effect: 'Put a +1/+1 counter on each creature you control',
    effectType: 'add_counter_all',
    isMayAbility: false,
  },
  "nykthos paragon": {
    effect: 'Put +1/+1 counters equal to life gained on each creature you control',
    effectType: 'add_counter_all',
    isMayAbility: false,
    oncePerTurn: true,
  },
  // MJ, Rising Star - same as Ajani's Pridemate
  "mj, rising star": {
    effect: 'Put a +1/+1 counter on MJ, Rising Star',
    effectType: 'add_counter',
    isMayAbility: false,
  },
  // Bloodbond Vampire
  "bloodbond vampire": {
    effect: 'Put a +1/+1 counter on Bloodbond Vampire',
    effectType: 'add_counter',
    isMayAbility: false,
  },
  // Gideon's Company
  "gideon's company": {
    effect: 'Put two +1/+1 counters on Gideon\'s Company',
    effectType: 'add_counter',
    isMayAbility: false,
  },
  // Cradle of Vitality
  "cradle of vitality": {
    effect: 'You may pay {1}{W}. If you do, put +1/+1 counters equal to life gained on target creature',
    effectType: 'add_counter',
    isMayAbility: true,
  },
  // Celestial Unicorn
  "celestial unicorn": {
    effect: 'Put a +1/+1 counter on Celestial Unicorn',
    effectType: 'add_counter',
    isMayAbility: false,
  },
  // Aerith Gainsborough (Custom card)
  "aerith gainsborough": {
    effect: 'Put a +1/+1 counter on Aerith Gainsborough',
    effectType: 'add_counter',
    isMayAbility: false,
  },
  // Epicure of Blood (damage, not counters)
  "epicure of blood": {
    effect: 'Each opponent loses 1 life',
    effectType: 'custom',
    isMayAbility: false,
  },
  // Marauding Blight-Priest
  "marauding blight-priest": {
    effect: 'Each opponent loses 1 life',
    effectType: 'custom',
    isMayAbility: false,
  },
  // Vito, Thorn of the Dusk Rose
  "vito, thorn of the dusk rose": {
    effect: 'Target opponent loses that much life',
    effectType: 'custom',
    isMayAbility: false,
  },
  // Sanguine Bond (enchantment, same effect as Vito)
  "sanguine bond": {
    effect: 'Target opponent loses that much life',
    effectType: 'custom',
    isMayAbility: false,
  },
  
  // Token creators
  "dawn of hope": {
    effect: 'Pay {2} to create a 1/1 white Soldier creature token with lifelink',
    effectType: 'create_token',
    isMayAbility: true,
  },
  "resplendent angel": {
    effect: 'Create a 4/4 white Angel creature token with flying and vigilance',
    effectType: 'create_token',
    isMayAbility: false,
    requiresMinLifeGained: 5,
  },
  "valkyrie harbinger": {
    effect: 'Create a 4/4 white Angel creature token with flying and vigilance',
    effectType: 'create_token',
    isMayAbility: false,
    requiresMinLifeGained: 4,
  },
  
  // Card draw
  "well of lost dreams": {
    effect: 'Pay X to draw X cards, where X is the life gained',
    effectType: 'draw_cards',
    isMayAbility: true,
  },
  "alhammarret's archive": {
    effect: 'If you would gain life, you gain twice that much life instead (replacement)',
    effectType: 'custom',
    isMayAbility: false,
  },
  // Cat Collector - "for the first time during each of your turns" trigger
  "cat collector": {
    effect: 'Create a 1/1 white Cat creature token',
    effectType: 'create_token',
    isMayAbility: false,
    oncePerTurn: true,  // First time each turn
  },
  
  // Ratchet, Field Medic (Transformers)
  "ratchet, field medic": {
    effect: 'You may convert Ratchet. When you do, return target artifact card with MV ≤ life gained this turn from graveyard to battlefield tapped.',
    effectType: 'convert_and_return',
    isMayAbility: true,
  },
  
  // Other lifegain matters
  "cleric class": {
    effect: 'Level 2: Put a +1/+1 counter on target creature you control',
    effectType: 'add_counter',
    isMayAbility: false,
  },
  "griffin aerie": {
    effect: 'Create a 2/2 white Griffin creature token with flying (at end step if gained 3+ life)',
    effectType: 'create_token',
    isMayAbility: false,
    requiresMinLifeGained: 3,
  },
  "lathiel, the bounteous dawn": {
    effect: 'Distribute +1/+1 counters equal to life gained among creatures you control',
    effectType: 'add_counter_all',
    isMayAbility: true,
    oncePerTurn: true,
  },
};

/**
 * Detect lifegain triggers on the battlefield.
 * 
 * DYNAMIC-FIRST PATTERN: Uses regex-based oracle text parsing as the primary
 * detection mechanism. The KNOWN_LIFEGAIN_TRIGGERS table serves as an
 * optimization cache that provides additional metadata (effect type, etc.).
 * 
 * Patterns detected:
 * - "Whenever you gain life, [effect]"
 * - "Whenever you gain life for the first time, [effect]"
 * - Counter-based, token creation, card draw, and special effects
 */
export function detectLifegainTriggers(
  ctx: GameContext,
  playerId: string,
  lifeGained: number
): LifegainTrigger[] {
  const triggers: LifegainTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  const state = ctx.state as any;
  
  // Track life gained this turn for threshold checks
  if (!state.lifeGainedThisTurn) {
    state.lifeGainedThisTurn = {};
  }
  state.lifeGainedThisTurn[playerId] = (state.lifeGainedThisTurn[playerId] || 0) + lifeGained;
  const totalLifeGainedThisTurn = state.lifeGainedThisTurn[playerId];
  
  // Track triggers that fired this turn (for once-per-turn effects)
  if (!state.lifegainTriggersFiredThisTurn) {
    state.lifegainTriggersFiredThisTurn = {};
  }
  
  for (const perm of battlefield) {
    if (!perm || perm.controller !== playerId) continue;
    
    const cardName = ((perm.card as any)?.name || '').toLowerCase();
    const oracleText = ((perm.card as any)?.oracle_text || '').toLowerCase();
    
    // ===== DYNAMIC DETECTION (Primary) =====
    // Handle both "whenever you gain life" and "for the first time" patterns
    const hasStandardLifegainTrigger = oracleText.includes('whenever you gain life');
    const hasFirstTimeLifegainTrigger = /whenever you gain life.*for the first time|for the first time.*you gain life/i.test(oracleText);
    const hasLifegainTrigger = hasStandardLifegainTrigger || hasFirstTimeLifegainTrigger;
    
    if (hasLifegainTrigger) {
      // Check if this is a "first time" trigger (once per turn)
      const isFirstTimeTrigger = hasFirstTimeLifegainTrigger;
      
      // Check once-per-turn restriction
      if (isFirstTimeTrigger) {
        const triggerId = `${cardName}_${perm.id}`;
        if (state.lifegainTriggersFiredThisTurn[triggerId]) {
          continue;
        }
      }
      
      // Detect effect type from oracle text
      let effectType: LifegainEffectType = 'custom';
      let isMayAbility = oracleText.includes('you may');
      let effect = 'Triggered by lifegain';
      
      // Extract the effect text
      const effectMatch = oracleText.match(/whenever you gain life[^,]*,?\s*([^.]+)/i);
      if (effectMatch) {
        effect = effectMatch[1].trim();
      }
      
      // Determine effect type
      if (oracleText.includes('+1/+1 counter')) {
        if (oracleText.includes('each creature')) {
          effectType = 'add_counter_all';
        } else {
          effectType = 'add_counter';
        }
      } else if (oracleText.includes('draw') && !oracleText.includes('draws cards')) {
        effectType = 'draw_cards';
      } else if (oracleText.includes('create') && oracleText.includes('token')) {
        effectType = 'create_token';
      } else if (oracleText.includes('convert')) {
        effectType = 'convert_and_return';
      } else if (oracleText.includes('scry')) {
        effectType = 'scry';
      } else if (oracleText.includes('loses') && oracleText.includes('life')) {
        // Cards like Vito, Sanguine Bond, Epicure of Blood
        effectType = 'custom';
      }
      
      triggers.push({
        permanentId: perm.id,
        cardName: (perm.card as any)?.name || 'Unknown',
        controllerId: playerId,
        effect,
        effectType,
        isMayAbility,
        oncePerTurn: isFirstTimeTrigger,
        maxArtifactMV: effectType === 'convert_and_return' ? totalLifeGainedThisTurn : undefined,
      });
      
      continue;
    }
    
    // ===== KNOWN CARDS TABLE (Optimization/Enhancement) =====
    // Use the table to handle special cases and provide enhanced metadata
    // Only process if not already detected dynamically
    const knownTrigger = KNOWN_LIFEGAIN_TRIGGERS[cardName];
    if (knownTrigger) {
      // Check once-per-turn restriction
      if (knownTrigger.oncePerTurn) {
        const triggerId = `${cardName}_${perm.id}`;
        if (state.lifegainTriggersFiredThisTurn[triggerId]) {
          continue;
        }
      }
      
      // Check minimum life gained threshold (only for end-step triggers)
      if (knownTrigger.requiresMinLifeGained) {
        // Skip threshold triggers for now - they're checked at end step
        continue;
      }
      
      triggers.push({
        permanentId: perm.id,
        cardName: (perm.card as any)?.name || cardName,
        controllerId: playerId,
        effect: knownTrigger.effect,
        effectType: knownTrigger.effectType,
        isMayAbility: knownTrigger.isMayAbility,
        oncePerTurn: knownTrigger.oncePerTurn,
        maxArtifactMV: knownTrigger.effectType === 'convert_and_return' ? totalLifeGainedThisTurn : undefined,
      });
    }
  }
  
  return triggers;
}

/**
 * Execute a lifegain trigger effect
 */
export function executeLifegainTrigger(
  ctx: GameContext,
  trigger: LifegainTrigger,
  lifeGained: number,
  targetId?: string
): { success: boolean; message: string } {
  const battlefield = ctx.state?.battlefield || [];
  const perm = battlefield.find((p: any) => p.id === trigger.permanentId);
  const state = ctx.state as any;
  
  if (!perm) {
    return { success: false, message: 'Source permanent no longer exists' };
  }
  
  // Mark once-per-turn triggers as fired
  if (trigger.oncePerTurn) {
    const triggerId = `${trigger.cardName.toLowerCase()}_${perm.id}`;
    if (!state.lifegainTriggersFiredThisTurn) {
      state.lifegainTriggersFiredThisTurn = {};
    }
    state.lifegainTriggersFiredThisTurn[triggerId] = true;
  }
  
  switch (trigger.effectType) {
    case 'add_counter':
      // Add +1/+1 counter to the permanent itself (or target)
      const counterTarget = targetId 
        ? battlefield.find((p: any) => p.id === targetId)
        : perm;
        
      if (counterTarget) {
        const counters = (counterTarget as any).counters || {};
        counters['+1/+1'] = (counters['+1/+1'] || 0) + 1;
        (counterTarget as any).counters = counters;
        return { success: true, message: `Put a +1/+1 counter on ${(counterTarget.card as any)?.name}` };
      }
      return { success: false, message: 'Target not found' };
      
    case 'add_counter_all':
      // Add +1/+1 counter to all creatures you control
      let count = 0;
      for (const p of battlefield) {
        if (p.controller !== trigger.controllerId) continue;
        const typeLine = ((p.card as any)?.type_line || '').toLowerCase();
        if (!typeLine.includes('creature')) continue;
        
        const counters = (p as any).counters || {};
        counters['+1/+1'] = (counters['+1/+1'] || 0) + 1;
        (p as any).counters = counters;
        count++;
      }
      return { success: true, message: `Put +1/+1 counters on ${count} creatures` };
      
    case 'convert_and_return':
      // Ratchet, Field Medic specific logic
      // This would trigger a convert (transform) and then allow returning an artifact
      return executeRatchetTrigger(ctx, trigger, lifeGained, targetId);
      
    case 'create_token':
    case 'draw_cards':
    case 'scry':
    case 'custom':
    default:
      // These require additional UI prompts - return success to signal trigger fired
      return { success: true, message: `${trigger.cardName} trigger needs resolution` };
  }
}

/**
 * Execute Ratchet, Field Medic's lifegain trigger
 * "Whenever you gain life, you may convert Ratchet. When you do, return target 
 * artifact card with mana value less than or equal to the amount of life you 
 * gained this turn from your graveyard to the battlefield tapped."
 */
export function executeRatchetTrigger(
  ctx: GameContext,
  trigger: LifegainTrigger,
  lifeGained: number,
  targetArtifactId?: string
): { success: boolean; message: string } {
  const battlefield = ctx.state?.battlefield || [];
  const zones = (ctx as any).zones || {};
  const playerZone = zones[trigger.controllerId];
  const state = ctx.state as any;
  
  // Get total life gained this turn
  const totalLifeGainedThisTurn = state.lifeGainedThisTurn?.[trigger.controllerId] || lifeGained;
  
  // Find Ratchet on the battlefield
  const ratchet = battlefield.find((p: any) => p.id === trigger.permanentId);
  if (!ratchet) {
    return { success: false, message: 'Ratchet not found on battlefield' };
  }
  
  // Convert (transform) Ratchet
  const card = ratchet.card as any;
  const cardFaces = card?.card_faces;
  if (cardFaces && cardFaces.length >= 2) {
    // Transform to back face
    (ratchet as any).transformed = !(ratchet as any).transformed;
    const newFaceIndex = (ratchet as any).transformed ? 1 : 0;
    const newFace = cardFaces[newFaceIndex];
    
    // Update card properties from new face
    if (newFace) {
      card.name = newFace.name || card.name;
      card.power = newFace.power;
      card.toughness = newFace.toughness;
      card.type_line = newFace.type_line || card.type_line;
      card.oracle_text = newFace.oracle_text || card.oracle_text;
      if (newFace.image_uris) {
        card.image_uris = newFace.image_uris;
      }
    }
  }
  
  // If no target artifact specified, just convert
  if (!targetArtifactId) {
    return { success: true, message: 'Ratchet converted' };
  }
  
  // Find target artifact in graveyard using helper functions
  const graveyard = playerZone?.graveyard || [];
  const targetIdx = graveyard.findIndex((c: unknown) => {
    return extractCardId(c) === targetArtifactId;
  });
  
  if (targetIdx === -1) {
    return { success: false, message: 'Target artifact not found in graveyard' };
  }
  
  const targetCard = graveyard[targetIdx];
  const cardData = extractCardData(targetCard);
  const targetTypeLine = (cardData.type_line || '').toLowerCase();
  
  if (!targetTypeLine.includes('artifact')) {
    return { success: false, message: 'Target must be an artifact' };
  }
  
  // Check mana value
  const targetMV = cardData.cmc || 0;
  if (targetMV > totalLifeGainedThisTurn) {
    return { 
      success: false, 
      message: `Artifact MV (${targetMV}) exceeds life gained this turn (${totalLifeGainedThisTurn})` 
    };
  }
  
  // Move artifact from graveyard to battlefield tapped
  graveyard.splice(targetIdx, 1);
  
  const newPermanent = {
    id: `perm_${cardData.id}_${Date.now()}`,
    controller: trigger.controllerId,
    owner: trigger.controllerId,
    tapped: true,
    card: cardData,
    counters: {},
  };
  
  battlefield.push(newPermanent as any);
  
  return { 
    success: true, 
    message: `Ratchet converted and returned ${cardData.name || 'artifact'} to the battlefield tapped` 
  };
}

/**
 * Get valid artifact targets in graveyard for Ratchet's ability
 */
export function getValidRatchetTargets(
  ctx: GameContext,
  playerId: string,
  maxMV: number
): { id: string; name: string; manaValue: number }[] {
  const zones = (ctx as any).zones || {};
  const playerZone = zones[playerId];
  const graveyard = playerZone?.graveyard || [];
  const validTargets: { id: string; name: string; manaValue: number }[] = [];
  
  for (const card of graveyard) {
    const cardData = typeof card === 'string' ? { id: card } : card;
    const typeLine = (cardData.type_line || '').toLowerCase();
    
    if (!typeLine.includes('artifact')) continue;
    
    const manaValue = cardData.cmc || 0;
    if (manaValue > maxMV) continue;
    
    validTargets.push({
      id: cardData.id,
      name: cardData.name || 'Unknown Artifact',
      manaValue,
    });
  }
  
  return validTargets;
}

/**
 * Reset lifegain tracking at end of turn
 */
export function resetLifegainTracking(ctx: GameContext): void {
  const state = ctx.state as any;
  state.lifeGainedThisTurn = {};
  state.lifegainTriggersFiredThisTurn = {};
}

/**
 * Check end-of-turn lifegain threshold triggers (Resplendent Angel, Griffin Aerie)
 */
export function checkLifegainThresholdTriggers(
  ctx: GameContext,
  playerId: string
): LifegainTrigger[] {
  const triggers: LifegainTrigger[] = [];
  const battlefield = ctx.state?.battlefield || [];
  const state = ctx.state as any;
  const totalLifeGainedThisTurn = state.lifeGainedThisTurn?.[playerId] || 0;
  
  for (const perm of battlefield) {
    if (!perm || perm.controller !== playerId) continue;
    
    const cardName = ((perm.card as any)?.name || '').toLowerCase();
    const knownTrigger = KNOWN_LIFEGAIN_TRIGGERS[cardName];
    
    if (knownTrigger?.requiresMinLifeGained) {
      if (totalLifeGainedThisTurn >= knownTrigger.requiresMinLifeGained) {
        triggers.push({
          permanentId: perm.id,
          cardName: (perm.card as any)?.name || cardName,
          controllerId: playerId,
          effect: knownTrigger.effect,
          effectType: knownTrigger.effectType,
          isMayAbility: knownTrigger.isMayAbility,
          requiresMinLifeGained: knownTrigger.requiresMinLifeGained,
        });
      }
    }
  }
  
  return triggers;
}
