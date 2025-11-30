/**
 * cards/additionalCostCards.ts
 * 
 * Cards that require additional costs (sacrifice, discard, etc.)
 */

export interface AdditionalCostConfig {
  readonly cardName: string;
  readonly costType: 'sacrifice' | 'discard' | 'pay_life' | 'tap';
  readonly costFilter?: string;
  readonly costAmount?: number;
}

export const ADDITIONAL_COST_CARDS: Record<string, AdditionalCostConfig> = {
  'deadly dispute': {
    cardName: 'Deadly Dispute',
    costType: 'sacrifice',
    costFilter: 'artifact or creature',
  },
  'village rites': {
    cardName: 'Village Rites',
    costType: 'sacrifice',
    costFilter: 'creature',
  },
  "altar's reap": {
    cardName: "Altar's Reap",
    costType: 'sacrifice',
    costFilter: 'creature',
  },
  'bone splinters': {
    cardName: 'Bone Splinters',
    costType: 'sacrifice',
    costFilter: 'creature',
  },
  'fling': {
    cardName: 'Fling',
    costType: 'sacrifice',
    costFilter: 'creature',
  },
};

export function hasAdditionalCost(cardName: string): boolean {
  return cardName.toLowerCase() in ADDITIONAL_COST_CARDS;
}

export function getAdditionalCostConfig(cardName: string): AdditionalCostConfig | undefined {
  return ADDITIONAL_COST_CARDS[cardName.toLowerCase()];
}

/**
 * Detect additional cost from oracle text
 */
export function detectAdditionalCostFromText(oracleText: string): AdditionalCostConfig | null {
  const text = oracleText.toLowerCase();
  
  // As an additional cost pattern
  const sacrificeMatch = text.match(/as an additional cost.*sacrifice (?:a |an )?([^,\.]+)/);
  if (sacrificeMatch) {
    return {
      cardName: '',
      costType: 'sacrifice',
      costFilter: sacrificeMatch[1].trim(),
    };
  }
  
  const discardMatch = text.match(/as an additional cost.*discard (\d+|a) cards?/);
  if (discardMatch) {
    return {
      cardName: '',
      costType: 'discard',
      costAmount: discardMatch[1] === 'a' ? 1 : parseInt(discardMatch[1]),
    };
  }
  
  const lifeMatch = text.match(/as an additional cost.*pay (\d+) life/);
  if (lifeMatch) {
    return {
      cardName: '',
      costType: 'pay_life',
      costAmount: parseInt(lifeMatch[1]),
    };
  }
  
  return null;
}
