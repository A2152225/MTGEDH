/**
 * Read-only query scope: a short window (one broadcast, one canAct/canRespond check, one
 * playable-ids pass) in which game state is not mutated. Inside it, expensive pure
 * derivations (static effect sources, haste checks, graveyard keyword grants, land-type
 * modifiers) are memoized per owner object. Outside a scope every helper computes fresh,
 * so behavior is unchanged; the memo store is dropped when the outermost scope exits.
 */
let scopeDepth = 0;
let store: WeakMap<object, Map<string, unknown>> | null = null;

export function withReadOnlyQueryScope<T>(fn: () => T): T {
  if (scopeDepth > 0) return fn();
  scopeDepth = 1;
  store = new WeakMap();
  try {
    return fn();
  } finally {
    scopeDepth = 0;
    store = null;
  }
}

export function isReadOnlyQueryScopeActive(): boolean {
  return store !== null;
}

/** Memoize compute() for (owner, key) while a scope is active; otherwise just compute. */
export function scopedMemo<T>(owner: unknown, key: string, compute: () => T): T {
  if (!store || !owner || (typeof owner !== 'object' && typeof owner !== 'function')) return compute();
  let bucket = store.get(owner as object);
  if (!bucket) {
    bucket = new Map();
    store.set(owner as object, bucket);
  }
  if (bucket.has(key)) return bucket.get(key) as T;
  const value = compute();
  bucket.set(key, value);
  return value;
}