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

describe('Oracle IR gap batch 223 support', () => {
  it('filters high-count orphan reminder fragments from the refreshed backlog', () => {
    const fragments = [
      parseOracleTextToIR('You may choose new targets for the copy.', 'Gap Probe'),
      parseOracleTextToIR('This ability triggers only once each turn.', 'Gap Probe'),
      parseOracleTextToIR('It\'s an artifact with "{2}, Sacrifice this token: Draw a card.")', 'Gap Probe'),
      parseOracleTextToIR('This Vehicle becomes an artifact creature until end of turn.)', 'Gap Probe'),
      parseOracleTextToIR("It's still a land", 'Gap Probe'),
      parseOracleTextToIR("This spell can't be countered", 'Gap Probe'),
      parseOracleTextToIR('Put the rest on the bottom of your library in a random order.', 'Gap Probe'),
      parseOracleTextToIR('When you do, cast it for its madness cost or put it into your graveyard.)', 'Gap Probe'),
      parseOracleTextToIR('then put any number of them on the bottom and the rest on top in any order.)', 'Gap Probe'),
      parseOracleTextToIR('then shuffle.)', 'Gap Probe'),
      parseOracleTextToIR('then give each another counter of each kind already there.)', 'Gap Probe'),
    ];

    expect(collectUnknowns(fragments)).toEqual([]);
    expect(fragments.flatMap((ir) => ir.abilities)).toEqual([]);
  });
});
