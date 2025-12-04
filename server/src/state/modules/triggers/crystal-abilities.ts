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
 *   {4}{U}{U}, {T}: Target player mills cards equal to the number of cards in your hand.
 * 
 * The Earth Crystal (Green):
 *   {4}{G}{G}, {T}: Double the number of +1/+1 counters on target creature you control.
 * 
 * The Darkness Crystal (Black):
 *   {4}{B}{B}, {T}: Until end of turn, whenever a creature you control dies, 
 *   each opponent loses 2 life and you gain 2 life.
 */

import type { GameContext } from "../../context.js";

/**
 * Crystal ability definition
 */
export interface CrystalAbility {
  name: string;
  manaCost: string;
  requiresTap: boolean;
  requiresTarget: boolean;
  targetType?: 'creature_you_control' | 'player' | 'any_creature';
  effect: string;
  effectType: 'grant_abilities' | 'create_token_copy' | 'mill' | 'double_counters' | 'setup_trigger';
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
    requiresTarget: true,
    targetType: 'player',
    effect: 'Target player mills cards equal to the number of cards in your hand.',
    effectType: 'mill',
  },
  'the earth crystal': {
    name: 'The Earth Crystal',
    manaCost: '{4}{G}{G}',
    requiresTap: true,
    requiresTarget: true,
    targetType: 'creature_you_control',
    effect: 'Double the number of +1/+1 counters on target creature you control.',
    effectType: 'double_counters',
  },
  'the darkness crystal': {
    name: 'The Darkness Crystal',
    manaCost: '{4}{B}{B}',
    requiresTap: true,
    requiresTarget: false,
    effect: 'Until end of turn, whenever a creature you control dies, each opponent loses 2 life and you gain 2 life.',
    effectType: 'setup_trigger',
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
  
  // Create token copy
  const tokenId = `token_fire_crystal_${Date.now()}`;
  const tokenCopy = {
    id: tokenId,
    controller: controllerId,
    owner: controllerId,
    isToken: true,
    sacrificeAtEndStep: true,
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
      description: 'Will be sacrificed at end of turn',
      icon: '🔥',
      expiresAt: 'end_of_turn',
      sourceId: 'the_fire_crystal',
      sourceName: 'The Fire Crystal',
    }],
  };
  
  battlefield.push(tokenCopy as any);
  
  return { success: true, tokenId };
}

/**
 * Execute The Water Crystal's ability
 * Target player mills cards equal to the number of cards in your hand.
 */
export function executeWaterCrystalAbility(
  ctx: GameContext,
  controllerId: string,
  targetPlayerId: string
): { success: boolean; milledCount: number; error?: string } {
  const zones = (ctx as any).zones || {};
  const controllerZone = zones[controllerId];
  const targetZone = zones[targetPlayerId];
  
  if (!controllerZone || !targetZone) {
    return { success: false, milledCount: 0, error: 'Player zones not found' };
  }
  
  const handCount = controllerZone.handCount || (controllerZone.hand?.length || 0);
  
  // Mill target player
  const library = targetZone.library || [];
  const graveyard = targetZone.graveyard || [];
  
  const cardsToMill = Math.min(handCount, library.length);
  const milledCards = library.splice(0, cardsToMill);
  graveyard.push(...milledCards);
  
  return { success: true, milledCount: cardsToMill };
}

/**
 * Execute The Earth Crystal's ability
 * Double the number of +1/+1 counters on target creature you control.
 */
export function executeEarthCrystalAbility(
  ctx: GameContext,
  controllerId: string,
  targetCreatureId: string
): { success: boolean; newCounterCount?: number; error?: string } {
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
  
  // Double +1/+1 counters
  // Note: Doubling 0 counters still results in 0, which is valid per MTG rules
  // (The Earth Crystal allows targeting a creature without counters, though the effect does nothing)
  const counters = (targetCreature as any).counters || {};
  const currentCounters = counters['+1/+1'] || 0;
  counters['+1/+1'] = currentCounters * 2;
  (targetCreature as any).counters = counters;
  
  return { success: true, newCounterCount: counters['+1/+1'] };
}

/**
 * Execute The Darkness Crystal's ability
 * Until end of turn, whenever a creature you control dies, 
 * each opponent loses 2 life and you gain 2 life.
 */
export function executeDarknessCrystalAbility(
  ctx: GameContext,
  controllerId: string
): { success: boolean } {
  // Set up a temporary trigger that fires when creatures die
  // This is stored in the game state and checked during death trigger processing
  const state = ctx.state as any;
  if (!state.temporaryTriggers) {
    state.temporaryTriggers = [];
  }
  
  state.temporaryTriggers.push({
    id: `darkness_crystal_trigger_${Date.now()}`,
    type: 'creature_death',
    controllerId,
    sourceId: 'the_darkness_crystal',
    sourceName: 'The Darkness Crystal',
    condition: (dying: any) => dying.controller === controllerId,
    effect: 'each_opponent_loses_2_you_gain_2',
    expiresAt: 'end_of_turn',
  });
  
  return { success: true };
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
