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
  | 'noncreature_nonland_permanent'
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
  | 'nonlegendary_permanent'
  | 'equipment'
  | 'noncreature';

/** Map shorthand owner zones ("an opponent's graveyard") to bound-target phrasing the parsers already understand. */
export function normalizeBoundPlayerZoneSelectorText(text: string): string {
  return String(text || '')
    .replace(/\bfrom an opponent's (graveyard|hand|exile)\b/gi, "from target opponent's $1")
    .replace(/\bfrom a player's (graveyard|hand|exile)\b/gi, "from target player's $1")
    .replace(/\b(?:the )?defending player'?s (graveyard|hand|exile)\b/gi, "from target opponent's $1")
    .replace(/\bfrom their (graveyard|hand|exile)\b/gi, "from target opponent's $1")
    .replace(/\bof their library\b/gi, "of target opponent's library");
}

export type MoveZoneSingleTargetCriteria = {
  readonly cardType: SimpleCardType;
  readonly manaValueLte?: number;
  readonly manaValueAnyOf?: readonly number[];
  readonly manaValueLtReferencePower?: boolean;
  readonly manaValueLteReferencePower?: boolean;
  readonly milledThisTurn?: boolean;
  readonly hasXManaCost?: boolean;
  readonly powerLte?: number;
  readonly notNamed?: string;
  readonly requiresHistoric?: boolean;
  readonly creatureTypesAnyOf?: readonly string[];
  readonly typeLineTermsAnyOf?: readonly string[];
  readonly typeLineTermsNoneOf?: readonly string[];
  readonly colorsAllOf?: readonly string[];
  readonly colorsAnyOf?: readonly string[];
  readonly noAbilities?: boolean;
  readonly requiredCounter?: string;
  readonly putIntoGraveyardThisTurn?: boolean;
  readonly manaValueParity?: 'even' | 'odd';
  readonly manaValueLteReferenceDamage?: boolean;
  readonly manaValueLteReferenceManaValue?: boolean;
  readonly manaValueLteLandsControlled?: boolean;
  readonly powerLtReference?: boolean;
  readonly usesChosenCreatureType?: boolean;
  readonly requiresCyclingAbility?: boolean;
  readonly requiresKickerAbility?: boolean;
  readonly requiresAwaken?: boolean;
  readonly requiresNonbattle?: boolean;
  readonly manaValueLtReferenceManaValue?: boolean;
  readonly requiredNamed?: string;
  readonly excludePutIntoGraveyardThisTurn?: boolean;
  readonly manaValueGte?: number;
  readonly isColorless?: boolean;
  readonly manaValueEqReferenceChargeCounters?: boolean;
  readonly timeCountersEqualManaValue?: boolean;
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

function cardHasAnyColors(card: any, requiredColors: readonly string[]): boolean {
  const colors = collectCardColors(card);
  return requiredColors.some(color => colors.includes(color));
}

function getCardPower(card: any): number | null {
  const raw = (card as any)?.power ?? (card as any)?.card?.power;
  if (raw === undefined || raw === null || raw === '*') return null;
  const parsed = Number.parseInt(String(raw), 10);
  return Number.isFinite(parsed) ? parsed : null;
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
  if (lower === 'noncreature, nonland permanent' || lower === 'noncreature nonland permanent') {
    return 'noncreature_nonland_permanent';
  }
  if (lower === 'artifact or creature') return 'artifact_or_creature';
  if (lower === 'artifact or enchantment') return 'artifact_or_enchantment';
  if (lower === 'creature or land') return 'creature_or_land';
  if (lower === 'creature or planeswalker') return 'creature_or_planeswalker';
  if (lower === 'noncreature, nonland' || lower === 'noncreature nonland') {
    return 'noncreature_nonland_permanent';
  }
  if (lower === 'instant or sorcery' || lower === 'instant and/or sorcery') return 'instant_or_sorcery';
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
  if (/\bequipment(s)?\b/i.test(lower)) return 'equipment';
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
  if (type === 'noncreature') return !typeLine.includes('creature');
  if (type === 'noncreature_nonland_permanent') {
    return cardRepresentsPermanent(card) && !typeLine.includes('creature') && !typeLine.includes('land');
  }
  if (type === 'aura') return typeLine.includes('aura');
  if (type === 'equipment') return typeLine.includes('equipment');
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

  const typePart = String(numericConstraintMatch[1] || '').trim();
  const parsedCardType =
    !typePart || /^cards?$/i.test(typePart) ? ('any' as const) : parseSimpleCardTypeFromText(typePart);
  const manaValueLte = Number.parseInt(String(numericConstraintMatch[2] || ''), 10);
  if (!parsedCardType || !Number.isFinite(manaValueLte)) return null;

  return { cardType: parsedCardType, manaValueLte };
}

function parseStaticManaValueGteConstraint(typeText: string): MoveZoneSingleTargetCriteria | null {
  const normalized = String(typeText || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;

  const numericConstraintMatch =
    normalized.match(/^(.+?)(?:\s+cards?)?\s+with\s+mana\s+value\s+(\d+)\s+or\s+greater$/i) ||
    normalized.match(/^card\s+with\s+mana\s+value\s+(\d+)\s+or\s+greater$/i);
  if (!numericConstraintMatch) return null;

  const typePart = String(numericConstraintMatch[1] || '').trim();
  const parsedCardType = typePart ? parseSimpleCardTypeFromText(typePart) : null;
  const manaValueGte = Number.parseInt(String(numericConstraintMatch[2] || ''), 10);
  if (!Number.isFinite(manaValueGte)) return null;

  return { cardType: parsedCardType || 'any', manaValueGte };
}

function parseStaticPowerLteConstraint(typeText: string): MoveZoneSingleTargetCriteria | null {
  const normalized = String(typeText || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;

  const numericConstraintMatch =
    normalized.match(/^(.+?)(?:\s+cards?)?\s+with\s+power\s+(\d+)\s+or\s+less$/i) ||
    normalized.match(/^(.+?)\s+with\s+power\s+(\d+)\s+or\s+less$/i);
  if (!numericConstraintMatch) return null;

  const parsedCardType = parseSimpleCardTypeFromText(String(numericConstraintMatch[1] || '').trim());
  const powerLte = Number.parseInt(String(numericConstraintMatch[2] || ''), 10);
  if (!parsedCardType || !Number.isFinite(powerLte)) return null;

  return { cardType: parsedCardType, powerLte };
}

function parseMoveZoneSingleTargetCriteria(typeText: string): MoveZoneSingleTargetCriteria | null {
  const normalized = String(typeText || '')
    .replace(/,\s*where\s+x\s+is\b.*$/i, '')
    .trim();
  if (!normalized) return null;

  const constrained = parseStaticManaValueLteConstraint(normalized);
  if (constrained) return constrained;

  const gteConstrained = parseStaticManaValueGteConstraint(normalized);
  if (gteConstrained) return gteConstrained;

  const powerConstrained = parseStaticPowerLteConstraint(normalized);
  if (powerConstrained) return powerConstrained;

  if (/^nonland permanent card with mana value x or less$/i.test(normalized)) {
    return { cardType: 'permanent', typeLineTermsNoneOf: ['creature', 'land'], manaValueLte: -1 };
  }
  if (/^noncreature, nonland permanent card with mana value x or less$/i.test(normalized)) {
    return {
      cardType: 'permanent',
      typeLineTermsNoneOf: ['creature', 'land'],
      manaValueLte: -1,
    };
  }

  let normalizedTypeText = normalized;
  let manaValueLtReferencePower = false;
  let manaValueLteReferencePower = false;
  let manaValueLtReferenceManaValue = false;
  const lesserManaValueMatch = normalizedTypeText.match(/^(.+?)\s+with\s+lesser\s+mana\s+value(?:\s+than\s+that\s+card|\s+than\s+the\s+creature\s+that\s+died)?$/i);
  if (lesserManaValueMatch) {
    normalizedTypeText = String(lesserManaValueMatch[1] || '').trim();
    manaValueLtReferenceManaValue = true;
  }
  const dynamicPowerLteConstraintMatch = normalizedTypeText.match(
    /^(.+?)\s+with\s+mana\s+value\s+less\s+than\s+or\s+equal\s+to\s+(?:this|that)\s+(?:permanent|creature)'s\s+power$/i
  );
  if (dynamicPowerLteConstraintMatch) {
    normalizedTypeText = String(dynamicPowerLteConstraintMatch[1] || '').trim();
    manaValueLteReferencePower = true;
  } else {
    const dynamicPowerConstraintMatch = normalizedTypeText.match(
      /^(.+?)\s+with\s+mana\s+value\s+less\s+than\s+(?:this|that)\s+(?:permanent|creature)'s\s+power$/i
    );
    if (dynamicPowerConstraintMatch) {
      normalizedTypeText = String(dynamicPowerConstraintMatch[1] || '').trim();
      manaValueLtReferencePower = true;
    }
  }

  const notNamedMatch = normalizedTypeText.match(/^(.+?)\s+not named\s+(.+)$/i);
  const nameExclusion = notNamedMatch ? String(notNamedMatch[2] || '').trim() : undefined;
  const baseTypeText = notNamedMatch ? String(notNamedMatch[1] || '').trim() : normalizedTypeText;

  normalizedTypeText = baseTypeText.replace(/\s+cards?$/i, '').trim();
  if (/^cards?$/i.test(normalizedTypeText)) return { cardType: 'any' };

  const soloColorMatch = normalizedTypeText.match(/^(white|blue|black|red|green)$/i);
  if (soloColorMatch) {
    const color = normalizeCardColor(String(soloColorMatch[1] || ''));
    if (color) {
      return {
        cardType: 'any',
        colorsAllOf: [color],
        ...(nameExclusion ? { notNamed: nameExclusion } : {}),
      };
    }
  }

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
  let requiredAnyColors: string[] = [];
  const colorOrMatch = normalizedTypeText.match(
    /^((?:white|blue|black|red|green)(?:\s+or\s+(?:white|blue|black|red|green))+)\s+(.+)$/i
  );
  if (colorOrMatch) {
    requiredAnyColors = String(colorOrMatch[1] || '')
      .split(/\s+or\s+/i)
      .map(color => normalizeCardColor(color))
      .filter((color): color is string => Boolean(color));
    normalizedTypeText = String(colorOrMatch[2] || '').trim();
  } else {
    const colorQualifiedMatch = normalizedTypeText.match(/^(white|blue|black|red|green)\s+(.+)$/i);
    if (colorQualifiedMatch) {
      const color = normalizeCardColor(String(colorQualifiedMatch[1] || ''));
      normalizedTypeText = String(colorQualifiedMatch[2] || '').trim();
      if (color) requiredColors = [color];
    }
  }

  const nonHistoricMatch = normalizedTypeText.match(/^non-?([a-z-]+)\s+historic$/i);
  if (nonHistoricMatch) {
    return {
      cardType: 'any',
      requiresHistoric: true,
      typeLineTermsNoneOf: [String(nonHistoricMatch[1] || '').trim().toLowerCase()],
      ...(requiredColors.length > 0 ? { colorsAllOf: requiredColors } : {}),
      ...(requiredAnyColors.length > 0 ? { colorsAnyOf: requiredAnyColors } : {}),
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
      ...(requiredAnyColors.length > 0 ? { colorsAnyOf: requiredAnyColors } : {}),
      ...(noAbilities ? { noAbilities: true } : {}),
      ...(requiredCounter ? { requiredCounter } : {}),
      ...(nameExclusion ? { notNamed: nameExclusion } : {}),
    };
  }

  const sharedCriteriaExtras = {
    ...(requiredColors.length > 0 ? { colorsAllOf: requiredColors } : {}),
    ...(requiredAnyColors.length > 0 ? { colorsAnyOf: requiredAnyColors } : {}),
    ...(noAbilities ? { noAbilities: true } : {}),
    ...(requiredCounter ? { requiredCounter } : {}),
    ...(nameExclusion ? { notNamed: nameExclusion } : {}),
    ...(manaValueLtReferencePower ? { manaValueLtReferencePower: true } : {}),
    ...(manaValueLteReferencePower ? { manaValueLteReferencePower: true } : {}),
    ...(manaValueLtReferenceManaValue ? { manaValueLtReferenceManaValue: true } : {}),
  };

  if (/^(?:card|permanent card) of the chosen type$/i.test(normalizedTypeText)) {
    return { cardType: 'any', usesChosenCreatureType: true, ...sharedCriteriaExtras };
  }

  if (/^(?:card|permanent card) with a cycling ability$/i.test(normalizedTypeText)) {
    return { cardType: 'permanent', requiresCyclingAbility: true, ...sharedCriteriaExtras };
  }

  if (/^(?:card|permanent card) with a kicker ability$/i.test(normalizedTypeText)) {
    return { cardType: 'any', requiresKickerAbility: true, ...sharedCriteriaExtras };
  }

  if (/^noncreature(?: card)?$/i.test(normalizedTypeText)) {
    return { cardType: 'noncreature', ...sharedCriteriaExtras };
  }

  if (/^outlaw(?: card)?$/i.test(normalizedTypeText)) {
    return { cardType: 'any', typeLineTermsAnyOf: ['outlaw'], ...sharedCriteriaExtras };
  }

  if (/^(?:land card|card|permanent card) with awaken(?:\s+\d+)?$/i.test(normalizedTypeText)) {
    return { cardType: 'any', requiresAwaken: true, ...sharedCriteriaExtras };
  }

  if (/^nonbattle permanent(?: card)?$/i.test(normalizedTypeText)) {
    return { cardType: 'permanent', requiresNonbattle: true, ...sharedCriteriaExtras };
  }

  if (/^spirit permanent(?: card)?$/i.test(normalizedTypeText)) {
    return {
      cardType: 'permanent',
      typeLineTermsAnyOf: ['spirit'],
      ...sharedCriteriaExtras,
    };
  }

  if (/^card named this permanent$/i.test(normalizedTypeText)) {
    return { cardType: 'any', requiredNamed: 'this permanent', ...sharedCriteriaExtras };
  }

  const subtypeCardMatch = normalizedTypeText.match(/^([a-z][a-z'-]+) card$/i);
  if (subtypeCardMatch) {
    const subtype = String(subtypeCardMatch[1] || '').trim().toLowerCase();
    if (subtype && !['creature', 'artifact', 'enchantment', 'instant', 'sorcery', 'land', 'planeswalker', 'battle'].includes(subtype)) {
      return {
        cardType: 'any',
        typeLineTermsAnyOf: [subtype],
        ...sharedCriteriaExtras,
      };
    }
  }

  if (
    /^[a-z][a-z'-]+$/i.test(normalizedTypeText) &&
    !parseSimpleCardTypeFromText(normalizedTypeText) &&
    !normalizeCreatureTypeCriteriaTerm(normalizedTypeText)
  ) {
    return {
      cardType: 'any',
      typeLineTermsAnyOf: [normalizedTypeText.toLowerCase()],
      ...sharedCriteriaExtras,
    };
  }

  if (/^saga card(?: with mana value x)?$/i.test(normalizedTypeText)) {
    return {
      cardType: 'any',
      typeLineTermsAnyOf: ['saga'],
      ...(normalizedTypeText.includes('x') ? { manaValueLte: -1 } : {}),
      ...sharedCriteriaExtras,
    };
  }

  if (/^dragon permanent(?: card)?$/i.test(normalizedTypeText)) {
    return { cardType: 'any', typeLineTermsAnyOf: ['dragon'], ...sharedCriteriaExtras };
  }

  if (/^noncreature, nonland permanent card(?: with mana value x or less)?$/i.test(normalizedTypeText)) {
    return {
      cardType: 'permanent',
      typeLineTermsNoneOf: ['creature', 'land'],
      ...(normalizedTypeText.includes('x') ? { manaValueLte: -1 } : {}),
      ...sharedCriteriaExtras,
    };
  }

  const parsedCardType = parseSimpleCardTypeFromText(normalizedTypeText);
  if (parsedCardType) {
    return {
      cardType: parsedCardType,
      ...(requiredColors.length > 0 ? { colorsAllOf: requiredColors } : {}),
      ...(requiredAnyColors.length > 0 ? { colorsAnyOf: requiredAnyColors } : {}),
      ...(noAbilities ? { noAbilities: true } : {}),
      ...(requiredCounter ? { requiredCounter } : {}),
      ...(nameExclusion ? { notNamed: nameExclusion } : {}),
      ...(manaValueLtReferencePower ? { manaValueLtReferencePower: true } : {}),
      ...(manaValueLteReferencePower ? { manaValueLteReferencePower: true } : {}),
    };
  }

  const splitTerms = splitTypeCriteriaList(normalizedTypeText);
  if (splitTerms.length > 0) {
    const negatedTypeTerms = splitTerms
      .map(term => normalizeTypeCriteriaTerm(term))
      .map(term => {
        const match = term.match(/^non-?([a-z]+)$/i);
        return match ? String(match[1] || '').trim().toLowerCase() : null;
      });
    if (negatedTypeTerms.every((term): term is string => Boolean(term))) {
      return {
        cardType: 'any',
        typeLineTermsNoneOf: negatedTypeTerms,
        ...(requiredColors.length > 0 ? { colorsAllOf: requiredColors } : {}),
        ...(requiredAnyColors.length > 0 ? { colorsAnyOf: requiredAnyColors } : {}),
        ...(noAbilities ? { noAbilities: true } : {}),
        ...(requiredCounter ? { requiredCounter } : {}),
        ...(nameExclusion ? { notNamed: nameExclusion } : {}),
        ...(manaValueLtReferencePower ? { manaValueLtReferencePower: true } : {}),
      };
    }

    const creatureTypes = splitTerms
      .map(term => normalizeCreatureTypeCriteriaTerm(term))
      .filter((term): term is string => Boolean(term));
    if (creatureTypes.length === splitTerms.length) {
      return {
        cardType: 'any',
        creatureTypesAnyOf: creatureTypes,
        ...(requiredColors.length > 0 ? { colorsAllOf: requiredColors } : {}),
        ...(requiredAnyColors.length > 0 ? { colorsAnyOf: requiredAnyColors } : {}),
        ...(noAbilities ? { noAbilities: true } : {}),
        ...(requiredCounter ? { requiredCounter } : {}),
        ...(nameExclusion ? { notNamed: nameExclusion } : {}),
        ...(manaValueLtReferencePower ? { manaValueLtReferencePower: true } : {}),
        ...(manaValueLteReferencePower ? { manaValueLteReferencePower: true } : {}),
      };
    }

    return {
      cardType: 'any',
      typeLineTermsAnyOf: splitTerms.map(term => normalizeTypeCriteriaTerm(term)),
      ...(requiredColors.length > 0 ? { colorsAllOf: requiredColors } : {}),
      ...(requiredAnyColors.length > 0 ? { colorsAnyOf: requiredAnyColors } : {}),
      ...(noAbilities ? { noAbilities: true } : {}),
      ...(requiredCounter ? { requiredCounter } : {}),
      ...(nameExclusion ? { notNamed: nameExclusion } : {}),
      ...(manaValueLtReferencePower ? { manaValueLtReferencePower: true } : {}),
      ...(manaValueLteReferencePower ? { manaValueLteReferencePower: true } : {}),
      ...(manaValueLtReferenceManaValue ? { manaValueLtReferenceManaValue: true } : {}),
    };
  }

  const singleCreatureType = normalizeCreatureTypeCriteriaTerm(normalizedTypeText);
  if (singleCreatureType) {
    return {
      cardType: 'any',
      creatureTypesAnyOf: [singleCreatureType],
      ...(requiredColors.length > 0 ? { colorsAllOf: requiredColors } : {}),
      ...(requiredAnyColors.length > 0 ? { colorsAnyOf: requiredAnyColors } : {}),
      ...(noAbilities ? { noAbilities: true } : {}),
      ...(requiredCounter ? { requiredCounter } : {}),
      ...(nameExclusion ? { notNamed: nameExclusion } : {}),
      ...(manaValueLtReferencePower ? { manaValueLtReferencePower: true } : {}),
      ...(manaValueLteReferencePower ? { manaValueLteReferencePower: true } : {}),
      ...(manaValueLtReferenceManaValue ? { manaValueLtReferenceManaValue: true } : {}),
    };
  }

  if (manaValueLteReferencePower) return { cardType: 'any', manaValueLteReferencePower: true };
  if (manaValueLtReferenceManaValue) return { cardType: 'any', manaValueLtReferenceManaValue: true };
  return manaValueLtReferencePower ? { cardType: 'any', manaValueLtReferencePower: true } : null;
}

function stripPutIntoGraveyardThisTurnQualifier(raw: string): {
  readonly selectorText: string;
  readonly putIntoGraveyardThisTurn: boolean;
} {
  const cleaned = String(raw || '').replace(/[.\s]+$/g, '').trim();
  const selectorText = cleaned
    .replace(/\s+that\s+was\s+put\s+there(?:\s+from\s+(?:anywhere|the\s+battlefield))?\s+this\s+turn$/i, '')
    .trim();
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
  currentTurn?: number,
  referencePower?: number,
  referenceManaValue?: number
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

  if (criteria.colorsAnyOf && criteria.colorsAnyOf.length > 0) {
    if (!cardHasAnyColors(card, criteria.colorsAnyOf)) return false;
  }

  if (criteria.powerLte !== undefined) {
    const power = getCardPower(card);
    if (power === null || power > criteria.powerLte) return false;
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

  if (criteria.putIntoGraveyardThisTurn) {
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

  if (criteria.requiresAwaken && !cardHasAwakenAbility(card)) return false;

  if (criteria.requiresNonbattle) {
    const typeLine = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
    if (typeLine.includes('battle') || !cardRepresentsPermanent(card)) return false;
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
  | MoveZoneSingleTargetCriteria
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw
    .replace(/[.\s]+$/g, '')
    .replace(/\s+until\s+this\b.*$/i, '')
    .trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (!/\bfrom your graveyard\b/i.test(lower)) return null;
  if (/^all\s+instant\s+and\s+sorcery\s+cards?\s+from\s+your\s+graveyard$/i.test(lower)) {
    return { cardType: 'instant_or_sorcery' };
  }

  const withoutNumericOrLess = lower
    .replace(/\binstant\s+and\s+sorcery\b/g, 'instant or sorcery')
    .replace(/\bmana value \d+ or less\b/g, '')
    .replace(/\bpower \d+ or less\b/g, '');
  if (/\b(and|or)\b/i.test(withoutNumericOrLess)) return null;

  const fromGyMatch = cleaned.match(/^all\s+(.+)\s+from\s+your\s+graveyard$/i);
  if (!fromGyMatch) return null;

  const descriptor = String(fromGyMatch[1] || '')
    .trim()
    .replace(/[.\s]+$/g, '');
  if (!descriptor) return null;
  if (/^cards?$/i.test(descriptor)) return { cardType: 'any' };

  const parsedCriteria =
    parseMoveZoneSingleTargetCriteria(descriptor) ||
    parseMoveZoneSingleTargetCriteria(descriptor.replace(/\s+cards?$/i, '')) ||
    parseMoveZoneSingleTargetCriteria(`${descriptor.replace(/\s+cards?$/i, '')} cards`);
  if (parsedCriteria) return parsedCriteria;

  const typeText = descriptor.replace(/\s+cards?$/i, '').trim();
  const creatureSubtype = parseCreatureSubtypeWord(typeText);
  if (creatureSubtype) {
    return { cardType: 'creature', creatureTypesAnyOf: [creatureSubtype] };
  }
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

function stripMoveZoneSelectorPrefix(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/^[\u2022•]\s+/, '')
    .replace(/^[a-z0-9][a-z0-9\s'.,/&-]{0,40}\s+-\s+/i, '')
    .replace(/^repair\s+-\s+/i, '')
    .trim();
}

export function parseMoveZoneShuffleAllFromYourGraveyardIntoLibrary(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: SimpleCardType } | boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || (what as any).raw || '')
    .trim()
    .toLowerCase()
    .replace(/[.\s]+$/g, '');
  const typedMatch = raw.match(
    /^(?:then\s+)?shuffle\s+all\s+(.+?)\s+cards?\s+from\s+your\s+graveyard\s+into\s+your\s+library$/
  );
  if (typedMatch) {
    const parsed = parseSimpleCardTypeFromText(String(typedMatch[1] || '').trim());
    if (parsed) return { cardType: parsed };
  }
  if (
    raw === 'all cards from your graveyard into your library' ||
    raw === 'shuffle all cards from your graveyard into your library' ||
    /^then shuffle all cards from your graveyard into your library$/.test(raw)
  ) {
    return true;
  }
  return false;
}

export function shufflePlayerGraveyardIntoLibrary(state: GameState, playerId: PlayerID): GameState {
  return shuffleTypedCardsFromPlayerGraveyardIntoLibrary(state, playerId, 'any');
}

export function shuffleTypedCardsFromPlayerGraveyardIntoLibrary(
  state: GameState,
  playerId: PlayerID,
  cardType: SimpleCardType
): GameState {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return state;
  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  if (graveyard.length === 0) return state;
  const toShuffle: any[] = [];
  const kept: any[] = [];
  for (const card of graveyard) {
    if (cardMatchesType(card, cardType)) toShuffle.push(card);
    else kept.push(card);
  }
  if (toShuffle.length === 0) return state;
  for (let i = toShuffle.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [toShuffle[i], toShuffle[j]] = [toShuffle[j], toShuffle[i]];
  }
  const library = Array.isArray(player.library) ? [...player.library] : [];
  return {
    ...state,
    players: state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), graveyard: kept, library: [...library, ...toShuffle] } as any) : p
    ),
  } as GameState;
}

export function parseMoveZoneAllFromTargetPlayersGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | { readonly cardType: SimpleCardType }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim());
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
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim());
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
  const candidates = [
    String((what as any).text || '').trim(),
    String((what as any).raw || '').trim(),
  ].filter(Boolean);

  for (let raw of candidates) {
    raw = stripMoveZoneSelectorPrefix(raw);
    const embedded = raw.match(
      /(?:you\s+may\s+)?return\s+((?:up to one\s+)?(?:(?:other|another)\s+)?target\s+.+?\s+from\s+your\s+graveyard)(?:\s+to\s+.+)?$/i
    );
    if (embedded) {
      raw = String(embedded[1] || '').trim();
    }

    const withTurn = stripPutIntoGraveyardThisTurnQualifier(raw);
    const withCounter = parseTrailingZoneCounterRequirement(withTurn.selectorText, 'from your graveyard');
    const cleaned = withCounter.selectorText;
    const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

    if (!/^(?:up to one\s+)?(?:(?:other|another)\s+)?target\s+/i.test(lower)) continue;
    if (!/\bfrom your graveyard\b/i.test(lower)) continue;

    if (/^(?:up to one\s+)?(?:(?:other|another)\s+)?target\s+cards?\s+from\s+your\s+graveyard$/i.test(lower)) {
      return { cardType: 'any' };
    }

    const m = cleaned.match(/^(?:up to one\s+)?(?:(?:other|another)\s+)?target\s+(.+?)\s+from\s+your\s+graveyard$/i);
    if (!m) continue;

    const typeText = String(m[1] || '')
      .trim()
      .replace(/,\s*where\s+x\s+is\b.*$/i, '');
    if (!typeText) continue;
    const parsed = parseMoveZoneSingleTargetCriteria(typeText);
    if (!parsed) continue;
    return {
      ...parsed,
      ...(withCounter.requiredCounter ? { requiredCounter: withCounter.requiredCounter } : {}),
      ...(withTurn.putIntoGraveyardThisTurn ? { putIntoGraveyardThisTurn: true } : {}),
    };
  }
  return null;
}

export function parseMoveZoneRandomSingleFromYourGraveyard(
  what: { readonly kind: string; readonly text?: string; readonly raw?: string },
  rawStep?: string
):
  | MoveZoneSingleTargetCriteria
  | { readonly count: number; readonly criteria: MoveZoneSingleTargetCriteria }
  | null {
  if (what.kind !== 'raw') return null;
  const candidates = [
    String((what as any).text || '').trim(),
    String((what as any).raw || '').trim(),
    String(rawStep || '').trim(),
  ].filter(Boolean);
  for (const raw of candidates) {
    const cleaned = raw.replace(/[.\s]+$/g, '').trim();
    const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

    if (!/\bat random\b/i.test(lower) || !/\bfrom your graveyard\b/i.test(lower)) continue;

    const countMatch = cleaned.match(/^([a-z0-9]+)\s+(.+?)\s+at random from your graveyard$/i);
    if (countMatch) {
      const count = parseSmallNumberWord(String(countMatch[1] || '').trim());
      const typeText = String(countMatch[2] || '').trim();
      const criteria = parseMoveZoneSingleTargetCriteria(typeText);
      if (count && count >= 1 && criteria) return { count, criteria };
      continue;
    }

    let match = cleaned.match(/^(?:exile\s+)?(?:a|an|one)\s+(.+?)\s+at random from your graveyard$/i);
    if (!match) {
      match = cleaned.match(/^(?:exile\s+)?(?:a|an|one)\s+(.+?)\s+card\s+from\s+your\s+graveyard\s+at\s+random$/i);
    }
    if (!match) {
      match = cleaned.match(/^(?:exile\s+)?(?:a|an|one)\s+(.+?)\s+from your graveyard at random$/i);
    }
    if (!match) continue;

    const typeText = String(match[1] || '').trim();
    if (!typeText) continue;
    const parsed = parseMoveZoneSingleTargetCriteria(typeText);
    if (parsed) return parsed;
  }
  return null;
}

export function parseMoveZoneTargetAndSameNamedFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | MoveZoneSingleTargetCriteria
  | null {
  if (what.kind !== 'raw') return null;
  const candidates = [
    String((what as any).text || '').trim(),
    String((what as any).raw || '').trim(),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const cleaned = stripMoveZoneSelectorPrefix(candidate).replace(/[.\s]+$/g, '').trim();
    const match =
      cleaned.match(
        /^(?:return\s+)?target\s+(.+?)\s+and\s+all\s+other\s+cards\s+with\s+the\s+same\s+name\s+as\s+that\s+card\s+from\s+your\s+graveyard$/i
      ) ||
      cleaned.match(
        /^(?:you\s+may\s+)?return\s+target\s+(.+?)\s+and\s+all\s+other\s+cards\s+with\s+the\s+same\s+name\s+as\s+that\s+card\s+from\s+your\s+graveyard(?:\s+to\s+.+)?$/i
      );
    if (!match) continue;

    const typeText = String(match[1] || '').trim();
    if (!typeText) continue;
    return parseMoveZoneSingleTargetCriteria(typeText);
  }
  return null;
}

export function selectRandomMatchingCardIdFromGraveyard(
  state: GameState,
  playerId: PlayerID,
  criteria: MoveZoneSingleTargetCriteria,
  referenceCardName?: string,
  referencePower?: number
):
  | { readonly kind: 'missing_player' }
  | { readonly kind: 'impossible' }
  | { readonly kind: 'selected'; readonly cardId: string } {
  const selection = selectRandomMatchingCardIdsFromGraveyard(
    state,
    playerId,
    criteria,
    1,
    referenceCardName,
    referencePower
  );
  if (selection.kind !== 'selected') return selection;
  const cardId = selection.cardIds[0];
  return cardId ? { kind: 'selected', cardId } : { kind: 'impossible' };
}

export function selectRandomMatchingCardIdsFromGraveyard(
  state: GameState,
  playerId: PlayerID,
  criteria: MoveZoneSingleTargetCriteria,
  count: number,
  referenceCardName?: string,
  referencePower?: number
):
  | { readonly kind: 'missing_player' }
  | { readonly kind: 'impossible' }
  | { readonly kind: 'selected'; readonly cardIds: readonly string[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { kind: 'missing_player' };

  const currentTurn = getCurrentTurnNumber(state);
  const graveyard = Array.isArray(player.graveyard) ? player.graveyard : [];
  const matches = graveyard.filter((card: any) =>
    cardMatchesMoveZoneSingleTargetCriteria(card, criteria, referenceCardName, currentTurn, referencePower)
  );
  if (matches.length < count) return { kind: 'impossible' };

  const pool = [...matches];
  const selectedIds: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const randomIndex = pool.length === 1 ? 0 : Math.floor(Math.random() * pool.length);
    const selected = pool.splice(randomIndex, 1)[0];
    const selectedId = String((selected as any)?.id || '').trim();
    if (!selectedId) return { kind: 'impossible' };
    selectedIds.push(selectedId);
  }
  return { kind: 'selected', cardIds: selectedIds };
}

export function parseMoveZoneSingleTargetFromTargetPlayersGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}):
  | MoveZoneSingleTargetCriteria
  | null {
  if (what.kind !== 'raw') return null;
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim());
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
  const candidates = [
    stripMoveZoneSelectorPrefix(String((what as any).text || '')),
    stripMoveZoneSelectorPrefix(String((what as any).raw || '')),
  ].filter(Boolean);

  for (const raw of candidates) {
    const withTurn = stripPutIntoGraveyardThisTurnQualifier(raw);
    const withCounter = parseTrailingZoneCounterRequirement(withTurn.selectorText, 'from a graveyard');
    const cleaned = withCounter.selectorText;
    const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

    if (!/^(?:up to one\s+)?(?:other\s+)?target\s+/i.test(lower)) continue;
    if (!/\bfrom a graveyard\b/i.test(lower)) continue;

    if (/^(?:up to one\s+)?(?:other\s+)?target\s+cards?\s+from\s+a\s+graveyard$/i.test(lower)) {
      return { cardType: 'any' };
    }

    const m = cleaned.match(/^(?:up to one\s+)?(?:other\s+)?target\s+(.+?)\s+from\s+a\s+graveyard$/i);
    if (!m) continue;

    const typeText = String(m[1] || '').trim();
    if (!typeText) continue;
    const parsed = parseMoveZoneSingleTargetCriteria(typeText);
    if (!parsed) continue;
    return {
      ...parsed,
      ...(withCounter.requiredCounter ? { requiredCounter: withCounter.requiredCounter } : {}),
      ...(withTurn.putIntoGraveyardThisTurn ? { putIntoGraveyardThisTurn: true } : {}),
    };
  }
  return null;
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

function selectUpToMatchingFromGraveyardWithCriteria(
  state: GameState,
  playerId: PlayerID,
  maxCount: number,
  criteria: MoveZoneSingleTargetCriteria,
  preferredIds: readonly string[] = [],
  excludeIds: readonly string[] = [],
  referenceCardName?: string,
  referencePower?: number
): ExactGraveyardSelection {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { kind: 'missing_player' };

  const preferred = new Set(preferredIds.map(id => String(id || '').trim()).filter(Boolean));
  const excluded = new Set(excludeIds.map(id => String(id || '').trim()).filter(Boolean));
  const currentTurn = getCurrentTurnNumber(state);
  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];

  const matches = graveyard.filter((card: any) => {
    const cardId = String(card?.id || '').trim();
    if (!cardId || excluded.has(cardId)) return false;
    if (!cardMatchesMoveZoneSingleTargetCriteria(card, criteria, referenceCardName, currentTurn, referencePower)) {
      return false;
    }
    if (preferred.size > 0 && !preferred.has(cardId)) return false;
    return true;
  });

  if (matches.length === 0 && preferred.size > 0) {
    const relaxed = graveyard.filter((card: any) => {
      const cardId = String(card?.id || '').trim();
      if (!cardId || excluded.has(cardId)) return false;
      return cardMatchesMoveZoneSingleTargetCriteria(card, criteria, referenceCardName, currentTurn, referencePower);
    });
    if (relaxed.length === 0) return { kind: 'impossible', available: 0 };
    if (relaxed.length > maxCount) return { kind: 'player_choice_required', available: relaxed.length };
    const movedIds = new Set(relaxed.map((card: any) => String(card?.id || '').trim()).filter(Boolean));
    return {
      kind: 'deterministic',
      kept: graveyard.filter((card: any) => !movedIds.has(String(card?.id || '').trim())),
      moved: relaxed,
    };
  }

  if (matches.length === 0) return { kind: 'impossible', available: 0 };
  if (matches.length > maxCount) return { kind: 'player_choice_required', available: matches.length };

  const movedIds = new Set(matches.map((card: any) => String(card?.id || '').trim()).filter(Boolean));
  return {
    kind: 'deterministic',
    kept: graveyard.filter((card: any) => !movedIds.has(String(card?.id || '').trim())),
    moved: matches,
  };
}

export function returnUpToMatchingFromGraveyardToHand(
  state: GameState,
  playerId: PlayerID,
  maxCount: number,
  criteria: MoveZoneSingleTargetCriteria,
  preferredIds: readonly string[] = [],
  excludeIds: readonly string[] = []
):
  | { readonly kind: 'applied'; readonly state: GameState; readonly log: readonly string[] }
  | { readonly kind: 'impossible'; readonly available: number }
  | { readonly kind: 'player_choice_required'; readonly available: number } {
  const selection = selectUpToMatchingFromGraveyardWithCriteria(
    state,
    playerId,
    maxCount,
    criteria,
    preferredIds,
    excludeIds
  );
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

export function shuffleUpToMatchingFromGraveyardIntoLibrary(
  state: GameState,
  playerId: PlayerID,
  maxCount: number,
  criteria: MoveZoneSingleTargetCriteria,
  preferredIds: readonly string[] = [],
  excludeIds: readonly string[] = []
):
  | { readonly kind: 'applied'; readonly state: GameState; readonly log: readonly string[] }
  | { readonly kind: 'impossible'; readonly available: number }
  | { readonly kind: 'player_choice_required'; readonly available: number } {
  const selection = selectUpToMatchingFromGraveyardWithCriteria(
    state,
    playerId,
    maxCount,
    criteria,
    preferredIds,
    excludeIds
  );
  if (selection.kind === 'missing_player') return { kind: 'applied', state, log: [] };
  if (selection.kind === 'impossible' || selection.kind === 'player_choice_required') return selection;

  const player = state.players.find(p => p.id === playerId) as any;
  const library = Array.isArray(player?.library) ? [...player.library] : [];
  const updatedPlayers = state.players.map(p =>
    p.id === playerId
      ? ({ ...(p as any), graveyard: [...selection.kept], library: [...library, ...selection.moved] } as any)
      : p
  );
  return {
    kind: 'applied',
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} shuffles ${selection.moved.length} card(s) from graveyard into library`],
  };
}

export function putUpToMatchingFromGraveyardOntoBattlefieldWithController(
  state: GameState,
  sourcePlayerId: PlayerID,
  controllerId: PlayerID,
  maxCount: number,
  criteria: MoveZoneSingleTargetCriteria,
  entersTapped?: boolean,
  entersFaceDown?: boolean,
  withCounters?: Record<string, number>,
  attachedToBattlefieldPermanentId?: string,
  preferredIds: readonly string[] = [],
  excludeIds: readonly string[] = []
):
  | { readonly kind: 'applied'; readonly state: GameState; readonly log: readonly string[]; readonly movedPermanentIds: readonly string[] }
  | { readonly kind: 'impossible'; readonly available: number }
  | { readonly kind: 'player_choice_required'; readonly available: number } {
  const selection = selectUpToMatchingFromGraveyardWithCriteria(
    state,
    sourcePlayerId,
    maxCount,
    criteria,
    preferredIds,
    excludeIds
  );
  if (selection.kind === 'missing_player') return { kind: 'applied', state, log: [], movedPermanentIds: [] };
  if (selection.kind === 'impossible' || selection.kind === 'player_choice_required') return selection;

  const attachmentTarget = attachedToBattlefieldPermanentId
    ? getBattlefieldAttachmentTarget(state, attachedToBattlefieldPermanentId)
    : undefined;
  if (
    attachedToBattlefieldPermanentId &&
    (!attachmentTarget || !selection.moved.every(card => canCardEnterAttachedToTarget(card, controllerId, attachmentTarget)))
  ) {
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
  battlefieldEntryOverrides?: BattlefieldEntryCardOverrides,
  referencePower?: number
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
  if (!cardMatchesMoveZoneSingleTargetCriteria(card, criteria, referenceCardName, getCurrentTurnNumber(state), referencePower)) {
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

export function moveTopCardFromLibrary(
  state: GameState,
  playerId: PlayerID,
  destination: 'hand' | 'graveyard' | 'exile' | 'battlefield' | 'library_top' | 'library_bottom',
  battlefieldControllerId?: PlayerID,
  entersTapped?: boolean,
  entersFaceDown?: boolean,
  withCounters?: Record<string, number>,
  attachedToBattlefieldPermanentId?: string,
  battlefieldEntryOverrides?: BattlefieldEntryCardOverrides,
  faceDownWardCost?: string
): {
  readonly kind: 'applied';
  readonly state: GameState;
  readonly log: readonly string[];
  readonly movedCards: readonly any[];
  readonly movedPermanentIds?: readonly string[];
} | { readonly kind: 'impossible' } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { kind: 'impossible' };

  const library = Array.isArray(player.library) ? [...player.library] : [];
  if (library.length <= 0) {
    return {
      kind: 'applied',
      state,
      log: [`${playerId} cannot move the top card of their library (empty library)`],
      movedCards: [],
    };
  }

  const [card, ...keptLibrary] = library;

  if (destination === 'hand') {
    const hand = Array.isArray(player.hand) ? [...player.hand, card] : [card];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), library: keptLibrary, hand } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} moves the top card of their library to their hand`],
      movedCards: [card],
    };
  }

  if (destination === 'graveyard') {
    const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId
        ? ({
            ...(p as any),
            library: keptLibrary,
            graveyard: [...graveyard, ...stampCardsPutIntoGraveyardThisTurn(state, [card])],
          } as any)
        : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} moves the top card of their library to their graveyard`],
      movedCards: [card],
    };
  }

  if (destination === 'exile') {
    const exile = Array.isArray(player.exile) ? [...player.exile, card] : [card];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), library: keptLibrary, exile } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [`${playerId} exiles the top card of their library`],
      movedCards: [card],
    };
  }

  if (destination === 'library_top' || destination === 'library_bottom') {
    const nextLibrary = destination === 'library_top' ? [card, ...keptLibrary] : [...keptLibrary, card];
    const updatedPlayers = state.players.map(p =>
      p.id === playerId ? ({ ...(p as any), library: nextLibrary } as any) : p
    );
    return {
      kind: 'applied',
      state: { ...state, players: updatedPlayers as any } as any,
      log: [
        `${playerId} puts the top card of their library on the ${destination === 'library_top' ? 'top' : 'bottom'} of their library`,
      ],
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
    'library',
    attachmentTarget,
    battlefieldEntryOverrides,
    faceDownWardCost
  );
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), library: keptLibrary } as any) : p
  );
  return {
    kind: 'applied',
    state: addBattlefieldPermanentsToState({ ...state, players: updatedPlayers as any } as any, newPermanent),
    log: [`${controllerId} puts the top card of ${playerId}'s library onto the battlefield`],
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
  battlefieldEntryOverrides?: BattlefieldEntryCardOverrides,
  referencePower?: number
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
        battlefieldEntryOverrides,
        referencePower
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

export function parseMoveZoneTypedCardFromYourHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();

  const lesserPowerMatch = cleaned.match(
    /^(?:a|an)\s+creature\s+card\s+with\s+lesser\s+power\s+from\s+your\s+hand$/i
  );
  if (lesserPowerMatch) return { cardType: 'creature', powerLtReference: true };

  const equalOrLesserMvMatch = cleaned.match(
    /^(?:a|an)\s+permanent\s+card\s+with\s+equal\s+or\s+lesser\s+mana\s+value\s+from\s+your\s+hand$/i
  );
  if (equalOrLesserMvMatch) return { cardType: 'permanent', manaValueLteReferenceManaValue: true };

  const landsControlledMvMatch = cleaned.match(
    /^(?:a|an)\s+permanent\s+card\s+with\s+mana\s+value\s+less\s+than\s+or\s+equal\s+to\s+the\s+number\s+of\s+lands\s+you\s+control\s+from\s+your\s+hand$/i
  );
  if (landsControlledMvMatch) return { cardType: 'permanent', manaValueLteLandsControlled: true };

  const creaturePowerMvMatch = cleaned.match(
    /^(?:a|an)\s+permanent\s+card\s+with\s+mana\s+value\s+less\s+than\s+or\s+equal\s+to\s+that\s+creature's\s+power\s+from\s+your\s+hand$/i
  );
  if (creaturePowerMvMatch) return { cardType: 'permanent', manaValueLteReferencePower: true };

  const artifactDamageMvMatch = cleaned.match(
    /^(?:a|an)\s+artifact\s+card\s+with\s+mana\s+value\s+less\s+than\s+or\s+equal\s+to\s+that\s+damage\s+from\s+your\s+hand$/i
  );
  if (artifactDamageMvMatch) return { cardType: 'artifact', manaValueLteReferenceDamage: true };

  const broodcallerMatch = cleaned.match(
    /^(?:a|an)\s+permanent\s+card\s+with\s+mana\s+value\s+less\s+than\s+or\s+equal\s+to\s+that\s+damage\s+from\s+your\s+hand$/i
  );
  if (broodcallerMatch) {
    return { cardType: 'permanent', manaValueLteReferenceDamage: true };
  }

  const timeCountersMatch = cleaned.match(
    /^(?:a|an)\s+card\s+from\s+your\s+hand\s+with\s+a\s+number\s+of\s+time\s+counters\s+on\s+it\s+equal\s+to\s+its\s+mana\s+value$/i
  );
  if (timeCountersMatch) return { cardType: 'any', timeCountersEqualManaValue: true };

  const colorlessGteMatch = cleaned.match(
    /^(?:a|an)\s+colorless\s+card\s+with\s+mana\s+value\s+(\d+)\s+or\s+greater\s+from\s+your\s+hand$/i
  );
  if (colorlessGteMatch) {
    const mv = Number.parseInt(String(colorlessGteMatch[1] || ''), 10);
    if (Number.isFinite(mv)) return { cardType: 'any', isColorless: true, manaValueGte: mv };
  }

  const nonartifactNonlandMatch = cleaned.match(/^(?:a|an)\s+nonartifact,?\s+nonland\s+card\s+from\s+your\s+hand$/i);
  if (nonartifactNonlandMatch) return { cardType: 'any', typeLineTermsNoneOf: ['artifact', 'land'] };

  const chargeCounterMvMatch = cleaned.match(
    /^(?:a|an)\s+creature\s+card\s+with\s+mana\s+value\s+equal\s+to\s+the\s+number\s+of\s+charge\s+counters\s+on\s+this\s+artifact\s+from\s+your\s+hand$/i
  );
  if (chargeCounterMvMatch) return { cardType: 'creature', manaValueEqReferenceChargeCounters: true };

  const constrainedMatch = cleaned.match(
    /^(?:a|an)\s+(.+?)\s+card\s+with\s+mana\s+value\s+([x\d]+)(?:\s+or\s+less)?\s+from\s+your\s+hand$/i
  );
  if (constrainedMatch) {
    const typeText = String(constrainedMatch[1] || '').trim();
    const parsed = parseSimpleCardTypeFromText(typeText);
    if (!parsed) return null;
    const mvToken = String(constrainedMatch[2] || '').trim().toLowerCase();
    if (mvToken === 'x') {
      return { cardType: parsed, manaValueLte: -1 };
    }
    const mv = Number.parseInt(mvToken, 10);
    if (!Number.isFinite(mv)) return null;
    return { cardType: parsed, manaValueLte: mv };
  }

  const match = cleaned.match(/^(?:a|an)\s+(.+?)\s+card\s+from\s+your\s+hand$/i);
  if (!match) return null;

  const typeText = String(match[1] || '').trim();
  const creatureSubtype = parseCreatureSubtypeWord(typeText);
  if (creatureSubtype) {
    return { cardType: 'creature', creatureTypesAnyOf: [creatureSubtype] };
  }
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneTheCardsFromYourHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw === 'the cards from your hand') return { cardType: 'any' };
  return null;
}

export function parseMoveZoneCardFromAGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw === 'a card from a graveyard') return { cardType: 'any' };
  const match = raw.match(/^(?:a|an)\s+(.+?)\s+card\s+from\s+a\s+graveyard$/);
  if (!match) return null;
  const parsed = parseSimpleCardTypeFromText(String(match[1] || '').trim());
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneCountFromYourHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly count: number } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');
  if (lower.startsWith('all ') || lower.startsWith('up to ') || lower.startsWith('target ')) return null;
  if (!/\bfrom your hand\b/i.test(lower)) return null;

  const match = cleaned.match(/^([a-z0-9]+)\s+cards?\s+from\s+your\s+hand$/i);
  if (!match) return null;

  const count = parseSmallNumberWord(String(match[1] || ''));
  if (count === null || count <= 0) return null;
  return { count };
}

export type MoveZoneUpToTargetCountSpec = {
  readonly maxCount: number;
  readonly criteria: MoveZoneSingleTargetCriteria;
  readonly useReferenceAmount?: boolean;
  readonly useXValue?: boolean;
};

export function parseMoveZoneUpToTargetCountFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneUpToTargetCountSpec | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const thatManyMatch = cleaned.match(/^up to that many target (.+?) from your graveyard$/i);
  if (thatManyMatch) {
    const typeText = String(thatManyMatch[1] || '').trim();
    if (!typeText) return null;
    const criteria = parseMoveZoneSingleTargetCriteria(typeText);
    if (!criteria) return null;
    return { maxCount: 0, criteria, useReferenceAmount: true };
  }

  const anyNumberTargetMatch = cleaned.match(/^any number of target (.+?) from your graveyard$/i);
  if (anyNumberTargetMatch) {
    const typeText = String(anyNumberTargetMatch[1] || '').trim();
    if (!typeText) return null;
    const criteria = parseMoveZoneSingleTargetCriteria(typeText);
    if (!criteria) return null;
    return { maxCount: 99, criteria };
  }

  const kickedInstantMatch = cleaned.match(
    /^up to x target instant cards from your graveyard(?:, where x is the number of times this permanent was kicked)?$/i
  );
  if (kickedInstantMatch) {
    return { maxCount: 0, criteria: { cardType: 'instant' }, useXValue: true };
  }

  const upToTypedMatch = cleaned.match(/^up to (\w+) (.+?) from your graveyard$/i);
  if (upToTypedMatch && !/^target\b/i.test(String(upToTypedMatch[2] || '').trim())) {
    const maxCount = parseSmallNumberWord(String(upToTypedMatch[1] || '').trim());
    const typeText = String(upToTypedMatch[2] || '').trim();
    if (!maxCount || maxCount < 1 || !typeText) return null;
    const criteria = parseMoveZoneSingleTargetCriteria(typeText);
    if (!criteria) return null;
    return { maxCount, criteria };
  }

  const match = cleaned.match(/^up to (\w+) target (.+?) from your graveyard$/i);
  if (!match) return null;

  const amountToken = String(match[1] || '').trim().toLowerCase();
  if (amountToken === 'that') {
    const typeText = String(match[2] || '').trim();
    if (!typeText) return null;
    const criteria = parseMoveZoneSingleTargetCriteria(typeText);
    if (!criteria) return null;
    return { maxCount: 0, criteria, useReferenceAmount: true };
  }
  if (amountToken === 'x') {
    const typeText = String(match[2] || '').trim();
    if (!typeText) return null;
    const criteria = parseMoveZoneSingleTargetCriteria(typeText);
    if (!criteria) return null;
    return { maxCount: 0, criteria, useXValue: true };
  }

  const maxCount = parseSmallNumberWord(amountToken);
  if (!maxCount || maxCount < 1) return null;

  const typeText = String(match[2] || '').trim();
  if (!typeText) return null;
  const criteria = parseMoveZoneSingleTargetCriteria(typeText);
  if (!criteria) return null;
  return { maxCount, criteria };
}

