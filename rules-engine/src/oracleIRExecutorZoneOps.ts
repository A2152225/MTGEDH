import type { BattlefieldPermanent, GameState, PlayerID } from '../../shared/src';
import { cardHasCreatureType, isValidCreatureType } from '../../shared/src/creatureTypes';
import { mergeRetainedCountersForBattlefieldEntry } from '../../shared/src/zoneRetainedCounters';
import {
  getCardManaValue,
  getCurrentTurnNumber,
  isCardExiledWithSource,
  stampCardPutIntoGraveyardThisTurn,
  stampCardsPutIntoGraveyardThisTurn,
} from './oracleIRExecutorPlayerUtils';
import { getExecutorTypeLineLower, hasExecutorClass } from './oracleIRExecutorPermanentUtils';
import { clearPlayableFromExileForCards, stripPlayableFromExileTags } from './playableFromExile';

export type SimpleCardType =
  | 'any'
  | 'permanent'
  | 'creature'
  | 'artifact'
  | 'enchantment'
  | 'land'
  | 'instant'
  | 'sorcery'
  | 'planeswalker'
  | 'saga'
  | 'aura'
  | 'nonland'
  | 'instant_or_sorcery'
  | 'artifact_or_creature'
  | 'artifact_or_enchantment'
  | 'creature_or_land'
  | 'creature_or_planeswalker'
  | 'artifact_instant_or_sorcery'
  | 'creature_instant_or_sorcery'
  | 'non_dragon_creature'
  | 'legendary_creature'
  | 'legendary_permanent'
  | 'nonlegendary_permanent';

export type MoveZoneSingleTargetCriteria = {
  readonly cardType: SimpleCardType;
  readonly manaValueLte?: number;
  readonly notNamed?: string;
  readonly requiresHistoric?: boolean;
  readonly creatureTypesAnyOf?: readonly string[];
  readonly typeLineTermsAnyOf?: readonly string[];
  readonly typeLineTermsNoneOf?: readonly string[];
  readonly colorsAllOf?: readonly string[];
  readonly noAbilities?: boolean;
  readonly requiredCounter?: string;
  readonly putIntoGraveyardThisTurn?: boolean;
};

type BattlefieldAttachmentTarget = BattlefieldPermanent;

type BattlefieldEntryCardOverrides = {
  readonly setTypeLine?: string;
  readonly setOracleText?: string;
  readonly loseAllAbilities?: boolean;
};

const stripImpulsePermissionMarkers = stripPlayableFromExileTags;
const COLOR_WORD_TO_SYMBOL: Record<string, string> = {
  white: 'W',
  blue: 'U',
  black: 'B',
  red: 'R',
  green: 'G',
};

function normalizeCardColor(value: string | undefined): string | null {
  const lower = String(value || '').trim().toLowerCase();
  if (!lower) return null;
  if (lower === 'w' || lower === 'white') return 'W';
  if (lower === 'u' || lower === 'blue') return 'U';
  if (lower === 'b' || lower === 'black') return 'B';
  if (lower === 'r' || lower === 'red') return 'R';
  if (lower === 'g' || lower === 'green') return 'G';
  return null;
}

function cardRepresentsPermanent(card: any): boolean {
  const typeLine = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
  return (
    typeLine.includes('artifact') ||
    typeLine.includes('battle') ||
    typeLine.includes('creature') ||
    typeLine.includes('enchantment') ||
    typeLine.includes('land') ||
    typeLine.includes('planeswalker')
  );
}

function getCardOracleText(card: any): string {
  return String(card?.oracle_text || card?.oracleText || card?.text || card?.card?.oracle_text || card?.card?.oracleText || '').trim();
}

function collectCardColors(card: any): readonly string[] {
  const collected: string[] = [];

  for (const source of [card?.colors, card?.color_identity, card?.card?.colors, card?.card?.color_identity]) {
    if (!Array.isArray(source)) continue;
    for (const entry of source) {
      const normalized = normalizeCardColor(String(entry || ''));
      if (normalized && !collected.includes(normalized)) collected.push(normalized);
    }
  }

  const manaCost = String(card?.mana_cost || card?.manaCost || card?.card?.mana_cost || card?.card?.manaCost || '');
  for (const [word, symbol] of Object.entries(COLOR_WORD_TO_SYMBOL)) {
    if (manaCost.includes(`{${symbol}}`) && !collected.includes(symbol)) {
      collected.push(symbol);
    }
    if (manaCost.toLowerCase().includes(`{${word[0]}}`) && !collected.includes(symbol)) {
      collected.push(symbol);
    }
  }

  return collected;
}

function cardHasAllColors(card: any, requiredColors: readonly string[]): boolean {
  const colors = collectCardColors(card);
  return requiredColors.every(color => colors.includes(color));
}

function cardHasNoAbilities(card: any): boolean {
  const oracleText = getCardOracleText(card);
  if (oracleText) return false;

  for (const keywords of [card?.keywords, card?.card?.keywords, card?.abilities, card?.card?.abilities]) {
    if (Array.isArray(keywords) && keywords.length > 0) {
      return false;
    }
  }

  return true;
}

function cardMatchesHistoric(card: any): boolean {
  const typeLine = getExecutorTypeLineLower(card);
  return typeLine.includes('artifact') || typeLine.includes('legendary') || typeLine.includes('saga');
}

function splitTypeCriteriaList(text: string): readonly string[] {
  const normalized = String(text || '')
    .replace(/\s*,\s*or\s+/gi, ',')
    .replace(/\s+or\s+/gi, ',')
    .replace(/\s*,\s*/g, ',')
    .trim();
  if (!normalized) return [];
  return normalized
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}

