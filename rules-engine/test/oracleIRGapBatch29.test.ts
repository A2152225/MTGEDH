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

describe('Oracle IR gap batch 29 support', () => {
  it('parses look-at-their-hand and life-equal reference amounts', () => {
    const hand = parseOracleTextToIR('look at their hand', 'The River Warlock');
    const blitzwing = parseOracleTextToIR(
      'target opponent loses life equal to the life that player lost this turn',
      'Blitzwing, Cruel Tormentor'
    );

    expect(collectUnknowns(hand)).toEqual([]);
    expect(collectUnknowns(blitzwing)).toEqual([]);
    expect(hand.abilities[0]?.steps[0]).toMatchObject({
      kind: 'look_hand',
      who: { kind: 'target_player' },
    });
    expect(blitzwing.abilities[0]?.steps[0]).toMatchObject({
      kind: 'lose_life',
      amount: { kind: 'reference_amount', raw: 'the life that player lost this turn' },
    });
  });

  it('splits draw-and-reveal and draw-and-convert compounds', () => {
    const pact = parseOracleTextToIR('draw a card and reveal it', 'Pact Weapon');
    const prowl = parseOracleTextToIR('you draw a card and convert this permanent', 'Prowl, Stoic Strategist');

    expect(collectUnknowns(pact)).toEqual([]);
    expect(collectUnknowns(prowl)).toEqual([]);
    expect(pact.abilities[0]?.steps.some((s) => s.kind === 'draw')).toBe(true);
    expect(prowl.abilities[0]?.steps.some((s) => s.kind === 'draw')).toBe(true);
  });

  it('parses malformed draw-a-card-quote-until-end-of-turn oracle text', () => {
    const ir = parseOracleTextToIR('draw a card" until end of turn', 'Game Knights Live');
    expect(collectUnknowns(ir)).toEqual([]);
    expect(ir.abilities[0]?.steps[0]).toMatchObject({
      kind: 'draw',
      amount: { kind: 'number', value: 1 },
    });
  });

  it('lowers spellbook, hand-size, incubate, and favorite-creature riders', () => {
    const samples = [
      "draft a card from this creature's spellbook",
      'you may pay any amount of life',
      'your maximum hand size is five',
      'then incubate x, where x is the number of creature cards in your graveyard',
      'your favorite creatures get +1/+0',
      'you get {e} for each creature you control',
    ];
    for (const text of samples) {
      expect(collectUnknowns(parseOracleTextToIR(text, 'Test')), text).toEqual([]);
    }
  });
});
