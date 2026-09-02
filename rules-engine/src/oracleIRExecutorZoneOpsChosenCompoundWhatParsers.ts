/**
 * Origin: oracleIRExecutorZoneOps.ts
 * Cluster: chosen-card / put-this-way / compound graveyard what-parsers and movers
 * from parseMoveZoneTheChosenCards through parseMoveZoneAnyNumberCardsTotalMvXFromYourGraveyard.
 * Public entry symbols: parseMoveZoneTheChosenCards, exileOneMatchingCardFromEachPlayersGraveyard,
 * putOneMatchingCardFromEachOpponentsGraveyardOntoBattlefield,
 * putAllMatchingCriteriaFromGraveyardOntoBattlefield, moveUnplayedExileCardsToGraveyard.
 */
import type { GameState, PlayerID } from '../../shared/src';
import { getCurrentTurnNumber, stampCardPutIntoGraveyardThisTurn } from './oracleIRExecutorPlayerUtils';
import {
  addBattlefieldPermanentsToState,
  createBattlefieldPermanentsFromCards,
} from './oracleIRExecutorZoneOpsBattlefieldEntry';
import {
  parseCompoundCardTypeFromText,
  parseSimpleCardTypeFromText,
  parseSmallNumberWord,
} from './oracleIRExecutorZoneOpsCardTypeMatchers';
import type { SimpleCardType } from './oracleIRExecutorZoneOpsCardTypeMatchers';
import { parseMoveZoneSingleTargetCriteria } from './oracleIRExecutorZoneOpsSingleTargetCriteria';
import type { MoveZoneSingleTargetCriteria } from './oracleIRExecutorZoneOpsSingleTargetCriteria';
import {
  cardMatchesMoveZoneSingleTargetCriteria,
  graveyardThisTurnCriteriaFromQualifier,
  normalizeCardNameForCriteria,
  stripPutIntoGraveyardThisTurnQualifier,
} from './oracleIRExecutorZoneOpsSingleTargetMatchers';
import { moveTargetedCardFromGraveyard } from './oracleIRExecutorZoneOpsTargetedMovers';
import { resolveFirstMatchingCardIdFromPlayerGraveyard } from './oracleIRExecutorZoneOpsUpToCountWhatParsers';

export function parseMoveZoneTheChosenCards(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'the chosen cards';
}

export function parseMoveZoneOneOfTheChosenCards(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'one of the chosen cards';
}

export function parseMoveZoneLastChosenCard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'the last chosen card';
}

export function parseMoveZoneOtherChosenCards(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'the other chosen cards';
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
  const raw = String((what as any).text || '')
    .replace(/[\u2019]/g, "'")
    .trim()
    .replace(/[.\s]+$/g, '');
  const withTurn = stripPutIntoGraveyardThisTurnQualifier(raw);
  const cleaned = withTurn.selectorText;
  const turnFlags = graveyardThisTurnCriteriaFromQualifier(withTurn);
  if (/^a card from each player's graveyard$/i.test(cleaned) || /^a card from each graveyard$/i.test(cleaned)) {
    return { cardType: 'any', ...turnFlags };
  }
  if (/^a card from each opponent's graveyard$/i.test(cleaned)) {
    return { cardType: 'any', graveyardOwner: 'opponent', ...turnFlags };
  }
  const eachOpponentMatch = cleaned.match(/^an?\s+(.+?)\s+card from each opponent's graveyard$/i);
  if (eachOpponentMatch) {
    const typeText = String(eachOpponentMatch[1] || '').trim();
    const parsed =
      parseSimpleCardTypeFromText(typeText) ||
      parseCompoundCardTypeFromText(typeText);
    if (parsed) return { cardType: parsed, graveyardOwner: 'opponent', ...turnFlags };
  }
  const eachGraveyardMatch = cleaned.match(/^an?\s+(.+?)\s+card from each graveyard$/i);
  if (eachGraveyardMatch) {
    const typeText = String(eachGraveyardMatch[1] || '').trim();
    const parsed =
      parseSimpleCardTypeFromText(typeText) ||
      parseCompoundCardTypeFromText(typeText);
    if (parsed) return { cardType: parsed, ...turnFlags };
  }
  const match = cleaned.match(/^an?\s+(.+?)\s+card from each player's graveyard$/i);
  if (!match) return null;
  const parsed = parseSimpleCardTypeFromText(String(match[1] || '').trim());
  if (!parsed) return null;
  return { cardType: parsed, ...turnFlags };
}

export function parseMoveZoneThisCreatureAndTargetYouControl(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly selectorText: string } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  const match = raw.match(/^this creature and target (.+?) you control$/i);
  if (!match) return null;
  const selectorText = `target ${String(match[1] || '').trim()} you control`;
  if (!selectorText || selectorText.length < 10) return null;
  return { selectorText };
}

export function parseMoveZoneThisCreatureAndAnotherTargetCreature(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  return /^this creature and another target creature$/i.test(raw);
}

export function parseMoveZoneThisPermanentAndAnotherTargetCreature(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  return /^this permanent and another target creature$/i.test(raw);
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
    const passiveTypedMatch = cleaned.match(/^a\s+(.+?)\s+card put into (?:your|a) graveyard this way$/i);
    if (passiveTypedMatch) {
      const parsed = parseSimpleCardTypeFromText(String(passiveTypedMatch[1] || '').trim());
      return parsed ? { cardType: parsed } : { cardType: 'any' };
    }
    if (/^put a card you put into your graveyard this way into your hand$/i.test(cleaned)) {
      return { cardType: 'any', putIntoGraveyardThisTurn: true };
    }
    if (/^each card put into a graveyard this way$/i.test(cleaned)) {
      return { cardType: 'any', putIntoGraveyardThisTurn: true };
    }
  }
  return null;
}

