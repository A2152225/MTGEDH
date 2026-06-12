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

describe('Oracle IR gap batch 225 support', () => {
  it('prunes standalone otherwise hand and graveyard tail fragments', () => {
    const fragments = [
      parseOracleTextToIR('Otherwise, put it into your hand.', 'Gap Probe'),
      parseOracleTextToIR('Otherwise, put it into your graveyard.', 'Gap Probe'),
      parseOracleTextToIR('Otherwise, you may put it into your graveyard.', 'Gap Probe'),
    ];

    expect(collectUnknowns(fragments)).toEqual([]);
    expect(fragments.flatMap((ir) => ir.abilities)).toEqual([]);
  });

  it('keeps otherwise branches on full card oracle text', () => {
    const darkConfidant = parseOracleTextToIR(
      'At the beginning of your upkeep, reveal the top card of your library and put that card into your hand. You lose life equal to its mana value.',
      'Dark Confidant'
    );
    expect(collectUnknowns(darkConfidant)).toEqual([]);
    expect(darkConfidant.abilities).toHaveLength(1);
    expect(darkConfidant.abilities[0]?.steps.map((step) => step.kind)).toEqual([
      'reveal_top',
      'move_zone',
      'lose_life',
    ]);

    const evolutionaryLeap = parseOracleTextToIR(
      '{1}, Sacrifice a creature: Reveal cards from the top of your library until you reveal a creature card. Put that card into your hand and the rest on the bottom of your library in a random order.',
      'Evolutionary Leap'
    );
    expect(collectUnknowns(evolutionaryLeap)).toEqual([]);
    expect(evolutionaryLeap.abilities[0]?.steps.map((step) => step.kind)).toEqual([
      'reveal_top',
      'move_zone',
    ]);
  });
});
