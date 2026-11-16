import { describe, expect, it, vi } from 'vitest';
import {
  shouldAbortCastOnCollectEvidenceCancel,
  toCollectEvidenceAdditionalCost,
} from '../src/socket/game-actions-handlers/collectEvidenceCastContinuation.js';
import {
  paymentAlreadyResolvedPayLifeCost,
  PAY_LIFE_COST_RESOLVED_MARKER,
} from '../src/socket/game-actions-handlers/gameActionsPayLifeAdditionalCostPrompt.js';
import { CIRCLING_VULTURES_DISCARD_PREFIX, isCirclingVulturesDiscardPlayableId } from '../src/state/modules/circlingVulturesDiscardAction.js';
import { parseBlitzAdditionalCosts, parseGraveyardBestowCollectEvidence } from '../src/state/modules/blitzAdditionalCosts.js';

describe('collect evidence for graveyard bestow (Detective\'s Phoenix)', () => {
  it('maps evidence 6 onto the existing picker fields as a mandatory cost', () => {
    const phoenix = "Bestow {1}{R}{R}\nYou may cast Detective's Phoenix from your graveyard using its bestow ability. If you do, it also requires collect evidence 6.";
    const parsed = parseGraveyardBestowCollectEvidence(phoenix);
    expect(parsed).toEqual({ required: 6, mandatory: true });
    expect(toCollectEvidenceAdditionalCost(parsed!.required, parsed!.mandatory)).toEqual({
      type: 'collect_evidence',
      collectEvidenceValue: 6,
      collectEvidenceIsOptional: false,
      mandatory: true,
      amount: 6,
    });
  });

  it('aborts the cast when the player cancels a mandatory evidence picker', () => {
    expect(shouldAbortCastOnCollectEvidenceCancel({
      purpose: 'collectEvidence',
      mandatory: true,
      collectEvidenceIsOptional: false,
      minTargets: 1,
      collectEvidenceMinManaValue: 6,
    })).toBe(true);
  });

  it('declines and continues when the player cancels an optional evidence picker', () => {
    expect(shouldAbortCastOnCollectEvidenceCancel({
      purpose: 'collectEvidence',
      mandatory: false,
      collectEvidenceIsOptional: true,
      minTargets: 0,
    })).toBe(false);
  });
});

describe('Circling Vultures special-action playable id', () => {
  it('is the id the hand context-menu wires to circlingVulturesDiscard', () => {
    const playableId = `${CIRCLING_VULTURES_DISCARD_PREFIX}cv1`;
    expect(isCirclingVulturesDiscardPlayableId(playableId)).toBe(true);
    expect(playableId).toBe('vultures-discard-cv1');
  });
});

describe('Blitz pay-life additional cost and payment markers', () => {
  it('parses Tenacious Underdog pay 2 life as a pay_life extra', () => {
    expect(parseBlitzAdditionalCosts('Blitz—{1}{B}, Pay 2 life.')).toEqual([
      { type: 'pay_life', amount: 2, mandatory: true, label: 'Pay 2 life' },
    ]);
  });

  it('treats a resolved pay-life marker as already paid so the modal is not re-queued', () => {
    expect(paymentAlreadyResolvedPayLifeCost([{ [PAY_LIFE_COST_RESOLVED_MARKER]: true }])).toBe(true);
    expect(paymentAlreadyResolvedPayLifeCost([{ additionalCostPaid: true, additionalCostMethod: 'pay_life' }])).toBe(true);
    expect(paymentAlreadyResolvedPayLifeCost([{ additionalCostMethod: 'discard' }])).toBe(false);
    expect(paymentAlreadyResolvedPayLifeCost(undefined)).toBe(false);
  });
});
