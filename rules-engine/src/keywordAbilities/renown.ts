/**
 * Renown keyword ability (Rule 702.112)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.112. Renown
 * 702.112a Renown is a triggered ability. "Renown N" means "When this creature deals combat 
 * damage to a player, if it isn't renowned, put N +1/+1 counters on it and it becomes renowned."
 * 702.112b Renowned is a designation that has no rules meaning other than to act as a marker 
 * that the renown ability and other spells and abilities can identify. Only permanents can be 
 * or become renowned. Once a permanent becomes renowned, it stays renowned until it leaves the 
 * battlefield. Renowned is neither an ability nor part of the permanent's copiable values.
 * 702.112c If a creature has multiple instances of renown, each triggers separately. The first 
 * such ability to resolve will cause the creature to become renowned, and subsequent abilities 
 * will have no effect.
 */

export interface RenownAbility {
  readonly type: 'renown';
  readonly source: string;
  readonly renownValue: number;
  readonly isRenowned: boolean;
}

/**
 * Create a renown ability
 * Rule 702.112a
 * @param source - The source permanent
 * @param renownValue - Number of +1/+1 counters to add
 * @returns Renown ability object
 */
export function renown(source: string, renownValue: number): RenownAbility {
  return {
    type: 'renown',
    source,
    renownValue,
    isRenowned: false,
  };
}

/**
 * Trigger renown when creature deals combat damage to player
 * Rule 702.112a - Only triggers if not already renowned
 * @param ability - Renown ability
 * @returns Updated ability with isRenowned set to true
 */
export function triggerRenown(ability: RenownAbility): RenownAbility {
  if (ability.isRenowned) {
    return ability;
  }
  
  return {
    ...ability,
    isRenowned: true,
  };
}

/**
 * Check if creature can trigger renown
 * Rule 702.112a - Only if not already renowned
 * @param ability - Renown ability
 * @returns True if renown can trigger
 */
export function canTriggerRenown(ability: RenownAbility): boolean {
  return !ability.isRenowned;
}

/**
 * Check if creature is renowned
 * Rule 702.112b
 * @param ability - Renown ability
 * @returns True if creature is renowned
 */
export function isRenowned(ability: RenownAbility): boolean {
  return ability.isRenowned;
}

/**
 * Get renown value (number of counters to add)
 * @param ability - Renown ability
 * @returns Renown value
 */
export function getRenownValue(ability: RenownAbility): number {
  return ability.renownValue;
}

/**
 * Multiple instances of renown trigger separately
 * Rule 702.112c
 * @param abilities - Array of renown abilities
 * @returns False - each instance triggers separately
 */
export function hasRedundantRenown(abilities: readonly RenownAbility[]): boolean {
  return false; // Each instance triggers separately
}
