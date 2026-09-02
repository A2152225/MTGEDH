/**
 * Origin: oracleIRExecutorZoneOps.ts
 * Cluster: MoveZoneSingleTargetCriteria type, static mana/power constraint parsers,
 * and parseMoveZoneSingleTargetCriteria. Extracted just-in-time so graveyard count
 * parsers can import them without importing the parent.
 * Public entry symbols: MoveZoneSingleTargetCriteria, parseMoveZoneSingleTargetCriteria.
 */
import {
  LOOSE_TYPE_WORD_FALLBACKS,
  normalizeCardColor,
  normalizeCreatureTypeCriteriaTerm,
  normalizeTypeCriteriaTerm,
  parseCompoundCardTypeFromText,
  parseSimpleCardTypeFromText,
  splitTypeCriteriaList,
} from './oracleIRExecutorZoneOpsCardTypeMatchers';
import type { SimpleCardType } from './oracleIRExecutorZoneOpsCardTypeMatchers';

export type MoveZoneSingleTargetCriteria = {
  readonly cardType: SimpleCardType;
  readonly fromHandOrGraveyardOwner?: 'controller' | 'target_player';
  readonly manaValueLte?: number;
  readonly manaValueAnyOf?: readonly number[];
  readonly manaValueLtReferencePower?: boolean;
  readonly manaValueLteReferencePower?: boolean;
  readonly manaValueLtReferenceLoyalty?: boolean;
  readonly milledThisTurn?: boolean;
  /** Graveyard card put there from a library this turn (mill / similar). */
  readonly putIntoGraveyardFromLibraryThisTurn?: boolean;
  readonly hasXManaCost?: boolean;
  readonly powerLte?: number;
  readonly powerGte?: number;
  readonly notNamed?: string;
  readonly requiresHistoric?: boolean;
  readonly requiresAdventure?: boolean;
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
  readonly requiresForetell?: boolean;
  readonly requiresFlashback?: boolean;
  readonly requiresAwaken?: boolean;
  readonly requiresNonbattle?: boolean;
  readonly excludeBasicLands?: boolean;
  readonly manaValueLtReferenceManaValue?: boolean;
  readonly requiredNamed?: string;
  readonly excludePutIntoGraveyardThisTurn?: boolean;
  readonly differentNames?: boolean;
  readonly manaValueGte?: number;
  readonly isColorless?: boolean;
  readonly multicoloredOnly?: boolean;
  readonly manaValueEqReferenceChargeCounters?: boolean;
  readonly timeCountersEqualManaValue?: boolean;
  readonly graveyardOwner?: 'opponent';
};

