// Origin parent: server/src/state/modules/graveyard-permissions.ts
// Cluster moved: getTemporaryPlayableFromGraveyardPermissions and
//   addTemporaryPlayableFromGraveyardPermission.
// Public entry symbols: getTemporaryPlayableFromGraveyardPermissions,
//   addTemporaryPlayableFromGraveyardPermission.
// Leaf must not import graveyard-permissions.ts or graveyard-permissions-handlers/index.ts.

import type { PlayerID } from "../../../../../shared/src/index.js";
import type {
  GraveyardCastingPermission,
  GraveyardCastingPermissionCostMode,
  GraveyardCastingPermissionReplacement,
  GraveyardCastingPermissionUsageLimit,
  TemporaryPlayableFromGraveyardPermission,
} from "./graveyardPermissionsTypes.js";
import { normalizeText } from "./graveyardPermissionsCardUtils.js";
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

export function getTemporaryPlayableFromGraveyardPermissions(state: any): TemporaryPlayableFromGraveyardPermission[] {
  return Array.isArray(state?.temporaryPlayableFromGraveyardPermissions)
    ? state.temporaryPlayableFromGraveyardPermissions
    : [];
}

export function addTemporaryPlayableFromGraveyardPermission(
  state: any,
  playerId: PlayerID,
  qualifier: string,
  permission: 'play' | 'cast',
  options: {
    sourceId?: string;
    sourceName?: string;
    sourceText?: string;
    costMode?: GraveyardCastingPermissionCostMode;
    usageLimit?: GraveyardCastingPermissionUsageLimit;
    replacement?: GraveyardCastingPermissionReplacement;
  },
): boolean {
  const normalizedQualifier = String(qualifier || '').trim();
  if (!state || !playerId || !normalizedQualifier) return false;

  const sourceId = String(options.sourceId || '').trim();
  state.temporaryPlayableFromGraveyardPermissions = getTemporaryPlayableFromGraveyardPermissions(state).filter((entry) => !(
    String(entry?.playerId || '') === String(playerId || '')
    && String(entry?.permission || '') === String(permission)
    && normalizeText(entry?.qualifier || '') === normalizeText(normalizedQualifier)
    && String(entry?.sourceId || '') === sourceId
  ));

  state.temporaryPlayableFromGraveyardPermissions.push({
    playerId: String(playerId),
    permission,
    qualifier: normalizedQualifier,
    ...(sourceId ? { sourceId } : {}),
    ...(options.sourceName ? { sourceName: String(options.sourceName) } : {}),
    expiresAt: 'end_of_turn',
    turnApplied: Number(state.turnNumber ?? state.turn ?? 0) || 0,
  });

  addGraveyardCastingPermission(state, {
    playerId: String(playerId),
    permission,
    sourceId,
    ...(options.sourceName ? { sourceName: String(options.sourceName) } : {}),
    ...(options.sourceText ? { sourceText: String(options.sourceText) } : {}),
    cardFilter: { qualifier: normalizedQualifier },
    costMode: options.costMode || 'normal',
    duration: 'this_turn',
    turnApplied: Number(state.turnNumber ?? state.turn ?? 0) || 0,
    ...(options.usageLimit ? { usageLimit: options.usageLimit } : {}),
    ...(options.replacement ? { replacement: { ...options.replacement } } : {}),
  });

  return true;
}
