import { describe, expect, it } from 'vitest';
import { resolveEffectiveManaCostForCastStep } from '../src/components/CastSpellModal';

describe('resolveEffectiveManaCostForCastStep', () => {
  it('treats the queued normal mana cost as authoritative instead of reducing it again', () => {
    expect(resolveEffectiveManaCostForCastStep({
      selectedManaCost: '{W}',
      queuedManaCost: '{W}',
      selectedCostId: 'normal',
      costAdjustment: {
        originalManaCost: '{1}{W}',
        adjustedManaCost: '{W}',
        genericReduction: 1,
        coloredReductions: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        genericTax: 0,
        reductionMessages: ['Banneret: -{1}'],
        taxMessages: [],
        sources: [{ kind: 'reduction', message: 'Banneret: -{1}' }],
        kind: 'reduction',
      },
    })).toBe('{W}');
  });

  it('treats a forced alternate-cost payment line from the server as authoritative', () => {
    expect(resolveEffectiveManaCostForCastStep({
      selectedManaCost: '{1}{U}',
      queuedManaCost: '{1}{U}',
      selectedCostId: 'miracle',
      forcedAlternateCostId: 'miracle',
      costAdjustment: {
        originalManaCost: '{2}{U}',
        adjustedManaCost: '{1}{U}',
        genericReduction: 1,
        coloredReductions: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        genericTax: 0,
        reductionMessages: ['Cost reduction: -{1}'],
        taxMessages: [],
        sources: [{ kind: 'reduction', message: 'Cost reduction: -{1}' }],
        kind: 'reduction',
      },
    })).toBe('{1}{U}');
  });

  it('still applies reductions when the user switches to a different alternate cost in the modal', () => {
    expect(resolveEffectiveManaCostForCastStep({
      selectedManaCost: '{1}{R}',
      queuedManaCost: '{R}',
      selectedCostId: 'miracle',
      costAdjustment: {
        originalManaCost: '{1}{R}',
        adjustedManaCost: '{R}',
        genericReduction: 1,
        coloredReductions: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        genericTax: 0,
        reductionMessages: ['Ruby Medallion: -{1}'],
        taxMessages: [],
        sources: [{ kind: 'reduction', message: 'Ruby Medallion: -{1}' }],
        kind: 'reduction',
      },
    })).toBe('{R}');
  });

  it('applies generic taxes when the user switches to a different alternate cost in the modal', () => {
    expect(resolveEffectiveManaCostForCastStep({
      selectedManaCost: '{1}{U}',
      queuedManaCost: '{2}{U}',
      selectedCostId: 'miracle',
      costAdjustment: {
        originalManaCost: '{1}{U}',
        adjustedManaCost: '{2}{U}',
        genericReduction: 0,
        coloredReductions: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        genericTax: 1,
        reductionMessages: [],
        taxMessages: ['Sphere of Resistance: +{1}'],
        sources: [{ kind: 'increase', message: 'Sphere of Resistance: +{1}' }],
        kind: 'increase',
      },
    })).toBe('{2}{U}');
  });
});