// Origin parent: server/src/state/modules/game-state-effects.ts
// Cluster moved: AbilityStateCondition plus metalcraft / threshold / delirium /
// spell mastery / ferocious / formidable / coven checkers and getActiveAbilityConditions.
// Public entry symbols: AbilityStateCondition, hasMetalcraft, countArtifacts,
// hasThreshold, getGraveyardCount, hasDelirium, countCardTypesInGraveyard,
// hasSpellMastery, hasFerocious, hasFormidable, getTotalCreaturePower, hasCoven,
// getActiveAbilityConditions.
// Leaf must not import game-state-effects.ts or game-state-effects-handlers/index.ts.

import type { GameContext } from "../../context.js";
import { getActiveControlledPermanents } from "./gameStateEffectsBattlefieldQueries.js";

// =============================================================================
// ABILITY STATE CONDITIONS
// =============================================================================
// These are non-consumed conditions that enable abilities when met.
// They are checked but not spent - similar to threshold, metalcraft, delirium, etc.

/**
 * Interface for ability state conditions
 */
export interface AbilityStateCondition {
  readonly name: string;
  readonly description: string;
  readonly checkFunction: (ctx: GameContext, playerId: string) => boolean;
  readonly getValue?: (ctx: GameContext, playerId: string) => number;
}

/**
 * Check if metalcraft is active for a player (controls 3+ artifacts).
 * Rule 702.80 - Metalcraft abilities only function if controller has 3+ artifacts.
 * 
 * Examples:
 * - Mox Opal: Only taps for mana if metalcraft active
 * - Dispatch: Exiles instead of taps if metalcraft active
 * - Puresteel Paladin: Equip costs {0} if metalcraft active
 * - Galvanic Blast: Deals 5 damage instead of 2 if metalcraft active
 */
export function hasMetalcraft(ctx: GameContext, playerId: string): boolean {
  const artifactCount = countArtifacts(ctx, playerId);
  return artifactCount >= 3;
}

/**
 * Count artifacts a player controls (excluding phased out)
 */
export function countArtifacts(ctx: GameContext, playerId: string): number {
  const permanents = getActiveControlledPermanents(ctx, playerId);
  return permanents.filter((p: any) => 
    (p.card?.type_line || "").toLowerCase().includes("artifact")
  ).length;
}

/**
 * Check if threshold is active for a player (7+ cards in graveyard).
 * Rule 702.41 - Threshold abilities only function if controller has 7+ cards in graveyard.
 * 
 * Examples:
 * - Werebear: Gets +3/+3 if threshold active
 * - Cabal Ritual: Adds {B}{B}{B}{B}{B} instead of {B}{B}{B} if threshold active
 */
export function hasThreshold(ctx: GameContext, playerId: string): boolean {
  const graveyardCount = getGraveyardCount(ctx, playerId);
  return graveyardCount >= 7;
}

/**
 * Get the number of cards in a player's graveyard
 */
export function getGraveyardCount(ctx: GameContext, playerId: string): number {
  const zones = (ctx as any).state?.zones?.[playerId];
  if (!zones) return 0;
  return (zones.graveyard || []).length;
}

/**
 * Check if delirium is active for a player (4+ card types in graveyard).
 * Rule 702.115 - Delirium abilities only function if controller has 4+ card types in graveyard.
 * 
 * Examples:
 * - Traverse the Ulvenwald: Can search for creature/land instead of just basic land
 * - Ishkanah, Grafwidow: Can use ability, spiders get reach
 */
export function hasDelirium(ctx: GameContext, playerId: string): boolean {
  const cardTypesInGraveyard = countCardTypesInGraveyard(ctx, playerId);
  return cardTypesInGraveyard >= 4;
}

/**
 * Count unique card types in a player's graveyard
 * Card types: artifact, battle, creature, enchantment, instant, kindred, land, planeswalker, sorcery
 */
export function countCardTypesInGraveyard(ctx: GameContext, playerId: string): number {
  const zones = (ctx as any).state?.zones?.[playerId];
  if (!zones || !zones.graveyard) return 0;
  
  const cardTypes = new Set<string>();
  const typeKeywords = ['artifact', 'battle', 'creature', 'enchantment', 'instant', 'kindred', 'land', 'planeswalker', 'sorcery'];
  
  for (const card of zones.graveyard) {
    const typeLine = (card?.type_line || '').toLowerCase();
    for (const type of typeKeywords) {
      if (typeLine.includes(type)) {
        cardTypes.add(type);
      }
    }
    if (typeLine.includes('tribal')) {
      cardTypes.add('kindred');
    }
  }
  
  return cardTypes.size;
}

