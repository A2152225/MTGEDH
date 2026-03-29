/**
 * Bushido keyword ability implementation (Rule 702.45)
 * @see MagicCompRules 702.45
 */

export interface BushidoAbility {
  readonly type: 'bushido';
  readonly value: number;
  readonly source: string;
  readonly triggered: boolean;
}

export interface BushidoBonus {
  readonly power: number;
  readonly toughness: number;
}

export function bushido(source: string, value: number): BushidoAbility {
  return { type: 'bushido', value, source, triggered: false };
}

export function triggerBushido(ability: BushidoAbility): BushidoAbility {
  return { ...ability, triggered: true };
}

export function shouldTriggerBushido(
  becameBlocked: boolean,
  becameBlocking: boolean
): boolean {
  return becameBlocked || becameBlocking;
}

export function getBushidoBonus(ability: BushidoAbility): number {
  return ability.triggered ? ability.value : 0;
}

export function getBushidoStatBonus(ability: BushidoAbility): BushidoBonus {
  const bonus = getBushidoBonus(ability);

  return {
    power: bonus,
    toughness: bonus,
  };
}

export function isBushidoRedundant(): boolean {
  return false; // Rule 702.45b: Each instance triggers separately
}
