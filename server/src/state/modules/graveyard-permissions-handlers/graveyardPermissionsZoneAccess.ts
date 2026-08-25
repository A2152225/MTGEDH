// Origin parent: server/src/state/modules/graveyard-permissions.ts
// Cluster moved: getPlayerGraveyardCollections, ensureCardSnapshotInPlayerGraveyard,
//   findCardInPlayerGraveyard.
// Public entry symbols: getPlayerGraveyardCollections, ensureCardSnapshotInPlayerGraveyard,
//   findCardInPlayerGraveyard.
// Leaf must not import graveyard-permissions.ts or graveyard-permissions-handlers/index.ts.

import type { PlayerID } from "../../../../../shared/src/index.js";
import { getCardId, normalizeText } from "./graveyardPermissionsCardUtils.js";

export function getPlayerGraveyardCollections(state: any, playerId: PlayerID): any[][] {
  const collections: any[][] = [];
  const zonesGraveyard = state?.zones?.[playerId]?.graveyard;
  if (Array.isArray(zonesGraveyard)) {
    collections.push(zonesGraveyard);
  }

  const playerEntry = Array.isArray(state?.players)
    ? state.players.find((entry: any) => String(entry?.id || '') === String(playerId || ''))
    : undefined;
  const playerGraveyard = Array.isArray(playerEntry?.graveyard) ? playerEntry.graveyard : undefined;
  if (Array.isArray(playerGraveyard) && playerGraveyard !== zonesGraveyard) {
    collections.push(playerGraveyard);
  }

  return collections;
}

export function ensureCardSnapshotInPlayerGraveyard(
  state: any,
  playerId: PlayerID,
  snapshot: any,
): any | undefined {
  const cardId = getCardId(snapshot);
  if (!state || !playerId || !cardId) return undefined;

  const existing = findCardInPlayerGraveyard(state, playerId, { cardId, cardName: String(snapshot?.name || '') });
  if (existing) return existing;

  const graveyardCard = {
    ...(snapshot as any),
    id: cardId,
    zone: 'graveyard',
  };

  state.zones = state.zones || {};
  state.zones[playerId] = state.zones[playerId] || {};
  const playerZones = state.zones[playerId];
  playerZones.graveyard = Array.isArray(playerZones.graveyard) ? playerZones.graveyard : [];
  playerZones.graveyard.push(graveyardCard);
  playerZones.graveyardCount = playerZones.graveyard.length;

  const playerEntry = Array.isArray(state.players)
    ? state.players.find((entry: any) => String(entry?.id || '') === String(playerId || ''))
    : undefined;
  if (playerEntry) {
    playerEntry.graveyard = Array.isArray(playerEntry.graveyard) ? playerEntry.graveyard : [];
    if (!playerEntry.graveyard.some((entry: any) => getCardId(entry) === cardId)) {
      playerEntry.graveyard.push({ ...graveyardCard });
    }
  }

  return graveyardCard;
}

export function findCardInPlayerGraveyard(
  state: any,
  playerId: PlayerID,
  options: { cardId?: string; cardName?: string },
): any | undefined {
  const cardId = String(options.cardId || '').trim();
  const cardName = normalizeText(options.cardName || '');
  const graveyards = getPlayerGraveyardCollections(state, playerId);

  if (cardId) {
    for (const graveyard of graveyards) {
      const card = graveyard.find((entry: any) => getCardId(entry) === cardId);
      if (card) return card;
    }
  }

  if (cardName) {
    for (const graveyard of graveyards) {
      const matches = graveyard.filter((entry: any) => normalizeText(entry?.name || '') === cardName);
      if (matches.length === 1) {
        return matches[0];
      }
    }
  }

  return undefined;
}
