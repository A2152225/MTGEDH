// Origin parent: server/src/state/modules/graveyard-permissions.ts
// Runtime seam so extracted leaves can call addGraveyardCastingPermission
// without importing graveyard-permissions.ts or this folder's index.
// Public entry symbols: GraveyardPermissionsHandlerDeps, setGraveyardPermissionsHandlerDeps,
//   getGraveyardPermissionsHandlerDeps.

import type { GraveyardCastingPermission } from "./graveyardPermissionsTypes.js";

export type GraveyardPermissionsHandlerDeps = {
  addGraveyardCastingPermission: (
    state: any,
    permission: Omit<GraveyardCastingPermission, "id" | "sourceZone"> & {
      id?: string;
      sourceZone?: "graveyard";
    },
  ) => GraveyardCastingPermission | undefined;
};

let deps: Partial<GraveyardPermissionsHandlerDeps> = {};

export function setGraveyardPermissionsHandlerDeps(
  next: Partial<GraveyardPermissionsHandlerDeps>,
): void {
  deps = { ...deps, ...next };
}

export function getGraveyardPermissionsHandlerDeps(): GraveyardPermissionsHandlerDeps {
  const addGraveyardCastingPermission = deps.addGraveyardCastingPermission;
  if (!addGraveyardCastingPermission) {
    throw new Error("graveyard-permissions handler deps not initialized");
  }
  return { addGraveyardCastingPermission };
}
