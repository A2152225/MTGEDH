/**
 * Origin: oracleIRExecutorZoneOps.ts
 * Cluster: hand/library/exile linked-zone movers and what-parsers from
 * moveTargetedCardFromHandToLibrary through parseMoveZoneSingleTargetFromTargetPlayersExile
 * (stops before moveTargetedCardFromHand).
 * Public entry symbols: moveTargetedCardFromHandToLibrary, findCardsExiledWithSource,
 * shufflePlayerHandAndGraveyardIntoLibrary.
 */
import type { GameState, PlayerID } from '../../shared/src';
import {
  getCurrentTurnNumber,
  isCardExiledWithSource,
  stampCardPutIntoGraveyardThisTurn,
} from './oracleIRExecutorPlayerUtils';
import { parseSimpleCardTypeFromText } from './oracleIRExecutorZoneOpsCardTypeMatchers';
import type { SimpleCardType } from './oracleIRExecutorZoneOpsCardTypeMatchers';
import { normalizeBoundPlayerZoneSelectorText } from './oracleIRExecutorZoneOpsGraveyardCountParsers';
import { parseMoveZoneSingleTargetCriteria } from './oracleIRExecutorZoneOpsSingleTargetCriteria';
import type { MoveZoneSingleTargetCriteria } from './oracleIRExecutorZoneOpsSingleTargetCriteria';
import { cardMatchesMoveZoneSingleTargetCriteria } from './oracleIRExecutorZoneOpsSingleTargetMatchers';
import { moveTargetedCardFromGraveyard } from './oracleIRExecutorZoneOpsTargetedMovers';

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
  | {
      readonly kind: 'applied';
      readonly state: GameState;
      readonly log: readonly string[];
      readonly movedCards: readonly any[];
    }
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
  const movedCards = hand
    .filter((card: any) => movedIds.has(String(card?.id || '').trim()))
    .map((card: any) => ({
      ...card,
      owner: card?.owner || card?.ownerId || playerId,
      ownerId: card?.ownerId || card?.owner || playerId,
      controller: card?.controller || card?.controllerId || playerId,
      controllerId: card?.controllerId || card?.controller || playerId,
    }));
  const library = Array.isArray(player.library) ? [...player.library] : [];
  const nextLibrary = placement === 'top' ? [...movedCards, ...library] : [...library, ...movedCards];

  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), hand: keptHand, library: nextLibrary } as any) : p
  );

  return {
    kind: 'applied',
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} puts ${movedCards.length} card(s) from hand on the ${placement} of their library`],
    movedCards,
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

export function moveAnotherMatchingCardFromYourGraveyard(
  state: GameState,
  playerId: PlayerID,
  criteria: MoveZoneSingleTargetCriteria,
  destination: 'hand' | 'exile' | 'battlefield' | 'library_bottom',
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
    const relaxedResult = moveTargetedCardFromGraveyard(state, playerId, cardId, criteria, destination);
    return relaxedResult.kind === 'applied' ? relaxedResult : { kind: 'impossible' };
  }

  if (matches.length === 0) return { kind: 'impossible' };
  if (matches.length > 1) return { kind: 'player_choice_required' };

  const cardId = String((matches[0] as any)?.id || '').trim();
  const result = moveTargetedCardFromGraveyard(state, playerId, cardId, criteria, destination);
  return result.kind === 'applied' ? result : { kind: 'impossible' };
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
  return moveAnotherMatchingCardFromYourGraveyard(
    state,
    playerId,
    criteria,
    'exile',
    excludeCardIds,
    preferredIds
  );
}

export function shuffleCardsFromHandIntoLibrary(
  state: GameState,
  playerId: PlayerID
): {
  readonly state: GameState;
  readonly log: readonly string[];
  readonly movedCards: readonly any[];
} {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [], movedCards: [] };

  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  if (hand.length === 0) return { state, log: [], movedCards: [] };

  const library = Array.isArray(player.library) ? [...player.library] : [];
  const movedCards = hand.map((card: any) => ({
    ...card,
    owner: card?.owner || card?.ownerId || playerId,
    ownerId: card?.ownerId || card?.owner || playerId,
    controller: card?.controller || card?.controllerId || playerId,
    controllerId: card?.controllerId || card?.controller || playerId,
  }));
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), hand: [], library: [...library, ...hand] } as any) : p
  );

  return {
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} puts ${hand.length} card(s) from hand on the bottom of their library`],
    movedCards,
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

export function parseMoveZoneYourGraveyardAndHand(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return raw === 'your graveyard and hand';
}

