import type { GameState, PlayerID } from '../../shared/src';

export function stripPlayableFromExileTags(card: any): any {
  if (!card || typeof card !== 'object') return card;
  const { canBePlayedBy, playableUntilTurn, ...rest } = card as any;
  return rest;
}

export function clearPlayableFromExileForCards(state: GameState, playerId: PlayerID, cards: readonly any[]): GameState {
  const stateAny: any = state as any;
  const existing = stateAny.playableFromExile?.[playerId];
  if (!existing || typeof existing !== 'object') return state;

  let changed = false;
  const nextMap: Record<string, any> = { ...(existing as any) };
  for (const card of cards) {
    const id = String((card as any)?.id ?? (card as any)?.cardId ?? '');
    if (!id) continue;
    if (Object.prototype.hasOwnProperty.call(nextMap, id)) {
      delete nextMap[id];
      changed = true;
    }
  }
  if (!changed) return state;

  return {
    ...(stateAny as any),
    playableFromExile: {
      ...(stateAny.playableFromExile as any),
      [playerId]: nextMap,
    },
  } as any;
}

export function consumePlayableFromExileForCard(state: GameState, playerId: PlayerID, cardId: string): GameState {
  const id = String(cardId || '');
  if (!id) return state;

  const stateAny: any = state as any;
  const existing = stateAny.playableFromExile?.[playerId];
  if (!existing || typeof existing !== 'object') return state;

  if (!Object.prototype.hasOwnProperty.call(existing, id)) return state;

  const nextMap: any = { ...(existing as any) };
  delete nextMap[id];

  return {
    ...(stateAny as any),
    playableFromExile: {
      ...(stateAny.playableFromExile as any),
      [playerId]: nextMap,
    },
  } as any;
}
