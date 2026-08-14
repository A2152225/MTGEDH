export type SplitLibrarySearchPlan = {
  readonly splitDestination: true;
  readonly toBattlefield: number;
  readonly toHand: number | 'rest';
  readonly entersTapped: boolean;
};

/** Generic split-destination tutor pattern (Cultivate / Kodama's Reach / Boreas Charger). */
export function inferSplitLibrarySearchPlan(raw: string): SplitLibrarySearchPlan | null {
  const text = String(raw || '').replace(/\([^)]*\)/g, ' ').toLowerCase();
  const putsOneOntoBattlefield =
    text.includes('put one onto the battlefield')
    || text.includes('put one of them onto the battlefield');
  if (!putsOneOntoBattlefield) return null;

  const restToHand = text.includes('the rest into your hand');
  const otherToHand = text.includes('the other into your hand');
  if (!restToHand && !otherToHand) return null;

  return {
    splitDestination: true,
    toBattlefield: 1,
    toHand: restToHand ? 'rest' : 1,
    entersTapped: text.includes('battlefield tapped') || text.includes('enters tapped'),
  };
}