export function parseMoveZoneUpToTargetCountFromTargetPlayersGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneUpToTargetCountSpec | null {
  if (what.kind !== 'raw') return null;
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim());
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const match = cleaned.match(/^up to (\w+) target (.+?) from (?:target|that) (?:player|opponent)'s graveyard$/i);
  if (!match) return null;

  const maxCount = parseSmallNumberWord(String(match[1] || '').trim());
  if (!maxCount || maxCount < 1) return null;

  const typeText = String(match[2] || '').trim();
  if (!typeText) return null;
  const criteria = parseMoveZoneSingleTargetCriteria(typeText);
  if (!criteria) return null;
  return { maxCount, criteria };
}

export function parseMoveZoneAnotherCardFromAGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw === 'another card from a graveyard') return { cardType: 'any' };
  const match = raw.match(/^another\s+(.+?)\s+card\s+from\s+a\s+graveyard$/);
  if (!match) return null;
  const parsed = parseSimpleCardTypeFromText(String(match[1] || '').trim());
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneOrTypedCardsFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly criteria: readonly MoveZoneSingleTargetCriteria[] } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const match = cleaned.match(/^(?:a|an)\s+(.+?)\s+from\s+your\s+graveyard$/i);
  if (!match) return null;

  const typeClause = String(match[1] || '').trim();
  if (!/\bor\b/i.test(typeClause)) return null;

  const parts = typeClause.split(/\s+or\s+/i).map(part => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  const criteria: MoveZoneSingleTargetCriteria[] = [];
  for (const part of parts) {
    const normalized = part.replace(/^(?:a|an)\s+/i, '').replace(/\s+cards?$/i, '').trim();
    if (/^non-avatar creature$/i.test(normalized)) {
      criteria.push({ cardType: 'creature', typeLineTermsNoneOf: ['avatar'] });
      continue;
    }
    const parsed = parseMoveZoneSingleTargetCriteria(normalized) || (
      parseSimpleCardTypeFromText(normalized) ? { cardType: parseSimpleCardTypeFromText(normalized)! } : null
    );
    if (!parsed) return null;
    criteria.push(parsed);
  }

  return { criteria };
}

export function resolveFirstMatchingCardIdFromPlayerGraveyard(
  state: GameState,
  playerId: PlayerID,
  criteriaList: readonly MoveZoneSingleTargetCriteria[],
  preferredIds: readonly string[] = []
): string {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return '';

  const graveyard = Array.isArray(player.graveyard) ? player.graveyard : [];
  const preferred = new Set(preferredIds.map(id => String(id || '').trim()).filter(Boolean));
  const currentTurn = getCurrentTurnNumber(state);

  for (const criteria of criteriaList) {
    const matches = graveyard.filter((card: any) => {
      const cardId = String(card?.id || '').trim();
      if (!cardId || !cardMatchesMoveZoneSingleTargetCriteria(card, criteria, undefined, currentTurn)) return false;
      if (preferred.size > 0 && !preferred.has(cardId)) return false;
      return true;
    });
    if (matches.length === 1) return String((matches[0] as any)?.id || '').trim();
    if (matches.length > 1 && preferred.size > 0) {
      for (const wantedId of preferredIds) {
        if (matches.some((card: any) => String(card?.id || '').trim() === wantedId)) return wantedId;
      }
    }
  }

  if (preferred.size > 0) {
    for (const criteria of criteriaList) {
      const matches = graveyard.filter((card: any) => {
        const cardId = String(card?.id || '').trim();
        return (
          preferred.has(cardId) &&
          cardMatchesMoveZoneSingleTargetCriteria(card, criteria, undefined, currentTurn)
        );
      });
      if (matches.length === 1) return String((matches[0] as any)?.id || '').trim();
    }
  }

  return '';
}

export function parseMoveZoneAnotherFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const match = cleaned.match(/^another\s+(.+?)\s+card\s+from\s+your\s+graveyard$/i);
  if (!match) return null;

  const parsed = parseSimpleCardTypeFromText(String(match[1] || '').trim());
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneCardFromTargetPlayersHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim());
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');
  if (!/\bfrom (?:target|that) (?:player|opponent)'s hand\b/i.test(lower)) return null;
  if (lower.startsWith('target ') || lower.startsWith('all ') || lower.startsWith('up to ')) return null;

  if (/^(?:a|an)\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+hand$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const match = cleaned.match(/^(?:a|an)\s+(.+?)\s+cards?\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+hand$/i);
  if (!match) return null;

  const parsed = parseSimpleCardTypeFromText(String(match[1] || '').trim());
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneSingleCardFromYourHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = stripFaceDownSuffix(String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, ''));
  if (raw === 'a card from your hand') return { cardType: 'any' };
  const match = raw.match(/^(?:a|an)\s+(.+?)\s+card\s+from\s+your\s+hand$/);
  if (!match) return null;
  const parsed = parseSimpleCardTypeFromText(String(match[1] || '').trim());
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneThemFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'them from your graveyard' || raw === 'them';
}

export function parseMoveZoneTheCardsExiledWithIt(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'the cards exiled with it';
}

export function parseMoveZoneNonlandCardFromIt(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw === 'a nonland card from it') return { cardType: 'nonland' };
  if (raw === 'a nonland card from it until this creature leaves the battlefield') return { cardType: 'nonland' };
  return null;
}

export function parseMoveZoneThisCardFromExile(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'this card from exile';
}

export function parseMoveZoneThatSpell(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'that spell';
}

export function parseMoveZoneThisSpellToHandInsteadOfGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || (what as any).raw || '')
    .trim()
    .toLowerCase()
    .replace(/[.\s]+$/g, '');
  return (
    raw === 'put this spell into your hand instead of into your graveyard as it resolves' ||
    /^put this spell into your hand instead of into your graveyard(?: as it resolves)?$/.test(raw)
  );
}

