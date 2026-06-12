import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';

function collectUnknowns(value: unknown): unknown[] {
  const unknowns: unknown[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if ((node as any).kind === 'unknown') unknowns.push((node as any).raw ?? node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const child of Object.values(node)) walk(child);
  };
  walk(value);
  return unknowns;
}

describe('Oracle IR gap batch 226 support', () => {
  it('prunes standalone platform reminder fragments that leaked grant shells', () => {
    const fragments = [
      parseOracleTextToIR('If you cast a card this way, you still pay its costs.', 'Gap Probe'),
      parseOracleTextToIR('(If you cast a card this way, you still pay its costs.)', 'Gap Probe'),
      parseOracleTextToIR('Spend this mana only to cast spells.', 'Gap Probe'),
      parseOracleTextToIR(
        'To mill a card, put the top card of your library into your graveyard.',
        'Gap Probe'
      ),
      parseOracleTextToIR('Damage causes loss of life.', 'Gap Probe'),
    ];

    expect(collectUnknowns(fragments)).toEqual([]);
    expect(fragments.flatMap((ir) => ir.abilities)).toEqual([]);
  });

  it('keeps Sorcerous Sight cast-without-pay wiring on full card text', () => {
    const sorcerousSight = parseOracleTextToIR(
      'Look at the top card of your library. You may cast that card this turn without paying its mana cost if it\'s a spell with mana value 4 or less. (If you cast a card this way, you still pay its costs.)',
      'Sorcerous Sight'
    );

    expect(collectUnknowns(sorcerousSight)).toEqual([]);
    expect(sorcerousSight.abilities).toHaveLength(1);
    expect(sorcerousSight.abilities[0]?.steps.map((step) => step.kind)).toEqual([
      'look_top',
      'grant_static_ability',
    ]);
  });

  it('preserves enters-tapped replacement abilities without executable steps', () => {
    const moss = parseOracleTextToIR('This artifact enters tapped.', 'Moss Diamond');
    expect(moss.abilities[0]).toMatchObject({
      type: 'replacement',
      effectText: 'tapped',
      steps: [],
    });
  });
});
