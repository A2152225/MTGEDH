import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import type { OracleEffectStep } from '../src/oracleIR';

const MINDS_AGLOW_DRAW: Extract<OracleEffectStep, { kind: 'draw' }> = {
  kind: 'draw',
  who: { kind: 'each_player' },
  amount: { kind: 'x' },
  whereX: { kind: 'where', raw: 'X is the total amount of mana paid this way' },
  raw: 'Each player draws X cards, where X is the total amount of mana paid this way',
};

function seedTwoPlayerState(libraryCount: number) {
  const makeLibrary = (prefix: string) =>
    Array.from({ length: libraryCount }, (_, index) => ({
      id: `${prefix}-lib-${index}`,
      name: `Card ${index}`,
      type_line: 'Instant',
    }));
  return {
    players: [
      { id: 'p1', hand: [], library: makeLibrary('p1'), graveyard: [], exile: [] },
      { id: 'p2', hand: [], library: makeLibrary('p2'), graveyard: [], exile: [] },
    ],
    battlefield: [],
    zones: {
      p1: { hand: [], libraryCount },
      p2: { hand: [], libraryCount },
    },
  } as any;
}

describe('oracleIR Join Forces', () => {
  it('halts on join_forces without drawing', () => {
    const state = seedTwoPlayerState(3);
    const steps: OracleEffectStep[] = [
      {
        kind: 'join_forces',
        who: { kind: 'each_player' },
        startingWith: 'you',
        raw: 'Starting with you, each player may pay any amount of mana',
      },
      MINDS_AGLOW_DRAW,
    ];
    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'minds-aglow-1',
      sourceName: 'Minds Aglow',
      interactivePlayerChoices: true,
    });
    const result = applyOracleIRStepsToGameState(state, steps, ctx, {
      allowOptional: true,
      haltOnPlayerChoiceRequired: true,
    });

    expect(result.automationGaps.some((gap) =>
      gap.reasonCode === 'player_choice_required' && gap.stepKind === 'join_forces',
    )).toBe(true);
    expect((result.pendingContinuationSteps || []).map((step) => step.kind)).toEqual(['draw']);
    expect(result.state.players[0].hand).toHaveLength(0);
    expect(result.state.players[1].hand).toHaveLength(0);
  });

  it('draws zero cards when join-forces X is 0', () => {
    const state = seedTwoPlayerState(3);
    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'minds-aglow-1',
      sourceName: 'Minds Aglow',
      xValue: 0,
    });
    const result = applyOracleIRStepsToGameState(state, [MINDS_AGLOW_DRAW], ctx, {
      allowOptional: true,
    });

    expect(result.appliedSteps.map((step) => step.kind)).toEqual(['draw']);
    expect(result.skippedSteps).toHaveLength(0);
    expect(result.state.players[0].hand).toHaveLength(0);
    expect(result.state.players[1].hand).toHaveLength(0);
  });

  it('draws X cards for each player from mana paid this way', () => {
    const state = seedTwoPlayerState(5);
    const ctx = buildOracleIRExecutionContext({
      controllerId: 'p1' as PlayerID,
      sourceId: 'minds-aglow-1',
      sourceName: 'Minds Aglow',
      xValue: 2,
    });
    const result = applyOracleIRStepsToGameState(state, [MINDS_AGLOW_DRAW], ctx, {
      allowOptional: true,
    });

    expect(result.appliedSteps.map((step) => step.kind)).toEqual(['draw']);
    expect(result.state.players[0].hand).toHaveLength(2);
    expect(result.state.players[1].hand).toHaveLength(2);
  });
});