export function parseMoveZoneUpToCountBattlefieldBounce(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly maxCount: number; readonly selectorText: string } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (/^up to x target permanents$/i.test(raw)) {
    return { maxCount: 3, selectorText: 'permanents you control' };
  }
  if (/^up to (\w+) other target nonland permanents$/i.test(raw)) {
    const countMatch = raw.match(/^up to (\w+) other target nonland permanents$/i);
    const maxCount = parseSmallNumberWord(String(countMatch?.[1] || '').trim());
    if (!maxCount || maxCount < 1) return null;
    return { maxCount, selectorText: 'other target nonland permanents you control' };
  }
  const match = raw.match(/^up to (\w+) (.+)$/i);
  if (!match) return null;
  const maxCount = parseSmallNumberWord(String(match[1] || '').trim());
  const selectorText = String(match[2] || '').trim();
  if (!maxCount || maxCount < 1 || !selectorText) return null;
  if (
    !/\bcontrol\b/i.test(selectorText) &&
    !/^target permanents?$/i.test(selectorText) &&
    !/^target creatures?$/i.test(selectorText) &&
    !/^other target nonland permanents?$/i.test(selectorText)
  ) {
    return null;
  }
  return { maxCount, selectorText };
}

export function parseMoveZoneAllFromYourLibrary(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return /^all cards from your library(?: face down)?$/.test(raw);
}

export function parseMoveZoneCreatureCardExiledWithSource(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw === 'a creature card exiled with it') return { cardType: 'creature' };
  if (raw === 'a creature card from it') return { cardType: 'creature' };
  return null;
}

export function parseMoveZoneEachPermanentExiledWithSource(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'each permanent card exiled with it';
}

export function parseMoveZoneUpToTypedCardsFromAmongThem(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly maxCount: number; readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  const match = raw.match(/^up to (\w+) (.+?) cards? from among them$/i);
  if (!match) return null;
  const maxCount = parseSmallNumberWord(String(match[1] || '').trim());
  const typeText = String(match[2] || '').trim();
  if (!maxCount || maxCount < 1 || !typeText) return null;
  const parsed = parseSimpleCardTypeFromText(typeText) || parseSimpleCardTypeFromText(`${typeText} card`);
  if (!parsed) return null;
  return { maxCount, cardType: parsed };
}

export function parseMoveZonePutAllTypedAndFromAmongThem(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly criteriaAnyOf: readonly MoveZoneSingleTargetCriteria[] } | null {
  if (what.kind !== 'raw') return null;
  const raw = stripMoveZoneSelectorPrefix(String((what as any).text || (what as any).raw || ''))
    .trim()
    .replace(/[.\s]+$/g, '')
    .split(/\.\s*then\b/i)[0]
    .trim();
  const match = raw.match(/^put all (.+?) cards from among them into your hand$/i);
  if (!match) return null;
  const typeClause = String(match[1] || '').trim();
  if (!/\band\b/i.test(typeClause)) return null;
  const parts = typeClause.split(/\s+and\s+/i).map(part => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const criteriaAnyOf: MoveZoneSingleTargetCriteria[] = [];
  for (const part of parts) {
    const subtype = parseCreatureSubtypeWord(part);
    const parsed =
      parseMoveZoneSingleTargetCriteria(`${part} card`) ||
      parseMoveZoneSingleTargetCriteria(part) ||
      (subtype ? { cardType: 'creature' as const, creatureTypesAnyOf: [subtype] } : null) ||
      (parseSimpleCardTypeFromText(part) ? { cardType: parseSimpleCardTypeFromText(part)! } : null);
    if (!parsed) return null;
    criteriaAnyOf.push(parsed);
  }
  return { criteriaAnyOf };
}

export function parseMoveZoneOneOnTopRestOnBottomLibrary(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly optional: boolean } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || (what as any).raw || '')
    .trim()
    .replace(/[.\s]+$/g, '');
  if (
    /^you may put one of those cards on top of your library\. put the rest on the bottom of your library in a random order$/i.test(
      raw
    )
  ) {
    return { optional: true };
  }
  if (
    /^put one of those cards on top of your library\. put the rest on the bottom of your library in a random order$/i.test(
      raw
    )
  ) {
    return { optional: false };
  }
  return null;
}

export function parseMoveZoneCardFromAmongThoseCards(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw === 'a card from among those cards') return { cardType: 'any' };
  const match = raw.match(/^(?:a|an)\s+(.+?)\s+card\s+from\s+among\s+those\s+cards$/);
  if (!match) return null;
  const parsed = parseSimpleCardTypeFromText(String(match[1] || '').trim());
  if (!parsed) return null;
  return { cardType: parsed };
}

export type AllExiledWithThisPermanentSpec = {
  readonly cardType: SimpleCardType;
  readonly excludeCreatureCards?: boolean;
};

export function parseMoveZoneAllExiledWithThisPermanent(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): AllExiledWithThisPermanentSpec | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw === 'each other card exiled with this vehicle') {
    return { cardType: 'any', excludeCreatureCards: true };
  }
  const patterns = [
    /^all cards exiled with this (?:enchantment|artifact|creature|permanent|card|land)$/,
    /^each card exiled with it$/,
    /^each card exiled with this (?:enchantment|artifact|creature|permanent|card|land)$/,
    /^each other card exiled with this (?:enchantment|artifact|creature|permanent|card|land)$/,
    /^the cards exiled with this (?:enchantment|artifact|creature|permanent|land)$/,
    /^all cards you own exiled with this (?:artifact|enchantment|permanent)$/,
    /^all other cards you own exiled with this (?:enchantment|artifact|permanent|card)$/,
    /^all other permanent cards exiled with this (?:enchantment|artifact|creature|permanent|card)$/,
  ];
  if (!patterns.some(pattern => pattern.test(raw))) return null;
  if (/^all other permanent cards\b/.test(raw)) return { cardType: 'permanent' };
  return { cardType: 'any' };
}

export function parseMoveZoneTypedCardFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const match = raw.match(/^(?:a|an)\s+(.+?)\s+card\s+from\s+your\s+graveyard$/);
  if (!match) return null;
  const typeText = String(match[1] || '').trim();
  const creatureSubtype = parseCreatureSubtypeWord(typeText);
  if (creatureSubtype) return { cardType: 'creature', creatureTypesAnyOf: [creatureSubtype] };
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function exileUpToMatchingFromGraveyard(
  state: GameState,
  playerId: PlayerID,
  maxCount: number,
  criteria: MoveZoneSingleTargetCriteria,
  preferredIds: readonly string[] = []
):
  | { readonly kind: 'applied'; readonly state: GameState; readonly log: readonly string[] }
  | { readonly kind: 'impossible'; readonly available: number }
  | { readonly kind: 'player_choice_required'; readonly available: number } {
  const selection = selectUpToMatchingFromGraveyardWithCriteria(state, playerId, maxCount, criteria, preferredIds);
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

export function parseMoveZoneOpponentOwnedFromExile(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly count: number } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (!raw) return null;

  if (raw === 'a card an opponent owns from exile') return { count: 1 };

  const match = raw.match(/^([a-z0-9]+)\s+cards?\s+your\s+opponents?\s+own\s+from\s+exile$/);
  if (!match) return null;

  const count = parseSmallNumberWord(String(match[1] || ''));
  if (count === null || count <= 0) return null;
  return { count };
}

export function parseMoveZoneAllCardsExiledWithIt(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw === 'all cards exiled with it') return { cardType: 'any' };
  return null;
}

export function parseMoveZoneUpToTargetCardsFromGraveyards(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly maxCount: number; readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const match = cleaned.match(/^up to (\w+) target cards? from graveyards$/i);
  if (!match) return null;

  const maxCount = parseSmallNumberWord(String(match[1] || '').trim());
  if (!maxCount || maxCount < 1) return null;
  return { maxCount, cardType: 'any' };
}

export function parseMoveZoneUpToTargetCardsFromSingleGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly maxCount: number; readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const match = cleaned.match(/^up to (\w+) target cards? from a(?: single)? graveyard$/i);
  if (!match) return null;

  const maxCount = parseSmallNumberWord(String(match[1] || '').trim());
  if (!maxCount || maxCount < 1) return null;
  return { maxCount, cardType: 'any' };
}

export type AmongThemMoveCriteria = MoveZoneSingleTargetCriteria & {
  readonly anyNumber?: boolean;
  readonly maxCount?: number;
  readonly differentPowers?: boolean;
};

export type ContextualThemSplitSpec =
  | { readonly kind: 'any_number_hand_graveyard_rest' }
  | { readonly kind: 'count_hand_graveyard_rest'; readonly count: number }
  | { readonly kind: 'count_hand_library_bottom'; readonly count: number };

function parseColoredPermanentAmongThem(typeText: string): AmongThemMoveCriteria | null {
  const match = String(typeText || '')
    .trim()
    .match(/^(white|blue|black|red|green|colorless)\s+permanent$/i);
  if (!match) return null;
  const color = normalizeCardColor(String(match[1] || '').trim());
  if (!color) return null;
  return { cardType: 'permanent', colorsAnyOf: [color] };
}

function parseAmongThemOrTypeLineTerms(normalized: string): AmongThemMoveCriteria | null {
  if (!/,\s*|\s+or\s+/i.test(normalized)) return null;
  const parts = normalized
    .replace(/,\s*or\s+/gi, ',')
    .split(/\s*,\s*|\s+or\s+/i)
    .map(part => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;

  const terms: string[] = [];
  let includesPermanent = false;
  for (const part of parts) {
    if (/^vehicle$/i.test(part)) {
      terms.push('vehicle');
      includesPermanent = true;
      continue;
    }
    const subtype = parseCreatureSubtypeWord(part);
    if (subtype) {
      terms.push(subtype.toLowerCase());
      includesPermanent = true;
      continue;
    }
    if (/^[a-z][a-z'-]*$/i.test(part)) {
      terms.push(part.toLowerCase());
      includesPermanent = true;
      continue;
    }
    const parsed = parseSimpleCardTypeFromText(part);
    if (parsed === 'vehicle') {
      terms.push('vehicle');
      includesPermanent = true;
      continue;
    }
    if (parsed === 'creature') {
      includesPermanent = true;
      continue;
    }
    return null;
  }
  if (terms.length === 0) return null;
  return {
    cardType: includesPermanent ? 'permanent' : 'any',
    typeLineTermsAnyOf: terms,
  };
}

function parseCreatureSubtypeWord(typeText: string): string | null {
  const normalized = String(typeText || '').replace(/\s+/g, ' ').trim();
  const creatureTypeAndCreatureMatch = normalized.match(/^([a-z][a-z' -]+)\s+creature$/i);
  if (creatureTypeAndCreatureMatch) {
    const creatureType = toTitleCaseWords(String(creatureTypeAndCreatureMatch[1] || '').trim());
    return isValidCreatureType(creatureType) ? creatureType : null;
  }
  const singleWord = toTitleCaseWords(normalized);
  return isValidCreatureType(singleWord) ? singleWord : null;
}

function parseAmongThemCreatureSubtype(typeText: string): string | null {
  return parseCreatureSubtypeWord(typeText);
}

function parseCompoundCardTypeFromText(typeText: string): SimpleCardType | null {
  const normalized = String(typeText || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (normalized === 'artifact and enchantment' || normalized === 'artifact or enchantment') {
    return 'artifact_or_enchantment';
  }
  if (normalized === 'artifact and creature' || normalized === 'artifact or creature') {
    return 'artifact_or_creature';
  }
  return null;
}

const BASIC_LAND_TYPE_NAMES = new Set(['plains', 'island', 'swamp', 'mountain', 'forest', 'wastes']);

function parseRevealedThisWayTypeText(typeText: string): AmongThemMoveCriteria | null {
  const normalized = String(typeText || '').replace(/\s+/g, ' ').trim();
  if (/^cards of the chosen type$/i.test(normalized)) {
    return { cardType: 'creature', anyNumber: true, usesChosenCreatureType: true };
  }
  const basicLandType = normalized.toLowerCase();
  if (BASIC_LAND_TYPE_NAMES.has(basicLandType)) {
    return { cardType: 'land', typeLineTermsAnyOf: [basicLandType], anyNumber: true };
  }
  const creatureSubtype = parseCreatureSubtypeWord(normalized);
  if (creatureSubtype) {
    return { cardType: 'creature', creatureTypesAnyOf: [creatureSubtype], anyNumber: true };
  }
  const parsed = parseCompoundCardTypeFromText(normalized) || parseSimpleCardTypeFromText(normalized);
  if (!parsed) return null;
  return { cardType: parsed, anyNumber: true };
}

function parseAmongThemTypeConstraints(typeText: string): AmongThemMoveCriteria | null {
  const normalized = String(typeText || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  const coloredPermanent = parseColoredPermanentAmongThem(normalized);
  if (coloredPermanent) return coloredPermanent;

  const orTerms = parseAmongThemOrTypeLineTerms(normalized);
  if (orTerms) return orTerms;

  const mvRangeMatch = normalized.match(/^(.+?)\s+with\s+mana\s+value\s+(\d+)(?:\s+or\s+(\d+))?(?:\s+or\s+less)?$/i);
  if (mvRangeMatch) {
    const subtypeText = String(mvRangeMatch[1] || '').trim();
    const creatureSubtype = parseAmongThemCreatureSubtype(subtypeText);
    const parsed = creatureSubtype ? 'creature' as const : parseSimpleCardTypeFromText(subtypeText);
    if (!parsed) return null;
    const first = Number.parseInt(String(mvRangeMatch[2] || ''), 10);
    const second = mvRangeMatch[3] ? Number.parseInt(String(mvRangeMatch[3] || ''), 10) : NaN;
    if (!Number.isFinite(first)) return null;
    const base = creatureSubtype
      ? { cardType: parsed, creatureTypesAnyOf: [creatureSubtype] }
      : { cardType: parsed };
    if (Number.isFinite(second)) {
      return { ...base, manaValueAnyOf: [first, second] };
    }
    if (/\bor\s+less\b/i.test(normalized)) {
      return { ...base, manaValueLte: first };
    }
    return { ...base, manaValueAnyOf: [first] };
  }

  const creatureSubtype = parseAmongThemCreatureSubtype(normalized);
  if (creatureSubtype) {
    return { cardType: 'creature', creatureTypesAnyOf: [creatureSubtype] };
  }

  if (/^gate$/i.test(normalized)) {
    return { cardType: 'land', typeLineTermsAnyOf: ['gate'] };
  }

  const parsed = parseSimpleCardTypeFromText(normalized);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneTypedCardFromAmongThem(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): AmongThemMoveCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();

  if (/^a land card from among them onto the battlefield and the rest$/i.test(cleaned)) {
    return { cardType: 'land' };
  }

  const anyNumberLandSplitMatch = cleaned.match(
    /^any number of land cards from among them onto the battlefield(?: tapped)? and the rest$/i
  );
  if (anyNumberLandSplitMatch) {
    return { cardType: 'land', anyNumber: true };
  }

  const anyNumberConstrainedMatch = cleaned.match(
    /^any\s+number\s+of\s+(.+?)\s+cards?\s+with\s+mana\s+value\s+([x\d]+)(?:\s+or\s+less)?\s+from\s+among\s+them$/i
  );
  if (anyNumberConstrainedMatch) {
    const typeText = String(anyNumberConstrainedMatch[1] || '').trim();
    const parsed = parseSimpleCardTypeFromText(typeText);
    if (!parsed) return null;
    const mvToken = String(anyNumberConstrainedMatch[2] || '').trim().toLowerCase();
    if (mvToken === 'x') {
      return { cardType: parsed, anyNumber: true, manaValueLte: -1 };
    }
    const mv = Number.parseInt(mvToken, 10);
    if (!Number.isFinite(mv)) return null;
    return { cardType: parsed, anyNumber: true, manaValueLte: mv };
  }

  const anyNumberPowerLteMatch = cleaned.match(
    /^any\s+number\s+of\s+(.+?)\s+cards?\s+with\s+mana\s+value\s+less\s+than\s+or\s+equal\s+to\s+this\s+permanent'?s\s+power\s+from\s+among\s+them$/i
  );
  if (anyNumberPowerLteMatch) {
    const parsed = parseAmongThemTypeConstraints(String(anyNumberPowerLteMatch[1] || '').trim());
    if (!parsed) return null;
    return { ...parsed, anyNumber: true, manaValueLteReferencePower: true };
  }

  const anyNumberTotalMvMatch = cleaned.match(
    /^any\s+number\s+of\s+nonland\s+permanent\s+cards?\s+with\s+total\s+mana\s+value\s+(\d+)\s+or\s+less\s+from\s+among\s+them$/i
  );
  if (anyNumberTotalMvMatch) {
    const totalMv = Number.parseInt(String(anyNumberTotalMvMatch[1] || ''), 10);
    if (!Number.isFinite(totalMv)) return null;
    return { cardType: 'nonland', anyNumber: true, manaValueLte: totalMv };
  }

  const differentPowersMatch = cleaned.match(
    /^any\s+number\s+of\s+(.+?)\s+cards?\s+with\s+different\s+powers\s+from\s+among\s+them$/i
  );
  if (differentPowersMatch) {
    const parsed = parseAmongThemTypeConstraints(String(differentPowersMatch[1] || '').trim());
    if (!parsed) return null;
    return { ...parsed, anyNumber: true, differentPowers: true };
  }

  const anyNumberMatch = cleaned.match(/^any\s+number\s+of\s+(.+?)\s+cards?\s+from\s+among\s+them$/i);
  if (anyNumberMatch) {
    const parsed = parseAmongThemTypeConstraints(String(anyNumberMatch[1] || '').trim());
    if (!parsed) return null;
    return { ...parsed, anyNumber: true };
  }

  const xManaCostMatch = cleaned.match(/^(?:a|an)\s+card\s+with\s+\{x\}\s+in\s+its\s+mana\s+cost\s+from\s+among\s+them$/i);
  if (xManaCostMatch) {
    return { cardType: 'any', hasXManaCost: true };
  }

  const allConstrainedFromAmongMatch = cleaned.match(
    /^all\s+(.+?)\s+cards?\s+with\s+mana\s+value\s+(\d+)(?:\s+or\s+(\d+))?(?:\s+or\s+less)?\s+from\s+among\s+them$/i
  );
  if (allConstrainedFromAmongMatch) {
    const subtypeText = String(allConstrainedFromAmongMatch[1] || '').trim();
    const creatureSubtype = parseAmongThemCreatureSubtype(subtypeText);
    const parsed = creatureSubtype ? ('creature' as const) : parseSimpleCardTypeFromText(subtypeText);
    if (!parsed) return null;
    const first = Number.parseInt(String(allConstrainedFromAmongMatch[2] || ''), 10);
    const second = allConstrainedFromAmongMatch[3]
      ? Number.parseInt(String(allConstrainedFromAmongMatch[3] || ''), 10)
      : NaN;
    if (!Number.isFinite(first)) return null;
    const base = creatureSubtype
      ? { cardType: parsed, creatureTypesAnyOf: [creatureSubtype] }
      : { cardType: parsed };
    if (Number.isFinite(second)) {
      return { ...base, anyNumber: true, manaValueAnyOf: [first, second] };
    }
    if (/\bor\s+less\b/i.test(cleaned)) {
      return { ...base, anyNumber: true, manaValueLte: first };
    }
    return { ...base, anyNumber: true, manaValueAnyOf: [first] };
  }

  const allFromAmongMatch = cleaned.match(/^all\s+(.+?)\s+cards?\s+from\s+among\s+them$/i);
  if (allFromAmongMatch) {
    const parsed = parseAmongThemTypeConstraints(String(allFromAmongMatch[1] || '').trim());
    if (!parsed) return null;
    return { ...parsed, anyNumber: true };
  }

  const constrainedMatch = cleaned.match(
    /^(?:a|an)\s+(.+?)\s+card(?:\s+with\s+mana\s+value\s+([x\d]+)(?:\s+or\s+less)?)?\s+from\s+among\s+them$/i
  );
  if (constrainedMatch) {
    const typeText = String(constrainedMatch[1] || '').trim();
    const parsed =
      parseAmongThemTypeConstraints(typeText) ||
      (parseSimpleCardTypeFromText(typeText) ? { cardType: parseSimpleCardTypeFromText(typeText)! } : null);
    if (!parsed) return null;
    const mvToken = String(constrainedMatch[2] || '').trim().toLowerCase();
    if (mvToken === 'x') {
      return { ...parsed, manaValueLte: -1 };
    }
    const first = Number.parseInt(mvToken, 10);
    if (Number.isFinite(first) && /\bor\s+less\b/i.test(cleaned)) {
      return { ...parsed, manaValueLte: first };
    }
    if (Number.isFinite(first)) {
      return { ...parsed, manaValueAnyOf: [first] };
    }
    return parsed;
  }

  const legacyConstrainedMatch = cleaned.match(
    /^(?:a|an)\s+(.+?)\s+card(?:\s+with\s+mana\s+value\s+(\d+)(?:\s+or\s+(\d+))?(?:\s+or\s+less)?)?\s+from\s+among\s+them$/i
  );
  if (legacyConstrainedMatch) {
    const typeText = String(legacyConstrainedMatch[1] || '').trim();
    const parsed =
      parseAmongThemTypeConstraints(typeText) ||
      (parseSimpleCardTypeFromText(typeText) ? { cardType: parseSimpleCardTypeFromText(typeText)! } : null);
    if (!parsed) return null;
    const first = Number.parseInt(String(legacyConstrainedMatch[2] || ''), 10);
    const second = legacyConstrainedMatch[3] ? Number.parseInt(String(legacyConstrainedMatch[3] || ''), 10) : NaN;
    if (Number.isFinite(first) && Number.isFinite(second)) {
      return { ...parsed, manaValueAnyOf: [first, second] };
    }
    if (Number.isFinite(first) && /\bor\s+less\b/i.test(cleaned)) {
      return { ...parsed, manaValueLte: first };
    }
    if (Number.isFinite(first)) {
      return { ...parsed, manaValueAnyOf: [first] };
    }
    return parsed;
  }

  const match = cleaned.match(/^(?:a|an)\s+(.+?)\s+card\s+from\s+among\s+them$/i);
  if (!match) return null;

  return parseAmongThemTypeConstraints(String(match[1] || '').trim());
}

export function parseMoveZoneReturnThisCardAndUpToOneOtherFromGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly otherCardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const match = raw.match(
    /^this card and up to one other target (.+?) card from your graveyard$/
  );
  if (!match) return null;
  const parsed = parseSimpleCardTypeFromText(String(match[1] || '').trim());
  if (!parsed) return null;
  return { otherCardType: parsed };
}

export function parseMoveZoneUpToXTargetPermanents(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'up to x target permanents';
}

export function parseMoveZoneAllCardsMilledThisWay(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const match = raw.match(/^all\s+(.+?)\s+cards?\s+milled this way$/);
  if (!match) return null;
  const parsed = parseSimpleCardTypeFromText(String(match[1] || '').trim());
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneThatCardReference(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'that card' || raw.startsWith('that card ') || raw === 'that card from a graveyard';
}

export function parseMoveZoneTypedCardFromHandOrGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const match = cleaned.match(
    /^(?:a|an)\s+(.+?)\s+card(?:\s+with\s+mana\s+value\s+(\d+)(?:\s+or\s+less)?)?\s+from\s+your\s+hand\s+or\s+graveyard$/i
  );
  if (!match) return null;
  const typeText = String(match[1] || '').trim();
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  const mv = Number.parseInt(String(match[2] || ''), 10);
  if (Number.isFinite(mv) && /\bor\s+less\b/i.test(cleaned)) {
    return { cardType: parsed, manaValueLte: mv };
  }
  return { cardType: parsed };
}

export function parseMoveZoneTypedCardMvLessThanReferenceFromYourHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const match = raw.match(
    /^(?:a|an)\s+(.+?)\s+card\s+with\s+mana\s+value\s+less\s+than\s+that\s+creature's\s+mana\s+value\s+from\s+your\s+hand$/
  );
  if (!match) return null;
  const parsed = parseSimpleCardTypeFromText(String(match[1] || '').trim());
  if (!parsed) return null;
  return { cardType: parsed };
}

export function stepHasAmongThemRestToLibrary(step: {
  readonly raw?: string;
  readonly toRaw?: string;
}): boolean {
  const raw = String(step.raw || '').toLowerCase();
  const toRaw = String(step.toRaw || '').toLowerCase();
  return /\bthe rest\b/.test(raw) || /\band the rest\b/.test(toRaw);
}

export function stepHasRevealedThisWayRestToLibrary(step: {
  readonly raw?: string;
  readonly toRaw?: string;
}): boolean {
  return stepHasAmongThemRestToLibrary(step);
}

export function parseMoveZoneTypedCardsRevealedThisWay(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): AmongThemMoveCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  if (/^all cards of the chosen type revealed this way$/i.test(raw)) {
    return { cardType: 'creature', anyNumber: true, usesChosenCreatureType: true };
  }
  if (/^all creature cards of the chosen type revealed this way$/i.test(raw)) {
    return { cardType: 'creature', anyNumber: true, usesChosenCreatureType: true };
  }
  const match = raw.match(/^all\s+(.+?)\s+cards?\s+revealed this way$/i);
  if (!match) return null;
  return parseRevealedThisWayTypeText(String(match[1] || '').trim());
}

export function parseMoveZoneSingleCardRevealedThisWay(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): AmongThemMoveCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  const match = raw.match(/^(?:a|an)\s+(.+?)\s+card\s+revealed this way$/i);
  if (!match) return null;
  const typeText = String(match[1] || '').trim();
  const parsed =
    parseAmongThemTypeConstraints(typeText) ||
    (parseSimpleCardTypeFromText(typeText) ? { cardType: parseSimpleCardTypeFromText(typeText)! } : null);
  if (!parsed) return null;
  return parsed;
}

export function parseMoveZoneContextualThemSplit(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): ContextualThemSplitSpec | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw === 'any number of them') {
    return { kind: 'any_number_hand_graveyard_rest' };
  }
  const countThemMatch = raw.match(/^([a-z0-9]+) of them$/);
  if (countThemMatch) {
    const count = parseSmallNumberWord(String(countThemMatch[1] || '').trim());
    if (count && count > 0) return { kind: 'count_hand_graveyard_rest', count };
  }
  const countThoseMatch = raw.match(/^([a-z0-9]+) of those cards$/);
  if (countThoseMatch) {
    const count = parseSmallNumberWord(String(countThoseMatch[1] || '').trim());
    if (count && count > 0) return { kind: 'count_hand_library_bottom', count };
  }
  return null;
}

export function parseMoveZoneAnyNumberThosePermanentCards(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'any number of those permanent cards';
}

export function parseMoveZoneThemAntecedent(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'them';
}

export function parseMoveZoneReturnContextualThemToBattlefield(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return (
    raw === "then return them to the battlefield under their owners' control" ||
    raw === "return them to the battlefield under their owners' control"
  );
}

export function parseMoveZoneUpToTargetCreaturesExcludingTypeLineTerm(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly count: number; readonly excludeTypeLineTerm: string } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  const match = raw.match(/^up to ([a-z0-9]+) target non([a-z-]+) creatures$/i);
  if (!match) return null;
  const count = parseSmallNumberWord(String(match[1] || '').trim());
  const excludeTypeLineTerm = String(match[2] || '').trim().toLowerCase();
  if (!count || count < 1 || !excludeTypeLineTerm) return null;
  return { count, excludeTypeLineTerm };
}

