/**
 * Shared restore/replay gate for event persistence.
 * GameManager marks games here while replaying the event log after restart/undo
 * so append paths can refuse concurrent writes even before socket `games` is synced.
 */
const restoringGameIds = new Set<string>();

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