function normalizeTypeCriteriaTerm(term: string): string {
  return String(term || '')
    .toLowerCase()
    .replace(/['’]/g, "'")
    .replace(/[.\s]+$/g, '')
    .trim();
}

function normalizeCreatureTypeCriteriaTerm(term: string): string | null {
  const normalized = normalizeTypeCriteriaTerm(term);
  if (!normalized) return null;
  for (const word of normalized.split(/[\s-]+/g)) {
    if (!word) return null;
  }
  const titleCased = normalized
    .split('-')
    .map(part =>
      part
        .split(/\s+/g)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
    )
    .join('-');
  return isValidCreatureType(titleCased) ? titleCased : null;
}

function cardTypeLineIncludesTerm(card: any, term: string): boolean {
  const typeLine = ` ${getExecutorTypeLineLower(card)} `;
  const normalized = normalizeTypeCriteriaTerm(term);
  if (!normalized) return false;
  const pattern = new RegExp(`(^|[^a-z])${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[^a-z]|$)`, 'i');
  return pattern.test(typeLine);
}

function parseSmallNumberWord(text: string): number | null {
  const lower = String(text || '').trim().toLowerCase();
  if (!lower) return null;
  if (/^\d+$/.test(lower)) return parseInt(lower, 10);
  const lookup: Record<string, number> = {
    a: 1,
    an: 1,
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
    eleven: 11,
    twelve: 12,
  };
  return Number.isFinite(lookup[lower]) ? lookup[lower] : null;
}

export function parseSimpleCardTypeFromText(text: string): SimpleCardType | null {
  const lower = String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/g, '')
    .trim();

  if (!lower) return null;
  if (lower === 'nonland permanent') return 'nonland';
  if (lower === 'artifact or creature') return 'artifact_or_creature';
  if (lower === 'artifact or enchantment') return 'artifact_or_enchantment';
  if (lower === 'creature or land') return 'creature_or_land';
  if (lower === 'creature or planeswalker') return 'creature_or_planeswalker';
  if (lower === 'instant or sorcery') return 'instant_or_sorcery';
  if (lower === 'artifact, instant, or sorcery' || lower === 'artifact, instant or sorcery') {
    return 'artifact_instant_or_sorcery';
  }
  if (
    lower === 'instant, sorcery, or creature' ||
    lower === 'instant, sorcery or creature' ||
    lower === 'creature, instant, or sorcery' ||
    lower === 'creature, instant or sorcery'
  ) {
    return 'creature_instant_or_sorcery';
  }
  if (lower === 'saga') return 'saga';
  if (lower === 'permanent') return 'permanent';
  if (lower === 'nonland') return 'nonland';
  if (lower === 'aura') return 'aura';
  if (lower === 'non-dragon creature') return 'non_dragon_creature';
  if (lower === 'legendary creature') return 'legendary_creature';
  if (lower === 'legendary permanent') return 'legendary_permanent';
  if (lower === 'nonlegendary permanent') return 'nonlegendary_permanent';
  if (/\bcreature(s)?\b/i.test(lower)) return 'creature';
  if (/\bartifact(s)?\b/i.test(lower)) return 'artifact';
  if (/\benchantment(s)?\b/i.test(lower)) return 'enchantment';
  if (/\bland(s)?\b/i.test(lower)) return 'land';
  if (/\binstant(s)?\b/i.test(lower)) return 'instant';
  if (/\bsorcery|sorceries\b/i.test(lower)) return 'sorcery';
  if (/\bplaneswalker(s)?\b/i.test(lower)) return 'planeswalker';
  if (/\bsaga(s)?\b/i.test(lower)) return 'saga';
  return null;
}

export function cardMatchesType(card: any, type: SimpleCardType): boolean {
  const typeLine = getExecutorTypeLineLower(card);
  if (type === 'any') return true;
  if (type === 'permanent') {
    return cardRepresentsPermanent(card);
  }
  if (type === 'nonland') return !typeLine.includes('land');
  if (type === 'aura') return typeLine.includes('aura');
  if (type === 'instant_or_sorcery') return typeLine.includes('instant') || typeLine.includes('sorcery');
  if (type === 'artifact_or_creature') return typeLine.includes('artifact') || typeLine.includes('creature');
  if (type === 'artifact_or_enchantment') return typeLine.includes('artifact') || typeLine.includes('enchantment');
  if (type === 'creature_or_land') return typeLine.includes('creature') || typeLine.includes('land');
  if (type === 'creature_or_planeswalker') return typeLine.includes('creature') || typeLine.includes('planeswalker');
  if (type === 'artifact_instant_or_sorcery') {
    return typeLine.includes('artifact') || typeLine.includes('instant') || typeLine.includes('sorcery');
  }
  if (type === 'creature_instant_or_sorcery') {
    return typeLine.includes('creature') || typeLine.includes('instant') || typeLine.includes('sorcery');
  }
  if (type === 'non_dragon_creature') return typeLine.includes('creature') && !typeLine.includes('dragon');
  if (type === 'legendary_creature') return typeLine.includes('legendary') && typeLine.includes('creature');
  if (type === 'legendary_permanent') return typeLine.includes('legendary') && cardMatchesType(card, 'permanent');
  if (type === 'nonlegendary_permanent') return !typeLine.includes('legendary') && cardMatchesType(card, 'permanent');
  return typeLine.includes(type);
}

function parseStaticManaValueLteConstraint(typeText: string): MoveZoneSingleTargetCriteria | null {
  const normalized = String(typeText || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;

  const numericConstraintMatch =
    normalized.match(/^(.+?)(?:\s+cards?)?\s+with\s+mana\s+value\s+(\d+)\s+or\s+less$/i) ||
    normalized.match(/^(.+?)\s+with\s+mana\s+value\s+(\d+)\s+or\s+less$/i);
  if (!numericConstraintMatch) return null;

  const parsedCardType = parseSimpleCardTypeFromText(String(numericConstraintMatch[1] || '').trim());
  const manaValueLte = Number.parseInt(String(numericConstraintMatch[2] || ''), 10);
  if (!parsedCardType || !Number.isFinite(manaValueLte)) return null;

  return { cardType: parsedCardType, manaValueLte };
}

function parseMoveZoneSingleTargetCriteria(typeText: string): MoveZoneSingleTargetCriteria | null {
  const normalized = String(typeText || '').trim();
  if (!normalized) return null;

  const constrained = parseStaticManaValueLteConstraint(normalized);
  if (constrained) return constrained;

  const notNamedMatch = normalized.match(/^(.+?)\s+not named\s+(.+)$/i);
  const nameExclusion = notNamedMatch ? String(notNamedMatch[2] || '').trim() : undefined;
  const baseTypeText = notNamedMatch ? String(notNamedMatch[1] || '').trim() : normalized;

  let normalizedTypeText = baseTypeText.replace(/\s+cards?$/i, '').trim();
  if (/^cards?$/i.test(normalizedTypeText)) return { cardType: 'any' };

  let noAbilities = false;
  const noAbilitiesMatch = normalizedTypeText.match(/^(.+?)\s+with\s+no\s+abilities$/i);
  if (noAbilitiesMatch) {
    normalizedTypeText = String(noAbilitiesMatch[1] || '').trim();
    noAbilities = true;
  }

  let requiredCounter: string | undefined;
  const requiredCounterMatch = normalizedTypeText.match(/^(.+?)\s+with\s+(?:a|an|\d+|x|[a-z]+)\s+(.+?)\s+counters?\s+on\s+it$/i);
  if (requiredCounterMatch) {
    normalizedTypeText = String(requiredCounterMatch[1] || '').trim();
    requiredCounter = String(requiredCounterMatch[2] || '').trim().toLowerCase();
  }

  let requiredColors: string[] = [];
  const colorQualifiedMatch = normalizedTypeText.match(/^(white|blue|black|red|green)\s+(.+)$/i);
  if (colorQualifiedMatch) {
    const color = normalizeCardColor(String(colorQualifiedMatch[1] || ''));
    normalizedTypeText = String(colorQualifiedMatch[2] || '').trim();
    if (color) requiredColors = [color];
  }

  const nonHistoricMatch = normalizedTypeText.match(/^non-?([a-z-]+)\s+historic$/i);
  if (nonHistoricMatch) {
    return {
      cardType: 'any',
      requiresHistoric: true,
      typeLineTermsNoneOf: [String(nonHistoricMatch[1] || '').trim().toLowerCase()],
      ...(requiredColors.length > 0 ? { colorsAllOf: requiredColors } : {}),
      ...(noAbilities ? { noAbilities: true } : {}),
      ...(requiredCounter ? { requiredCounter } : {}),
      ...(nameExclusion ? { notNamed: nameExclusion } : {}),
    };
  }

  if (/^historic$/i.test(normalizedTypeText)) {
    return {
      cardType: 'any',
      requiresHistoric: true,
      ...(requiredColors.length > 0 ? { colorsAllOf: requiredColors } : {}),
      ...(noAbilities ? { noAbilities: true } : {}),
      ...(requiredCounter ? { requiredCounter } : {}),
      ...(nameExclusion ? { notNamed: nameExclusion } : {}),
    };
  }

  const parsedCardType = parseSimpleCardTypeFromText(normalizedTypeText);
  if (parsedCardType) {
    return {
      cardType: parsedCardType,
      ...(requiredColors.length > 0 ? { colorsAllOf: requiredColors } : {}),
      ...(noAbilities ? { noAbilities: true } : {}),
      ...(requiredCounter ? { requiredCounter } : {}),
      ...(nameExclusion ? { notNamed: nameExclusion } : {}),
    };
  }

  const splitTerms = splitTypeCriteriaList(normalizedTypeText);
  if (splitTerms.length > 0) {
    const creatureTypes = splitTerms
      .map(term => normalizeCreatureTypeCriteriaTerm(term))
      .filter((term): term is string => Boolean(term));
    if (creatureTypes.length === splitTerms.length) {
      return {
        cardType: 'any',
        creatureTypesAnyOf: creatureTypes,
        ...(requiredColors.length > 0 ? { colorsAllOf: requiredColors } : {}),
        ...(noAbilities ? { noAbilities: true } : {}),
        ...(requiredCounter ? { requiredCounter } : {}),
        ...(nameExclusion ? { notNamed: nameExclusion } : {}),
      };
    }

    return {
      cardType: 'any',
      typeLineTermsAnyOf: splitTerms.map(term => normalizeTypeCriteriaTerm(term)),
      ...(requiredColors.length > 0 ? { colorsAllOf: requiredColors } : {}),
      ...(noAbilities ? { noAbilities: true } : {}),
      ...(requiredCounter ? { requiredCounter } : {}),
      ...(nameExclusion ? { notNamed: nameExclusion } : {}),
    };
  }

  const singleCreatureType = normalizeCreatureTypeCriteriaTerm(normalizedTypeText);
  if (singleCreatureType) {
    return {
      cardType: 'any',
      creatureTypesAnyOf: [singleCreatureType],
      ...(requiredColors.length > 0 ? { colorsAllOf: requiredColors } : {}),
      ...(noAbilities ? { noAbilities: true } : {}),
      ...(requiredCounter ? { requiredCounter } : {}),
      ...(nameExclusion ? { notNamed: nameExclusion } : {}),
    };
  }

  return null;
}

function stripPutIntoGraveyardThisTurnQualifier(raw: string): {
  readonly selectorText: string;
  readonly putIntoGraveyardThisTurn: boolean;
} {
  const cleaned = String(raw || '').replace(/[.\s]+$/g, '').trim();
  const selectorText = cleaned.replace(/\s+that\s+was\s+put\s+there(?:\s+from\s+anywhere)?\s+this\s+turn$/i, '').trim();
  return {
    selectorText,
    putIntoGraveyardThisTurn: selectorText !== cleaned,
  };
}

function normalizeCardNameForCriteria(value: string | undefined): string {
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
  currentTurn?: number
): boolean {
  if (!cardMatchesType(card, criteria.cardType)) return false;
  if (criteria.requiresHistoric && !cardMatchesHistoric(card)) return false;

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

  if (criteria.noAbilities && !cardHasNoAbilities(card)) return false;

  if (criteria.requiredCounter) {
    const counterCount = Number((card?.counters || (card?.card as any)?.counters || {})?.[criteria.requiredCounter] ?? 0);
    if (!Number.isFinite(counterCount) || counterCount <= 0) return false;
  }

  if (criteria.manaValueLte !== undefined) {
    const manaValue = getCardManaValue(card);
    if (manaValue === null || manaValue > criteria.manaValueLte) return false;
  }

  if (criteria.notNamed) {
    const excludedName = normalizeCardNameForCriteria(
      /^this permanent$/i.test(criteria.notNamed) ? referenceCardName : criteria.notNamed
    );
    const cardName = normalizeCardNameForCriteria(String(card?.name || ''));
    if (excludedName && cardName && excludedName === cardName) return false;
  }

  if (criteria.putIntoGraveyardThisTurn) {
    const putIntoGraveyardTurn = Number((card as any)?.putIntoGraveyardTurn);
    if (!Number.isFinite(putIntoGraveyardTurn) || !Number.isFinite(currentTurn) || putIntoGraveyardTurn !== currentTurn) {
      return false;
    }
  }

  return true;
}

function parseTrailingZoneCounterRequirement(
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

function toTitleCaseWords(value: string): string {
  return String(value || '')
    .split(/[\s-]+/g)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
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

export function parseMoveZoneAllFromYourGraveyard(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (!/\bfrom your graveyard\b/i.test(lower)) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  if (/^all\s+cards?\s+from\s+your\s+graveyard$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+your\s+graveyard$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;

  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAllFromTargetPlayersGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;
  if (!/\bfrom (?:target|that) (?:player|opponent)'s graveyard\b/i.test(lower)) return null;

  if (/^all\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+graveyard$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+graveyard$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;

  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneCountFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | { readonly count: number; readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (lower.startsWith('all ')) return null;
  if (!/\bfrom your graveyard\b/i.test(lower)) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  let m = cleaned.match(/^([a-z0-9]+)\s+cards?\s+from\s+your\s+graveyard$/i);
  if (m) {
    const count = parseSmallNumberWord(String(m[1] || ''));
    if (count === null || count <= 0) return null;
    return { count, cardType: 'any' };
  }

  m = cleaned.match(/^([a-z0-9]+)\s+(.+?)\s+cards?\s+from\s+your\s+graveyard$/i);
  if (!m) return null;

  const count = parseSmallNumberWord(String(m[1] || ''));
  if (count === null || count <= 0) return null;

  const typeText = String(m[2] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { count, cardType: parsed };
}

export function parseMoveZoneCountFromTargetPlayersGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | { readonly count: number; readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (lower.startsWith('all ')) return null;
  if (!/\bfrom (?:target|that) (?:player|opponent)'s graveyard\b/i.test(lower)) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  let m = cleaned.match(/^([a-z0-9]+)\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+graveyard$/i);
  if (m) {
    const count = parseSmallNumberWord(String(m[1] || ''));
    if (count === null || count <= 0) return null;
    return { count, cardType: 'any' };
  }

  m = cleaned.match(/^([a-z0-9]+)\s+(.+?)\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+graveyard$/i);
  if (!m) return null;

  const count = parseSmallNumberWord(String(m[1] || ''));
  if (count === null || count <= 0) return null;

  const typeText = String(m[2] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { count, cardType: parsed };
}

export function parseMoveZoneSingleTargetFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | MoveZoneSingleTargetCriteria
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const withTurn = stripPutIntoGraveyardThisTurnQualifier(raw);
  const withCounter = parseTrailingZoneCounterRequirement(withTurn.selectorText, 'from your graveyard');
  const cleaned = withCounter.selectorText;
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!/^(?:up to one\s+)?(?:(?:other|another)\s+)?target\s+/i.test(lower)) return null;
  if (!/\bfrom your graveyard\b/i.test(lower)) return null;

  if (/^(?:up to one\s+)?(?:(?:other|another)\s+)?target\s+cards?\s+from\s+your\s+graveyard$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^(?:up to one\s+)?(?:(?:other|another)\s+)?target\s+(.+?)\s+from\s+your\s+graveyard$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseMoveZoneSingleTargetCriteria(typeText);
  if (!parsed) return null;
  return {
    ...parsed,
    ...(withCounter.requiredCounter ? { requiredCounter: withCounter.requiredCounter } : {}),
    ...(withTurn.putIntoGraveyardThisTurn ? { putIntoGraveyardThisTurn: true } : {}),
  };
}

export function parseMoveZoneRandomSingleFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | MoveZoneSingleTargetCriteria
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!/\bat random from your graveyard\b/i.test(lower)) return null;

  const match = cleaned.match(/^(?:a|an|one)\s+(.+?)\s+at random from your graveyard$/i);
  if (!match) return null;

  const typeText = String(match[1] || '').trim();
  if (!typeText) return null;
  return parseMoveZoneSingleTargetCriteria(typeText);
}

export function parseMoveZoneTargetAndSameNamedFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | MoveZoneSingleTargetCriteria
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const match = cleaned.match(
    /^target\s+(.+?)\s+and\s+all\s+other\s+cards\s+with\s+the\s+same\s+name\s+as\s+that\s+card\s+from\s+your\s+graveyard$/i
  );
  if (!match) return null;

  const typeText = String(match[1] || '').trim();
  if (!typeText) return null;
  return parseMoveZoneSingleTargetCriteria(typeText);
}

export function selectRandomMatchingCardIdFromGraveyard(
  state: GameState,
  playerId: PlayerID,
  criteria: MoveZoneSingleTargetCriteria,
  referenceCardName?: string
):
  | { readonly kind: 'missing_player' }
  | { readonly kind: 'impossible' }
  | { readonly kind: 'selected'; readonly cardId: string } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { kind: 'missing_player' };

  const currentTurn = getCurrentTurnNumber(state);
  const graveyard = Array.isArray(player.graveyard) ? player.graveyard : [];
  const matches = graveyard.filter((card: any) =>
    cardMatchesMoveZoneSingleTargetCriteria(card, criteria, referenceCardName, currentTurn)
  );
  if (matches.length <= 0) return { kind: 'impossible' };

  const randomIndex = matches.length === 1 ? 0 : Math.floor(Math.random() * matches.length);
  const selectedId = String((matches[randomIndex] as any)?.id || '').trim();
  return selectedId ? { kind: 'selected', cardId: selectedId } : { kind: 'impossible' };
}

export function parseMoveZoneSingleTargetFromTargetPlayersGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | MoveZoneSingleTargetCriteria
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const withTurn = stripPutIntoGraveyardThisTurnQualifier(raw);
  const withCounter = parseTrailingZoneCounterRequirement(withTurn.selectorText, "from (?:target|that) (?:player|opponent)'s graveyard");
  const cleaned = withCounter.selectorText;
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!/^(?:up to one\s+)?(?:(?:other|another)\s+)?target\s+/i.test(lower)) return null;
  if (!/\bfrom (?:target|that) (?:player|opponent)'s graveyard\b/i.test(lower)) return null;

  if (/^(?:up to one\s+)?(?:(?:other|another)\s+)?target\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+graveyard$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^(?:up to one\s+)?(?:(?:other|another)\s+)?target\s+(.+?)\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+graveyard$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseMoveZoneSingleTargetCriteria(typeText);
  if (!parsed) return null;
  return {
    ...parsed,
    ...(withCounter.requiredCounter ? { requiredCounter: withCounter.requiredCounter } : {}),
    ...(withTurn.putIntoGraveyardThisTurn ? { putIntoGraveyardThisTurn: true } : {}),
  };
}

export function parseMoveZoneSingleTargetFromAGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | MoveZoneSingleTargetCriteria
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const withTurn = stripPutIntoGraveyardThisTurnQualifier(raw);
  const withCounter = parseTrailingZoneCounterRequirement(withTurn.selectorText, 'from a graveyard');
  const cleaned = withCounter.selectorText;
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!/^(?:up to one\s+)?(?:other\s+)?target\s+/i.test(lower)) return null;
  if (!/\bfrom a graveyard\b/i.test(lower)) return null;

  if (/^(?:up to one\s+)?(?:other\s+)?target\s+cards?\s+from\s+a\s+graveyard$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^(?:up to one\s+)?(?:other\s+)?target\s+(.+?)\s+from\s+a\s+graveyard$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseMoveZoneSingleTargetCriteria(typeText);
  if (!parsed) return null;
  return {
    ...parsed,
    ...(withCounter.requiredCounter ? { requiredCounter: withCounter.requiredCounter } : {}),
    ...(withTurn.putIntoGraveyardThisTurn ? { putIntoGraveyardThisTurn: true } : {}),
  };
}

type ExactGraveyardSelection =
  | { readonly kind: 'missing_player' }
  | { readonly kind: 'impossible'; readonly available: number }
  | { readonly kind: 'player_choice_required'; readonly available: number }
  | {
      readonly kind: 'deterministic';
      readonly kept: readonly any[];
      readonly moved: readonly any[];
    };

function selectExactMatchingFromGraveyard(
  state: GameState,
  playerId: PlayerID,
  count: number,
  cardType: SimpleCardType
): ExactGraveyardSelection {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { kind: 'missing_player' };

  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const kept: any[] = [];
  const moved: any[] = [];

  for (const card of graveyard) {
    if (cardMatchesType(card, cardType)) moved.push(card);
    else kept.push(card);
  }

  if (moved.length < count) return { kind: 'impossible', available: moved.length };
  if (moved.length > count) return { kind: 'player_choice_required', available: moved.length };
  return { kind: 'deterministic', kept, moved };
}

export function exileExactMatchingFromGraveyard(
  state: GameState,
  playerId: PlayerID,
  count: number,
  cardType: SimpleCardType
):
  | { readonly kind: 'applied'; readonly state: GameState; readonly log: readonly string[] }
  | { readonly kind: 'impossible'; readonly available: number }
  | { readonly kind: 'player_choice_required'; readonly available: number } {
  const selection = selectExactMatchingFromGraveyard(state, playerId, count, cardType);
  if (selection.kind === 'missing_player') return { kind: 'applied', state, log: [] };
  if (selection.kind === 'impossible' || selection.kind === 'player_choice_required') return selection;

  const player = state.players.find(p => p.id === playerId) as any;
  const exile = Array.isArray(player?.exile) ? [...player.exile] : [];
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), graveyard: [...selection.kept], exile: [...exile, ...selection.moved] } as any) : p
  );
  return {
    kind: 'applied',
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} exiles ${selection.moved.length} card(s) from graveyard`],
  };
}

export function returnExactMatchingFromGraveyardToHand(
  state: GameState,
  playerId: PlayerID,
  count: number,
  cardType: SimpleCardType
):
  | { readonly kind: 'applied'; readonly state: GameState; readonly log: readonly string[] }
  | { readonly kind: 'impossible'; readonly available: number }
  | { readonly kind: 'player_choice_required'; readonly available: number } {
  const selection = selectExactMatchingFromGraveyard(state, playerId, count, cardType);
  if (selection.kind === 'missing_player') return { kind: 'applied', state, log: [] };
  if (selection.kind === 'impossible' || selection.kind === 'player_choice_required') return selection;

  const player = state.players.find(p => p.id === playerId) as any;
  const hand = Array.isArray(player?.hand) ? [...player.hand] : [];
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), graveyard: [...selection.kept], hand: [...hand, ...selection.moved] } as any) : p
  );
  return {
    kind: 'applied',
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} returns ${selection.moved.length} card(s) from graveyard to hand`],
  };
}

