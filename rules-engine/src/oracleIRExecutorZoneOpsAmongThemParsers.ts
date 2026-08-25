/**
 * Origin: oracleIRExecutorZoneOps.ts
 * Cluster: among-them move-zone types, type-constraint helpers, and
 * parseMoveZoneTypedCardFromAmongThem / parseMoveZoneAllOfThemWithThatName.
 * Public entry symbols: AmongThemMoveCriteria, ContextualThemSplitSpec,
 * parseMoveZoneAllOfThemWithThatName, parseMoveZoneTypedCardFromAmongThem,
 * stepHasAmongThemRestToLibrary.
 */
import {
  normalizeCardColor,
  parseCompoundCardTypeFromText,
  parseCreatureSubtypeWord,
  parseSimpleCardTypeFromText,
  parseSmallNumberWord,
} from './oracleIRExecutorZoneOpsCardTypeMatchers';
import type { MoveZoneSingleTargetCriteria } from './oracleIRExecutorZoneOpsSingleTargetCriteria';

export function stepHasAmongThemRestToLibrary(step: {
  readonly raw?: string;
  readonly toRaw?: string;
}): boolean {
  const raw = String(step.raw || '').toLowerCase();
  const toRaw = String(step.toRaw || '').toLowerCase();
  return /\bthe rest\b/.test(raw) || /\band the rest\b/.test(toRaw);
}

export type AmongThemMoveCriteria = MoveZoneSingleTargetCriteria & {
  readonly anyNumber?: boolean;
  readonly maxCount?: number;
  readonly totalManaValueLte?: number;
  readonly totalManaValueLteReferenceSacrificedArtifact?: boolean;
  readonly manaValueLteReferenceSacrificedCreaturePlus?: number;
  readonly differentPowers?: boolean;
  readonly bfHandSplit?: boolean;
  readonly bfLibraryBottomSplit?: boolean;
  readonly handGySplit?: boolean;
  readonly handLibraryBottomSplit?: boolean;
  readonly entersTappedFromWhat?: boolean;
};

export type ContextualThemSplitSpec =
  | { readonly kind: 'any_number_hand_graveyard_rest' }
  | { readonly kind: 'count_hand_graveyard_rest'; readonly count: number }
  | { readonly kind: 'count_hand_library_bottom'; readonly count: number }
  | { readonly kind: 'count_library_top_graveyard_rest'; readonly count: number }
  | { readonly kind: 'count_those_cards'; readonly count: number };

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
  const normalizedForSplit = normalized.replace(/\band\/or\b/gi, ' or ');
  if (!/,\s*|\s+or\s+/i.test(normalizedForSplit)) return null;
  const parts = normalizedForSplit
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

function parseAmongThemCreatureSubtype(typeText: string): string | null {
  return parseCreatureSubtypeWord(typeText);
}

export const BASIC_LAND_TYPE_NAMES = new Set(['plains', 'island', 'swamp', 'mountain', 'forest', 'wastes']);

/**
 * Simple permanent-type Oxford-comma lists, e.g. Warp World's
 * "artifact, creature, and land" (optionally including "planeswalker").
 * Restricted to a known small vocabulary so this never misparses unrelated
 * multi-clause type text handled elsewhere.
 */
const PERMANENT_TYPE_LIST_TERMS = new Set(['artifact', 'creature', 'land', 'planeswalker', 'enchantment', 'battle']);

