/**
 * cards/fetchlands.ts
 * 
 * Fetchland configurations and utilities.
 * Handles search types, life payment, and land entry state.
 */

/**
 * Fetchland configuration
 */
export interface FetchlandConfig {
  readonly name: string;
  readonly searchTypes: readonly string[];
  readonly paysLife: number;
  readonly entersTapped: boolean;
}

/**
 * Well-known fetchlands
 */
export const FETCHLAND_CONFIGS: Record<string, FetchlandConfig> = {
  // Allied fetchlands
  'flooded strand': { name: 'Flooded Strand', searchTypes: ['Plains', 'Island'], paysLife: 1, entersTapped: false },
  'polluted delta': { name: 'Polluted Delta', searchTypes: ['Island', 'Swamp'], paysLife: 1, entersTapped: false },
  'bloodstained mire': { name: 'Bloodstained Mire', searchTypes: ['Swamp', 'Mountain'], paysLife: 1, entersTapped: false },
  'wooded foothills': { name: 'Wooded Foothills', searchTypes: ['Mountain', 'Forest'], paysLife: 1, entersTapped: false },
  'windswept heath': { name: 'Windswept Heath', searchTypes: ['Forest', 'Plains'], paysLife: 1, entersTapped: false },
  
  // Enemy fetchlands
  'marsh flats': { name: 'Marsh Flats', searchTypes: ['Plains', 'Swamp'], paysLife: 1, entersTapped: false },
  'scalding tarn': { name: 'Scalding Tarn', searchTypes: ['Island', 'Mountain'], paysLife: 1, entersTapped: false },
  'verdant catacombs': { name: 'Verdant Catacombs', searchTypes: ['Swamp', 'Forest'], paysLife: 1, entersTapped: false },
  'arid mesa': { name: 'Arid Mesa', searchTypes: ['Mountain', 'Plains'], paysLife: 1, entersTapped: false },
  'misty rainforest': { name: 'Misty Rainforest', searchTypes: ['Forest', 'Island'], paysLife: 1, entersTapped: false },
  
  // Budget fetchlands
  'evolving wilds': { name: 'Evolving Wilds', searchTypes: ['Basic Land'], paysLife: 0, entersTapped: true },
  'terramorphic expanse': { name: 'Terramorphic Expanse', searchTypes: ['Basic Land'], paysLife: 0, entersTapped: true },
  'fabled passage': { name: 'Fabled Passage', searchTypes: ['Basic Land'], paysLife: 0, entersTapped: true },
  'prismatic vista': { name: 'Prismatic Vista', searchTypes: ['Basic Land'], paysLife: 1, entersTapped: false },
};

export function isFetchland(cardName: string): boolean {
  return cardName.toLowerCase() in FETCHLAND_CONFIGS;
}

export function getFetchlandConfig(cardName: string): FetchlandConfig | undefined {
  return FETCHLAND_CONFIGS[cardName.toLowerCase()];
}

/**
 * Build search criteria for fetchland search
 */
export function buildFetchlandSearchCriteria(config: FetchlandConfig): {
  cardTypes?: string[];
  cardType?: string;
} {
  if (config.searchTypes.includes('Basic Land')) {
    return { cardType: 'basic land' };
  }
  return { cardTypes: [...config.searchTypes] };
}
