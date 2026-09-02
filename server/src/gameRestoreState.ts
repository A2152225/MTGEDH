/**
 * Shared restore/replay gate for event persistence.
 * GameManager marks games here while replaying the event log after restart/undo
 * so append paths can refuse concurrent writes even before socket `games` is synced.
 */
const restoringGameIds = new Set<string>();

/** Scratch id used by undo boundary planning (`undo_probe_${liveGameId}`). Not a real table. */
export function isUndoProbeGameId(gameId: string): boolean {
  return String(gameId || '').startsWith('undo_probe_');
}

export function markGameRestoring(gameId: string): void {
  const id = String(gameId || '').trim();
  if (id) restoringGameIds.add(id);
}

export function clearGameRestoring(gameId: string): void {
  const id = String(gameId || '').trim();
  if (id) restoringGameIds.delete(id);
}

export function isGameRestoring(gameId: string): boolean {
  const id = String(gameId || '').trim();
  return Boolean(id && restoringGameIds.has(id));
}

/** True while undo/restart is replaying the event log — AI and broadcasts must not run. */
export function isGameReplayLocked(game: any, gameId?: string): boolean {
  if (game?.isReplaying) return true;
  const id = String(gameId || game?.gameId || '').trim();
  return Boolean(id && isGameRestoring(id));
}

export function pauseHumanPriorityAfterRestore(game: any): void {
  try {
    const state = game?.state as any;
    if (!state) return;
    const pauseId = String(state.priority || state.turnPlayer || '').trim();
    if (!pauseId) return;
    const players = Array.isArray(state.players) ? state.players : [];
    const player = players.find((entry: any) => String(entry?.id || '') === pauseId);
    if (player?.isAI || player?.spectator || player?.isSpectator) return;
    if (player?.hasLost || player?.eliminated || player?.conceded) return;
    state._pauseHumanAutoPassUntilActionFor = pauseId;
  } catch {
    // best-effort only
  }
}
