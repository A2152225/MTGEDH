/**
 * Test suite for undo action handlers
 * Tests the undo request/approval system
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createUndoState,
  recordEvent,
  validateUndoRequest,
  createUndoRequest,
  validateUndoResponse,
  processUndoResponse,
  checkUndoExpiration,
  getEventsForUndo,
  completeUndo,
  cancelUndo,
  getActionsToUndoCount,
  getUndoDescription,
  canRequestUndo,
  getUndoApprovalStatus,
  type UndoState,
  type RequestUndoAction,
  type RespondUndoAction,
} from '../src/actions/undo';
import type { GameState } from '../../shared/src';

describe('Undo System', () => {
  let undoState: UndoState;
  let mockGameState: GameState;
  const allPlayerIds = ['player1', 'player2', 'player3'];

  beforeEach(() => {
    undoState = createUndoState(true, 60000);
    mockGameState = {
      id: 'test-game',
      players: allPlayerIds.map(id => ({ id, name: id, seat: 0 })),
    } as any;
  });

  describe('createUndoState', () => {
    it('should create an empty undo state', () => {
      const state = createUndoState();
      expect(state.eventHistory).toEqual([]);
      expect(state.pendingUndo).toBeNull();
      expect(state.undoEnabled).toBe(true);
    });

    it('should allow disabling undo', () => {
      const state = createUndoState(false);
      expect(state.undoEnabled).toBe(false);
    });

    it('should allow custom timeout', () => {
      const state = createUndoState(true, 30000);
      expect(state.undoTimeoutMs).toBe(30000);
    });
  });

  describe('recordEvent', () => {
    it('should add event to history', () => {
      const event = { type: 'playLand', playerId: 'player1' };
      const newState = recordEvent(undoState, event);
      
      expect(newState.eventHistory.length).toBe(1);
      expect(newState.eventHistory[0]).toEqual(event);
    });

    it('should preserve existing events', () => {
      let state = recordEvent(undoState, { type: 'event1' });
      state = recordEvent(state, { type: 'event2' });
      state = recordEvent(state, { type: 'event3' });
      
      expect(state.eventHistory.length).toBe(3);
      expect(state.eventHistory[0].type).toBe('event1');
      expect(state.eventHistory[2].type).toBe('event3');
    });
  });

  describe('validateUndoRequest', () => {
    beforeEach(() => {
      // Add some events
      undoState = recordEvent(undoState, { type: 'event1', playerId: 'player1' });
      undoState = recordEvent(undoState, { type: 'event2', playerId: 'player2' });
    });

    it('should validate a valid undo request', () => {
      const action: RequestUndoAction = {
        type: 'requestUndo',
        playerId: 'player1',
        actionsToUndo: 1,
      };
      
      const result = validateUndoRequest(mockGameState, undoState, action, allPlayerIds);
      expect(result.valid).toBe(true);
    });

    it('should reject if undo is disabled', () => {
      const disabledState = createUndoState(false);
      const action: RequestUndoAction = {
        type: 'requestUndo',
        playerId: 'player1',
      };
      
      const result = validateUndoRequest(mockGameState, disabledState, action, allPlayerIds);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not enabled');
    });

    it('should reject if there is already a pending request', () => {
      const action: RequestUndoAction = {
        type: 'requestUndo',
        playerId: 'player1',
      };
      
      // Create a pending request
      undoState = createUndoRequest(undoState, action, allPlayerIds);
      
      // Try to create another request
      const result = validateUndoRequest(mockGameState, undoState, action, allPlayerIds);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('pending');
    });

    it('should reject if requester is not a player', () => {
      const action: RequestUndoAction = {
        type: 'requestUndo',
        playerId: 'spectator1',
      };
      
      const result = validateUndoRequest(mockGameState, undoState, action, allPlayerIds);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Only players');
    });

    it('should reject if there are no events to undo', () => {
      const emptyState = createUndoState();
      const action: RequestUndoAction = {
        type: 'requestUndo',
        playerId: 'player1',
      };
      
      const result = validateUndoRequest(mockGameState, emptyState, action, allPlayerIds);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('No actions');
    });

    it('should reject if trying to undo too many actions', () => {
      const action: RequestUndoAction = {
        type: 'requestUndo',
        playerId: 'player1',
        actionsToUndo: 10,
      };
      
      const result = validateUndoRequest(mockGameState, undoState, action, allPlayerIds);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Cannot undo that many');
    });
  });

  describe('createUndoRequest', () => {
    beforeEach(() => {
      undoState = recordEvent(undoState, { type: 'event1' });
      undoState = recordEvent(undoState, { type: 'event2' });
      undoState = recordEvent(undoState, { type: 'event3' });
    });

    it('should create a pending undo request', () => {
      const action: RequestUndoAction = {
        type: 'requestUndo',
        playerId: 'player1',
        actionsToUndo: 1,
      };
      
      const newState = createUndoRequest(undoState, action, allPlayerIds);
      
      expect(newState.pendingUndo).not.toBeNull();
      expect(newState.pendingUndo!.status).toBe('pending');
      expect(newState.pendingUndo!.requesterId).toBe('player1');
      expect(newState.pendingUndo!.targetActionIndex).toBe(2); // 3 events - 1 = 2
      expect(newState.pendingUndo!.approvals.has('player1')).toBe(true); // Auto-approved
    });

    it('should auto-approve for single player games', () => {
      const action: RequestUndoAction = {
        type: 'requestUndo',
        playerId: 'player1',
      };
      
      const newState = createUndoRequest(undoState, action, ['player1']);
      
      expect(newState.pendingUndo!.status).toBe('approved');
    });

    it('should use targetActionIndex when specified', () => {
      const action: RequestUndoAction = {
        type: 'requestUndo',
        playerId: 'player1',
        targetActionIndex: 0,
      };
      
      const newState = createUndoRequest(undoState, action, allPlayerIds);
      
      expect(newState.pendingUndo!.targetActionIndex).toBe(0);
    });
  });

  describe('validateUndoResponse', () => {
    beforeEach(() => {
      undoState = recordEvent(undoState, { type: 'event1' });
      undoState = createUndoRequest(undoState, {
        type: 'requestUndo',
        playerId: 'player1',
      }, allPlayerIds);
    });

    it('should validate a valid response', () => {
      const action: RespondUndoAction = {
        type: 'respondUndo',
        playerId: 'player2',
        undoRequestId: undoState.pendingUndo!.id,
        approved: true,
      };
      
      const result = validateUndoResponse(undoState, action, allPlayerIds);
      expect(result.valid).toBe(true);
    });

    it('should reject if no pending request', () => {
      const noRequestState = createUndoState();
      const action: RespondUndoAction = {
        type: 'respondUndo',
        playerId: 'player2',
        undoRequestId: 'fake-id',
        approved: true,
      };
      
      const result = validateUndoResponse(noRequestState, action, allPlayerIds);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('No pending');
    });

    it('should reject if request ID does not match', () => {
      const action: RespondUndoAction = {
        type: 'respondUndo',
        playerId: 'player2',
        undoRequestId: 'wrong-id',
        approved: true,
      };
      
      const result = validateUndoResponse(undoState, action, allPlayerIds);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid undo request ID');
    });

    it('should reject if player has already responded', () => {
      // Player1 already approved (as requester)
      const action: RespondUndoAction = {
        type: 'respondUndo',
        playerId: 'player1',
        undoRequestId: undoState.pendingUndo!.id,
        approved: true,
      };
      
      const result = validateUndoResponse(undoState, action, allPlayerIds);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('already responded');
    });

    it('should reject if responder is not a player', () => {
      const action: RespondUndoAction = {
        type: 'respondUndo',
        playerId: 'spectator1',
        undoRequestId: undoState.pendingUndo!.id,
        approved: true,
      };
      
      const result = validateUndoResponse(undoState, action, allPlayerIds);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Only players');
    });
  });

  describe('processUndoResponse', () => {
    beforeEach(() => {
      undoState = recordEvent(undoState, { type: 'event1' });
      undoState = createUndoRequest(undoState, {
        type: 'requestUndo',
        playerId: 'player1',
      }, allPlayerIds);
    });

    it('should record an approval', () => {
      const action: RespondUndoAction = {
        type: 'respondUndo',
        playerId: 'player2',
        undoRequestId: undoState.pendingUndo!.id,
        approved: true,
      };
      
      const newState = processUndoResponse(undoState, action, allPlayerIds);
      
      expect(newState.pendingUndo!.approvals.has('player2')).toBe(true);
      expect(newState.pendingUndo!.status).toBe('pending'); // Still pending
    });

    it('should set status to approved when all players approve', () => {
      let state = undoState;
      
      // Player 2 approves
      state = processUndoResponse(state, {
        type: 'respondUndo',
        playerId: 'player2',
        undoRequestId: state.pendingUndo!.id,
        approved: true,
      }, allPlayerIds);
      
      // Player 3 approves
      state = processUndoResponse(state, {
        type: 'respondUndo',
        playerId: 'player3',
        undoRequestId: state.pendingUndo!.id,
        approved: true,
      }, allPlayerIds);
      
      expect(state.pendingUndo!.status).toBe('approved');
    });

    it('should set status to rejected if any player rejects', () => {
      const action: RespondUndoAction = {
        type: 'respondUndo',
        playerId: 'player2',
        undoRequestId: undoState.pendingUndo!.id,
        approved: false,
      };
      
      const newState = processUndoResponse(undoState, action, allPlayerIds);
      
      expect(newState.pendingUndo!.rejections.has('player2')).toBe(true);
      expect(newState.pendingUndo!.status).toBe('rejected');
    });
  });

  describe('checkUndoExpiration', () => {
    it('should mark expired requests', () => {
      undoState = recordEvent(undoState, { type: 'event1' });
      undoState = createUndoRequest(undoState, {
        type: 'requestUndo',
        playerId: 'player1',
      }, allPlayerIds);
      
      // Manually set expiration in the past
      const expiredState: UndoState = {
        ...undoState,
        pendingUndo: {
          ...undoState.pendingUndo!,
          expiresAt: Date.now() - 1000,
        },
      };
      
      const newState = checkUndoExpiration(expiredState);
      expect(newState.pendingUndo!.status).toBe('expired');
    });

    it('should not modify non-pending requests', () => {
      undoState = recordEvent(undoState, { type: 'event1' });
      undoState = createUndoRequest(undoState, {
        type: 'requestUndo',
        playerId: 'player1',
      }, ['player1']); // Single player - auto approved
      
      const newState = checkUndoExpiration(undoState);
      expect(newState.pendingUndo!.status).toBe('approved');
    });
  });

  describe('getEventsForUndo', () => {
    beforeEach(() => {
      undoState = recordEvent(undoState, { type: 'event1' });
      undoState = recordEvent(undoState, { type: 'event2' });
      undoState = recordEvent(undoState, { type: 'event3' });
    });

    it('should return events up to target index', () => {
      undoState = createUndoRequest(undoState, {
        type: 'requestUndo',
        playerId: 'player1',
        actionsToUndo: 2,
      }, ['player1']); // Auto-approved
      
      const events = getEventsForUndo(undoState);
      
      expect(events).not.toBeNull();
      expect(events!.length).toBe(1); // Only first event
      expect(events![0].type).toBe('event1');
    });

    it('should return null if no pending undo', () => {
      const events = getEventsForUndo(undoState);
      expect(events).toBeNull();
    });

    it('should return null if undo not approved', () => {
      undoState = createUndoRequest(undoState, {
        type: 'requestUndo',
        playerId: 'player1',
      }, allPlayerIds); // Needs approval
      
      const events = getEventsForUndo(undoState);
      expect(events).toBeNull();
    });
  });

  describe('completeUndo', () => {
    it('should truncate event history and clear pending', () => {
      undoState = recordEvent(undoState, { type: 'event1' });
      undoState = recordEvent(undoState, { type: 'event2' });
      undoState = recordEvent(undoState, { type: 'event3' });
      undoState = createUndoRequest(undoState, {
        type: 'requestUndo',
        playerId: 'player1',
        actionsToUndo: 2,
      }, ['player1']); // Auto-approved
      
      const newState = completeUndo(undoState);
      
      expect(newState.eventHistory.length).toBe(1);
      expect(newState.eventHistory[0].type).toBe('event1');
      expect(newState.pendingUndo).toBeNull();
    });
  });

  describe('cancelUndo', () => {
    it('should clear pending undo request', () => {
      undoState = recordEvent(undoState, { type: 'event1' });
      undoState = createUndoRequest(undoState, {
        type: 'requestUndo',
        playerId: 'player1',
      }, allPlayerIds);
      
      const newState = cancelUndo(undoState);
      
      expect(newState.pendingUndo).toBeNull();
      expect(newState.eventHistory.length).toBe(1); // Events preserved
    });
  });

  describe('getActionsToUndoCount', () => {
    it('should return the correct count', () => {
      undoState = recordEvent(undoState, { type: 'event1' });
      undoState = recordEvent(undoState, { type: 'event2' });
      undoState = recordEvent(undoState, { type: 'event3' });
      undoState = createUndoRequest(undoState, {
        type: 'requestUndo',
        playerId: 'player1',
        actionsToUndo: 2,
      }, ['player1']);
      
      expect(getActionsToUndoCount(undoState)).toBe(2);
    });

    it('should return 0 if no pending undo', () => {
      expect(getActionsToUndoCount(undoState)).toBe(0);
    });
  });

  describe('getUndoDescription', () => {
    it('should return descriptions of actions to undo', () => {
      undoState = recordEvent(undoState, { type: 'playLand', playerId: 'player1' });
      undoState = recordEvent(undoState, { type: 'castSpell', playerId: 'player2' });
      undoState = createUndoRequest(undoState, {
        type: 'requestUndo',
        playerId: 'player1',
        actionsToUndo: 1,
      }, ['player1']);
      
      const descriptions = getUndoDescription(undoState);
      
      expect(descriptions.length).toBe(1);
      expect(descriptions[0]).toContain('castSpell');
      expect(descriptions[0]).toContain('player2');
    });
  });

  describe('canRequestUndo', () => {
    it('should return true when undo is possible', () => {
      undoState = recordEvent(undoState, { type: 'event1' });
      expect(canRequestUndo(undoState, 'player1')).toBe(true);
    });

    it('should return false when undo is disabled', () => {
      const disabledState = createUndoState(false);
      expect(canRequestUndo(disabledState, 'player1')).toBe(false);
    });

    it('should return false when there is a pending request', () => {
      undoState = recordEvent(undoState, { type: 'event1' });
      undoState = createUndoRequest(undoState, {
        type: 'requestUndo',
        playerId: 'player1',
      }, allPlayerIds);
      
      expect(canRequestUndo(undoState, 'player2')).toBe(false);
    });

    it('should return false when no events to undo', () => {
      expect(canRequestUndo(undoState, 'player1')).toBe(false);
    });
  });

  describe('getUndoApprovalStatus', () => {
    it('should return correct approval counts', () => {
      undoState = recordEvent(undoState, { type: 'event1' });
      undoState = createUndoRequest(undoState, {
        type: 'requestUndo',
        playerId: 'player1',
      }, allPlayerIds);
      
      // Player 2 approves
      undoState = processUndoResponse(undoState, {
        type: 'respondUndo',
        playerId: 'player2',
        undoRequestId: undoState.pendingUndo!.id,
        approved: true,
      }, allPlayerIds);
      
      const status = getUndoApprovalStatus(undoState, allPlayerIds);
      
      expect(status.approved).toBe(2); // player1 + player2
      expect(status.rejected).toBe(0);
      expect(status.pending).toBe(1); // player3
      expect(status.total).toBe(3);
      expect(status.status).toBe('pending');
    });

    it('should return none status when no pending request', () => {
      const status = getUndoApprovalStatus(undoState, allPlayerIds);
      expect(status.status).toBe('none');
    });
  });
});
