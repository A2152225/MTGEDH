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

/** Drops positive deltas for a permanent that can't have counters put on it; negative deltas are kept. */
export function filterRestrictedCounterDeltas(state: any, perm: any, deltas: Record<string, number>): Record<string, number> {
  if (!permanentCantHaveCountersPut(state, perm)) return deltas;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(deltas || {})) if (Number(v) < 0) out[k] = Number(v);
  return out;
}