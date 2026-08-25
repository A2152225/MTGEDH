/**
 * Origin: oracleIRExecutorZoneOps.ts
 * Cluster: shuffle-all / typed-card graveyard-into-library movers and their selector parser.
 * Public entry symbols: parseMoveZoneShuffleAllFromYourGraveyardIntoLibrary,
 * shufflePlayerGraveyardIntoLibrary, shuffleTypedCardsFromPlayerGraveyardIntoLibrary.
 */
import type { GameState, PlayerID } from '../../shared/src';
import {
  cardMatchesType,
  parseSimpleCardTypeFromText,
} from './oracleIRExecutorZoneOpsCardTypeMatchers';
import type { SimpleCardType } from './oracleIRExecutorZoneOpsCardTypeMatchers';

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
