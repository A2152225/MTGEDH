import { describe, expect, it } from 'vitest';
import type { GameState } from '../../shared/src';
import GameAutomationController, { GameAutomationStatus } from '../src/GameAutomationController';
import { RulesEngineEvent } from '../src/core/events';
import { DrawCondition, GameEndReason } from '../src/types/gameFlow';

describe('GameAutomationController mandatory loop detection', () => {
  it('draws the game when a repeated no-choice loop is detected', () => {
    const emittedEvents: any[] = [];
    const repeatedState: GameState = {
      id: 'loop-game',
      players: [
        { id: 'player1', name: 'Player 1', life: 40, hand: [], library: [], graveyard: [] },
        { id: 'player2', name: 'Player 2', life: 40, hand: [], library: [], graveyard: [] },
      ],
      battlefield: [],
      stack: [],
      phase: 'precombatMain',
      step: 'main1',
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      priority: 'player1',
      turn: 1,
      turnPlayer: 'player1',
      life: { player1: 40, player2: 40 },
      startingLife: 40,
      commandZone: {},
      turnOrder: ['player1', 'player2'],
      active: true,
      format: 'commander',
    } as any;

    const rulesEngineStub = {
      gameStates: new Map<string, GameState>([['loop-game', repeatedState]]),
      on: () => undefined,
      executeAction: (_gameId: string, action: any) => {
        if (action.type === 'advanceGame') {
          return { next: { ...repeatedState }, log: ['advanced into repeated state'] };
        }
        return { next: repeatedState, log: [] };
      },
      validateAction: () => ({ legal: true }),
      emit: (event: any) => emittedEvents.push(event),
    } as any;

    const decisionManagerStub = {
      initGame: () => undefined,
      getAllDecisions: () => [],
      clearGame: () => undefined,
      processResponse: () => ({ result: { valid: true }, decision: null }),
      addDecisions: () => undefined,
    } as any;

    const controller = new GameAutomationController(rulesEngineStub, decisionManagerStub);
    controller.initGame('loop-game', { autoPassPriority: true });

    let result = controller.step('loop-game', repeatedState);
    expect(result.status).toBe(GameAutomationStatus.WAITING_FOR_PRIORITY);

    result = controller.step('loop-game', result.state);
    expect(result.status).toBe(GameAutomationStatus.COMPLETED);
    expect((result.state as any).endReason).toBe(GameEndReason.DRAW);
    expect((result.state as any).drawCondition).toBe(DrawCondition.MANDATORY_LOOP);
    expect(result.log).toContain('Game is a draw - mandatory loop detected');

    expect(emittedEvents).toContainEqual(
      expect.objectContaining({
        type: RulesEngineEvent.GAME_ENDED,
        gameId: 'loop-game',
        data: expect.objectContaining({
          reason: GameEndReason.DRAW,
          drawCondition: DrawCondition.MANDATORY_LOOP,
        }),
      })
    );
  });
});