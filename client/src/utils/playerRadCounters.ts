// client/src/utils/playerRadCounters.ts
// Rad counters on a player (Fallout): server keeps player.counters.rad / player.radCounters /
// state.radCounters[playerId]. Public entry symbols: readPlayerRadCounters.

export function readPlayerRadCounters(player: any, view?: any): number {
  const id = String(player?.id || '');
  const candidates = [player?.counters?.rad, player?.radCounters, id ? view?.radCounters?.[id] : undefined];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 0;
}