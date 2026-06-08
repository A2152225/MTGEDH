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

describe('Oracle IR gap batch 28 support', () => {
  it('splits target-player draw-and-lose compounds', () => {
    const twoCards = parseOracleTextToIR('target player draws two cards and loses 2 life', 'Unscrupulous Contractor');
    const oneCard = parseOracleTextToIR('target player draws a card and loses 1 life', 'Vault Plunderer');

    expect(collectUnknowns(twoCards)).toEqual([]);
    expect(collectUnknowns(oneCard)).toEqual([]);
    const steps = twoCards.abilities[0]?.steps || [];
    expect(steps.some((s) => s.kind === 'draw')).toBe(true);
    expect(steps.some((s) => s.kind === 'lose_life')).toBe(true);
  });

  it('parses draw-replacement tails with trailing quotes', () => {
    const quoted = parseOracleTextToIR(
      'Until end of turn, if you would draw a card, draw two cards instead."',
      'The Value Knight'
    );
    expect(collectUnknowns(quoted)).toEqual([]);
    expect(quoted.abilities[0]?.steps[0]).toMatchObject({
      kind: 'draw',
      replacementOf: 'draw_card',
    });
  });

  it('lowers investigate, hand-size, and keyword metadata riders', () => {
    const samples = [
      'each opponent may investigate',
      'your maximum hand size is two',
      'you may reveal that card',
      'the player with the most life',
      'the heroes lose 1 life',
      'you investigate x times, where x is one plus the number of opponents who investigated this way',
    ];
    for (const text of samples) {
      expect(collectUnknowns(parseOracleTextToIR(text, 'Test')), text).toEqual([]);
    }
  });
});
