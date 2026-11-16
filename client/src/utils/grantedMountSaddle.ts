/**
 * Saddle N granted to a creature by a type-granting static (Jandor).
 * Prefers the server view's rulesStatus.grantedSaddle; falls back to a
 * battlefield scan. Public: grantedSaddleFor.
 */

const GRANT_RE = /\bis an? [^.]*? in addition to its other types and has saddle (\d+)/i;

function typeLineOf(permanent: any): string {
  const added = Array.isArray(permanent?.rulesStatus?.addedTypes)
    ? permanent.rulesStatus.addedTypes.join(' ')
    : '';
  return `${permanent?.card?.type_line || permanent?.type_line || ''} ${added}`.toLowerCase();
}

function creatureTypesOf(permanent: any): string[] {
  return typeLineOf(permanent)
    .split(/[^a-z]+/)
    .map((part: string) => part.trim())
    .filter(Boolean);
}

export function grantedSaddleFor(
  permanent: any,
  battlefield?: readonly any[],
): { value: number; sourceName: string } | null {
  const rs = permanent?.rulesStatus?.grantedSaddle;
  if (rs && Number.isFinite(Number(rs.value))) {
    return { value: Number(rs.value), sourceName: String(rs.sourceName || 'a permanent') };
  }
  const controller = String(permanent?.controller || '');
  if (!controller) return null;
  const types = new Set(creatureTypesOf(permanent));
  let best: { value: number; sourceName: string } | null = null;
  for (const src of battlefield || []) {
    if (!src || String(src.controller || '') !== controller) continue;
    const text = String(src.card?.oracle_text || src.oracle_text || '').replace(/\u2019/g, "'");
    const match = text.match(GRANT_RE);
    if (!match) continue;
    const listed = text.toLowerCase();
    const matchesType = [...types].some((type) => type.length > 2 && new RegExp(`\\b${type}\\b`, 'i').test(listed));
    if (!matchesType && !/\bmount\b/i.test(typeLineOf(permanent))) continue;
    const value = Number(match[1]);
    if (!Number.isFinite(value)) continue;
    if (!best || value < best.value) best = { value, sourceName: String(src.card?.name || src.name || 'a permanent') };
  }
  return best;
}
