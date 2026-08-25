// rules-engine/src/AIEngine-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// rules-engine/src/AIEngine.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays rules-engine/src/AIEngine.ts.
// Never create AIEngine/ beside AIEngine.ts.
// Leaves must not import AIEngine.ts or this index.

// Library planning categories and tutor-target priority (AIEngine.analyzeLibraryForPlanning).
export { analyzeLibraryForPlanning, type AIEngineHost } from './aiEngineAnalyzeLibraryForPlanning';
