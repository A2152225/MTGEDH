import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';

function collectStepsFromText(text: string) {
  const ir = parseOracleTextToIR(text, 'Batch242');
  return ir.abilities.flatMap((ability) => ability.steps || []);
}

function baseState(overrides?: Partial<GameState>): GameState {
  const p1 = 'p1' as PlayerID;
  return {
    turnNumber: 1,
    players: [
      {
        id: p1,
        name: 'P1',
        hand: [],
        library: [{ id: 'lib-land-1', name: 'Forest', type_line: 'Basic Land — Forest' }],
        graveyard: [],
      },
    ],
    battlefield: [
      {
        id: 'dragon',
        controller: p1,
        type_line: 'Creature — Dragon',
        power: 4,
        toughness: 4,
        card: { type_line: 'Creature — Dragon' },
      },
    ],
    ...overrides,
  } as GameState;
}

describe('Oracle IR gap batch 242 support', () => {
  it('applies zero-delta modify_pt when die roll yields x=0', () => {
    const steps = collectStepsFromText(
      'Roll a six-sided die. This creature gets +X/+0 until end of turn, where X is the result minus 1.'
    );
    const result = applyOracleIRStepsToGameState(
      {
        ...baseState(),
        lastDieRoll: { playerId: 'p1', result: 1 },
        lastDieRollByPlayer: { p1: { result: 1 } },
      },
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'dragon',
        targetCreatureId: 'dragon',
        targetPermanentId: 'dragon',
      })
    );
    expect(result.automationGaps || []).toHaveLength(0);
    expect(result.skippedSteps || []).toHaveLength(0);
    expect(result.appliedSteps?.some((step) => step.kind === 'modify_pt')).toBe(true);
  });

  it('mills then prevents combat damage when a land is milled', () => {
    const steps = collectStepsFromText(
      'Mill a card. If a land card was milled this way, prevent all combat damage this creature would deal this turn.'
    );
    const result = applyOracleIRStepsToGameState(
      baseState(),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1' as PlayerID,
        sourceId: 'dragon',
        targetCreatureId: 'dragon',
        targetPermanentId: 'dragon',
      })
    );
    expect(result.automationGaps || []).toHaveLength(0);
    expect(result.appliedSteps?.some((step) => step.kind === 'mill')).toBe(true);
    expect(result.appliedSteps?.some((step) => step.kind === 'prevent_damage')).toBe(true);
  });
});