export function parseMoveZoneUpToCreatureCardsPutIntoGraveyardsThisWay(
  what: { readonly kind: string; readonly text?: string; readonly raw?: string },
  rawStep?: string
): { readonly maxCount: number; readonly cardType: SimpleCardType } | null {
  const candidates = [
    String((what as any).text || '').trim(),
    String((what as any).raw || '').trim(),
    String(rawStep || '').trim(),
  ].filter(Boolean);
  for (const raw of candidates) {
    const cleaned = raw.replace(/^[0-9+\s|.-]+\|\s*/i, '').replace(/[.\s]+$/g, '').trim();
    const match = cleaned.match(/^up to (two|\d+|[a-z]+) (.+?) cards? put into graveyards this way$/i);
    if (!match) continue;
    const maxCount = parseSmallNumberWord(String(match[1] || '').trim());
    if (!maxCount || maxCount < 1) continue;
    const cardType = parseSimpleCardTypeFromText(String(match[2] || '').trim()) || 'creature';
    return { maxCount, cardType };
  }
  return null;
}

export function parseMoveZoneAnyNumberFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const match = raw.match(/^any number of (.+?) from your graveyard$/);
  if (!match) return null;
  let typeText = String(match[1] || '').trim();
  const differentNames = /\bwith different names\b/i.test(typeText);
  typeText = typeText.replace(/\s+with different names\b/i, '').trim();
  typeText = typeText.replace(/\s+cards?$/i, '').trim();
  const simpleType = parseSimpleCardTypeFromText(typeText);
  if (simpleType) {
    return { cardType: simpleType, ...(differentNames ? { differentNames: true } : {}) };
  }
  const criteria = parseMoveZoneSingleTargetCriteria(typeText);
  if (!criteria) return null;
  return { ...criteria, ...(differentNames ? { differentNames: true } : {}) };
}

export type CountExiledWithSourceSpec = {
  readonly count: number;
  readonly cardType: SimpleCardType;
  readonly withRestToOwnersLibraryBottom?: boolean;
};

export function parseMoveZoneCountCardsExiledWithThisPermanent(
  what: { readonly kind: string; readonly text?: string; readonly raw?: string },
  step?: { readonly toRaw?: string; readonly raw?: string }
): CountExiledWithSourceSpec | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const match = raw.match(
    /^(\w+)\s+cards?\s+exiled with this (?:saga|enchantment|artifact|creature|permanent|card|land)$/
  );
  if (!match) return null;
  const count = parseSmallNumberWord(String(match[1] || '').trim());
  if (!count || count < 1) return null;
  const toRaw = String(step?.toRaw || step?.raw || '');
  const withRestToOwnersLibraryBottom =
    /\bput the rest on the bottom of their owners'? libraries\b/i.test(toRaw);
  return { count, cardType: 'any', ...(withRestToOwnersLibraryBottom ? { withRestToOwnersLibraryBottom: true } : {}) };
}

export function selectGraveyardCardIdsWithDifferentNames(
  graveyard: readonly any[],
  criteria: MoveZoneSingleTargetCriteria,
  preferredIds: readonly string[] = [],
  currentTurn?: number
): string[] {
  const preferred = preferredIds.map((id) => String(id || '').trim()).filter(Boolean);
  const matching = graveyard.filter((card) => {
    const cardId = String((card as any)?.id || '').trim();
    return cardId && cardMatchesMoveZoneSingleTargetCriteria(card, criteria, undefined, currentTurn);
  });
  const pool =
    preferred.length > 0
      ? preferred.filter((id) => matching.some((card) => String((card as any)?.id || '').trim() === id))
      : matching.map((card) => String((card as any)?.id || '').trim()).filter(Boolean);
  const selected: string[] = [];
  const seenNames = new Set<string>();
  for (const cardId of pool) {
    const card = matching.find((entry) => String((entry as any)?.id || '').trim() === cardId);
    if (!card) continue;
    const name = normalizeCardNameForCriteria(String((card as any)?.name || ''));
    if (!name || seenNames.has(name)) continue;
    seenNames.add(name);
    selected.push(cardId);
  }
  return selected;
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

export function parseMoveZoneTheNonlandCard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'the nonland card';
}

