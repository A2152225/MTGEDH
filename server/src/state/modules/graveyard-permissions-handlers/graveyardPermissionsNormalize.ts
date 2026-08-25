// Origin parent: server/src/state/modules/graveyard-permissions.ts
// Cluster moved: normalizeGraveyardPermissionCostMode and
//   normalizeGraveyardPermissionDuration.
// Public entry symbols: normalizeGraveyardPermissionCostMode,
//   normalizeGraveyardPermissionDuration.
// Leaf must not import graveyard-permissions.ts or graveyard-permissions-handlers/index.ts.

import type {
  GraveyardCastingPermissionCostMode,
  GraveyardCastingPermissionDuration,
} from "./graveyardPermissionsTypes.js";

export function normalizeGraveyardPermissionCostMode(value: unknown): GraveyardCastingPermissionCostMode {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'alternate') return 'alternate';
  if (normalized === 'without_paying_mana_cost') return 'without_paying_mana_cost';
  return 'normal';
}

export function normalizeGraveyardPermissionDuration(value: unknown): GraveyardCastingPermissionDuration {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'until_end_of_next_turn') return 'until_end_of_next_turn';
  if (normalized === 'static' || normalized === 'permanent') return 'static';
  if (normalized === 'end_of_turn' || normalized === 'eot') return 'end_of_turn';
  return 'this_turn';
}
