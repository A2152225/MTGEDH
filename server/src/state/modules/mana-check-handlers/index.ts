// server/src/state/modules/mana-check-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// server/src/state/modules/mana-check.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays server/src/state/modules/mana-check.ts.
// Leaves must not import mana-check.ts or this index.

// Metalcraft / threshold-style activation gate for optimistic mana.
export { canCountPermanentManaAbilities } from "./manaCheckActivationGate.js";

// Phyrexian life cost plus parsed / normalized mana payment types.
export { PHYREXIAN_LIFE_COST, type ParsedManaCost, type NormalizedManaPaymentModel } from "./manaCheckPaymentTypes.js";

// Keep parenthetical mana abilities when stripping reminder text.
export { stripReminderTextFromOracle } from "./manaCheckOracleText.js";

// Empty/state pool getters, simple-pool keys, exact-source types, pool arithmetic.
export {
  getEmptyManaPool,
  getManaPoolFromState,
  SIMPLE_MANA_KEYS,
  type SimpleManaKey,
  type ExactManaSourceOption,
  type ExactManaSource,
  type ExactSacrificeCandidate,
  type ExactHandCandidate,
  type ExactCandidateRemovalResult,
  createSimpleManaPool,
  manaSymbolToColorKey,
  addProducedMana,
  createSingleColorProduction,
  applyScalingManaToOptimisticPool,
} from "./manaCheckSimplePool.js";

// Self-remove-counter activation costs and permanent counter budgets.
export {
  normalizeManaCheckCounterType,
  parseSelfRemoveCounterCost,
  getPermanentCounterAmountForManaCheck,
} from "./manaCheckRemoveCounterCost.js";

// Drop no-cost {T} matches that sit inside a costed mana ability.
export { filterOutCostedTapMatches } from "./manaCheckCostedTapFilter.js";

// Opponent / controlled permanent colors for conditional mana sources.
export { getOpponentPermanentColors, getControlledPermanentColors } from "./manaCheckPermanentColors.js";

// Optimistic floating + untapped-source available mana.
export { getAvailableMana } from "./manaCheckAvailableMana.js";

// Intrinsic basic-land mana (Urborg / Yavimaya include themselves).
export { buildIntrinsicBasicLandExactOptions } from "./manaCheckIntrinsicBasicLandMana.js";

// Parse / normalize / stringify mana-cost strings.
export { parseManaCost, normalizeParsedManaCost, stringifyParsedManaCost } from "./manaCheckParseManaCost.js";

// Creature-count / devotion / power-instead exact mana options.
export { buildScalingManaExactOptions } from "./manaCheckScalingExactOptions.js";

// Hand / life / return-to-hand mana-ability cost parsers.
export {
  parsedManaCostHasValue,
  parseLifeCostFromManaAbilityCost,
  matchesHandCostTypeLine,
  parseHandCostFromManaAbilityCost,
  parseReturnToHandCostFromManaAbilityCost,
} from "./manaCheckAbilityCostParsers.js";

// Non-tap / battery / spend / produced-mana / exact mana sources.
export {
  EXACT_MANA_SEARCH_NODE_BUDGET,
  normalizePoolSignature,
  buildExactSacrificeCandidates,
  buildExactHandCandidates,
  type ExactManaSpendPurpose,
  type ExactManaPaymentOptions,
  exactManaSpendRestrictionAllowsPurpose,
  removeSacrificeCandidates,
  removeHandCandidates,
  removeReturnToHandCandidates,
  spendManaCostFromExactPool,
  buildExactManaSources,
} from "./manaCheckExactSources.js";

// Pool total, can-pay, and max X from a concrete mana pool.
export { getTotalManaFromPool, canPayManaCost, getMaxXValue } from "./manaCheckCanPayManaCost.js";

// Exact floating + untapped-source payment search.
export { canPayManaCostWithAvailableSources, getPlayerLifeTotal } from "./manaCheckCanPayWithSources.js";
