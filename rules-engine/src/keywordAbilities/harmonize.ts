/**
 * Harmonize keyword ability (Rule 702.180)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.180. Harmonize
 * 702.180a Harmonize represents three static abilities: one that functions while the card is in a 
 * player's graveyard and two that function while the spell with harmonize is on the stack. 
 * "Harmonize [cost]" means "You may cast this card from your graveyard by paying [cost] and tapping 
 * up to one untapped creature you control rather than paying this spell's mana cost," "If you cast 
 * this spell using its harmonize ability, its total cost is reduced by an amount of generic mana 
 * equal to the tapped creature's power," and "If the harmonize cost was paid, exile this card 
 * instead of putting it anywhere else any time it would leave the stack."
 * 702.180b You choose which creature to tap as you choose to pay a spell's harmonize cost, and then 
 * tap that creature as you pay the total cost.
 */

export interface HarmonizeAbility {
  readonly type: 'harmonize';
  readonly source: string;
  readonly harmonizeCost: string;
  readonly wasHarmonized: boolean;
  readonly tappedCreature?: string;
  readonly costReduction: number;
}

/**
 * Create a harmonize ability
 * Rule 702.180a
 * @param source - The card with harmonize
 * @param harmonizeCost - Alternative cost
 * @returns Harmonize ability object
 */
export function harmonize(source: string, harmonizeCost: string): HarmonizeAbility {
  return {
    type: 'harmonize',
    source,
    harmonizeCost,
    wasHarmonized: false,
    costReduction: 0,
  };
}

/**
 * Cast from graveyard with harmonize
 * Rule 702.180a - Cost reduced by tapped creature's power
 * @param ability - Harmonize ability
 * @param tappedCreature - ID of tapped creature (optional)
 * @param creaturePower - Power of tapped creature
 * @returns Updated ability
 */
export function castWithHarmonize(
  ability: HarmonizeAbility,
  tappedCreature: string | undefined,
  creaturePower: number
): HarmonizeAbility {
  return {
    ...ability,
    wasHarmonized: true,
    tappedCreature,
    costReduction: tappedCreature ? creaturePower : 0,
  };
}

/**
 * Check if harmonize was used
 * @param ability - Harmonize ability
 * @returns True if harmonized
 */
export function wasHarmonized(ability: HarmonizeAbility): boolean {
  return ability.wasHarmonized;
}

/**
 * Get cost reduction
 * Rule 702.180a
 * @param ability - Harmonize ability
 * @returns Cost reduction amount
 */
export function getHarmonizeCostReduction(ability: HarmonizeAbility): number {
  return ability.costReduction;
}

/**
 * Multiple instances of harmonize are not redundant
 * @param abilities - Array of harmonize abilities
 * @returns False
 */
export function hasRedundantHarmonize(abilities: readonly HarmonizeAbility[]): boolean {
  return false;
}
