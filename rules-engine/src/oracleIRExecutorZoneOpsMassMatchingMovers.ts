/**
 * Origin: oracleIRExecutorZoneOps.ts
 * Cluster: mass all-matching movers — moveAllMatchingFromExile through
 * putAllMatchingFromHandOntoBattlefieldWithController.
 * Public entry symbols: moveAllMatchingFromExile, exileAllMatchingFromGraveyard,
 * putAllMatchingFromGraveyardOntoBattlefield.
 */
import type { GameState, PlayerID } from '../../shared/src';
import {
  getCurrentTurnNumber,
  stampCardsPutIntoGraveyardThisTurn,
} from './oracleIRExecutorPlayerUtils';
import { clearPlayableFromExileForCards, stripPlayableFromExileTags } from './playableFromExile';
import {
  addBattlefieldPermanentsToState,
  createBattlefieldPermanentsFromCards,
} from './oracleIRExecutorZoneOpsBattlefieldEntry';
import {
  cardHasAnyColors,
  cardMatchesType,
} from './oracleIRExecutorZoneOpsCardTypeMatchers';
import type { SimpleCardType } from './oracleIRExecutorZoneOpsCardTypeMatchers';
import { cardHasFlashbackAbility } from './oracleIRExecutorZoneOpsKeywordAbilityPredicates';
import type { MoveZoneSingleTargetCriteria } from './oracleIRExecutorZoneOpsSingleTargetCriteria';
import {
  cardMatchesMoveZoneSingleTargetCriteria,
  normalizeCardNameForCriteria,
} from './oracleIRExecutorZoneOpsSingleTargetMatchers';
import { moveTargetedCardFromGraveyard } from './oracleIRExecutorZoneOpsTargetedMovers';
import { getCardTypeLineLower } from './oracleIRExecutorZoneOpsThisWayParsers';

const stripImpulsePermissionMarkers = stripPlayableFromExileTags;

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
    if (result.kind !== 'applied') continue;
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

function isBasicLandCard(card: any): boolean {
  const typeLine = getCardTypeLineLower(card);
  return /\bbasic\b/.test(typeLine) && /\bland\b/.test(typeLine);
}

export function exileAllMatchingFromGraveyard(
  state: GameState,
  playerId: PlayerID,
  cardType: SimpleCardType,
  options?: {
    readonly colorsAnyOf?: readonly string[];
    readonly excludeBasicLands?: boolean;
    readonly putIntoGraveyardThisTurn?: boolean;
    readonly currentTurn?: number;
    readonly requiresFlashback?: boolean;
    readonly faceDown?: boolean;
    readonly shuffleExiledPile?: boolean;
  }
): { state: GameState; log: string[]; moved?: any[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [] };

  const graveyard = Array.isArray(player.graveyard) ? [...player.graveyard] : [];
  const exile = Array.isArray(player.exile) ? [...player.exile] : [];
  const currentTurn = Number.isFinite(options?.currentTurn) ? Number(options?.currentTurn) : undefined;

  const kept: any[] = [];
  const moved: any[] = [];

  for (const card of graveyard) {
    if (!cardMatchesType(card, cardType)) {
      kept.push(card);
      continue;
    }
    if (options?.excludeBasicLands && isBasicLandCard(card)) {
      kept.push(card);
      continue;
    }
    if (options?.colorsAnyOf?.length && !cardHasAnyColors(card, options.colorsAnyOf)) {
      kept.push(card);
      continue;
    }
    if (options?.putIntoGraveyardThisTurn) {
      const putIntoGraveyardTurn = Number((card as any)?.putIntoGraveyardTurn);
      if (
        !Number.isFinite(putIntoGraveyardTurn) ||
        !Number.isFinite(currentTurn) ||
        putIntoGraveyardTurn !== currentTurn
      ) {
        kept.push(card);
        continue;
      }
    }
    if (options?.requiresFlashback && !cardHasFlashbackAbility(card)) {
      kept.push(card);
      continue;
    }
    moved.push(card);
  }

  let exiledCards = moved;
  if (options?.faceDown) {
    exiledCards = moved.map(card => ({ ...card, faceDown: true }));
  }
  if (options?.shuffleExiledPile && exiledCards.length > 1) {
    exiledCards = [...exiledCards];
    for (let index = exiledCards.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [exiledCards[index], exiledCards[swapIndex]] = [exiledCards[swapIndex], exiledCards[index]];
    }
  }

  if (exiledCards.length === 0) return { state, log: [], moved: [] };

  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), graveyard: kept, exile: [...exile, ...exiledCards] } as any) : p
  );
  return {
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} exiles ${moved.length} card(s) from graveyard`],
    moved,
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

export function moveAllMatchingFromLibrary(
  state: GameState,
  playerId: PlayerID,
  cardType: SimpleCardType,
  destination: 'exile'
): { state: GameState; log: string[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [] };

  const library = Array.isArray(player.library) ? [...player.library] : [];
  const exile = Array.isArray(player.exile) ? [...player.exile] : [];

  const kept: any[] = [];
  const moved: any[] = [];

  for (const card of library) {
    if (cardMatchesType(card, cardType)) moved.push(card);
    else kept.push(card);
  }

  if (moved.length === 0) return { state, log: [] };

  const nextPlayer: any = { ...(player as any), library: kept, exile: [...exile, ...moved] };
  const updatedPlayers = state.players.map(p => (p.id === playerId ? nextPlayer : p));
  return {
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} exiles ${moved.length} card(s) from library`],
  };
}

export function exileUpToCountFromHand(
  state: GameState,
  playerId: PlayerID,
  maxCount: number,
  cardType: SimpleCardType = 'any',
  preferredIds: readonly string[] = [],
  faceDown = false
): { readonly state: GameState; readonly log: readonly string[]; readonly movedCards: readonly any[] } {
  const player = state.players.find(p => p.id === playerId) as any;
  if (!player) return { state, log: [], movedCards: [] };

  const hand = Array.isArray(player.hand) ? [...player.hand] : [];
  const preferred = new Set(preferredIds.map(id => String(id || '').trim()).filter(Boolean));
  const ordered = [
    ...hand.filter((card: any) => preferred.has(String(card?.id || '').trim())),
    ...hand.filter((card: any) => !preferred.has(String(card?.id || '').trim())),
  ];
  const moved: any[] = [];
  const kept: any[] = [];
  for (const card of ordered) {
    if (moved.length < maxCount && cardMatchesType(card, cardType)) {
      moved.push(faceDown ? { ...card, faceDown: true } : card);
    } else {
      kept.push(card);
    }
  }
  if (moved.length === 0) return { state, log: [], movedCards: [] };

  const exile = Array.isArray(player.exile) ? [...player.exile] : [];
  const updatedPlayers = state.players.map(p =>
    p.id === playerId ? ({ ...(p as any), hand: kept, exile: [...exile, ...moved] } as any) : p
  );
  return {
    state: { ...state, players: updatedPlayers as any } as any,
    log: [`${playerId} exiles ${moved.length} card(s) from hand${faceDown ? ' face down' : ''}`],
    movedCards: moved,
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
