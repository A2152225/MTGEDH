/**
 * Label for a player named on a card badge (chosen player, control change).
 * Prefer the seat display name from the current table over a stored id.
 */
export function resolvePlayerBadgeLabel(
  playerId: unknown,
  players?: readonly { id?: string; name?: string }[] | null,
  explicitName?: unknown,
): string {
  const id = String(playerId || '').trim();
  const explicit = String(explicitName || '').trim();
  const tableName = String(
    players?.find((player) => String(player?.id || '') === id)?.name || '',
  ).trim();
  if (tableName && tableName !== id) return tableName;
  if (explicit && explicit !== id) return explicit;
  return tableName || explicit || id;
}
