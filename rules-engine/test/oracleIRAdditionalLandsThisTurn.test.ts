import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { parseAdditionalLandsThisTurnCount } from '../src/oracleIRExecutorAdditionalLandsThisTurn';
import type { GameState } from '../../shared/src/index.js';

// Quoted from oracle-cards.jsonl / mtg_data.db (is_token = 0).
const SUMMER_BLOOM_ORACLE = 'You may play up to three additional lands this turn.';
const EXPLORE_ORACLE = 'You may play an additional land this turn.\nDraw a card.';

function makeState(): GameState {
  return {
    id: 'additional-lands-this-turn',
    format: 'commander',
    players: [
      { id: 'p1', name: 'P1', seat: 0, life: 40, library: [], hand: [], graveyard: [] },
      { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [] },
    ],
    battlefield: [],
    stack: [],
    turnPlayer: 'p1',
    priority: 'p1',
    turn: 1,
    turnNumber: 1,
    active: true,
    landsPlayedThisTurn: { p1: 1 },
  } as unknown as GameState;
}

describe('oracle IR additional lands this turn', () => {
  it('parses Summer Bloom / Explore this-turn counts', () => {
    expect(parseAdditionalLandsThisTurnCount(SUMMER_BLOOM_ORACLE)).toBe(3);
    expect(parseAdditionalLandsThisTurnCount('You may play an additional land this turn.')).toBe(1);
    expect(parseAdditionalLandsThisTurnCount('You may play two additional lands this turn.')).toBe(2);
    expect(parseAdditionalLandsThisTurnCount('You may play an additional land on each of your turns.')).toBe(0);
  });

  it('Summer Bloom stamps additionalLandsThisTurn (+3)', () => {
    const ir = parseOracleTextToIR(SUMMER_BLOOM_ORACLE, 'Summer Bloom');
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    expect(steps.some((step) => step.kind === 'grant_static_ability')).toBe(true);
    expect(steps.some((step) => step.kind === 'unknown')).toBe(false);

    const result = applyOracleIRStepsToGameState(
      makeState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceId: 'summer_bloom_1',
        sourceName: 'Summer Bloom',
        sourceObjectType: 'spell',
      } as any),
    );

    expect((result.state as any).additionalLandsThisTurn?.p1).toBe(3);
    expect(result.appliedSteps.some((step) => step.kind === 'grant_static_ability')).toBe(true);
  });

  it('Explore stamps +1 then draws', () => {
    const ir = parseOracleTextToIR(EXPLORE_ORACLE, 'Explore');
    const steps = ir.abilities.flatMap((ability) => ability.steps || []);
    const result = applyOracleIRStepsToGameState(
      {
        ...makeState(),
        players: [
          { id: 'p1', name: 'P1', seat: 0, life: 40, library: [{ id: 'lib1', name: 'Forest' }], hand: [], graveyard: [] },
          { id: 'p2', name: 'P2', seat: 1, life: 40, library: [], hand: [], graveyard: [] },
        ],
      } as unknown as GameState,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceId: 'explore_1',
        sourceName: 'Explore',
        sourceObjectType: 'spell',
      } as any),
    );

    expect((result.state as any).additionalLandsThisTurn?.p1).toBe(1);
  });
});
