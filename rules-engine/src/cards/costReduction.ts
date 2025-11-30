/**
 * cards/costReduction.ts
 * 
 * Cards that reduce spell costs.
 */

export interface CostReductionConfig {
  readonly cardName: string;
  readonly affectedTypes: string[];
  readonly genericReduction: number;
  readonly colorReduction?: {
    readonly white?: number;
    readonly blue?: number;
    readonly black?: number;
    readonly red?: number;
    readonly green?: number;
  };
  readonly requiresTypeSelection?: boolean;
  readonly affectsOnlyCreatures?: boolean;
}

export const COST_REDUCTION_CARDS: Record<string, CostReductionConfig> = {
  'the water crystal': {
    cardName: 'The Water Crystal',
    affectedTypes: ['all'],
    genericReduction: 0,
    colorReduction: { blue: 1 },
    affectsOnlyCreatures: false,
  },
  'the fire crystal': {
    cardName: 'The Fire Crystal',
    affectedTypes: ['all'],
    genericReduction: 0,
    colorReduction: { red: 1 },
    affectsOnlyCreatures: false,
  },
  'the wind crystal': {
    cardName: 'The Wind Crystal',
    affectedTypes: ['all'],
    genericReduction: 0,
    colorReduction: { green: 1 },
    affectsOnlyCreatures: false,
  },
  "urza's incubator": {
    cardName: "Urza's Incubator",
    affectedTypes: ['chosen'],
    genericReduction: 2,
    requiresTypeSelection: true,
    affectsOnlyCreatures: true,
  },
  'morophon, the boundless': {
    cardName: 'Morophon, the Boundless',
    affectedTypes: ['chosen'],
    genericReduction: 0,
    colorReduction: { white: 1, blue: 1, black: 1, red: 1, green: 1 },
    requiresTypeSelection: true,
    affectsOnlyCreatures: true,
  },
  "herald's horn": {
    cardName: "Herald's Horn",
    affectedTypes: ['chosen'],
    genericReduction: 1,
    requiresTypeSelection: true,
    affectsOnlyCreatures: true,
  },
};

export function hasCostReduction(cardName: string): boolean {
  return cardName.toLowerCase() in COST_REDUCTION_CARDS;
}

export function getCostReductionConfig(cardName: string): CostReductionConfig | undefined {
  return COST_REDUCTION_CARDS[cardName.toLowerCase()];
}

/**
 * Apply cost reduction to a mana cost
 */
export function applyCostReduction(
  manaCost: { generic?: number; white?: number; blue?: number; black?: number; red?: number; green?: number },
  reduction: CostReductionConfig
): { generic?: number; white?: number; blue?: number; black?: number; red?: number; green?: number } {
  const result = { ...manaCost };
  
  // Apply generic reduction
  if (reduction.genericReduction > 0 && result.generic) {
    result.generic = Math.max(0, result.generic - reduction.genericReduction);
  }
  
  // Apply color reductions
  if (reduction.colorReduction) {
    if (reduction.colorReduction.white && result.white) {
      result.white = Math.max(0, result.white - reduction.colorReduction.white);
    }
    if (reduction.colorReduction.blue && result.blue) {
      result.blue = Math.max(0, result.blue - reduction.colorReduction.blue);
    }
    if (reduction.colorReduction.black && result.black) {
      result.black = Math.max(0, result.black - reduction.colorReduction.black);
    }
    if (reduction.colorReduction.red && result.red) {
      result.red = Math.max(0, result.red - reduction.colorReduction.red);
    }
    if (reduction.colorReduction.green && result.green) {
      result.green = Math.max(0, result.green - reduction.colorReduction.green);
    }
  }
  
  return result;
}
