// client/src/components/CreateGameModal-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// client/src/components/CreateGameModal.tsx.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays client/src/components/CreateGameModal.tsx.
// Never create CreateGameModal/ beside CreateGameModal.tsx.
// Leaves must not import CreateGameModal.tsx or this index.

// Nested AI opponents section (presets, deck select/import, save-as-preset).
export { CreateGameModalAiOpponentsSection } from './createGameModalAiOpponentsSection';
export type {
  CreateGameModalAiOpponentDraft,
  CreateGameModalAiOpponentsSectionProps,
  CreateGameModalSavedDeckSummary,
} from './createGameModalAiOpponentsSection';
