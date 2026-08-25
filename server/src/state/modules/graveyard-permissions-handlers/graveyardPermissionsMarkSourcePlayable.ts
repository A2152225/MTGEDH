// Origin parent: server/src/state/modules/graveyard-permissions.ts
// Cluster moved: markSourceCardPlayableFromGraveyardThisTurn.
// Public entry symbols: markSourceCardPlayableFromGraveyardThisTurn.
// Leaf must not import graveyard-permissions.ts or graveyard-permissions-handlers/index.ts.

import type { PlayerID } from "../../../../../shared/src/index.js";
import type {
  GraveyardCastingPermission,
  GraveyardCastingPermissionCostMode,
  GraveyardCastingPermissionDuration,
  GraveyardCastingPermissionReplacement,
} from "./graveyardPermissionsTypes.js";
import { getCardId, getTypeLine } from "./graveyardPermissionsCardUtils.js";
import { normalizeGraveyardPermissionDuration } from "./graveyardPermissionsNormalize.js";
import { getPlayerGraveyardCollections } from "./graveyardPermissionsZoneAccess.js";
import { getGraveyardPermissionsHandlerDeps } from "./graveyardPermissionsHandlerDeps.js";

function addGraveyardCastingPermission(
  state: any,
  permission: Omit<GraveyardCastingPermission, "id" | "sourceZone"> & {
    id?: string;
    sourceZone?: "graveyard";
  },
): GraveyardCastingPermission | undefined {
  return getGraveyardPermissionsHandlerDeps().addGraveyardCastingPermission(state, permission);
}

export function markSourceCardPlayableFromGraveyardThisTurn(
  state: any,
  playerId: PlayerID,
  sourceCard: any,
  permission: 'play' | 'cast',
  options?: {
    sourceId?: string;
    sourceName?: string;
    sourceText?: string;
    costMode?: GraveyardCastingPermissionCostMode;
    replacement?: GraveyardCastingPermissionReplacement;
    duration?: GraveyardCastingPermissionDuration;
    castAsAdventureOnly?: boolean;
  },
): number {
  const cardId = getCardId(sourceCard);
  if (!state || !playerId || !cardId) return 0;

  const typeLine = getTypeLine(sourceCard);
  if (permission === 'cast' && /\bland\b/.test(typeLine)) {
    return 0;
  }

  const turnApplied = Number(state.turnNumber ?? state.turn ?? 0) || 0;
  const duration = normalizeGraveyardPermissionDuration(options?.duration || 'this_turn');
  const playableUntilTurn = duration === 'until_end_of_next_turn' ? turnApplied + 1 : turnApplied;
  let updated = 0;

  for (const graveyard of getPlayerGraveyardCollections(state, playerId)) {
    const index = graveyard.findIndex((entry: any) => getCardId(entry) === cardId);
    if (index < 0) continue;

    graveyard[index] = {
      ...graveyard[index],
      zone: 'graveyard',
      canBePlayedBy: String(playerId),
      playableUntilTurn,
      ...(options?.castAsAdventureOnly === true ? { castAsAdventureOnly: true } : {}),
    };
    updated += 1;
  }

  if (updated === 0) {
    return 0;
  }

  state.playableFromGraveyard = state.playableFromGraveyard || {};
  const playerEntry = state.playableFromGraveyard[String(playerId)] = state.playableFromGraveyard[String(playerId)] || {};
  playerEntry[cardId] = playableUntilTurn;

  addGraveyardCastingPermission(state, {
    playerId: String(playerId),
    permission,
    sourceId: options?.sourceId || cardId,
    sourceName: options?.sourceName || String(sourceCard?.name || ''),
    ...(options?.sourceText ? { sourceText: String(options.sourceText) } : {}),
    cardFilter: {
      qualifier: 'this card',
      cardIds: [cardId],
    },
    costMode: options?.costMode || 'normal',
    duration,
    turnApplied,
    usageLimit: { type: 'once', maxUses: 1 },
    ...(options?.replacement ? { replacement: { ...options.replacement } } : {}),
    ...(options?.castAsAdventureOnly === true ? { castAsAdventureOnly: true } : {}),
  });

  return 1;
}