export function shufflePlayerHandAndGraveyardIntoLibrary(
  state: GameState,
  playerId: PlayerID
): { readonly state: GameState; readonly log: readonly string[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [] };

  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const movingCards = [...hand, ...graveyard];
  if (movingCards.length === 0) return { state, log: [] };

  const library = Array.isArray(player.library) ? [...player.library] : [];
  const shuffled = [...movingCards];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  const updatedPlayers = state.players.map(p =>
    p.id === playerId
      ? ({ ...(p as any), hand: [], graveyard: [], library: [...library, ...shuffled] } as any)
      : p
  );
  return {
    state: { ...state, players: updatedPlayers as any } as GameState,
    log: [`${playerId} shuffled ${movingCards.length} card(s) from hand/graveyard into their library`],
  };
}

export function parseMoveZoneThisPermanentAndTheExiledCard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): boolean {
  if (what.kind !== 'raw') return false;
  const raw = String((what as any).text || '').trim().toLowerCase().replace(/[.\s]+$/g, '');
  return (
    raw === 'this saga and the exiled card' ||
    raw === 'this permanent and the exiled card' ||
    raw === 'this enchantment and the exiled card'
  );
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

export function parseMoveZoneTargetFaceUpExiledCard(what: {
  readonly kind: string;
  readonly text?: string;
  readonly raw?: string;
}): { readonly cardType: SimpleCardType; readonly faceUpOnly: true } | null {
  if (what.kind !== 'raw') return null;
  const raw = String((what as any).text || '')
    .trim()
    .toLowerCase()
    .replace(/[.\s]+$/g, '')
    .replace(/\s+/g, ' ');
  if (raw !== 'target face-up exiled card') return null;
  return { cardType: 'any', faceUpOnly: true };
}

export function cardIsFaceUpExiled(card: any): boolean {
  if ((card as any)?.faceDown === true) return false;
  if ((card as any)?.isFaceDown === true) return false;
  return true;
}

export function findFaceUpExiledCardLocation(
  state: GameState,
  preferredIds: readonly string[]
): { readonly playerId: PlayerID; readonly cardId: string } | null {
  const matches: Array<{ readonly playerId: PlayerID; readonly cardId: string }> = [];
  for (const player of state.players || []) {
    const playerId = String((player as any)?.id || '').trim() as PlayerID;
    if (!playerId) continue;
    const exile = Array.isArray((player as any)?.exile) ? (player as any).exile : [];
    for (const card of exile) {
      const cardId = String((card as any)?.id || '').trim();
      if (!cardId || !cardIsFaceUpExiled(card)) continue;
      matches.push({ playerId, cardId });
    }
  }
  if (matches.length === 0) return null;
  for (const preferredId of preferredIds) {
    const hit = matches.find((match) => match.cardId === preferredId);
    if (hit) return hit;
  }
  if (matches.length === 1) return matches[0];
  return matches[0] || null;
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
    /^target card with mana value x exiled with this (?:creature|artifact|enchantment|planeswalker|permanent|card|class|saga|land)$/i
  );
  if (targetMatch) {
    return { cardType: 'any', manaValueLte: -1 };
  }

  const match = cleaned.match(
    /^(?:a|an|the|target)\s+(.+?)\s+exiled with this (?:creature|artifact|enchantment|planeswalker|permanent|card|class|saga|land)$/i
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

  const match = cleaned.match(/^all\s+(.+?)\s+cards?\s+exiled with this (?:creature|artifact|enchantment|planeswalker|permanent|card|class|saga|land)$/i);
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
  const seenCardIds = new Set<string>();
  const currentTurn = getCurrentTurnNumber(state);

  const sourcePermanent = (state.battlefield || []).find(
    (perm: any) => String(perm?.id || '').trim() === wantedSourceId,
  ) as any;
  if (sourcePermanent) {
    const ownerId = String(
      sourcePermanent?.owner
      || sourcePermanent?.controller
      || '',
    ).trim() as PlayerID;
    const linkedOnPermanent = Array.isArray(sourcePermanent?.exiledCards) ? sourcePermanent.exiledCards : [];
    for (const card of linkedOnPermanent) {
      const cardId = String(card?.id || card?.cardId || '').trim();
      if (!cardId || seenCardIds.has(cardId)) continue;
      if (!cardMatchesMoveZoneSingleTargetCriteria(card, criteria, undefined, currentTurn)) continue;
      seenCardIds.add(cardId);
      matches.push({ playerId: ownerId, cardId, card });
    }
  }

  for (const player of state.players as any[]) {
    const playerId = String(player?.id || '').trim() as PlayerID;
    if (!playerId) continue;

    const exile = Array.isArray(player?.exile) ? player.exile : [];
    for (const card of exile) {
      const cardId = String(card?.id || card?.cardId || '').trim();
      if (!cardId || seenCardIds.has(cardId)) continue;
      if (!isCardExiledWithSource(card, wantedSourceId)) continue;
      if (!cardMatchesMoveZoneSingleTargetCriteria(card, criteria, undefined, currentTurn)) continue;
      seenCardIds.add(cardId);
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

