/**
 * alternateCosts.ts
 * 
 * Support for alternate casting costs in Magic: The Gathering.
 * Includes Force of Will style "free" spells, Morophon cost reductions,
 * and Fist of Suns / Jodah style alternative costs.
 * 
 * Rules Reference:
 * - Rule 118.9: Alternative costs
 * - Rule 118.8: Additional costs
 * - Rule 118.7: Cost modification
 */

import type { ManaCost } from './types/mana';
import type { PlayerID } from '../../shared/src';

/**
 * Alternate cost types
 */
export enum AlternateCostType {
  // Pay with life + exile card (Force of Will, Fury, etc.)
  PITCH = 'pitch',
  // Pay WUBRG instead of mana cost (Jodah, Fist of Suns)
  WUBRG = 'wubrg',
  // Pay 0 (Omniscience)
  FREE = 'free',
  // Convoke (tap creatures to pay)
  CONVOKE = 'convoke',
  // Delve (exile graveyard cards)
  DELVE = 'delve',
  // Improvise (tap artifacts)
  IMPROVISE = 'improvise',
  // Emerge (sacrifice creature, pay difference)
  EMERGE = 'emerge',
  // Evoke (sacrifice after ETB)
  EVOKE = 'evoke',
  // Dash (haste, return to hand at end of turn)
  DASH = 'dash',
  // Mutate
  MUTATE = 'mutate',
  // Flashback
  FLASHBACK = 'flashback',
  // Escape
  ESCAPE = 'escape',
  // Foretell
  FORETELL = 'foretell',
  // Spectacle
  SPECTACLE = 'spectacle',
  // Prowl
  PROWL = 'prowl',
  // Madness
  MADNESS = 'madness',
  // Miracle
  MIRACLE = 'miracle',
  // Commander alternate (can cast from command zone)
  COMMANDER = 'commander',
  // Custom/Other
  CUSTOM = 'custom',
}

/**
 * Alternate cost definition
 */
export interface AlternateCost {
  readonly type: AlternateCostType;
  readonly name: string;
  readonly description: string;
  readonly manaCost?: ManaCost;
  readonly lifeCost?: number;
  readonly requiresExile?: {
    readonly zone: 'hand' | 'graveyard' | 'battlefield';
    readonly count: number;
    readonly filter?: string; // e.g., "blue card" for Force of Will
  };
  readonly requiresSacrifice?: {
    readonly count: number;
    readonly filter?: string;
  };
  readonly additionalEffects?: readonly string[];
  readonly sourceId?: string;
  readonly sourceName?: string;
}

/**
 * Cost reduction definition (e.g., Morophon)
 */
export interface CostReduction {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly reduction: ManaCost;
  readonly condition?: CostReductionCondition;
  readonly appliesTo: 'spells' | 'creatures' | 'artifacts' | 'enchantments' | 'all';
}

/**
 * Condition for cost reduction
 */
export interface CostReductionCondition {
  readonly type: 'creature_type' | 'color' | 'card_type' | 'name' | 'custom';
  readonly value: string;
}

/**
 * WUBRG cost for Jodah/Fist of Suns
 */
export const WUBRG_COST: ManaCost = {
  white: 1,
  blue: 1,
  black: 1,
  red: 1,
  green: 1,
  generic: 0,
  colorless: 0,
};

/**
 * Morophon's WUBRG reduction
 */
export const MOROPHON_REDUCTION: ManaCost = {
  white: 1,
  blue: 1,
  black: 1,
  red: 1,
  green: 1,
  generic: 0,
  colorless: 0,
};

/**
 * Create Jodah/Fist of Suns alternate cost
 * "You may pay WUBRG rather than pay the mana cost"
 */
export function createJodahCost(sourceName: string, sourceId?: string): AlternateCost {
  return {
    type: AlternateCostType.WUBRG,
    name: 'WUBRG Alternative',
    description: `Pay {W}{U}{B}{R}{G} rather than pay the mana cost (${sourceName})`,
    manaCost: WUBRG_COST,
    sourceName,
    sourceId,
  };
}