export function putExactMatchingFromGraveyardOntoBattlefieldWithController(
  state: GameState,
  sourcePlayerId: PlayerID,
  controllerId: PlayerID,
  count: number,
  cardType: SimpleCardType,
  entersTapped?: boolean,
  entersFaceDown?: boolean,
  withCounters?: Record<string, number>,
  attachedToBattlefieldPermanentId?: string
):
  | { readonly kind: 'applied'; readonly state: GameState; readonly log: readonly string[]; readonly movedPermanentIds: readonly string[] }
  | { readonly kind: 'impossible'; readonly available: number }
  | { readonly kind: 'player_choice_required'; readonly available: number } {
  const selection = selectExactMatchingFromGraveyard(state, sourcePlayerId, count, cardType);
  if (selection.kind === 'missing_player') return { kind: 'applied', state, log: [], movedPermanentIds: [] };
  if (selection.kind === 'impossible' || selection.kind === 'player_choice_required') return selection;

  const attachmentTarget = attachedToBattlefieldPermanentId
    ? getBattlefieldAttachmentTarget(state, attachedToBattlefieldPermanentId)
    : undefined;
  if (attachedToBattlefieldPermanentId && (!attachmentTarget || !selection.moved.every(card => canCardEnterAttachedToTarget(card, controllerId, attachmentTarget)))) {
    return { kind: 'impossible', available: selection.moved.length };
  }

  const newPermanents = createBattlefieldPermanentsFromCards(
    [...selection.moved],
    sourcePlayerId,
    controllerId,
    entersTapped,
    entersFaceDown,
    withCounters,
    'gy',
    attachmentTarget
  );
  const updatedPlayers = state.players.map(p =>
    p.id === sourcePlayerId ? ({ ...(p as any), graveyard: [...selection.kept] } as any) : p
  );
  return {
    kind: 'applied',
    state: addBattlefieldPermanentsToState({ ...state, players: updatedPlayers as any } as any, newPermanents),
    log: [`${controllerId} puts ${selection.moved.length} card(s) from ${sourcePlayerId}'s graveyard onto the battlefield`],
    movedPermanentIds: newPermanents.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean),
  };
}

