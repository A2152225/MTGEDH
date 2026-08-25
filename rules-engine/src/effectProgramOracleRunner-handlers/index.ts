// rules-engine/src/effectProgramOracleRunner-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// rules-engine/src/effectProgramOracleRunner.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays rules-engine/src/effectProgramOracleRunner.ts.
// Never create effectProgramOracleRunner/ beside effectProgramOracleRunner.ts.
// Leaves must not import effectProgramOracleRunner.ts or this index.

// Normalize ChoiceResponse selections to string ids.
export {
  normalizeChoiceResponseSelection,
  normalizeChoiceResponseSelections,
} from './effectProgramOracleRunnerChoiceNormalize.js';

// Target/player choice option builders for Oracle IR choice events.
export {
  buildOracleIRPlayerChoiceOptions,
  buildOracleIRTargetSelectionOptions,
  hasNonEmptyChoiceOptions,
  inferOracleIRTargetTypes,
  shouldOracleIRPlayerChoiceAllowSelf,
} from './effectProgramOracleRunnerChoiceOptions.js';

// Populate/explore battlefield lookups and land-type helpers.
export {
  buildPopulateTargetChoiceOption,
  findBattlefieldPermanent,
  getCardTypeLine,
  isLandCard,
  readPermanentName,
  resolveExploreTargetId,
  resolvePopulatePlayerId,
} from './effectProgramOracleRunnerChoiceLookups.js';

// Top-library / fateseal player and card lookup helpers.
export {
  findFatesealTargetPlayerId,
  getPlayerLibrary,
  normalizeSelectionIdList,
  normalizeTopLibraryPromptCard,
  quantityToStaticNumber,
  readFirstSelectionForBinding,
  resolveTopLibraryChoicePlayerId,
} from './effectProgramOracleRunnerLibraryLookups.js';

// Clash participant / opponent binding lookups.
export {
  findClashOpponentPlayerId,
  findClashTargetBindingKey,
  resolveClashPlayerId,
} from './effectProgramOracleRunnerClashLookups.js';

// Effect-program binding keys and derived-context type.
export {
  LAST_ACTION_OUTCOME_BINDING,
  LAST_GRANTED_GRAVEYARD_CARDS_BINDING,
  LAST_GRANTED_GRAVEYARD_PERMISSION_IDS_BINDING,
  LAST_MOVED_CARDS_BINDING,
  LAST_REVEALED_CARD_COUNT_BINDING,
  type DerivedOracleIRContextBindings,
} from './effectProgramOracleRunnerBindingKeys.js';

// Classify a chosen id as creature/permanent/player; normalize mana color picks.
export {
  classifyChoiceTarget,
  normalizeChosenManaSelection,
} from './effectProgramOracleRunnerChoiceClassify.js';

// Bindings-derived Oracle IR context/options and mode-id lookup.
export {
  createOracleIRContextWithEffectProgramBindings,
  createOracleIROptionsWithEffectProgramBindings,
  deriveOracleIRContextFromEffectProgramBindings,
  findSelectedModeIdsForCommand,
  readSelectedModeIdsForBinding,
} from './effectProgramOracleRunnerContextBindings.js';