/**
 * Create Morophon cost reduction for a chosen creature type
 * "Spells of the chosen type cost {W}{U}{B}{R}{G} less to cast"
 */
export function createMorophonReduction(
  creatureType: string,
  sourceId: string
): CostReduction {
  return {
    id: `morophon-reduction-${creatureType}`,
    sourceId,
    sourceName: 'Morophon, the Boundless',
    reduction: MOROPHON_REDUCTION,
    condition: {
      type: 'creature_type',
      value: creatureType,
    },
    appliesTo: 'creatures',
  };
}

/**
 * Create Force of Will style pitch cost
 * "You may pay 1 life and exile a [color] card from your hand rather than pay this spell's mana cost"
 */
export function createPitchCost(
  cardName: string,
  colorFilter: string,
  lifeCost: number = 1
): AlternateCost {
  return {
    type: AlternateCostType.PITCH,
    name: 'Pitch',
    description: `Pay ${lifeCost} life and exile a ${colorFilter} from your hand`,
    lifeCost,
    requiresExile: {
      zone: 'hand',
      count: 1,
      filter: colorFilter,
    },
    sourceName: cardName,
  };
}

/**
 * Create Evoke cost
 * "You may cast this spell for its evoke cost. If you do, it's sacrificed when it enters the battlefield."
 */
export function createEvokeCost(
  cardName: string,
  evokeCost: ManaCost
): AlternateCost {
  return {
    type: AlternateCostType.EVOKE,
    name: 'Evoke',
    description: 'Cast for evoke cost, sacrifice when it enters the battlefield',
    manaCost: evokeCost,
    additionalEffects: ['Sacrifice when it enters the battlefield'],
    sourceName: cardName,
  };
}

/**
 * Create Dash cost
 */
export function createDashCost(
  cardName: string,
  dashCost: ManaCost
): AlternateCost {
  return {
    type: AlternateCostType.DASH,
    name: 'Dash',
    description: 'Cast for dash cost, return to hand at end of turn',
    manaCost: dashCost,
    additionalEffects: ['Haste', 'Return to hand at end of turn'],
    sourceName: cardName,
  };
}

/**
 * Create Flashback cost
 */
export function createFlashbackCost(
  cardName: string,
  flashbackCost: ManaCost
): AlternateCost {
  return {
    type: AlternateCostType.FLASHBACK,
    name: 'Flashback',
    description: 'Cast from graveyard for flashback cost, then exile',
    manaCost: flashbackCost,
    additionalEffects: ['Exile after resolving'],
    sourceName: cardName,
  };
}

/**
 * Create Madness cost
 */
export function createMadnessCost(
  cardName: string,
  madnessCost: ManaCost
): AlternateCost {
  return {
    type: AlternateCostType.MADNESS,
    name: 'Madness',
    description: 'Cast for madness cost when discarded',
    manaCost: madnessCost,
    sourceName: cardName,
  };
}

/**
 * Create Miracle cost
 */
export function createMiracleCost(
  cardName: string,
  miracleCost: ManaCost
): AlternateCost {
  return {
    type: AlternateCostType.MIRACLE,
    name: 'Miracle',
    description: 'Cast for miracle cost if this is the first card you drew this turn',
    manaCost: miracleCost,
    sourceName: cardName,
  };
}

/**
 * Helper function to apply reduction to a single color
 * Returns [newValue, excessReduction]
 */
function applyColorReduction(
  originalValue: number | undefined,
  reductionValue: number | undefined
): [number, number] {
  const orig = originalValue || 0;
  const red = reductionValue || 0;
  const newValue = Math.max(0, orig - red);
  const excess = Math.max(0, red - orig);
  return [newValue, excess];
}

/**
 * Apply cost reduction to a mana cost
 * Rule 118.7: If a cost is reduced, apply the reduction to the appropriate mana.
 * Rule 118.7c: If reducing colored mana more than the cost requires,
 * the excess is applied to the generic mana cost.
 */
