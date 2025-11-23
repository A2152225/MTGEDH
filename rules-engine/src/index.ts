// Pure, deterministic rules engine entry points
// All functions here must be side-effect free and operate on immutable inputs
import type { GameState, PlayerID } from '../../shared/src';

export interface EngineResult<T> {
  readonly next: T;
  readonly log?: readonly string[];
}

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

// Export mana utilities
export * from './mana';

// Export timing validators
export * from './timing';
