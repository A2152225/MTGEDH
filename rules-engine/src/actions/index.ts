/**
 * actions/index.ts
 * 
 * Central export for all action handlers.
 * Provides a unified interface for action execution.
 */

// Sacrifice actions (Rule 701.21)
export { 
  validateSacrifice, 
  executeSacrifice,
  type SacrificeAction 
} from './sacrifice';

// Search library actions (Rule 701.23)
export { 
  validateSearchLibrary, 
  executeSearchLibrary,
  type SearchLibraryAction,
  type SearchCriteria 
} from './searchLibrary';

// Combat actions
export {
  validateDeclareAttackers,
  executeDeclareAttackers,
  validateDeclareBlockers,
  executeDeclareBlockers,
  executeCombatDamage,
  // Combat validation helpers
  isCurrentlyCreature,
  hasDefender,
  hasHaste,
  hasLifelink,
  canPermanentAttack,
  canPermanentBlock,
  checkEvasionAbilities,
  getCombatDamageValue,
  getLegalAttackers,
  getLegalBlockers,
  type DeclareAttackersAction,
  type DeclareBlockersAction,
  type DealCombatDamageAction,
  type AttackerDeclaration,
  type BlockerDeclaration,
  type CombatDamageAssignment,
  type CombatValidationResult,
} from './combat';

// Fetchland actions
export {
  validateFetchland,
  executeFetchland,
  createEvolvingWildsAction,
  createEnemyFetchlandAction,
  createAlliedFetchlandAction,
  type FetchlandAction,
} from './fetchland';

// Game phases and steps
export {
  GamePhase,
  GameStep,
  getNextGameStep,
  doesStepReceivePriority,
  isMainPhase,
  isInCombat,
  PRIORITY_STEPS,
} from './gamePhases';

// State-based actions handler
export {
  performStateBasedActions,
  checkWinConditions,
  type SBAResult,
} from './stateBasedActionsHandler';

// Turn-based actions
export {
  executeUntapStep,
  executeDrawStep,
  executeCleanupStep,
  executeTurnBasedAction,
} from './turnActions';

// Triggered abilities handler
export {
  processTriggers,
  findTriggeredAbilities,
  checkETBTriggers,
  checkDiesTriggers,
  checkStepTriggers,
  type TriggerResult,
} from './triggersHandler';

// Game setup and mulligan
export {
  initializeGame,
  drawInitialHand,
  processMulligan,
  completeMulliganPhase,
} from './gameSetup';

// Game advancement
export {
  advanceGame,
  skipToPhase,
  passPriority,
} from './gameAdvance';

// Undo system
export {
  // Types
  type UndoRequest,
  type UndoState,
  type GameEvent as UndoGameEvent,
  type RequestUndoAction,
  type RespondUndoAction,
  type UndoValidationResult,
  // Constants
  DEFAULT_UNDO_TIMEOUT_MS,
  // Functions
  generateUndoRequestId,
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
} from './undo';
