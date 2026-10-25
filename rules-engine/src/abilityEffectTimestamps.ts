// rules-engine/src/abilityEffectTimestamps.ts
// CR 613.7 timestamps for layer-6 ability grants and removals carried on a permanent.
//   - perm.abilityGrantTimestamps { [ability]: ts } for entries in the grant lists (grantedAbilities, ...).
//   - perm.abilityLossTimestamps  { [ability | 'all abilities']: ts } for removed lists / loses-all flags.
//   - `ceTimestamp` on object entries of perm.temporaryEffects.
// Inside layer 6 effects apply in timestamp order, so a grant survives a removal only when its timestamp is
// later (flying granted after Humility is kept; granted before, it is lost). Unstamped entries keep the
// conservative behaviour (removal wins). Stamps are assigned explicitly or lazily by syncAbilityEffectTimestamps.
// Public entry symbols: GRANT_LIST_FIELDS, abilityKey, stampAbilityGrant, stampAbilityLoss,
//   syncAbilityEffectTimestamps, readAbilityGrantTimestamp, readAbilityLossTimestamp.

import { allocateTimestamp, TIMESTAMP_BASE } from './permanentTimestamps.js';

export const GRANT_LIST_FIELDS = ['grantedAbilities', 'grantedKeywords', 'tempAbilities', 'temporaryAbilities', 'gainedAbilities'] as const;
const LOSS_LIST_FIELDS = ['removedKeywords', 'lostKeywords', 'lostAbilities', 'removedAbilities'] as const;

export function abilityKey(value: unknown): string {
  const k = String(value ?? '').toLowerCase().replace(/_/g, ' ').trim();
  return k === 'all' ? 'all abilities' : k;
}

function entryKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const e: any = entry;
    const text = typeof e === 'string' ? e : (e && typeof e === 'object' ? (e.ability ?? e.keyword ?? e.name ?? e.text ?? e.type ?? '') : '');
    const k = abilityKey(text);
    if (k) out.push(k);
  }
  return out;
}

function stampMap(perm: any, field: string): Record<string, number> {
  if (!perm[field] || typeof perm[field] !== 'object') perm[field] = {};
  return perm[field];
}

function validTs(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > TIMESTAMP_BASE ? n : undefined;
}

/** Record that `ability` was just granted to `perm` (new timestamp, replacing an older grant stamp). */
export function stampAbilityGrant(state: any, perm: any, ability: string): number | undefined {
  const k = abilityKey(ability);
  if (!perm || typeof perm !== 'object' || !k) return undefined;
  const ts = allocateTimestamp(state);
  stampMap(perm, 'abilityGrantTimestamps')[k] = ts;
  return ts;
}

/** Record that `perm` just lost `ability` ('all abilities' for Turn to Frog style effects). */
export function stampAbilityLoss(state: any, perm: any, ability = 'all abilities'): number | undefined {
  const k = abilityKey(ability);
  if (!perm || typeof perm !== 'object' || !k) return undefined;
  const ts = allocateTimestamp(state);
  stampMap(perm, 'abilityLossTimestamps')[k] = ts;
  return ts;
}

function syncMap(state: any, perm: any, field: string, present: Set<string>): void {
  const existing = perm[field] && typeof perm[field] === 'object' ? perm[field] : undefined;
  if (existing) for (const k of Object.keys(existing)) if (!present.has(k)) delete existing[k];
  for (const k of present) {
    if (validTs(existing?.[k]) !== undefined) continue;
    stampMap(perm, field)[k] = allocateTimestamp(state);
  }
  if (perm[field] && Object.keys(perm[field]).length === 0) delete perm[field];
}

/** Lazily stamp grants / losses that appeared since the last sync and drop stamps of ones that ended. */
export function syncAbilityEffectTimestamps(state: any): void {
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;
    const grants = new Set<string>();
    for (const field of GRANT_LIST_FIELDS) for (const k of entryKeys(perm[field])) grants.add(k);
    // Grants first: when a grant and a removal show up in the same batch the removal gets the later stamp.
    syncMap(state, perm, 'abilityGrantTimestamps', grants);
    const losses = new Set<string>();
    for (const field of LOSS_LIST_FIELDS) for (const k of entryKeys(perm[field])) losses.add(k);
    if (perm.losesAllAbilities === true || perm.lostAllAbilities === true) losses.add('all abilities');
    syncMap(state, perm, 'abilityLossTimestamps', losses);
    for (const effect of Array.isArray(perm.temporaryEffects) ? perm.temporaryEffects : []) {
      if (effect && typeof effect === 'object' && validTs(effect.ceTimestamp) === undefined) effect.ceTimestamp = allocateTimestamp(state);
    }
  }
}

export function readAbilityGrantTimestamp(perm: any, ability: unknown): number | undefined {
  return validTs(perm?.abilityGrantTimestamps?.[abilityKey(ability)]);
}

export function readAbilityLossTimestamp(perm: any, ability: unknown): number | undefined {
  return validTs(perm?.abilityLossTimestamps?.[abilityKey(ability)]);
}