function parsePermanentTypeOxfordCommaList(typeText: string): AmongThemMoveCriteria | null {
  const normalized = String(typeText || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!/,/.test(normalized) || !/\band\b/.test(normalized)) return null;

  const andSplit = normalized.match(/^(.+?),?\s+and\s+([a-z]+)$/i);
  if (!andSplit) return null;

  const headParts = String(andSplit[1] || '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
  const tailPart = String(andSplit[2] || '').trim();
  const parts = [...headParts, tailPart];
  if (parts.length < 2) return null;
  if (!parts.every(part => PERMANENT_TYPE_LIST_TERMS.has(part))) return null;

  return { cardType: 'permanent', typeLineTermsAnyOf: Array.from(new Set(parts)) };
}

export function parseRevealedThisWayTypeText(typeText: string): AmongThemMoveCriteria | null {
  const normalized = String(typeText || '').replace(/\s+/g, ' ').trim();
  if (/^non-aura permanent$/i.test(normalized)) {
    return { cardType: 'permanent', typeLineTermsNoneOf: ['aura'], anyNumber: true };
  }
  if (/^cards of the chosen type$/i.test(normalized)) {
    return { cardType: 'creature', anyNumber: true, usesChosenCreatureType: true };
  }
  const basicLandType = normalized.toLowerCase();
  if (BASIC_LAND_TYPE_NAMES.has(basicLandType)) {
    return { cardType: 'land', typeLineTermsAnyOf: [basicLandType], anyNumber: true };
  }
  const permanentTypeList = parsePermanentTypeOxfordCommaList(normalized);
  if (permanentTypeList) return { ...permanentTypeList, anyNumber: true };
  const creatureSubtype = parseCreatureSubtypeWord(normalized);
  if (creatureSubtype) {
    return { cardType: 'creature', creatureTypesAnyOf: [creatureSubtype], anyNumber: true };
  }
  const amongParsed = parseAmongThemTypeConstraints(normalized);
  if (amongParsed) return { ...amongParsed, anyNumber: true };
  const parsed = parseCompoundCardTypeFromText(normalized) || parseSimpleCardTypeFromText(normalized);
  if (!parsed) return null;
  return { cardType: parsed, anyNumber: true };
}

export function parseAmongThemTypeConstraints(typeText: string): AmongThemMoveCriteria | null {
  const normalized = String(typeText || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;

  const coloredPermanent = parseColoredPermanentAmongThem(normalized);
  if (coloredPermanent) return coloredPermanent;

  const compound = parseCompoundCardTypeFromText(normalized.replace(/\band\/or\b/gi, ' or '));
  if (compound) return { cardType: compound };

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

  if (/^legendary$/i.test(normalized)) {
    return { cardType: 'any', typeLineTermsAnyOf: ['legendary'] };
  }

  if (/^historic(?:\s+permanent)?$/i.test(normalized)) {
    return { cardType: 'any', requiresHistoric: true };
  }

  if (/^snow(?:\s+permanent)?$/i.test(normalized)) {
    return { cardType: 'permanent', typeLineTermsAnyOf: ['snow'] };
  }

  const parsed = parseSimpleCardTypeFromText(normalized);
  if (!parsed) return null;
  return { cardType: parsed };
}

function parseAmongThemSplitFromMoveZoneParts(
  cleaned: string,
  step?: {
    readonly to?: string;
    readonly toRaw?: string;
    readonly entersTapped?: boolean;
    readonly raw?: string;
  }
): AmongThemMoveCriteria | null {
  if (!step) return null;
  const toRaw = String(step.toRaw || '').toLowerCase();
  const stepRaw = String(step.raw || '').toLowerCase();
  const entersTapped =
    step.entersTapped === true ||
    /\btapped\b/i.test(toRaw) ||
    /\btapped\b/i.test(stepRaw) ||
    /\btapped\b/i.test(cleaned);

  const countBfOneHandMatch = cleaned.match(
    /^([a-z0-9]+) of them onto the battlefield(?: tapped)? and the other$/i
  );
  if (countBfOneHandMatch && step.to === 'hand') {
    const maxCount = parseSmallNumberWord(String(countBfOneHandMatch[1] || '').trim());
    if (maxCount && maxCount > 0) {
      return {
        cardType: 'any',
        maxCount,
        bfHandSplit: true,
        entersTappedFromWhat: entersTapped,
      };
    }
  }

  const restToLibrary = /\bthe rest\b/.test(toRaw) || /\bthe rest\b/.test(stepRaw);
  const restToGraveyard = /\bthe rest\b/.test(toRaw) && /\bgraveyard\b/.test(toRaw);
  if (restToGraveyard && step.to === 'hand') {
    const anyNumberHandGyMatch = cleaned.match(/^any number of (.+?) cards from among them$/i);
    if (anyNumberHandGyMatch) {
      const parsed = parseAmongThemTypeConstraints(String(anyNumberHandGyMatch[1] || '').trim());
      if (parsed) return { ...parsed, anyNumber: true, handGySplit: true };
    }
  }

  const toBattlefield =
    step.to === 'battlefield' ||
    /\bbattlefield\b/.test(toRaw) ||
    /\bonto the battlefield\b/.test(stepRaw);
  if (!restToLibrary || !toBattlefield) return null;

  const upToLandMatch = cleaned.match(/^up to ([a-z0-9]+) land cards from among them$/i);
  if (upToLandMatch) {
    const maxCount = parseSmallNumberWord(String(upToLandMatch[1] || '').trim());
    if (maxCount && maxCount > 0) {
      return {
        cardType: 'land',
        maxCount,
        bfLibraryBottomSplit: true,
        entersTappedFromWhat: entersTapped,
      };
    }
  }

  if (/^a land card from among them$/i.test(cleaned)) {
    return {
      cardType: 'land',
      maxCount: 1,
      bfLibraryBottomSplit: true,
      entersTappedFromWhat: entersTapped,
    };
  }

  if (/^any number of land cards from among them$/i.test(cleaned)) {
    return {
      cardType: 'land',
      anyNumber: true,
      bfLibraryBottomSplit: true,
      entersTappedFromWhat: entersTapped,
    };
  }

  const upToSacrificedArtifactTotalMvMatch = cleaned.match(
    /^up to ([a-z0-9]+) noncreature artifact cards with total mana value less than or equal to the sacrificed artifact's mana value from among them$/i
  );
  if (upToSacrificedArtifactTotalMvMatch) {
    const maxCount = parseSmallNumberWord(String(upToSacrificedArtifactTotalMvMatch[1] || '').trim());
    if (maxCount && maxCount > 0) {
      return {
        cardType: 'artifact',
        typeLineTermsNoneOf: ['creature'],
        maxCount,
        totalManaValueLteReferenceSacrificedArtifact: true,
        bfLibraryBottomSplit: true,
      };
    }
  }

  const upToCreatureTotalMvMatch = cleaned.match(
    /^up to ([a-z0-9]+) creature cards with total mana value (\d+) or less from among them$/i
  );
  if (upToCreatureTotalMvMatch) {
    const maxCount = parseSmallNumberWord(String(upToCreatureTotalMvMatch[1] || '').trim());
    const totalMv = Number.parseInt(String(upToCreatureTotalMvMatch[2] || ''), 10);
    if (maxCount && maxCount > 0 && Number.isFinite(totalMv)) {
      return {
        cardType: 'creature',
        maxCount,
        totalManaValueLte: totalMv,
        bfLibraryBottomSplit: true,
        entersTappedFromWhat: entersTapped,
      };
    }
  }

  const upToCreatureMvLteMatch = cleaned.match(
    /^up to ([a-z0-9]+) creature cards with mana value (\d+) or less from among them$/i
  );
  if (upToCreatureMvLteMatch) {
    const maxCount = parseSmallNumberWord(String(upToCreatureMvLteMatch[1] || '').trim());
    const manaValueLte = Number.parseInt(String(upToCreatureMvLteMatch[2] || ''), 10);
    if (maxCount && maxCount > 0 && Number.isFinite(manaValueLte)) {
      return {
        cardType: 'creature',
        maxCount,
        manaValueLte,
        bfLibraryBottomSplit: true,
        entersTappedFromWhat: entersTapped,
      };
    }
  }

  const upToPermanentMvLteMatch = cleaned.match(
    /^up to ([a-z0-9]+) permanent cards with mana value (\d+) or less from among them$/i
  );
  if (upToPermanentMvLteMatch) {
    const maxCount = parseSmallNumberWord(String(upToPermanentMvLteMatch[1] || '').trim());
    const manaValueLte = Number.parseInt(String(upToPermanentMvLteMatch[2] || ''), 10);
    if (maxCount && maxCount > 0 && Number.isFinite(manaValueLte)) {
      return {
        cardType: 'permanent',
        maxCount,
        manaValueLte,
        bfLibraryBottomSplit: true,
        entersTappedFromWhat: entersTapped,
      };
    }
  }

  const upToTypedMvLteFromAmongMatch = cleaned.match(
    /^up to ([a-z0-9]+) (.+?) cards with mana value (\d+) or less from among them$/i
  );
  if (upToTypedMvLteFromAmongMatch) {
    const maxCount = parseSmallNumberWord(String(upToTypedMvLteFromAmongMatch[1] || '').trim());
    const typeText = String(upToTypedMvLteFromAmongMatch[2] || '').trim();
    const manaValueLte = Number.parseInt(String(upToTypedMvLteFromAmongMatch[3] || ''), 10);
    if (maxCount && maxCount > 0 && Number.isFinite(manaValueLte)) {
      const parsed =
        parseAmongThemTypeConstraints(typeText) ||
        (parseCompoundCardTypeFromText(typeText) ? { cardType: parseCompoundCardTypeFromText(typeText)! } : null);
      if (parsed) {
        return {
          ...parsed,
          maxCount,
          manaValueLte,
          bfLibraryBottomSplit: true,
          entersTappedFromWhat: entersTapped,
        };
      }
    }
  }

  if (/^a creature card from among them$/i.test(cleaned)) {
    return {
      cardType: 'creature',
      maxCount: 1,
      bfLibraryBottomSplit: true,
      entersTappedFromWhat: entersTapped,
    };
  }

  const upToTypedFromAmongMatch = cleaned.match(/^up to ([a-z0-9]+) (.+?) cards from among them$/i);
  if (upToTypedFromAmongMatch) {
    const maxCount = parseSmallNumberWord(String(upToTypedFromAmongMatch[1] || '').trim());
    const typeText = String(upToTypedFromAmongMatch[2] || '').trim();
    if (maxCount && maxCount > 0 && typeText) {
      const parsed =
        parseAmongThemTypeConstraints(typeText) ||
        (parseCompoundCardTypeFromText(typeText) ? { cardType: parseCompoundCardTypeFromText(typeText)! } : null) ||
        (parseSimpleCardTypeFromText(typeText) ? { cardType: parseSimpleCardTypeFromText(typeText)! } : null);
      if (parsed) {
        return {
          ...parsed,
          maxCount,
          bfLibraryBottomSplit: true,
          entersTappedFromWhat: entersTapped,
        };
      }
    }
  }

  return null;
}

export function parseMoveZoneAllOfThemWithThatName(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return (
    raw === 'all of them with that name' ||
    raw === 'all cards with the chosen name from among them'
  );
}

export function parseMoveZoneTypedCardFromAmongThem(
  what: {
    readonly kind: string;
    readonly text?: string;
    readonly raw?: string;
  },
  step?: {
    readonly to?: string;
    readonly toRaw?: string;
    readonly entersTapped?: boolean;
    readonly raw?: string;
  }
): AmongThemMoveCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();

  const splitAmongThem = parseAmongThemSplitFromMoveZoneParts(cleaned, step);
  if (splitAmongThem) return splitAmongThem;

  if (/^a land card from among them onto the battlefield and the rest$/i.test(cleaned)) {
    return { cardType: 'land', bfHandSplit: true };
  }

  if (/^all land cards from among them onto the battlefield and the rest$/i.test(cleaned)) {
    return { cardType: 'land', anyNumber: true, bfHandSplit: true };
  }

  if (/^those land cards$/i.test(cleaned) && step) {
    const toRaw = String(step.toRaw || '').toLowerCase();
    if (/\bthe rest\b/.test(toRaw) && /\bbottom\b/.test(toRaw)) {
      return {
        cardType: 'land',
        anyNumber: true,
        bfLibraryBottomSplit: true,
        entersTappedFromWhat:
          step.entersTapped === true || /\btapped\b/i.test(toRaw) || /\btapped\b/i.test(String(step.raw || '')),
      };
    }
  }

  const upToLandBfLibraryBottomMatch = cleaned.match(
    /^up to ([a-z0-9]+) land cards from among them onto the battlefield(?: tapped)? and the rest$/i
  );
  if (upToLandBfLibraryBottomMatch) {
    const maxCount = parseSmallNumberWord(String(upToLandBfLibraryBottomMatch[1] || '').trim());
    if (maxCount && maxCount > 0) {
      return {
        cardType: 'land',
        maxCount,
        bfLibraryBottomSplit: true,
        entersTappedFromWhat: /\btapped\b/i.test(cleaned),
      };
    }
  }

  const anyNumberLandSplitMatch = cleaned.match(
    /^any number of land cards from among them onto the battlefield(?: tapped)? and the rest$/i
  );
  if (anyNumberLandSplitMatch) {
    return {
      cardType: 'land',
      anyNumber: true,
      bfHandSplit: true,
      entersTappedFromWhat: /\btapped\b/i.test(cleaned),
    };
  }

  const anyNumberBfHandSplitMatch = cleaned.match(
    /^any number of (.+?) cards from among them onto the battlefield and the rest$/i
  );
  if (anyNumberBfHandSplitMatch) {
    const parsed = parseAmongThemTypeConstraints(String(anyNumberBfHandSplitMatch[1] || '').trim());
    if (!parsed) return null;
    return { ...parsed, anyNumber: true, bfHandSplit: true };
  }

  const anyNumberConstrainedMatch = cleaned.match(
    /^any\s+number\s+of\s+(.+?)\s+cards?\s+with\s+mana\s+value\s+([x\d]+)(?:\s+or\s+less)?\s+from\s+among\s+them$/i
  );
  if (anyNumberConstrainedMatch) {
    const typeText = String(anyNumberConstrainedMatch[1] || '').trim();
    const parsed =
      parseAmongThemTypeConstraints(typeText) ||
      (parseCompoundCardTypeFromText(typeText) ? { cardType: parseCompoundCardTypeFromText(typeText)! } : null) ||
      (parseSimpleCardTypeFromText(typeText) ? { cardType: parseSimpleCardTypeFromText(typeText)! } : null);
    if (!parsed) return null;
    const mvToken = String(anyNumberConstrainedMatch[2] || '').trim().toLowerCase();
    if (mvToken === 'x') {
      return { ...parsed, anyNumber: true, manaValueLte: -1 };
    }
    const mv = Number.parseInt(mvToken, 10);
    if (!Number.isFinite(mv)) return null;
    return { ...parsed, anyNumber: true, manaValueLte: mv };
  }

  const upToXConstrainedMatch = cleaned.match(
    /^up to x (.+?) cards with mana value (\d+) or less from among them$/i
  );
  if (upToXConstrainedMatch) {
    const typeText = String(upToXConstrainedMatch[1] || '')
      .trim()
      .replace(/\band\/or\b/gi, ' or ');
    const parsed =
      parseAmongThemTypeConstraints(typeText) ||
      (parseCompoundCardTypeFromText(typeText) ? { cardType: parseCompoundCardTypeFromText(typeText)! } : null) ||
      (parseSimpleCardTypeFromText(typeText) ? { cardType: parseSimpleCardTypeFromText(typeText)! } : null);
    if (!parsed) return null;
    const mv = Number.parseInt(String(upToXConstrainedMatch[2] || ''), 10);
    if (!Number.isFinite(mv)) return null;
    return { ...parsed, maxCount: -1, manaValueLte: mv };
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

  const xCardsHandGyMatch = cleaned.match(/^x cards from among them$/i);
  if (xCardsHandGyMatch && step) {
    const toRaw = String(step.toRaw || '').toLowerCase();
    if (step.to === 'hand' && /\brest\b/i.test(toRaw) && /\bgraveyard\b/i.test(toRaw)) {
      return { cardType: 'any', maxCount: -1, handGySplit: true };
    }
  }

  const anyNumberMatch = cleaned.match(/^any\s+number\s+of\s+(.+?)\s+cards?\s+from\s+among\s+them$/i);
  if (anyNumberMatch) {
    const parsed = parseAmongThemTypeConstraints(String(anyNumberMatch[1] || '').trim());
    if (!parsed) return null;
    return { ...parsed, anyNumber: true };
  }

  if (/^all nonland cards chosen this way$/i.test(cleaned)) {
    return { cardType: 'nonland', anyNumber: true };
  }

  if (/^all land cards chosen this way$/i.test(cleaned)) {
    return { cardType: 'land', anyNumber: true, entersTappedFromWhat: true };
  }

  if (/^each card chosen this way$/i.test(cleaned)) {
    return { cardType: 'any', anyNumber: true };
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

  if (/^a nonland card from among them$/i.test(cleaned)) {
    return { cardType: 'nonland' };
  }

  if (/^(?:a|an)\s+card\s+from\s+among\s+them$/i.test(cleaned)) {
    return { cardType: 'any' };
  }

  const oneOfThoseMvMatch = cleaned.match(/^one of those cards with mana value (\d+) or less$/i);
  if (oneOfThoseMvMatch) {
    const manaValueLte = Number.parseInt(String(oneOfThoseMvMatch[1] || ''), 10);
    if (!Number.isFinite(manaValueLte)) return null;
    return { cardType: 'any', maxCount: 1, manaValueLte };
  }

  const constrainedThoseCardsMatch = cleaned.match(
    /^(?:a|an)\s+(.+?)\s+card(?:\s+with\s+mana\s+value\s+([x\d]+)(?:\s+or\s+less)?)?\s+from\s+among\s+those\s+cards$/i
  );
  if (constrainedThoseCardsMatch) {
    const typeText = String(constrainedThoseCardsMatch[1] || '').trim();
    const parsed =
      parseAmongThemTypeConstraints(typeText) ||
      (parseSimpleCardTypeFromText(typeText) ? { cardType: parseSimpleCardTypeFromText(typeText)! } : null);
    if (!parsed) return null;
    const mvToken = String(constrainedThoseCardsMatch[2] || '').trim().toLowerCase();
    if (mvToken === 'x') {
      return { ...parsed, manaValueLte: -1, manaValueLteReferenceSacrificedCreaturePlus: 1 };
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

  const powerGteAmongThemMatch = cleaned.match(
    /^(?:a|an)\s+(.+?)\s+card\s+with\s+power\s+(\d+)\s+or\s+greater\s+from\s+among\s+them$/i
  );
  if (powerGteAmongThemMatch) {
    const typeText = String(powerGteAmongThemMatch[1] || '').trim();
    const parsed =
      parseAmongThemTypeConstraints(typeText) ||
      (parseSimpleCardTypeFromText(typeText) ? { cardType: parseSimpleCardTypeFromText(typeText)! } : null);
    if (!parsed) return null;
    const powerGte = Number.parseInt(String(powerGteAmongThemMatch[2] || ''), 10);
    if (!Number.isFinite(powerGte)) return null;
    const result: AmongThemMoveCriteria = { ...parsed, powerGte };
    if (step && stepHasAmongThemRestToLibrary(step)) {
      return { ...result, bfLibraryBottomSplit: true };
    }
    return result;
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

