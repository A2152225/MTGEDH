/**
 * actions/gamePhases.ts
 * 
 * Game phase and step definitions and transitions.
 * Follows MTG Comprehensive Rules for turn structure.
 * 
 * Note: These enums align with the shared types in shared/src/types.ts
 */

// Re-export the shared types for consistency
export { GamePhase, GameStep } from '../../../shared/src';
import { GamePhase, GameStep } from '../../../shared/src';

/**
 * Steps that receive priority
 */
export const PRIORITY_STEPS = new Set([
  GameStep.UPKEEP,
  GameStep.DRAW,
  GameStep.MAIN1,
  GameStep.MAIN2,
  GameStep.BEGIN_COMBAT,
  GameStep.DECLARE_ATTACKERS,
  GameStep.DECLARE_BLOCKERS,
  GameStep.DAMAGE,
  GameStep.END_COMBAT,
  GameStep.END,
]);

/**
 * Get the next step in the game flow
 */
export function getNextGameStep(
  phase: GamePhase,
  step: GameStep
): { phase: GamePhase; step: GameStep; isNewTurn: boolean } {
  switch (step) {
    // Beginning phase
    case GameStep.UNTAP:
      return { phase: GamePhase.BEGINNING, step: GameStep.UPKEEP, isNewTurn: false };
    case GameStep.UPKEEP:
      return { phase: GamePhase.BEGINNING, step: GameStep.DRAW, isNewTurn: false };
    case GameStep.DRAW:
      return { phase: GamePhase.PRECOMBAT_MAIN, step: GameStep.MAIN1, isNewTurn: false };
    
    // Main 1
    case GameStep.MAIN1:
      return { phase: GamePhase.COMBAT, step: GameStep.BEGIN_COMBAT, isNewTurn: false };
    
    // Combat phase
    case GameStep.BEGIN_COMBAT:
      return { phase: GamePhase.COMBAT, step: GameStep.DECLARE_ATTACKERS, isNewTurn: false };
    case GameStep.DECLARE_ATTACKERS:
      return { phase: GamePhase.COMBAT, step: GameStep.DECLARE_BLOCKERS, isNewTurn: false };
    case GameStep.DECLARE_BLOCKERS:
      return { phase: GamePhase.COMBAT, step: GameStep.DAMAGE, isNewTurn: false };
    case GameStep.DAMAGE:
      return { phase: GamePhase.COMBAT, step: GameStep.END_COMBAT, isNewTurn: false };
    case GameStep.END_COMBAT:
      return { phase: GamePhase.POSTCOMBAT_MAIN, step: GameStep.MAIN2, isNewTurn: false };
    
    // Main 2
    case GameStep.MAIN2:
      return { phase: GamePhase.ENDING, step: GameStep.END, isNewTurn: false };
    
    // End phase
    case GameStep.END:
      return { phase: GamePhase.ENDING, step: GameStep.CLEANUP, isNewTurn: false };
    case GameStep.CLEANUP:
      return { phase: GamePhase.BEGINNING, step: GameStep.UNTAP, isNewTurn: true };
    
    default:
      return { phase, step, isNewTurn: false };
  }
}

/**
 * Check if a step receives priority
 */
export function doesStepReceivePriority(step: GameStep): boolean {
  return PRIORITY_STEPS.has(step);
}

/**
 * Check if we're in a main phase
 */
export function isMainPhase(phase: GamePhase): boolean {
  return phase === GamePhase.PRECOMBAT_MAIN || phase === GamePhase.POSTCOMBAT_MAIN;
}

/**
 * Check if we're in combat
 */
export function isInCombat(phase: GamePhase): boolean {
  return phase === GamePhase.COMBAT;
}
