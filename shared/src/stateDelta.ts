// shared/src/stateDelta.ts
// Structural JSON diff/patch for per-viewer state deltas (server diff, client apply).
// Inputs are plain JSON values (what socket.io would serialize). Arrays whose
// elements all carry a unique `id` are diffed by id, so a token added, moved or
// removed does not rewrite the whole battlefield.

export type DeltaPath = Array<string | number>;
export type DeltaOp =
  | ['s', DeltaPath, unknown]
  | ['r', DeltaPath]
  | ['l', DeltaPath, { n: number; t: unknown[] }]
  | ['k', DeltaPath, { o?: string[]; a?: Record<string, unknown>; s?: Record<string, DeltaOp[]> }];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function keyedIds(arr: unknown[]): string[] | null {
  if (arr.length === 0) return null;
  const ids: string[] = new Array(arr.length);
  const seen = new Set<string>();
  for (let i = 0; i < arr.length; i++) {
    const el = arr[i];
    if (!isPlainObject(el)) return null;
    const id = (el as any).id;
    if (typeof id !== 'string' && typeof id !== 'number') return null;
    const key = String(id);
    if (seen.has(key)) return null;
    seen.add(key);
    ids[i] = key;
  }
  return ids;
}

function diffInto(a: unknown, b: unknown, path: DeltaPath, ops: DeltaOp[]): void {
  if (a === b) return;
  if (Array.isArray(a) && Array.isArray(b)) {
    const idsA = keyedIds(a);
    const idsB = idsA ? keyedIds(b) : null;
    if (idsA && idsB) {
      const indexA = new Map<string, number>();
      idsA.forEach((id, i) => indexA.set(id, i));
      let sameOrder = idsA.length === idsB.length;
      const add: Record<string, unknown> = {};
      const sub: Record<string, DeltaOp[]> = {};
      let anyAdd = false;
      let anySub = false;
      for (let i = 0; i < idsB.length; i++) {
        const id = idsB[i];
        if (sameOrder && idsA[i] !== id) sameOrder = false;
        const ia = indexA.get(id);
        if (ia === undefined) { add[id] = b[i]; anyAdd = true; continue; }
        const itemOps: DeltaOp[] = [];
        diffInto(a[ia], b[i], [], itemOps);
        if (itemOps.length) { sub[id] = itemOps; anySub = true; }
      }
      if (sameOrder && !anyAdd && !anySub) return;
      const v: { o?: string[]; a?: Record<string, unknown>; s?: Record<string, DeltaOp[]> } = {};
      if (!sameOrder) v.o = idsB;
      if (anyAdd) v.a = add;
      if (anySub) v.s = sub;
      ops.push(['k', path, v]);
      return;
    }
    const m = Math.min(a.length, b.length);
    for (let i = 0; i < m; i++) diffInto(a[i], b[i], [...path, i], ops);
    if (a.length !== b.length) ops.push(['l', path, { n: m, t: b.slice(m) }]);
    return;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    for (const k of Object.keys(a)) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) ops.push(['r', [...path, k]]);
    }
    for (const k of Object.keys(b)) {
      if (!Object.prototype.hasOwnProperty.call(a, k)) ops.push(['s', [...path, k], b[k]]);
      else diffInto(a[k], b[k], [...path, k], ops);
    }
    return;
  }
  ops.push(['s', path, b]);
}

/** Ops that turn JSON value `prev` into `next`. Empty when equal. */
export function diffStateViews(prev: unknown, next: unknown): DeltaOp[] {
  const ops: DeltaOp[] = [];
  diffInto(prev, next, [], ops);
  return ops;
}

function walk(root: any, path: DeltaPath, upto: number): any {
  let cur = root;
  for (let i = 0; i < upto; i++) {
    if (cur === null || typeof cur !== 'object') throw new Error('stateDelta: bad path');
    cur = cur[path[i] as any];
  }
  if (cur === null || typeof cur !== 'object') throw new Error('stateDelta: bad path');
  return cur;
}

function replaceAt(root: any, path: DeltaPath, value: unknown): any {
  if (path.length === 0) return value;
  walk(root, path, path.length - 1)[path[path.length - 1] as any] = value;
  return root;
}

/**
 * Apply ops IN PLACE to a private JSON value and return the (possibly new) root.
 * Throws on any shape mismatch; callers must then discard the base and resync.
 */
export function applyStateDelta(root: any, ops: readonly DeltaOp[]): any {
  for (const op of ops) {
    const kind = op[0];
    const path = op[1];
    if (kind === 's') {
      root = replaceAt(root, path, op[2]);
    } else if (kind === 'r') {
      if (path.length === 0) throw new Error('stateDelta: bad remove');
      const parent = walk(root, path, path.length - 1);
      if (Array.isArray(parent)) throw new Error('stateDelta: bad remove');
      delete parent[path[path.length - 1] as any];
    } else if (kind === 'l') {
      const arr = path.length ? walk(root, path, path.length) : root;
      if (!Array.isArray(arr) || arr.length < op[2].n) throw new Error('stateDelta: bad resize');
      arr.length = op[2].n;
      for (const item of op[2].t) arr.push(item);
    } else if (kind === 'k') {
      const arr = path.length ? walk(root, path, path.length) : root;
      if (!Array.isArray(arr)) throw new Error('stateDelta: bad keyed array');
      const byId = new Map<string, unknown>();
      const order: string[] = [];
      for (const el of arr) {
        const id = isPlainObject(el) ? (el as any).id : undefined;
        if (typeof id !== 'string' && typeof id !== 'number') throw new Error('stateDelta: unkeyed element');
        byId.set(String(id), el);
        order.push(String(id));
      }
      const v = op[2];
      const ids = v.o || order;
      const out: unknown[] = new Array(ids.length);
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        if (v.a && Object.prototype.hasOwnProperty.call(v.a, id)) { out[i] = v.a[id]; continue; }
        if (!byId.has(id)) throw new Error('stateDelta: missing keyed element');
        let el = byId.get(id);
        const sub = v.s && v.s[id];
        if (sub) el = applyStateDelta(el, sub);
        out[i] = el;
      }
      root = replaceAt(root, path, out);
    } else {
      throw new Error('stateDelta: unknown op');
    }
  }
  return root;
}

export interface StateDeltaPayload {
  gameId: string;
  baseVersion: number;
  newVersion: number;
  seq?: number;
  ops: DeltaOp[];
  forceStateReplace?: boolean;
}