// server/src/state/modules/triggerReflexiveWhenYouDoQueueUtils-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// server/src/state/modules/triggerReflexiveWhenYouDoQueueUtils.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays
// server/src/state/modules/triggerReflexiveWhenYouDoQueueUtils.ts.
// Leaves must not import triggerReflexiveWhenYouDoQueueUtils.ts or this index.

// Queue CR 603.12 "you may pay any amount of mana. If you do" reflexive choice.
export { maybeQueueReflexiveAnyAmountManaPayment } from "./maybeQueueReflexiveAnyAmountManaPayment.js";
