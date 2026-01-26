/**
 * triggers/crystal-abilities.ts
 * 
 * Final Fantasy Crystal artifact activated abilities.
 * Each Crystal has a tap ability that costs {4}{C}{C} where C is the crystal's color.
 * 
 * The Wind Crystal (White):
 *   {4}{W}{W}, {T}: Creatures you control gain flying and lifelink until end of turn.
 * 
 * The Fire Crystal (Red):
 *   {4}{R}{R}, {T}: Create a token that's a copy of target creature you control. 
 *   Sacrifice it at the beginning of the next end step.
 * 
 * The Water Crystal (Blue):
 *   {4}{U}{U}, {T}: Each opponent mills cards equal to the number of cards in your hand.
 * 
 * The Earth Crystal (Green):
 *   {4}{G}{G}, {T}: Distribute two +1/+1 counters among one or two target creatures you control.
 * 
 * The Darkness Crystal (Black):
 *   {4}{B}{B}, {T}: Put target creature card exiled with The Darkness Crystal onto the 
 *   battlefield tapped under your control with two additional +1/+1 counters on it.
 */

import type { GameContext } from "../../context.js";
import { recordCardPutIntoGraveyardThisTurn } from "../turn-tracking.js";

/**
 * Crystal ability definition
 */
export interface CrystalAbility {
  name: string;
  manaCost: string;
  requiresTap: boolean;
  requiresTarget: boolean;
  targetType?: 'creature_you_control' | 'creatures_you_control' | 'player' | 'any_creature' | 'exiled_creature';
  effect: string;
  effectType: 'grant_abilities' | 'create_token_copy' | 'mill' | 'distribute_counters' | 'return_from_exile';
}

/**
 * Crystal ability definitions
 */
export const CRYSTAL_ABILITIES: Record<string, CrystalAbility> = {
  'the wind crystal': {
    name: 'The Wind Crystal',
    manaCost: '{4}{W}{W}',
    requiresTap: true,
    requiresTarget: false,
    effect: 'Creatures you control gain flying and lifelink until end of turn.',
    effectType: 'grant_abilities',
  },
  'the fire crystal': {
    name: 'The Fire Crystal',
    manaCost: '{4}{R}{R}',
    requiresTap: true,
    requiresTarget: true,
    targetType: 'creature_you_control',
    effect: 'Create a token that\'s a copy of target creature you control. Sacrifice it at the beginning of the next end step.',
    effectType: 'create_token_copy',
  },
  'the water crystal': {
    name: 'The Water Crystal',
    manaCost: '{4}{U}{U}',
    requiresTap: true,
    requiresTarget: false,  // Affects each opponent, no targeting needed
    effect: 'Each opponent mills cards equal to the number of cards in your hand.',
    effectType: 'mill',
  },
  'the earth crystal': {
    name: 'The Earth Crystal',
    manaCost: '{4}{G}{G}',
    requiresTap: true,
    requiresTarget: true,
    targetType: 'creatures_you_control',  // Can target 1 or 2 creatures
    effect: 'Distribute two +1/+1 counters among one or two target creatures you control.',
    effectType: 'distribute_counters',
  },
  'the darkness crystal': {
    name: 'The Darkness Crystal',
    manaCost: '{4}{B}{B}',
    requiresTap: true,
    requiresTarget: true,
    targetType: 'exiled_creature',  // Targets creature exiled with this Crystal
    effect: 'Put target creature card exiled with The Darkness Crystal onto the battlefield tapped under your control with two additional +1/+1 counters on it.',
    effectType: 'return_from_exile',
  },
};

/**
 * Check if a permanent is a Crystal with an activated ability
 */
export function isCrystalPermanent(cardName: string): boolean {
  const name = cardName.toLowerCase();
  return name in CRYSTAL_ABILITIES;
}

/**
 * Get the Crystal ability for a permanent
 */
export function getCrystalAbility(cardName: string): CrystalAbility | undefined {
  return CRYSTAL_ABILITIES[cardName.toLowerCase()];
}

/**
 * Parse mana cost to check if player can pay
 */
export function parseCrystalManaCost(manaCost: string): { generic: number; white: number; blue: number; black: number; red: number; green: number } {
  const cost = { generic: 0, white: 0, blue: 0, black: 0, red: 0, green: 0 };
  
  // Match generic mana {N}
  const genericMatch = manaCost.match(/\{(\d+)\}/);
  if (genericMatch) {
    cost.generic = parseInt(genericMatch[1], 10);
  }
  
  // Count colored mana - use match and iterate for broader compatibility
  const colorMatches = manaCost.match(/\{[WUBRG]\}/gi) || [];
  for (const match of colorMatches) {
    const color = match.charAt(1).toUpperCase();
    switch (color) {
      case 'W': cost.white++; break;
      case 'U': cost.blue++; break;
      case 'B': cost.black++; break;
      case 'R': cost.red++; break;
      case 'G': cost.green++; break;
    }
  }
  
  return cost;
}

