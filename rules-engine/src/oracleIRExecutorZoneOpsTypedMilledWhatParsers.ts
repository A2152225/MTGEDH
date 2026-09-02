/**
 * Origin: oracleIRExecutorZoneOps.ts
 * Cluster: typed-from-graveyard / among-milled / that-many / battlefield-bounce what-parsers
 * from parseMoveZoneShuffleAllTypedCardsOfThatTypeFromYourGraveyard through
 * parseMoveZoneCountTargetBattlefieldBounce.
 * Public entry symbols: parseMoveZoneTypedCardFromAmongMilledCards,
 * parseMoveZoneCountTargetBattlefieldBounce.
 */
import {
  BASIC_LAND_TYPE_NAMES,
} from './oracleIRExecutorZoneOpsAmongThemParsers';
import type { AmongThemMoveCriteria } from './oracleIRExecutorZoneOpsAmongThemParsers';
import {
  parseSimpleCardTypeFromText,
  parseSmallNumberWord,
} from './oracleIRExecutorZoneOpsCardTypeMatchers';
import type { SimpleCardType } from './oracleIRExecutorZoneOpsCardTypeMatchers';
import { normalizeBoundPlayerZoneSelectorText } from './oracleIRExecutorZoneOpsGraveyardCountParsers';
import { parseMoveZoneSingleTargetCriteria } from './oracleIRExecutorZoneOpsSingleTargetCriteria';
import type { MoveZoneSingleTargetCriteria } from './oracleIRExecutorZoneOpsSingleTargetCriteria';
import {
  graveyardThisTurnCriteriaFromQualifier,
  stripPutIntoGraveyardThisTurnQualifier,
} from './oracleIRExecutorZoneOpsSingleTargetMatchers';

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

export function parseMoveZoneTopTypedCardFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  const match = raw.match(/^the top (.+?) card of your graveyard$/i);
  if (!match) return null;
  const parsed = parseSimpleCardTypeFromText(String(match[1] || '').trim());
  if (!parsed) return null;
  return { cardType: parsed };
}

export function parseMoveZoneEachCreatureMvXOrLessFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  if (raw === 'each creature card with mana value x or less from your graveyard') {
    return { cardType: 'creature', manaValueLte: -1 };
  }
  return null;
}

