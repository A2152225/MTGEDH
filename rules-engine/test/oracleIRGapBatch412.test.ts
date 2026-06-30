import { describe, expect, it } from 'vitest';
import {
  clearActivatedAbilityUsageThisTurn,
  hasOncePerTurnActivatedAbilityPendingOnStack,
  hasUsedOnceDuringEachActivatedAbilityThisTurn,
  isOnceDuringEachOfYourTurnActivatedEffect,
  markOnceDuringEachActivatedAbilityUsedThisTurn,
} from '../src/stationPermanentUtils.ts';

const BROODSHIP_EFFECT =
  'Once during each of your turns, you may cast a permanent spell from your graveyard by sacrificing a land in addition to paying its other costs.';

describe('oracle IR gap batch412 — once-per-turn Station activated abilities', () => {
  it('detects once-during-each-of-your-turns on threshold and bare effect text', () => {
    expect(isOnceDuringEachOfYourTurnActivatedEffect(BROODSHIP_EFFECT)).toBe(true);
    expect(isOnceDuringEachOfYourTurnActivatedEffect(`8+ | ${BROODSHIP_EFFECT}`)).toBe(true);
    expect(isOnceDuringEachOfYourTurnActivatedEffect('8+ | Flying')).toBe(false);
  });

  it('tracks per-ability usage on the permanent and pending stack duplicates', () => {
    const permanent: { activatedAbilityIndicesThisTurn?: Record<number, true> } = {};
    expect(hasUsedOnceDuringEachActivatedAbilityThisTurn(permanent, 0)).toBe(false);

    markOnceDuringEachActivatedAbilityUsedThisTurn(permanent, 0);
    expect(hasUsedOnceDuringEachActivatedAbilityThisTurn(permanent, 0)).toBe(true);
    expect(hasUsedOnceDuringEachActivatedAbilityThisTurn(permanent, 1)).toBe(false);

    clearActivatedAbilityUsageThisTurn(permanent);
    expect(hasUsedOnceDuringEachActivatedAbilityThisTurn(permanent, 0)).toBe(false);

    const stack = [
      { source: 'broodship_1', oncePerTurnActivated: true, activatedAbilityIndex: 0 },
    ];
    expect(hasOncePerTurnActivatedAbilityPendingOnStack(stack, 'broodship_1', 0)).toBe(true);
    expect(hasOncePerTurnActivatedAbilityPendingOnStack(stack, 'broodship_1', 1)).toBe(false);
    expect(hasOncePerTurnActivatedAbilityPendingOnStack(stack, 'other', 0)).toBe(false);
  });
});
