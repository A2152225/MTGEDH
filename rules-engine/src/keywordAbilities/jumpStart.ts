/**
 * Jump-Start keyword ability (Rule 702.133)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.133. Jump-Start
 * 702.133a Jump-start appears on some instants and sorceries. It represents two static 
 * abilities: one that functions while the card is in a player's graveyard and another that 
 * functions while the card is on the stack. "Jump-start" means "You may cast this card from 
 * your graveyard if the resulting spell is an instant or sorcery spell by discarding a card as 
 * an additional cost to cast it" and "If this spell was cast using its jump-start ability, 
 * exile this card instead of putting it anywhere else any time it would leave the stack."
 */

export interface JumpStartAbility {
  readonly type: 'jump-start';
  readonly source: string;
  readonly wasJumpStarted: boolean;
  readonly discardedCard?: string;
}

/**
 * Create a jump-start ability
 * Rule 702.133a
 * @param source - The instant or sorcery with jump-start
 * @returns Jump-start ability object
 */
export function jumpStart(source: string): JumpStartAbility {
  return {
    type: 'jump-start',
    source,
    wasJumpStarted: false,
  };
}

/**
 * Cast spell from graveyard with jump-start
 * Rule 702.133a - Discard a card as additional cost
 * @param ability - Jump-start ability
 * @param discardedCard - ID of discarded card
 * @returns Updated ability
 */
export function castWithJumpStart(ability: JumpStartAbility, discardedCard: string): JumpStartAbility {
  return {
    ...ability,
    wasJumpStarted: true,
    discardedCard,
  };
}

/**
 * Check if spell was jump-started
 * @param ability - Jump-start ability
 * @returns True if jump-start was used
 */
export function wasJumpStarted(ability: JumpStartAbility): boolean {
  return ability.wasJumpStarted;
}

/**
 * Check if spell should be exiled
 * Rule 702.133a - Exile if cast with jump-start
 * @param ability - Jump-start ability
 * @returns True if should be exiled
 */
export function shouldExileJumpStart(ability: JumpStartAbility): boolean {
  return ability.wasJumpStarted;
}

/**
 * Multiple instances of jump-start are not redundant
 * @param abilities - Array of jump-start abilities
 * @returns False
 */
export function hasRedundantJumpStart(abilities: readonly JumpStartAbility[]): boolean {
  return false;
}