export function parseMoveZoneTypedCardFromTargetPlayersGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = normalizeBoundPlayerZoneSelectorText(String((what as any).text || '').trim()).replace(/[.\s]+$/g, '');
  const withTurn = stripPutIntoGraveyardThisTurnQualifier(raw);
  const match = withTurn.selectorText.match(
    /^(?:a|an)\s+(.+?)\s+card\s+from\s+(?:target|that)\s+(?:player|opponent)'s\s+graveyard$/i,
  );
  if (!match) return null;
  const typeText = String(match[1] || '').trim();
  if (/creature/i.test(typeText) && /land/i.test(typeText)) {
    return { cardType: 'creature_or_land', ...graveyardThisTurnCriteriaFromQualifier(withTurn) };
  }
  const parsed = parseSimpleCardTypeFromText(typeText);
  if (!parsed) return null;
  return { cardType: parsed, ...graveyardThisTurnCriteriaFromQualifier(withTurn) };
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
  const parts = typeClause.includes(',')
    ? typeClause
        .split(',')
        .map(part => part.replace(/^\s*or\s+/i, '').trim())
        .filter(Boolean)
    : typeClause.split(/\s+or\s+/i).map(part => part.trim()).filter(Boolean);
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
    raw === 'cards from the top of your library equal to the damage prevented this way' ||
    raw === 'cards from the top of your library equal to the excess damage dealt to that creature this way'
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
  return (
    raw === 'all other cards revealed this way' ||
    raw === 'the rest of the revealed cards' ||
    raw === "all cards revealed this way that weren't put onto the battlefield"
  );
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
}): { readonly count: number; readonly selectorText: string; readonly useXValue?: boolean } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  if (
    /\bfrom\s+(?:target|that)\s+(?:player|opponent)'s\s+graveyard\b/i.test(raw) ||
    /\bfrom\s+your\s+graveyard\b/i.test(raw) ||
    /\bfrom\s+their\s+graveyard\b/i.test(raw) ||
    /\bfrom\s+a\s+graveyard\b/i.test(raw) ||
    /\bfrom\s+graveyards?\b/i.test(raw)
  ) {
    return null;
  }
  const upToXMatch = raw.match(/^up to x target (.+)$/i);
  if (upToXMatch) {
    const selectorText = `target ${String(upToXMatch[1] || '').trim()}`;
    if (selectorText.length > 7) return { count: 0, selectorText, useXValue: true };
  }
  const returnXMatch = raw.match(/^return x target (.+?)(?:\s+to\b.*)?$/i);
  if (returnXMatch) {
    const selectorText = `target ${String(returnXMatch[1] || '').trim()}`;
    if (selectorText.length > 7) return { count: 0, selectorText, useXValue: true };
  }
  const xTargetMatch = raw.match(/^x target (.+)$/i);
  if (xTargetMatch) {
    const selectorText = `target ${String(xTargetMatch[1] || '').trim()}`;
    if (selectorText.length > 7) return { count: 0, selectorText, useXValue: true };
  }
  const oneOrTwoTargetMatch = raw.match(/^one or two target (.+)$/i);
  if (oneOrTwoTargetMatch) {
    const selectorText = `target ${String(oneOrTwoTargetMatch[1] || '').trim()}`;
    if (selectorText.length > 7) return { count: 2, selectorText };
  }
  const returnAttackingMatch = raw.match(/^return (?:one or two|two) target attacking creatures(?:\s+to\b.*)?$/i);
  if (returnAttackingMatch) {
    return { count: 2, selectorText: 'target attacking creatures' };
  }
  const returnCreaturesMatch = raw.match(/^return (?:one or two|two) target creatures(?:\s+to\b.*)?$/i);
  if (returnCreaturesMatch) {
    return { count: 2, selectorText: 'target creatures' };
  }
  const returnNonlandPermanentsMatch = raw.match(
    /^(?:return )?(?:one or two|two) target nonland permanents(?:\s+to\b.*)?$/i
  );
  if (returnNonlandPermanentsMatch) {
    return { count: 2, selectorText: 'target nonland permanents' };
  }
  const returnAnyNumberControlledMatch = raw.match(/^return any number of target creatures you control(?:\s+to\b.*)?$/i);
  if (returnAnyNumberControlledMatch) {
    return { count: 99, selectorText: 'target creatures you control' };
  }
  const returnAnyNumberNonlandNontokenControlledMatch = raw.match(
    /^return any number of target nonland, nontoken permanents you control(?:\s+to\b.*)?$/i
  );
  if (returnAnyNumberNonlandNontokenControlledMatch) {
    return { count: 99, selectorText: 'target nonland, nontoken permanents you control' };
  }
  const anyNumberControlledMatch = raw.match(/^any number of target creatures you control$/i);
  if (anyNumberControlledMatch) {
    return { count: 99, selectorText: 'target creatures you control' };
  }
  const anyNumberNonlandNontokenControlledMatch = raw.match(
    /^any number of target nonland, nontoken permanents you control$/i
  );
  if (anyNumberNonlandNontokenControlledMatch) {
    return { count: 99, selectorText: 'target nonland, nontoken permanents you control' };
  }
  const anyNumberTargetMatch = raw.match(/^any number of target (.+)$/i);
  if (anyNumberTargetMatch) {
    const selectorText = `target ${String(anyNumberTargetMatch[1] || '').trim()}`;
    if (selectorText.length > 7) return { count: 99, selectorText };
  }
  const oneOrTwoCreaturesMatch = raw.match(/^(?:return )?(?:one or two|two) target creatures(?:\s+to\b.*)?$/i);
  if (oneOrTwoCreaturesMatch) {
    return { count: 2, selectorText: 'target creatures' };
  }
  const anotherTargetMatch = raw.match(/^another target (.+)$/i);
  if (anotherTargetMatch) {
    const selectorText = `target ${String(anotherTargetMatch[1] || '').trim()}`;
    if (selectorText.length > 7) return { count: 1, selectorText };
  }
  let match = raw.match(/^up to ([a-z0-9]+)\s+other\s+target\s+(.+)$/i);
  if (match) {
    const count = parseSmallNumberWord(String(match[1] || '').trim());
    const selectorText = `target ${String(match[2] || '').trim()}`;
    if (count && count >= 1 && selectorText) return { count, selectorText };
  }
  match = raw.match(/^up to ([a-z0-9]+)\s+target\s+(.+)$/i);
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
