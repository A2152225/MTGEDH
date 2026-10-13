/**
 * Scoped memo for collectReplacementEffectSpecsFromState.
 *
 * Collecting replacement specs walks the whole battlefield and parses every card's
 * oracle text. Batch loops that evaluate one replacement event per permanent
 * (counter placement on "each creature you control", mass token entry) used to
 * re-collect for every object, which made Cathars' Crusade + 100 tokens quadratic.
 *
 * Inside runWithReplacementSpecScope, the first collect for a state is reused as
 * long as the battlefield signature (ids, controllers, names, phasing, oracle text
 * length) is unchanged. Outside a scope nothing is cached.
 */

type ScopedEntry<T> = { state: unknown; signature: string; specs: T[]; battlefield: unknown; length: number };

let scopeDepth = 0;
let scopedEntry: ScopedEntry<any> | null = null;

export function runWithReplacementSpecScope<R>(fn: () => R): R {
  scopeDepth += 1;
  try {
    return fn();
  } finally {
    scopeDepth -= 1;
    if (scopeDepth === 0) scopedEntry = null;
  }
}

export function isReplacementSpecScopeActive(): boolean {
  return scopeDepth > 0;
}

function battlefieldSignature(state: unknown): string {
  const battlefield = Array.isArray((state as any)?.battlefield) ? (state as any).battlefield : [];
  const parts: string[] = [String(battlefield.length)];
  for (const perm of battlefield) {
    const card = perm?.card || {};
    parts.push(
      `${perm?.id}|${perm?.controller}|${perm?.phasedOut === true ? 1 : 0}|${card.name || ''}|${String(card.oracle_text || '').length}`,
    );
  }
  return parts.join(';');
}

export function readScopedReplacementSpecs<T>(state: unknown, compute: () => T[]): T[] {
  if (scopeDepth === 0) return compute();
  const battlefield = (state as any)?.battlefield;
  const length = Array.isArray(battlefield) ? battlefield.length : 0;
  // Fast path: the same battlefield array with the same length inside one scope. Building
  // the full signature on every read made a per-permanent loop O(board^2) again
  // (~120ms per Crusade resolution at 460 creatures).
  if (scopedEntry && scopedEntry.state === state && scopedEntry.battlefield === battlefield && scopedEntry.length === length) {
    return [...scopedEntry.specs];
  }
  const signature = battlefieldSignature(state);
  if (scopedEntry && scopedEntry.state === state && scopedEntry.signature === signature) {
    scopedEntry.battlefield = battlefield;
    scopedEntry.length = length;
    return [...scopedEntry.specs];
  }
  const specs = compute();
  scopedEntry = { state, signature, specs, battlefield, length };
  return [...specs];
}
