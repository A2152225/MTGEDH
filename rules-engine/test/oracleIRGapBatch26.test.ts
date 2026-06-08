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

describe('Oracle IR gap batch 26 support', () => {
  it('lowers transform, heist, exile-rider, and chaos fragments', () => {
    const samples = [
      'You may transform it.',
      'You may transform this creature.',
      "Heist target opponent's library.",
      'This ability also triggers if this permanent is in exile.',
      'Chaos ensues.',
      'Unattach it.',
    ];
    for (const text of samples) {
      expect(collectUnknowns(parseOracleTextToIR(text, 'Test')), text).toEqual([]);
    }
  });

  it('lowers perpetual modifiers and acorn counter grants', () => {
    const perpetual = parseOracleTextToIR('This creature perpetually gets +1/+0.', 'Longtusk Stalker');
    const targetPerpetual = parseOracleTextToIR('Target creature you control perpetually gets +1/+0.', 'Valiant Emberkin');
    const acorn = parseOracleTextToIR('You get {a}.', 'Acornelia, Fashionable Filcher');

    expect(collectUnknowns(perpetual)).toEqual([]);
    expect(collectUnknowns(targetPerpetual)).toEqual([]);
    expect(collectUnknowns(acorn)).toEqual([]);
    expect(perpetual.abilities[0]?.steps.length).toBeGreaterThan(0);
    expect(perpetual.abilities[0]?.steps[0]).toMatchObject({ kind: 'grant_static_ability' });
    expect(acorn.abilities[0]?.steps[0]).toMatchObject({ kind: 'grant_static_ability' });
  });

  it('splits draw-and-lose-life orphan fragments', () => {
    const parsed = parseOracleTextToIR('a card and loses 2', 'Hopeless Nightmare');
    expect(collectUnknowns(parsed)).toEqual([]);
    const steps = parsed.abilities[0]?.steps || [];
    expect(steps.some((s) => s.kind === 'draw')).toBe(true);
    expect(steps.some((s) => s.kind === 'lose_life')).toBe(true);
  });

  it('parses seek and play-permission riders', () => {
    const seek = parseOracleTextToIR('then seeks that many nonland cards', 'Chaos Balor');
    const play = parseOracleTextToIR('until the end of your next turn, you may play that card', 'Rooting Moloch');
    expect(collectUnknowns(seek)).toEqual([]);
    expect(collectUnknowns(play)).toEqual([]);
  });
});
