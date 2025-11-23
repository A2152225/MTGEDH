/**
 * Ninjutsu keyword ability implementation (Rule 702.49)
 * @see MagicCompRules 702.49
 */

export interface NinjutsuAbility {
  readonly type: 'ninjutsu';
  readonly cost: string;
  readonly source: string;
  readonly returnedCreature?: string;
}

export function ninjutsu(source: string, cost: string): NinjutsuAbility {
  return { type: 'ninjutsu', cost, source };
}

export function activateNinjutsu(ability: NinjutsuAbility, returnedCreature: string): NinjutsuAbility {
  return { ...ability, returnedCreature };
}

export function canActivateNinjutsu(hasUnblockedAttacker: boolean, inCombat: boolean): boolean {
  return hasUnblockedAttacker && inCombat;
}
