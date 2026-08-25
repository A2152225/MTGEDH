// Origin parent: server/src/state/modules/mana-check.ts
// Cluster moved: hand / life / return-to-hand mana-ability cost parsers.
// Public entry symbols: parsedManaCostHasValue, parseLifeCostFromManaAbilityCost,
// matchesHandCostTypeLine, parseHandCostFromManaAbilityCost,
// parseReturnToHandCostFromManaAbilityCost.
// Leaf must not import mana-check.ts or mana-check-handlers/index.ts.

import { parseNumberFromText } from "../../../../../shared/src/textUtils.js";
import type { ParsedManaCost } from "./manaCheckPaymentTypes.js";
import type { ExactManaSourceOption } from "./manaCheckSimplePool.js";

export function parsedManaCostHasValue(parsedCost?: ParsedManaCost): boolean {
  if (!parsedCost) return false;

  return (
    Number(parsedCost.generic || 0) > 0 ||
    Object.values(parsedCost.colors || {}).some((value) => Number(value || 0) > 0) ||
    (Array.isArray(parsedCost.hybrid) && parsedCost.hybrid.length > 0) ||
    parsedCost.hasX === true
  );
}

export function parseLifeCostFromManaAbilityCost(costText: string): number {
  const matches = [...String(costText || '').matchAll(/pay\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+life/gi)];
  return matches.reduce(
    (sum, match) => sum + parseNumberFromText(String(match?.[1] || '0'), 0),
    0,
  );
}

export function matchesHandCostTypeLine(typeLineValue: string, typeRestriction?: string): boolean {
  if (!typeRestriction) {
    return true;
  }

  const typeLine = String(typeLineValue || '').toLowerCase();
  switch (String(typeRestriction || '').toLowerCase()) {
    case 'creature':
    case 'artifact':
    case 'enchantment':
    case 'land':
    case 'instant':
    case 'sorcery':
    case 'planeswalker':
      return typeLine.includes(String(typeRestriction || '').toLowerCase());
    case 'nonland':
      return !typeLine.includes('land');
    case 'noncreature':
      return !typeLine.includes('creature');
    default:
      return false;
  }
}

export function parseHandCostFromManaAbilityCost(
  costText: string,
): NonNullable<ExactManaSourceOption['handCost']> | null {
  const normalizedCost = String(costText || '').trim();
  if (!normalizedCost) {
    return null;
  }

  const discardTypedMatch = normalizedCost.match(
    /\bdiscard\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(creature|artifact|enchantment|land|instant|sorcery|planeswalker|nonland|noncreature)\s+cards?\b/i,
  );
  const discardMatch = normalizedCost.match(
    /\bdiscard\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?\b/i,
  );
  if (discardTypedMatch || discardMatch) {
    const rawCount = String((discardTypedMatch?.[1] || discardMatch?.[1]) || '').trim();
    const count = parseNumberFromText(rawCount, 1);
    if (!Number.isFinite(count) || count <= 0) {
      return null;
    }

    const typeRestriction = discardTypedMatch
      ? String(discardTypedMatch[2] || '').trim().toLowerCase()
      : undefined;

    return {
      count,
      destination: 'graveyard',
      ...(typeRestriction ? { typeRestriction } : {}),
    };
  }

  const exileMatch = normalizedCost.match(
    /\bexile\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:(creature|artifact|enchantment|land|instant|sorcery|planeswalker|nonland|noncreature)\s+)?cards?\s+from\s+your\s+hand\b/i,
  );
  if (!exileMatch) {
    return null;
  }

  const rawCount = String(exileMatch[1] || '').trim();
  const count = parseNumberFromText(rawCount, 1);
  if (!Number.isFinite(count) || count <= 0) {
    return null;
  }

  const typeRestriction = exileMatch[2]
    ? String(exileMatch[2] || '').trim().toLowerCase()
    : undefined;

  return {
    count,
    destination: 'exile',
    ...(typeRestriction ? { typeRestriction } : {}),
  };
}

export function parseReturnToHandCostFromManaAbilityCost(
  costText: string,
): NonNullable<ExactManaSourceOption['returnToHandCost']> | null {
  const normalizedCost = String(costText || '').trim();
  if (!normalizedCost) {
    return null;
  }

  const returnMatch = normalizedCost.match(
    /\breturn\s+(?:(another|other)\s+(creature|artifact|enchantment|land|permanent|nonland\s+permanent)|(a|an|one|1)\s+(creature|artifact|enchantment|land|permanent|nonland\s+permanent))\s+you\s+control\s+to\s+its\s+owner(?:'|’)s\s+hand\b/i,
  );
  if (!returnMatch) {
    return null;
  }

  const type = String(returnMatch[2] || returnMatch[4] || '').trim().toLowerCase();
  if (!type) {
    return null;
  }

  return {
    type,
    ...(returnMatch[1] ? { mustBeOther: true } : {}),
  };
}
