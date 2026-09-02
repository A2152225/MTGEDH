import { describe, expect, it } from 'vitest';
import type { GameState } from '../../shared/src/index.js';
import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor.js';
import { parseOracleTextToIR } from '../src/oracleIRParser.js';

const OPPONENT_GY_EXILE = "Exile target card from an opponent's graveyard.";

function gyState(opponentCards: Array<{ id: string; name: string }>): GameState {
  return {
    players: [
      { id: 'p1', graveyard: [], exile: [] },
      {
        id: 'p2',
        graveyard: opponentCards.map((card) => ({ ...card, type_line: 'Instant' })),
        exile: [],
      },
    ],
    battlefield: [],
  } as GameState;
}

function exileSteps() {
  const ir = parseOracleTextToIR(OPPONENT_GY_EXILE, 'Disposal Mummy');
  return (ir.abilities || []).flatMap((ability) => ability.steps || []);
}

describe('exile target card from an opponent graveyard', () => {
  it('exiles the unique legal graveyard card without bound chosenObjectIds', () => {
    const steps = exileSteps();
    expect(steps.some((step) => step.kind === 'move_zone' && (step as any).to === 'exile')).toBe(true);

    const result = applyOracleIRStepsToGameState(
      gyState([{ id: 'gy-bolt', name: 'Lightning Bolt' }]),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceName: 'Disposal Mummy',
        targetPermanentId: 'bf-unrelated',
        selectorContext: { chosenObjectIds: ['bf-unrelated'] },
      }),
    );

    expect(result.appliedSteps.some((step) => step.kind === 'move_zone')).toBe(true);
    expect(result.skippedSteps.some((step) => step.kind === 'move_zone')).toBe(false);
    const p2 = (result.state.players || []).find((player: any) => player.id === 'p2') as any;
    expect((p2?.graveyard || []).map((card: any) => card.id)).toEqual([]);
    expect((p2?.exile || []).map((card: any) => card.id)).toContain('gy-bolt');
  });

  it('requires a choice when more than one opponent graveyard card is legal', () => {
    const steps = exileSteps();

    const result = applyOracleIRStepsToGameState(
      gyState([
        { id: 'gy-bolt', name: 'Lightning Bolt' },
        { id: 'gy-opt', name: 'Opt' },
      ]),
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'p1',
        sourceName: 'Disposal Mummy',
      }),
      { haltOnPlayerChoiceRequired: true },
    );

    expect(result.appliedSteps.some((step) => step.kind === 'move_zone')).toBe(false);
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'player_choice_required')).toBe(true);
  });
});
