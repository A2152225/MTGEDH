import { describe, expect, it } from 'vitest';
import type { GameState } from '../../shared/src';
import { GamePhase, GameStep } from '../src/actions/gamePhases';
import { checkWinConditions } from '../src/actions/stateBasedActionsHandler';
import { executeTurnBasedAction } from '../src/actions/turnActions';

const DARKSTEEL_REACTOR_ORACLE =
  'Indestructible (Effects that say "destroy" don\'t destroy this artifact.)\nAt the beginning of your upkeep, you may put a charge counter on this artifact.\nWhen this artifact has twenty or more charge counters on it, you win the game.';
const FELIDAR_ORACLE =
  "Vigilance (Attacking doesn't cause this creature to tap.)\nLifelink (Damage dealt by this creature also causes you to gain that much life.)\nAt the beginning of your upkeep, if you have 40 or more life, you win the game.";
const MAZES_END_ORACLE =
  "This land enters tapped.\n{T}: Add {C}.\n{3}, {T}, Return this land to its owner's hand: Search your library for a Gate card, put it onto the battlefield, then shuffle. If you control ten or more Gates with different names, you win the game.";

function createMockContext() {
  return {
    getState: () => undefined,
    setState: () => undefined,
    emit: () => undefined,
    gameId: 'test-game',
  } as any;
}

function makeReactorState(charge: number, step: string = GameStep.MAIN1): GameState {
  return {
    players: [
      { id: 'p1', life: 40, hand: [], library: [], graveyard: [] },
      { id: 'p2', life: 40, hand: [], library: [], graveyard: [] },
    ],
    activePlayerIndex: 0,
    step,
    phase: step === GameStep.UPKEEP ? GamePhase.BEGINNING : GamePhase.MAIN1,
    battlefield: [
      {
        id: 'reactor_1',
        controller: 'p1',
        owner: 'p1',
        counters: { charge },
        card: {
          name: 'Custom Reactor',
          type_line: 'Artifact',
          oracle_text: DARKSTEEL_REACTOR_ORACLE,
        },
      },
    ],
  } as any;
}

describe('oracle scanner immediate wins via SBA / upkeep', () => {
  it('Darksteel-style 20 charge counters wins immediately as an SBA (not only at upkeep)', () => {
    const state = makeReactorState(20, GameStep.MAIN1);
    const result = checkWinConditions(state);
    expect(result.winner).toBe('p1');
    expect((state as any).winner).toBe('p1');
    expect((state as any).gameOver).toBe(true);
    expect(String(result.reason || '')).toMatch(/charge counters|win/i);
  });

  it('19 charge counters does not win', () => {
    const state = makeReactorState(19, GameStep.MAIN1);
    const result = checkWinConditions(state);
    expect(result.winner).toBeUndefined();
    expect((state as any).gameOver).toBeFalsy();
  });

  it('Felidar-style unnamed upkeep win is applied from the server oracle scanner', () => {
    const state = {
      players: [
        { id: 'p1', life: 40, hand: [], library: [], graveyard: [] },
        { id: 'p2', life: 40, hand: [], library: [], graveyard: [] },
      ],
      life: { p1: 40, p2: 40 },
      activePlayerIndex: 0,
      step: GameStep.UPKEEP,
      phase: GamePhase.BEGINNING,
      battlefield: [
        {
          id: 'life_1',
          controller: 'p1',
          owner: 'p1',
          card: {
            name: 'Custom Life Sovereign',
            type_line: 'Creature — Cat Beast',
            oracle_text: FELIDAR_ORACLE,
          },
        },
      ],
    } as any;

    const sba = checkWinConditions(state);
    expect(sba.winner).toBe('p1');
    expect(state.gameOver).toBe(true);

    const tba = executeTurnBasedAction('test-game', {
      ...state,
      winner: undefined,
      gameOver: false,
      status: undefined,
    } as any, createMockContext());
    expect((tba.next as any).winner).toBe('p1');
    expect((tba.next as any).gameOver).toBe(true);
  });

  it("Maze's End activated Gate search is not an SBA win", () => {
    const state = {
      players: [
        { id: 'p1', life: 40, hand: [], library: [], graveyard: [] },
        { id: 'p2', life: 40, hand: [], library: [], graveyard: [] },
      ],
      activePlayerIndex: 0,
      step: GameStep.MAIN1,
      battlefield: [
        {
          id: 'maze_1',
          controller: 'p1',
          owner: 'p1',
          card: {
            name: 'Custom Maze',
            type_line: 'Land',
            oracle_text: MAZES_END_ORACLE,
          },
        },
      ],
    } as any;
    expect(checkWinConditions(state).winner).toBeUndefined();
  });
});
