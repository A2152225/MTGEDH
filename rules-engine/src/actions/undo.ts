/**
 * actions/undo.ts
 * 
 * Undo action handlers for game state reversion.
 * Implements a player-approval based undo system that uses the deterministic
 * replay system to restore game state to a previous point.
 * 
 * Key features:
 * - Requires all players to approve an undo request
 * - Uses rngSeed-based deterministic replay for accurate state restoration
 * - Tracks undo requests and approvals
 * - Supports undoing any number of actions
 */

import type { GameState } from '../../../shared/src';
import type { BaseAction } from '../core/types';

/**
 * Undo request state tracking
 */
export interface UndoRequest {
  readonly id: string;
  readonly requesterId: string;
  readonly targetActionIndex: number;  // Index in event log to revert to
  readonly createdAt: number;
  readonly approvals: Set<string>;     // Player IDs who have approved
  readonly rejections: Set<string>;    // Player IDs who have rejected
  readonly status: 'pending' | 'approved' | 'rejected' | 'expired';
  readonly expiresAt: number;          // Auto-expire after timeout
}

/**
 * Undo tracking state to be added to GameState or GameContext
 */
export interface UndoState {
  /** History of all game events (for replay) */
  readonly eventHistory: readonly GameEvent[];
  /** Current pending undo request, if any */
  readonly pendingUndo: UndoRequest | null;
  /** Whether undo is enabled for this game */
  readonly undoEnabled: boolean;
  /** Timeout in milliseconds for undo approval (default 60000 = 1 minute) */
  readonly undoTimeoutMs: number;
}

/**
 * Generic game event interface (matches server/src/state/types.ts)
 */
export interface GameEvent {
  readonly type: string;
  readonly timestamp?: number;
  readonly playerId?: string;
  [key: string]: any;
}

/**
 * Request undo action
 */
export interface RequestUndoAction extends BaseAction {
  readonly type: 'requestUndo';
  readonly actionsToUndo?: number;  // Number of actions to undo (default 1)
  readonly targetActionIndex?: number;  // Specific action index to revert to
}

/**
 * Respond to undo request action
 */
export interface RespondUndoAction extends BaseAction {
  readonly type: 'respondUndo';
  readonly undoRequestId: string;
  readonly approved: boolean;
}

/**
 * Validation result for undo operations
 */
export interface UndoValidationResult {
  readonly valid: boolean;
  readonly reason?: string;
}

/**
 * Default undo timeout (1 minute)
 */
export const DEFAULT_UNDO_TIMEOUT_MS = 60000;

/**
 * Counter for unique undo request IDs within a session
 */
let undoRequestCounter = 0;

/**
 * Generate a unique ID for undo requests
 * Uses a combination of timestamp, counter, and random value for uniqueness
 */
export function generateUndoRequestId(): string {
  undoRequestCounter++;
  // Combine timestamp, counter, and crypto-safe random bytes if available
  const randomPart = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().substring(0, 8)
    : Math.random().toString(36).substring(2, 10);
  return `undo_${Date.now()}_${undoRequestCounter}_${randomPart}`;
}

/**
 * Initialize undo state for a game
 * 
 * @param enabled - Whether undo is enabled for this game
 * @param timeoutMs - Timeout for undo approval in milliseconds
 * @returns Initial undo state
 */
export function createUndoState(enabled = true, timeoutMs = DEFAULT_UNDO_TIMEOUT_MS): UndoState {
  return {
    eventHistory: [],
    pendingUndo: null,
    undoEnabled: enabled,
    undoTimeoutMs: timeoutMs,
  };
}

/**
 * Record a game event in the undo history
 * 
 * @param undoState - Current undo state
 * @param event - Event to record
 * @returns Updated undo state with the event recorded
 */
export function recordEvent(undoState: UndoState, event: GameEvent): UndoState {
  return {
    ...undoState,
    eventHistory: [...undoState.eventHistory, event],
  };
}

/**
 * Validate a request to undo
 * 
 * @param state - Current game state
 * @param undoState - Current undo state
 * @param action - The undo request action
 * @param allPlayerIds - All player IDs in the game (non-spectators)
 * @returns Validation result
 */