/**
 * Execute The Wind Crystal's ability
 * Creatures you control gain flying and lifelink until end of turn.
 */
export function executeWindCrystalAbility(
  ctx: GameContext,
  controllerId: string
): { success: boolean; affectedCreatures: string[] } {
  const battlefield = ctx.state?.battlefield || [];
  const affectedCreatures: string[] = [];
  
  for (const perm of battlefield) {
    if (!perm || perm.controller !== controllerId) continue;
    const typeLine = ((perm.card as any)?.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) continue;
    
    // Grant flying and lifelink until end of turn
    const grantedAbilities = (perm as any).grantedAbilities || [];
    if (!grantedAbilities.includes('flying')) {
      grantedAbilities.push('flying');
    }
    if (!grantedAbilities.includes('lifelink')) {
      grantedAbilities.push('lifelink');
    }
    (perm as any).grantedAbilities = grantedAbilities;
    
    // Track that these abilities expire at end of turn
    const temporaryEffects = (perm as any).temporaryEffects || [];
    temporaryEffects.push({
      id: `wind_crystal_${Date.now()}`,
      description: 'Flying and lifelink from The Wind Crystal',
      icon: '🌬️',
      expiresAt: 'end_of_turn',
      sourceId: 'the_wind_crystal',
      sourceName: 'The Wind Crystal',
    });
    (perm as any).temporaryEffects = temporaryEffects;
    
    affectedCreatures.push(perm.id);
  }
  
  return { success: true, affectedCreatures };
}

/**
 * Execute The Fire Crystal's ability
 * Create a token that's a copy of target creature you control.
 * Sacrifice it at the beginning of the next end step.
 * Note: Uses delayed trigger that only fires once. Sundial of the Infinite can skip
 * the end step to keep the token permanently.
 */
export function executeFireCrystalAbility(
  ctx: GameContext,
  controllerId: string,
  targetCreatureId: string
): { success: boolean; tokenId?: string; error?: string } {
  const battlefield = ctx.state?.battlefield || [];
  const targetCreature = battlefield.find((p: any) => p.id === targetCreatureId);
  
  if (!targetCreature) {
    return { success: false, error: 'Target creature not found' };
  }
  
  if (targetCreature.controller !== controllerId) {
    return { success: false, error: 'Can only target creatures you control' };
  }
  
  const typeLine = ((targetCreature.card as any)?.type_line || '').toLowerCase();
  if (!typeLine.includes('creature')) {
    return { success: false, error: 'Target must be a creature' };
  }
  
  // Create token copy with delayed sacrifice trigger
  // At the beginning of the next end step, a trigger goes on the stack to sacrifice this token
  // If Sundial of the Infinite exiles the stack during the end step, the trigger is removed
  // and the token survives permanently (the delayed trigger only fires once)
  const tokenId = `token_fire_crystal_${Date.now()}`;
  const tokenCopy = {
    id: tokenId,
    controller: controllerId,
    owner: controllerId,
    isToken: true,
    // Delayed trigger: At the beginning of the next end step, sacrifice this token
    // This creates a triggered ability that goes on the stack at beginning of end step
    // Once it triggers (goes on stack), this flag is cleared - if the trigger is countered/exiled,
    // the token survives because the trigger only fires once
    hasDelayedSacrificeTrigger: true,
    delayedTriggerType: 'sacrifice_at_next_end_step',
    card: {
      ...(targetCreature.card as any),
      id: tokenId,
      name: `${(targetCreature.card as any)?.name || 'Creature'} (Fire Crystal Copy)`,
    },
    basePower: (targetCreature as any).basePower,
    baseToughness: (targetCreature as any).baseToughness,
    counters: { ...((targetCreature as any).counters || {}) },
    grantedAbilities: [...((targetCreature as any).grantedAbilities || [])],
    temporaryEffects: [{
      id: `fire_crystal_sacrifice_${Date.now()}`,
      description: 'At beginning of next end step, sacrifice this creature (Sundial of the Infinite can exile the trigger from the stack)',
      icon: '🔥',
      expiresAt: 'next_end_step',
      sourceId: 'the_fire_crystal',
      sourceName: 'The Fire Crystal',
    }],
  };
  
  battlefield.push(tokenCopy as any);
  
  return { success: true, tokenId };
}

/**
 * Execute The Water Crystal's ability
 * Each opponent mills cards equal to the number of cards in your hand.
 */
