// rules-engine/src/triggeredAbilitiesEventDetection-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// rules-engine/src/triggeredAbilitiesEventDetection.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays rules-engine/src/triggeredAbilitiesEventDetection.ts.
// Never create triggeredAbilitiesEventDetection/ beside the .ts.
// Leaves must not import triggeredAbilitiesEventDetection.ts or this index.

// Early spell-countered / beginning-of-main / first-spell / spell-cast if-chain.
export { tryParseTriggeredAbilityEventEarlyFamilies } from './triggeredAbilitiesEventDetectionEarlyFamilies.js';