export type ExiledThisWayNotCastCriteria = {
  readonly cardType: 'any' | 'instant_or_sorcery';
  readonly withRestToLibraryBottom: boolean;
};

export function parseMoveZoneExiledThisWayNotCast(
  what: { readonly kind: string; readonly text?: string; readonly raw?: string },
  step?: { readonly raw?: string; readonly toRaw?: string }
): ExiledThisWayNotCastCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '')
    .trim()
    .toLowerCase()
    .replace(/[.\s]+$/g, '');
  if (
    raw === 'all cards exiled this way that weren\'t cast' ||
    raw === 'all cards exiled this way that were not cast' ||
    raw === 'cards exiled this way that weren\'t cast' ||
    raw === 'cards exiled this way that were not cast'
  ) {
    return { cardType: 'any', withRestToLibraryBottom: false };
  }
  if (
    /^the exiled instant and sorcery cards? that weren'?t cast this way$/i.test(raw) ||
    /^exiled instant and sorcery cards? that weren'?t cast this way$/i.test(raw)
  ) {
    const toRaw = String(step?.toRaw || step?.raw || '').toLowerCase();
    return {
      cardType: 'instant_or_sorcery',
      withRestToLibraryBottom: /\bthe rest\b/i.test(toRaw) || /\brest on the bottom\b/i.test(toRaw),
    };
  }
  return null;
}

export function resolveUncastExiledThisWayCardIds(
  state: GameState,
  playerId: PlayerID,
  exiledSnapshot: readonly any[],
  criteria: ExiledThisWayNotCastCriteria
): string[] {
  const player = state.players.find((entry) => entry.id === playerId) as any;
  const exile = Array.isArray(player?.exile) ? player.exile : [];
  const exileById = new Map(
    exile.map((card: any) => [String(card?.id || '').trim(), card] as const).filter(([id]) => Boolean(id))
  );

  const ids: string[] = [];
  for (const snapshot of exiledSnapshot) {
    const id = String((snapshot as any)?.id ?? (snapshot as any)?.cardId ?? '').trim();
    if (!id || !exileById.has(id)) continue;
    const card = exileById.get(id);
    if (
      criteria.cardType === 'instant_or_sorcery' &&
      !cardMatchesMoveZoneSingleTargetCriteria(card, { cardType: 'instant_or_sorcery' })
    ) {
      continue;
    }
    ids.push(id);
  }
  return ids;
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

export function putOneMatchingCardFromEachOpponentsGraveyardOntoBattlefield(
  state: GameState,
  controllerId: PlayerID,
  criteria: MoveZoneSingleTargetCriteria,
  preferredIds: readonly string[] = [],
  entersTapped?: boolean,
  entersFaceDown?: boolean,
  withCounters?: Record<string, number>,
): { readonly state: GameState; readonly log: readonly string[] } {
  let nextState = state;
  const log: string[] = [];
  const currentTurn = getCurrentTurnNumber(state);
  for (const player of state.players || []) {
    const playerId = String((player as any)?.id || '').trim() as PlayerID;
    if (!playerId || playerId === controllerId) continue;
    let cardId = resolveFirstMatchingCardIdFromPlayerGraveyard(nextState, playerId, [criteria], preferredIds);
    if (!cardId) {
      const graveyard = Array.isArray((nextState.players.find((entry) => entry.id === playerId) as any)?.graveyard)
        ? ((nextState.players.find((entry) => entry.id === playerId) as any).graveyard as any[])
        : [];
      const first = graveyard.find((card: any) =>
        cardMatchesMoveZoneSingleTargetCriteria(card, criteria, undefined, currentTurn),
      );
      cardId = String(first?.id || '').trim();
    }
    if (!cardId) continue;
    const result = moveTargetedCardFromGraveyard(
      nextState,
      playerId,
      cardId,
      criteria,
      'battlefield',
      controllerId,
      entersTapped,
      entersFaceDown,
      withCounters,
    );
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
}): { readonly count: number; readonly cardType: SimpleCardType; readonly upTo?: boolean; readonly useXValue?: boolean } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  if (/^x target cards? from a single graveyard$/i.test(raw)) {
    return { count: 0, cardType: 'any', useXValue: true };
  }
  if (/^up to x target cards? from a single graveyard$/i.test(raw)) {
    return { count: 0, cardType: 'any', useXValue: true, upTo: true };
  }
  const xTypedMatch = raw.match(/^x target (\w+) cards? from a single graveyard$/i);
  if (xTypedMatch) {
    const parsed = parseSimpleCardTypeFromText(String(xTypedMatch[1] || '').trim());
    if (parsed) return { count: 0, cardType: parsed, useXValue: true };
  }
  const upToUntypedMatch = raw.match(/^up to (\w+) target cards? from a single graveyard$/i);
  if (upToUntypedMatch) {
    const count = parseSmallNumberWord(String(upToUntypedMatch[1] || '').trim());
    if (!count || count < 1) return null;
    return { count, cardType: 'any', upTo: true };
  }
  const upToMatch = raw.match(/^up to (\w+) target (\w+) cards? from a single graveyard$/i);
  if (upToMatch) {
    const count = parseSmallNumberWord(String(upToMatch[1] || '').trim());
    const parsed = parseSimpleCardTypeFromText(String(upToMatch[2] || '').trim());
    if (!count || count < 1 || !parsed) return null;
    return { count, cardType: parsed, upTo: true };
  }
  const untypedMatch = raw.match(/^(\w+) target cards? from a single graveyard$/i);
  if (untypedMatch) {
    const count = parseSmallNumberWord(String(untypedMatch[1] || '').trim());
    if (!count || count < 1) return null;
    return { count, cardType: 'any' };
  }
  const match = raw.match(/^(\w+) target (\w+) cards? from a single graveyard$/i);
  if (!match) return null;
  const count = parseSmallNumberWord(String(match[1] || '').trim());
  const parsed = parseSimpleCardTypeFromText(String(match[2] || '').trim());
  if (!count || count < 1 || !parsed) return null;
  return { count, cardType: parsed };
}

