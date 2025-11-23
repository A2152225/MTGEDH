/**
 * MTG Rules Engine
 * Pure, deterministic rules engine implementing Magic: The Gathering Comprehensive Rules
 * Based on MagicCompRules 20251114.txt
 * 
 * All functions are side-effect free and operate on immutable inputs
 */
import type { GameState, PlayerID } from '../../shared/src';

export interface EngineResult<T> {
  readonly next: T;
  readonly log?: readonly string[];
}

// Export all Game Concepts types (Rules 100-123)
export * from './types';

// Legacy function - kept for compatibility
export function passPriority(state: Readonly<GameState>, by: PlayerID): EngineResult<GameState> {
  if (state.priority !== by) return { next: state };
  const order = state.players.map(p => p.id);
  if (order.length === 0) return { next: state };
  const idx = order.indexOf(by);
  const nextPriority = order[(idx + 1) % order.length];
  return {
    next: {
      ...state,
      priority: nextPriority
    }
  };
}