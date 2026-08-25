// Origin parent: server/src/state/modules/graveyard-permissions.ts
// Cluster moved: shared card/text helpers used by graveyard permission matching.
// Public entry symbols: normalizeText, escapeRegExp, parseSmallNumber, isPlayersTurn,
//   getTypeLine, isInstantOrSorcery, isLesson, getManaCost, getCardManaValue,
//   getGenericManaValueCost, getCardId, getCurrentTurn, sanitizePermissionIdPart.
// Leaf must not import graveyard-permissions.ts or graveyard-permissions-handlers/index.ts.

import type { PlayerID } from "../../../../../shared/src/index.js";
import { cardManaValue } from "../../utils.js";

export function normalizeText(value: unknown): string {
  return String(value || '').toLowerCase().replace(/[\u2018\u2019]/g, "'");
}

export function escapeRegExp(value: string): string {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function parseSmallNumber(value: string): number {
  const normalized = normalizeText(value);
  const wordValues: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  if (wordValues[normalized]) return wordValues[normalized];
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isPlayersTurn(state: any, playerId: PlayerID): boolean {
  return String(state?.turnPlayer || state?.activePlayer || '') === String(playerId || '');
}

export function getTypeLine(card: any): string {
  return normalizeText(card?.type_line || card?.typeLine);
}

export function isInstantOrSorcery(card: any): boolean {
  const typeLine = getTypeLine(card);
  return /\binstant\b/.test(typeLine) || /\bsorcery\b/.test(typeLine);
}

export function isLesson(card: any): boolean {
  return /\blesson\b/.test(getTypeLine(card));
}

export function getManaCost(card: any): string {
  return String(card?.mana_cost || card?.manaCost || '').trim();
}

export function getCardManaValue(card: any): number | undefined {
  const directValue = [card?.cmc, card?.mana_value, card?.manaValue, card?.convertedManaCost]
    .map((value) => Number(value))
    .find((value) => Number.isFinite(value) && value >= 0);
  if (typeof directValue === 'number') {
    return Math.max(0, Math.floor(directValue));
  }

  const derivedValue = cardManaValue(card);
  return Number.isFinite(derivedValue) && derivedValue >= 0
    ? Math.max(0, Math.floor(derivedValue))
    : undefined;
}

export function getGenericManaValueCost(card: any): string | undefined {
  const manaValue = getCardManaValue(card);
  return typeof manaValue === 'number' ? `{${manaValue}}` : undefined;
}

export function getCardId(card: any): string {
  return String(card?.id || '').trim();
}

export function getCurrentTurn(state: any): number {
  return Number(state?.turnNumber ?? state?.turn ?? 0) || 0;
}

export function sanitizePermissionIdPart(value: unknown): string {
  return normalizeText(value)
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}
