import type { PlayerID } from "../../../../shared/src/types.js";
import {
  getDurablePlayableFromExilePermissionForCard,
  removeCardIdFromDurablePlayableFromExilePermissions,
  type DurablePlayableFromExileAction,
} from "./durable-permissions.js";

export function getPlayableFromExileDurablePermissionForCard(
  state: any,
  playerId: PlayerID,
  card: any,
  action?: DurablePlayableFromExileAction,
) {
  return getDurablePlayableFromExilePermissionForCard(state, playerId, card, action);
}

function getPlayableFromExileEntry(state: any, playerId: PlayerID): any {
  const playableFromExile = (state as any)?.playableFromExile;
  if (!playableFromExile || typeof playableFromExile !== 'object') return undefined;
  return (playableFromExile as any)[playerId];
}

function isCardMarkedPlayableFromExile(state: any, playerId: PlayerID, cardId: string, currentTurn: number): boolean {
  const entry = getPlayableFromExileEntry(state, playerId);
  if (Array.isArray(entry)) {
    return entry.includes(cardId);
  }
  if (!entry || typeof entry !== 'object') {
    return false;
  }

  const marker = entry[cardId];
  return typeof marker === 'number' ? marker >= currentTurn : Boolean(marker);
}

function playerMatchesPlayableFromExilePermission(canBePlayedBy: any, playerId: PlayerID): boolean {
  if (Array.isArray(canBePlayedBy)) {
    return canBePlayedBy.some((entry) => String(entry || '') === String(playerId || ''));
  }
  return String(canBePlayedBy || '') === String(playerId || '');
}

function getExileZoneForPlayer(state: any, playerId: string): any[] {
  const zoneExile = (state as any)?.zones?.[playerId]?.exile;
  if (Array.isArray(zoneExile)) {
    return zoneExile;
  }

  const legacyExile = (state as any)?.exile?.[playerId];
  return Array.isArray(legacyExile) ? legacyExile : [];
}

function getPlayersWithExileZones(state: any): string[] {
  const playerIds = new Set<string>();

  const zones = (state as any)?.zones;
  if (zones && typeof zones === 'object') {
    for (const playerId of Object.keys(zones)) {
      playerIds.add(String(playerId));
    }
  }

  const legacyExile = (state as any)?.exile;
  if (legacyExile && typeof legacyExile === 'object') {
    for (const playerId of Object.keys(legacyExile)) {
      playerIds.add(String(playerId));
    }
  }

  return [...playerIds];
}

export function cardAllowsPlayerToPlayFromExile(card: any, playerId: PlayerID, currentTurn: number): boolean {
  if (!card || typeof card !== 'object') return false;
  if (!playerMatchesPlayableFromExilePermission((card as any)?.canBePlayedBy, playerId)) {
    return false;
  }

  const playableUntilTurn = (card as any)?.playableUntilTurn;
  return typeof playableUntilTurn === 'number'
    ? playableUntilTurn >= currentTurn
    : Boolean(playableUntilTurn);
}

