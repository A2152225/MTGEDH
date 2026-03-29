/**
 * Epic keyword ability implementation (Rule 702.50)
 * @see MagicCompRules 702.50
 */

export interface EpicAbility {
  readonly type: 'epic';
  readonly source: string;
  readonly isActive: boolean;
  readonly copiesCreated: number;
}

export function epic(source: string): EpicAbility {
  return { type: 'epic', source, isActive: false, copiesCreated: 0 };
}

export function resolveEpic(ability: EpicAbility): EpicAbility {
  return { ...ability, isActive: true };
}

export function createEpicCopy(ability: EpicAbility): EpicAbility {
  return { ...ability, copiesCreated: ability.copiesCreated + 1 };
}

/**
 * Checks whether epic's upkeep copy trigger is active.
 *
 * @param ability - The epic ability
 * @returns True if epic has resolved and should create upkeep copies
 */
export function canCreateEpicCopy(ability: EpicAbility): boolean {
  return ability.isActive;
}

/**
 * Creates the upkeep-copy resolution summary for epic.
 *
 * @param ability - The epic ability
 * @returns Copy summary, or null if epic is not active yet
 */
export function createEpicUpkeepResult(
  ability: EpicAbility
): {
  source: string;
  copiesCreatedThisUpkeep: 1;
  totalCopiesCreated: number;
} | null {
  if (!canCreateEpicCopy(ability)) {
    return null;
  }

  const updatedAbility = createEpicCopy(ability);
  return {
    source: ability.source,
    copiesCreatedThisUpkeep: 1,
    totalCopiesCreated: updatedAbility.copiesCreated,
  };
}
