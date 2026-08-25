// Origin parent: server/src/state/modules/mana-check.ts
// Cluster moved: parseManaCost, normalizeParsedManaCost, stringifyParsedManaCost.
// Public entry symbols: parseManaCost, normalizeParsedManaCost, stringifyParsedManaCost.
// Leaf must not import mana-check.ts or mana-check-handlers/index.ts.

import {
  PHYREXIAN_LIFE_COST,
  type ParsedManaCost,
} from "./manaCheckPaymentTypes.js";

/**
 * Parse mana cost from a string into components
 */
export function parseManaCost(manaCost?: string): ParsedManaCost {
  const hybridCosts: Array<string[]> = [];
  const result = {
    colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 },
    generic: 0,
    hasX: false,
    hybrid: hybridCosts,
    hybrids: hybridCosts,
  };

  if (!manaCost) return result;

  const tokens = manaCost.match(/\{[^}]+\}/g) || [];
  for (const token of tokens) {
    const clean = token.replace(/[{}]/g, "").toUpperCase();
    if (clean === "X") {
      result.hasX = true;
    } else if (/^\d+$/.test(clean)) {
      result.generic += parseInt(clean, 10);
    } else if (clean.length === 1 && clean in result.colors) {
      // Single color symbol: {W}, {U}, {B}, {R}, {G}, {C}
      result.colors[clean as keyof typeof result.colors] = 
        (result.colors[clean as keyof typeof result.colors] || 0) + 1;
    } else if (clean.includes("/")) {
      // Hybrid mana: {W/U}, {B/R}, {2/W}, etc.
      const parts = clean.split("/");
      
      // Handle phyrexian mana {W/P} or colored phyrexian {B/P}
      if (parts[1] === "P") {
        // Phyrexian mana can be paid with the color OR 2 life
        // Track as hybrid with special LIFE payment option
        const firstColor = parts[0];
        if (firstColor.length === 1 && firstColor in result.colors) {
          // Add both options: the color OR pay life (Rule 107.4f)
          result.hybrid.push([firstColor, `LIFE:${PHYREXIAN_LIFE_COST}`]);
        }
      } else if (/^\d+$/.test(parts[0])) {
        // Hybrid generic/color: {2/W}, {3/U}, etc.
        // Can be paid with either N generic OR 1 colored mana
        // Track as hybrid with generic option: ['GENERIC:N', 'COLOR']
        result.hybrid.push([`GENERIC:${parts[0]}`, parts[1]]);
      } else {
        // Regular hybrid: {W/U}, {B/R}, etc.
        // Can be paid with either color
        result.hybrid.push(parts);
      }
    }
  }

  return result;
}

export function normalizeParsedManaCost(parsedCost?: Partial<ParsedManaCost> & { hybrid?: Array<string[]>; hybrids?: Array<string[]> }): ParsedManaCost {
  const hybridCosts = (Array.isArray(parsedCost?.hybrid)
    ? parsedCost?.hybrid
    : Array.isArray(parsedCost?.hybrids)
      ? parsedCost?.hybrids
      : [])
    .filter((entry): entry is string[] => Array.isArray(entry))
    .map((entry) => entry.map((option) => String(option || '').toUpperCase()).filter(Boolean));

  return {
    colors: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, ...(parsedCost?.colors || {}) },
    generic: Math.max(0, Math.floor(Number(parsedCost?.generic || 0))),
    hasX: Boolean(parsedCost?.hasX),
    hybrid: hybridCosts,
    hybrids: hybridCosts,
  };
}

export function stringifyParsedManaCost(parsedCost?: Partial<ParsedManaCost> & { hybrid?: Array<string[]>; hybrids?: Array<string[]> }): string {
  const normalized = normalizeParsedManaCost(parsedCost);
  let manaCost = '';

  if (normalized.hasX) {
    manaCost += '{X}';
  }

  if (normalized.generic > 0) {
    manaCost += `{${normalized.generic}}`;
  }

  for (const color of ['W', 'U', 'B', 'R', 'G', 'C']) {
    const count = Math.max(0, Math.floor(Number(normalized.colors[color] || 0)));
    for (let index = 0; index < count; index++) {
      manaCost += `{${color}}`;
    }
  }

  for (const hybrid of normalized.hybrid) {
    if (hybrid.length > 0) {
      manaCost += `{${hybrid.join('/')}}`;
    }
  }

  return manaCost || '{0}';
}
