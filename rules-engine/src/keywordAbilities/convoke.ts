/**
 * Convoke keyword ability implementation (Rule 702.51)
 * @see MagicCompRules 702.51
 */

export interface ConvokeAbility {
  readonly type: 'convoke';
  readonly source: string;
  readonly tappedCreatures: readonly string[];
}

export function convoke(source: string): ConvokeAbility {
  return { type: 'convoke', source, tappedCreatures: [] };
}

export function payConvoke(ability: ConvokeAbility, creatures: readonly string[]): ConvokeAbility {
  return { ...ability, tappedCreatures: creatures };
}

export function getConvokeReduction(ability: ConvokeAbility): number {
  return ability.tappedCreatures.length;
}