export function parseMoveZoneTheChosenCards(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'the chosen cards';
}

export function parseMoveZoneEachPlayerGraveyardNotPutThisWay(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  const match = raw.match(
    /^all\s+(.+?)\s+cards?\s+from\s+each\s+player'?s\s+graveyard\s+that\s+weren't\s+put\s+there\s+this\s+way$/i
  );
  if (!match) return null;
  const parsed = parseSimpleCardTypeFromText(String(match[1] || '').trim());
  if (!parsed) return null;
  return { cardType: parsed, excludePutIntoGraveyardThisTurn: true };
}

export function parseMoveZoneSingleCardFromEachPlayersGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  if (/^a card from each player's graveyard$/i.test(raw)) return { cardType: 'any' };
  const match = raw.match(/^a\s+(.+?)\s+card from each player's graveyard$/i);
  if (!match) return null;
  const parsed = parseSimpleCardTypeFromText(String(match[1] || '').trim());
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneCardPutIntoGraveyardThisWay(
  what: { readonly kind: string; readonly text?: string; readonly raw?: string },
  rawStep?: string
): MoveZoneSingleTargetCriteria | null {
  const candidates = [
    String((what as any).text || '').trim(),
    String((what as any).raw || '').trim(),
    String(rawStep || '').trim(),
  ].filter(Boolean);
  for (const raw of candidates) {
    const cleaned = raw.replace(/[.\s]+$/g, '').trim();
    if (/^a card you put(?: into (?:your|a) graveyard this way)?$/i.test(cleaned)) {
      return { cardType: 'any', putIntoGraveyardThisTurn: true };
    }
    const typedMatch = cleaned.match(/^a\s+(.+?)\s+card you put into (?:your|a) graveyard this way$/i);
    if (typedMatch) {
      const parsed = parseSimpleCardTypeFromText(String(typedMatch[1] || '').trim());
      return { ...(parsed ? { cardType: parsed } : { cardType: 'any' as const }), putIntoGraveyardThisTurn: true };
    }
    if (/^put a card you put into your graveyard this way into your hand$/i.test(cleaned)) {
      return { cardType: 'any', putIntoGraveyardThisTurn: true };
    }
  }
  return null;
}

export function parseMoveZoneThoseCardsNotPlayed(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === "any of those cards you didn't play" || raw === 'any of those cards you did not play';
}

export function parseMoveZoneReturnItAndSelfPermanent(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): 'aura' | 'equipment' | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw === 'it and this aura') return 'aura';
  if (raw === 'it and this equipment') return 'equipment';
  return null;
}

export function parseMoveZoneCompoundExileItAndReturnAllFromYourGraveyard(
  rawStep: string
): MoveZoneSingleTargetCriteria | null {
  const match = String(rawStep || '')
    .trim()
    .match(
      /^exile it and return to the battlefield all (.+?) cards in your graveyard that were put there from the battlefield this turn$/i
    );
  if (!match) return null;
  const typeText = String(match[1] || '').trim();
  const parsed = parseCompoundCardTypeFromText(typeText) || parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed, putIntoGraveyardThisTurn: true };
}

export function exileOneMatchingCardFromEachPlayersGraveyard(
  state: GameState,
  criteria: MoveZoneSingleTargetCriteria,
  preferredIds: readonly string[] = []
): { readonly state: GameState; readonly log: readonly string[] } {
  let nextState = state;
  const log: string[] = [];
  for (const player of state.players || []) {
    const playerId = String((player as any)?.id || '').trim() as PlayerID;
    if (!playerId) continue;
    const cardId = resolveFirstMatchingCardIdFromPlayerGraveyard(nextState, playerId, [criteria], preferredIds);
    if (!cardId) continue;
    const result = moveTargetedCardFromGraveyard(nextState, playerId, cardId, criteria, 'exile');
    if (result.kind !== 'applied') continue;
    nextState = result.state;
    log.push(...(result.log || []));
  }
  return { state: nextState, log };
}

export function putAllMatchingCriteriaFromGraveyardOntoBattlefield(
  state: GameState,
  playerId: PlayerID,
  controllerId: PlayerID,
  criteria: MoveZoneSingleTargetCriteria,
  excludeCardIds: readonly string[] = [],
  entersTapped?: boolean,
  entersFaceDown?: boolean,
  withCounters?: Record<string, number>
): { readonly state: GameState; readonly log: readonly string[]; readonly movedPermanentIds?: readonly string[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [], movedPermanentIds: [] };

  const excluded = new Set(excludeCardIds.map(id => String(id || '').trim()).filter(Boolean));
  const currentTurn = getCurrentTurnNumber(state);
  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const kept: any[] = [];
  const moved: any[] = [];
  for (const card of graveyard) {
    const cardId = String((card as any)?.id || '').trim();
    if (
      cardId &&
      !excluded.has(cardId) &&
      cardMatchesMoveZoneSingleTargetCriteria(card, criteria, undefined, currentTurn)
    ) {
      moved.push(card);
    } else {
      kept.push(card);
    }
  }

  if (moved.length === 0) return { state, log: [], movedPermanentIds: [] };

  const newPermanents = createBattlefieldPermanentsFromCards(
    moved,
    playerId,
    controllerId,
    entersTapped,
    entersFaceDown,
    withCounters,
    'gy'
  );
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), graveyard: kept } as any) : p
  );
  return {
    state: addBattlefieldPermanentsToState({ ...state, players: updatedPlayers as any } as any, newPermanents),
    log: [`${controllerId} puts ${moved.length} card(s) from ${playerId}'s graveyard onto the battlefield`],
    movedPermanentIds: newPermanents.map(perm => String((perm as any)?.id || '').trim()).filter(Boolean),
  };
}

export function moveUnplayedExileCardsToGraveyard(
  state: GameState,
  playerId: PlayerID
): { readonly state: GameState; readonly log: readonly string[]; readonly movedCards?: readonly any[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [] };

  const exile = Array.isArray(player.exile) ? [...player.exile] : [];
  const kept: any[] = [];
  const moved: any[] = [];
  for (const card of exile) {
    if ((card as any)?.playedFromWishes === true) {
      kept.push(card);
      continue;
    }
    if ((card as any)?.wishesExileCandidate === true || (card as any)?.exiledWithWishes === true) {
      moved.push(stampCardPutIntoGraveyardThisTurn(state, card));
      continue;
    }
    kept.push(card);
  }

  if (moved.length === 0) return { state, log: [] };

  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), exile: kept, graveyard: [...graveyard, ...moved] } as any) : p
  );
  return {
    state: { ...state, players: updatedPlayers as any } as GameState,
    log: [`${playerId} puts ${moved.length} unplayed wish card(s) into graveyard`],
    movedCards: moved,
  };
}

export function parseMoveZoneBothCards(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'both cards';
}

export function parseMoveZoneOneOfThoseDragons(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'one of those dragons';
}

export function parseMoveZoneMorphCreatureFromHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'a creature card with a morph ability from your hand';
}

export function parseMoveZoneCountTargetCardsFromSingleGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly count: number; readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  const match = raw.match(/^(\w+) target (\w+) cards? from a single graveyard$/i);
  if (!match) return null;
  const count = parseSmallNumberWord(String(match[1] || '').trim());
  const parsed = parseSimpleCardTypeFromText(String(match[2] || '').trim());
  if (!count || count < 1 || !parsed) return null;
  return { count, cardType: parsed };
}

export function cardHasMorphAbility(card: any): boolean {
  for (const keywords of [card?.keywords, card?.card?.keywords]) {
    if (Array.isArray(keywords) && keywords.some((entry: any) => String(entry || '').toLowerCase() === 'morph')) {
      return true;
    }
  }
  return /\bmorph\b/i.test(getCardOracleText(card));
}

export function parseMoveZoneShuffleAllTypedCardsOfThatTypeFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: SimpleCardType; readonly usesChosenCreatureType: true } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  const match = raw.match(/^all\s+(.+?)\s+cards?\s+of\s+that\s+type\s+from\s+your\s+graveyard$/i);
  if (!match) return null;
  const parsed = parseSimpleCardTypeFromText(String(match[1] || '').trim());
  if (!parsed) return null;
  return { cardType: parsed, usesChosenCreatureType: true };
}

export function parseMoveZoneTopTypedCardFromTargetPlayerGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim()).replace(/[.\s]+$/g, '');
  const match = raw.match(/^the\s+top\s+(.+?)\s+card\s+of\s+(?:target|that)\s+(?:player|opponent)'s\s+graveyard$/i);
  if (!match) return null;
  const parsed = parseSimpleCardTypeFromText(String(match[1] || '').trim());
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneTypedCardFromTargetPlayersGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim()).replace(/[.\s]+$/g, '');
  const match = raw.match(/^(?:a|an)\s+(.+?)\s+card\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+graveyard$/i);
  if (!match) return null;
  const typeText = String(match[1] || '').trim();
  if (/creature/i.test(typeText) && /land/i.test(typeText)) {
    return { cardType: 'creature_or_land' };
  }
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

function parseAmongMilledOrTypePart(part: string): MoveZoneSingleTargetCriteria | null {
  const normalized = part.replace(/^(?:a|an)\s+/i, '').replace(/\s+cards?$/i, '').trim();
  if (BASIC_LAND_TYPE_NAMES.has(normalized.toLowerCase())) {
    return { cardType: 'land', typeLineTermsAnyOf: [normalized.toLowerCase()] };
  }
  return (
    parseMoveZoneSingleTargetCriteria(normalized) ||
    (parseSimpleCardTypeFromText(normalized) ? { cardType: parseSimpleCardTypeFromText(normalized)! } : null)
  );
}

