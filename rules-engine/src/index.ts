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

// Export Rule 703: Turn-Based Actions
export * from './turnBasedActions';

// Export Rule 704: State-Based Actions
export * from './stateBasedActions';

// Export Rule 705: Flipping a Coin
export * from './coinFlip';

// Export Rule 706: Rolling a Die
export * from './dieRoll';

// Export Rule 707: Copying Objects
export * from './copyingObjects';

// Export Rule 708: Face-Down Spells and Permanents
export * from './faceDownObjects';

// Export Rule 709: Split Cards
export * from './splitCards';

// Export Rule 710: Flip Cards
export * from './flipCards';

// Export Rule 711: Leveler Cards
export * from './levelerCards';

// Export Rule 712: Double-Faced Cards
export * from './doubleFacedCards';

// Export Rules 713-719: Remaining Card Types
export * from './remainingCardTypes';

// Export Rules 720-732: Special Game Mechanics
export * from './specialGameMechanics';

// Export Keyword Abilities (Rule 702)
export * from './keywordAbilities';

// Export Keyword Actions (Rule 701)
export * from './keywordActions';

// Export Rules Engine Adapter
export * from './RulesEngineAdapter';

// Export AI Engine
export * from './AIEngine';

// Export Game Simulator
export * from './GameSimulator';

// Export spell casting system (Rule 601)
export * from './spellCasting';

// Export mana abilities (Rule 605)
export * from './manaAbilities';

// Export stack operations (Rule 405)
export * from './stackOperations';

// Export activated abilities (Rule 602)
export * from './activatedAbilities';

// Export triggered abilities (Rule 603)
export * from './triggeredAbilities';

// Export opening hand actions (Rule 103.6 - Leyline and Chancellor effects)
export * from './openingHandActions';

// Export modular action handlers
export * from './actions';

// Export core types and events
export * from './core';

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