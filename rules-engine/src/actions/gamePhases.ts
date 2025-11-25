/**
 * actions/gamePhases.ts
 * 
 * Game phase and step definitions and transitions.
 * Follows MTG Comprehensive Rules for turn structure.
 */

/**
 * Game phases matching comprehensive rules
 */
export enum GamePhase {
  PRE_GAME = 'PRE_GAME',
  BEGINNING = 'BEGINNING',
  PRECOMBAT_MAIN = 'PRECOMBAT_MAIN',
  COMBAT = 'COMBAT',
  POSTCOMBAT_MAIN = 'POSTCOMBAT_MAIN',
  ENDING = 'ENDING',
}

/**
 * Game steps within phases
 */
export enum GameStep {
  // Pre-game
  SETUP = 'SETUP',
  MULLIGAN = 'MULLIGAN',
  
  // Beginning phase
  UNTAP = 'UNTAP',
  UPKEEP = 'UPKEEP',
  DRAW = 'DRAW',
  
  // Main phases
  MAIN = 'MAIN',
  
  // Combat phase
  BEGINNING_OF_COMBAT = 'BEGINNING_OF_COMBAT',
  DECLARE_ATTACKERS = 'DECLARE_ATTACKERS',
  DECLARE_BLOCKERS = 'DECLARE_BLOCKERS',
  COMBAT_DAMAGE = 'COMBAT_DAMAGE',
  END_OF_COMBAT = 'END_OF_COMBAT',
  
  // Ending phase
  END_STEP = 'END_STEP',
  CLEANUP = 'CLEANUP',
}

/**
 * Steps that receive priority
 */
export const PRIORITY_STEPS = new Set([
  GameStep.UPKEEP,
  GameStep.DRAW,
  GameStep.MAIN,
  GameStep.BEGINNING_OF_COMBAT,
  GameStep.DECLARE_ATTACKERS,
  GameStep.DECLARE_BLOCKERS,
  GameStep.COMBAT_DAMAGE,
  GameStep.END_OF_COMBAT,
  GameStep.END_STEP,
]);

/**
 * Get the next step in the game flow
 */
export function getNextGameStep(
  phase: GamePhase,
  step: GameStep
): { phase: GamePhase; step: GameStep; isNewTurn: boolean } {
  switch (step) {
    // Pre-game flow
    case GameStep.SETUP:
      return { phase: GamePhase.PRE_GAME, step: GameStep.MULLIGAN, isNewTurn: false };
    case GameStep.MULLIGAN:
      return { phase: GamePhase.BEGINNING, step: GameStep.UNTAP, isNewTurn: false };
    
    // Beginning phase
    case GameStep.UNTAP:
      return { phase: GamePhase.BEGINNING, step: GameStep.UPKEEP, isNewTurn: false };
    case GameStep.UPKEEP:
      return { phase: GamePhase.BEGINNING, step: GameStep.DRAW, isNewTurn: false };
    case GameStep.DRAW:
      return { phase: GamePhase.PRECOMBAT_MAIN, step: GameStep.MAIN, isNewTurn: false };
    
    // Combat phase
    case GameStep.BEGINNING_OF_COMBAT:
      return { phase: GamePhase.COMBAT, step: GameStep.DECLARE_ATTACKERS, isNewTurn: false };
    case GameStep.DECLARE_ATTACKERS:
      return { phase: GamePhase.COMBAT, step: GameStep.DECLARE_BLOCKERS, isNewTurn: false };
    case GameStep.DECLARE_BLOCKERS:
      return { phase: GamePhase.COMBAT, step: GameStep.COMBAT_DAMAGE, isNewTurn: false };
    case GameStep.COMBAT_DAMAGE:
      return { phase: GamePhase.COMBAT, step: GameStep.END_OF_COMBAT, isNewTurn: false };
    case GameStep.END_OF_COMBAT:
      return { phase: GamePhase.POSTCOMBAT_MAIN, step: GameStep.MAIN, isNewTurn: false };
    
    // End phase
    case GameStep.END_STEP:
      return { phase: GamePhase.ENDING, step: GameStep.CLEANUP, isNewTurn: false };
    case GameStep.CLEANUP:
      return { phase: GamePhase.BEGINNING, step: GameStep.UNTAP, isNewTurn: true };
    
    // Main phase transitions
    case GameStep.MAIN:
      if (phase === GamePhase.PRECOMBAT_MAIN) {
        return { phase: GamePhase.COMBAT, step: GameStep.BEGINNING_OF_COMBAT, isNewTurn: false };
      } else {
        return { phase: GamePhase.ENDING, step: GameStep.END_STEP, isNewTurn: false };
      }
    
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
