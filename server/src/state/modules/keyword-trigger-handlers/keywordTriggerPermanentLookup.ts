/**
 * keyword-trigger-handlers/keywordTriggerPermanentLookup.ts
 * Origin parent: server/src/state/modules/keyword-handlers.ts
 * Cluster moved: permanentHasKeyword, getPermanentKeywords.
 * Public entry symbols: permanentHasKeyword, getPermanentKeywords.
 */

import { detectKeywords } from "../keyword-detection.js";
import type { DetectedKeyword } from "../keyword-detection.js";

/**
 * Check if a permanent has a specific keyword
 */
export function permanentHasKeyword(permanent: any, keyword: string): boolean {
  const oracleText = permanent?.card?.oracle_text || '';
  const detected = detectKeywords(oracleText, permanent?.card?.name || '');
  return detected.keywords.some(k => k.keyword === keyword);
}

/**
 * Get all keywords for a permanent
 */
export function getPermanentKeywords(permanent: any): DetectedKeyword[] {
  const oracleText = permanent?.card?.oracle_text || '';
  const detected = detectKeywords(oracleText, permanent?.card?.name || '');
  return detected.keywords;
}
