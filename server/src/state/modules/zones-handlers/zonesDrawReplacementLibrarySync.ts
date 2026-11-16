// server/src/state/modules/zones-handlers/zonesDrawReplacementLibrarySync.ts
// Shared library Map <-> zones.library sync used by Tomorrow / Serum Powder applies.
// Public: syncPlayerLibraryFromContext, writePlayerLibraryToContext.

import type { PlayerID } from '../../../../../shared/src/types.js';
import type { GameContext } from '../../context.js';

export function syncPlayerLibraryFromContext(ctx: GameContext, playerId: string): any[] {
  const pid = String(playerId || '');
  const state: any = (ctx as any).state = (ctx as any).state || {};
  state.zones = state.zones || {};
  state.zones[pid] = state.zones[pid] || {};
  const mapLib = (ctx as any).libraries?.get?.(pid as PlayerID);
  const zoneLib = state.zones[pid].library;
  const lib = (Array.isArray(mapLib) && (mapLib.length > 0 || !Array.isArray(zoneLib)))
    ? mapLib
    : (Array.isArray(zoneLib) ? zoneLib : (Array.isArray(mapLib) ? mapLib : []));
  if ((ctx as any).libraries && typeof (ctx as any).libraries.set === 'function') {
    (ctx as any).libraries.set(pid as PlayerID, lib);
  }
  state.zones[pid].library = lib;
  state.zones[pid].libraryCount = lib.length;
  return lib;
}

export function writePlayerLibraryToContext(ctx: GameContext, playerId: string, lib: any[]): void {
  const pid = String(playerId || '');
  const state: any = (ctx as any).state = (ctx as any).state || {};
  state.zones = state.zones || {};
  state.zones[pid] = state.zones[pid] || {};
  const next = Array.isArray(lib) ? lib : [];
  if ((ctx as any).libraries && typeof (ctx as any).libraries.set === 'function') {
    (ctx as any).libraries.set(pid as PlayerID, next);
  }
  state.zones[pid].library = next;
  state.zones[pid].libraryCount = next.length;
}
