import { describe, expect, it } from 'vitest';
import type { GameState } from '../../shared/src';
import { GamePhase, GameStep } from '../src/actions/gamePhases';
import { RulesEngineEvent } from '../src/core/events';
import { checkWinConditionsForState } from '../src/rulesEngineAdapterStateSupport';
import { GameEndReason, WinCondition } from '../src/types/gameFlow';

const DARKSTEEL_REACTOR_ORACLE =
  'Indestructible (Effects that say "destroy" don\'t destroy this artifact.)\nAt the beginning of your upkeep, you may put a charge counter on this artifact.\nWhen this artifact has twenty or more charge counters on it, you win the game.';
const FELIDAR_ORACLE =
  "Vigilance (Attacking doesn't cause this creature to tap.)\nLifelink (Damage dealt by this creature also causes you to gain that much life.)\nAt the beginning of your upkeep, if you have 40 or more life, you win the game.";

function invokeCheck(state: GameState) {
  const events: Array<{ type: string; data?: Record<string, unknown> }> = [];
  const persisted: GameState[] = [];
  const result = checkWinConditionsForState({
    gameId: 'test-game',
    state,
    emit: (event) => {
      events.push(event as any);
    },
    persistState: (_gameId, nextState) => {
      persisted.push(nextState);
    },
  });
  return { result, events, persisted };
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

describe('oracle scanner immediate wins via checkWinConditionsForState', () => {
  it('Darksteel-style 20 charge counters wins immediately (not only last-player-standing)', () => {
    const state = makeReactorState(20, GameStep.MAIN1);
    const { result, events, persisted } = invokeCheck(state);

    expect((result.next as any).winner).toBe('p1');
    expect((result.next as any).gameOver).toBe(true);
    expect((result.next as any).status).toBe('finished');
    expect(String((result.next as any).winReason || result.log?.[0] || '')).toMatch(/charge counters|win/i);
    expect((state as any).winner).toBeUndefined();
    expect(persisted).toHaveLength(1);
    expect(events.some((event) => event.type === RulesEngineEvent.PLAYER_WON && event.data?.playerId === 'p1')).toBe(true);
    expect(events.some((event) => event.type === RulesEngineEvent.GAME_ENDED && event.data?.winner === 'p1')).toBe(true);
    const won = events.find((event) => event.type === RulesEngineEvent.PLAYER_WON);
    expect(won?.data?.reason).toBe(WinCondition.EFFECT_STATES_WIN);
    const ended = events.find((event) => event.type === RulesEngineEvent.GAME_ENDED);
    expect(ended?.data?.reason).toBe(GameEndReason.PLAYER_WIN);
  });

  it('19 charge counters does not win', () => {
    const state = makeReactorState(19, GameStep.MAIN1);
    const { result, events, persisted } = invokeCheck(state);

    expect((result.next as any).winner).toBeUndefined();
    expect((result.next as any).gameOver).toBeFalsy();
    expect(persisted).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it('Felidar-style upkeep win applies only when step is upkeep', () => {
    const base = {
      players: [
        { id: 'p1', life: 40, hand: [], library: [], graveyard: [] },
        { id: 'p2', life: 40, hand: [], library: [], graveyard: [] },
      ],
      life: { p1: 40, p2: 40 },
      activePlayerIndex: 0,
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
    };

    const main = invokeCheck({
      ...base,
      step: GameStep.MAIN1,
      phase: GamePhase.MAIN1,
    } as any);
    expect((main.result.next as any).winner).toBeUndefined();
    expect((main.result.next as any).gameOver).toBeFalsy();

    const upkeep = invokeCheck({
      ...base,
      step: GameStep.UPKEEP,
      phase: GamePhase.BEGINNING,
    } as any);
    expect((upkeep.result.next as any).winner).toBe('p1');
    expect((upkeep.result.next as any).gameOver).toBe(true);
  });

  it('last-player-standing still wins when only one player remains', () => {
    const state = {
      players: [
        { id: 'p1', life: 40, hand: [], library: [], graveyard: [], hasLost: false },
        { id: 'p2', life: 0, hand: [], library: [], graveyard: [], hasLost: true },
      ],
      activePlayerIndex: 0,
      step: GameStep.MAIN1,
      battlefield: [],
    } as any;

    const { result, events } = invokeCheck(state);
    expect((result.next as any).winner).toBe('p1');
    expect((result.next as any).status).toBe('finished');
    expect((result.next as any).gameOver).toBeFalsy();
    expect(result.log).toEqual(['p1 wins the game!']);
    const won = events.find((event) => event.type === RulesEngineEvent.PLAYER_WON);
    expect(won?.data?.reason).toBe(WinCondition.OPPONENTS_LEFT);
  });
});
