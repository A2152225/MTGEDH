// rules-engine/src/CardAnalyzer-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// rules-engine/src/CardAnalyzer.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays rules-engine/src/CardAnalyzer.ts.
// Never create CardAnalyzer/ beside CardAnalyzer.ts.
// Leaves must not import CardAnalyzer.ts or this index.

// Card-effect regex table used by categorization, threat, and synergy scoring.
export { PATTERNS } from './cardAnalyzerPatterns';

// Known death-trigger payoffs (Veteran Explorer, Sakura-Tribe Elder, etc.).
export { BENEFICIAL_DEATH_CARDS } from './cardAnalyzerBeneficialDeathCards';

// Named combo-piece partners (Blood Artist, Isochron + Reversal, etc.).
export { KNOWN_COMBOS } from './cardAnalyzerKnownCombos';

// Public analyzer enums and result interfaces (re-exported from CardAnalyzer.ts).
export {
  CardCategory,
  ThreatLevel,
  SynergyArchetype,
} from './cardAnalyzerTypes';
export type {
  CardAnalysis,
  CardEffectDetails,
  BattlefieldAnalysis,
  DeckArchetypeProfile,
} from './cardAnalyzerTypes';

// Deck archetype profile (CardAnalyzer.analyzeDeck implementation).
export { analyzeDeck, type CardAnalyzerHost } from './cardAnalyzerAnalyzeDeck';
