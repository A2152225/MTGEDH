/**
 * Blitz keyword ability (Rule 702.152)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.152. Blitz
 * 702.152a Blitz represents three abilities: two static abilities that function while the card 
 * with blitz is on the stack, one of which may create a delayed triggered ability, and a static 
 * ability that functions while the object with blitz is on the battlefield. "Blitz [cost]" means 
 * "You may cast this card by paying [cost] rather than its mana cost," "If this spell's blitz 
 * cost was paid, sacrifice the permanent this spell becomes at the beginning of the next end 
 * step," and "As long as this permanent's blitz cost was paid, it has haste and 'When this 
 * permanent is put into a graveyard from the battlefield, draw a card.'"
 * 702.152b If a spell has multiple instances of blitz, only one may be used to cast that spell.
 */

export interface BlitzAbility {
  readonly type: 'blitz';
  readonly source: string;
  readonly blitzCost: string;
  readonly wasBlitzed: boolean;
  readonly hasDrawnCard: boolean;
}

/**
 * Create a blitz ability
 * Rule 702.152a
 * @param source - The card with blitz
 * @param blitzCost - Alternative cost to cast
 * @returns Blitz ability object
 */
export function blitz(source: string, blitzCost: string): BlitzAbility {
  return {
    type: 'blitz',
    source,
    blitzCost,
    wasBlitzed: false,
    hasDrawnCard: false,
  };
}

/**
 * Cast card with blitz cost
 * Rule 702.152a - Gains haste, sacrifice at end step, draw when dies
 * @param ability - Blitz ability
 * @returns Updated ability
 */
export function castWithBlitz(ability: BlitzAbility): BlitzAbility {
  return {
    ...ability,
    wasBlitzed: true,
  };
}

/**
 * Check if spell was blitzed
 * @param ability - Blitz ability
 * @returns True if blitzed
 */
export function wasBlitzed(ability: BlitzAbility): boolean {
  return ability.wasBlitzed;
}

/**
 * Check if permanent has haste from blitz
 * Rule 702.152a
 * @param ability - Blitz ability
 * @returns True if has haste
 */
export function hasHasteFromBlitz(ability: BlitzAbility): boolean {
  return ability.wasBlitzed;
}

/**
 * Check if should sacrifice at end step
 * Rule 702.152a
 * @param ability - Blitz ability
 * @returns True if should sacrifice
 */
export function shouldSacrificeBlitz(ability: BlitzAbility): boolean {
  return ability.wasBlitzed;
}

/**
 * Draw card when blitzed permanent dies
 * Rule 702.152a
 * @param ability - Blitz ability
 * @returns Updated ability
 */
export function drawCardFromBlitz(ability: BlitzAbility): BlitzAbility {
  return {
    ...ability,
    hasDrawnCard: true,
  };
}

/**
 * Blitz abilities with same cost are redundant
 * Rule 702.152b - Only one may be used
 * @param abilities - Array of blitz abilities
 * @returns True if costs match
 */
export function hasRedundantBlitz(abilities: readonly BlitzAbility[]): boolean {
  if (abilities.length <= 1) {
    return false;
  }
  
  const costs = new Set(abilities.map(a => a.blitzCost));
  return costs.size < abilities.length;
}
