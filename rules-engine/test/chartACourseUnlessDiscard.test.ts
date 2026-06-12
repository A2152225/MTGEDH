import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor.js';
import type { GameState } from '../../shared/src/index.js';

const chartOracle =
  'Draw two cards. Then discard a card unless you attacked this turn.';

function collectSpellSteps(text: string): any[] {
  const ir = parseOracleTextToIR(text, 'Chart a Course');
  const steps: any[] = [];
  for (const ability of ir.abilities || []) {
    if (Array.isArray(ability.steps)) steps.push(...ability.steps);
  }
  return steps;
}

function makeState(overrides: Record<string, unknown> = {}): GameState {
  const library = Array.from({ length: 10 }, (_, index) => ({
    id: `lib_${index}`,
    name: `Library ${index}`,
    type_line: 'Instant',
  }));

  return {
    players: [{
      id: 'p1',
      library: [...library],
      hand: [],
    }],
    zones: {
      p1: {
        library: [...library],
        hand: [],
      },
    },
    battlefield: [],
    ...overrides,
  } as unknown as GameState;
}

describe('Chart a Course unless-attack discard', () => {
  it('parses discard unless you attacked this turn into amount 1 + unlessCondition', () => {
    const steps = collectSpellSteps(chartOracle);
    expect(steps).toEqual([
      expect.objectContaining({
        kind: 'draw',
        amount: { kind: 'number', value: 2 },
      }),
      expect.objectContaining({
        kind: 'discard',
        amount: { kind: 'number', value: 1 },
        unlessCondition: { kind: 'if', raw: 'you attacked this turn' },
      }),
    ]);
  });

  it('draws two cards and skips discard when controller attacked this turn', () => {
    const steps = collectSpellSteps(chartOracle);
    const state = makeState({
      attackedPlayersThisTurnByPlayer: { p1: ['attacker-1'] },
    });

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId: 'p1',
      sourceId: 'chart-1',
      sourceName: 'Chart a Course',
    });

    expect(result.appliedSteps.some((step) => step.kind === 'draw')).toBe(true);
    expect(result.appliedSteps.some((step) => step.kind === 'discard')).toBe(true);
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'player_choice_required')).toBe(false);

    const player = (result.state as any).players.find((entry: any) => entry.id === 'p1');
    expect((player?.hand || []).length).toBe(2);
  });

  it('draws two cards and requires discard when controller did not attack this turn', () => {
    const steps = collectSpellSteps(chartOracle);
    const state = makeState({
      attackedPlayersThisTurnByPlayer: { p1: [] },
    });

    const result = applyOracleIRStepsToGameState(state, steps, {
      controllerId: 'p1',
      sourceId: 'chart-2',
      sourceName: 'Chart a Course',
      interactivePlayerChoices: true,
    }, {
      haltOnPlayerChoiceRequired: true,
    });

    expect(result.appliedSteps.some((step) => step.kind === 'draw')).toBe(true);
    expect(result.automationGaps?.some((gap) =>
      gap.reasonCode === 'player_choice_required' && gap.stepKind === 'discard'
    )).toBe(true);

    const player = (result.state as any).players.find((entry: any) => entry.id === 'p1');
    expect((player?.hand || []).length).toBe(2);
  });
});