export function applyCostReduction(
  originalCost: ManaCost,
  reduction: ManaCost
): ManaCost {
  const colors = ['white', 'blue', 'black', 'red', 'green'] as const;
  let excess = 0;
  
  // Use mutable intermediate object for building the result
  const result: { [key: string]: number } = {};
  
  // Apply reduction to each color, accumulating excess
  for (const color of colors) {
    const [newValue, colorExcess] = applyColorReduction(
      originalCost[color],
      reduction[color]
    );
    result[color] = newValue;
    excess += colorExcess;
  }
  
  // Handle colorless separately (no excess to generic)
  result.colorless = Math.max(0, (originalCost.colorless || 0) - (reduction.colorless || 0));
  
  // Apply excess from colors to generic cost
  result.generic = Math.max(0, (originalCost.generic || 0) - excess - (reduction.generic || 0));
  
  return result as ManaCost;
}

/**
 * Calculate total mana value of a cost
 */
export function getTotalManaValue(cost: ManaCost): number {
  return (cost.white || 0) +
         (cost.blue || 0) +
         (cost.black || 0) +
         (cost.red || 0) +
         (cost.green || 0) +
         (cost.colorless || 0) +
         (cost.generic || 0);
}

/**
 * Check if a cost has been reduced to zero
 */
export function isCostZero(cost: ManaCost): boolean {
  return getTotalManaValue(cost) === 0;
}

/**
 * Check if creature type matches a condition
 * Handles changelings (all creature types)
 */
export function creatureTypeMatchesCondition(
  creatureTypes: readonly string[],
  hasChangeling: boolean,
  requiredType: string
): boolean {
  if (hasChangeling) {
    // Changelings have all creature types
    return true;
  }
  
  return creatureTypes.some(
    type => type.toLowerCase() === requiredType.toLowerCase()
  );
}

/**
 * Get applicable cost reductions for a spell
 */
export function getApplicableCostReductions(
  reductions: readonly CostReduction[],
  spellInfo: {
    readonly types: readonly string[];
    readonly creatureTypes?: readonly string[];
    readonly hasChangeling?: boolean;
    readonly colors?: readonly string[];
    readonly name?: string;
  }
): readonly CostReduction[] {
  return reductions.filter(reduction => {
    // Check if the reduction applies to this spell type
    if (reduction.appliesTo !== 'all') {
      const hasMatchingType = spellInfo.types.some(
        type => type.toLowerCase() === reduction.appliesTo.toLowerCase() ||
               (type.toLowerCase() === 'creature' && reduction.appliesTo === 'creatures')
      );
      if (!hasMatchingType) return false;
    }
    
    // Check condition if present
    if (reduction.condition) {
      switch (reduction.condition.type) {
        case 'creature_type':
          return creatureTypeMatchesCondition(
            spellInfo.creatureTypes || [],
            spellInfo.hasChangeling || false,
            reduction.condition.value
          );
          
        case 'color':
          return spellInfo.colors?.some(
            c => c.toLowerCase() === reduction.condition!.value.toLowerCase()
          ) ?? false;
          
        case 'name':
          return spellInfo.name?.toLowerCase() === reduction.condition.value.toLowerCase();
          
        default:
          return true;
      }
    }
    
    return true;
  });
}

/**
 * Calculate final cost after all reductions
 */
export function calculateFinalCost(
  originalCost: ManaCost,
  reductions: readonly CostReduction[]
): ManaCost {
  let finalCost = { ...originalCost };
  
  for (const reduction of reductions) {
    finalCost = applyCostReduction(finalCost, reduction.reduction);
  }
  
  return finalCost;
}

/**
 * Check if a pitch cost can be paid
 */
