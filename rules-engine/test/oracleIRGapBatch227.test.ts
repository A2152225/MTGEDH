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

describe('Oracle IR gap batch 227 support', () => {
  it('prunes standalone platform reminder fragments that leaked executable shells', () => {
    const fragments = [
      parseOracleTextToIR('You may cast the copy without paying its mana cost.', 'Gap Probe'),
      parseOracleTextToIR('Spend this mana only on costs that contain {X}.', 'Gap Probe'),
      parseOracleTextToIR('Spend this mana only to cast creature spells.', 'Gap Probe'),
      parseOracleTextToIR('Draw an additional card.', 'Gap Probe'),
      parseOracleTextToIR('Activated abilities cost {1} less to activate.', 'Gap Probe'),
    ];

    expect(collectUnknowns(fragments)).toEqual([]);
    expect(fragments.flatMap((ir) => ir.abilities)).toEqual([]);
  });

  it('keeps graveyard copy-spell replay wiring on full card text', () => {
    const psionicRitual = parseOracleTextToIR(
      'Exile target instant or sorcery card from a graveyard and copy it. You may cast the copy without paying its mana cost.',
      'Psionic Ritual'
    );

    expect(collectUnknowns(psionicRitual)).toEqual([]);
    expect(psionicRitual.abilities[0]?.steps).toEqual([
      expect.objectContaining({
        kind: 'move_zone',
        to: 'exile',
      }),
      expect.objectContaining({
        kind: 'copy_spell',
        withoutPayingManaCost: true,
      }),
    ]);
  });

  it('preserves Mystic Forge look-top static wiring on full card text', () => {
    const mysticForge = parseOracleTextToIR(
      'You may look at the top card of your library any time.\nYou may cast nonland cards from the top of your library.',
      'Mystic Forge'
    );

    expect(collectUnknowns(mysticForge)).toEqual([]);
    expect(mysticForge.abilities.some((ability) => ability.steps.some((step) => step.kind === 'look_top'))).toBe(
      true
    );
  });
});
