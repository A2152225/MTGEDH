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

describe('Oracle IR gap batch 27 support', () => {
  it('parses discard-and-lose and conditional draw without unknown amount tails', () => {
    const hopeless = parseOracleTextToIR('each opponent discards a card and loses 2 life', 'Hopeless Nightmare');
    const primal = parseOracleTextToIR(
      'draw a card if you control a creature with the greatest power among creatures on the battlefield',
      'Primal Empathy'
    );
    const cosmos = parseOracleTextToIR(
      'draw a card if your life total is greater than your starting life total',
      'Cosmos Elixir'
    );

    expect(collectUnknowns(hopeless)).toEqual([]);
    expect(collectUnknowns(primal)).toEqual([]);
    expect(collectUnknowns(cosmos)).toEqual([]);
    expect(primal.abilities[0]?.steps[0]).toMatchObject({ kind: 'conditional' });
  });

  it('parses exile-until and draw-replacement quantities', () => {
    const illuna = parseOracleTextToIR(
      'exile cards from the top of your library until you exile a nonland permanent card. put that card onto the battlefield or into your hand.',
      'Illuna, Apex of Wishes'
    );
    const valueKnight = parseOracleTextToIR(
      'Until end of turn, if you would draw a card, draw two cards instead.',
      'The Value Knight'
    );

    expect(collectUnknowns(illuna)).toEqual([]);
    expect(collectUnknowns(valueKnight)).toEqual([]);
    expect(illuna.abilities[0]?.steps[0]).toMatchObject({
      kind: 'exile_top',
      amount: { kind: 'reference_amount', raw: 'until you exile a nonland permanent card' },
    });
  });

  it('parses opponent-target temporary pumps and payment riders', () => {
    const dream = parseOracleTextToIR(
      'up to one target creature an opponent controls gets -1/-1 until end of turn',
      'Dream Spoilers'
    );
    const purgatory = parseOracleTextToIR('you may pay {4} and 2 life', 'Purgatory');
    const muck = parseOracleTextToIR('that player adds an additional {b}', 'Bubbling Muck');

    expect(collectUnknowns(dream)).toEqual([]);
    expect(collectUnknowns(purgatory)).toEqual([]);
    expect(collectUnknowns(muck)).toEqual([]);
    expect(dream.abilities[0]?.steps[0]).toMatchObject({ kind: 'modify_pt', duration: 'end_of_turn' });
  });
});
