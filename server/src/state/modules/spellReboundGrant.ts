// server/src/state/modules/spellReboundGrant.ts
// B46: granted rebound (Cast Through Time: "Instant and sorcery spells you control have rebound").
// Public entry symbols: spellHasGrantedRebound.

const GRANT_RE = /(?:^|[.\n]\s*)((?:instant and sorcery|instant or sorcery|instant|sorcery|noncreature)\s+)?spells (you control|you cast|)\s*have rebound/i;

function typeMatches(qualifier: string, typeLine: string): boolean {
  const q = qualifier.trim().toLowerCase();
  const t = typeLine.toLowerCase();
  if (!q) return true;
  if (q === 'noncreature') return !/\bcreature\b/.test(t);
  if (q === 'instant') return /\binstant\b/.test(t);
  if (q === 'sorcery') return /\bsorcery\b/.test(t);
  return /\b(?:instant|sorcery)\b/.test(t);
}

/** True when a battlefield permanent grants rebound to this spell for its controller. */
export function spellHasGrantedRebound(state: any, controller: string, card: any): boolean {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const typeLine = String(card?.type_line || '');
  for (const perm of battlefield) {
    const oracle = String(perm?.card?.oracle_text || '').replace(/\u2019/g, "'");
    const m = GRANT_RE.exec(oracle);
    if (!m) continue;
    const scoped = String(m[2] || '').trim();
    if (scoped && String(perm.controller || '') !== String(controller || '')) continue;
    if (typeMatches(String(m[1] || ''), typeLine)) return true;
  }
  return false;
}