export function executeWaterCrystalAbility(
  ctx: GameContext,
  controllerId: string
): { success: boolean; results: Array<{ playerId: string; milledCount: number }>; error?: string } {
  const zones = (ctx as any).zones || {};
  const controllerZone = zones[controllerId];
  const players = (ctx.state as any)?.players || [];
  
  if (!controllerZone) {
    return { success: false, results: [], error: 'Controller zone not found' };
  }
  
  const handCount = controllerZone.handCount || (controllerZone.hand?.length || 0);
  const results: Array<{ playerId: string; milledCount: number }> = [];
  
  // Mill each opponent
  for (const player of players) {
    const playerId = (player as any).id;
    
    // Skip the controller (not an opponent)
    if (playerId === controllerId) continue;
    
    const targetZone = zones[playerId];
    if (!targetZone) continue;
    
    const library = targetZone.library || [];
    const graveyard = targetZone.graveyard || [];
    
    const cardsToMill = Math.min(handCount, library.length);
    const milledCards = library.splice(0, cardsToMill);
    graveyard.push(...milledCards);

    for (const card of milledCards) {
      recordCardPutIntoGraveyardThisTurn(ctx, String(playerId), card, { fromBattlefield: false });
    }
    
    results.push({ playerId, milledCount: cardsToMill });
  }
  
  return { success: true, results };
}

/**
 * Execute The Earth Crystal's ability
 * Distribute two +1/+1 counters among one or two target creatures you control.
 * 
 * @param targetCreatureIds - Array of 1 or 2 creature IDs
 * @param distribution - Optional array specifying how many counters each target gets (must sum to 2)
 *                       If not provided, counters are distributed evenly (or 2 to single target)
 */
export function executeEarthCrystalAbility(
  ctx: GameContext,
  controllerId: string,
  targetCreatureIds: string[],
  distribution?: number[]
): { success: boolean; results?: Array<{ creatureId: string; countersAdded: number }>; error?: string } {
  const battlefield = ctx.state?.battlefield || [];
  
  if (!targetCreatureIds || targetCreatureIds.length === 0) {
    return { success: false, error: 'Must target at least one creature' };
  }
  
  if (targetCreatureIds.length > 2) {
    return { success: false, error: 'Can only target up to two creatures' };
  }
  
  // Validate all targets first
  const targets: any[] = [];
  for (const targetId of targetCreatureIds) {
    const targetCreature = battlefield.find((p: any) => p.id === targetId);
    
    if (!targetCreature) {
      return { success: false, error: 'Target creature not found' };
    }
    
    if (targetCreature.controller !== controllerId) {
      return { success: false, error: 'Can only target creatures you control' };
    }
    
    const typeLine = ((targetCreature.card as any)?.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) {
      return { success: false, error: 'Target must be a creature' };
    }
    
    targets.push(targetCreature);
  }
  
  // Determine counter distribution
  let countersToAdd: number[];
  if (distribution && distribution.length === targets.length) {
    // Validate distribution sums to 2
    const total = distribution.reduce((sum, n) => sum + n, 0);
    if (total !== 2) {
      return { success: false, error: 'Must distribute exactly 2 counters' };
    }
    countersToAdd = distribution;
  } else if (targets.length === 1) {
    // Single target gets both counters
    countersToAdd = [2];
  } else {
    // Two targets: 1 counter each by default
    countersToAdd = [1, 1];
  }
  
  // Apply counters
  const results: Array<{ creatureId: string; countersAdded: number }> = [];
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const counters = (target as any).counters || {};
    counters['+1/+1'] = (counters['+1/+1'] || 0) + countersToAdd[i];
    (target as any).counters = counters;
    
    results.push({ creatureId: target.id, countersAdded: countersToAdd[i] });
  }
  
  return { success: true, results };
}

/**
 * Execute The Darkness Crystal's ability
 * Put target creature card exiled with The Darkness Crystal onto the battlefield 
 * tapped under your control with two additional +1/+1 counters on it.
 * 
 * Note: The Darkness Crystal has a static ability that exiles creatures that die while you control it.
 * This activated ability lets you return those exiled creatures.
 */
