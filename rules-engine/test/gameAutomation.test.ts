/**
 * Test suite for game automation modules
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { GameState } from '../../shared/src';
import { RulesEngineEvent } from '../src/core/events';
import {
  GamePhase,
  GameStep,
  getNextGameStep,
  doesStepReceivePriority,
  isMainPhase,
} from '../src/actions/gamePhases';
import {
  performStateBasedActions,
  checkWinConditions,
} from '../src/actions/stateBasedActionsHandler';
import {
  executeUntapStep,
  executeDrawStep,
  executeCleanupStep,
} from '../src/actions/turnActions';
import {
  initializeGame,
  drawInitialHand,
  processMulligan,
} from '../src/actions/gameSetup';
import {
  advanceGame,
  passPriority,
} from '../src/actions/gameAdvance';

// Helper to create mock context
function createMockContext(gameStates: Map<string, GameState>) {
  const emittedEvents: any[] = [];
  return {
    getState: (gameId: string) => gameStates.get(gameId),
    setState: (gameId: string, state: GameState) => gameStates.set(gameId, state),
    emit: (event: any) => emittedEvents.push(event),
    gameId: 'test-game',
    getEmittedEvents: () => emittedEvents,
  };
}

describe('Game Phases', () => {
  it('should advance from untap to upkeep', () => {
    const { phase, step } = getNextGameStep(GamePhase.BEGINNING, GameStep.UNTAP);
    expect(phase).toBe(GamePhase.BEGINNING);
    expect(step).toBe(GameStep.UPKEEP);
  });

  it('should advance from draw to precombat main', () => {
    const { phase, step } = getNextGameStep(GamePhase.BEGINNING, GameStep.DRAW);
    expect(phase).toBe(GamePhase.PRECOMBAT_MAIN);
    expect(step).toBe(GameStep.MAIN);
  });

  it('should advance from precombat main to combat', () => {
    const { phase, step } = getNextGameStep(GamePhase.PRECOMBAT_MAIN, GameStep.MAIN);
    expect(phase).toBe(GamePhase.COMBAT);
    expect(step).toBe(GameStep.BEGINNING_OF_COMBAT);
  });

  it('should advance from cleanup to new turn', () => {
    const { phase, step, isNewTurn } = getNextGameStep(GamePhase.ENDING, GameStep.CLEANUP);
    expect(phase).toBe(GamePhase.BEGINNING);
    expect(step).toBe(GameStep.UNTAP);
    expect(isNewTurn).toBe(true);
  });

  it('should identify priority steps correctly', () => {
    expect(doesStepReceivePriority(GameStep.UPKEEP)).toBe(true);
    expect(doesStepReceivePriority(GameStep.MAIN)).toBe(true);
    expect(doesStepReceivePriority(GameStep.UNTAP)).toBe(false);
    expect(doesStepReceivePriority(GameStep.CLEANUP)).toBe(false);
  });

  it('should identify main phases', () => {
    expect(isMainPhase(GamePhase.PRECOMBAT_MAIN)).toBe(true);
    expect(isMainPhase(GamePhase.POSTCOMBAT_MAIN)).toBe(true);
    expect(isMainPhase(GamePhase.COMBAT)).toBe(false);
  });
});

describe('State-Based Actions', () => {
  it('should detect player at 0 life', () => {
    const state: GameState = {
      players: [
        { id: 'player1', life: 0, battlefield: [], hand: [], library: [], graveyard: [] },
        { id: 'player2', life: 40, battlefield: [], hand: [], library: [], graveyard: [] },
      ],
      battlefield: [],
    } as any;

    const result = performStateBasedActions(state);
    expect(result.playerLost).toBe('player1');
    expect(result.actions).toContain('player1 loses (0 life)');
  });

  it('should detect player with 10 poison', () => {
    const state: GameState = {
      players: [
        { id: 'player1', life: 40, counters: { poison: 10 }, battlefield: [], hand: [], library: [], graveyard: [] },
      ],
      battlefield: [],
    } as any;

    const result = performStateBasedActions(state);
    expect(result.playerLost).toBe('player1');
  });

  it('should detect commander damage loss', () => {
    const state: GameState = {
      players: [
        { id: 'player1', life: 40, commanderDamage: { 'cmd1': 21 }, battlefield: [], hand: [], library: [], graveyard: [] },
      ],
      battlefield: [],
    } as any;

    const result = performStateBasedActions(state);
    expect(result.playerLost).toBe('player1');
  });

  it('should detect last player standing', () => {
    const state: GameState = {
      players: [
        { id: 'player1', life: 40 },
      ],
    } as any;

    const result = checkWinConditions(state);
    expect(result.winner).toBe('player1');
  });
});

describe('Turn Actions', () => {
  it('should untap all permanents', () => {
    const state: GameState = {
      players: [
        {
          id: 'player1',
          battlefield: [
            { id: 'perm1', tapped: true, card: { name: 'Forest' } },
            { id: 'perm2', tapped: true, card: { name: 'Mountain' } },
          ],
        },
      ],
    } as any;

    const result = executeUntapStep(state, 'player1');
    const player = result.state.players.find(p => p.id === 'player1');
    expect(player?.battlefield?.every((p: any) => !p.tapped)).toBe(true);
  });

  it('should draw a card', () => {
    const gameStates = new Map<string, GameState>();
    const context = createMockContext(gameStates);
    
    const state: GameState = {
      players: [
        {
          id: 'player1',
          library: [{ id: 'card1', name: 'Forest' }, { id: 'card2', name: 'Island' }],
          hand: [],
        },
      ],
    } as any;

    const result = executeDrawStep(state, 'player1', context, 'test-game');
    const player = result.state.players.find(p => p.id === 'player1');
    expect(player?.hand?.length).toBe(1);
    expect(player?.library?.length).toBe(1);
  });

  it('should remove damage in cleanup', () => {
    const state: GameState = {
      players: [
        {
          id: 'player1',
          battlefield: [
            { id: 'perm1', counters: { damage: 3 }, card: { name: 'Creature' } },
          ],
          hand: [],
        },
      ],
    } as any;

    const result = executeCleanupStep(state, 'player1');
    const player = result.state.players.find(p => p.id === 'player1');
    expect(player?.battlefield?.[0].counters?.damage).toBe(0);
  });
});

describe('Game Setup', () => {
  it('should initialize a game', () => {
    const gameStates = new Map<string, GameState>();
    const context = createMockContext(gameStates);

    const players = [
      { id: 'player1', name: 'Alice', deckCards: [{ id: 'c1' }, { id: 'c2' }] },
      { id: 'player2', name: 'Bob', deckCards: [{ id: 'c3' }, { id: 'c4' }] },
    ];

    const result = initializeGame('test-game', players, context);
    
    expect(result.next.players.length).toBe(2);
    expect(result.next.players[0].life).toBe(40);
    expect(result.next.phase).toBe(GamePhase.PRE_GAME);
  });

  it('should draw initial hand', () => {
    const gameStates = new Map<string, GameState>();
    const state: GameState = {
      players: [
        {
          id: 'player1',
          library: Array(60).fill(null).map((_, i) => ({ id: `card${i}` })),
          hand: [],
        },
      ],
    } as any;
    gameStates.set('test-game', state);
    const context = createMockContext(gameStates);

    const result = drawInitialHand('test-game', 'player1', 7, context);
    const player = result.next.players.find(p => p.id === 'player1');
    
    expect(player?.hand?.length).toBe(7);
    expect(player?.library?.length).toBe(53);
  });

  it('should process mulligan', () => {
    const gameStates = new Map<string, GameState>();
    const state: GameState = {
      players: [
        {
          id: 'player1',
          library: Array(53).fill(null).map((_, i) => ({ id: `lib${i}` })),
          hand: Array(7).fill(null).map((_, i) => ({ id: `hand${i}` })),
          mulliganCount: 0,
        },
      ],
    } as any;
    gameStates.set('test-game', state);
    const context = createMockContext(gameStates);

    const result = processMulligan('test-game', 'player1', false, context);
    const player = result.next.players.find(p => p.id === 'player1');
    
    expect(player?.hand?.length).toBe(6); // One less
    expect((player as any)?.mulliganCount).toBe(1);
  });
});

describe('Game Advancement', () => {
  it('should advance game phase', () => {
    const gameStates = new Map<string, GameState>();
    const state: GameState = {
      players: [
        { id: 'player1', life: 40, battlefield: [], library: [{ id: 'c1' }], hand: [] },
        { id: 'player2', life: 40, battlefield: [], library: [], hand: [] },
      ],
      phase: GamePhase.BEGINNING,
      step: GameStep.UPKEEP,
      activePlayerIndex: 0,
      turn: 1,
      stack: [],
      battlefield: [],
    } as any;
    gameStates.set('test-game', state);
    const context = createMockContext(gameStates);

    const result = advanceGame('test-game', context);
    
    expect(result.next.step).toBe(GameStep.DRAW);
  });

  it('should pass priority', () => {
    const gameStates = new Map<string, GameState>();
    const state: GameState = {
      players: [
        { id: 'player1' },
        { id: 'player2' },
      ],
      priorityPlayerIndex: 0,
      stack: [],
    } as any;
    gameStates.set('test-game', state);
    const context = createMockContext(gameStates);

    const result = passPriority('test-game', 'player1', context);
    
    expect(result.next.priorityPlayerIndex).toBe(1);
  });
});
