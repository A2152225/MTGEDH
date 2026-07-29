import { describe, expect, it } from 'vitest';
import { parseAlternateCosts, resolveEffectiveManaCostForCastStep } from '../src/components/CastSpellModal';

describe('resolveEffectiveManaCostForCastStep', () => {
  it('parses warp alternate cost from oracle text', () => {
    const oracleText =
      'Flying, lifelink\nIf one or more tokens would be created under your control, twice that many of those tokens are created instead.\nWarp {1}{W} (You may cast this card from your hand for its warp cost. Exile this creature at the beginning of the next end step, then you may cast it from exile on a later turn.)';
    const costs = parseAlternateCosts(oracleText, '{3}{W}{W}', 'Exalted Sunborn');
    const warp = costs.find((cost) => cost.id === 'warp');
    expect(warp).toMatchObject({
      id: 'warp',
      label: 'Warp',
      manaCost: '{1}{W}',
    });
    expect(costs.some((cost) => cost.id === 'normal')).toBe(true);
  });

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

  it('parses self-WUBRG alternate cost from oracle text', () => {
    const oracleText = 'You may pay {W}{U}{B}{R}{G} rather than pay this spell\'s mana cost.';
    const costs = parseAlternateCosts(oracleText, '{7}', 'Bringer of the White Dawn');
    expect(costs.find((cost) => cost.id === 'wubrg_self')).toMatchObject({
      id: 'wubrg_self',
      manaCost: '{W}{U}{B}{R}{G}',
    });
  });

  it('reduces warp cost when Pearl Medallion is on the battlefield', () => {
    expect(resolveEffectiveManaCostForCastStep({
      selectedManaCost: '{1}{W}',
      queuedManaCost: '{4}{W}',
      selectedCostId: 'warp',
      costAdjustment: {
        originalManaCost: '{3}{W}{W}',
        adjustedManaCost: '{4}{W}',
        genericReduction: 1,
        coloredReductions: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        genericTax: 0,
        reductionMessages: ['Pearl Medallion: -{1} (white)'],
        taxMessages: [],
        sources: [{ kind: 'reduction', message: 'Pearl Medallion: -{1} (white)' }],
        kind: 'reduction',
      },
    })).toBe('{W}');
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

  it('surfaces common keyword alternate costs from oracle text', () => {
    const costs = parseAlternateCosts(
      [
        'Flashback {3}{U}',
        'Overload {6}{R}',
        'Surge {1}{R}',
        'Spectacle {R}',
        'Mutate {2}{G}{G}',
        'Dash {1}{R}',
        'Evoke {1}{U}',
        'Madness {B}',
        'Miracle {U}',
        'Prowl {1}{B}',
        'Bestow {3}{W}',
        'Emerge {6}{U}',
        'Blitz {2}{B}',
        'Sneak {1}{R}',
        'Warp {2}{U}',
        'Disturb {2}{B}',
      ].join('\n'),
      '{4}',
      'Keyword Soup',
    );

    const ids = costs.map((c) => c.id);
    for (const id of [
      'normal',
      'flashback',
      'overload',
      'surge',
      'spectacle',
      'mutate',
      'dash',
      'evoke',
      'madness',
      'miracle',
      'prowl',
      'bestow',
      'emerge',
      'blitz',
      'sneak',
      'warp',
      'disturb',
    ]) {
      expect(ids).toContain(id);
    }
  });

  it('offers Free Cast for commander-gated free spells with a clear description', () => {
    const costs = parseAlternateCosts(
      'If you control a commander, you may cast this spell without paying its mana cost.\nCounter target noncreature spell.',
      '{2}{U}',
      'Fierce Guardianship',
    );
    expect(costs.find((c) => c.id === 'free')).toMatchObject({
      id: 'free',
      manaCost: '{0}',
      description: 'Cast for free (you control a commander)',
    });
  });

  it('offers Force of Will style alternate cost', () => {
    const costs = parseAlternateCosts(
      'You may pay 1 life and exile a blue card from your hand rather than pay this spell\'s mana cost.\nCounter target spell.',
      '{3}{U}{U}',
      'Force of Will',
    );
    expect(costs.find((c) => c.id === 'force_of_will')).toMatchObject({
      id: 'force_of_will',
      manaCost: '{0}',
    });
  });
});