export function moveTargetedCardFromGraveyard(
  state: GameState,
  playerId: PlayerID,
  targetCardId: string,
  criteria: MoveZoneSingleTargetCriteria,
  destination: 'hand' | 'exile' | 'battlefield' | 'library_top' | 'library_bottom',
  battlefieldControllerId?: PlayerID,
  entersTapped?: boolean,
  entersFaceDown?: boolean,
  withCounters?: Record<string, number>,
  attachedToBattlefieldPermanentId?: string,
  referenceCardName?: string,
  battlefieldEntryOverrides?: BattlefieldEntryCardOverrides
): {
  readonly kind: 'applied';
  readonly state: GameState;
  readonly log: readonly string[];
  readonly movedCards: readonly any[];
  readonly movedPermanentIds?: readonly string[];
} | { readonly kind: 'impossible' } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { kind: 'impossible' };

  const wantedId = String(targetCardId || '').trim();
  if (!wantedId) return { kind: 'impossible' };

  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const index = graveyard.findIndex(card => String((card as any)?.id || '').trim() === wantedId);
  if (index < 0) return { kind: 'impossible' };

  const card = graveyard[index];
  if (!cardMatchesMoveZoneSingleTargetCriteria(card, criteria, referenceCardName, getCurrentTurnNumber(state))) {
    return { kind: 'impossible' };
  }

  const kept = graveyard.filter((_: any, i: number) => i !== index);
  if (destination === 'hand') {
    const hand = Array.isArray(player.hand) ? [...player.hand] : [];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), graveyard: kept, hand: [...hand, card] } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} returns 1 card from graveyard to hand`],
      movedCards: [card],
    };
  }

  if (destination === 'exile') {
    const exile = Array.isArray(player.exile) ? [...player.exile] : [];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), graveyard: kept, exile: [...exile, card] } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} exiles 1 card from graveyard`],
      movedCards: [card],
    };
  }

  if (destination === 'library_top' || destination === 'library_bottom') {
    const library = Array.isArray(player.library) ? [...player.library] : [];
    const nextLibrary = destination === 'library_top' ? [card, ...library] : [...library, card];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), graveyard: kept, library: nextLibrary } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} puts 1 card from graveyard on the ${destination === 'library_top' ? 'top' : 'bottom'} of their library`],
      movedCards: [card],
    };
  }

  const controllerId = battlefieldControllerId || playerId;
  const attachmentTarget = attachedToBattlefieldPermanentId
    ? getBattlefieldAttachmentTarget(state, attachedToBattlefieldPermanentId)
    : undefined;
  if (
    attachedToBattlefieldPermanentId &&
    (!attachmentTarget || !canCardEnterAttachedToTarget(card, controllerId, attachmentTarget, battlefieldEntryOverrides))
  ) {
    return { kind: 'impossible' };
  }

  const newPermanent = createBattlefieldPermanentsFromCards(
    [card],
    playerId,
    controllerId,
    entersTapped,
    entersFaceDown,
    withCounters,
    'gy',
    attachmentTarget,
    battlefieldEntryOverrides
  );
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), graveyard: kept } as any) : p
  );
  return {
    kind: 'applied',
    state: addBattlefieldPermanentsToState({ ...state, players: updatedPlayers as any } as any, newPermanent),
    log: [`${controllerId} puts 1 card from ${playerId}'s graveyard onto the battlefield`],
    movedCards: [card],
    movedPermanentIds: newPermanent.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean),
  };
}