export function validateUndoRequest(
  state: GameState,
  undoState: UndoState,
  action: RequestUndoAction,
  allPlayerIds: readonly string[]
): UndoValidationResult {
  // Check if undo is enabled
  if (!undoState.undoEnabled) {
    return { valid: false, reason: 'Undo is not enabled for this game' };
  }
  
  // Check if there's already a pending undo request
  if (undoState.pendingUndo && undoState.pendingUndo.status === 'pending') {
    return { valid: false, reason: 'There is already a pending undo request' };
  }
  
  // Check if requester is a player in the game
  if (!allPlayerIds.includes(action.playerId)) {
    return { valid: false, reason: 'Only players can request an undo' };
  }
  
  // Check if there are events to undo
  if (undoState.eventHistory.length === 0) {
    return { valid: false, reason: 'No actions to undo' };
  }
  
  // Calculate target action index
  const targetIndex = action.targetActionIndex !== undefined
    ? action.targetActionIndex
    : undoState.eventHistory.length - (action.actionsToUndo || 1);
  
  if (targetIndex < 0) {
    return { valid: false, reason: 'Cannot undo that many actions' };
  }
  
  if (targetIndex >= undoState.eventHistory.length) {
    return { valid: false, reason: 'Invalid target action index' };
  }
  
  return { valid: true };
}

/**
 * Create a new undo request
 * 
 * @param undoState - Current undo state
 * @param action - The undo request action
 * @param allPlayerIds - All player IDs in the game
 * @returns Updated undo state with the pending request
 */
export function createUndoRequest(
  undoState: UndoState,
  action: RequestUndoAction,
  allPlayerIds: readonly string[]
): UndoState {
  const targetIndex = action.targetActionIndex !== undefined
    ? action.targetActionIndex
    : undoState.eventHistory.length - (action.actionsToUndo || 1);
  
  const request: UndoRequest = {
    id: generateUndoRequestId(),
    requesterId: action.playerId,
    targetActionIndex: targetIndex,
    createdAt: Date.now(),
    approvals: new Set([action.playerId]), // Requester auto-approves
    rejections: new Set(),
    status: 'pending',
    expiresAt: Date.now() + undoState.undoTimeoutMs,
  };
  
  // If single player game, auto-approve
  if (allPlayerIds.length === 1) {
    return {
      ...undoState,
      pendingUndo: {
        ...request,
        status: 'approved',
      },
    };
  }
  
  return {
    ...undoState,
    pendingUndo: request,
  };
}

/**
 * Validate an undo response
 * 
 * @param undoState - Current undo state
 * @param action - The undo response action
 * @param allPlayerIds - All player IDs in the game
 * @returns Validation result
 */
export function validateUndoResponse(
  undoState: UndoState,
  action: RespondUndoAction,
  allPlayerIds: readonly string[]
): UndoValidationResult {
  // Check if there's a pending undo request
  if (!undoState.pendingUndo) {
    return { valid: false, reason: 'No pending undo request' };
  }
  
  // Check if the request matches
  if (undoState.pendingUndo.id !== action.undoRequestId) {
    return { valid: false, reason: 'Invalid undo request ID' };
  }
  
  // Check if the request is still pending
  if (undoState.pendingUndo.status !== 'pending') {
    return { valid: false, reason: 'Undo request is no longer pending' };
  }
  
  // Check if the request has expired
  if (Date.now() > undoState.pendingUndo.expiresAt) {
    return { valid: false, reason: 'Undo request has expired' };
  }
  
  // Check if responder is a player
  if (!allPlayerIds.includes(action.playerId)) {
    return { valid: false, reason: 'Only players can respond to undo requests' };
  }
  
  // Check if player has already responded
  if (undoState.pendingUndo.approvals.has(action.playerId) ||
      undoState.pendingUndo.rejections.has(action.playerId)) {
    return { valid: false, reason: 'You have already responded to this undo request' };
  }
  
  return { valid: true };
}

/**
 * Process an undo response
 * 
 * @param undoState - Current undo state
 * @param action - The undo response action
 * @param allPlayerIds - All player IDs in the game
 * @returns Updated undo state with the response recorded
 */
export function processUndoResponse(
  undoState: UndoState,
  action: RespondUndoAction,
  allPlayerIds: readonly string[]
): UndoState {
  if (!undoState.pendingUndo) {
    return undoState;
  }
  
  const newApprovals = new Set(undoState.pendingUndo.approvals);
  const newRejections = new Set(undoState.pendingUndo.rejections);
  
  if (action.approved) {
    newApprovals.add(action.playerId);
  } else {
    newRejections.add(action.playerId);
  }
  
  // Check if all players have approved
  const allApproved = allPlayerIds.every(id => newApprovals.has(id));
  
  // Check if any player has rejected
  const anyRejected = newRejections.size > 0;
  
  let status: UndoRequest['status'] = 'pending';
  if (allApproved) {
    status = 'approved';
  } else if (anyRejected) {
    status = 'rejected';
  }
  
  return {
    ...undoState,
    pendingUndo: {
      ...undoState.pendingUndo,
      approvals: newApprovals,
      rejections: newRejections,
      status,
    },
  };
}

