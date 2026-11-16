import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import type { GameState } from '../../shared/src/index.js';

// Quoted from Valakut Awakening (ZNR).
const VALAKUT_ORACLE =
  'Put any number of cards from your hand on the bottom of your library, then draw that many cards plus one.';

function makeState(): GameState {
  return {
    id: 'valakut-awakening',
    format: 'commander',
    players: [
      {
        id: 'p1',
        name: 'A2',
        seat: 0,
        life: 40,
        library: [
          { id: 'lib-1', name: 'Island' },
          { id: 'lib-2', name: 'Mountain' },
          { id: 'lib-3', name: 'Forest' },
          { id: 'lib-4', name: 'Swamp' },
        ],
        hand: [
          { id: 'hand-a', name: 'Shock' },
          { id: 'hand-b', name: 'Lightning Bolt' },
          { id: 'hand-c', name: 'Opt' },
        ],
        graveyard: [],
        exile: [],
      } as any,
    ],
    battlefield: [],
    stack: [],
    turnPlayer: 'p1',
    priority: 'p1',
    active: true,
  } as GameState;
}

describe('Valakut Awakening', () => {
  it('requires a hand choice and does not move cards before one is made', () => {
    const ir = parseOracleTextToIR(VALAKUT_ORACLE, 'Valakut Awakening');
    const steps = ir.abilities[0]?.steps ?? [];
    const result = applyOracleIRStepsToGameState(makeState(), steps, {
      controllerId: 'p1',
      sourceName: 'Valakut Awakening',
    }, { haltOnPlayerChoiceRequired: true });

    const p1 = result.state.players.find((player) => player.id === 'p1') as any;
    expect(result.automationGaps?.some((gap) => gap.reasonCode === 'player_choice_required')).toBe(true);
    expect(result.pendingContinuationSteps?.some((step) => step.kind === 'draw')).toBe(true);
    expect(p1.hand.map((card: any) => card.id)).toEqual(['hand-a', 'hand-b', 'hand-c']);
    expect(p1.library.map((card: any) => card.id)).toEqual(['lib-1', 'lib-2', 'lib-3', 'lib-4']);
  });

  it('puts the chosen cards on the bottom in that order, then draws that many plus one', () => {
    const ir = parseOracleTextToIR(VALAKUT_ORACLE, 'Valakut Awakening');
    const steps = ir.abilities[0]?.steps ?? [];
    const result = applyOracleIRStepsToGameState(makeState(), steps, {
      controllerId: 'p1',
      sourceName: 'Valakut Awakening',
      selectorContext: { chosenObjectIds: ['hand-b', 'hand-a'] },
    });

    const p1 = result.state.players.find((player) => player.id === 'p1') as any;
    expect(p1.library.map((card: any) => card.id)).toEqual(['lib-4', 'hand-b', 'hand-a']);
    expect(p1.hand.map((card: any) => card.id)).toEqual(['hand-c', 'lib-1', 'lib-2', 'lib-3']);
  });

  it('draws one card when the player puts nothing on the bottom', () => {
    const ir = parseOracleTextToIR(VALAKUT_ORACLE, 'Valakut Awakening');
    const steps = ir.abilities[0]?.steps ?? [];
    const result = applyOracleIRStepsToGameState(makeState(), steps, {
      controllerId: 'p1',
      sourceName: 'Valakut Awakening',
      selectorContext: { chosenObjectIds: [] },
    });

    const p1 = result.state.players.find((player) => player.id === 'p1') as any;
    expect(p1.library.map((card: any) => card.id)).toEqual(['lib-2', 'lib-3', 'lib-4']);
    expect(p1.hand.map((card: any) => card.id)).toEqual(['hand-a', 'hand-b', 'hand-c', 'lib-1']);
  });
});
