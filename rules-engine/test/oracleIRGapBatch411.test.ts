import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.ts';

const BROODSHIP_EFFECT =
  'Once during each of your turns, you may cast a permanent spell from your graveyard by sacrificing a land in addition to paying its other costs.';

describe('oracle IR gap batch411 — Station threshold graveyard cast activation text', () => {
  it('parses Broodship graveyard cast without the 8+ prefix', () => {
    const ir = parseOracleTextToIR(BROODSHIP_EFFECT, 'Exploration Broodship');
    expect(ir.abilities[0]?.steps?.map((step) => step.kind)).toEqual([
      'conditional',
    ]);
  });

  it('does not parse when the 8+ threshold prefix is left on the oracle line', () => {
    const ir = parseOracleTextToIR(`8+ | ${BROODSHIP_EFFECT}`, 'Exploration Broodship');
    expect(ir.abilities.length).toBe(0);
  });
});
