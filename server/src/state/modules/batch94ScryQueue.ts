// server/src/state/modules/batch94ScryQueue.ts
// B94: apply Eligeth-style "scry becomes draw" at the QueueScry point
// so a scry is never entered as a pending scry prompt.
// Public: applyEligethReplacementAtScryQueue.

import { applyScryReplacedByDraw, shouldReplaceScryWithDraw } from './replacementBatch93ScryReplacements.js';

function libraryOf(gameOrState: any, playerId: string): any[] | null {
  const fromMap = gameOrState?.libraries?.get?.(playerId);
  if (Array.isArray(fromMap)) return fromMap;
  const state = gameOrState?.state || gameOrState;
  const fromZones = state?.zones?.[playerId]?.library;
  return Array.isArray(fromZones) ? fromZones : null;
}

/** If a scry-to-draw replacement applies, draw `count` and return { replaced: true }. */
export function applyEligethReplacementAtScryQueue(
  gameOrState: any,
  playerId: string,
  count: number,
): { replaced: boolean; drawn: any[] } {
  const pid = String(playerId || '');
  const n = Math.max(0, Math.floor(Number(count) || 0));
  const state = gameOrState?.state || gameOrState;
  if (!pid || n <= 0 || !shouldReplaceScryWithDraw(state, pid)) return { replaced: false, drawn: [] };
  const lib = libraryOf(gameOrState, pid);
  const drawn = Array.isArray(lib) ? lib.splice(0, Math.min(n, lib.length)) : applyScryReplacedByDraw(state, pid, n);
  if (Array.isArray(lib)) {
    state.zones = state.zones || {};
    state.zones[pid] = state.zones[pid] || {};
    const hand = state.zones[pid].hand = Array.isArray(state.zones[pid].hand) ? state.zones[pid].hand : [];
    hand.push(...drawn);
    if (Array.isArray(state.zones[pid].library) && state.zones[pid].library !== lib) {
      // Keep the zones library in sync when the live list lives on the Map.
      const zonesLib: any[] = state.zones[pid].library;
      zonesLib.splice(0, Math.min(drawn.length, zonesLib.length));
    }
  }
  return { replaced: true, drawn };
}