export function moveTargetedCardFromAnyGraveyard(
  state: GameState,
  targetCardId: string,
  criteria: MoveZoneSingleTargetCriteria,
  destination: 'hand' | 'exile' | 'battlefield' | 'library_top' | 'library_bottom',
  battlefieldControllerId?: PlayerID,
  entersTapped?: boolean,
  entersFaceDown?: boolean,
  withCounters?: Record<string, number>,
  attachedToBattlefieldPermanentId?: string,
  referenceCardName?: string,
  battlefieldEntryOverrides?: BattlefieldEntryCardOverrides
): {
  readonly kind: 'applied';
  readonly state: GameState;
  readonly log: readonly string[];
  readonly movedCards: readonly any[];
  readonly movedPermanentIds?: readonly string[];
} | { readonly kind: 'impossible' } {
  const wantedId = String(targetCardId || '').trim();
  if (!wantedId) return { kind: 'impossible' };

  for (const player of (state.players || []) as any[]) {
    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    if (graveyard.some((card: any) => String(card?.id || '').trim() === wantedId)) {
      return moveTargetedCardFromGraveyard(
        state,
        player.id as PlayerID,
        wantedId,
        criteria,
        destination,
        battlefieldControllerId,
        entersTapped,
        entersFaceDown,
        withCounters,
        attachedToBattlefieldPermanentId,
        referenceCardName,
        battlefieldEntryOverrides
      );
    }
  }

  return { kind: 'impossible' };
}

export function attachExistingBattlefieldPermanentToTarget(
  state: GameState,
  attachmentPermanentId: string,
  targetPermanentId: string
): { readonly kind: 'applied'; readonly state: GameState; readonly log: readonly string[] } | { readonly kind: 'impossible' } {
  const attachmentId = String(attachmentPermanentId || '').trim();
  const targetId = String(targetPermanentId || '').trim();
  if (!attachmentId || !targetId || attachmentId === targetId) return { kind: 'impossible' };

  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const attachment = battlefield.find(perm => String((perm as any)?.id || '').trim() === attachmentId) as any;
  const target = battlefield.find(perm => String((perm as any)?.id || '').trim() === targetId) as any;
  if (!attachment || !target) return { kind: 'impossible' };

  const typeLine = getCardTypeLineLower(attachment);
  const isEquipment = typeLine.includes('equipment');
  const previousTargetId = String((attachment as any)?.attachedTo || '').trim();

  const updatedBattlefield = battlefield.map((perm: any) => {
    const permId = String(perm?.id || '').trim();
    if (!permId) return perm;

    if (permId === attachmentId) {
      return {
        ...perm,
        attachedTo: targetId,
        ...(isEquipment ? { isEquipped: true } : {}),
      };
    }

    let nextAttachments = Array.isArray(perm.attachments) ? [...perm.attachments] : [];
    let nextAttachedEquipment = Array.isArray(perm.attachedEquipment) ? [...perm.attachedEquipment] : [];

    if (permId === previousTargetId) {
      nextAttachments = nextAttachments.filter(id => String(id || '').trim() !== attachmentId);
      nextAttachedEquipment = nextAttachedEquipment.filter(id => String(id || '').trim() !== attachmentId);
    }

    if (permId === targetId) {
      if (!nextAttachments.includes(attachmentId)) nextAttachments.push(attachmentId);
      if (isEquipment && !nextAttachedEquipment.includes(attachmentId)) nextAttachedEquipment.push(attachmentId);
    }

    const out: any = { ...perm, attachments: nextAttachments };
    if (isEquipment) {
      out.attachedEquipment = nextAttachedEquipment;
      out.isEquipped = nextAttachedEquipment.length > 0;
    }
    return out;
  });

  return {
    kind: 'applied',
    state: { ...state, battlefield: updatedBattlefield as any } as any,
    log: [`${attachmentId} attaches to ${targetId}`],
  };
}

export function parseMoveZoneSingleTargetFromYourHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('target ')) return null;
  if (!/\bfrom your hand\b/i.test(lower)) return null;

  if (/^target\s+cards?\s+from\s+your\s+hand$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^target\s+(.+?)\s+cards?\s+from\s+your\s+hand$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneSingleTargetFromTargetPlayersHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('target ')) return null;
  if (!/\bfrom (?:target|that) (?:player|opponent)'s hand\b/i.test(lower)) return null;

  if (/^target\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+hand$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^target\s+(.+?)\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+hand$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneSingleTargetFromYourExile(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('target ')) return null;
  if (!/\bfrom your exile\b/i.test(lower)) return null;

  if (/^target\s+cards?\s+from\s+your\s+exile$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^target\s+(.+?)\s+cards?\s+from\s+your\s+exile$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneSingleTargetFromLinkedExile(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | MoveZoneSingleTargetCriteria
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const match = cleaned.match(
    /^(?:a|an|the)\s+(.+?)\s+exiled with this (?:creature|artifact|enchantment|planeswalker|permanent|card|class|saga)$/i
  );
  if (!match) return null;

  const typeText = String(match[1] || '').trim();
  if (!typeText) return null;
  return parseMoveZoneSingleTargetCriteria(typeText);
}

export function parseMoveZoneAllFromLinkedExile(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  if (/^the exiled cards$/i.test(cleaned)) {
    return { cardType: 'any' };
  }

  const match = cleaned.match(/^all\s+(.+?)\s+cards?\s+exiled with this (?:creature|artifact|enchantment|planeswalker|permanent|card|class|saga)$/i);
  if (!match) return null;

  const typeText = String(match[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function findCardsExiledWithSource(
  state: GameState,
  sourceId: string,
  criteria: MoveZoneSingleTargetCriteria
): readonly { playerId: PlayerID; cardId: string; card: any }[] {
  const wantedSourceId = String(sourceId || '').trim();
  if (!wantedSourceId) return [];

  const matches: { playerId: PlayerID; cardId: string; card: any }[] = [];
  const currentTurn = getCurrentTurnNumber(state);
  for (const player of state.players as any[]) {
    const playerId = String(player?.id || '').trim() as PlayerID;
    if (!playerId) continue;

    const exile = Array.isArray(player?.exile) ? player.exile : [];
    for (const card of exile) {
      const cardId = String(card?.id || card?.cardId || '').trim();
      if (!cardId) continue;
      if (!isCardExiledWithSource(card, wantedSourceId)) continue;
      if (!cardMatchesMoveZoneSingleTargetCriteria(card, criteria, undefined, currentTurn)) continue;
      matches.push({ playerId, cardId, card });
    }
  }

  return matches;
}

export function parseMoveZoneSingleTargetFromTargetPlayersExile(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('target ')) return null;
  if (!/\bfrom (?:target|that) (?:player|opponent)'s exile\b/i.test(lower)) return null;

  if (/^target\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+exile$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^target\s+(.+?)\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+exile$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function moveTargetedCardFromHand(
  state: GameState,
  playerId: PlayerID,
  targetCardId: string,
  cardType: SimpleCardType,
  destination: 'graveyard' | 'exile' | 'battlefield',
  battlefieldControllerId?: PlayerID,
  entersTapped?: boolean,
  entersFaceDown?: boolean,
  withCounters?: Record<string, number>,
  attachedToBattlefieldPermanentId?: string,
  battlefieldEntryOverrides?: BattlefieldEntryCardOverrides
): {
  readonly kind: 'applied';
  readonly state: GameState;
  readonly log: readonly string[];
  readonly movedPermanentIds?: readonly string[];
} | { readonly kind: 'impossible' } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { kind: 'impossible' };

  const wantedId = String(targetCardId || '').trim();
  if (!wantedId) return { kind: 'impossible' };

  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  const index = hand.findIndex(card => String((card as any)?.id || '').trim() === wantedId);
  if (index < 0) return { kind: 'impossible' };

  const card = hand[index];
  if (!cardMatchesType(card, cardType)) return { kind: 'impossible' };

  const kept = hand.filter((_: any, i: number) => i !== index);
  if (destination === 'graveyard') {
    const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
    const movedCard = stampCardPutIntoGraveyardThisTurn(state, card);
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), hand: kept, graveyard: [...graveyard, movedCard] } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} puts 1 card from hand to graveyard`],
    };
  }

  if (destination === 'exile') {
    const exile = Array.isArray(player.exile) ? [...player.exile] : [];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), hand: kept, exile: [...exile, card] } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} exiles 1 card from hand`],
    };
  }

  const controllerId = battlefieldControllerId || playerId;
  const attachmentTarget = attachedToBattlefieldPermanentId
    ? getBattlefieldAttachmentTarget(state, attachedToBattlefieldPermanentId)
    : undefined;
  if (
    attachedToBattlefieldPermanentId &&
    (!attachmentTarget || !canCardEnterAttachedToTarget(card, controllerId, attachmentTarget, battlefieldEntryOverrides))
  ) {
    return { kind: 'impossible' };
  }

  const newPermanent = createBattlefieldPermanentsFromCards(
    [card],
    playerId,
    controllerId,
    entersTapped,
    entersFaceDown,
    withCounters,
    'hand',
    attachmentTarget,
    battlefieldEntryOverrides
  );
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), hand: kept } as any) : p
  );
  return {
    kind: 'applied',
    state: addBattlefieldPermanentsToState({ ...state, players: updatedPlayers as any } as any, newPermanent),
    log: [`${controllerId} puts 1 card from ${playerId}'s hand onto the battlefield`],
    movedPermanentIds: newPermanent.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean),
  };
}