export function executeDarknessCrystalAbility(
  ctx: GameContext,
  controllerId: string,
  crystalPermanentId: string,
  targetExiledCardId: string
): { success: boolean; creatureName?: string; error?: string } {
  const battlefield = ctx.state?.battlefield || [];
  const state = ctx.state as any;
  
  // Find the Crystal permanent to check its exiled cards
  const crystalPerm = battlefield.find((p: any) => p.id === crystalPermanentId);
  if (!crystalPerm) {
    return { success: false, error: 'The Darkness Crystal not found on battlefield' };
  }
  
  // Get cards exiled with this specific Crystal
  const exiledWithCrystal = (crystalPerm as any).exiledCards || [];
  const targetIdx = exiledWithCrystal.findIndex((c: any) => {
    const cardId = typeof c === 'string' ? c : c?.id;
    return cardId === targetExiledCardId;
  });
  
  if (targetIdx === -1) {
    return { success: false, error: 'Target creature not found among cards exiled with The Darkness Crystal' };
  }
  
  const targetCard = exiledWithCrystal[targetIdx];
  const cardData = typeof targetCard === 'string' ? { id: targetCard } : targetCard;
  const targetTypeLine = (cardData.type_line || '').toLowerCase();
  
  if (!targetTypeLine.includes('creature')) {
    return { success: false, error: 'Target must be a creature card' };
  }
  
  // Remove from exiled cards
  exiledWithCrystal.splice(targetIdx, 1);
  
  // Create the permanent on battlefield - tapped with 2 additional +1/+1 counters
  const newPermanent = {
    id: `perm_${cardData.id}_${Date.now()}`,
    controller: controllerId,
    owner: controllerId,
    tapped: true,  // Enters tapped
    card: cardData,
    counters: {
      '+1/+1': 2,  // Two additional +1/+1 counters
    },
  };
  
  battlefield.push(newPermanent as any);
  
  return { 
    success: true, 
    creatureName: cardData.name || 'Creature'
  };
}

/**
 * Get creatures exiled with a specific Darkness Crystal
 * Used for targeting the activated ability
 */
export function getExiledWithDarknessCrystal(
  ctx: GameContext,
  crystalPermanentId: string
): Array<{ id: string; name: string; typeLine: string }> {
  const battlefield = ctx.state?.battlefield || [];
  const crystalPerm = battlefield.find((p: any) => p.id === crystalPermanentId);
  
  if (!crystalPerm) {
    return [];
  }
  
  const exiledWithCrystal = (crystalPerm as any).exiledCards || [];
  const creatures: Array<{ id: string; name: string; typeLine: string }> = [];
  
  for (const card of exiledWithCrystal) {
    const cardData = typeof card === 'string' ? { id: card } : card;
    const typeLine = (cardData.type_line || '').toLowerCase();
    
    if (typeLine.includes('creature')) {
      creatures.push({
        id: cardData.id,
        name: cardData.name || 'Unknown Creature',
        typeLine: cardData.type_line || 'Creature',
      });
    }
  }
  
  return creatures;
}

/**
 * Check if a Crystal ability can be activated
 */
export function canActivateCrystalAbility(
  ctx: GameContext,
  permanentId: string,
  controllerId: string
): { canActivate: boolean; reason?: string } {
  const battlefield = ctx.state?.battlefield || [];
  const perm = battlefield.find((p: any) => p.id === permanentId);
  
  if (!perm) {
    return { canActivate: false, reason: 'Permanent not found' };
  }
  
  if (perm.controller !== controllerId) {
    return { canActivate: false, reason: 'You do not control this permanent' };
  }
  
  const cardName = ((perm.card as any)?.name || '').toLowerCase();
  const ability = getCrystalAbility(cardName);
  
  if (!ability) {
    return { canActivate: false, reason: 'This permanent does not have a Crystal ability' };
  }
  
  if (ability.requiresTap && (perm as any).tapped) {
    return { canActivate: false, reason: 'Permanent is already tapped' };
  }
  
  // Mana cost would be validated separately during payment
  
  return { canActivate: true };
}

/**
 * Get valid targets for a Crystal ability
 */
export function getValidCrystalTargets(
  ctx: GameContext,
  cardName: string,
  controllerId: string
): string[] {
  const ability = getCrystalAbility(cardName);
  if (!ability || !ability.requiresTarget) {
    return [];
  }
  
  const battlefield = ctx.state?.battlefield || [];
  const players = (ctx.state as any)?.players || [];
  const validTargets: string[] = [];
  
  switch (ability.targetType) {
    case 'creature_you_control':
      for (const perm of battlefield) {
        if (perm.controller !== controllerId) continue;
        const typeLine = ((perm.card as any)?.type_line || '').toLowerCase();
        if (typeLine.includes('creature')) {
          validTargets.push(perm.id);
        }
      }
      break;
      
    case 'player':
      for (const player of players) {
        validTargets.push((player as any).id);
      }
      break;
      
    case 'any_creature':
      for (const perm of battlefield) {
        const typeLine = ((perm.card as any)?.type_line || '').toLowerCase();
        if (typeLine.includes('creature')) {
          validTargets.push(perm.id);
        }
      }
      break;
  }
  
  return validTargets;
}
