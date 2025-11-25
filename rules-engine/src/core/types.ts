/**
 * core/types.ts
 * 
 * Core types for the Rules Engine action system.
 * These types define the structure of actions, validations, and results.
 */

import type { GameState, PlayerID } from '../../../shared/src';

/**
 * Result type for engine operations
 */
export interface EngineResult<T> {
  readonly next: T;
  readonly log?: readonly string[];
}

/**
 * Action validation result
 */
export interface ActionValidation {
  readonly legal: boolean;
  readonly reason?: string;
  readonly requirements?: string[];
}

/**
 * Base action interface - all actions extend this
 */
export interface BaseAction {
  readonly type: string;
  readonly playerId: PlayerID;
  readonly timestamp?: number;
}

/**
 * Game action types
 */
export type GameActionType = 
  | 'passPriority'
  | 'castSpell'
  | 'tapForMana'
  | 'activateAbility'
  | 'declareAttackers'
  | 'declareBlockers'
  | 'resolveStack'
  | 'advanceTurn'
  | 'sacrifice'
  | 'searchLibrary'
  | 'payLife'
  | 'activateFetchland'
  | 'dealCombatDamage'
  | 'drawCard'
  | 'discard'
  | 'mulligan'
  | 'keepHand'
  | 'playLand';

/**
 * Action handler function type
 */
export type ActionHandler = (
  gameId: string,
  action: BaseAction,
  context: ActionContext
) => EngineResult<GameState>;

/**
 * Context provided to action handlers
 */
export interface ActionContext {
  readonly getState: (gameId: string) => GameState | undefined;
  readonly setState: (gameId: string, state: GameState) => void;
  readonly emit: (event: import('./events').RulesEvent) => void;
  readonly gameId: string;
}

/**
 * Action registry for dynamic action handling
 */
export interface ActionRegistry {
  register(actionType: string, handler: ActionHandler): void;
  getHandler(actionType: string): ActionHandler | undefined;
  hasHandler(actionType: string): boolean;
}
