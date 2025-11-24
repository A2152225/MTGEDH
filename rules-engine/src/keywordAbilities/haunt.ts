/**
 * Haunt keyword ability implementation (Rule 702.55)
 * @see MagicCompRules 702.55
 */

export interface HauntAbility {
  readonly type: 'haunt';
  readonly source: string;
  readonly hauntedCard?: string;
  readonly triggeredOnEntry: boolean;
  readonly triggeredOnLeave: boolean;
}

export function haunt(source: string): HauntAbility {
  return {
    type: 'haunt',
    source,
    triggeredOnEntry: false,
    triggeredOnLeave: false,
  };
}

export function hauntCard(ability: HauntAbility, targetCard: string): HauntAbility {
  return { ...ability, hauntedCard: targetCard, triggeredOnEntry: true };
}

export function triggerHauntLeave(ability: HauntAbility): HauntAbility {
  return { ...ability, triggeredOnLeave: true };
}
