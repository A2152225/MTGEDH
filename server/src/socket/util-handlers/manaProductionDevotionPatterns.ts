// server/src/socket/util-handlers/manaProductionDevotionPatterns.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: pre-compiled devotion color symbol matchers used by
//   calculateManaProduction dynamic devotion abilities.
// Public entry symbols: DEVOTION_COLOR_PATTERNS.

// ============================================================================
// Pre-compiled RegExp patterns for mana color matching in devotion calculations
// Optimization: Created once at module load instead of inside loops
// ============================================================================
export const DEVOTION_COLOR_PATTERNS: Record<string, RegExp> = {
  W: /\{W\}/gi,
  U: /\{U\}/gi,
  B: /\{B\}/gi,
  R: /\{R\}/gi,
  G: /\{G\}/gi,
};
