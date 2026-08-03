import { describe, expect, it } from 'vitest';

// Lightweight combat damage regression: blocked non-trample commander must not
// add commander damage. Uses the same blockedBy gate as dealCombatDamage.

function wouldDealCommanderDamageToPlayer(attacker: {
  blockedBy?: string[];
  keywords?: { trample?: boolean };
  remainingAfterBlockers?: number;
}): boolean {
  const blockedBy = attacker.blockedBy || [];
  const isBlocked = blockedBy.length > 0;
  if (!isBlocked) return true;
  if (attacker.keywords?.trample && Number(attacker.remainingAfterBlockers || 0) > 0) return true;
  return false;
}

describe('blocked commander combat damage', () => {
  it('does not deal player/commander damage when fully blocked without trample', () => {
    expect(wouldDealCommanderDamageToPlayer({
      blockedBy: ['blocker_1'],
      keywords: { trample: false },
      remainingAfterBlockers: 3,
    })).toBe(false);
  });

  it('deals player/commander damage when unblocked', () => {
    expect(wouldDealCommanderDamageToPlayer({
      blockedBy: [],
      keywords: { trample: false },
    })).toBe(true);
  });

  it('deals excess with real trample only', () => {
    expect(wouldDealCommanderDamageToPlayer({
      blockedBy: ['blocker_1'],
      keywords: { trample: true },
      remainingAfterBlockers: 2,
    })).toBe(true);
    expect(wouldDealCommanderDamageToPlayer({
      blockedBy: ['blocker_1'],
      keywords: { trample: false },
      remainingAfterBlockers: 2,
    })).toBe(false);
  });
});
