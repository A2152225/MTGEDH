import { describe, it, expect } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { GamePhase } from '../../shared/src';
import {
  passPriority,
  givePriority,
  getActivePlayer,
  giveActivePlayerPriority,
  hasPriority,
  canCastSorcery,
  canCastInstant,
  getNextPlayer
} from '../src/priority';

function createTestState(): GameState {
  return {
    id: 'test-game',
    format: 'commander',
    players: [
      { id: 'p1' as PlayerID, name: 'Player 1', seat: 0 },
      { id: 'p2' as PlayerID, name: 'Player 2', seat: 1 },
      { id: 'p3' as PlayerID, name: 'Player 3', seat: 2 }
    ],
    startingLife: 40,
    life: { p1: 40, p2: 40, p3: 40 },
    turnPlayer: 'p1' as PlayerID,
    priority: 'p1' as PlayerID,
    stack: [],
    battlefield: [],
    commandZone: {},
    phase: GamePhase.FIRSTMAIN,
    active: true
  };
}

describe('Priority System (Rule 117)', () => {
  it('should pass priority to next player in turn order', () => {
    const state = createTestState();
    
    // p1 passes to p2
    let result = passPriority(state, 'p1' as PlayerID);
    expect(result.next.priority).toBe('p2');
    expect(result.log).toBeDefined();

    // p2 passes to p3
    result = passPriority(result.next, 'p2' as PlayerID);
    expect(result.next.priority).toBe('p3');

    // p3 passes back to p1 (wraps around)
    result = passPriority(result.next, 'p3' as PlayerID);
    expect(result.next.priority).toBe('p1');
  });

  it('should not allow player to pass priority if they don\'t have it', () => {
    const state = createTestState();
    
    const result = passPriority(state, 'p2' as PlayerID);
    expect(result.next.priority).toBe('p1'); // Unchanged
    expect(result.log?.[0]).toContain('cannot pass priority');
  });

  it('should give priority to specific player', () => {
    const state = createTestState();
    
    const result = givePriority(state, 'p3' as PlayerID);
    expect(result.next.priority).toBe('p3');
  });

  it('should identify active player', () => {
    const state = createTestState();
    
    const activePlayer = getActivePlayer(state);
    expect(activePlayer).toBe('p1');
  });

  it('should give priority to active player', () => {
    let state = createTestState();
    state = { ...state, priority: 'p2' as PlayerID };
    
    const result = giveActivePlayerPriority(state);
    expect(result.next.priority).toBe('p1'); // Active player
  });

  it('should check if player has priority', () => {
    const state = createTestState();
    
    expect(hasPriority(state, 'p1' as PlayerID)).toBe(true);
    expect(hasPriority(state, 'p2' as PlayerID)).toBe(false);
  });

  it('should get next player in turn order', () => {
    const state = createTestState();
    
    expect(getNextPlayer(state, 'p1' as PlayerID)).toBe('p2');
    expect(getNextPlayer(state, 'p2' as PlayerID)).toBe('p3');
    expect(getNextPlayer(state, 'p3' as PlayerID)).toBe('p1');
  });

  describe('Sorcery Timing (Rule 117.1a)', () => {
    it('should allow sorcery when active player has priority in main phase with empty stack', () => {
      const state = createTestState();
      
      expect(canCastSorcery(state, 'p1' as PlayerID)).toBe(true);
    });

    it('should not allow sorcery for non-active player', () => {
      const state = createTestState();
      
      expect(canCastSorcery(state, 'p2' as PlayerID)).toBe(false);
    });

    it('should not allow sorcery when stack is not empty', () => {
      const state = createTestState();
      const stateWithStack = {
        ...state,
        stack: [{ id: 'spell-1', type: 'spell' as const, controller: 'p2' as PlayerID }]
      };
      
      expect(canCastSorcery(stateWithStack, 'p1' as PlayerID)).toBe(false);
    });

    it('should not allow sorcery outside main phase', () => {
      const state = createTestState();
      const combatState = { ...state, phase: GamePhase.COMBAT };
      
      expect(canCastSorcery(combatState, 'p1' as PlayerID)).toBe(false);
    });

    it('should not allow sorcery without priority', () => {
      const state = createTestState();
      const noPriorityState = { ...state, priority: 'p2' as PlayerID };
      
      expect(canCastSorcery(noPriorityState, 'p1' as PlayerID)).toBe(false);
    });
  });

  describe('Instant Timing (Rule 117.1b)', () => {
    it('should allow instant when player has priority', () => {
      const state = createTestState();
      
      expect(canCastInstant(state, 'p1' as PlayerID)).toBe(true);
    });

    it('should allow instant in any phase when player has priority', () => {
      let state = createTestState();
      
      // Combat phase
      state = { ...state, phase: GamePhase.COMBAT, priority: 'p2' as PlayerID };
      expect(canCastInstant(state, 'p2' as PlayerID)).toBe(true);
      
      // Ending phase
      state = { ...state, phase: GamePhase.ENDING };
      expect(canCastInstant(state, 'p2' as PlayerID)).toBe(true);
    });

    it('should allow instant with objects on stack', () => {
      const state = createTestState();
      const stateWithStack = {
        ...state,
        stack: [{ id: 'spell-1', type: 'spell' as const, controller: 'p2' as PlayerID }],
        priority: 'p2' as PlayerID
      };
      
      expect(canCastInstant(stateWithStack, 'p2' as PlayerID)).toBe(true);
    });

    it('should not allow instant without priority', () => {
      const state = createTestState();
      
      expect(canCastInstant(state, 'p2' as PlayerID)).toBe(false);
    });
  });

  describe('Priority in multiplayer (Rule 117)', () => {
    it('should pass priority around table correctly', () => {
      let state = createTestState();
      
      // Full round of priority passing
      state = passPriority(state, 'p1' as PlayerID).next;
      expect(state.priority).toBe('p2');
      
      state = passPriority(state, 'p2' as PlayerID).next;
      expect(state.priority).toBe('p3');
      
      state = passPriority(state, 'p3' as PlayerID).next;
      expect(state.priority).toBe('p1');
    });

    it('should handle two-player game', () => {
      const state = createTestState();
      const twoPlayerState = {
        ...state,
        players: [
          { id: 'p1' as PlayerID, name: 'Player 1', seat: 0 },
          { id: 'p2' as PlayerID, name: 'Player 2', seat: 1 }
        ],
        life: { p1: 40, p2: 40 }
      };
      
      let result = passPriority(twoPlayerState, 'p1' as PlayerID);
      expect(result.next.priority).toBe('p2');
      
      result = passPriority(result.next, 'p2' as PlayerID);
      expect(result.next.priority).toBe('p1');
    });
  });
});
