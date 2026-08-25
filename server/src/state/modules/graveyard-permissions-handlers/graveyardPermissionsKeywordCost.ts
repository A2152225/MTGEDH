// Origin parent: server/src/state/modules/graveyard-permissions.ts
// Cluster moved: extractGrantedKeywordCost, extractAdditionalEscapeExileCount,
//   extractEscapeEntryCounterCount.
// Public entry symbols: extractGrantedKeywordCost, extractAdditionalEscapeExileCount,
//   extractEscapeEntryCounterCount.
// Leaf must not import graveyard-permissions.ts or graveyard-permissions-handlers/index.ts.

import type { GraveyardGrantKeyword } from "./graveyardPermissionsTypes.js";
import {
  escapeRegExp,
  getGenericManaValueCost,
  getManaCost,
  parseSmallNumber,
} from "./graveyardPermissionsCardUtils.js";

export function extractGrantedKeywordCost(keyword: GraveyardGrantKeyword, remainder: string, fullOracleText: string, card: any): string | undefined {
  const explicitCost = String(remainder || '').match(/(\{[^}]+\}(?:\s*\{[^}]+\})*)/);
  if (explicitCost?.[1]) {
    return explicitCost[1].trim();
  }

  const keywordCostPattern = escapeRegExp(keyword);
  const sourceExplicitCost = String(fullOracleText || '').match(new RegExp(`${keywordCostPattern} cost (?:is|equals?)\\s*((?:\\{[^}]+\\}\\s*)+)`, 'i'));
  if (sourceExplicitCost?.[1]) {
    return sourceExplicitCost[1].trim();
  }

  if (keyword === 'jump-start' || keyword === 'retrace') {
    const manaCost = getManaCost(card);
    return manaCost || undefined;
  }

  const costSubjectPattern = `(?:that card's|its|the card's|this card's|that spell's|this spell's)`;
  if (new RegExp(`${keywordCostPattern} cost is equal to ${costSubjectPattern} mana cost`, 'i').test(fullOracleText)) {
    const manaCost = getManaCost(card);
    return manaCost || undefined;
  }

  if (new RegExp(`${keywordCostPattern} cost is equal to ${costSubjectPattern} mana value`, 'i').test(fullOracleText)) {
    return getGenericManaValueCost(card);
  }

  return undefined;
}

export function extractAdditionalEscapeExileCount(fullOracleText: string): number | undefined {
  const exileMatch = String(fullOracleText || '').match(/exil(?:e|ing)\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+other\s+cards?\s+from\s+your\s+graveyard/i);
  if (!exileMatch?.[1]) return undefined;
  const count = parseSmallNumber(exileMatch[1]);
  return count > 0 ? count : undefined;
}

export function extractEscapeEntryCounterCount(fullOracleText: string): number | undefined {
  const counterMatch = String(fullOracleText || '').match(/escapes?\s+with\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+\+1\/\+1\s+counters?\s+on\s+it/i);
  if (!counterMatch?.[1]) return undefined;
  const count = parseSmallNumber(counterMatch[1]);
  return count > 0 ? count : undefined;
}
