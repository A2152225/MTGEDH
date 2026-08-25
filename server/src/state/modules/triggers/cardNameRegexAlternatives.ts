/**
 * Origin: server/src/state/modules/triggered-abilities.ts
 * Cluster: card-name regex alternatives used by leftover detectors
 * Public: buildCardNameRegexAlternatives
 */

import { escapeCardNameForRegex } from "./types.js";
import { normalizeCardNameForOracleText } from "../../utils.js";

export function buildCardNameRegexAlternatives(cardName: string): string[] {
  const names = new Set<string>();
  const add = (value: string) => {
    const trimmed = String(value || '').trim();
    if (trimmed) names.add(escapeCardNameForRegex(trimmed));
  };
  add(cardName);
  add(normalizeCardNameForOracleText(cardName));
  if (/^the\s+/i.test(cardName)) {
    add(`the ${cardName}`);
  }
  const slashParts = String(cardName).split(/\s*\/\/\s*/);
  if (slashParts.length > 1) {
    add(slashParts.map((part) => String(part).split(',')[0].trim()).join('//'));
  }
  for (const part of slashParts) {
    add(part);
    add(String(part.split(',')[0] || '').trim());
    const ofHead = String(part).match(/^(.+?)\s+of\s+/i);
    if (ofHead) add(ofHead[1].trim());
    const theTitleHead = String(part).match(/^(.+?)\s+the\s+/i);
    if (theTitleHead) add(theTitleHead[1].trim());
    const thePrefix = String(part).match(/^the\s+(.+)$/i);
    if (thePrefix) {
      add(thePrefix[1].trim());
      add(`the ${thePrefix[1].trim()}`);
    }
    if (/^a-/i.test(part)) add(String(part).replace(/^a-/i, '').trim());
    const hyphenShort = String(part).match(/^([\w]+-[\w]+)/);
    if (hyphenShort) add(hyphenShort[1].trim());
    const words = String(part).trim().split(/\s+/);
    if (words.length > 1 && !/^the$/i.test(words[0])) {
      add(words[0]);
    }
    if (words.length > 2) {
      add(words[words.length - 1]);
    }
  }
  return Array.from(names);
}
