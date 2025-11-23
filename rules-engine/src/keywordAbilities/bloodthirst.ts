/**
 * Bloodthirst keyword ability implementation (Rule 702.54)
 * @see MagicCompRules 702.54
 */

export interface BloodthirstAbility {
  readonly type: 'bloodthirst';
  readonly value: number;
  readonly source: string;
  readonly countersAdded: number;
}

export function bloodthirst(source: string, value: number): BloodthirstAbility {
  return { type: 'bloodthirst', value, source, countersAdded: 0 };
}

export function resolveBloodthirst(ability: BloodthirstAbility, opponentWasDealtDamage: boolean): BloodthirstAbility {
  return {
    ...ability,
    countersAdded: opponentWasDealtDamage ? ability.value : 0,
  };
}

export function isBloodthirstRedundant(): boolean {
  return false; // Rule 702.54b: Each instance works separately
}
