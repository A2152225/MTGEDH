/**
 * Web-slinging keyword ability (Rule 702.188)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.188. Web-slinging
 * 702.188a Web-slinging is a static ability that functions while the spell with web-slinging is 
 * on the stack. "Web-slinging [cost]" means "You may cast this spell by paying [cost] and 
 * returning a tapped creature you control to its owner's hand rather than paying its mana cost."
 */

export interface WebSlingingAbility {
  readonly type: 'web-slinging';
  readonly source: string;
  readonly webSlingingCost: string;
  readonly wasWebSlung: boolean;
  readonly returnedCreature?: string;
}

/**
 * Create a web-slinging ability
 * Rule 702.188a
 * @param source - The spell with web-slinging
 * @param webSlingingCost - Alternative cost
 * @returns Web-slinging ability object
 */
export function webSlinging(source: string, webSlingingCost: string): WebSlingingAbility {
  return {
    type: 'web-slinging',
    source,
    webSlingingCost,
    wasWebSlung: false,
  };
}

/**
 * Cast with web-slinging
 * Rule 702.188a - Pay cost and return tapped creature
 * @param ability - Web-slinging ability
 * @param returnedCreature - ID of returned creature
 * @returns Updated ability
 */
export function castWithWebSlinging(
  ability: WebSlingingAbility,
  returnedCreature: string
): WebSlingingAbility {
  return {
    ...ability,
    wasWebSlung: true,
    returnedCreature,
  };
}

/**
 * Check if spell was web-slung
 * @param ability - Web-slinging ability
 * @returns True if web-slung
 */
export function wasWebSlung(ability: WebSlingingAbility): boolean {
  return ability.wasWebSlung;
}

/**
 * Get returned creature
 * @param ability - Web-slinging ability
 * @returns Creature ID or undefined
 */
export function getReturnedCreature(ability: WebSlingingAbility): string | undefined {
  return ability.returnedCreature;
}

/**
 * Multiple instances of web-slinging are not redundant
 * @param abilities - Array of web-slinging abilities
 * @returns False
 */
export function hasRedundantWebSlinging(abilities: readonly WebSlingingAbility[]): boolean {
  return false;
}
