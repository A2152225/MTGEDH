import { afterEach, describe, expect, it } from 'vitest';
import {
  decideRedundantFreeSpellPayment,
  resetRedundantFreeSpellPaymentMemory,
} from '../src/utils/redundantFreeSpellPayment';

const freeStep = {
  id: 'pay-1',
  type: 'mana_payment_choice',
  spellPaymentRequired: true,
  forcedAlternateCostId: 'free',
  castWithoutPayingManaCost: true,
  manaCost: '{0}',
  effectId: 'effect-storm',
  xValue: 0,
};

describe('redundant free spell payment', () => {
  afterEach(() => {
    resetRedundantFreeSpellPaymentMemory();
  });

  it('submits the first empty free-cast payment and ignores a duplicate of that step', () => {
    const first = decideRedundantFreeSpellPayment(freeStep);
    expect(first.decision).toBe('submit');
    expect(first.stepId).toBe('pay-1');
    expect(first.selections).toEqual({ alternateCostId: 'free', xValue: 0 });

    expect(decideRedundantFreeSpellPayment(freeStep).decision).toBe('suppress');
  });

  it('shows a re-queued payment for the same cast', () => {
    expect(decideRedundantFreeSpellPayment(freeStep).decision).toBe('submit');
    expect(decideRedundantFreeSpellPayment({ ...freeStep, id: 'pay-2' }).decision).toBe('show');
  });

  it('leaves ordinary and optional free costs on the payment modal', () => {
    expect(decideRedundantFreeSpellPayment({
      ...freeStep,
      forcedAlternateCostId: undefined,
      manaCost: '{1}{R}',
    }).decision).toBe('ignore');
    expect(decideRedundantFreeSpellPayment({
      ...freeStep,
      id: 'ward',
      effectId: 'ward',
      wardPayment: true,
    }).decision).toBe('ignore');
    expect(decideRedundantFreeSpellPayment({
      ...freeStep,
      id: 'still-mana',
      effectId: 'still-mana',
      manaCost: '{2}',
    }).decision).toBe('ignore');
  });
});
