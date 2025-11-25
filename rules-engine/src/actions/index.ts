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
  type DeclareAttackersAction,
  type DeclareBlockersAction,
  type DealCombatDamageAction,
  type AttackerDeclaration,
  type BlockerDeclaration,
  type CombatDamageAssignment,
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
