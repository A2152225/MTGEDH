// Origin parent: server/src/state/modules/graveyard-permissions.ts
// Cluster moved: addTemporaryGraveyardKeywordGrant.
// Public entry symbols: addTemporaryGraveyardKeywordGrant.
// Leaf must not import graveyard-permissions.ts or graveyard-permissions-handlers/index.ts.

import type { PlayerID } from "../../../../../shared/src/index.js";
import {
  buildDurableGraveyardActivationPermission,
  upsertDurablePermission,
} from "../durable-permissions.js";
import type { GraveyardGrantKeyword } from "./graveyardPermissionsTypes.js";
import { getCardId } from "./graveyardPermissionsCardUtils.js";
import { getTemporaryGraveyardKeywordGrants } from "./graveyardPermissionsKeywordGrantHelpers.js";
import { stripGenericGraveyardCastPermissionForCard } from "./graveyardPermissionsStripGenericCast.js";

export function addTemporaryGraveyardKeywordGrant(
  state: any,
  playerId: PlayerID,
  card: any,
  options: {
    keyword: GraveyardGrantKeyword;
    cost?: string;
    additionalExileCount?: number;
    sourceId?: string;
    sourceName?: string;
  },
): boolean {
  const cardId = getCardId(card);
  if (!state || !playerId || !cardId || !options.keyword) return false;

  state.temporaryGraveyardKeywordGrants = getTemporaryGraveyardKeywordGrants(state).filter((entry) =>
    !(entry
      && String(entry.playerId || '') === String(playerId || '')
      && String(entry.cardId || '') === cardId
      && String(entry.keyword || '') === String(options.keyword || '')
      && String(entry.sourceId || '') === String(options.sourceId || ''))
  );

  state.temporaryGraveyardKeywordGrants.push({
    playerId: String(playerId),
    cardId,
    keyword: options.keyword,
    ...(options.cost ? { cost: options.cost } : {}),
    ...(Number(options.additionalExileCount || 0) > 0 ? { additionalExileCount: Number(options.additionalExileCount) } : {}),
    ...(options.sourceId ? { sourceId: options.sourceId } : {}),
    ...(options.sourceName ? { sourceName: options.sourceName } : {}),
    expiresAt: 'end_of_turn',
    turnApplied: Number(state.turnNumber ?? state.turn ?? 0) || 0,
  });

  if (options.keyword === 'escape') {
    stripGenericGraveyardCastPermissionForCard(state, playerId, cardId, {
      sourceId: options.sourceId,
      sourceName: options.sourceName,
    });
  }

  if (options.keyword === 'unearth' || options.keyword === 'embalm') {
    upsertDurablePermission(state, buildDurableGraveyardActivationPermission({
      playerId,
      keyword: options.keyword,
      cardIds: [cardId],
      ...(options.cost ? { cost: options.cost } : {}),
      ...(Number(options.additionalExileCount || 0) > 0 ? { additionalExileCount: Number(options.additionalExileCount) } : {}),
      duration: 'end_of_turn',
      turnApplied: Number(state.turnNumber ?? state.turn ?? 0) || 0,
      ...(options.sourceId ? { sourceId: options.sourceId } : {}),
      ...(options.sourceName ? { sourceName: options.sourceName } : {}),
    }));
  }

  return true;
}
