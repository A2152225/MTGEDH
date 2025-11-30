/**
 * cards/creatureCountCards.ts
 * 
 * Cards whose effects depend on creature count.
 */

export interface CreatureCountEffectConfig {
  readonly cardName: string;
  readonly effectType: 'draw' | 'gain_life' | 'damage' | 'tokens';
  readonly perCreature: boolean;
  readonly creatureFilter?: string;
  readonly bonus?: {
    readonly condition: string;
    readonly effect: string;
  };
}

export const CREATURE_COUNT_CARDS: Record<string, CreatureCountEffectConfig> = {
  'shamanic revelation': {
    cardName: 'Shamanic Revelation',
    effectType: 'draw',
    perCreature: true,
    bonus: {
      condition: 'creature with power 4 or greater',
      effect: 'gain 4 life',
    },
  },
  'distant melody': {
    cardName: 'Distant Melody',
    effectType: 'draw',
    perCreature: true,
    creatureFilter: 'chosen type',
  },
  'collective unconscious': {
    cardName: 'Collective Unconscious',
    effectType: 'draw',
    perCreature: true,
  },
};

export function hasCreatureCountEffect(cardName: string): boolean {
  return cardName.toLowerCase() in CREATURE_COUNT_CARDS;
}

export function getCreatureCountEffectConfig(cardName: string): CreatureCountEffectConfig | undefined {
  return CREATURE_COUNT_CARDS[cardName.toLowerCase()];
}

/**
 * Count creatures matching a filter
 */
export function countCreaturesWithFilter(
  creatures: { power?: number; toughness?: number; types?: string[] }[],
  filter?: string
): number {
  if (!filter) {
    return creatures.length;
  }
  
  const filterLower = filter.toLowerCase();
  
  // Power filter
  const powerMatch = filterLower.match(/power (\d+) or (greater|less)/);
  if (powerMatch) {
    const threshold = parseInt(powerMatch[1]);
    const direction = powerMatch[2];
    return creatures.filter(c => {
      const power = c.power || 0;
      return direction === 'greater' ? power >= threshold : power <= threshold;
    }).length;
  }
  
  // Type filter
  if (filter !== 'chosen type') {
    return creatures.filter(c => 
      c.types?.some(t => t.toLowerCase() === filterLower)
    ).length;
  }
  
  return creatures.length;
}
