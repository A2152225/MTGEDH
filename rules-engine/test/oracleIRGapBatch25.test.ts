import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';

function collectUnknowns(value: unknown): string[] {
  const unknowns: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if ((node as { kind?: string }).kind === 'unknown') {
      unknowns.push(String((node as { raw?: string }).raw ?? ''));
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'raw' || key === 'text' || key === 'effectText') continue;
      walk(child);
    }
  };
  walk(value);
  return unknowns.filter(Boolean);
}

describe('Oracle IR gap batch 25 support', () => {
  it('splits gain-life-and-draw compound clauses without unknown amount tails', () => {
    const zedruu = parseOracleTextToIR(
      'At the beginning of your upkeep, you gain X life and draw X cards, where X is the number of permanents you own that your opponents control.',
      'Zedruu the Greathearted'
    );
    expect(collectUnknowns(zedruu)).toEqual([]);
    const steps = zedruu.abilities[0]?.steps || [];
    expect(steps.some((s) => s.kind === 'gain_life')).toBe(true);
    expect(steps.some((s) => s.kind === 'draw')).toBe(true);
  });

  it('parses another and that many quantity tails in tap and impulse exile', () => {
    const tapAnother = parseOracleTextToIR(
      'You may tap another untapped Citizen you control. If you do, this creature gets +1/+0 and gains lifelink until end of turn.',
      'Civil Servant'
    );
    const exileThatMany = parseOracleTextToIR(
      'Exile that many cards from the top of your library. Until end of turn, you may cast spells from among those exiled cards.',
      'Dream Pillager'
    );

    expect(collectUnknowns(tapAnother)).toEqual([]);
    expect(collectUnknowns(exileThatMany)).toEqual([]);
    expect(tapAnother.abilities[0]?.steps[0]).toMatchObject({
      kind: 'tap_matching_permanents',
      amount: { kind: 'number', value: 1 },
    });
    expect(exileThatMany.abilities[0]?.steps[0]).toMatchObject({
      kind: 'impulse_exile_top',
      amount: { kind: 'reference_amount', raw: 'that many' },
    });
  });

  it('parses remove any number of counters without unknown amount', () => {
    const lizrog = parseOracleTextToIR(
      'You may remove any number of +1/+1 counters from among creatures you control. If you do, put twice that many +1/+1 counters on this creature.',
      'Galloping Lizrog'
    );
    expect(collectUnknowns(lizrog)).toEqual([]);
    expect(lizrog.abilities[0]?.steps[0]).toMatchObject({
      kind: 'remove_counter',
      amount: { kind: 'any_number' },
      counter: '+1/+1',
    });
  });

  it('lowers residual metadata fragments for riders and keyword tails', () => {
    const samples = [
      'You get that many {E}.',
      'This ability also triggers if this permanent is in your graveyard.',
      'You may play an additional land on each of your turns.',
      'This land enters tapped.',
      'Convert it.',
      'You may choose a creature card in your hand.',
      "When you do, cast it for its madness cost or put it into your graveyard.)",
      'You get a one-time boon with "When you cast a creature spell, that creature enters the battlefield with your choice of a +1/+1 counter, a flying counter, or a lifelink counter on it."',
    ];
    for (const text of samples) {
      const parsed = parseOracleTextToIR(text, 'Residual');
      expect(collectUnknowns(parsed), text).toEqual([]);
    }
  });
});
