const STACK_LEAVE_EXILE_ABILITIES = new Set(['flashback', 'jump-start', 'escape', 'disturb', 'harmonize']);

export function shouldExileStackCardInsteadOfGraveyard(stackItem: any): boolean {
  if (!stackItem) return false;

  const castWithAbility = String(
    stackItem?.card?.castWithAbility
      || stackItem?.castWithAbility
      || stackItem?.alternativeCost
      || ''
  ).trim().toLowerCase();

  return stackItem?.exileAfterResolution === true
    || stackItem?.card?.exileAfterResolution === true
    || stackItem?.card?.card?.exileAfterResolution === true
    || STACK_LEAVE_EXILE_ABILITIES.has(castWithAbility);
}