export function canPayPitchCost(
  cost: AlternateCost,
  currentLife: number,
  handCards: readonly { id: string; colors?: readonly string[]; type_line?: string }[],
  colorFilter?: string
): { canPay: boolean; eligibleCards: readonly string[]; reason?: string } {
  // Check life payment
  if (cost.lifeCost && currentLife < cost.lifeCost) {
    return { canPay: false, eligibleCards: [], reason: 'Insufficient life' };
  }
  
  // Check exile requirement
  if (cost.requiresExile) {
    const filter = cost.requiresExile.filter || colorFilter;
    const eligible = handCards.filter(card => {
      if (!filter) return true;
      
      const filterLower = filter.toLowerCase();
      
      // Check color matching
      if (filterLower.includes('blue')) {
        return card.colors?.includes('U') ?? false;
      }
      if (filterLower.includes('red')) {
        return card.colors?.includes('R') ?? false;
      }
      if (filterLower.includes('black')) {
        return card.colors?.includes('B') ?? false;
      }
      if (filterLower.includes('white')) {
        return card.colors?.includes('W') ?? false;
      }
      if (filterLower.includes('green')) {
        return card.colors?.includes('G') ?? false;
      }
      
      return true;
    });
    
    if (eligible.length < cost.requiresExile.count) {
      return { 
        canPay: false, 
        eligibleCards: [], 
        reason: `Need ${cost.requiresExile.count} ${filter || 'card(s)'} to exile` 
      };
    }
    
    return { canPay: true, eligibleCards: eligible.map(c => c.id) };
  }
  
  return { canPay: true, eligibleCards: [] };
}

/**
 * External alternate cost source definition
 * Represents permanents like Jodah, Fist of Suns, Omniscience that provide
 * alternate casting costs for spells you cast.
 */
export interface ExternalAlternateCostSource {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly costType: AlternateCostType;
  readonly alternateCost?: ManaCost;
  readonly condition?: ExternalCostCondition;
  readonly freecast?: boolean;
}

/**
 * Condition for when an external alternate cost applies
 */
export interface ExternalCostCondition {
  readonly type: 'controller' | 'card_type' | 'zone' | 'color' | 'custom';
  readonly value?: string;
  readonly zones?: readonly string[];
}

/**
 * Create an Omniscience alternate cost source
 * "You may cast spells from your hand without paying their mana costs."
 */
export function createOmniscienceSource(sourceId: string): ExternalAlternateCostSource {
  return {
    sourceId,
    sourceName: 'Omniscience',
    costType: AlternateCostType.FREE,
    freecast: true,
    condition: {
      type: 'zone',
      zones: ['hand'],
    },
  };
}

/**
 * Create a Jodah/Fist of Suns alternate cost source
 * "You may pay {W}{U}{B}{R}{G} rather than pay the mana cost for spells you cast."
 */
export function createWUBRGAlternateCostSource(
  sourceId: string,
  sourceName: string
): ExternalAlternateCostSource {
  return {
    sourceId,
    sourceName,
    costType: AlternateCostType.WUBRG,
    alternateCost: WUBRG_COST,
  };
}

/**
 * Create a Bringer alternate cost (self-only WUBRG)
 * "You may pay {W}{U}{B}{R}{G} rather than pay this spell's mana cost."
 */
export function createBringerCost(cardName: string): AlternateCost {
  return {
    type: AlternateCostType.WUBRG,
    name: 'Bringer Cost',
    description: `Pay {W}{U}{B}{R}{G} rather than pay the mana cost`,
    manaCost: WUBRG_COST,
    sourceName: cardName,
  };
}

/**
 * Detect external alternate cost sources on the battlefield
 * Returns all permanents that provide alternate casting costs to the player
 * 
 * @param battlefield - Array of permanents on the battlefield
 * @param playerId - The player casting the spell
 * @returns Array of external alternate cost sources
 */
