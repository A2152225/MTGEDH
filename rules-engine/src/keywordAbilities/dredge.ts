/**
 * Dredge keyword ability implementation (Rule 702.52)
 * @see MagicCompRules 702.52
 */

export interface DredgeAbility {
  readonly type: 'dredge';
  readonly value: number;
  readonly source: string;
  readonly wasDredged: boolean;
}

export function dredge(source: string, value: number): DredgeAbility {
  return { type: 'dredge', value, source, wasDredged: false };
}

export function useDredge(ability: DredgeAbility): DredgeAbility {
  return { ...ability, wasDredged: true };
}

export function canDredge(librarySize: number, ability: DredgeAbility): boolean {
  return librarySize >= ability.value;
}
