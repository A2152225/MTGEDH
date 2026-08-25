// Extracted from oracleIRExecutorPlayerUtils.ts.
// Cluster: player zone read/write plus graveyard-this-turn stamps.
// Public entries: readPlayerZoneCards, writePlayerZoneCards, getCurrentTurnNumber,
// stampCardPutIntoGraveyardThisTurn, stampCardsPutIntoGraveyardThisTurn.

import type { GameState, PlayerID } from '../../shared/src';

type PlayerZoneName = 'library' | 'hand' | 'graveyard' | 'exile';

function getAttachedServerLibraries(state: GameState): Map<PlayerID, any[]> | undefined {
  const libs = (state as any).__serverLibraries;
  return libs && typeof libs.get === 'function' ? libs : undefined;
}

export function readPlayerZoneCards(
  state: GameState,
  playerId: PlayerID,
  player: any,
  zone: PlayerZoneName,
): any[] {
  const fromPlayer = Array.isArray(player?.[zone]) ? [...player[zone]] : [];
  if (zone !== 'library' || fromPlayer.length > 0) return fromPlayer;
  const serverLibs = getAttachedServerLibraries(state);
  const external = serverLibs?.get(playerId);
  return Array.isArray(external) ? [...external] : fromPlayer;
}

export function writePlayerZoneCards(
  state: GameState,
  playerId: PlayerID,
  player: any,
  zone: PlayerZoneName,
  cards: any[],
): any[] {
  const next = [...cards];
  player[zone] = next;
  const zones = (state as any).zones;
  if (zones && typeof zones === 'object' && playerId) {
    const ownerZones = zones[playerId] || (zones[playerId] = {});
    ownerZones[zone] = next;
    ownerZones[`${zone}Count`] = next.length;
  }
  if (zone === 'library') {
    const serverLibs = getAttachedServerLibraries(state);
    if (serverLibs?.set) serverLibs.set(playerId, [...next]);
  }
  return next;
}

export function getCurrentTurnNumber(state: GameState): number {
  return Number((state as any).turnNumber ?? (state as any).turn ?? 0) || 0;
}

export function stampCardPutIntoGraveyardThisTurn(state: GameState, card: any): any {
  return {
    ...(card || {}),
    zone: 'graveyard',
    putIntoGraveyardTurn: getCurrentTurnNumber(state),
  };
}

export function stampCardsPutIntoGraveyardThisTurn(state: GameState, cards: readonly any[]): any[] {
  return (Array.isArray(cards) ? cards : []).map(card => stampCardPutIntoGraveyardThisTurn(state, card));
}
