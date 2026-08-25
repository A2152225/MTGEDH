// server/src/socket/util-handlers/parseManaCost.ts
// Origin parent: server/src/socket/util.ts
// Cluster moved: parseManaCost - string cost to colors/generic/hybrid/X with
//   cloned hybrid option arrays.
// Public entry symbols: parseManaCost.
// Re-exported from util.ts so the "./util.js" import path keeps working.

import { parseManaCost as parseManaFromString } from "../../state/modules/mana-check.js";

/**
 * Parses a string mana cost into its individual components (color distribution, generic mana, etc.).
 * Handles Phyrexian mana symbols like {W/P} (can be paid with W or 2 life)
 */
export function parseManaCost(
  manaCost?: string
): {
  colors: Record<string, number>;
  generic: number;
  hybrid: Array<Array<string>>;
  hybrids: Array<Array<string>>;
  hasX: boolean;
} {
  const parsed = parseManaFromString(manaCost);
  const hybrids = Array.isArray((parsed as any).hybrids)
    ? (parsed as any).hybrids.map((entry: string[]) => [...entry])
    : Array.isArray(parsed.hybrid)
      ? parsed.hybrid.map((entry) => [...entry])
      : [];
  return {
    colors: { ...parsed.colors },
    generic: parsed.generic,
    hybrid: hybrids,
    hybrids,
    hasX: parsed.hasX,
  };
}