function parseAmongMilledOrTypeClause(typeClause: string): readonly MoveZoneSingleTargetCriteria[] | null {
  if (!/\bor\b/i.test(typeClause)) return null;
  const parts = typeClause.split(/\s+or\s+/i).map(part => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const criteria: MoveZoneSingleTargetCriteria[] = [];
  for (const part of parts) {
    const parsed = parseAmongMilledOrTypePart(part);
    if (!parsed) return null;
    criteria.push(parsed);
  }
  return criteria;
}

const AMONG_MILLED_CARDS_SUFFIX = /from\s+among\s+the\s+(?:milled\s+cards|cards\s+milled\s+this\s+way)$/i;

export function parseMoveZoneTypedCardFromAmongMilledCards(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): AmongThemMoveCriteria | { readonly criteria: readonly MoveZoneSingleTargetCriteria[] } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  const orMatch = raw.match(new RegExp(`^(?:a|an)\\s+(.+?)\\s+card\\s+${AMONG_MILLED_CARDS_SUFFIX.source}`, 'i'));
  if (orMatch && /\bor\b/i.test(String(orMatch[1] || ''))) {
    const criteria = parseAmongMilledOrTypeClause(String(orMatch[1] || '').trim());
    if (!criteria) return null;
    return { criteria };
  }
  const simpleOrMatch = raw.match(
    new RegExp(`^(?:a|an)\\s+(.+?)\\s+${AMONG_MILLED_CARDS_SUFFIX.source}`, 'i')
  );
  if (simpleOrMatch && /\bor\b/i.test(String(simpleOrMatch[1] || ''))) {
    const criteria = parseAmongMilledOrTypeClause(String(simpleOrMatch[1] || '').trim());
    if (!criteria) return null;
    return { criteria };
  }
  const upToMatch = raw.match(
    new RegExp(`^up to (\\w+)\\s+(.+?)\\s+cards?\\s+${AMONG_MILLED_CARDS_SUFFIX.source}`, 'i')
  );
  if (upToMatch) {
    const maxCount = parseSmallNumberWord(String(upToMatch[1] || '').trim());
    const typeText = String(upToMatch[2] || '').trim();
    const parsed = parseSimpleCardTypeFromText(typeText);
    if (!maxCount || !parsed) return null;
    return { cardType: parsed, maxCount };
  }
  const constrainedMatch = raw.match(
    new RegExp(
      `^(?:a|an)\\s+(.+?)\\s+card(?:\\s+with\\s+an\\s+(even|odd)\\s+mana\\s+value)?\\s+${AMONG_MILLED_CARDS_SUFFIX.source}`,
      'i'
    )
  );
  if (!constrainedMatch) return null;
  const typeText = String(constrainedMatch[1] || '').trim();
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  const parity = String(constrainedMatch[2] || '').trim().toLowerCase();
  return {
    cardType: parsed,
    ...(parity === 'even' || parity === 'odd' ? { manaValueParity: parity as 'even' | 'odd' } : {}),
  };
}

export function parseMoveZoneAnyNumberAurasFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return (
    raw === 'any number of aura cards from your graveyard' ||
    raw === 'any number of aura cards that were attached to it from your graveyard'
  );
}

export function parseMoveZoneMostVotesCards(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'each card with the most votes or tied for most votes';
}

export function parseMoveZoneThatManyCardsFromBottomOfLibrary(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'that many cards from the bottom of your library';
}

export function parseMoveZoneThatManyCardsFromTopOfLibrary(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return (
    raw === 'that many cards from the top of your library' ||
    raw === 'cards from the top of your library equal to the damage prevented this way'
  );
}

export function parseMoveZoneThatManyCardsFromTopOfLibraryFaceDown(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'that many cards from the top of your library face down';
}

export function parseMoveZoneUpToOneOtherTargetCreatureBfOrGy(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'up to one other target creature from the battlefield or creature card from a graveyard';
}

export function parseMoveZoneAllOtherCardsRevealedThisWay(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'all other cards revealed this way';
}

export function parseMoveZoneTheRevealedCards(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'the revealed cards';
}

export function parseMoveZoneThatPile(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'that pile';
}

export function parseMoveZoneAllCreaturesOfThatColor(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'all creatures of that color';
}

export function parseMoveZoneTargetCreatureInGraveyardMilledThisTurn(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  const match = raw.match(/^target\s+(.+?)\s+in\s+a\s+graveyard\s+that\s+was\s+milled\s+this\s+turn$/i);
  if (!match) return null;
  const typeText = String(match[1] || '').trim();
  const parsed = parseMoveZoneSingleTargetCriteria(typeText) || (
    parseSimpleCardTypeFromText(typeText) ? { cardType: parseSimpleCardTypeFromText(typeText)! } : null
  );
  if (!parsed) return null;
  return { ...parsed, milledThisTurn: true };
}

export function parseMoveZoneCountTargetBattlefieldBounce(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly count: number; readonly selectorText: string } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  let match = raw.match(/^up to ([a-z0-9]+)\s+target\s+(.+)$/i);
  if (match && !/^non[a-z-]+\s+/i.test(String(match[2] || '').trim())) {
    const count = parseSmallNumberWord(String(match[1] || '').trim());
    const selectorText = `target ${String(match[2] || '').trim()}`;
    if (!count || count < 1 || !selectorText) return null;
    return { count, selectorText };
  }
  match = raw.match(/^([a-z0-9]+)\s+target\s+(.+)$/i);
  if (match) {
    const count = parseSmallNumberWord(String(match[1] || '').trim());
    const selectorText = `target ${String(match[2] || '').trim()}`;
    if (!count || count < 1 || !selectorText) return null;
    return { count, selectorText };
  }
  match = raw.match(/^([a-z0-9]+)\s+(.+?)\s+you\s+control$/i);
  if (!match) return null;
  const count = parseSmallNumberWord(String(match[1] || '').trim());
  const selectorText = String(match[2] || '').trim();
  if (!count || count < 1 || !selectorText) return null;
  if (!/\bcontrol\b/i.test(selectorText) && !/\bcontrol\b/i.test(raw)) return null;
  return { count, selectorText };
}

export function parseMoveZoneAllOtherTappedCreatures(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'all other tapped creatures';
}

export function parseMoveZoneCompoundOpponentLibraryTopRandomGyHandExile(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim())
    .replace(/[.\s]+$/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return (
    raw ===
      "the top card of target opponent's library, a card at random from target opponent's graveyard, and a card at random from target opponent's hand" ||
    raw ===
      "the top card of target player's library, a card at random from target player's graveyard, and a card at random from target player's hand"
  );
}

export function selectRandomCardIdFromHand(
  state: GameState,
  playerId: PlayerID,
  preferredIds: readonly string[] = []
): string {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return '';
  const hand = Array.isArray(player.hand) ? player.hand : [];
  const preferred = preferredIds.map(id => String(id || '').trim()).filter(Boolean);
  if (preferred.length > 0) {
    const match = hand.find((card: any) => preferred.includes(String(card?.id || '').trim()));
    if (match) return String(match.id || '').trim();
  }
  const card = hand[0];
  return card ? String((card as any)?.id || '').trim() : '';
}

export function exileRandomCardFromHand(
  state: GameState,
  playerId: PlayerID,
  preferredIds: readonly string[] = []
): { state: GameState; log: string[]; movedCards: any[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [], movedCards: [] };
  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  const exile = Array.isArray(player.exile) ? [...player.exile] : [];
  const preferred = preferredIds.map(id => String(id || '').trim()).filter(Boolean);
  let pickedIndex = 0;
  if (preferred.length > 0) {
    const idx = hand.findIndex((card: any) => preferred.includes(String(card?.id || '').trim()));
    if (idx >= 0) pickedIndex = idx;
  }
  const picked = hand[pickedIndex];
  if (!picked) return { state, log: [], movedCards: [] };
  const nextHand = hand.filter((_, index) => index !== pickedIndex);
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), hand: nextHand, exile: [...exile, picked] } as any) : p
  );
  return {
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} exiles a random card from hand`],
    movedCards: [picked],
  };
}

export function parseMoveZoneUpToCountOfThem(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly maxCount: number } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const match = raw.match(/^up to ([a-z0-9]+) of them$/);
  if (!match) return null;
  const maxCount = parseSmallNumberWord(String(match[1] || '').trim());
  if (!maxCount || maxCount < 1) return null;
  return { maxCount };
}

export function parseMoveZoneUpToThatManyInstantOrSorceryFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneUpToTargetCountSpec | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  const match = raw.match(
    /^up to that many target (instant and\/or sorcery|instant or sorcery) cards?(?: with mana value (\d+) or less)? from your graveyard(?: and copy them)?$/i
  );
  if (!match) return null;
  const mv = Number.parseInt(String(match[2] || ''), 10);
  return {
    maxCount: 0,
    useReferenceAmount: true,
    criteria: {
      cardType: 'any',
      typeLineTermsAnyOf: ['instant', 'sorcery'],
      ...(Number.isFinite(mv) ? { manaValueLte: mv } : {}),
    },
  };
}

export function parseMoveZoneAnyNumberArtifactCreatureTotalMvFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly totalManaValueLte: number } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const match = raw.match(
    /^any number of artifact creature cards with total mana value (\d+) or less from your graveyard$/
  );
  if (!match) return null;
  const total = Number.parseInt(String(match[1] || ''), 10);
  if (!Number.isFinite(total)) return null;
  return { totalManaValueLte: total };
}

export function parseMoveZoneAnyNumberTargetNonlandTotalMv(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly totalManaValueLte: number } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const match = raw.match(/^any number of target nonland permanents with total mana value (\d+) or less$/);
  if (!match) return null;
  const total = Number.parseInt(String(match[1] || ''), 10);
  if (!Number.isFinite(total)) return null;
  return { totalManaValueLte: total };
}

export function parseMoveZoneCreatureYouControl(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'a creature you control';
}

export function parseMoveZoneLesserMvThanDiedCreatureFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (
    raw !==
    'a creature card with lesser mana value than the creature that died from your graveyard'
  ) {
    return null;
  }
  return { cardType: 'creature' };
}

export function parseMoveZoneRandomCardFromTargetPlayerHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim())
    .toLowerCase()
    .replace(/[.\s]+$/g, '');
  return (
    raw === "a card at random from target player's hand" ||
    raw === "a card at random from that player's hand"
  );
}

export function parseMoveZoneCompoundExileItAndEachPlayerReturnAllGyCreaturesToHand(
  rawStep: string
): boolean {
  return /^exile it and each player returns all creature cards from their graveyard to their hand$/i.test(
    String(rawStep || '').trim()
  );
}

export function selectBattlefieldPermanentsWithTotalManaValueLte(
  state: GameState,
  boundPermanentIds: readonly string[],
  totalManaValueLte: number
): string[] {
  const battlefield = [...((state.battlefield || []) as any[])];
  const bound = new Set(boundPermanentIds.map(id => String(id || '').trim()).filter(Boolean));

  let candidates = battlefield.filter(perm => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!permanentId || hasExecutorClass(perm as any, 'land')) return false;
    if (bound.size > 0 && !bound.has(permanentId)) return false;
    return getCardManaValue((perm as any)?.card || perm) !== null;
  });

  if (candidates.length === 0) {
    candidates = battlefield.filter(perm => {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!permanentId || hasExecutorClass(perm as any, 'land')) return false;
      return getCardManaValue((perm as any)?.card || perm) !== null;
    });
  }

  candidates.sort(
    (left, right) =>
      (getCardManaValue((left as any)?.card || left) ?? 0) -
      (getCardManaValue((right as any)?.card || right) ?? 0)
  );

  const selected: string[] = [];
  let total = 0;
  for (const perm of candidates) {
    const permanentId = String((perm as any)?.id || '').trim();
    const manaValue = getCardManaValue((perm as any)?.card || perm) ?? 0;
    if (total + manaValue > totalManaValueLte) continue;
    selected.push(permanentId);
    total += manaValue;
  }
  return selected;
}

export function parseMoveZoneShuffleSourceAndTargetIntoLibraries(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  const match = raw.match(/^this creature and target (.+?) with a stun counter on it$/i);
  if (!match) return null;
  const typeText = String(match[1] || '').trim();
  const parsed = parseMoveZoneSingleTargetCriteria(typeText) || (
    parseSimpleCardTypeFromText(typeText) ? { cardType: parseSimpleCardTypeFromText(typeText)! } : null
  );
  if (!parsed) return null;
  return { ...parsed, requiredCounter: 'stun' };
}

export function parseMoveZoneUpToXFromAmongExiledWithThis(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'up to x cards from among cards exiled with this artifact';
}

export function parseMoveZoneAnyNumberSaddledCreaturesToHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'any number of creatures that saddled it this turn';
}

export function parseMoveZoneUpToXOtherCreaturesBfOrGy(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return (
    raw === 'up to x other target creatures from the battlefield and/or creature cards from graveyards' ||
    raw === 'up to three other target creatures from the battlefield and/or creature cards from graveyards'
  );
}

export function parseMoveZoneEachOpponentCreatureToughnessXOrLess(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'each creature your opponents control with toughness x or less';
}

export function parseMoveZoneTopLibraryFaceDownPerOpponent(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'a card from the top of your library face down for each opponent you have';
}

export function parseMoveZoneAllNamedThisPermanentFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'all cards named this permanent from your graveyard';
}

export function parseMoveZoneCreatureExiledWithThisVehicle(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'a creature card exiled with this vehicle';
}

export function parseMoveZoneAnyNumberCyclingPermanentsFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'any number of target permanent cards with cycling abilities from your graveyard';
}

export function parseMoveZoneAnyNumberCreaturesTotalPowerFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly totalPowerLte: number } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const match = raw.match(/^any number of target creature cards with total power (\d+) or less from your graveyard$/);
  if (match) {
    const total = Number.parseInt(String(match[1] || ''), 10);
    if (!Number.isFinite(total)) return null;
    return { totalPowerLte: total };
  }
  if (
    raw ===
    "any number of other creature cards with total power x or less from your graveyard, where x is this creature's power"
  ) {
    return { totalPowerLte: -1 };
  }
  if (raw === 'any number of other creature cards with total power x or less from your graveyard') {
    return { totalPowerLte: -1 };
  }
  return null;
}

export function parseMoveZoneUpToThatManyFromTheirGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneUpToTargetCountSpec | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw !== 'up to that many target cards from their graveyard') return null;
  return { maxCount: 0, criteria: { cardType: 'any' }, useReferenceAmount: true };
}

const GRAVEYARD_CARD_TYPE_WORDS = [
  'artifact',
  'battle',
  'creature',
  'enchantment',
  'instant',
  'kindred',
  'land',
  'planeswalker',
  'sorcery',
] as const;

function getGraveyardCardTypesFromTypeLine(card: any): readonly string[] {
  const typeLine = String(card?.type_line || card?.card?.type_line || '').toLowerCase();
  if (!typeLine) return [];
  const found: string[] = [];
  for (const typeWord of GRAVEYARD_CARD_TYPE_WORDS) {
    if (typeLine.includes(typeWord) && !found.includes(typeWord)) {
      found.push(typeWord);
    }
  }
  return found;
}

export function exileUpToOneEachCardTypeFromGraveyard(
  state: GameState,
  playerId: PlayerID,
  preferredIds: readonly string[] = []
): { state: GameState; log: string[]; movedCards: any[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [], movedCards: [] };

  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const exile = Array.isArray(player.exile) ? [...player.exile] : [];
  const preferred = preferredIds.map(id => String(id || '').trim()).filter(Boolean);
  const pickedTypes = new Set<string>();
  const picked: any[] = [];
  const kept: any[] = [];

  const pickCard = (card: any): void => {
    const types = getGraveyardCardTypesFromTypeLine(card);
    if (types.length === 0) {
      kept.push(card);
      return;
    }
    const unpickedType = types.find(type => !pickedTypes.has(type));
    if (!unpickedType) {
      kept.push(card);
      return;
    }
    pickedTypes.add(unpickedType);
    picked.push(card);
  };

  for (const wantedId of preferred) {
    const card = graveyard.find((entry: any) => String(entry?.id || '').trim() === wantedId);
    if (!card) continue;
    pickCard(card);
  }
  for (const card of graveyard) {
    const cardId = String((card as any)?.id || '').trim();
    if (preferred.includes(cardId)) continue;
    pickCard(card);
  }

  if (picked.length === 0) return { state, log: [], movedCards: [] };

  const pickedIds = new Set(picked.map(card => String((card as any)?.id || '').trim()).filter(Boolean));
  const nextGraveyard = graveyard.filter(card => !pickedIds.has(String((card as any)?.id || '').trim()));

  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), graveyard: nextGraveyard, exile: [...exile, ...picked] } as any) : p
  );
  return {
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} exiles up to one card of each card type from graveyard`],
    movedCards: picked,
  };
}

export function parseMoveZoneUpToOneEachCardTypeFromBoundGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim())
    .replace(/[.\s]+$/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return (
    raw === "up to one card of each card type from target opponent's graveyard" ||
    raw === "up to one card of each card type from target player's graveyard"
  );
}

export function parseMoveZoneCreatureFromAmongCardsMilledThisWay(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  const match = raw.match(/^(?:a|an)\s+(.+?)\s+card from among the cards milled this way$/i);
  if (!match) return null;
  const parsed = parseSimpleCardTypeFromText(String(match[1] || '').trim());
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneCreatureHandOrCommandZoneLesserMv(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: SimpleCardType } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  const match = raw.match(
    /^(?:a|an)\s+(.+?)\s+card you own with lesser mana value from your hand or from the command zone$/i
  );
  if (!match) return null;
  const parsed = parseSimpleCardTypeFromText(String(match[1] || '').trim());
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneOneOfThemBfTappedOtherHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'one of them onto the battlefield tapped and the other';
}

export function cardHasCyclingAbility(card: any): boolean {
  for (const keywords of [card?.keywords, card?.card?.keywords]) {
    if (Array.isArray(keywords) && keywords.some((entry: any) => String(entry || '').toLowerCase() === 'cycling')) {
      return true;
    }
  }
  return /\bcycling\b/i.test(getCardOracleText(card));
}

export function cardHasKickerAbility(card: any): boolean {
  for (const keywords of [card?.keywords, card?.card?.keywords]) {
    if (Array.isArray(keywords) && keywords.some((entry: any) => String(entry || '').toLowerCase() === 'kicker')) {
      return true;
    }
  }
  return /\bkicker\b/i.test(getCardOracleText(card));
}

export function cardHasAwakenAbility(card: any): boolean {
  return /\bawaken\b/i.test(getCardOracleText(card));
}

export function selectGraveyardCardsWithTotalManaValueLte(
  state: GameState,
  playerId: PlayerID,
  cardType: SimpleCardType,
  totalManaValueLte: number,
  preferredIds: readonly string[] = []
): string[] {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return [];
  const graveyard = Array.isArray(player.graveyard) ? player.graveyard : [];
  const preferred = new Set(preferredIds.map(id => String(id || '').trim()).filter(Boolean));
  const candidates = graveyard.filter((card: any) => {
    const cardId = String(card?.id || '').trim();
    if (!cardId || !cardMatchesType(card, cardType)) return false;
    if (preferred.size > 0 && !preferred.has(cardId)) return false;
    return true;
  });
  const pool = candidates.length > 0 ? candidates : graveyard.filter((card: any) => cardMatchesType(card, cardType));
  const selected: string[] = [];
  let total = 0;
  for (const card of pool) {
    const mv = getCardManaValue(card);
    if (mv === null) continue;
    if (total + mv > totalManaValueLte) continue;
    const cardId = String(card?.id || '').trim();
    if (!cardId) continue;
    selected.push(cardId);
    total += mv;
  }
  return selected;
}

export function selectGraveyardCreatureCardsWithTotalPowerLte(
  state: GameState,
  playerId: PlayerID,
  totalPowerLte: number,
  preferredIds: readonly string[] = []
): string[] {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return [];
  const graveyard = Array.isArray(player.graveyard) ? player.graveyard : [];
  const preferred = new Set(preferredIds.map(id => String(id || '').trim()).filter(Boolean));
  const candidates = graveyard.filter((card: any) => {
    const cardId = String(card?.id || '').trim();
    if (!cardId || !cardMatchesType(card, 'creature')) return false;
    if (preferred.size > 0 && !preferred.has(cardId)) return false;
    return true;
  });
  const pool = candidates.length > 0 ? candidates : graveyard.filter((card: any) => cardMatchesType(card, 'creature'));
  const selected: string[] = [];
  let total = 0;
  for (const card of pool) {
    const power = getCardPower(card);
    if (power === null) continue;
    if (total + power > totalPowerLte) continue;
    const cardId = String(card?.id || '').trim();
    if (!cardId) continue;
    selected.push(cardId);
    total += power;
  }
  return selected;
}