/**
 * Check if a player has spell mastery (2+ instant/sorcery cards in graveyard).
 * Spell mastery abilities only function if controller has 2+ instant/sorcery in graveyard.
 * 
 * Examples:
 * - Fiery Impulse: Deals 3 damage instead of 2
 * - Exquisite Firecraft: Can't be countered
 */
export function hasSpellMastery(ctx: GameContext, playerId: string): boolean {
  const zones = (ctx as any).state?.zones?.[playerId];
  if (!zones || !zones.graveyard) return false;
  
  let instantSorceryCount = 0;
  for (const card of zones.graveyard) {
    const typeLine = (card?.type_line || '').toLowerCase();
    if (typeLine.includes('instant') || typeLine.includes('sorcery')) {
      instantSorceryCount++;
      if (instantSorceryCount >= 2) return true;
    }
  }
  
  return false;
}

/**
 * Check if a player has ferocious (controls creature with power 4+).
 * Ferocious abilities only function if controller has a creature with power 4+.
 * 
 * Examples:
 * - Crater's Claws: Deals X+2 damage instead of X
 * - Stubborn Denial: Becomes hard counter
 */
export function hasFerocious(ctx: GameContext, playerId: string): boolean {
  const permanents = getActiveControlledPermanents(ctx, playerId);
  
  for (const perm of permanents) {
    const typeLine = (perm.card?.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) continue;
    
    const power = parseInt(perm.card?.power || '0', 10) || 0;
    // TODO: Add counter modifications to power calculation
    const counterBonus = (perm.counters?.['+1/+1'] || 0) - (perm.counters?.['-1/-1'] || 0);
    
    if (power + counterBonus >= 4) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if formidable is active (creatures with total power 8+).
 * Formidable abilities only function if controller's creatures have total power 8+.
 */
export function hasFormidable(ctx: GameContext, playerId: string): boolean {
  const totalPower = getTotalCreaturePower(ctx, playerId);
  return totalPower >= 8;
}

/**
 * Get total power of all creatures a player controls
 */
export function getTotalCreaturePower(ctx: GameContext, playerId: string): number {
  const permanents = getActiveControlledPermanents(ctx, playerId);
  let totalPower = 0;
  
  for (const perm of permanents) {
    const typeLine = (perm.card?.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) continue;
    
    const basePower = parseInt(perm.card?.power || '0', 10) || 0;
    const counterBonus = (perm.counters?.['+1/+1'] || 0) - (perm.counters?.['-1/-1'] || 0);
    totalPower += basePower + counterBonus;
  }
  
  return totalPower;
}

/**
 * Check if coven is active for a player (controls 3+ creatures with different powers).
 * Coven abilities only function if controller has 3+ creatures with different powers.
 * 
 * Examples:
 * - Augur of Autumn: Can cast creature spells from top of library if coven active
 * - Sigarda's Summons: Gives creatures +1/+1 and flying if coven active
 */
export function hasCoven(ctx: GameContext, playerId: string): boolean {
  const permanents = getActiveControlledPermanents(ctx, playerId);
  const uniquePowers = new Set<number>();
  
  for (const perm of permanents) {
    const typeLine = (perm.card?.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) continue;
    
    const basePower = parseInt(perm.card?.power || '0', 10) || 0;
    const counterBonus = (perm.counters?.['+1/+1'] || 0) - (perm.counters?.['-1/-1'] || 0);
    const effectivePower = basePower + counterBonus;
    
    uniquePowers.add(effectivePower);
    
    // Early exit if we already have 3 different powers
    if (uniquePowers.size >= 3) {
      return true;
    }
  }
  
  return uniquePowers.size >= 3;
}

/**
 * Check all ability state conditions for a player and return active ones
 */
export function getActiveAbilityConditions(ctx: GameContext, playerId: string): Record<string, boolean> {
  return {
    metalcraft: hasMetalcraft(ctx, playerId),
    threshold: hasThreshold(ctx, playerId),
    delirium: hasDelirium(ctx, playerId),
    spellMastery: hasSpellMastery(ctx, playerId),
    ferocious: hasFerocious(ctx, playerId),
    formidable: hasFormidable(ctx, playerId),
    coven: hasCoven(ctx, playerId),
  };
}
