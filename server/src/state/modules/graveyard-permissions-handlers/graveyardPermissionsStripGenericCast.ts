// Origin parent: server/src/state/modules/graveyard-permissions.ts
// Cluster moved: stripGenericGraveyardCastPermissionForCard.
// Public entry symbols: stripGenericGraveyardCastPermissionForCard.
// Leaf must not import graveyard-permissions.ts or graveyard-permissions-handlers/index.ts.

import type { PlayerID } from "../../../../../shared/src/index.js";
import { removeDurablePermissionsWhere } from "../durable-permissions.js";
import { getCardId } from "./graveyardPermissionsCardUtils.js";

export function stripGenericGraveyardCastPermissionForCard(
  state: any,
  playerId: PlayerID,
  cardId: string,
  source?: { sourceId?: string; sourceName?: string },
): void {
  if (!state || !playerId || !cardId) return;

  if (state.playableFromGraveyard?.[playerId]?.[cardId] !== undefined) {
    delete state.playableFromGraveyard[playerId][cardId];
    if (Object.keys(state.playableFromGraveyard[playerId]).length === 0) {
      delete state.playableFromGraveyard[playerId];
    }
  }

  const stripMarkers = (card: any) => {
    if (!card || getCardId(card) !== cardId) return card;
    if (
      card.canBePlayedBy == null
      && card.playableUntilTurn == null
      && card.graveyardCastCost == null
      && card.graveyardCastCostRaw == null
      && card.graveyardAdditionalCost == null
    ) {
      return card;
    }
    const next = { ...card };
    delete next.canBePlayedBy;
    delete next.playableUntilTurn;
    delete next.graveyardCastCost;
    delete next.graveyardCastCostRaw;
    delete next.graveyardAdditionalCost;
    return next;
  };

  const player = Array.isArray(state.players)
    ? state.players.find((entry: any) => String(entry?.id || '') === String(playerId))
    : undefined;
  if (player && Array.isArray(player.graveyard)) {
    player.graveyard = player.graveyard.map(stripMarkers);
  }
  if (state.zones?.[playerId] && Array.isArray(state.zones[playerId].graveyard)) {
    state.zones[playerId].graveyard = state.zones[playerId].graveyard.map(stripMarkers);
  }

  const sourceId = String(source?.sourceId || '').trim();
  const sourceName = String(source?.sourceName || '').trim().toLowerCase();

  if (Array.isArray(state.graveyardCastingPermissions)) {
    state.graveyardCastingPermissions = state.graveyardCastingPermissions.filter((permission: any) => {
      if (String(permission?.playerId || '') !== String(playerId)) return true;
      if (String(permission?.cardId || '') === cardId) return false;
      if (sourceId && String(permission?.sourceId || '').trim() === sourceId) return false;
      if (sourceName && String(permission?.sourceName || '').trim().toLowerCase() === sourceName) return false;
      const ids = Array.isArray(permission?.cardIds)
        ? permission.cardIds.map((id: any) => String(id || '').trim()).filter(Boolean)
        : Array.isArray(permission?.cardFilter?.cardIds)
          ? permission.cardFilter.cardIds.map((id: any) => String(id || '').trim()).filter(Boolean)
          : [];
      if (ids.length === 1 && ids[0] === cardId) return false;
      if (/\bgains?\s+escape\b/i.test(String(permission?.sourceText || ''))) return false;
      return true;
    });
    if (state.graveyardCastingPermissions.length === 0) {
      delete state.graveyardCastingPermissions;
    }
  }

  removeDurablePermissionsWhere(state, (permission) => {
    if (String(permission?.kind || '') !== 'graveyard_permission') return false;
    if (String(permission?.allowedAction || '') === 'activate') return false;
    if (String(permission?.grantedTo || '') !== String(playerId)) return false;
    if (sourceId && String(permission?.sourceId || '').trim() === sourceId) return true;
    if (sourceName && String(permission?.sourceName || '').trim().toLowerCase() === sourceName) return true;
    const affected = Array.isArray(permission?.cardFilter?.affectedCardIds)
      ? permission.cardFilter.affectedCardIds
      : [];
    if (affected.map((id) => String(id || '').trim()).includes(cardId)) return true;
    const sourceText = String(permission?.debug?.sourceText || '');
    return /\bgains?\s+escape\b/i.test(sourceText);
  });
}