export function exileCountFromTopOfLibrary(
  state: GameState,
  playerId: PlayerID,
  count: number,
  faceDown = false
): { readonly state: GameState; readonly log: readonly string[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player || count <= 0) return { state, log: [] };
  const library = Array.isArray(player.library) ? [...player.library] : [];
  const exile = Array.isArray(player.exile) ? [...player.exile] : [];
  const moved = library.splice(0, Math.min(count, library.length)).map((card: any) =>
    faceDown ? { ...card, faceDown: true } : card
  );
  if (moved.length === 0) return { state, log: [] };
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), library, exile: [...exile, ...moved] } as any) : p
  );
  return {
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} exiles ${moved.length} card(s) from the top of their library`],
  };
}

export function exileCountFromBottomOfLibrary(
  state: GameState,
  playerId: PlayerID,
  count: number
): { readonly state: GameState; readonly log: readonly string[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player || count <= 0) return { state, log: [] };

  const library = Array.isArray(player.library) ? [...player.library] : [];
  const exile = Array.isArray(player.exile) ? [...player.exile] : [];
  const moved = library.splice(Math.max(0, library.length - count), count);
  if (moved.length === 0) return { state, log: [] };

  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), library, exile: [...exile, ...moved] } as any) : p
  );
  return {
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} exiles ${moved.length} card(s) from the bottom of their library`],
  };
}

export function exileAllMatchingCriteriaFromGraveyard(
  state: GameState,
  playerId: PlayerID,
  criteria: MoveZoneSingleTargetCriteria,
  referencePower?: number
): { state: GameState; log: string[]; movedCards: any[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [], movedCards: [] };

  const currentTurn = getCurrentTurnNumber(state);
  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const exile = Array.isArray(player.exile) ? [...player.exile] : [];
  const kept: any[] = [];
  const moved: any[] = [];

  for (const card of graveyard) {
    if (cardMatchesMoveZoneSingleTargetCriteria(card, criteria, undefined, currentTurn, referencePower)) {
      moved.push(card);
    } else {
      kept.push(card);
    }
  }

  if (moved.length === 0) return { state, log: [], movedCards: [] };

  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), graveyard: kept, exile: [...exile, ...moved] } as any) : p
  );
  return {
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} exiles ${moved.length} card(s) from graveyard`],
    movedCards: moved,
  };
}

export function returnAllMatchingCriteriaFromGraveyardToHand(
  state: GameState,
  playerId: PlayerID,
  criteria: MoveZoneSingleTargetCriteria,
  referencePower?: number
): { state: GameState; log: string[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [] };

  const currentTurn = getCurrentTurnNumber(state);
  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  const kept: any[] = [];
  const moved: any[] = [];

  for (const card of graveyard) {
    if (cardMatchesMoveZoneSingleTargetCriteria(card, criteria, undefined, currentTurn, referencePower)) {
      moved.push(card);
    } else {
      kept.push(card);
    }
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

export function parseMoveZoneNamedCardReference(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): string | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (!raw || /\s/.test(raw)) return null;
  if (
    /^(?:that|this|it|target|all|any|each|up|the|a|an|another|other)\b/.test(raw) ||
    /\b(card|cards|permanent|creature|land|spell)\b/.test(raw)
  ) {
    return null;
  }
  return raw;
}

export function resolveAmongMilledMatchingCardIds(
  state: GameState,
  playerId: PlayerID,
  criteria: AmongThemMoveCriteria,
  preferredIds: readonly string[] = []
): string[] {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return [];
  const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
  const preferred = new Set(preferredIds.map(id => String(id || '').trim()).filter(Boolean));
  const matches = graveyard.filter((card: any) => {
    const cardId = String(card?.id || '').trim();
    if (!cardId) return false;
    if (!cardMatchesMoveZoneSingleTargetCriteria(card, criteria)) return false;
    if (preferred.size > 0 && !preferred.has(cardId)) return false;
    return true;
  });
  const ids = matches.map((card: any) => String(card?.id || '').trim()).filter(Boolean);
  if (ids.length === 0 && preferred.size > 0) {
    return graveyard
      .filter((card: any) => {
        const cardId = String(card?.id || '').trim();
        return cardId && preferred.has(cardId) && cardMatchesMoveZoneSingleTargetCriteria(card, criteria);
      })
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean);
  }
  if (criteria.maxCount && ids.length > criteria.maxCount) return ids.slice(0, criteria.maxCount);
  return ids;
}

export function stripFaceDownSuffix(text: string): string {
  return String(text || '')
    .replace(/\s+face\s+down$/i, '')
    .trim();
}

export function resolveAmongThemMatchingCardIds(
  state: GameState,
  playerId: PlayerID,
  criteria: AmongThemMoveCriteria,
  preferredIds: readonly string[] = []
): string[] {
  const preferred = new Set(preferredIds.map(id => String(id || '').trim()).filter(Boolean));
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return [];

  const matches: string[] = [];
  for (const zone of ['hand', 'exile', 'graveyard'] as const) {
    const cards = Array.isArray(player?.[zone]) ? player[zone] : [];
    for (const card of cards) {
      const cardId = String((card as any)?.id || '').trim();
      if (!cardId) continue;
      if (!cardMatchesMoveZoneSingleTargetCriteria(card, criteria)) continue;
      if (preferred.size > 0 && !preferred.has(cardId)) continue;
      matches.push(cardId);
    }
  }

  if (matches.length === 0 && preferred.size > 0) {
    for (const zone of ['hand', 'exile', 'graveyard'] as const) {
      const cards = Array.isArray(player?.[zone]) ? player[zone] : [];
      for (const card of cards) {
        const cardId = String((card as any)?.id || '').trim();
        if (!cardId || !preferred.has(cardId)) continue;
        if (!cardMatchesMoveZoneSingleTargetCriteria(card, criteria)) continue;
        matches.push(cardId);
      }
    }
  }

  if (criteria.differentPowers) {
    const seenPowers = new Set<number>();
    const uniquePowerMatches: string[] = [];
    for (const cardId of matches) {
      let card: any = null;
      for (const zone of ['hand', 'exile', 'graveyard'] as const) {
        const cards = Array.isArray(player?.[zone]) ? player[zone] : [];
        card = cards.find((entry: any) => String(entry?.id || '').trim() === cardId);
        if (card) break;
      }
      const power = getCardPower(card);
      if (power === null || seenPowers.has(power)) continue;
      seenPowers.add(power);
      uniquePowerMatches.push(cardId);
    }
    return uniquePowerMatches;
  }

  return matches;
}

export function resolveTypedCardIdFromPlayerZone(
  state: GameState,
  playerId: PlayerID,
  zone: 'hand' | 'graveyard' | 'exile',
  cardType: SimpleCardType,
  preferredIds: readonly string[] = []
): string {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return '';

  const cards = Array.isArray(player?.[zone]) ? player[zone] : [];
  const preferred = new Set(preferredIds.map(id => String(id || '').trim()).filter(Boolean));

  const matches = cards.filter((card: any) => {
    const cardId = String(card?.id || '').trim();
    if (!cardId) return false;
    if (!cardMatchesType(card, cardType)) return false;
    if (preferred.size > 0 && !preferred.has(cardId)) return false;
    return true;
  });

  if (matches.length === 0 && preferred.size > 0) {
    const relaxed = cards.filter(
      (card: any) => cardMatchesType(card, cardType) && String(card?.id || '').trim()
    );
    if (relaxed.length === 1) return String((relaxed[0] as any)?.id || '').trim();
    return '';
  }

  if (matches.length === 1) return String((matches[0] as any)?.id || '').trim();
  if (matches.length > 1) {
    for (const wantedId of preferredIds) {
      if (matches.some((card: any) => String(card?.id || '').trim() === wantedId)) return wantedId;
    }
  }
  return '';
}

export function resolveCardIdsFromAnyGraveyard(
  state: GameState,
  cardType: SimpleCardType,
  preferredIds: readonly string[] = [],
  maxCount = 1
): Array<{ readonly playerId: PlayerID; readonly cardId: string }> {
  const preferred = new Set(preferredIds.map(id => String(id || '').trim()).filter(Boolean));
  const matches: Array<{ readonly playerId: PlayerID; readonly cardId: string }> = [];

  for (const player of state.players || []) {
    const playerId = String((player as any)?.id || '').trim() as PlayerID;
    if (!playerId) continue;
    const graveyard = Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : [];
    for (const card of graveyard) {
      const cardId = String((card as any)?.id || '').trim();
      if (!cardId || !cardMatchesType(card, cardType)) continue;
      if (preferred.size > 0 && !preferred.has(cardId)) continue;
      matches.push({ playerId, cardId });
    }
  }

  if (matches.length === 0 && preferred.size > 0) {
    for (const player of state.players || []) {
      const playerId = String((player as any)?.id || '').trim() as PlayerID;
      if (!playerId) continue;
      const graveyard = Array.isArray((player as any)?.graveyard) ? (player as any).graveyard : [];
      for (const card of graveyard) {
        const cardId = String((card as any)?.id || '').trim();
        if (!cardId || !preferred.has(cardId) || !cardMatchesType(card, cardType)) continue;
        matches.push({ playerId, cardId });
      }
    }
  }

  if (matches.length <= maxCount) return matches;

  const prioritized: Array<{ readonly playerId: PlayerID; readonly cardId: string }> = [];
  for (const wantedId of preferredIds) {
    const found = matches.find(match => match.cardId === wantedId);
    if (found) prioritized.push(found);
    if (prioritized.length >= maxCount) break;
  }
  return prioritized.length > 0 ? prioritized.slice(0, maxCount) : matches.slice(0, maxCount);
}

export function moveTargetedCardFromHandToLibrary(
  state: GameState,
  playerId: PlayerID,
  targetCardId: string,
  placement: 'top' | 'bottom' = 'bottom'
): { readonly kind: 'applied'; readonly state: GameState; readonly log: readonly string[] } | { readonly kind: 'impossible' } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { kind: 'impossible' };

  const wantedId = String(targetCardId || '').trim();
  if (!wantedId) return { kind: 'impossible' };

  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  const index = hand.findIndex(card => String((card as any)?.id || '').trim() === wantedId);
  if (index < 0) return { kind: 'impossible' };

  const [card] = hand.splice(index, 1);
  const library = Array.isArray(player.library) ? [...player.library] : [];
  const nextLibrary = placement === 'top' ? [card, ...library] : [...library, card];
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), hand, library: nextLibrary } as any) : p
  );

  return {
    kind: 'applied',
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} puts 1 card from hand on the ${placement} of their library`],
  };
}

export function moveCountFromHandToLibrary(
  state: GameState,
  playerId: PlayerID,
  count: number,
  placement: 'top' | 'bottom',
  preferredIds: readonly string[] = []
):
  | { readonly kind: 'applied'; readonly state: GameState; readonly log: readonly string[] }
  | { readonly kind: 'impossible' }
  | { readonly kind: 'player_choice_required' } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { kind: 'impossible' };

  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  if (hand.length < count) return { kind: 'impossible' };

  const preferred = new Set(preferredIds.map(id => String(id || '').trim()).filter(Boolean));
  let selected = hand;
  if (preferred.size > 0) {
    selected = hand.filter((card: any) => preferred.has(String(card?.id || '').trim()));
    if (selected.length < count) selected = hand;
    if (count === 1 && selected.length > 1) {
      for (const wantedId of preferredIds) {
        if (selected.some((card: any) => String(card?.id || '').trim() === wantedId)) {
          selected = selected.filter((card: any) => String(card?.id || '').trim() === wantedId);
          break;
        }
      }
    }
  }

  if (selected.length > count) return { kind: 'player_choice_required' };

  const movedIds = new Set(selected.slice(0, count).map((card: any) => String(card?.id || '').trim()).filter(Boolean));
  const keptHand = hand.filter((card: any) => !movedIds.has(String(card?.id || '').trim()));
  const movedCards = hand.filter((card: any) => movedIds.has(String(card?.id || '').trim()));
  const library = Array.isArray(player.library) ? [...player.library] : [];
  const nextLibrary = placement === 'top' ? [...movedCards, ...library] : [...library, ...movedCards];

  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), hand: keptHand, library: nextLibrary } as any) : p
  );

  return {
    kind: 'applied',
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} puts ${movedCards.length} card(s) from hand on the ${placement} of their library`],
  };
}

export function moveOpponentOwnedCardsFromExileToGraveyards(
  state: GameState,
  controllerId: PlayerID,
  count: number,
  preferredIds: readonly string[] = []
):
  | { readonly kind: 'applied'; readonly state: GameState; readonly log: readonly string[] }
  | { readonly kind: 'impossible' }
  | { readonly kind: 'player_choice_required' } {
  const preferred = new Set(preferredIds.map(id => String(id || '').trim()).filter(Boolean));
  const opponentIds = new Set(
    (state.players || [])
      .map(player => String((player as any)?.id || '').trim())
      .filter(playerId => playerId && playerId !== controllerId)
  );

  const candidates: Array<{ readonly zonePlayerId: PlayerID; readonly ownerId: PlayerID; readonly card: any }> = [];
  for (const player of state.players || []) {
    const zonePlayerId = String((player as any)?.id || '').trim() as PlayerID;
    if (!zonePlayerId) continue;
    const exile = Array.isArray((player as any)?.exile) ? (player as any).exile : [];
    for (const card of exile) {
      const ownerId = String((card as any)?.owner || zonePlayerId).trim() as PlayerID;
      if (!opponentIds.has(ownerId)) continue;
      candidates.push({ zonePlayerId, ownerId, card });
    }
  }

  let selected = candidates;
  if (preferred.size > 0) {
    selected = candidates.filter(entry => preferred.has(String((entry.card as any)?.id || '').trim()));
    if (selected.length === 0) selected = candidates;
  }

  if (selected.length === 0) return { kind: 'impossible' };
  if (selected.length > count) return { kind: 'player_choice_required' };

  const chosen = selected.slice(0, count);
  const movedIds = new Set(chosen.map(entry => String((entry.card as any)?.id || '').trim()).filter(Boolean));
  const updatedPlayers = state.players.map(player => {
    const playerId = String((player as any)?.id || '').trim();
    if (!playerId) return player;

    const exile = Array.isArray((player as any)?.exile) ? [...(player as any).exile] : [];
    const removedFromThisExile = exile.filter((card: any) => movedIds.has(String(card?.id || '').trim()));
    if (removedFromThisExile.length === 0) return player;

    const keptExile = exile.filter((card: any) => !movedIds.has(String(card?.id || '').trim()));
    return { ...(player as any), exile: keptExile };
  });

  const playersWithGraveyards = updatedPlayers.map(player => {
    const playerId = String((player as any)?.id || '').trim();
    const movedToThisGraveyard = chosen
      .filter(entry => entry.ownerId === playerId)
      .map(entry => entry.card);
    if (movedToThisGraveyard.length === 0) return player;

    const graveyard = Array.isArray((player as any)?.graveyard) ? [...(player as any).graveyard] : [];
    return {
      ...(player as any),
      graveyard: [...graveyard, ...movedToThisGraveyard.map(card => stampCardPutIntoGraveyardThisTurn(state, card))],
    };
  });

  return {
    kind: 'applied',
    state: { ...state, players: playersWithGraveyards as any } as any,
    log: [`Moved ${chosen.length} opponent-owned card(s) from exile to graveyards`],
  };
}

export function exileAnotherMatchingCardFromYourGraveyard(
  state: GameState,
  playerId: PlayerID,
  criteria: MoveZoneSingleTargetCriteria,
  excludeCardIds: readonly string[] = [],
  preferredIds: readonly string[] = []
):
  | { readonly kind: 'applied'; readonly state: GameState; readonly log: readonly string[] }
  | { readonly kind: 'impossible' }
  | { readonly kind: 'player_choice_required' } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { kind: 'impossible' };

  const excluded = new Set(excludeCardIds.map(id => String(id || '').trim()).filter(Boolean));
  const preferred = new Set(preferredIds.map(id => String(id || '').trim()).filter(Boolean));
  const currentTurn = getCurrentTurnNumber(state);
  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];

  const matches = graveyard.filter((card: any) => {
    const cardId = String(card?.id || '').trim();
    if (!cardId || excluded.has(cardId)) return false;
    if (!cardMatchesMoveZoneSingleTargetCriteria(card, criteria, undefined, currentTurn)) return false;
    if (preferred.size > 0 && !preferred.has(cardId)) return false;
    return true;
  });

  if (matches.length === 0 && preferred.size > 0) {
    const relaxed = graveyard.filter((card: any) => {
      const cardId = String(card?.id || '').trim();
      if (!cardId || excluded.has(cardId)) return false;
      return cardMatchesMoveZoneSingleTargetCriteria(card, criteria, undefined, currentTurn);
    });
    if (relaxed.length === 0) return { kind: 'impossible' };
    if (relaxed.length > 1) return { kind: 'player_choice_required' };
    const cardId = String((relaxed[0] as any)?.id || '').trim();
    const relaxedResult = moveTargetedCardFromGraveyard(state, playerId, cardId, criteria, 'exile');
    return relaxedResult.kind === 'applied' ? relaxedResult : { kind: 'impossible' };
  }

  if (matches.length === 0) return { kind: 'impossible' };
  if (matches.length > 1) return { kind: 'player_choice_required' };

  const cardId = String((matches[0] as any)?.id || '').trim();
  const result = moveTargetedCardFromGraveyard(state, playerId, cardId, criteria, 'exile');
  return result.kind === 'applied' ? result : { kind: 'impossible' };
}

export function shuffleCardsFromHandIntoLibrary(
  state: GameState,
  playerId: PlayerID
): { readonly state: GameState; readonly log: readonly string[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [] };

  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  if (hand.length === 0) return { state, log: [] };

  const library = Array.isArray(player.library) ? [...player.library] : [];
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), hand: [], library: [...library, ...hand] } as any) : p
  );

  return {
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} shuffles ${hand.length} card(s) from hand into library`],
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
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim());
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

