import { describe, expect, it } from 'vitest';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { calculateDevotion } from '../src/winEffectCards';
import {
  evaluateDevotionReference,
  evaluateDevotionThreshold,
  parseDevotionThreshold,
} from '../../shared/src/devotionReference.js';

function makeState() {
  return {
    players: [{ id: 'p1', life: 20 }, { id: 'p2', life: 20 }],
    battlefield: [
      { id: 'a', controller: 'p1', owner: 'p1', card: { name: 'A', type_line: 'Creature', mana_cost: '{B}{B}{W/B}{2/B}{B/P}', power: '1', toughness: '1' } },
      { id: 'g', controller: 'p1', owner: 'p1', card: { name: 'G', type_line: 'Creature', mana_cost: '{1}{G}{G}', power: '1', toughness: '1' } },
      { id: 'ph', controller: 'p1', owner: 'p1', phasedOut: true, card: { name: 'Phased', type_line: 'Creature', mana_cost: '{B}{B}{B}', power: '1', toughness: '1' } },
      { id: 'x', controller: 'p2', owner: 'p2', card: { name: 'X', type_line: 'Creature', mana_cost: '{B}{B}', power: '1', toughness: '1' } },
    ],
    zones: { p1: { hand: [], graveyard: [], exile: [] }, p2: { hand: [], graveyard: [], exile: [] } },
    manaPool: {},
  } as any;
}

function run(text: string, extraCtx: Record<string, unknown> = {}) {
  const steps = parseOracleTextToIR(text, 'Probe').abilities.flatMap((a: any) => a.steps);
  const ctx = buildOracleIRExecutionContext({ controllerId: 'p1', sourceName: 'Probe', sourceId: 'a', ...extraCtx } as any);
  return applyOracleIRStepsToGameState(makeState(), steps as any, ctx).state as any;
}

describe('generic devotion (CR 700.5)', () => {
  it('counts hybrid, two-brid and Phyrexian symbols once, skips phased-out and opponents', () => {
    const bf = makeState().battlefield;
    expect(evaluateDevotionReference(bf, 'p1', 'your devotion to black')).toBe(5);
    expect(evaluateDevotionReference(bf, 'p1', 'x is your devotion to white and black')).toBe(5);
    expect(evaluateDevotionReference(bf, 'p1', 'your devotion to black and green')).toBe(7);
    expect(calculateDevotion('p1' as any, 'B', bf)).toBe(5);
  });

  it('parses threshold clauses', () => {
    expect(parseDevotionThreshold("as long as your devotion to red and white is less than seven, iroas isn't a creature"))
      .toEqual({ colors: ['R', 'W'], comparison: 'less_than', amount: 7 });
    const bf = makeState().battlefield;
    expect(evaluateDevotionThreshold(bf, 'p1', 'if your devotion to white and black is five or greater')).toBe(true);
    expect(evaluateDevotionThreshold(bf, 'p1', 'if your devotion to black is seven or greater')).toBe(false);
  });

  it('Gray Merchant drains by devotion to black', () => {
    const state = run('When Gray Merchant of Asphodel enters, each opponent loses X life, where X is your devotion to black. You gain life equal to the life lost this way.');
    expect(state.players.find((p: any) => p.id === 'p2').life).toBe(15);
    expect(state.players.find((p: any) => p.id === 'p1').life).toBe(25);
  });

  it('multicolor devotion pump', () => {
    const state = run('Target creature gets +X/+X until end of turn, where X is your devotion to white and black.', { targetCreatureId: 'g' });
    expect(state.battlefield.find((p: any) => p.id === 'g').effectivePower).toBe(6);
  });

  it('add mana equal to devotion to any color', () => {
    const state = run('{T}: Add an amount of {B} equal to your devotion to black.');
    expect(state.manaPool.p1.black).toBe(5);
  });
});
