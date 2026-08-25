// rules-engine/src/oracleIRExecutorCreatureStepUtils-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// rules-engine/src/oracleIRExecutorCreatureStepUtils.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays rules-engine/src/oracleIRExecutorCreatureStepUtils.ts.
// Never create oracleIRExecutorCreatureStepUtils/ beside the .ts.
// Leaves must not import oracleIRExecutorCreatureStepUtils.ts or this index.

// Processed battlefield, printed/effective P/T, subtype and controller lookups.
export {
  getProcessedBattlefield,
  readPermanentPower,
  readPermanentToughness,
  permanentIsCreature,
  isMassTapOrUntapSelectorText,
  permanentHasSubtype,
  getSourceBattlefieldPermanent,
  getControlledPermanents,
} from './oracleIRExecutorCreatureBattlefieldLookup';

// P/T comparison readers, attacking/blocking helpers, keyword check.
export {
  readPowerForComparison,
  readToughnessForComparison,
  readCreatureStatForComparison,
  isAttackingPermanent,
  resolveBlockersOfPermanent,
  resolveBlockingCreatureIds,
  isUnblockedAttackingPermanent,
  permanentHasKeyword,
} from './oracleIRExecutorCreatureBattlefieldHelpers';

// Single-creature target plus mentor / extrema / bolster / trepanation.
export {
  resolveMentorTargetCreatureIdFromBattlefield,
  resolveCreatureExtremaQualifiedTargetIdFromBattlefield,
  resolveBolsterTargetCreatureIdFromBattlefield,
  resolveTrepanationBoostTargetCreatureId,
  resolveSingleCreatureTargetId,
} from './oracleIRExecutorCreatureSingleTarget';

// Multi-creature target resolution plus exclusive controlled-qualifier helpers.
export { resolveCreatureTargetIds } from './oracleIRExecutorCreatureTargetIds';
