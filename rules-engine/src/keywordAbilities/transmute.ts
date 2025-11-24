/**
 * Transmute keyword ability implementation (Rule 702.53)
 * @see MagicCompRules 702.53
 */

export interface TransmuteAbility {
  readonly type: 'transmute';
  readonly cost: string;
  readonly source: string;
  readonly wasActivated: boolean;
}

export function transmute(source: string, cost: string): TransmuteAbility {
  return { type: 'transmute', cost, source, wasActivated: false };
}

export function activateTransmute(ability: TransmuteAbility): TransmuteAbility {
  return { ...ability, wasActivated: true };
}

export function canTransmute(isInHand: boolean, canPlaySorcery: boolean): boolean {
  return isInHand && canPlaySorcery;
}
