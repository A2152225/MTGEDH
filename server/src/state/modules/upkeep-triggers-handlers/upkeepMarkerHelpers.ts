// server/src/state/modules/upkeep-triggers-handlers/upkeepMarkerHelpers.ts
// Origin parent: server/src/state/modules/upkeep-triggers.ts
// Cluster moved: getLastUpkeepMarker (echo/control upkeep marker lookup).
// Public entry symbols: getLastUpkeepMarker.

export function getLastUpkeepMarker(state: any, playerId: string): number {
  const markers = state?.lastUpkeepMarkerByPlayer;
  const raw = markers && typeof markers === 'object' ? (markers as any)[String(playerId)] : undefined;
  return Number.isFinite(Number(raw)) ? Number(raw) : 0;
}
