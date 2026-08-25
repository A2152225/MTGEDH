// server/src/state/modules/triggerEtbEntryEffects-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// server/src/state/modules/triggerEtbEntryEffects.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays server/src/state/modules/triggerEtbEntryEffects.ts.
// Leaves must not import triggerEtbEntryEffects.ts or this index.

// Persist a pushed ETB/triggered-ability stack item to the event log.
export { persistTriggeredAbilityPush } from "./triggerEtbPersistTriggeredAbility.js";

// Typed-permanent ETB match predicates and stack-item construction.
export {
  isNamedOrAnotherTypedEtbTrigger,
  isTypedPermanentEtbTrigger,
  matchesRequiredTypePhrase,
  resolveEnteringCreatureDiscoverXValue,
  shouldQueueChosenTypeCreatureEtbTrigger,
  shouldQueueNamedOrAnotherTypedEtbTrigger,
  shouldQueueTypedPermanentEtbTrigger,
  tryBuildTypedPermanentEtbStackItem,
  TYPED_PERMANENT_ETB_REQUIRED_TYPE,
} from "./triggerEtbTypedPermanentMatch.js";

// Creatures/artifacts/enchantments entered-this-turn counters for intervening-if.
export { recordBattlefieldEntryTurnTracking } from "./triggerEtbBattlefieldEntryTracking.js";

// Temporary (this-turn) ETB triggers granted by resolved spells.
export {
  addTemporaryEtbTrigger,
  clearTemporaryEtbTriggers,
  queueTemporaryEtbTriggersForEntry,
} from "./triggerEtbTemporaryEntryTriggers.js";

// Token battlefield-entry ETB effects (self + other permanents' "when a token enters").
export { triggerETBEffectsForToken } from "./triggerEtbTokenEntryEffects.js";

// Self-ETB triggers when a permanent enters the battlefield.
export { queueSelfETBTriggersForPermanent } from "./triggerEtbQueueSelfTriggers.js";
