/**
 * Origin: oracleIRExecutorPlayerStepHandlers.ts (getSearchLibraryMatches).
 * Cluster: library-search type matching for cards still in the library.
 * Entries: withLibrarySearchFrontFace, parseBasicLandLibrarySearchCriteria,
 * cardIsBasicLandForLibrarySearch, parseLandTypeLibrarySearchCriteria,
 * cardIsLandTypeForLibrarySearch, resolvePlayerLibraryCardsForSearch.
 *
 * CR 709.2 / 711.1c: a double-faced card in a zone other than the battlefield or
 * stack has only its front-face characteristics. Combined `type_line` strings
 * (`Enchantment // Land`) must not make the back face searchable.
 */
import { getLibrarySearchTypeLine } from '../../shared/src/cardFactory.js';
import { normalizeOracleText } from './oracleIRExecutorPlayerUtils.js';

export function librarySearchTypeLineForMatching(card: any): string {
  return normalizeOracleText(getLibrarySearchTypeLine(card));
}

export function withLibrarySearchFrontFace(card: any): any {
  if (!card || typeof card !== 'object') return card;
  const frontType = getLibrarySearchTypeLine(card);
  if (!frontType || frontType === card.type_line) return card;
  return { ...card, type_line: frontType };
}

/**
 * "up to two basic land cards", "a basic Forest", etc.
 * Excludes nonbasic searches and "basic land type" (domain / choose-a-type).
 */
export function parseBasicLandLibrarySearchCriteria(
  normalizedText: string,
): { requiredBasicType: string } | null {
  const text = String(normalizedText || '').trim();
  if (!text) return null;
  if (/\bnonbasic\b/.test(text)) return null;
  if (/\bbasic land types?\b/.test(text)) return null;

  const typed = text.match(
    /^(?:up to |any number of )?(?:a |an |one |two |three |four |five |six |seven |eight |nine |ten |\d+ )?basic ([a-z]+)(?: cards?)?$/i,
  );
  if (typed) {
    const word = String(typed[1] || '').trim().toLowerCase();
    if (!word || word === 'land') return { requiredBasicType: '' };
    return { requiredBasicType: word };
  }
  return null;
}

export function cardIsBasicLandForLibrarySearch(card: any, requiredBasicType = ''): boolean {
  const typeLine = librarySearchTypeLineForMatching(card);
  if (!/\bbasic\b/.test(typeLine) || !/\bland\b/.test(typeLine)) return false;
  if (!requiredBasicType) return true;
  return typeLine.includes(requiredBasicType);
}

/**
 * "Forest cards", "up to two Island cards" — subtype search, not the phrase
 * "forest cards" inside the type line.
 */
export function parseLandTypeLibrarySearchCriteria(
  normalizedText: string,
): { landType: string } | null {
  const text = String(normalizedText || '').trim();
  if (!text) return null;
  if (/\bbasic\b/.test(text)) return null;
  const match = text.match(
    /(?:^|\b)(?:up to |any number of )?(?:a |an |one |two |three |four |five |six |seven |eight |nine |ten |\d+ )?(plains|island|swamp|mountain|forest|wastes)(?: cards?)?\b/i,
  );
  if (!match) return null;
  return { landType: String(match[1] || '').trim().toLowerCase() };
}

export function cardIsLandTypeForLibrarySearch(card: any, landType: string): boolean {
  const type = String(landType || '').trim().toLowerCase();
  if (!type) return false;
  return librarySearchTypeLineForMatching(card).includes(type);
}

export function resolvePlayerLibraryCardsForSearch(state: any, playerId: string, player?: any): any[] {
  if (Array.isArray(player?.library) && player.library.length > 0) return player.library;
  const zoneLib = state?.zones?.[playerId]?.library;
  if (Array.isArray(zoneLib) && zoneLib.length > 0) return zoneLib;
  const serverLib = state?.__serverLibraries?.get?.(playerId);
  if (Array.isArray(serverLib) && serverLib.length > 0) return serverLib;
  if (Array.isArray(player?.library)) return player.library;
  if (Array.isArray(zoneLib)) return zoneLib;
  return [];
}
