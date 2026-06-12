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

describe('Oracle IR gap batch 228 support', () => {
  it('prunes standalone madness and flashback reminder tail fragments', () => {
    const fragments = [
      parseOracleTextToIR('If you discard a card with madness, discard it into exile.', 'Gap Probe'),
      parseOracleTextToIR('You may cast this card from your graveyard for its flashback cost.', 'Gap Probe'),
      parseOracleTextToIR(
        '(You may cast this card from your graveyard for its flashback cost. Then exile it.)',
        'Gap Probe'
      ),
      parseOracleTextToIR('Then exile it.', 'Gap Probe'),
    ];

    expect(collectUnknowns(fragments)).toEqual([]);
    expect(fragments.flatMap((ir) => ir.abilities)).toEqual([]);
  });

  it('keeps flashback keyword wiring on full card oracle text', () => {
    const faithlessLooting = parseOracleTextToIR(
      'Draw two cards, then discard two cards. Flashback {2}{R}',
      'Faithless Looting'
    );

    expect(collectUnknowns(faithlessLooting)).toEqual([]);
    expect(faithlessLooting.abilities[1]?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'grant_graveyard_permission', permission: 'cast' }),
        expect.objectContaining({ kind: 'modify_graveyard_permissions', castCostRaw: '{2}{R}' }),
      ])
    );
  });

  it('preserves enters-tapped replacement abilities without executable steps', () => {
    const fastland = parseOracleTextToIR(
      'This land enters tapped unless you control two or fewer other lands.',
      'Concealed Courtyard'
    );
    expect(fastland.abilities[0]).toMatchObject({
      type: 'replacement',
      effectText: 'tapped unless you control two or fewer other lands',
      steps: [],
    });
  });
});