export function getPlayableExileCardsForPlayer(state: any, playerId: PlayerID): any[] {
  if (!state || typeof state !== 'object') return [];

  const normalizedPlayerId = String(playerId || '');
  const currentTurn = Number((state as any)?.turnNumber ?? 0);
  const seen = new Set<string>();
  const cards: any[] = [];

  const appendCards = (zoneOwnerId: string, zoneCards: any[], includeAll: boolean) => {
    for (const card of zoneCards) {
      if (!card || typeof card === 'string') continue;

      const cardId = String((card as any)?.id || '');
      if (!cardId) continue;

      if (!includeAll) {
        const hasMarker = isCardMarkedPlayableFromExile(state, playerId, cardId, currentTurn);
        const cardAllows = cardAllowsPlayerToPlayFromExile(card, playerId, currentTurn);
        const durablePermission = getPlayableFromExileDurablePermissionForCard(state, playerId, card);
        if (!hasMarker && !cardAllows && !durablePermission) {
          continue;
        }
      }

      const dedupeKey = `${zoneOwnerId}:${cardId}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      cards.push(card);
    }
  };

  appendCards(normalizedPlayerId, getExileZoneForPlayer(state, normalizedPlayerId), true);

  for (const zoneOwnerId of getPlayersWithExileZones(state)) {
    if (zoneOwnerId === normalizedPlayerId) continue;
    appendCards(zoneOwnerId, getExileZoneForPlayer(state, zoneOwnerId), false);
  }

  return cards;
}

export function findPlayableExileCardForPlayer(state: any, playerId: PlayerID, cardId: string): any | undefined {
  const normalizedCardId = String(cardId || '');
  if (!normalizedCardId) return undefined;
  return getPlayableExileCardsForPlayer(state, playerId).find((card: any) => String(card?.id || '') === normalizedCardId);
}

export function removeCardFromAnyPlayerExile(state: any, cardId: string): { card: any; ownerId: string } | undefined {
  const normalizedCardId = String(cardId || '');
  if (!state || typeof state !== 'object' || !normalizedCardId) return undefined;

  for (const ownerId of getPlayersWithExileZones(state)) {
    const exileZone = getExileZoneForPlayer(state, ownerId);
    const exileIndex = exileZone.findIndex((card: any) => String(card?.id || '') === normalizedCardId);
    if (exileIndex === -1) continue;

    const [card] = exileZone.splice(exileIndex, 1);

    if ((state as any)?.zones?.[ownerId] && Array.isArray((state as any).zones[ownerId].exile)) {
      (state as any).zones[ownerId].exileCount = exileZone.length;
    }

    const playerEntry = Array.isArray((state as any)?.players)
      ? ((state as any).players as any[]).find((player: any) => String(player?.id || '') === ownerId)
      : undefined;
    if (playerEntry && Array.isArray((playerEntry as any).exile) && (playerEntry as any).exile !== exileZone) {
      const playerExile = (playerEntry as any).exile as any[];
      const playerIndex = playerExile.findIndex((entry: any) => String(entry?.id || '') === normalizedCardId);
      if (playerIndex !== -1) {
        playerExile.splice(playerIndex, 1);
      }
    }

    return { card, ownerId };
  }

  return undefined;
}

export function stripPlayableFromExileTags(card: any): void {
  try {
    if (!card || typeof card !== "object") return;
    delete (card as any).canBePlayedBy;
    delete (card as any).playableUntilTurn;
  } catch {
    // ignore
  }
}

function removeCardIdFromLegacyArray(entry: any, cardId: string): void {
  if (!Array.isArray(entry)) return;
  const idx = entry.indexOf(cardId);
  if (idx >= 0) entry.splice(idx, 1);
}

function removeCardIdFromMap(entry: any, cardId: string): void {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return;
  if (cardId in entry) delete entry[cardId];
}

/**
 * Removes any playable-from-exile permission for this card, across *all* players.
 *
 * This is intentionally global: once the card leaves exile, any cached permission
 * becomes stale regardless of who it was granted to.
 */
export function removePlayableFromExileForCard(state: any, cardId: string): void {
  try {
    if (!state || typeof state !== "object") return;
    const pfe = (state as any).playableFromExile;
    if (!pfe || typeof pfe !== "object") return;

    for (const playerId of Object.keys(pfe) as PlayerID[]) {
      const entry = (pfe as any)[playerId];
      removeCardIdFromLegacyArray(entry, cardId);
      removeCardIdFromMap(entry, cardId);
    }
  } catch {
    // ignore
  }
}

export function cleanupCardLeavingExile(state: any, card: any): void {
  const cardId = card?.id;
  if (typeof cardId === "string" && cardId.length > 0) {
    removePlayableFromExileForCard(state, cardId);
    removeCardIdFromDurablePlayableFromExilePermissions(state, cardId);
  }

  stripPlayableFromExileTags(card);
}
