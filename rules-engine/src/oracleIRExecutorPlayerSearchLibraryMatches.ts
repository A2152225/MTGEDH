// Extracted from oracleIRExecutorPlayerStepHandlers.ts.
// Cluster: findCardByIdAcrossState, getSearchLibraryMatches,
// resolveSearchLibraryMaxResults, isOptionalSearchLibraryStep.
// Public entries: getSearchLibraryMatches, resolveSearchLibraryMaxResults,
// isOptionalSearchLibraryStep.

import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import { evaluateModifyPtWhereX } from './oracleIRExecutorModifyPtWhereEvaluator';
import {
  getCardManaValue,
  normalizeOracleText,
} from './oracleIRExecutorPlayerUtils';
import {
  cardIsBasicLandForLibrarySearch,
  cardIsLandTypeForLibrarySearch,
  parseBasicLandLibrarySearchCriteria,
  parseLandTypeLibrarySearchCriteria,
  withLibrarySearchFrontFace,
} from './oracleIRExecutorLibrarySearchCardUtils';
import {
  cardMatchesMoveZoneSingleTargetCriteria,
  parseMoveZoneSingleTargetCriteria,
} from './oracleIRExecutorZoneOps';

export function findCardByIdAcrossState(state: GameState, sourceId: string): any | null {
  const normalizedSourceId = String(sourceId || '').trim();
  if (!normalizedSourceId) return null;

  for (const permanent of Array.isArray(state.battlefield) ? state.battlefield : []) {
    if (String((permanent as any)?.id || '').trim() === normalizedSourceId) {
      return (permanent as any)?.card || permanent;
    }
    if (String((permanent as any)?.card?.id || '').trim() === normalizedSourceId) {
      return (permanent as any)?.card || permanent;
    }
  }

  for (const player of state.players as any[]) {
    for (const zoneName of ['hand', 'graveyard', 'library', 'exile']) {
      const zone = Array.isArray(player?.[zoneName]) ? player[zoneName] : [];
      const found = zone.find((card: any) => String(card?.id || card?.cardId || '').trim() === normalizedSourceId);
      if (found) return found;
    }
  }

  return null;
}

export function getSearchLibraryMatches(
  library: readonly any[],
  step: Extract<OracleEffectStep, { kind: 'search_library' }>,
  state: GameState,
  ctx: OracleIRExecutionContext
): any[] | null {
  const cards = Array.isArray(library) ? library.map(withLibrarySearchFrontFace) : [];

  if (step.criteria.kind === 'same_mana_value_as_source') {
    const criteria = step.criteria;
    const sourceCard = findCardByIdAcrossState(state, String(ctx.sourceId || '').trim());
    const sourceManaValue = getCardManaValue(sourceCard);
    if (sourceManaValue === null) return null;
    return cards.filter(card => {
      if (getCardManaValue(card) !== sourceManaValue) return false;
      if (criteria.requiredCardType === 'creature') {
        return /\bcreature\b/i.test(String(card?.type_line || ''));
      }
      return true;
    });
  }

  const criteria = step.criteria;
  if (criteria.kind === 'mana_value') {
    return cards.filter(card => getCardManaValue(card) === criteria.value);
  }

  const normalizedText = normalizeOracleText(criteria.text);
  if (!normalizedText || normalizedText === 'card' || normalizedText === 'cards') return cards;

  const basicLandSearch = parseBasicLandLibrarySearchCriteria(normalizedText);
  if (basicLandSearch) {
    return cards.filter((card) => cardIsBasicLandForLibrarySearch(card, basicLandSearch.requiredBasicType));
  }

  const landTypeSearch = parseLandTypeLibrarySearchCriteria(normalizedText);
  if (landTypeSearch) {
    return cards.filter((card) => cardIsLandTypeForLibrarySearch(card, landTypeSearch.landType));
  }

  const structuredCriteria = parseMoveZoneSingleTargetCriteria(normalizedText);
  if (structuredCriteria) {
    let resolvedCriteria = structuredCriteria;
    if (resolvedCriteria.manaValueLte === -1) {
      const x = Math.max(0, Number(ctx.xValue ?? ctx.referenceAmount ?? 0));
      resolvedCriteria = { ...resolvedCriteria, manaValueLte: x };
    }
    if (resolvedCriteria.usesChosenCreatureType) {
      const chosenType = String(ctx.selectorContext?.chosenCreatureType || '').trim();
      if (chosenType) {
        resolvedCriteria = { ...resolvedCriteria, creatureTypesAnyOf: [chosenType] };
      }
    }
    return cards.filter((card) => cardMatchesMoveZoneSingleTargetCriteria(card, resolvedCriteria));
  }

  const sameManaValueMatch = normalizedText.match(/^((?:[a-z' -]+?)\s+)?card with the same mana value as this(?: card)?$/i);
  if (sameManaValueMatch) {
    const sourceCard = findCardByIdAcrossState(state, String(ctx.sourceId || '').trim());
    const sourceManaValue = getCardManaValue(sourceCard);
    if (sourceManaValue === null) return null;

    const requiredCardType = String(sameManaValueMatch[1] || '').trim().toLowerCase();
    return cards.filter(card => {
      if (getCardManaValue(card) !== sourceManaValue) return false;
      if (!requiredCardType) return true;
      return normalizeOracleText(String(card?.type_line || '')).includes(requiredCardType);
    });
  }

  const basicLandCriteria = normalizedText.match(/^basic ([a-z]+)(?:\s+cards?)?$/i);
  if (basicLandCriteria || normalizedText === 'basic land card' || normalizedText === 'basic land') {
    const requiredBasicType = basicLandCriteria ? String(basicLandCriteria[1] || '').trim().toLowerCase() : '';
    return cards.filter((card) => {
      const typeLine = normalizeOracleText(String(card?.type_line || ''));
      if (!/\bbasic\b.*\bland\b/i.test(typeLine)) return false;
      if (!requiredBasicType) return true;
      return typeLine.includes(requiredBasicType);
    });
  }

  return cards.filter(card => {
    const typeLine = normalizeOracleText(String(card?.type_line || ''));
    const name = normalizeOracleText(String(card?.name || ''));
    return typeLine.includes(normalizedText) || name === normalizedText;
  });
}

export function resolveSearchLibraryMaxResults(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'search_library' }>,
  ctx: OracleIRExecutionContext,
): number {
  if (step.maxResults === 'any_number') {
    return Number.MAX_SAFE_INTEGER;
  }
  if (typeof step.maxResults === 'number' && Number.isFinite(step.maxResults) && step.maxResults > 0) {
    return step.maxResults;
  }

  const whereRaw = String(step.whereX?.raw || '').trim();
  if (whereRaw) {
    const evaluated = evaluateModifyPtWhereX(
      state,
      ctx.controllerId,
      `X is ${whereRaw}`,
      undefined,
      ctx,
    );
    if (evaluated !== null) return Math.max(0, evaluated);
  }

  const raw = String(step.raw || '');
  const whereMatch = raw.match(/where x is (.+?)(?:,\s*put\b|,\s*reveal\b|\s*$)/i);
  if (whereMatch) {
    const evaluated = evaluateModifyPtWhereX(
      state,
      ctx.controllerId,
      `X is ${String(whereMatch[1] || '').trim()}`,
      undefined,
      ctx,
    );
    if (evaluated !== null) return Math.max(0, evaluated);
  }

  return 1;
}

export function isOptionalSearchLibraryStep(step: Extract<OracleEffectStep, { kind: 'search_library' }>): boolean {
  if ((step as { optional?: boolean }).optional === true) return true;
  return /\bup to\b/i.test(String(step.raw || ''));
}

