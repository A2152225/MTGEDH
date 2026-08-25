// client/src/utils/loopShortcuts-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// client/src/utils/loopShortcuts.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays client/src/utils/loopShortcuts.ts.
// Never create loopShortcuts/ beside loopShortcuts.ts.
// Leaves must not import loopShortcuts.ts or this index.

// Types, storage keys, and iteration clamp used by replay/record helpers.
export {
  LOOP_SHORTCUT_DRAFTS_STORAGE_KEY,
  LOOP_SHORTCUT_MAX_ITERATIONS,
  LOOP_SHORTCUT_MAX_SUSTAINED_ITERATIONS,
  LOOP_SHORTCUT_SAVED_STORAGE_KEY,
  LITERAL_PRIMITIVE_STEP_TYPES,
  MANA_COLOR_NAME_RE,
  PAYMENT_OBJECT_KNOWN_KEYS,
  clampLoopShortcutIterations,
} from './loopShortcutsTypes';
export type {
  JsonValue,
  LoopShortcutDraft,
  LoopShortcutIdTemplate,
  LoopShortcutPaymentItemTemplate,
  LoopShortcutPromptFingerprint,
  LoopShortcutPromptTemplate,
  LoopShortcutSequenceItem,
  LoopShortcutTargetMatchProfile,
  RankedTarget,
  SavedLoopShortcut,
  StorageLike,
} from './loopShortcutsTypes';

// Shared normalize/clone helpers.
export { clonePayload, normalizeText } from './loopShortcutsTextUtils';

// Battlefield target-match primitives and candidate scoring.
export {
  buildTargetMatchProfile,
  getBattlefieldPermanent,
  isCommanderPermanent,
  isControlledBy,
  isExplicitNonTokenPermanent,
  isTokenPermanent,
  scoreCandidateAgainstProfile,
  typeLineOverlapScore,
} from './loopShortcutsTargetMatchUtils';

// Prompt-valid battlefield target ids.
export { getPromptValidTargetIds } from './loopShortcutsPromptValidTargets';

// Dynamic target id selection payload for replay.
export { buildIdSelectionsPayload } from './loopShortcutsIdSelectionsPayload';

// Rebind recorded payment permanents onto the live battlefield.
export { rebindPaymentPermanentId, rebindProfileIds } from './loopShortcutsPaymentRebind';

// Replay a recorded resolution-prompt template against the current step/view.
export { buildResolutionResponsePayload } from './loopShortcutsResolutionResponsePayload';
