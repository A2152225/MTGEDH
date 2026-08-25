// Extracted from oracleIRExecutorPlayerStepHandlers.ts.
// Cluster: look-choose selector matching (normalize/split/term/mana-limit/cardMatches).
// Public entries: normalizeLookChooseSelectorText, splitLookChooseSelectorTerms,
// resolveLookChooseManaValueLimit, cardMatchesLookChooseSelector.

import type { GameState, PlayerID } from '../../shared/src';
import {
  getCardManaValue,
  getCardTypeLineLower,
} from './oracleIRExecutorPlayerUtils';
import {
  cardMatchesMoveZoneSingleTargetCriteria,
  parseMoveZoneSingleTargetCriteria,
  parseSimpleCardTypeFromText,
} from './oracleIRExecutorZoneOps';

export function normalizeLookChooseSelectorText(value: string): string {
  return String(value || '')
    .replace(/^an?\s+/i, '')
    .replace(/\s+card$/i, '')
    .trim();
}

export function splitLookChooseSelectorTerms(value: string): string[] {
  const normalized = normalizeLookChooseSelectorText(value)
    .replace(/\s+and\/or\s+/gi, ',')
    .replace(/\s*,\s*or\s+/gi, ',')
    .replace(/\s+or\s+/gi, ',')
    .replace(/\s*,\s*/g, ',')
    .trim();
  if (!normalized) return [];
  return normalized
    .split(',')
    .map(part => part.trim().toLowerCase())
    .filter(Boolean);
}

function cardMatchesLookChooseTerm(card: any, term: string): boolean {
  const normalizedTerm = String(term || '').trim().toLowerCase();
  if (!normalizedTerm) return false;

  const parsedType = parseSimpleCardTypeFromText(normalizedTerm);
  if (parsedType) {
    return cardMatchesMoveZoneSingleTargetCriteria(card, { cardType: parsedType }, undefined, 0);
  }

  const typeLine = getCardTypeLineLower(card);
  const name = String(card?.name || card?.card?.name || '').trim().toLowerCase();
  return typeLine.includes(normalizedTerm) || name.includes(normalizedTerm);
}

export function resolveLookChooseManaValueLimit(
  state: GameState,
  playerId: PlayerID,
  selectorText: string,
): number | null {
  const normalizedSelector = normalizeLookChooseSelectorText(selectorText)
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalizedSelector) return null;

  if (/with mana value less than or equal to the number of lands you control/i.test(normalizedSelector)) {
    const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
    return battlefield.filter((permanent: any) => {
      if (!permanent || String(permanent.controller || '') !== playerId) return false;
      return String(permanent.card?.type_line || '').toLowerCase().includes('land');
    }).length;
  }

  const manaValueMatch = normalizedSelector.match(/^(.+?)\s+with\s+mana\s+value\s+(\d+)\s+or\s+less$/i);
  if (!manaValueMatch) return null;
  const parsed = Number.parseInt(String(manaValueMatch[2] || ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function cardMatchesLookChooseSelector(
  card: any,
  selectorText: string,
  manaValueLimitOverride?: number | null,
  chosenCreatureType?: string,
): boolean {
  const normalizedSelector = normalizeLookChooseSelectorText(selectorText)
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalizedSelector) return false;
  if (/^(?:(?:one|any) of )?those(?: cards?)?$|^cards?$/i.test(normalizedSelector)) return true;

  const structuredCriteria = parseMoveZoneSingleTargetCriteria(normalizedSelector);
  if (structuredCriteria?.usesChosenCreatureType) {
    const chosenType = String(chosenCreatureType || '').trim();
    if (!chosenType) return false;
    return cardMatchesMoveZoneSingleTargetCriteria(card, {
      ...structuredCriteria,
      creatureTypesAnyOf: [chosenType],
    });
  }

  const manaValueMatch = normalizedSelector.match(/^(.+?)\s+with\s+mana\s+value\s+(\d+)\s+or\s+less$/i);
  const selectorWithoutManaLimit = manaValueMatch
    ? String(manaValueMatch[1] || '').trim()
    : normalizedSelector.replace(/\s+with\s+mana\s+value\s+less than or equal to the number of lands you control$/i, '').trim();
  const manaValueLimit = manaValueLimitOverride !== undefined
    ? manaValueLimitOverride
    : (manaValueMatch ? Number.parseInt(String(manaValueMatch[2] || ''), 10) : null);
  if (manaValueLimit !== null && (!Number.isFinite(manaValueLimit) || Number(getCardManaValue(card) ?? 0) > manaValueLimit)) {
    return false;
  }

  const terms = splitLookChooseSelectorTerms(selectorWithoutManaLimit);
  if (terms.length === 0) return false;

  const negativeTerms = terms
    .map(term => {
      const match = term.match(/^non-?(.+)$/i);
      return match ? String(match[1] || '').trim().toLowerCase() : null;
    })
    .filter((term): term is string => Boolean(term));
  const positiveTerms = terms.filter(term => !/^non-?/i.test(term));

  if (negativeTerms.some(term => cardMatchesLookChooseTerm(card, term))) {
    return false;
  }

  if (positiveTerms.length === 0) {
    return true;
  }

  return positiveTerms.some(term => cardMatchesLookChooseTerm(card, term));
}

