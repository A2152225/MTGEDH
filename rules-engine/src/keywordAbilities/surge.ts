/**
 * Surge keyword ability (Rule 702.117)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.117. Surge
 * 702.117a Surge is a static ability that functions while the spell with surge is on the stack. 
 * "Surge [cost]" means "You may pay [cost] rather than pay this spell's mana cost as you cast 
 * this spell if you or one of your teammates has cast another spell this turn." Casting a spell 
 * for its surge cost follows the rules for paying alternative costs in rules 601.2b and 601.2f–h.
 */

export interface SurgeAbility {
  readonly type: 'surge';
  readonly source: string;
  readonly surgeCost: string;
  readonly wasSurged: boolean;
}

/**
 * Create a surge ability
 * Rule 702.117a
 * @param source - The spell with surge
 * @param surgeCost - Alternative cost to cast with surge
 * @returns Surge ability object
 */
export function surge(source: string, surgeCost: string): SurgeAbility {
  return {
    type: 'surge',
    source,
    surgeCost,
    wasSurged: false,
  };
}

/**
 * Check if surge can be used
 * Rule 702.117a - Requires you or teammate to have cast spell this turn
 * @param hasSpellBeenCast - Whether you or teammate cast spell this turn
 * @returns True if surge is available
 */
export function canUseSurge(hasSpellBeenCast: boolean): boolean {
  return hasSpellBeenCast;
}

/**
 * Cast spell with surge cost
 * Rule 702.117a - Alternative cost
 * @param ability - Surge ability
 * @returns Updated ability with wasSurged set to true
 */
export function castWithSurge(ability: SurgeAbility): SurgeAbility {
  return {
    ...ability,
    wasSurged: true,
  };
}

/**
 * Check if spell was cast with surge
 * @param ability - Surge ability
 * @returns True if surge cost was paid
 */
export function wasSurged(ability: SurgeAbility): boolean {
  return ability.wasSurged;
}

/**
 * Get surge cost
 * @param ability - Surge ability
 * @returns Surge cost string
 */
export function getSurgeCost(ability: SurgeAbility): string {
  return ability.surgeCost;
}

/**
 * Surge abilities with same cost are redundant
 * @param abilities - Array of surge abilities
 * @returns True if costs match
 */
export function hasRedundantSurge(abilities: readonly SurgeAbility[]): boolean {
  if (abilities.length <= 1) {
    return false;
  }
  
  const costs = new Set(abilities.map(a => a.surgeCost));
  return costs.size < abilities.length;
}
