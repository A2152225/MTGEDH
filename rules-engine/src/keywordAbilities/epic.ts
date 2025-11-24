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