export function parseMoveZoneThisPermanentAndUpToTargetFromSingleGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly count: number; readonly cardType: SimpleCardType; readonly upTo: true } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  const match = raw.match(/^this permanent and up to (\w+) target cards from a single graveyard$/i);
  if (!match) return null;
  const count = parseSmallNumberWord(String(match[1] || '').trim());
  if (!count || count < 1) return null;
  return { count, cardType: 'any', upTo: true };
}

export function parseMoveZoneUpToCountCardsYouOwnFromOutsideGame(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly count: number; readonly upTo: true } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  const match = raw.match(/^up to (\w+) cards you own from outside the game$/i);
  if (!match) return null;
  const count = parseSmallNumberWord(String(match[1] || '').trim());
  if (!count || count < 1) return null;
  return { count, upTo: true };
}

export function parseMoveZoneAllAurasAttachedToTargetPermanentYouOwn(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'all auras attached to target permanent you own';
}

export function parseMoveZoneThisCreatureAndCombatantsToLibraryTop(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'this creature and each creature blocking or blocked by it';
}

export function parseMoveZoneEachAttackingCreature(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'each attacking creature' || raw === 'all attacking creatures';
}

export function parseMoveZoneThisCardAndNamedCardsFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly namedCount: number } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const match = raw.match(
    /^this (?:card|permanent) and ([a-z]+|\d+) cards named this permanent from your graveyard$/
  );
  if (!match) return null;
  const namedCount = parseSmallNumberWord(String(match[1] || '').trim());
  if (!namedCount || namedCount < 1) return null;
  return { namedCount };
}

export function parseMoveZoneThisCardAndTargetFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): MoveZoneSingleTargetCriteria | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().replace(/[.\s]+$/g, '');
  const match = raw.match(/^this card and target (.+?) from your graveyard$/i);
  if (!match) return null;
  const typeText = String(match[1] || '').trim();
  return (
    parseMoveZoneSingleTargetCriteria(typeText) ||
    parseMoveZoneSingleTargetCriteria(`${typeText} card`) ||
    (parseSimpleCardTypeFromText(typeText.replace(/\s+cards?$/i, ''))
      ? { cardType: parseSimpleCardTypeFromText(typeText.replace(/\s+cards?$/i, ''))! }
      : null)
  );
}

export function parseMoveZoneExileUpToTargetPermanentsFromGySplitTwoPiles(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly maxCount: number } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  const match = raw.match(
    /^up to ([a-z]+|\d+) target permanent cards from your graveyard and separate them into two piles$/
  );
  if (!match) return null;
  const maxCount = parseSmallNumberWord(String(match[1] || '').trim());
  if (!maxCount || maxCount < 1) return null;
  return { maxCount };
}

export function parseMoveZoneAnyNumberCardsTotalMvXFromYourGraveyard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'any number of cards with total mana value x or less from your graveyard';
}