/**
 * Check if an undo request has expired and update status accordingly
 * 
 * @param undoState - Current undo state
 * @returns Updated undo state
 */
export function checkUndoExpiration(undoState: UndoState): UndoState {
  if (!undoState.pendingUndo) {
    return undoState;
  }
  
  if (undoState.pendingUndo.status !== 'pending') {
    return undoState;
  }
  
  if (Date.now() > undoState.pendingUndo.expiresAt) {
    return {
      ...undoState,
      pendingUndo: {
        ...undoState.pendingUndo,
        status: 'expired',
      },
    };
  }
  
  return undoState;
}

/**
 * Get the events to replay when performing an undo
 * 
 * @param undoState - Current undo state
 * @returns Events to replay, or null if undo cannot be performed
 */
export function getEventsForUndo(undoState: UndoState): readonly GameEvent[] | null {
  if (!undoState.pendingUndo) {
    return null;
  }
  
  if (undoState.pendingUndo.status !== 'approved') {
    return null;
  }
  
  const targetIndex = undoState.pendingUndo.targetActionIndex;
  
  // Return events up to (but not including) the target index
  return undoState.eventHistory.slice(0, targetIndex);
}

/**
 * Complete the undo operation by updating the event history
 * 
 * @param undoState - Current undo state
 * @returns Updated undo state with truncated event history
 */
export function completeUndo(undoState: UndoState): UndoState {
  if (!undoState.pendingUndo || undoState.pendingUndo.status !== 'approved') {
    return undoState;
  }
  
  const targetIndex = undoState.pendingUndo.targetActionIndex;
  
  return {
    ...undoState,
    eventHistory: undoState.eventHistory.slice(0, targetIndex),
    pendingUndo: null,
  };
}

/**
 * Cancel the current undo request
 * 
 * @param undoState - Current undo state
 * @returns Updated undo state with no pending request
 */
export function cancelUndo(undoState: UndoState): UndoState {
  return {
    ...undoState,
    pendingUndo: null,
  };
}

/**
 * Get the number of actions that would be undone
 * 
 * @param undoState - Current undo state
 * @returns Number of actions to undo, or 0 if no pending undo
 */
export function getActionsToUndoCount(undoState: UndoState): number {
  if (!undoState.pendingUndo) {
    return 0;
  }
  
  return undoState.eventHistory.length - undoState.pendingUndo.targetActionIndex;
}

/**
 * Get the description of what will be undone
 * 
 * @param undoState - Current undo state
 * @returns Array of event type descriptions that will be undone
 */
export function getUndoDescription(undoState: UndoState): string[] {
  if (!undoState.pendingUndo) {
    return [];
  }
  
  const targetIndex = undoState.pendingUndo.targetActionIndex;
  const eventsToUndo = undoState.eventHistory.slice(targetIndex);
  
  return eventsToUndo.map(e => {
    if (e.type && e.playerId) {
      return `${e.type} by ${e.playerId}`;
    }
    return e.type || 'unknown action';
  });
}

/**
 * Check if a player can request an undo right now
 * 
 * @param undoState - Current undo state
 * @param playerId - Player requesting the undo
 * @returns true if the player can request an undo
 */
export function canRequestUndo(undoState: UndoState, playerId: string): boolean {
  // Undo must be enabled
  if (!undoState.undoEnabled) {
    return false;
  }
  
  // No pending request
  if (undoState.pendingUndo && undoState.pendingUndo.status === 'pending') {
    return false;
  }
  
  // Must have events to undo
  if (undoState.eventHistory.length === 0) {
    return false;
  }
  
  return true;
}

/**
 * Get the approval status for the current undo request
 * 
 * @param undoState - Current undo state
 * @param allPlayerIds - All player IDs in the game
 * @returns Object with approval counts and status
 */
export function getUndoApprovalStatus(
  undoState: UndoState,
  allPlayerIds: readonly string[]
): {
  approved: number;
  rejected: number;
  pending: number;
  total: number;
  status: UndoRequest['status'] | 'none';
} {
  if (!undoState.pendingUndo) {
    return {
      approved: 0,
      rejected: 0,
      pending: 0,
      total: allPlayerIds.length,
      status: 'none',
    };
  }
  
  return {
    approved: undoState.pendingUndo.approvals.size,
    rejected: undoState.pendingUndo.rejections.size,
    pending: allPlayerIds.length - undoState.pendingUndo.approvals.size - undoState.pendingUndo.rejections.size,
    total: allPlayerIds.length,
    status: undoState.pendingUndo.status,
  };
}
