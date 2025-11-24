/**
 * Spectacle keyword ability (Rule 702.137)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.137. Spectacle
 * 702.137a Spectacle is a static ability that functions on the stack. "Spectacle [cost]" means 
 * "You may pay [cost] rather than pay this spell's mana cost if an opponent lost life this turn." 
 * Casting a spell for its spectacle cost follows the rules for paying alternative costs in rules 
 * 601.2b and 601.2f–h.
 */

export interface SpectacleAbility {
  readonly type: 'spectacle';
  readonly source: string;
  readonly spectacleCost: string;
  readonly wasSpectacled: boolean;
}

/**
 * Create a spectacle ability
 * Rule 702.137a
 * @param source - The spell with spectacle
 * @param spectacleCost - Alternative cost
 * @returns Spectacle ability object
 */
export function spectacle(source: string, spectacleCost: string): SpectacleAbility {
  return {
    type: 'spectacle',
    source,
    spectacleCost,
    wasSpectacled: false,
  };
}

/**
 * Check if spectacle can be used
 * Rule 702.137a - Requires opponent to have lost life this turn
 * @param opponentLostLife - Whether an opponent lost life this turn
 * @returns True if spectacle is available
 */
export function canUseSpectacle(opponentLostLife: boolean): boolean {
  return opponentLostLife;
}

/**
 * Cast spell with spectacle cost
 * Rule 702.137a
 * @param ability - Spectacle ability
 * @returns Updated ability
 */
export function castWithSpectacle(ability: SpectacleAbility): SpectacleAbility {
  return {
    ...ability,
    wasSpectacled: true,
  };
}

/**
 * Check if spell was cast with spectacle
 * @param ability - Spectacle ability
 * @returns True if spectacle cost was paid
 */
export function wasSpectacled(ability: SpectacleAbility): boolean {
  return ability.wasSpectacled;
}

/**
 * Get spectacle cost
 * @param ability - Spectacle ability
 * @returns Spectacle cost string
 */
export function getSpectacleCost(ability: SpectacleAbility): string {
  return ability.spectacleCost;
}

/**
 * Spectacle abilities with same cost are redundant
 * @param abilities - Array of spectacle abilities
 * @returns True if costs match
 */
export function hasRedundantSpectacle(abilities: readonly SpectacleAbility[]): boolean {
  if (abilities.length <= 1) {
    return false;
  }
  
  const costs = new Set(abilities.map(a => a.spectacleCost));
  return costs.size < abilities.length;
}
