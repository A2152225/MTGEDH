/**
 * Offering keyword ability implementation (Rule 702.48)
 * @see MagicCompRules 702.48
 */

export interface OfferingAbility {
  readonly type: 'offering';
  readonly offeringType: string;
  readonly source: string;
  readonly sacrificedCreature?: string;
}

export function offering(source: string, offeringType: string): OfferingAbility {
  return { type: 'offering', offeringType, source };
}

export function payOffering(ability: OfferingAbility, creature: string): OfferingAbility {
  return { ...ability, sacrificedCreature: creature };
}

export function getOfferingReduction(sacrificedMV: number): number {
  return sacrificedMV;
}
