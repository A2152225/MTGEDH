// client/src/components/DeckManagerModal-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// client/src/components/DeckManagerModal.tsx.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays client/src/components/DeckManagerModal.tsx.
// Never create DeckManagerModal/ beside DeckManagerModal.tsx.
// Leaves must not import DeckManagerModal.tsx or this index.

// Nested precon/random import handlers plus initial-action effect.
export { useDeckManagerModalRandomImportHandlers } from './deckManagerModalRandomImportHandlers';
export type { DeckManagerModalRandomImportHandlerDeps } from './deckManagerModalRandomImportHandlers';

// Nested local/server save, import, rename, delete, and cache handlers.
export { createDeckManagerModalSaveCacheHandlers } from './deckManagerModalSaveCacheHandlers';
export type {
  SavedLocalDeck,
  DeckManagerModalTab,
  DeckManagerModalSaveCacheHandlerDeps,
} from './deckManagerModalSaveCacheHandlers';