export function detectExternalAlternateCostSources(
  battlefield: readonly any[],
  playerId: string
): ExternalAlternateCostSource[] {
  const sources: ExternalAlternateCostSource[] = [];
  
  for (const perm of battlefield) {
    if (!perm || !perm.card || perm.controller !== playerId) continue;
    
    const cardName = (perm.card.name || '').toLowerCase();
    const oracleText = (perm.card.oracle_text || '').toLowerCase();
    
    // Omniscience: "You may cast spells from your hand without paying their mana costs."
    if (cardName.includes('omniscience') || 
        oracleText.includes('cast spells from your hand without paying their mana cost')) {
      sources.push(createOmniscienceSource(perm.id));
    }
    
    // Jodah, Archmage Eternal: "You may pay {W}{U}{B}{R}{G} rather than pay the mana cost for spells you cast."
    // Fist of Suns: Same effect
    if ((cardName.includes('jodah') && oracleText.includes('wubrg')) ||
        cardName.includes('fist of suns') ||
        (oracleText.includes('{w}{u}{b}{r}{g}') && oracleText.includes('rather than pay'))) {
      // Check it's not the card-specific version (Bringers)
      if (!oracleText.includes('this spell')) {
        sources.push(createWUBRGAlternateCostSource(perm.id, perm.card.name || 'Unknown'));
      }
    }
  }
  
  return sources;
}

/**
 * Check if a card has a built-in alternate WUBRG cost (like the Bringers)
 * "You may pay {W}{U}{B}{R}{G} rather than pay this spell's mana cost."
 * 
 * @param oracleText - Card oracle text
 * @returns True if card has self-WUBRG alternate cost
 */
export function hasSelfWUBRGCost(oracleText: string): boolean {
  if (!oracleText) return false;
  const lower = oracleText.toLowerCase();
  return lower.includes('{w}{u}{b}{r}{g}') && 
         lower.includes('rather than pay') &&
         lower.includes('this spell');
}

/**
 * Get all available alternate costs for casting a spell
 * Combines card's built-in costs with external sources
 * 
 * @param card - The card being cast
 * @param externalSources - External alternate cost sources
 * @param castFromZone - Zone the card is being cast from
 * @returns Array of available alternate costs
 */
export function getAvailableAlternateCosts(
  card: { oracle_text?: string; name?: string; mana_cost?: string },
  externalSources: readonly ExternalAlternateCostSource[],
  castFromZone: string = 'hand'
): AlternateCost[] {
  const costs: AlternateCost[] = [];
  const oracleText = card.oracle_text || '';
  const cardName = card.name || 'Unknown';
  
  // Check card's built-in alternate costs
  
  // Bringer-style self-WUBRG cost
  if (hasSelfWUBRGCost(oracleText)) {
    costs.push(createBringerCost(cardName));
  }
  
  // Add external sources
  for (const source of externalSources) {
    // Check zone condition
    if (source.condition?.type === 'zone' && source.condition.zones) {
      if (!source.condition.zones.includes(castFromZone)) {
        continue;
      }
    }
    
    if (source.freecast) {
      // Free cast (Omniscience)
      costs.push({
        type: AlternateCostType.FREE,
        name: 'Free Cast',
        description: `Cast without paying mana cost (${source.sourceName})`,
        sourceName: source.sourceName,
        sourceId: source.sourceId,
      });
    } else if (source.alternateCost) {
      // WUBRG or other alternate mana cost
      costs.push({
        type: source.costType,
        name: source.costType === AlternateCostType.WUBRG ? 'WUBRG Alternative' : 'Alternate Cost',
        description: source.costType === AlternateCostType.WUBRG 
          ? `Pay {W}{U}{B}{R}{G} rather than pay the mana cost (${source.sourceName})`
          : `Pay alternate cost (${source.sourceName})`,
        manaCost: source.alternateCost,
        sourceName: source.sourceName,
        sourceId: source.sourceId,
      });
    }
  }
  
  return costs;
}

export default {
  createJodahCost,
  createMorophonReduction,
  createPitchCost,
  createEvokeCost,
  createDashCost,
  createFlashbackCost,
  createMadnessCost,
  createMiracleCost,
  applyCostReduction,
  getTotalManaValue,
  isCostZero,
  creatureTypeMatchesCondition,
  getApplicableCostReductions,
  calculateFinalCost,
  canPayPitchCost,
  createOmniscienceSource,
  createWUBRGAlternateCostSource,
  createBringerCost,
  detectExternalAlternateCostSources,
  hasSelfWUBRGCost,
  getAvailableAlternateCosts,
  WUBRG_COST,
  MOROPHON_REDUCTION,
  AlternateCostType,
};
