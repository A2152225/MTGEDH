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

export function canHauntCard(targetCard: string | undefined): boolean {
  return typeof targetCard === 'string' && targetCard.length > 0;
}

export function hauntCard(ability: HauntAbility, targetCard: string): HauntAbility {
  if (!canHauntCard(targetCard)) {
    return ability;
  }

  return { ...ability, hauntedCard: targetCard, triggeredOnEntry: true };
}

export function isHauntingCard(ability: HauntAbility): boolean {
  return canHauntCard(ability.hauntedCard);
}

export function shouldTriggerHauntLeave(ability: HauntAbility, leavingCardId: string): boolean {
  return ability.hauntedCard === leavingCardId;
}

export function clearHaunt(ability: HauntAbility): HauntAbility {
  return {
    ...ability,
    hauntedCard: undefined,
    triggeredOnLeave: false,
  };
}

export function triggerHauntLeave(ability: HauntAbility, leavingCardId?: string): HauntAbility {
  if (!isHauntingCard(ability)) {
    return ability;
  }

  if (leavingCardId !== undefined && !shouldTriggerHauntLeave(ability, leavingCardId)) {
    return ability;
  }

  return { ...ability, triggeredOnLeave: true };
}
