import { describe, expect, it } from 'vitest';

/**
 * Mirrors TableLayout / PlayerStatusBar poison lookup from server view.poisonCounters.
 * App.tsx passes `(safeView as any).poisonCounters` into TableLayout.
 */
export function getDisplayedPoisonCount(
  poisonCounters: Record<string, number> | undefined,
  playerId: string,
): number {
  return poisonCounters?.[playerId] ?? 0;
}

describe('poison counter display contract', () => {
  it('shows zero when poisonCounters is absent', () => {
    expect(getDisplayedPoisonCount(undefined, 'p2')).toBe(0);
  });

  it('reads defending player poison after infect combat (Rot Wolf server view shape)', () => {
    const viewPoisonCounters = { p1: 0, p2: 2 };
    expect(getDisplayedPoisonCount(viewPoisonCounters, 'p2')).toBe(2);
    expect(getDisplayedPoisonCount(viewPoisonCounters, 'p1')).toBe(0);
  });

  it('treats missing player entry as zero', () => {
    expect(getDisplayedPoisonCount({ p1: 3 }, 'p2')).toBe(0);
  });
});
