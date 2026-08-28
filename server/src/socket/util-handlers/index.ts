// server/src/socket/util-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of server/src/socket/util.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays server/src/socket/util.ts ("./util.js").

// Mana color symbols, pool keys, and symbol -> name lookup.
export {
  MANA_COLOR_NAMES,
  MANA_COLORS,
  MANA_COLOR_KEYS,
  getManaColorName,
} from "./manaColorConstants.js";
export type { ManaColorSymbol, ManaColorKey } from "./manaColorConstants.js";

// Mana pool accessors, retention effects, phase-end drain, clears, totals, payment validation.
export {
  getOrInitManaPool,
  getOrInitPersistentManaPool,
  detectManaRetentionEffects,
  addPersistentMana,
  processManaDrain,
  clearManaPool,
  clearPersistentManaPool,
  clearAllManaPools,
  getTotalManaPool,
  calculateTotalAvailableMana,
  validateManaPayment,
} from "./manaPoolStateOperations.js";
export type { ManaRetentionEffect } from "./manaPoolStateOperations.js";

// Replay-safe provenance lower bounds for Treasure / creature-spell-haste / per-permanent mana.
export {
  recordTreasureManaProduced,
  snapshotTreasureManaLowerBound,
  applyManaSpendToTreasureLowerBound,
  deriveManaFromTreasureSpent,
  recordCreatureSpellHasteManaProduced,
  snapshotCreatureSpellHasteManaLowerBound,
  applyManaSpendToCreatureSpellHasteManaLowerBound,
  deriveCreatureSpellHasteFromManaSpent,
  recordManaProducedByPermanentSource,
  snapshotManaProducedByPermanentLowerBound,
  applyManaSpendToManaProducedByPermanentLowerBound,
  deriveCastUsedManaFromPermanentSource,
} from "./manaProvenanceLowerBounds.js";

// Restricted mana entries, doesn't-empty flags, spend-purpose eligibility, floating pool-payment keys.
export {
  getManaEntryColor,
  addRestrictedManaToPool,
  removeRestrictedManaFromPool,
  setManaPoolDoesNotEmpty,
  removeManaPoolDoesNotEmpty,
  getTotalManaInPool,
  getTotalManaOfColorInPool,
  canUseRestrictedMana,
  parseFloatingPaymentPermanentId,
  getFloatingPaymentPoolColorKey,
  validateSelectedFloatingPoolMana,
  buildManaTotalsIncludingEligibleRestricted,
} from "./manaRestrictedPoolOperations.js";
export type { RestrictedManaSpendPurpose } from "./manaRestrictedPoolOperations.js";

// Calculated mana-production result shape.
export type { ManaProductionInfo } from "./manaProductionTypes.js";

// Spelled-out / numeric mana amount tokens used by calculateManaProduction.
export { parseSpelledOutAmount } from "./manaProductionAmountParse.js";

// Devotion color regexes and color-choice gate used by dynamic mana production.
export { DEVOTION_COLOR_PATTERNS } from "./manaProductionDevotionPatterns.js";
export {
  shouldApplyDevotionColorChoiceMana,
  shouldApplyChosenTypeColorChoiceMana,
  shouldSkipScalingManaForColorlessTap,
} from "./manaProductionDevotionHelpers.js";

// STEP 1 land/basic / any-color / legacy overlay inside calculateManaProduction.
export { tryCalculateManaProductionLandBasic } from "./tryCalculateManaProductionLandBasic.js";
export type { CalculateManaProductionLandBasicArgs } from "./tryCalculateManaProductionLandBasic.js";

// STEP 2 dynamic (Cradle, devotion, charge, Nykthos) inside calculateManaProduction.
export { tryCalculateManaProductionDynamic } from "./tryCalculateManaProductionDynamic.js";

// Power/toughness-based creature mana inside calculateManaProduction.
export { tryCalculateManaProductionCreaturePower } from "./tryCalculateManaProductionCreaturePower.js";

// Storage / charge / battery mana inside calculateManaProduction.
export { tryCalculateManaProductionStorageBattery } from "./tryCalculateManaProductionStorageBattery.js";

// Aura bonuses, global multipliers, and total inside calculateManaProduction.
export { tryCalculateManaProductionBonusesAndTotal } from "./tryCalculateManaProductionBonusesAndTotal.js";

// Dispatcher that runs tryCalculateX families; first defined result wins.
export { calculateManaProduction } from "./calculateManaProduction.js";

// Activated / client-style / legacy mana ability line resolvers.
export {
  resolveActivatedAbilityLineById,
  resolveClientStyleManaAbilityById,
  resolveLegacyManaAbilityById,
} from "./manaAbilityLineResolvers.js";

// Remove-counter activation-cost parse and permanent counter-key lookup.
export {
  parseRemoveCounterActivationCost,
  getPermanentCounterKeyCandidates,
  getPermanentCounterAmount,
  resolvePermanentCounterKey,
  resolveRemoveCounterCostFromActivation,
  normalizeRemoveCounterTypePhrase,
} from "./manaRemoveCounterCostParse.js";
export type { ParsedRemoveCounterActivationCost } from "./manaRemoveCounterCostParse.js";

// Colored-then-generic drain of a floating mana pool.
export { consumeManaFromPool } from "./consumeManaFromPool.js";