export function moveTargetedCardFromExile(
  state: GameState,
  playerId: PlayerID,
  targetCardId: string,
  cardType: SimpleCardType,
  destination: 'hand' | 'graveyard' | 'battlefield',
  battlefieldControllerId?: PlayerID,
  entersTapped?: boolean,
  entersFaceDown?: boolean,
  withCounters?: Record<string, number>,
  attachedToBattlefieldPermanentId?: string,
  battlefieldEntryOverrides?: BattlefieldEntryCardOverrides
): {
  readonly kind: 'applied';
  readonly state: GameState;
  readonly log: readonly string[];
  readonly movedPermanentIds?: readonly string[];
} | { readonly kind: 'impossible' } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { kind: 'impossible' };

  const wantedId = String(targetCardId || '').trim();
  if (!wantedId) return { kind: 'impossible' };

  const exile = Array.isArray(player.exile) ? [...player.exile] : [];
  const index = exile.findIndex(card => String((card as any)?.id || '').trim() === wantedId);
  if (index < 0) return { kind: 'impossible' };

  const card = exile[index];
  if (!cardMatchesType(card, cardType)) return { kind: 'impossible' };

  const kept = exile.filter((_: any, i: number) => i !== index);
  if (destination === 'hand') {
    const hand = Array.isArray(player.hand) ? [...player.hand] : [];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), exile: kept, hand: [...hand, card] } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} returns 1 card from exile to hand`],
    };
  }

  if (destination === 'graveyard') {
    const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
    const movedCard = stampCardPutIntoGraveyardThisTurn(state, card);
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), exile: kept, graveyard: [...graveyard, movedCard] } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} puts 1 card from exile to graveyard`],
    };
  }

  const controllerId = battlefieldControllerId || playerId;
  const attachmentTarget = attachedToBattlefieldPermanentId
    ? getBattlefieldAttachmentTarget(state, attachedToBattlefieldPermanentId)
    : undefined;
  if (
    attachedToBattlefieldPermanentId &&
    (!attachmentTarget || !canCardEnterAttachedToTarget(card, controllerId, attachmentTarget, battlefieldEntryOverrides))
  ) {
    return { kind: 'impossible' };
  }

  const newPermanent = createBattlefieldPermanentsFromCards(
    [card],
    playerId,
    controllerId,
    entersTapped,
    entersFaceDown,
    withCounters,
    'exile',
    attachmentTarget,
    battlefieldEntryOverrides
  );
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), exile: kept } as any) : p
  );
  return {
    kind: 'applied',
    state: addBattlefieldPermanentsToState({ ...state, players: updatedPlayers as any } as any, newPermanent),
    log: [`${controllerId} puts 1 card from ${playerId}'s exile onto the battlefield`],
    movedPermanentIds: newPermanent.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean),
  };
}

