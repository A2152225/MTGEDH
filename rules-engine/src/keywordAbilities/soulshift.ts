/**
 * Soulshift keyword ability implementation (Rule 702.46)
 * @see MagicCompRules 702.46
 */

export interface SoulshiftAbility {
  readonly type: 'soulshift';
  readonly value: number;
  readonly source: string;
  readonly targetCard?: string;
}

export function soulshift(source: string, value: number): SoulshiftAbility {
  return { type: 'soulshift', value, source };
}

export function triggerSoulshift(ability: SoulshiftAbility, target?: string): SoulshiftAbility {
  return { ...ability, targetCard: target };
}

export function canReturnWithSoulshift(cardMV: number, ability: SoulshiftAbility): boolean {
  return cardMV <= ability.value;
}

/**
 * Checks whether soulshift can return the chosen card.
 * Soulshift only returns Spirit cards with mana value less than or equal to the soulshift value.
 *
 * @param ability - The soulshift ability
 * @param cardMV - The target card's mana value
 * @param isSpiritCard - Whether the target card is a Spirit
 * @returns True if the card may be returned with soulshift
 */
export function canReturnSpiritWithSoulshift(
  ability: SoulshiftAbility,
  cardMV: number,
  isSpiritCard: boolean
): boolean {
  return isSpiritCard && canReturnWithSoulshift(cardMV, ability);
}

/**
 * Creates the resolution summary for soulshift.
 *
 * @param ability - The triggered soulshift ability
 * @param cardMV - The target card's mana value
 * @param isSpiritCard - Whether the target card is a Spirit
 * @returns Return summary, or null if the target card is not eligible
 */
export function createSoulshiftReturnResult(
  ability: SoulshiftAbility,
  cardMV: number,
  isSpiritCard: boolean
): {
  source: string;
  targetCard: string;
  returnsToHand: true;
} | null {
  if (!ability.targetCard || !canReturnSpiritWithSoulshift(ability, cardMV, isSpiritCard)) {
    return null;
  }

  return {
    source: ability.source,
    targetCard: ability.targetCard,
    returnsToHand: true,
  };
}

export function isSoulshiftRedundant(): boolean {
  return false; // Rule 702.46b: Each instance triggers separately
}
