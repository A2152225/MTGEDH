// Crew granted to a Vehicle by another permanent ("Vehicles you control have crew N", "Each Vehicle you
// control has crew N"). Prefers the server view's rulesStatus.grantedCrew; falls back to scanning the battlefield.
// Public entry symbols: grantedCrewFor.

const GRANT_RES = [/\bvehicles you control have crew (\d+)\b/g, /\beach vehicle you control has crew (\d+)\b/g];

export function grantedCrewFor(permanent: any, battlefield?: readonly any[]): { value: number; sourceName: string } | null {
  const rs = permanent?.rulesStatus?.grantedCrew;
  if (rs && Number.isFinite(Number(rs.value))) return { value: Number(rs.value), sourceName: String(rs.sourceName || 'a permanent') };
  const controller = String(permanent?.controller || '');
  if (!controller || !/\bvehicle\b/i.test(String(permanent?.card?.type_line || ''))) return null;
  let best: { value: number; sourceName: string } | null = null;
  for (const src of battlefield || []) {
    if (!src || String(src.controller || '') !== controller) continue;
    const text = String(src.card?.oracle_text || '').toLowerCase().replace(/\u2019/g, "'");
    for (const re of GRANT_RES) for (const m of text.matchAll(re)) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && (!best || n < best.value)) best = { value: n, sourceName: String(src.card?.name || 'a permanent') };
    }
  }
  return best;
}
