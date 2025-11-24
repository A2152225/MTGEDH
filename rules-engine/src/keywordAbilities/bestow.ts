/**
 * Bestow keyword ability implementation (Rule 702.103)
 * 
 * From MTG Comprehensive Rules (Nov 2025):
 * 702.103a Bestow represents two static abilities, one that functions while the card with
 * bestow is on the stack and another that functions while it's on the battlefield. "Bestow [cost]"
 * means "You may cast this card by paying [cost] rather than its mana cost." and "If you chose
 * to pay this spell's bestow cost, it becomes an Aura enchantment and gains enchant creature.
 * These effects last until one of two things happens: this permanent becomes unattached or the
 * spell becomes a permanent." Paying a card's bestow cost follows the rules for paying alternative
 * costs in rules 601.2b and 601.2f–h.
 * 
 * 702.103b If a spell's controller chooses to pay its bestow cost, that player chooses a legal
 * target for that Aura spell as defined by its enchant ability and rule 601.2c. See also rule 303.4.
 */

/**
 * Bestow ability interface
 */
export interface BestowAbility {
  readonly type: 'bestow';
  readonly source: string;
  readonly bestowCost: string;
  readonly normalCost: string;
  readonly isBestowed: boolean;
  readonly attachedTo?: string;
}

/**
 * Creates a bestow ability
 * @param source - Source enchantment creature with bestow
 * @param bestowCost - Bestow alternative cost
 * @param normalCost - Normal mana cost
 * @returns Bestow ability
 */
export function bestow(
  source: string,
  bestowCost: string,
  normalCost: string
): BestowAbility {
  return {
    type: 'bestow',
    source,
    bestowCost,
    normalCost,
    isBestowed: false,
  };
}

/**
 * Casts with bestow cost, making it an Aura
 * @param ability - Bestow ability
 * @param target - Creature to enchant
 * @returns Updated bestow ability as Aura
 */
export function castWithBestow(
  ability: BestowAbility,
  target: string
): BestowAbility {
  return {
    ...ability,
    isBestowed: true,
    attachedTo: target,
  };
}

/**
 * Permanent becomes unattached or loses enchant creature
 * @param ability - Bestow ability
 * @returns Updated bestow ability reverting to creature
 */
export function revertToCreature(ability: BestowAbility): BestowAbility {
  return {
    ...ability,
    isBestowed: false,
    attachedTo: undefined,
  };
}

/**
 * Checks if currently an Aura (bestowed)
 * @param ability - Bestow ability
 * @returns True if currently bestowed
 */
export function isBestowed(ability: BestowAbility): boolean {
  return ability.isBestowed;
}

/**
 * Gets the enchanted creature
 * @param ability - Bestow ability
 * @returns Attached creature ID if bestowed
 */
export function getEnchantedCreature(ability: BestowAbility): string | undefined {
  return ability.attachedTo;
}
