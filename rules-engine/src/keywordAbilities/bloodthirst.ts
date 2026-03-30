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

export interface BloodthirstResolution {
  readonly source: string;
  readonly eligible: boolean;
  readonly countersAdded: number;
}

export interface BloodthirstSummary {
  readonly source: string;
  readonly bloodthirstValue: number;
  readonly eligible: boolean;
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

export function canApplyBloodthirst(opponentWasDealtDamage: boolean): boolean {
  return opponentWasDealtDamage;
}

export function getBloodthirstCounters(ability: BloodthirstAbility): number {
  return ability.countersAdded;
}

export function createBloodthirstResolution(
  ability: BloodthirstAbility,
  opponentWasDealtDamage: boolean
): BloodthirstResolution {
  const resolved = resolveBloodthirst(ability, opponentWasDealtDamage);

  return {
    source: resolved.source,
    eligible: canApplyBloodthirst(opponentWasDealtDamage),
    countersAdded: resolved.countersAdded,
  };
}

export function isBloodthirstRedundant(): boolean {
  return false; // Rule 702.54b: Each instance works separately
}

export function createBloodthirstSummary(
  ability: BloodthirstAbility,
  opponentWasDealtDamage: boolean,
): BloodthirstSummary {
  const resolved = resolveBloodthirst(ability, opponentWasDealtDamage);

  return {
    source: ability.source,
    bloodthirstValue: ability.value,
    eligible: canApplyBloodthirst(opponentWasDealtDamage),
    countersAdded: resolved.countersAdded,
  };
}
