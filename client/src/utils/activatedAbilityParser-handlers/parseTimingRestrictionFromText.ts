/**
 * Origin parent: client/src/utils/activatedAbilityParser.ts
 *
 * Cluster moved: parseTimingRestrictionFromText.
 *
 * Public entry symbols: parseTimingRestrictionFromText.
 */

import type { ParsedActivatedAbility } from './activatedAbilityParserTypes';

/**
 * Parse timing restriction phrases from ability/oracle text.
 * Prefer ability-local text so one restricted ability does not poison siblings.
 */
export function parseTimingRestrictionFromText(
  text: string,
): ParsedActivatedAbility['timingRestriction'] | undefined {
  const src = String(text || '');
  if (/activate\s+(?:this\s+ability\s+|these\s+abilities\s+)?only\s+during\s+(?:an?\s+)?opponent'?s?\s+upkeep/i.test(src)
    || /activate\s+(?:this\s+ability\s+|these\s+abilities\s+)?only\s+during\s+your\s+upkeep/i.test(src)
    || /activate\s+(?:this\s+ability\s+|these\s+abilities\s+)?only\s+during\s+(?:the\s+)?upkeep/i.test(src)) {
    return 'upkeep';
  }
  if (/activate\s+(?:this\s+ability\s+|these\s+abilities\s+)?only\s+during\s+your\s+turn/i.test(src)) {
    return 'your_turn';
  }
  if (/activate\s+(?:this\s+ability\s+)?(?:only\s+)?(?:as\s+a\s+)?sorcery/i.test(src)
    || /(?:activate|use)\s+(?:this\s+ability\s+|these\s+abilities\s+)?only\s+(?:as\s+a\s+sorcery|any\s+time\s+you\s+could\s+cast\s+a\s+sorcery)/i.test(src)) {
    return 'sorcery';
  }
  // Class level-ups ("{W}: Level 2") are sorcery speed (rule 716.2a: "Gain the next level as a sorcery").
  if (/^\s*level\s+\d+\s*\.?\s*$/i.test(src) || /^\s*(?:\{[^}]+\}\s*,?\s*)+:\s*level\s+\d+\s*\.?\s*$/im.test(src)) {
    return 'sorcery';
  }
  return undefined;
}
