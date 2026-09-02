/**
 * Origin: oracleIRExecutorZoneOps.ts
 * Cluster: cardMatchesMoveZoneSingleTargetCriteria and exile-selector matching,
 * plus the qualifier/name helpers they closed over.
 * Public entry symbols: cardMatchesMoveZoneSingleTargetCriteria, cardMatchesExileSelectorText,
 * stripPutIntoGraveyardThisTurnQualifier, graveyardThisTurnCriteriaFromQualifier.
 */
import { cardHasCreatureType, isValidCreatureType } from '../../shared/src/creatureTypes';
import { getCardManaValue } from './oracleIRExecutorPlayerUtils';
import {
  cardHasAllColors,
  cardHasAnyColors,
  cardHasNoAbilities,
  cardMatchesHistoric,
  cardMatchesType,
  cardRepresentsPermanent,
  cardTypeLineIncludesTerm,
  collectCardColors,
  getCardOracleText,
  getCardPower,
  parseSimpleCardTypeFromText,
  toTitleCaseWords,
} from './oracleIRExecutorZoneOpsCardTypeMatchers';
import type { MoveZoneSingleTargetCriteria } from './oracleIRExecutorZoneOpsSingleTargetCriteria';
import { cardHasAdventureCharacteristics } from './oracleIRExecutorZoneOpsThisWayParsers';
import {
  cardHasAwakenAbility,
  cardHasCyclingAbility,
  cardHasFlashbackAbility,
  cardHasForetellAbility,
  cardHasKickerAbility,
} from './oracleIRExecutorZoneOpsKeywordAbilityPredicates';