export function parseMoveZoneAllFromYourHand(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (!/\bfrom your hand\b/i.test(lower)) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  if (/^all\s+cards?\s+from\s+your\s+hand$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+your\s+hand$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;

  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAllFromYourExile(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (!/\bfrom your exile\b/i.test(lower)) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  if (/^all\s+cards?\s+from\s+your\s+exile$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+your\s+exile$/i);
  if (!m) return null;
  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAllFromTargetPlayersHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;
  if (!/\bfrom (?:target|that) (?:player|opponent)'s hand\b/i.test(lower)) return null;

  if (/^all\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+hand$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+hand$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAllFromTargetPlayersExile(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;
  if (!/\bfrom (?:target|that) (?:player|opponent)'s exile\b/i.test(lower)) return null;

  if (/^all\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+exile$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+exile$/i);
  if (!m) return null;
  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAllFromEachPlayersGraveyard(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  const fromEachPlayersGy =
    /\bfrom each player's graveyard\b/i.test(lower) || /\bfrom each players' graveyard\b/i.test(lower);
  const fromAllGys = /\bfrom all graveyards\b/i.test(lower);
  if (!fromEachPlayersGy && !fromAllGys) return null;

  if (/^all\s+cards?\s+from\s+(?:each\s+player's\s+graveyard|each\s+players'\s+graveyard|all\s+graveyards)$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(
    /^all\s+(.+?)\s+cards?\s+from\s+(?:each\s+player's\s+graveyard|each\s+players'\s+graveyard|all\s+graveyards)$/i
  );
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAllFromEachPlayersHand(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  if (!/\bfrom each player's hand\b/i.test(lower) && !/\bfrom each players' hand\b/i.test(lower)) return null;

  if (/^all\s+cards?\s+from\s+(?:each\s+player's\s+hand|each\s+players'\s+hand)$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+(?:each\s+player's\s+hand|each\s+players'\s+hand)$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAllFromEachPlayersExile(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  const fromEachPlayersExile = /\bfrom each player's exile\b/i.test(lower) || /\bfrom each players' exile\b/i.test(lower);
  const fromAllExiles = /\bfrom all exiles\b/i.test(lower);
  if (!fromEachPlayersExile && !fromAllExiles) return null;

  if (/^all\s+cards?\s+from\s+(?:each\s+player's\s+exile|each\s+players'\s+exile|all\s+exiles)$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(
    /^all\s+(.+?)\s+cards?\s+from\s+(?:each\s+player's\s+exile|each\s+players'\s+exile|all\s+exiles)$/i
  );
  if (!m) return null;
  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAllFromEachOpponentsGraveyard(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  const fromEachOppGy =
    /\bfrom each opponent's graveyard\b/i.test(lower) || /\bfrom each opponents' graveyard\b/i.test(lower);
  if (!fromEachOppGy) return null;

  if (/^all\s+cards?\s+from\s+(?:each\s+opponent's\s+graveyard|each\s+opponents'\s+graveyard)$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+(?:each\s+opponent's\s+graveyard|each\s+opponents'\s+graveyard)$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAllFromEachOpponentsHand(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  const fromEachOppHand = /\bfrom each opponent's hand\b/i.test(lower) || /\bfrom each opponents' hand\b/i.test(lower);
  if (!fromEachOppHand) return null;

  if (/^all\s+cards?\s+from\s+(?:each\s+opponent's\s+hand|each\s+opponents'\s+hand)$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+(?:each\s+opponent's\s+hand|each\s+opponents'\s+hand)$/i);
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAllFromEachOpponentsExile(what: { readonly kind: string; readonly text?: string; readonly raw?: string }):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (/\b(and|or)\b/i.test(lower)) return null;

  const fromEachOppExile = /\bfrom each opponent's exile\b/i.test(lower) || /\bfrom each opponents' exile\b/i.test(lower);
  if (!fromEachOppExile) return null;

  if (/^all\s+cards?\s+from\s+(?:each\s+opponent's\s+exile|each\s+opponents'\s+exile)$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+(?:each\s+opponent's\s+exile|each\s+opponents'\s+exile)$/i);
  if (!m) return null;
  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

function createBattlefieldPermanentsFromCards(
  moved: readonly any[],
  sourcePlayerId: PlayerID,
  controllerId: PlayerID,
  entersTapped: boolean | undefined,
  entersFaceDown: boolean | undefined,
  withCounters: Record<string, number> | undefined,
  sourcePrefix: string,
  attachmentTarget?: BattlefieldAttachmentTarget,
  entryOverrides?: BattlefieldEntryCardOverrides
): BattlefieldPermanent[] {
  return moved.map((card: any, idx: number) => {
    const cardIdHint = String(card?.id || '').trim();
    const base = cardIdHint ? cardIdHint : `${sourcePrefix}-${idx}`;
    const sourceZone =
      sourcePrefix === 'gy' ? 'graveyard' : sourcePrefix === 'ex' ? 'exile' : sourcePrefix === 'hand' ? 'hand' : sourcePrefix;
    const counters = mergeRetainedCountersForBattlefieldEntry(card, sourceZone, withCounters);
    const faceUpCard = applyBattlefieldEntryCardOverrides(
      { ...(card || {}), zone: 'battlefield', enteredFromZone: sourceZone } as any,
      entryOverrides
    );
    if ('counters' in faceUpCard) delete faceUpCard.counters;
    if ('damageSourceIds' in faceUpCard) delete faceUpCard.damageSourceIds;

    const basePermanent = {
      id: `perm-${base}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      controller: controllerId,
      owner: sourcePlayerId,
      tapped: Boolean(entersTapped),
      summoningSickness: true,
      counters: counters || {},
      enteredFromZone: sourceZone,
      ...(String(card?.castFromZone || '').trim() ? { castFromZone: String(card.castFromZone).trim().toLowerCase() } : {}),
      ...(attachmentTarget ? { attachedTo: attachmentTarget.id } : {}),
      attachments: [],
      modifiers: [],
    } as any;

    if (entersFaceDown) {
      const hiddenCard = {
        id: String(card?.id || base),
        faceDown: true,
        zone: 'battlefield',
        visibility: 'public',
        power: '2',
        toughness: '2',
      } as any;

      return {
        ...basePermanent,
        basePower: 2,
        baseToughness: 2,
        power: 2,
        toughness: 2,
        effectiveTypes: ['Creature'],
        card: hiddenCard,
        faceUpCard,
      } as any;
    }

    return {
      ...basePermanent,
      card: faceUpCard,
    } as any;
  });
}

function getBattlefieldAttachmentTarget(state: GameState, permanentId: string): BattlefieldAttachmentTarget | undefined {
  const wantedId = String(permanentId || '').trim();
  if (!wantedId) return undefined;
  return ((state.battlefield || []) as BattlefieldPermanent[]).find(
    perm => String((perm as any)?.id || '').trim() === wantedId
  );
}

function getCardTypeLineLower(card: any): string {
  return String(card?.type_line || card?.card?.type_line || '').toLowerCase().trim();
}

function getCardOracleTextLower(card: any): string {
  return String(card?.oracle_text || card?.card?.oracle_text || '')
    .replace(/\u2019/g, "'")
    .toLowerCase();
}

function applyBattlefieldEntryCardOverrides(card: any, overrides?: BattlefieldEntryCardOverrides): any {
  if (!card || !overrides) return card;

  const nextCard = { ...(card as any) };
  if (overrides.loseAllAbilities) {
    nextCard.oracle_text = '';
    nextCard.keywords = [];
  }
  if (String(overrides.setTypeLine || '').trim()) {
    nextCard.type_line = String(overrides.setTypeLine).trim();
  }
  if (typeof overrides.setOracleText === 'string') {
    nextCard.oracle_text = overrides.setOracleText;
  }
  return nextCard;
}

function canCardEnterAttachedToTarget(
  card: any,
  controllerId: PlayerID,
  target: BattlefieldAttachmentTarget,
  entryOverrides?: BattlefieldEntryCardOverrides
): boolean {
  if (!card || !target) return false;
  const candidateCard = applyBattlefieldEntryCardOverrides(card, entryOverrides);
  if (!getCardTypeLineLower(candidateCard).includes('aura')) return false;
  if (!hasExecutorClass(target, 'creature')) return false;

  const oracleTextLower = getCardOracleTextLower(candidateCard);
  if (!/\benchant creature\b/i.test(oracleTextLower)) return false;
  if (/\benchant creature you control\b/i.test(oracleTextLower) && target.controller !== controllerId) return false;
  return true;
}

function addBattlefieldPermanentsToState(state: GameState, newPermanents: readonly BattlefieldPermanent[]): GameState {
  if (newPermanents.length === 0) return state;

  const attachmentAdds = new Map<string, string[]>();
  for (const permanent of newPermanents) {
    const attachedTo = String((permanent as any)?.attachedTo || '').trim();
    const permanentId = String((permanent as any)?.id || '').trim();
    if (!attachedTo || !permanentId) continue;
    const next = attachmentAdds.get(attachedTo) || [];
    if (!next.includes(permanentId)) next.push(permanentId);
    attachmentAdds.set(attachedTo, next);
  }

  const mergedBattlefield = [...((state.battlefield || []) as BattlefieldPermanent[]), ...newPermanents].map(permanent => {
    const permanentId = String((permanent as any)?.id || '').trim();
    const additions = attachmentAdds.get(permanentId);
    if (!additions || additions.length === 0) return permanent;

    const attachments = Array.isArray((permanent as any)?.attachments) ? [...(permanent as any).attachments] : [];
    for (const addedId of additions) {
      if (!attachments.includes(addedId)) attachments.push(addedId);
    }
    return { ...(permanent as any), attachments } as BattlefieldPermanent;
  });

  return { ...state, battlefield: mergedBattlefield as any } as any;
}

export function moveAllMatchingFromExile(
  state: GameState,
  playerId: PlayerID,
  cardType: SimpleCardType,
  destination: 'hand' | 'graveyard'
): { state: GameState; log: string[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [] };

  const exile = Array.isArray(player.exile) ? [...player.exile] : [];
  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];

  const kept: any[] = [];
  const moved: any[] = [];
  for (const card of exile) {
    if (cardMatchesType(card, cardType)) moved.push(card);
    else kept.push(card);
  }
  if (moved.length === 0) return { state, log: [] };

  const nextState = clearPlayableFromExileForCards(state, playerId, moved);
  const movedClean = moved.map(stripImpulsePermissionMarkers);

  const nextPlayer: any = { ...(player as any), exile: kept };
  if (destination === 'hand') {
    nextPlayer.hand = [...hand, ...movedClean];
  } else {
    nextPlayer.graveyard = [...graveyard, ...stampCardsPutIntoGraveyardThisTurn(state, movedClean)];
  }

  const updatedPlayers = nextState.players.map(p => (p.id === playerId ? nextPlayer : p));
  return {
    state: { ...nextState, players: updatedPlayers as any } as any,
    log: [`${playerId} moves ${moved.length} card(s) from exile to ${destination}`],
  };
}

export function putAllMatchingFromExileOntoBattlefield(
  state: GameState,
  playerId: PlayerID,
  cardType: SimpleCardType,
  entersTapped?: boolean,
  entersFaceDown?: boolean,
  withCounters?: Record<string, number>
): { state: GameState; log: string[]; movedPermanentIds?: readonly string[] } {
  return putAllMatchingFromExileOntoBattlefieldWithController(
    state,
    playerId,
    playerId,
    cardType,
    entersTapped,
    entersFaceDown,
    withCounters
  );
}

export function putAllMatchingFromExileOntoBattlefieldWithController(
  state: GameState,
  sourcePlayerId: PlayerID,
  controllerId: PlayerID,
  cardType: SimpleCardType,
  entersTapped?: boolean,
  entersFaceDown?: boolean,
  withCounters?: Record<string, number>
): { state: GameState; log: string[]; movedPermanentIds?: readonly string[] } {
  const player = state.players.find(p => p.id === sourcePlayerId) as any;
  if (!player) return { state, log: [], movedPermanentIds: [] };

  const exile = Array.isArray(player.exile) ? [...player.exile] : [];
  const kept: any[] = [];
  const moved: any[] = [];

  for (const card of exile) {
    if (cardMatchesType(card, cardType)) moved.push(card);
    else kept.push(card);
  }

  if (moved.length === 0) return { state, log: [], movedPermanentIds: [] };

  const nextState = clearPlayableFromExileForCards(state, sourcePlayerId, moved);
  const movedClean = moved.map(stripImpulsePermissionMarkers);
  const newPermanents = createBattlefieldPermanentsFromCards(
    movedClean,
    sourcePlayerId,
    controllerId,
    entersTapped,
    entersFaceDown,
    withCounters,
    'ex'
  );

  const updatedPlayers = nextState.players.map(p => (p.id === sourcePlayerId ? ({ ...(p as any), exile: kept } as any) : p));
  return {
    state: addBattlefieldPermanentsToState({ ...nextState, players: updatedPlayers as any } as any, newPermanents),
    log: [`${controllerId} puts ${moved.length} card(s) from ${sourcePlayerId}'s exile onto the battlefield`],
    movedPermanentIds: newPermanents.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean),
  };
}

export function returnAllMatchingFromGraveyardToHand(
  state: GameState,
  playerId: PlayerID,
  cardType: SimpleCardType
): { state: GameState; log: string[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [] };

  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const hand = Array.isArray(player.hand) ? [...player.hand] : [];

  const kept: any[] = [];
  const moved: any[] = [];

  for (const card of graveyard) {
    if (cardMatchesType(card, cardType)) moved.push(card);
    else kept.push(card);
  }

  if (moved.length === 0) return { state, log: [] };

  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), graveyard: kept, hand: [...hand, ...moved] } as any) : p
  );
  return {
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} returns ${moved.length} card(s) from graveyard to hand`],
  };
}

export function returnTargetAndSameNamedCardsFromYourGraveyardToHand(
  state: GameState,
  playerId: PlayerID,
  targetCardId: string,
  criteria: MoveZoneSingleTargetCriteria
): { readonly kind: 'applied'; readonly state: GameState; readonly log: readonly string[]; readonly movedCards: readonly any[] } | { readonly kind: 'impossible' } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { kind: 'impossible' };

  const wantedId = String(targetCardId || '').trim();
  if (!wantedId) return { kind: 'impossible' };

  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const targetCard = graveyard.find((card: any) => String(card?.id || '').trim() === wantedId);
  if (!targetCard) return { kind: 'impossible' };
  if (!cardMatchesMoveZoneSingleTargetCriteria(targetCard, criteria, undefined, getCurrentTurnNumber(state))) {
    return { kind: 'impossible' };
  }

  const targetName = normalizeCardNameForCriteria(String((targetCard as any)?.name || ''));
  if (!targetName) return { kind: 'impossible' };

  const kept: any[] = [];
  const moved: any[] = [];
  for (const card of graveyard) {
    const cardName = normalizeCardNameForCriteria(String((card as any)?.name || ''));
    if (cardName === targetName) moved.push(card);
    else kept.push(card);
  }

  if (moved.length === 0) return { kind: 'impossible' };

  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), graveyard: kept, hand: [...hand, ...moved] } as any) : p
  );

  return {
    kind: 'applied',
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} returns ${moved.length} card(s) with the same name from graveyard to hand`],
    movedCards: moved,
  };
}

export function exileAllMatchingFromGraveyard(
  state: GameState,
  playerId: PlayerID,
  cardType: SimpleCardType
): { state: GameState; log: string[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [] };

  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const exile = Array.isArray(player.exile) ? [...player.exile] : [];

  const kept: any[] = [];
  const moved: any[] = [];

  for (const card of graveyard) {
    if (cardMatchesType(card, cardType)) moved.push(card);
    else kept.push(card);
  }

  if (moved.length === 0) return { state, log: [] };

  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), graveyard: kept, exile: [...exile, ...moved] } as any) : p
  );
  return {
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} exiles ${moved.length} card(s) from graveyard`],
  };
}

export function putAllMatchingFromGraveyardOntoBattlefield(
  state: GameState,
  playerId: PlayerID,
  cardType: SimpleCardType,
  entersTapped?: boolean,
  entersFaceDown?: boolean,
  withCounters?: Record<string, number>
): { state: GameState; log: string[]; movedPermanentIds?: readonly string[] } {
  return putAllMatchingFromGraveyardOntoBattlefieldWithController(
    state,
    playerId,
    playerId,
    cardType,
    entersTapped,
    entersFaceDown,
    withCounters
  );
}

export function putAllMatchingFromGraveyardOntoBattlefieldWithController(
  state: GameState,
  sourcePlayerId: PlayerID,
  controllerId: PlayerID,
  cardType: SimpleCardType,
  entersTapped?: boolean,
  entersFaceDown?: boolean,
  withCounters?: Record<string, number>
): { state: GameState; log: string[]; movedPermanentIds?: readonly string[] } {
  const player = state.players.find(p => p.id === sourcePlayerId) as any;
  if (!player) return { state, log: [], movedPermanentIds: [] };

  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const kept: any[] = [];
  const moved: any[] = [];

  for (const card of graveyard) {
    if (cardMatchesType(card, cardType)) moved.push(card);
    else kept.push(card);
  }

  if (moved.length === 0) return { state, log: [], movedPermanentIds: [] };

  const newPermanents = createBattlefieldPermanentsFromCards(
    moved,
    sourcePlayerId,
    controllerId,
    entersTapped,
    entersFaceDown,
    withCounters,
    'gy'
  );
  const updatedPlayers = state.players.map(p => (p.id === sourcePlayerId ? ({ ...(p as any), graveyard: kept } as any) : p));
  return {
    state: addBattlefieldPermanentsToState({ ...state, players: updatedPlayers as any } as any, newPermanents),
    log: [`${controllerId} puts ${moved.length} card(s) from ${sourcePlayerId}'s graveyard onto the battlefield`],
    movedPermanentIds: newPermanents.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean),
  };
}

export function moveAllMatchingFromHand(
  state: GameState,
  playerId: PlayerID,
  cardType: SimpleCardType,
  destination: 'graveyard' | 'exile'
): { state: GameState; log: string[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [] };

  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const exile = Array.isArray(player.exile) ? [...player.exile] : [];

  const kept: any[] = [];
  const moved: any[] = [];

  for (const card of hand) {
    if (cardMatchesType(card, cardType)) moved.push(card);
    else kept.push(card);
  }

  if (moved.length === 0) return { state, log: [] };

  const nextPlayer: any = { ...(player as any), hand: kept };
  if (destination === 'graveyard') {
    nextPlayer.graveyard = [...graveyard, ...stampCardsPutIntoGraveyardThisTurn(state, moved)];
  } else {
    nextPlayer.exile = [...exile, ...moved];
  }

  const updatedPlayers = state.players.map(p => (p.id === playerId ? nextPlayer : p));
  const verb = destination === 'graveyard' ? 'puts' : 'exiles';
  const where = destination === 'graveyard' ? 'graveyard' : 'exile';
  return {
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} ${verb} ${moved.length} card(s) from hand to ${where}`],
  };
}

export function putAllMatchingFromHandOntoBattlefield(
  state: GameState,
  playerId: PlayerID,
  cardType: SimpleCardType,
  entersTapped?: boolean,
  entersFaceDown?: boolean,
  withCounters?: Record<string, number>
): { state: GameState; log: string[]; movedPermanentIds?: readonly string[] } {
  return putAllMatchingFromHandOntoBattlefieldWithController(
    state,
    playerId,
    playerId,
    cardType,
    entersTapped,
    entersFaceDown,
    withCounters
  );
}

export function putAllMatchingFromHandOntoBattlefieldWithController(
  state: GameState,
  sourcePlayerId: PlayerID,
  controllerId: PlayerID,
  cardType: SimpleCardType,
  entersTapped?: boolean,
  entersFaceDown?: boolean,
  withCounters?: Record<string, number>
): { state: GameState; log: string[]; movedPermanentIds?: readonly string[] } {
  const player = state.players.find(p => p.id === sourcePlayerId) as any;
  if (!player) return { state, log: [], movedPermanentIds: [] };

  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  const kept: any[] = [];
  const moved: any[] = [];

  for (const card of hand) {
    if (cardMatchesType(card, cardType)) moved.push(card);
    else kept.push(card);
  }

  if (moved.length === 0) return { state, log: [], movedPermanentIds: [] };

  const newPermanents = createBattlefieldPermanentsFromCards(
    moved,
    sourcePlayerId,
    controllerId,
    entersTapped,
    entersFaceDown,
    withCounters,
    'hand'
  );
  const updatedPlayers = state.players.map(p => (p.id === sourcePlayerId ? ({ ...(p as any), hand: kept } as any) : p));
  return {
    state: addBattlefieldPermanentsToState({ ...state, players: updatedPlayers as any } as any, newPermanents),
    log: [`${controllerId} puts ${moved.length} card(s) from ${sourcePlayerId}'s hand onto the battlefield`],
    movedPermanentIds: newPermanents.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean),
  };
}
