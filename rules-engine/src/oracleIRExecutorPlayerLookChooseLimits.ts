// Extracted from oracleIRExecutorPlayerStepHandlers.ts.
// Cluster: parseLookChooseSelectionLimits, buildLookChooseLibrarySearchFilter.
// Public entries: parseLookChooseSelectionLimits, buildLookChooseLibrarySearchFilter.

import {
  normalizeLookChooseSelectorText,
  splitLookChooseSelectorTerms,
} from './oracleIRExecutorPlayerLookChooseSelector';
import { parseSimpleCardTypeFromText } from './oracleIRExecutorZoneOps';

export function parseLookChooseSelectionLimits(
  selectorText: string,
  optional?: boolean
): { readonly minSelections: number; readonly maxSelections: number } {
  const normalized = normalizeLookChooseSelectorText(selectorText).toLowerCase();

  if (/\band\/or\b/i.test(normalized)) {
    const parts = normalized.split(/\s+and\/or\s+/i).map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return { minSelections: optional ? 0 : 1, maxSelections: parts.length };
    }
  }

  const wordToNum = (word: string): number => {
    const map: Record<string, number> = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
    };
    const lower = String(word || '').trim().toLowerCase();
    if (map[lower]) return map[lower];
    const parsed = Number.parseInt(lower, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  };

  const upToMatch = normalized.match(/^up to (one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i);
  if (upToMatch) {
    const maxSelections = wordToNum(upToMatch[1]);
    return { minSelections: optional ? 0 : 0, maxSelections };
  }

  return { minSelections: optional ? 0 : 1, maxSelections: 1 };
}

export function buildLookChooseLibrarySearchFilter(
  selectorText: string
): { readonly types?: readonly string[]; readonly subtypes?: readonly string[] } {
  const terms = splitLookChooseSelectorTerms(normalizeLookChooseSelectorText(selectorText));
  const types: string[] = [];
  const subtypes: string[] = [];

  for (const term of terms) {
    if (/^non-?/i.test(term)) continue;
    const parsedType = parseSimpleCardTypeFromText(term);
    if (parsedType) {
      if (!types.includes(parsedType)) types.push(parsedType);
      continue;
    }
    if (term && !subtypes.includes(term)) subtypes.push(term);
  }

  return {
    ...(types.length > 0 ? { types } : {}),
    ...(subtypes.length > 0 ? { subtypes } : {}),
  };
}
