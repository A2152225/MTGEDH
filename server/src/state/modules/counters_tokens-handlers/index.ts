// server/src/state/modules/counters_tokens-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// server/src/state/modules/counters_tokens.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays server/src/state/modules/counters_tokens.ts.
// Leaves must not import counters_tokens.ts or this index.

// Death-trigger stack metadata inference and push onto the stack.
export { pushDeathTriggerOntoStack } from "./countersTokensDeathTriggerStack.js";

// Keyword dies-trigger detection and merge for graveyard death emission.
export {
  getKeywordDeathTriggersForPermanent,
  mergeDeathTriggers,
} from "./countersTokensDeathTriggerKeywords.js";

// Battlefield-to-graveyard move, including death-trigger emission.
export { movePermanentToGraveyard } from "./countersTokensMoveToGraveyard.js";

// Battlefield-to-exile move, including commander-zone choice and linked exile.
export { movePermanentToExile } from "./countersTokensMoveToExile.js";

// State-based actions and legend-rule controller choice.
export { resolveLegendRuleChoice, runSBA } from "./countersTokensStateBasedActions.js";

// Token creation and copy-token creation.
export { createToken, createCopyTokensOfCard } from "./countersTokensCreateToken.js";
export type { CreateTokenOptions } from "./countersTokensCreateToken.js";
