/**
 * Companion keyword ability (Rule 702.139)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.139. Companion
 * 702.139a Companion is a keyword ability that functions outside the game. It's written as 
 * "Companion—[Condition]." Before the game begins, you may reveal one card you own from outside 
 * the game with a companion ability whose condition is fulfilled by your starting deck. Once 
 * during the game, any time you have priority and the stack is empty, but only during a main 
 * phase of your turn, you may pay {3} and put that card into your hand. This is a special action 
 * that doesn't use the stack.
 * 702.139b If a companion ability refers to your starting deck, it refers to your deck after 
 * you've set aside any sideboard cards. In a Commander game, this is also before you've set 
 * aside your commander.
 * 702.139c Once you take the special action and put the card with companion into your hand, it 
 * remains in the game until the game ends.
 */

export interface CompanionAbility {
  readonly type: 'companion';
  readonly source: string;
  readonly condition: string; // Deck construction requirement
  readonly isRevealed: boolean;
  readonly isPutIntoHand: boolean;
}

/**
 * Create a companion ability
 * Rule 702.139a
 * @param source - The card with companion
 * @param condition - Deck construction condition
 * @returns Companion ability object
 */
export function companion(source: string, condition: string): CompanionAbility {
  return {
    type: 'companion',
    source,
    condition,
    isRevealed: false,
    isPutIntoHand: false,
  };
}

/**
 * Reveal companion before game begins
 * Rule 702.139a
 * @param ability - Companion ability
 * @returns Updated ability
 */
export function revealCompanion(ability: CompanionAbility): CompanionAbility {
  return {
    ...ability,
    isRevealed: true,
  };
}

/**
 * Check if can put companion into hand
 * Rule 702.139a - Requires priority, empty stack, main phase
 * @param hasPriority - Whether player has priority
 * @param stackEmpty - Whether stack is empty
 * @param isMainPhase - Whether it's a main phase
 * @param alreadyUsed - Whether ability already used
 * @returns True if can use special action
 */
export function canPutCompanionIntoHand(
  hasPriority: boolean,
  stackEmpty: boolean,
  isMainPhase: boolean,
  alreadyUsed: boolean
): boolean {
  return hasPriority && stackEmpty && isMainPhase && !alreadyUsed;
}

/**
 * Put companion into hand (special action, costs {3})
 * Rule 702.139a
 * @param ability - Companion ability
 * @returns Updated ability
 */
export function putCompanionIntoHand(ability: CompanionAbility): CompanionAbility {
  return {
    ...ability,
    isPutIntoHand: true,
  };
}

/**
 * Check if companion is in hand
 * Rule 702.139c
 * @param ability - Companion ability
 * @returns True if in hand
 */
export function isCompanionInHand(ability: CompanionAbility): boolean {
  return ability.isPutIntoHand;
}

/**
 * Get companion condition
 * @param ability - Companion ability
 * @returns Deck construction condition
 */
export function getCompanionCondition(ability: CompanionAbility): string {
  return ability.condition;
}

/**
 * Multiple instances of companion are not redundant
 * @param abilities - Array of companion abilities
 * @returns False
 */
export function hasRedundantCompanion(abilities: readonly CompanionAbility[]): boolean {
  return false;
}