export function parseMoveZoneTheExiledCard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw !== 'the exiled card') return null;
  return { cardType: 'any' };
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
  const targetMatch = cleaned.match(
    /^target card with mana value x exiled with this (?:creature|artifact|enchantment|planeswalker|permanent|card|class|saga)$/i
  );
  if (targetMatch) {
    return { cardType: 'any', manaValueLte: -1 };
  }

  const match = cleaned.match(
    /^(?:a|an|the|target)\s+(.+?)\s+exiled with this (?:creature|artifact|enchantment|planeswalker|permanent|card|class|saga)$/i
  );
  if (!match) return null;

  const typeText = String(match[1] || '').trim();
  if (!typeText) return null;
  if (/^card with mana value x$/i.test(typeText)) {
    return { cardType: 'any', manaValueLte: -1 };
  }
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
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim());
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

  const cleaned = stripFaceDownSuffix(raw.replace(/[.\s]+$/g, '').trim());
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;
  if (!/\bfrom your hand\b/i.test(lower) && !/^all\s+cards?\s+from\s+your\s+hand(?:\s+face\s+down)?$/i.test(lower)) return null;
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
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim());
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
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim());
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
  | { readonly cardType: SimpleCardType; readonly colorsAnyOf?: readonly string[] }
  | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const lower = cleaned.toLowerCase().replace(/\s+/g, ' ');

  if (!lower.startsWith('all ')) return null;

  const fromEachPlayersGy =
    /\bfrom each player's graveyard\b/i.test(lower) || /\bfrom each players' graveyard\b/i.test(lower);
  const fromAllGys = /\bfrom all graveyards\b/i.test(lower);
  if (!fromEachPlayersGy && !fromAllGys) return null;

  const colorQualifiedMatch = cleaned.match(
    /^all cards that are ((?:white|blue|black|red|green)(?:\s+or\s+(?:white|blue|black|red|green))*) from (?:each player's graveyard|each players' graveyard|all graveyards)$/i
  );
  if (colorQualifiedMatch) {
    const colorsAnyOf = String(colorQualifiedMatch[1] || '')
      .split(/\s+or\s+/i)
      .map(color => normalizeCardColor(color))
      .filter((color): color is string => Boolean(color));
    if (colorsAnyOf.length > 0) return { cardType: 'any', colorsAnyOf };
  }

  if (/^all\s+cards?\s+from\s+(?:each\s+player's\s+graveyard|each\s+players'\s+graveyard|all\s+graveyards)$/i.test(lower)) {
    return { cardType: 'any' };
  }

  const m = cleaned.match(
    /^all\s+(.+?)\s+cards?\s+from\s+(?:each\s+player's\s+graveyard|each\s+players'\s+graveyard|all\s+graveyards)$/i
  );
  if (!m) return null;

  const typeText = String(m[1] || '').trim();
  if (!typeText) return null;
  const creatureSubtype = parseCreatureSubtypeWord(typeText);
  if (creatureSubtype) {
    return { cardType: 'creature', creatureTypesAnyOf: [creatureSubtype] };
  }
  const parsed = parseCompoundCardTypeFromText(typeText) || parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneMassBattlefieldCreatureBounce(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly excludeTypeLineTerm: string } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  let match = raw.match(/^each non-([a-z'-]+) creature$/);
  if (match) return { excludeTypeLineTerm: String(match[1] || '').trim() };
  match = raw.match(/^all non-([a-z'-]+) creatures$/);
  if (match) return { excludeTypeLineTerm: String(match[1] || '').trim() };
  return null;
}

export function parseMoveZoneAnyNumberTypedFromYourHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const match = raw.match(/^any number of (.+?) cards from your hand$/);
  if (!match) return null;
  const parsed = parseSimpleCardTypeFromText(String(match[1] || '').trim());
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneAnyNumberTargetCreaturesTotalMvFromGraveyards(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly fromTargetPlayerOnly: boolean } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw === 'any number of target creature cards with total mana value x or less from graveyards') {
    return { fromTargetPlayerOnly: false };
  }
  if (
    raw ===
    "any number of target creature cards with total mana value x or less from that player's graveyard"
  ) {
    return { fromTargetPlayerOnly: true };
  }
  return null;
}

export function parseMoveZoneCraftExiledCard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw !== 'an exiled creature card used to craft this permanent') return null;
  return { cardType: 'creature' };
}

export function parseMoveZoneUpToReferenceCountTargetPermanents(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim())
    .toLowerCase()
    .replace(/[.\s]+$/g, '');
  return raw === 'up to that many target permanents that player controls';
}

export function parseMoveZoneTopCardsFromTargetPlayerLibrary(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly count: number } | null {
  if (what.kind !== 'raw') return null;
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim())
    .toLowerCase()
    .replace(/[.\s]+$/g, '');
  const match = raw.match(/^the top (two|[a-z0-9]+) cards of (?:target|that) player's library$/);
  if (!match) return null;
  const count = parseSmallNumberWord(String(match[1] || '').trim());
  if (!count || count < 1) return null;
  return { count };
}

export function parseMoveZoneCommandZonePermanent(
  what: { readonly kind: string; readonly text?: string; readonly raw?: string },
  stepRaw?: string
): boolean {
  if (what.kind !== 'raw') return false;
  const text = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const raw = String(stepRaw || '').toLowerCase();
  if (text === 'this permanent' && /\bfrom the command zone\b/.test(raw)) return true;
  if (text === 'a commander you own from the command zone') return true;
  return false;
}

export function parseMoveZoneMyraExileInstantSorcery(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (
    !/^target instant or sorcery card with mana value x from your graveyard and choose an attraction you control that doesn't have a midway counter on it$/.test(
      raw
    )
  ) {
    return null;
  }
  return { cardType: 'instant_or_sorcery', manaValueLte: -1 };
}

export function parseMoveZoneSharesTypeFromAmongThem(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return (
    raw === 'a card that shares a creature type with it from among them' ||
    raw === 'a card that shares a creature type with enchanted creature from among them' ||
    raw === 'a creature card that shares a creature type with enchanted creature from among them'
  );
}

export function selectGraveyardCreaturesWithTotalManaValueLteFromPlayers(
  state: GameState,
  playerIds: readonly PlayerID[],
  totalManaValueLte: number,
  preferredIds: readonly string[] = []
): readonly { readonly playerId: PlayerID; readonly cardId: string }[] {
  const preferred = new Set(preferredIds.map(id => String(id || '').trim()).filter(Boolean));
  const selected: { playerId: PlayerID; cardId: string }[] = [];
  let total = 0;

  const candidates: { playerId: PlayerID; cardId: string; manaValue: number }[] = [];
  for (const playerId of playerIds) {
    const player = state.players.find(p => p.id === playerId) as any;
    if (!player) continue;
    const graveyard = Array.isArray(player.graveyard) ? player.graveyard : [];
    for (const card of graveyard) {
      if (!cardMatchesType(card, 'creature')) continue;
      const cardId = String((card as any)?.id || '').trim();
      const manaValue = getCardManaValue(card);
      if (!cardId || manaValue === null) continue;
      candidates.push({ playerId, cardId, manaValue });
    }
  }

  candidates.sort((left, right) => left.manaValue - right.manaValue);
  const preferredCandidates = candidates.filter(entry => preferred.has(entry.cardId));
  const pool = preferredCandidates.length > 0 ? preferredCandidates : candidates;

  for (const entry of pool) {
    if (total + entry.manaValue > totalManaValueLte) continue;
    selected.push({ playerId: entry.playerId, cardId: entry.cardId });
    total += entry.manaValue;
  }
  return selected;
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

export function createBattlefieldPermanentsFromCards(
  moved: readonly any[],
  sourcePlayerId: PlayerID,
  controllerId: PlayerID,
  entersTapped: boolean | undefined,
  entersFaceDown: boolean | undefined,
  withCounters: Record<string, number> | undefined,
  sourcePrefix: string,
  attachmentTarget?: BattlefieldAttachmentTarget,
  entryOverrides?: BattlefieldEntryCardOverrides,
  faceDownWardCost?: string
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
        ...(faceDownWardCost
          ? {
              wardCost: faceDownWardCost,
              keywords: ['Ward'],
              oracle_text: `Ward ${faceDownWardCost}`,
            }
          : {}),
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
  const typeLineLower = getCardTypeLineLower(candidateCard);
  const isAura = typeLineLower.includes('aura');
  const isEquipment = typeLineLower.includes('equipment');
  if (!isAura && !isEquipment) return false;
  if (!hasExecutorClass(target, 'creature')) return false;

  if (isEquipment) return true;

  const oracleTextLower = getCardOracleTextLower(candidateCard);
  if (!/\benchant creature\b/i.test(oracleTextLower)) return false;
  if (/\benchant creature you control\b/i.test(oracleTextLower) && target.controller !== controllerId) return false;
  return true;
}

export function addBattlefieldPermanentsToState(state: GameState, newPermanents: readonly BattlefieldPermanent[]): GameState {
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
  const moved = collectTargetAndSameNamedCardsFromGraveyard(state, playerId, targetCardId, criteria);
  if (moved.kind !== 'selected') return { kind: 'impossible' };

  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { kind: 'impossible' };
  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), graveyard: moved.kept, hand: [...hand, ...moved.moved] } as any) : p
  );

  return {
    kind: 'applied',
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} returns ${moved.moved.length} card(s) with the same name from graveyard to hand`],
    movedCards: moved.moved,
  };
}

function collectTargetAndSameNamedCardsFromGraveyard(
  state: GameState,
  playerId: PlayerID,
  targetCardId: string,
  criteria: MoveZoneSingleTargetCriteria
):
  | { readonly kind: 'impossible' }
  | { readonly kind: 'selected'; readonly kept: readonly any[]; readonly moved: readonly any[] } {
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
  return { kind: 'selected', kept, moved };
}

export function returnTargetAndSameNamedCardsFromYourGraveyardToBattlefield(
  state: GameState,
  playerId: PlayerID,
  targetCardId: string,
  criteria: MoveZoneSingleTargetCriteria,
  entersTapped?: boolean
): { readonly kind: 'applied'; readonly state: GameState; readonly log: readonly string[]; readonly movedCards: readonly any[] } | { readonly kind: 'impossible' } {
  const collected = collectTargetAndSameNamedCardsFromGraveyard(state, playerId, targetCardId, criteria);
  if (collected.kind !== 'selected') return { kind: 'impossible' };

  let workingState = state;
  const combinedLog: string[] = [];
  for (const card of collected.moved) {
    const cardId = String((card as any)?.id || '').trim();
    if (!cardId) continue;
    const result = moveTargetedCardFromGraveyard(
      workingState,
      playerId,
      cardId,
      criteria,
      'battlefield',
      playerId,
      entersTapped,
      undefined,
      undefined,
      undefined
    );
    if (result.kind === 'impossible') continue;
    workingState = result.state;
    combinedLog.push(...(result.log || []));
  }

  if (combinedLog.length === 0) return { kind: 'impossible' };
  return {
    kind: 'applied',
    state: workingState,
    log: combinedLog,
    movedCards: collected.moved,
  };
}

export function exileAllMatchingFromGraveyard(
  state: GameState,
  playerId: PlayerID,
  cardType: SimpleCardType,
  options?: { readonly colorsAnyOf?: readonly string[] }
): { state: GameState; log: string[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [] };

  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const exile = Array.isArray(player.exile) ? [...player.exile] : [];

  const kept: any[] = [];
  const moved: any[] = [];

  for (const card of graveyard) {
    if (!cardMatchesType(card, cardType)) {
      kept.push(card);
      continue;
    }
    if (options?.colorsAnyOf?.length && !cardHasAnyColors(card, options.colorsAnyOf)) {
      kept.push(card);
      continue;
    }
    moved.push(card);
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

export function parseMoveZoneCardFromOutsideGame(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'a card you own from outside the game';
}

export function parseMoveZoneOneOrMoreCreaturesFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'one or more creature cards from your graveyard';
}

export function parseMoveZoneOwnedNonlandPermanentYouOwn(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'a nonland permanent you own';
}

export function parseMoveZoneShuffleAnyNumberTargetCardsFromTargetPlayerGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === "any number of target cards from target player's graveyard";
}

export function parseMoveZoneForEachOpponentUpToOneNonlandBounce(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}, stepRaw?: string): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any)?.text || '')
    .trim()
    .toLowerCase()
    .replace(/[.\s]+$/g, '');
  const fullRaw = String(stepRaw || '')
    .trim()
    .toLowerCase()
    .replace(/[.\s]+$/g, '');
  if (
    raw ===
      "for each opponent, return up to one target nonland permanent that player controls to its owner's hand" ||
    fullRaw ===
      "for each opponent, return up to one target nonland permanent that player controls to its owner's hand"
  ) {
    return true;
  }
  return raw === 'up' && /\bfor each opponent,\s+return up to one target nonland permanent\b/i.test(fullRaw);
}

export function parseMoveZoneAnyNumberOpponentOwnedLandsFromExile(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'any number of land cards that player owns from exile';
}

export function parseMoveZoneCreatureFromOwnersGraveyardUnderOwner(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === "a creature card from its owner's graveyard";
}

export function parseMoveZoneEnchantedCreatureAndAurasToHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'enchanted creature and all auras attached to that creature';
}

export function parseMoveZoneSingleCardExiledWithIt(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'a card exiled with it';
}

export function parseMoveZoneDiscardedCardFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'the discarded card from your graveyard';
}

export function parseMoveZoneReturnThisVehicleToOwnersHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}, stepRaw?: string): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const fullRaw = String(stepRaw || '').trim().toLowerCase();
  if (raw === "this vehicle to its owner's hand") return true;
  return raw === 'this vehicle' && /\breturn this vehicle\b/i.test(fullRaw);
}

export function parseMoveZoneAnyNumberGyWithCardTypesAmong(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly minDistinctTypes: number } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw !== 'any number of cards from your graveyard with four or more card types among them') return null;
  return { minDistinctTypes: 4 };
}

export function parseMoveZoneCloakCardFromHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}, stepRaw?: string): boolean {
  if (what.kind !== 'raw') return false;
  const text = String((what as any)?.text || '')
    .trim()
    .toLowerCase()
    .replace(/[.\s]+$/g, '');
  const raw = String(stepRaw || (what as any)?.raw || '')
    .trim()
    .toLowerCase()
    .replace(/[.\s]+$/g, '');
  return raw === 'cloak a card from your hand' || (/\bcloak\b/i.test(raw) && text === 'a card from your hand');
}

export function parseMoveZoneUpToOneNoncreatureNonlandFromTargetPlayerGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === "up to one noncreature, nonland card from that player's graveyard";
}

export function parseMoveZoneMechtitanReturnExiledExceptSelf(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw === 'all cards exiled with this vehicle except this card') return true;
  return (
    raw ===
    "all cards exiled with this vehicle except this card to the battlefield tapped under their owners' control"
  );
}

export function parseMoveZoneOneOfThemFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'one of them from your graveyard';
}

export function parseMoveZoneExileItFromTheirGraveyardWithStash(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'it from their graveyard with a stash counter on it';
}

export function parseMoveZoneOneOfThoseCardsWithThatNameToHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return (
    raw === "one of those cards with that name into its owner's hand" ||
    raw === 'one of those cards with that name'
  );
}

export function parseMoveZoneRandomFromEachOpponentGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === "a card at random from each opponent's graveyard";
}

export function parseMoveZonePutThatCardBfShuffleRestRevealed(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return (
    raw === 'put that card onto the battlefield and shuffle all other cards revealed this way into your library' ||
    raw === 'that card onto the battlefield and shuffle all other cards revealed this way into your library'
  );
}

export function parseMoveZoneThemToOwnersGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
  stepRaw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'them';
}

export function putOpponentOwnedMatchingFromExileOntoBattlefield(
  state: GameState,
  controllerId: PlayerID,
  ownerId: PlayerID,
  cardType: SimpleCardType,
  entersTapped?: boolean,
  entersFaceDown?: boolean,
  withCounters?: Record<string, number>
): { state: GameState; log: string[]; movedPermanentIds?: readonly string[] } {
  let workingState = state;
  const combinedLog: string[] = [];
  const movedPermanentIds: string[] = [];

  for (const player of state.players || []) {
    const zonePlayerId = String((player as any)?.id || '').trim() as PlayerID;
    if (!zonePlayerId) continue;
    const exile = Array.isArray((player as any)?.exile) ? (player as any).exile : [];
    for (const card of exile) {
      const cardOwner = String((card as any)?.owner || zonePlayerId).trim();
      if (cardOwner !== ownerId || !cardMatchesType(card, cardType)) continue;
      const cardId = String((card as any)?.id || '').trim();
      if (!cardId) continue;
      const result = moveTargetedCardFromExile(
        workingState,
        zonePlayerId,
        cardId,
        cardType,
        'battlefield',
        controllerId,
        entersTapped,
        entersFaceDown,
        withCounters
      );
      if (result.kind === 'impossible') continue;
      workingState = result.state;
      combinedLog.push(...(result.log || []));
      movedPermanentIds.push(...(result.movedPermanentIds || []));
    }
  }

  return {
    state: workingState,
    log: combinedLog.length > 0 ? combinedLog : [],
    movedPermanentIds,
  };
}

export function selectGraveyardCardsWithMinDistinctTypes(
  state: GameState,
  playerId: PlayerID,
  minDistinctTypes: number,
  preferredIds: readonly string[] = []
): readonly string[] {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return [];
  const graveyard = Array.isArray(player.graveyard) ? player.graveyard : [];
  const preferred = new Set(preferredIds.map(id => String(id || '').trim()).filter(Boolean));
  const candidates = graveyard
    .map((card: any) => String(card?.id || '').trim())
    .filter(Boolean)
    .filter(cardId => preferred.size === 0 || preferred.has(cardId));
  if (candidates.length === 0) {
    return graveyard.map((card: any) => String(card?.id || '').trim()).filter(Boolean).slice(0, 4);
  }
  const selected: string[] = [];
  const types = new Set<string>();
  for (const cardId of candidates) {
    const card = graveyard.find((entry: any) => String(entry?.id || '').trim() === cardId);
    if (!card) continue;
    for (const typeWord of getGraveyardCardTypesFromTypeLine(card)) {
      types.add(typeWord);
    }
    selected.push(cardId);
    if (types.size >= minDistinctTypes) break;
  }
  return selected.length > 0 ? selected : candidates.slice(0, Math.min(candidates.length, 4));
}

export function shuffleContextualCardsIntoLibrary(
  state: GameState,
  playerId: PlayerID,
  cardIds: readonly string[]
): { state: GameState; log: string[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player || cardIds.length === 0) return { state, log: [] };

  const wanted = new Set(cardIds.map(id => String(id || '').trim()).filter(Boolean));
  const moved: any[] = [];
  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  const exile = Array.isArray(player.exile) ? [...player.exile] : [];
  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const keptHand: any[] = [];
  const keptExile: any[] = [];
  const keptGraveyard: any[] = [];

  for (const card of hand) {
    const cardId = String((card as any)?.id || '').trim();
    if (wanted.has(cardId)) moved.push(card);
    else keptHand.push(card);
  }
  for (const card of exile) {
    const cardId = String((card as any)?.id || '').trim();
    if (wanted.has(cardId)) moved.push(card);
    else keptExile.push(card);
  }
  for (const card of graveyard) {
    const cardId = String((card as any)?.id || '').trim();
    if (wanted.has(cardId)) moved.push(card);
    else keptGraveyard.push(card);
  }

  if (moved.length === 0) return { state, log: [] };
  const library = Array.isArray(player.library) ? [...player.library, ...moved] : [...moved];
  const updatedPlayers = state.players.map(p =>
    p.id === playerId
      ? ({ ...(p as any), library, hand: keptHand, exile: keptExile, graveyard: keptGraveyard } as any)
      : p
  );
  return {
    state: { ...state, players: updatedPlayers as any } as GameState,
    log: [`${playerId} shuffles ${moved.length} revealed card(s) into their library`],
  };
}
