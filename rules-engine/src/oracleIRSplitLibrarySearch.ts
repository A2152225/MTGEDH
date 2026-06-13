export type SplitLibrarySearchPlan = {
  readonly splitDestination: true;
  readonly toBattlefield: number;
  readonly toHand: number;
  readonly entersTapped: boolean;
};

/** Generic split-destination tutor pattern (Cultivate / Kodama's Reach style). */
export function inferSplitLibrarySearchPlan(raw: string): SplitLibrarySearchPlan | null {
  const text = String(raw || '').replace(/\([^)]*\)/g, ' ').toLowerCase();
  if (
    !text.includes('put one onto the battlefield')
    || !text.includes('the other into your hand')
  ) {
    return null;
  }

  return {
    splitDestination: true,
    toBattlefield: 1,
    toHand: 1,
    entersTapped: text.includes('battlefield tapped') || text.includes('enters tapped'),
  };
}
