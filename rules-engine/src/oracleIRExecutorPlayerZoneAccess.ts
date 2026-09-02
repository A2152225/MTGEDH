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
  if (fromPlayer.length > 0) return fromPlayer;
  if (zone === 'library') {
    const serverLibs = getAttachedServerLibraries(state);
    const external = serverLibs?.get(playerId);
    if (Array.isArray(external) && external.length > 0) return [...external];
  }
  const fromZones = (state as any)?.zones?.[playerId]?.[zone];
  if (Array.isArray(fromZones) && fromZones.length > 0) return [...fromZones];
  if (zone === 'library') {
    const serverLibs = getAttachedServerLibraries(state);
    const external = serverLibs?.get(playerId);
    return Array.isArray(external) ? [...external] : fromPlayer;
  }
  return fromPlayer;
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

function trimId(value: unknown): string {
  return String(value || '').trim();
}

/** 903.9a: write a commander into player / zones / commandZone.inCommandZone tracking. */
export function writePlayerCommandZoneCard(
  state: GameState,
  playerId: PlayerID,
  player: any,
  card: any,
  idsToMark?: readonly string[],
): any {
  const ownerId = trimId(playerId) || trimId(player?.id);
  const commandCard = { ...(card || {}), zone: 'command' };
  const playerCz = Array.isArray(player?.commandZone) ? [...player.commandZone] : [];
  playerCz.push(commandCard);
  player.commandZone = playerCz;
  player.command = playerCz;

  if (!ownerId) return commandCard;

  const zones = ((state as any).zones || ((state as any).zones = {}));
  const ownerZones = zones[ownerId] || (zones[ownerId] = {});
  const zoneCz = Array.isArray(ownerZones.commandZone) ? [...ownerZones.commandZone] : [];
  zoneCz.push(commandCard);
  ownerZones.commandZone = zoneCz;
  ownerZones.commandZoneCount = zoneCz.length;

  const tracking = ((state as any).commandZone || ((state as any).commandZone = {}));
  const info = tracking[ownerId] || (tracking[ownerId] = { commanderIds: [], inCommandZone: [] });
  const inCz = Array.isArray(info.inCommandZone) ? [...info.inCommandZone] : [];
  const commanderIds: string[] = Array.isArray(info.commanderIds) ? info.commanderIds.map(trimId).filter(Boolean) : [];
  const marked = new Set<string>((idsToMark || []).map(trimId).filter(Boolean));
  const cardId = trimId(commandCard?.id);
  if (cardId) marked.add(cardId);
  for (const id of commanderIds) {
    if ([...marked].some((entry) => entry === id || entry.startsWith(id) || id.startsWith(entry))) {
      marked.add(id);
    }
  }
  for (const id of marked) {
    if (!inCz.includes(id)) inCz.push(id);
  }
  info.inCommandZone = inCz;
  const cards = Array.isArray(info.commanderCards) ? [...info.commanderCards] : [];
  if (cardId && !cards.some((entry: any) => trimId(entry?.id) === cardId)) {
    cards.push(commandCard);
  }
  info.commanderCards = cards;
  tracking[ownerId] = info;
  return commandCard;
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
