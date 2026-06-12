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

describe('Oracle IR gap batch 229 support', () => {
  it('prunes partner-with placeholder reminder fragments', () => {
    const fragment = parseOracleTextToIR('Partner with [name]', 'Gap Probe');
    expect(collectUnknowns(fragment)).toEqual([]);
    expect(fragment.abilities).toEqual([]);
  });

  it('keeps full partner-with reminder text as a non-executable static ability shell', () => {
    const leyWeaver = parseOracleTextToIR(
      'Partner with Lore Weaver (When this creature enters the battlefield, target player may put Lore Weaver into their hand from their library, then shuffle.)',
      'Ley Weaver'
    );

    expect(collectUnknowns(leyWeaver)).toEqual([]);
    expect(leyWeaver.abilities).toHaveLength(1);
    expect(leyWeaver.abilities[0]).toMatchObject({
      type: 'static',
      steps: [],
    });
  });

  it('keeps foretell keyword shells on full reminder oracle text', () => {
    const behold = parseOracleTextToIR(
      'Foretell {1}{U} (During your turn, you may pay {2} and exile this card from your hand face down. Cast it on a later turn for its foretell cost.)',
      'Behold the Multiverse'
    );

    expect(collectUnknowns(behold)).toEqual([]);
    expect(behold.abilities).toHaveLength(1);
    expect(behold.abilities[0]).toMatchObject({
      type: 'keyword',
      cost: '{1}{U}',
      steps: [],
    });
  });
});
