/**
 * Origin: oracleIRExecutorZoneOps.ts
 * Cluster: up-to-count / another-from-graveyard / exile-this-way what-parsers
 * from parseMoveZoneUpToTargetCountFromYourGraveyard through
 * parseMoveZoneUpToTargetCardsFromSingleGraveyard, plus exileUpToMatchingFromGraveyard
 * and resolveFirstMatchingCardIdFromPlayerGraveyard.
 * Public entry symbols: parseMoveZoneUpToTargetCountFromYourGraveyard,
 * exileUpToMatchingFromGraveyard, resolveFirstMatchingCardIdFromPlayerGraveyard.
 */
import type { GameState, PlayerID } from '../../shared/src';
import { getCurrentTurnNumber } from './oracleIRExecutorPlayerUtils';
import {
  parseCreatureSubtypeWord,
  parseSimpleCardTypeFromText,
  parseSmallNumberWord,
} from './oracleIRExecutorZoneOpsCardTypeMatchers';
import type { SimpleCardType } from './oracleIRExecutorZoneOpsCardTypeMatchers';
import {
  normalizeBoundPlayerZoneSelectorText,
  stripMoveZoneSelectorPrefix,
} from './oracleIRExecutorZoneOpsGraveyardCountParsers';
import { selectUpToMatchingFromGraveyardWithCriteria } from './oracleIRExecutorZoneOpsGraveyardSelectMoves';
import type { MoveZoneUpToTargetCountSpec } from './oracleIRExecutorZoneOpsHandSimpleWhatParsers';
import { parseMoveZoneSingleTargetCriteria } from './oracleIRExecutorZoneOpsSingleTargetCriteria';
import type { MoveZoneSingleTargetCriteria } from './oracleIRExecutorZoneOpsSingleTargetCriteria';
import {
  cardMatchesMoveZoneSingleTargetCriteria,
  stripFaceDownSuffix,
} from './oracleIRExecutorZoneOpsSingleTargetMatchers';

export function parseMoveZoneUpToTargetCountFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneUpToTargetCountSpec | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const xTargetFromGyMatch = cleaned.match(/^x target (.+?) from your graveyard$/i);
  if (xTargetFromGyMatch) {
    const typeText = String(xTargetFromGyMatch[1] || '').trim();
    if (typeText) {
      const criteria = parseMoveZoneSingleTargetCriteria(typeText);
      if (criteria) return { maxCount: 0, criteria, useXValue: true };
    }
  }
  const returnXMatch = cleaned.match(/^return x target (.+?) from your graveyard$/i);
  if (returnXMatch) {
    const typeText = String(returnXMatch[1] || '').trim();
    if (typeText) {
      const criteria = parseMoveZoneSingleTargetCriteria(typeText);
      if (criteria) return { maxCount: 0, criteria, useXValue: true };
    }
  }
  const upToXCardsMatch = cleaned.match(/^up to x (.+?) cards from your graveyard$/i);
  if (upToXCardsMatch) {
    const typeText = String(upToXCardsMatch[1] || '').trim();
    if (typeText) {
      const criteria =
        parseMoveZoneSingleTargetCriteria(typeText) ||
        (parseSimpleCardTypeFromText(typeText) ? { cardType: parseSimpleCardTypeFromText(typeText)! } : null);
      if (criteria) return { maxCount: 0, criteria, useXValue: true };
    }
  }
  if (/^up to x cards from your graveyard$/i.test(cleaned)) {
    return { maxCount: 0, criteria: { cardType: 'any' }, useXValue: true };
  }

  const oneOrTwoTargetMatch = cleaned.match(/^one or two target (.+?) from your graveyard$/i);
  if (oneOrTwoTargetMatch) {
    const typeText = String(oneOrTwoTargetMatch[1] || '').trim();
    if (typeText) {
      const criteria = parseMoveZoneSingleTargetCriteria(typeText);
      if (criteria) return { maxCount: 2, criteria };
    }
  }

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

export function parseMoveZoneUpToTargetCountFromYourHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneUpToTargetCountSpec | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[.\s]+$/g, '').trim();
  const upToTypedMatch = cleaned.match(/^up to (\w+) (.+?) cards from your hand$/i);
  if (!upToTypedMatch) return null;

  const amountToken = String(upToTypedMatch[1] || '').trim().toLowerCase();
  const typeText = String(upToTypedMatch[2] || '').trim();
  if (!typeText) return null;
  const criteria =
    parseMoveZoneSingleTargetCriteria(typeText) ||
    (parseSimpleCardTypeFromText(typeText) ? { cardType: parseSimpleCardTypeFromText(typeText)! } : null);
  if (!criteria) return null;

  if (amountToken === 'x') {
    return { maxCount: 0, criteria, useXValue: true };
  }

  const maxCount = parseSmallNumberWord(amountToken);
  if (!maxCount || maxCount < 1) return null;
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

export function parseMoveZoneAllCardsTheyExiledThisWay(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return (
    raw === 'all cards they exiled this way' ||
    raw === 'all cards exiled this way' ||
    raw === 'cards they exiled this way' ||
    raw === 'cards exiled this way'
  );
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
    !/^target nonland permanents?$/i.test(selectorText) &&
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
  return /^all(?:\s+the)?\s+cards from your library(?: face down)?$/.test(raw);
}

export function parseMoveZoneCountOfThemAtRandom(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly count: number } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  const match = raw.match(/^([a-z0-9]+) of them at random$/i);
  if (!match) return null;
  const count = parseSmallNumberWord(String(match[1] || '').trim());
  if (!count || count < 1) return null;
  return { count };
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

export function parseMoveZoneCreatureCardExiledThisWay(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'a creature card exiled this way';
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
    /^each creature card exiled with this (?:enchantment|artifact|creature|permanent|card|land)$/,
    /^each other card exiled with this (?:enchantment|artifact|creature|permanent|card|land)$/,
    /^the cards exiled with this (?:enchantment|artifact|creature|permanent|land)$/,
    /^all cards you own exiled with this (?:artifact|enchantment|permanent)$/,
    /^all other cards you own exiled with this (?:enchantment|artifact|permanent|card)$/,
    /^all other permanent cards exiled with this (?:enchantment|artifact|creature|permanent|card)$/,
  ];
  if (!patterns.some(pattern => pattern.test(raw))) return null;
  if (/^each creature card\b/.test(raw)) return { cardType: 'creature' };
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
  const typedMatch = cleaned.match(/^up to (\w+) target (\w+) cards? from graveyards$/i);
  if (typedMatch) {
    const maxCount = parseSmallNumberWord(String(typedMatch[1] || '').trim());
    const parsed = parseSimpleCardTypeFromText(String(typedMatch[2] || '').trim());
    if (maxCount && maxCount >= 1 && parsed) return { maxCount, cardType: parsed };
  }
  const nonTargetTypedMatch = cleaned.match(/^up to (\w+) (\w+) cards from graveyards$/i);
  if (nonTargetTypedMatch) {
    const maxCount = parseSmallNumberWord(String(nonTargetTypedMatch[1] || '').trim());
    const parsed = parseSimpleCardTypeFromText(String(nonTargetTypedMatch[2] || '').trim());
    if (maxCount && maxCount >= 1 && parsed) return { maxCount, cardType: parsed };
  }
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
