/**
 * triggers/reanimate.ts
 * 
 * Reanimate and Graveyard to Battlefield Effects.
 * 
 * Cards that return creatures from graveyard to battlefield:
 * - Reanimate: Return target creature, lose life equal to MV
 * - Animate Dead: Enchant creature in graveyard, bring to battlefield
 * - Living Death: Swap creatures in graveyards with battlefield
 * - Victimize: Sacrifice, return 2 creatures
 */

/**
 * Interface for reanimate card detection (known card lookup)
 * Note: This is different from ReanimateEffect in triggers/types.ts which is for
 * permanent-based effects. This interface is for card-level detection.
 */
export interface ReanimateCardInfo {
  cardName: string;
  targetType: 'creature' | 'permanent' | 'any_graveyard';
  targetCount: number | 'all';
  fromGraveyard: 'any' | 'opponent' | 'yours';
  lifeCost?: 'mv' | 'fixed';
  lifeCostAmount?: number;
  additionalCost?: string;
  entersState?: 'tapped' | 'normal';
  additionalEffect?: string;
}

/**
 * Known cards with reanimate effects.
 */
const KNOWN_REANIMATE_CARDS: Record<string, ReanimateCardInfo> = {
  "reanimate": {
    cardName: "Reanimate",
    targetType: 'creature',
    targetCount: 1,
    fromGraveyard: 'any',
    lifeCost: 'mv',
    entersState: 'normal',
  },
  "animate dead": {
    cardName: "Animate Dead",
    targetType: 'creature',
    targetCount: 1,
    fromGraveyard: 'any',
    entersState: 'normal',
    additionalEffect: "Creature gets -1/-0",
  },
  "exhume": {
    cardName: "Exhume",
    targetType: 'creature',
    targetCount: 1,
    fromGraveyard: 'any', // Each player returns one
    entersState: 'normal',
    additionalEffect: "Each player returns a creature",
  },
  "living death": {
    cardName: "Living Death",
    targetType: 'creature',
    targetCount: 'all',
    fromGraveyard: 'any',
    entersState: 'normal',
    additionalEffect: "Exile all creatures on battlefield, return all creatures from graveyards",
  },
  "victimize": {
    cardName: "Victimize",
    targetType: 'creature',
    targetCount: 2,
    fromGraveyard: 'yours',
    entersState: 'tapped',
    additionalCost: "Sacrifice a creature",
  },
  "zombify": {
    cardName: "Zombify",
    targetType: 'creature',
    targetCount: 1,
    fromGraveyard: 'yours',
    entersState: 'normal',
  },
  "unburial rites": {
    cardName: "Unburial Rites",
    targetType: 'creature',
    targetCount: 1,
    fromGraveyard: 'yours',
    entersState: 'normal',
    additionalEffect: "Has flashback",
  },
  "dread return": {
    cardName: "Dread Return",
    targetType: 'creature',
    targetCount: 1,
    fromGraveyard: 'yours',
    entersState: 'normal',
    additionalEffect: "Has flashback (sacrifice 3 creatures)",
  },
  "beacon of unrest": {
    cardName: "Beacon of Unrest",
    targetType: 'creature',
    targetCount: 1,
    fromGraveyard: 'any',
    entersState: 'normal',
    additionalEffect: "Can also return artifacts, shuffle into library",
  },
  "karmic guide": {
    cardName: "Karmic Guide",
    targetType: 'creature',
    targetCount: 1,
    fromGraveyard: 'yours',
    entersState: 'normal',
    additionalEffect: "ETB trigger",
  },
  "reveillark": {
    cardName: "Reveillark",
    targetType: 'creature',
    targetCount: 2,
    fromGraveyard: 'yours',
    entersState: 'normal',
    additionalEffect: "Power 2 or less, LTB trigger",
  },
  "sun titan": {
    cardName: "Sun Titan",
    targetType: 'permanent',
    targetCount: 1,
    fromGraveyard: 'yours',
    entersState: 'normal',
    additionalEffect: "MV 3 or less, ETB and attack trigger",
  },
};

/**
 * Detect if a card has a reanimate effect
 * @param card - The card to check
 * @returns The reanimate card info if found, null otherwise
 */
export function detectReanimateCard(card: any): ReanimateCardInfo | null {
  const cardName = (card?.name || "").toLowerCase();
  
  for (const [knownName, effectInfo] of Object.entries(KNOWN_REANIMATE_CARDS)) {
    if (cardName.includes(knownName)) {
      return effectInfo;
    }
  }
  
  return null;
}
