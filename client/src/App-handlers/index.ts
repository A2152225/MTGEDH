// client/src/App-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of client/src/App.tsx.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays client/src/App.tsx.
// Never create App/ beside App.tsx.
// Leaves must not import App.tsx or this index.

// Auto-pass / auto-advance priority handlers and exclusive state.
export { useAppAutoPassHandlers } from './appAutoPassHandlers';
export type { AppAutoPassHandlerDeps } from './appAutoPassHandlers';

// Resolution-prompt minimize/restore/nudge helpers and exclusive prompt state.
export { useAppResolutionPromptHelpers } from './appResolutionPromptHelpers';

// Dismiss callback that clears resolution-prompt modal state.
export { useAppDismissResolutionStepUi } from './appDismissResolutionStepUi';

// Resolution-step prompt branch handlers (early / late).
export { handleAppResolutionStepPromptEarly } from './appResolutionStepPromptEarly';
export { handleAppResolutionStepPromptLate } from './appResolutionStepPromptLate';

// Leftover resolutionStepPrompt useEffect (preamble + queue listeners).
export { useAppResolutionStepPromptEffects } from './appResolutionStepPromptEffects';

// Cast / combat / resolution modal confirm handlers.
export { useAppPlayModalHandlers } from './appPlayModalHandlers';

// Split-card / zone / join-forces handlers plus combat memos.
export { useAppPlayCombatHandlers } from './appPlayCombatHandlers';

// Leftover derived effects, memos, and random-deck picker.
export { useAppPlayDerivedEffects } from './appPlayDerivedEffects';

// Early play modal / combat state.
export { useAppPlayStateEarly } from './appPlayStateEarly';

// Late play resolution-modal state plus viewport/prompt helpers.
export { useAppPlayStateLate } from './appPlayStateLate';

// Loop-shortcut recording, replay, consent, and exclusive refs.
export { useAppLoopShortcutHandlers } from './appLoopShortcutHandlers';
export type { AppLoopShortcutHandlerDeps } from './appLoopShortcutHandlers';

// Combat / priority / undo / AI socket listener effects.
export { useAppPlaySocketEffects } from './appPlaySocketEffects';
export type { AppPlaySocketEffectDeps } from './appPlaySocketEffects';

// Phase navigator, commander, peek, and early resolution-prompt overlays.
export { renderAppPlayOverlaysEarly } from './appPlayOverlaysEarly';

// Main play column (join / header / table).
export { renderAppPlayLayoutMain } from './appPlayLayoutMain';

// Utility rail and mobile dock.
export { renderAppPlayLayoutRail } from './appPlayLayoutRail';

// Join-forces through may-auto overlays.
export { renderAppPlayOverlaysLate } from './appPlayOverlaysLate';

// Mana-distribution through exile overlays.
export { renderAppPlayOverlaysMid } from './appPlayOverlaysMid';

// Triggered-ability through phyrexian-mana overlays.
export { renderAppPlayOverlaysChoice } from './appPlayOverlaysChoice';

// Name-in-use through game-over overlays.
export { renderAppPlayOverlaysCombat } from './appPlayOverlaysCombat';

// Leftover play shell (layout + overlay render calls).
export { renderAppPlayShell } from './appPlayShell';

// Leftover loop-shortcut / create-game / undo / socket-effect wiring.
export { useAppPlayLeftoverHandlers } from './appPlayLeftoverHandlers';

// Leftover dismiss / prompt-effects / derived / modal / combat wiring.
export { useAppPlayRuntime } from './appPlayRuntime';