// Restricted-purpose spend then floating-pool drain.
export { consumeManaFromPoolForPurpose } from "./consumeManaFromPoolForPurpose.js";

// String mana cost to colors / generic / hybrid / X.
export { parseManaCost } from "./parseManaCost.js";

// Hybrid-aware floating-pool validate/consume and ability spend-restriction helpers.
export {
  getPoolNumericSnapshot,
  validateAndConsumeManaCostFromPool,
  resolvePaymentManaAbilitySpendRestriction,
  restrictedManaSpendRestrictionAllowsPurpose,
  buildActivatedAbilityRestrictedManaPurpose,
  validateAbilityManaCostFromPool,
  payAbilityManaCostFromPool,
  addCastSpellPaymentProducedMana,
  resolveManaCostForPoolPayment,
} from "./manaPoolCostPayment.js";
export type { ResolveManaCostForPoolPaymentResult } from "./manaPoolCostPayment.js";

// Tap/sacrifice auto-payment of generic and string costs from available sources.
export {
  getMaxGenericManaAvailable,
  payGenericManaWithAvailableSources,
  canPayManaCostStringWithAvailableSources,
  payManaCostWithAvailableSources,
  refundGenericManaPayment,
} from "./genericManaPaymentFromSources.js";
export type { AvailableSourceManaPaymentResult } from "./genericManaPaymentFromSources.js";

// Unsupported extra activation-cost residue (discard/exile/life) gate.
export { paymentActivationCostHasUnsupportedAdditionalCosts } from "./paymentActivationCostHasUnsupportedAdditionalCosts.js";

// Gemstone Array / Trigon-style invest-and-payout counter loop.
export { permanentHasManaBatteryCounterLoop } from "./permanentHasManaBatteryCounterLoop.js";

// Main-phase step token check.
export { isInMainPhase } from "./utilMainPhaseCheck.js";

// Hand/battlefield/exile/graveyard/top-deck playable ids.
export { getPlayableCardIds } from "./getPlayableCardIds.js";

// Graveyard flashback/unearth/embalm/escape hints.
export { getGraveyardAbilityHints } from "./getGraveyardAbilityHints.js";

// Effective P/T after statics and temporary mods.
export { getEffectivePower, getEffectiveToughness } from "./getEffectivePowerToughness.js";

// Auto-pass timer maps, idle-bypass predicates, land-play suppression window.
export {
  AUTO_PASS_DELAY_MS,
  LAND_PLAY_AUTOMATION_SUPPRESSION_MS,
  clearScheduledHumanAutoPass,
  clearScheduledHumanAutoPassForGame,
  clearScheduledAutomationResume,
} from "./autoPassTimerState.js";

// Timestamp helper and stuck-priority repair.
export { ts, repairMissingPriorityIfStuck } from "./repairMissingPriorityIfStuck.js";

// Human/AI auto-pass scheduling body (parent supplies broadcast/append/persist deps).
export { runCheckAndTriggerAutoPass } from "./checkAndTriggerAutoPass.js";
export type { CheckAndTriggerAutoPassDeps } from "./checkAndTriggerAutoPass.js";

// Mana-pool socket emit plus optional full-state broadcast.
export { runBroadcastManaPoolUpdate } from "./broadcastManaPoolUpdate.js";
export type { BroadcastManaPoolUpdateDeps } from "./broadcastManaPoolUpdate.js";

// Emit an event to a player's connected sockets.
export { emitToPlayer } from "./emitToPlayer.js";

// defaultPlayerZones, ensureStateZonesForPlayers, millUntilLand.
export { defaultPlayerZones, ensureStateZonesForPlayers, millUntilLand } from "./playerStateZones.js";

// Shared emit battlefield cache, token grouping, normalizeViewForEmit, logStateDebug.
export {
  optimizeBattlefieldTokensForEmit,
  normalizeViewForEmit,
  logStateDebug,
} from "./gameStateEmitNormalize.js";

// Player display name lookup.
export { getPlayerName } from "./getPlayerName.js";

// ensureGame / ensureGameAsync create-or-replay.
export { ensureGame, ensureGameAsync } from "./ensureGame.js";
export type { EnsureGameOptions } from "./ensureGame.js";

// Normalized state snapshot to one socket.
export { emitStateToSocket } from "./emitStateToSocket.js";

// Per-participant state broadcast body (parent supplies auto-pass / resume deps).
export { runBroadcastGame } from "./broadcastGame.js";
export type { BroadcastGameDeps } from "./broadcastGame.js";

// AI reaction delay, kynaios cleanup, elimination, checkAndTriggerAI.
export {
  checkAndTriggerAI,
  checkAndEmitKynaiosChoicePrompts,
  checkAndEmitPlayerElimination,
} from "./checkAndTriggerAI.js";

// appendGameEvent and persist-first stack resolve.
export { appendGameEvent, persistAndResolveTopOfStack } from "./appendGameEvent.js";

// Priority timer clear / schedule / doAutoPass body.
export { clearPriorityTimer, runSchedulePriorityTimeout } from "./priorityTimeoutAutoPass.js";
export type { PriorityTimeoutAutoPassDeps } from "./priorityTimeoutAutoPass.js";

// Library search restriction metadata and parseSearchFilter (private to the leaf).
export { checkLibrarySearchRestrictions } from "./librarySearchHelpers.js";
