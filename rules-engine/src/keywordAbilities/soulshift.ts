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

export function isSoulshiftRedundant(): boolean {
  return false; // Rule 702.46b: Each instance triggers separately
}
