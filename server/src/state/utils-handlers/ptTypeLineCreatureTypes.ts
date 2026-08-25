// server/src/state/utils-handlers/ptTypeLineCreatureTypes.ts
// Origin parent: server/src/state/utils.ts
// Cluster moved: extractCreatureTypes (type-line subtype split).
// Public entry symbols: extractCreatureTypes.
// Used by attached P/T bonus parse helpers. Not re-exported from utils.ts
// (was file-private).

/**
 * Extract creature types from a type line
 * e.g., "Legendary Creature — Human Soldier" -> ["Human", "Soldier"]
 */
export function extractCreatureTypes(typeLine: string): string[] {
  if (!typeLine) return [];
  const dashIndex = typeLine.indexOf('—');
  if (dashIndex === -1) return [];
  const subtypes = typeLine.substring(dashIndex + 1).trim();
  return subtypes.split(/\s+/).filter(t => t.length > 0);
}