export function stripPutIntoGraveyardThisTurnQualifier(raw: string): {
  readonly selectorText: string;
  readonly putIntoGraveyardThisTurn: boolean;
  readonly putIntoGraveyardFromLibraryThisTurn: boolean;
} {
  const cleaned = String(raw || '').replace(/[.\s]+$/g, '').trim();
  const fromLibrary = cleaned
    .replace(
      /\s+that\s+(?:was|were)\s+put\s+there\s+from\s+(?:their|a|your|its owner(?:'s|’s)?)\s+library\s+this\s+turn$/i,
      '',
    )
    .trim();
  if (fromLibrary !== cleaned) {
    return {
      selectorText: fromLibrary,
      putIntoGraveyardThisTurn: true,
      putIntoGraveyardFromLibraryThisTurn: true,
    };
  }
  const selectorText = cleaned
    .replace(/\s+that\s+(?:was|were)\s+put\s+there(?:\s+from\s+(?:anywhere|the\s+battlefield))?\s+this\s+turn$/i, '')
    .trim();
  return {
    selectorText,
    putIntoGraveyardThisTurn: selectorText !== cleaned,
    putIntoGraveyardFromLibraryThisTurn: false,
  };
}

export function graveyardThisTurnCriteriaFromQualifier(withTurn: {
  readonly putIntoGraveyardThisTurn: boolean;
  readonly putIntoGraveyardFromLibraryThisTurn?: boolean;
}): {
  readonly putIntoGraveyardThisTurn?: true;
  readonly putIntoGraveyardFromLibraryThisTurn?: true;
} {
  return {
    ...(withTurn.putIntoGraveyardThisTurn ? { putIntoGraveyardThisTurn: true as const } : {}),
    ...(withTurn.putIntoGraveyardFromLibraryThisTurn ? { putIntoGraveyardFromLibraryThisTurn: true as const } : {}),
  };
}

export function normalizeCardNameForCriteria(value: string | undefined): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/[.\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function cardMatchesMoveZoneSingleTargetCriteria(
  card: any,
  criteria: MoveZoneSingleTargetCriteria,
  referenceCardName?: string,
  currentTurn?: number,
  referencePower?: number,
  referenceManaValue?: number
): boolean {
  if (!cardMatchesType(card, criteria.cardType)) return false;
  if (criteria.requiresHistoric && !cardMatchesHistoric(card)) return false;

  if (criteria.requiresAdventure && !cardHasAdventureCharacteristics(card)) return false;

  if (criteria.creatureTypesAnyOf && criteria.creatureTypesAnyOf.length > 0) {
    const typeLine = String(card?.type_line || card?.card?.type_line || '');
    const oracleText = getCardOracleText(card);
    if (!criteria.creatureTypesAnyOf.some(creatureType => cardHasCreatureType(typeLine, oracleText, creatureType))) {
      return false;
    }
  }

  if (criteria.typeLineTermsAnyOf && criteria.typeLineTermsAnyOf.length > 0) {
    if (!criteria.typeLineTermsAnyOf.some(term => cardTypeLineIncludesTerm(card, term))) {
      return false;
    }
  }

  if (criteria.typeLineTermsNoneOf && criteria.typeLineTermsNoneOf.length > 0) {
    if (criteria.typeLineTermsNoneOf.some(term => cardTypeLineIncludesTerm(card, term))) {
      return false;
    }
  }

  if (criteria.colorsAllOf && criteria.colorsAllOf.length > 0) {
    if (!cardHasAllColors(card, criteria.colorsAllOf)) return false;
  }

  if (criteria.colorsAnyOf && criteria.colorsAnyOf.length > 0) {
    if (!cardHasAnyColors(card, criteria.colorsAnyOf)) return false;
  }

  if (criteria.powerLte !== undefined) {
    const power = getCardPower(card);
    if (power === null || power > criteria.powerLte) return false;
  }

  if (criteria.powerGte !== undefined) {
    const power = getCardPower(card);
    if (power === null || power < criteria.powerGte) return false;
  }

  if (criteria.noAbilities && !cardHasNoAbilities(card)) return false;

  if (criteria.requiredCounter) {
    const counterCount = Number((card?.counters || (card?.card as any)?.counters || {})?.[criteria.requiredCounter] ?? 0);
    if (!Number.isFinite(counterCount) || counterCount <= 0) return false;
  }

  if (criteria.manaValueLte !== undefined) {
    const manaValue = getCardManaValue(card);
    if (manaValue === null || manaValue > criteria.manaValueLte) return false;
  }

  if (criteria.manaValueGte !== undefined) {
    const manaValue = getCardManaValue(card);
    if (manaValue === null || manaValue < criteria.manaValueGte) return false;
  }

  if (criteria.isColorless && collectCardColors(card).length > 0) return false;

  if (criteria.multicoloredOnly && collectCardColors(card).length < 2) return false;

  if (criteria.manaValueParity) {
    const manaValue = getCardManaValue(card);
    if (manaValue === null) return false;
    const isEven = manaValue % 2 === 0;
    if (criteria.manaValueParity === 'even' && !isEven) return false;
    if (criteria.manaValueParity === 'odd' && isEven) return false;
  }

  if (criteria.manaValueAnyOf && criteria.manaValueAnyOf.length > 0) {
    const manaValue = getCardManaValue(card);
    if (manaValue === null || !criteria.manaValueAnyOf.includes(manaValue)) return false;
  }

  if (criteria.manaValueLtReferencePower) {
    const manaValue = getCardManaValue(card);
    if (
      manaValue === null ||
      !Number.isFinite(referencePower) ||
      manaValue >= Number(referencePower)
    ) {
      return false;
    }
  }

  if (criteria.powerLtReference) {
    const power = getCardPower(card);
    if (
      power === null ||
      !Number.isFinite(referencePower) ||
      power >= Number(referencePower)
    ) {
      return false;
    }
  }

  if (criteria.manaValueLteReferenceManaValue) {
    const manaValue = getCardManaValue(card);
    if (
      manaValue === null ||
      !Number.isFinite(referenceManaValue) ||
      manaValue > Number(referenceManaValue)
    ) {
      return false;
    }
  }

  if (criteria.manaValueLtReferenceManaValue) {
    const manaValue = getCardManaValue(card);
    if (
      manaValue === null ||
      !Number.isFinite(referenceManaValue) ||
      manaValue >= Number(referenceManaValue)
    ) {
      return false;
    }
  }

  if (criteria.manaValueLteReferencePower) {
    const manaValue = getCardManaValue(card);
    if (
      manaValue === null ||
      !Number.isFinite(referencePower) ||
      manaValue > Number(referencePower)
    ) {
      return false;
    }
  }

  if (criteria.milledThisTurn) {
    const milledTurn = Number((card as any)?.milledTurn);
    if (!Number.isFinite(milledTurn) || !Number.isFinite(currentTurn) || milledTurn !== currentTurn) {
      return false;
    }
  }

  if (criteria.hasXManaCost) {
    const manaCost = String(card?.mana_cost || card?.manaCost || card?.card?.mana_cost || card?.card?.manaCost || '');
    if (!/\{x\}/i.test(manaCost)) return false;
  }

  if (criteria.notNamed) {
    const excludedName = normalizeCardNameForCriteria(
      /^this permanent$/i.test(criteria.notNamed) ? referenceCardName : criteria.notNamed
    );
    const cardName = normalizeCardNameForCriteria(String(card?.name || ''));
    if (excludedName && cardName && excludedName === cardName) return false;
  }

  if (criteria.requiredNamed) {
    const requiredName = normalizeCardNameForCriteria(
      /^this permanent$/i.test(criteria.requiredNamed) ? referenceCardName : criteria.requiredNamed
    );
    const cardName = normalizeCardNameForCriteria(String(card?.name || ''));
    if (!requiredName || !cardName || requiredName !== cardName) return false;
  }

  if (criteria.putIntoGraveyardFromLibraryThisTurn) {
    const fromLibrary = String((card as any)?.putIntoGraveyardFrom || '').toLowerCase() === 'library';
    const milledTurn = Number((card as any)?.milledTurn);
    const putIntoGraveyardTurn = Number((card as any)?.putIntoGraveyardTurn);
    const milledThisTurn = Number.isFinite(milledTurn) && Number.isFinite(currentTurn) && milledTurn === currentTurn;
    const gyThisTurn =
      Number.isFinite(putIntoGraveyardTurn) && Number.isFinite(currentTurn) && putIntoGraveyardTurn === currentTurn;
    if (!(fromLibrary && gyThisTurn) && !milledThisTurn) {
      return false;
    }
  } else if (criteria.putIntoGraveyardThisTurn) {
    const putIntoGraveyardTurn = Number((card as any)?.putIntoGraveyardTurn);
    if (!Number.isFinite(putIntoGraveyardTurn) || !Number.isFinite(currentTurn) || putIntoGraveyardTurn !== currentTurn) {
      return false;
    }
  }

  if (criteria.excludePutIntoGraveyardThisTurn) {
    const putIntoGraveyardTurn = Number((card as any)?.putIntoGraveyardTurn);
    if (Number.isFinite(putIntoGraveyardTurn) && Number.isFinite(currentTurn) && putIntoGraveyardTurn === currentTurn) {
      return false;
    }
  }

  if (criteria.requiresCyclingAbility && !cardHasCyclingAbility(card)) return false;

  if (criteria.requiresKickerAbility && !cardHasKickerAbility(card)) return false;

  if (criteria.requiresForetell && !cardHasForetellAbility(card)) return false;

  if (criteria.requiresFlashback && !cardHasFlashbackAbility(card)) return false;

  if (criteria.requiresAwaken && !cardHasAwakenAbility(card)) return false;

  if (criteria.requiresNonbattle) {
    const typeLine = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
    if (typeLine.includes('battle') || !cardRepresentsPermanent(card)) return false;
  }

  return true;
}

export function parseTrailingZoneCounterRequirement(
  raw: string,
  zonePattern: string
): { readonly selectorText: string; readonly requiredCounter?: string } {
  const cleaned = String(raw || '').replace(/[.\s]+$/g, '').trim();
  const match = cleaned.match(
    new RegExp(`^(.*?\\b${zonePattern}\\b)(?:\\s+with\\s+(?:a|an|\\d+|x|[a-z]+)\\s+(.+?)\\s+counters?\\s+on\\s+it)?$`, 'i')
  );
  if (!match) {
    return { selectorText: cleaned };
  }

  return {
    selectorText: String(match[1] || '').trim(),
    ...(match[2] ? { requiredCounter: String(match[2] || '').trim().toLowerCase() } : {}),
  };
}

function normalizeExileSelectorText(value: string): string {
  return String(value || '')
    .replace(/\u2019/g, "'")
    .toLowerCase()
    .replace(/[.\s]+$/g, '')
    .replace(/\s+from\s+among\s+(?:the\s+)?cards?(?:\s+you\s+own)?\s+exiled\s+with\s+this\s+(?:creature|artifact|enchantment|planeswalker|permanent|card|class|saga)$/i, '')
    .replace(/^(?:an?|the)\s+/i, '')
    .replace(/\s+(?:cards?|spells?)$/i, '')
    .trim();
}

export function cardMatchesExileSelectorText(card: any, selectorText: string): boolean {
  const normalized = normalizeExileSelectorText(selectorText);
  if (!normalized || normalized === 'card') return true;

  const creatureTypeAndCreatureMatch = normalized.match(/^([a-z][a-z' -]+)\s+creature$/i);
  if (creatureTypeAndCreatureMatch) {
    const creatureType = toTitleCaseWords(String(creatureTypeAndCreatureMatch[1] || '').trim());
    const typeLine = String(card?.type_line || card?.card?.type_line || '');
    const oracleText = getCardOracleText(card);
    return cardMatchesType(card, 'creature') && isValidCreatureType(creatureType) && cardHasCreatureType(typeLine, oracleText, creatureType);
  }

  const simpleType = parseSimpleCardTypeFromText(normalized);
  if (simpleType) return cardMatchesType(card, simpleType);

  const creatureType = toTitleCaseWords(normalized);
  if (isValidCreatureType(creatureType)) {
    const typeLine = String(card?.type_line || card?.card?.type_line || '');
    const oracleText = getCardOracleText(card);
    return cardHasCreatureType(typeLine, oracleText, creatureType);
  }

  return false;
}

export function stripFaceDownSuffix(text: string): string {
  return String(text || '')
    .replace(/\s+face\s+down$/i, '')
    .trim();
}
