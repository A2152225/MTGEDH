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

describe('Oracle IR gap batch 30 support', () => {
  it('parses reference damage and life amounts', () => {
    const fear = parseOracleTextToIR(
      'this creature deals that amount of damage to target creature that player controls',
      'Fear of Burning Alive'
    );
    const wall = parseOracleTextToIR(
      'you gain life equal to the power of target creature you control',
      'Wall of Reverence'
    );

    expect(collectUnknowns(fear)).toEqual([]);
    expect(collectUnknowns(wall)).toEqual([]);
    expect(fear.abilities[0]?.steps[0]).toMatchObject({
      kind: 'deal_damage',
      amount: { kind: 'reference_amount', raw: 'that amount of' },
    });
    expect(wall.abilities[0]?.steps[0]).toMatchObject({
      kind: 'gain_life',
      amount: { kind: 'object_stat', subject: 'target_creature_you_control', stat: 'power' },
    });
  });

  it('splits draw-and-sacrifice and discard-lose-sacrifice compounds', () => {
    const rankle = parseOracleTextToIR('draw a card and sacrifices a creature', 'Rankle, Pitiless Trickster');
    const greed = parseOracleTextToIR(
      'you discard a card, lose 2 life, and sacrifice a creature',
      "Greed's Gambit"
    );

    expect(collectUnknowns(rankle)).toEqual([]);
    expect(collectUnknowns(greed)).toEqual([]);
    expect(rankle.abilities[0]?.steps.some((s) => s.kind === 'draw')).toBe(true);
    expect(rankle.abilities[0]?.steps.some((s) => s.kind === 'sacrifice')).toBe(true);
    expect(greed.abilities[0]?.steps.map((s) => s.kind)).toEqual(['discard', 'lose_life', 'sacrifice']);
  });

  it('parses word-number mill amounts and quote draw tails', () => {
    const ulamog = parseOracleTextToIR('mill twenty', 'Ulamog, the Ceaseless Hunger');
    const leuko = parseOracleTextToIR('draw two cards" until end of turn', 'Mighty Servant of Leuk-o');

    expect(collectUnknowns(ulamog)).toEqual([]);
    expect(collectUnknowns(leuko)).toEqual([]);
    expect(ulamog.abilities[0]?.steps[0]).toMatchObject({
      kind: 'mill',
      amount: { kind: 'number', value: 20 },
    });
    expect(leuko.abilities[0]?.steps[0]).toMatchObject({
      kind: 'draw',
      amount: { kind: 'number', value: 2 },
    });
  });
});
