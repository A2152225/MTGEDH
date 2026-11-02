// server/src/state/modules/counterPlacementRestrictions.ts
// "This creature can't have counters put on it." (Melira's Keepers / Tatterkite) and
// "Enchanted creature ... can't have counters put on it." (Blossombind): CR 122.1 restriction, so
// counter placement on the permanent does nothing (removal is still allowed).
// Public entry symbols: permanentCantHaveCountersPut, filterRestrictedCounterDeltas.

const SELF_RE = /(?:^|[.\n]\s*)(?:this (?:creature|permanent|artifact|enchantment|land)|~) can't have counters put on it\b/i;
const ATTACHED_RE = /\b(?:enchanted|equipped) (?:creature|permanent)\b[^.\n]*\bcan't have counters put on it\b/i;

function oracleOf(perm: any): string {
  return String(perm?.card?.oracle_text || '').replace(/\u2019/g, "'");
}

export function permanentCantHaveCountersPut(state: any, perm: any): boolean {
  if (!perm) return false;
  const own = oracleOf(perm);
  const name = String(perm?.card?.name || '').trim();
  if (SELF_RE.test(own)) return true;
  if (name && new RegExp(`(?:^|[.\\n]\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} can't have counters put on it\\b`, 'i').test(own)) return true;
  const id = String(perm.id || '');
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  return !!id && battlefield.some((src: any) => src && !src.phasedOut && String(src.attachedTo || '') === id && ATTACHED_RE.test(oracleOf(src)));
}

const GROUP_RE = /(?:^|[.\n]\s*)(?:(other )?(creatures|permanents|artifacts) you control|(?:all )?(creatures|permanents)) can't have ([+-]\d+\/[+-]\d+ )?counters put on them\b/gi;

/** Counter kinds (or '*' for all) that a battlefield static bans from being put on `perm`. */
export function bannedCounterKinds(state: any, perm: any): string[] {
  const out: string[] = [];
  if (permanentCantHaveCountersPut(state, perm)) out.push('*');
  const tl = String(perm?.card?.type_line || '').toLowerCase();
  for (const src of Array.isArray(state?.battlefield) ? state.battlefield : []) {
    if (!src || src.phasedOut) continue;
    for (const m of oracleOf(src).matchAll(GROUP_RE)) {
      const kind = String(m[2] || m[3] || '').toLowerCase().replace(/s$/, '');
      if (kind !== 'permanent' && !tl.includes(kind)) continue;
      if (m[2] && String(src.controller || '') !== String(perm?.controller || '')) continue;
      if (m[1] && String(src.id) === String(perm?.id)) continue;
      out.push(m[4] ? m[4].trim() : '*');
    }
  }
  return out;
}

/** Drops positive deltas for a permanent that can't have counters put on it; negative deltas are kept. */
export function filterRestrictedCounterDeltas(state: any, perm: any, deltas: Record<string, number>): Record<string, number> {
  const banned = bannedCounterKinds(state, perm);
  if (!banned.length) return deltas;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(deltas || {})) if (Number(v) < 0 || (!banned.includes('*') && !banned.includes(k))) out[k] = Number(v);
  return out;
}