function parseStaticManaValueLteConstraint(typeText: string): MoveZoneSingleTargetCriteria | null {
  const normalized = String(typeText || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;

  const numericConstraintMatch =
    normalized.match(/^(.+?)(?:\s+cards?)?(?:\s+each)?\s+with\s+mana\s+value\s+(\d+|x)\s+or\s+less$/i) ||
    normalized.match(/^(.+?)\s+with\s+mana\s+value\s+(\d+|x)\s+or\s+less$/i);
  if (!numericConstraintMatch) return null;

  const typePart = String(numericConstraintMatch[1] || '')
    .trim()
    .replace(/\s+cards?$/i, '');
  const mvToken = String(numericConstraintMatch[2] || '').trim().toLowerCase();
  const manaValueLte = mvToken === 'x' ? -1 : Number.parseInt(mvToken, 10);
  if (!Number.isFinite(manaValueLte)) return null;

  if (/^multicolored(?:\s+permanent)?$/i.test(typePart)) {
    return { cardType: 'permanent', multicoloredOnly: true, manaValueLte };
  }

  const parsedCardType =
    !typePart || /^cards?$/i.test(typePart)
      ? ('any' as const)
      : parseCompoundCardTypeFromText(typePart) || parseSimpleCardTypeFromText(typePart);
  if (parsedCardType) {
    return { cardType: parsedCardType, manaValueLte };
  }

  const subtypePermanentMatch = typePart.match(/^([a-z][a-z'-]+)\s+permanent(?:\s+card)?$/i);
  if (subtypePermanentMatch) {
    return {
      cardType: 'permanent',
      typeLineTermsAnyOf: [String(subtypePermanentMatch[1] || '').trim().toLowerCase()],
      manaValueLte,
    };
  }

  return null;
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

export function parseMoveZoneSingleTargetCriteria(typeText: string): MoveZoneSingleTargetCriteria | null {
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
  if (/^nonland permanent card with mana value x$/i.test(normalized)) {
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
  let manaValueLtReferenceLoyalty = false;
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
  const dynamicLoyaltyConstraintMatch = normalizedTypeText.match(
    /^(.+?)\s+with\s+mana\s+value\s+less\s+than\s+(?:this|that)\s+permanent's\s+loyalty$/i
  );
  if (dynamicLoyaltyConstraintMatch) {
    normalizedTypeText = String(dynamicLoyaltyConstraintMatch[1] || '').trim();
    manaValueLtReferenceLoyalty = true;
  }

  const notNamedMatch = normalizedTypeText.match(/^(.+?)\s+not named\s+(.+)$/i);
  const nameExclusion = notNamedMatch ? String(notNamedMatch[2] || '').trim() : undefined;
  const baseTypeText = notNamedMatch ? String(notNamedMatch[1] || '').trim() : normalizedTypeText;

  normalizedTypeText = baseTypeText.replace(/\s+cards?$/i, '').trim();
  if (/^cards?$/i.test(normalizedTypeText)) return { cardType: 'any' };

  if (/^multicolored$/i.test(normalizedTypeText)) {
    return {
      cardType: 'any',
      multicoloredOnly: true,
      ...(nameExclusion ? { notNamed: nameExclusion } : {}),
    };
  }

  if (/^multicolored\s+permanent$/i.test(normalizedTypeText)) {
    return {
      cardType: 'permanent',
      multicoloredOnly: true,
      ...(nameExclusion ? { notNamed: nameExclusion } : {}),
    };
  }

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

  if (/^historic(?:\s+permanent)?$/i.test(normalized)) {
    return {
      cardType: 'permanent',
      requiresHistoric: true,
      ...(nameExclusion ? { notNamed: nameExclusion } : {}),
    };
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
    ...(manaValueLtReferenceLoyalty ? { manaValueLtReferenceLoyalty: true } : {}),
  };

  // "noncreature, nonland card" (Narset, Enlightened Exile) spans instants and sorceries, so it must
  // not collapse into the noncreature_nonland_permanent type those same words carry when the noun is
  // "permanent".
  if (/^noncreature,?\s+nonland$/i.test(normalizedTypeText) && /\bcards?$/i.test(baseTypeText)) {
    return { cardType: 'any', typeLineTermsNoneOf: ['creature', 'land'], ...sharedCriteriaExtras };
  }

  if (/^(?:card|permanent card) of the chosen type$/i.test(normalizedTypeText)) {
    return { cardType: 'any', usesChosenCreatureType: true, ...sharedCriteriaExtras };
  }

  if (/^creature card of the chosen type$/i.test(normalizedTypeText)) {
    return { cardType: 'creature', usesChosenCreatureType: true, ...sharedCriteriaExtras };
  }

  const subtypeCreatureMatch = normalizedTypeText.match(/^([a-z][a-z'-]+)\s+creature$/i);
  if (subtypeCreatureMatch) {
    const subtype = normalizeCreatureTypeCriteriaTerm(String(subtypeCreatureMatch[1] || ''));
    if (subtype) {
      return { cardType: 'creature', creatureTypesAnyOf: [subtype], ...sharedCriteriaExtras };
    }
  }

  if (/^card that has an adventure$/i.test(normalizedTypeText)) {
    return { cardType: 'any', requiresAdventure: true, ...sharedCriteriaExtras };
  }

  if (/^(?:card|permanent card) with a cycling ability$/i.test(normalizedTypeText)) {
    return { cardType: 'permanent', requiresCyclingAbility: true, ...sharedCriteriaExtras };
  }

  if (/^(?:card|permanent card) with a kicker ability$/i.test(normalizedTypeText)) {
    return { cardType: 'any', requiresKickerAbility: true, ...sharedCriteriaExtras };
  }

  if (/^(?:card|permanent card) with foretell$/i.test(normalizedTypeText)) {
    return { cardType: 'any', requiresForetell: true, ...sharedCriteriaExtras };
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

  const splitTerms = splitTypeCriteriaList(normalizedTypeText);
  const parsedCardType = parseSimpleCardTypeFromText(normalizedTypeText.replace(/\s+card$/i, '').trim());
  // "Equipment or Vehicle" would otherwise collapse to whichever type word the loose fallbacks test
  // first, silently dropping every other alternative. Combined types ("artifact or creature") come
  // back as a dedicated *_or_* type from an exact match, so they still win here.
  //
  // Only single-word alternatives are diverted: the typeLineTermsAnyOf fallback below matches each
  // term as a type-line substring, which a phrase like "Dragon creature card" never satisfies, so
  // multi-word disjunctions are still better served by the loose single-type reading.
  const collapsesDisjunction =
    splitTerms.length > 1 &&
    parsedCardType !== null &&
    LOOSE_TYPE_WORD_FALLBACKS.has(parsedCardType) &&
    splitTerms.every(term => !/\s/.test(normalizeTypeCriteriaTerm(term)));
  if (parsedCardType && !collapsesDisjunction) {
    return {
      cardType: parsedCardType,
      ...(requiredColors.length > 0 ? { colorsAllOf: requiredColors } : {}),
      ...(requiredAnyColors.length > 0 ? { colorsAnyOf: requiredAnyColors } : {}),
      ...(noAbilities ? { noAbilities: true } : {}),
      ...(requiredCounter ? { requiredCounter } : {}),
      ...(nameExclusion ? { notNamed: nameExclusion } : {}),
      ...(manaValueLtReferencePower ? { manaValueLtReferencePower: true } : {}),
      ...(manaValueLteReferencePower ? { manaValueLteReferencePower: true } : {}),
      ...(manaValueLtReferenceLoyalty ? { manaValueLtReferenceLoyalty: true } : {}),
    };
  }

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
  if (manaValueLtReferenceLoyalty) return { cardType: 'any', manaValueLtReferenceLoyalty: true };
  return manaValueLtReferencePower ? { cardType: 'any', manaValueLtReferencePower: true } : null;
}
