/**
 * Origin parent: server/src/socket/ai-handlers/aiPriorityHandlers.ts
 * Cluster: wait / orphan-cleanup for pendingSpellCasts that can wedge MAIN priority.
 * Public: takeAiPendingSpellCastSettleSlot, clearAiPendingSpellCastSettleCounts.
 */

const MAX_SETTLE_WAKES_PER_TURN = 8;

function turnKey(game: any): string {
  return String((game?.state as any)?.turnNumber ?? (game?.state as any)?.turn ?? 0);
}

/** Returns 'wait' while the cast flow may still settle, or 'orphan' after too many wakes. */
export function takeAiPendingSpellCastSettleSlot(
  game: any,
  playerId: string,
): 'wait' | 'orphan' {
  if (!game?.state) return 'orphan';
  const key = `${turnKey(game)}:${String(playerId || '')}`;
  const counts = ((game.state as any)._aiPendingSpellCastSettleCounts ||= {}) as Record<string, number>;
  counts[key] = Number(counts[key] || 0) + 1;
  return counts[key] >= MAX_SETTLE_WAKES_PER_TURN ? 'orphan' : 'wait';
}

export function clearAiPendingSpellCastSettleCounts(game: any, playerId?: string): void {
  if (!game?.state) return;
  const counts = (game.state as any)._aiPendingSpellCastSettleCounts;
  if (!counts || typeof counts !== 'object') return;
  if (!playerId) {
    delete (game.state as any)._aiPendingSpellCastSettleCounts;
    return;
  }
  const prefix = `${turnKey(game)}:${String(playerId)}`;
  delete counts[prefix];
}
