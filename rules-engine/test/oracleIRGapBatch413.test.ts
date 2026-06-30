import { describe, expect, it } from 'vitest';
import {
  hasExhaustedOnceDuringEachGraveyardCastActivation,
  isOnceDuringEachOfYourTurnActivatedEffect,
} from '../src/stationPermanentUtils.ts';

describe('oracle IR gap batch413 — once-per-turn graveyard cast exhaustion', () => {
  it('treats castFromGraveyardThisTurn and activatedAbilityIndicesThisTurn as exhausted', () => {
    const permanent: { activatedAbilityIndicesThisTurn?: Record<number, true> } = {};
    const state = { castFromGraveyardThisTurn: {} as Record<string, boolean> };

    expect(hasExhaustedOnceDuringEachGraveyardCastActivation(permanent, state, 'p1')).toBe(false);

    state.castFromGraveyardThisTurn.p1 = true;
    expect(hasExhaustedOnceDuringEachGraveyardCastActivation(permanent, state, 'p1')).toBe(true);

    delete state.castFromGraveyardThisTurn.p1;
    permanent.activatedAbilityIndicesThisTurn = { 0: true };
    expect(hasExhaustedOnceDuringEachGraveyardCastActivation(permanent, state, 'p1')).toBe(true);
  });

  it('matches Broodship-style continuation-line effect text', () => {
    const effect =
      'Once during each of your turns, you may cast a permanent spell from your graveyard by sacrificing a land in addition to paying its other costs.';
    expect(isOnceDuringEachOfYourTurnActivatedEffect(effect)).toBe(true);
    expect(isOnceDuringEachOfYourTurnActivatedEffect(`8+ | ${effect}`)).toBe(true);
  });
});
