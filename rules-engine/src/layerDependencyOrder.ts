// rules-engine/src/layerDependencyOrder.ts
// CR 613.8: dependency ordering of continuous effects within one layer (or sublayer).
//   613.8a  B depends on A when applying A would change B's existence, what B applies to, or what B does.
//   613.8b  A dependent effect waits until everything it depends on has applied; the remaining effects apply
//           in timestamp order. Effects caught in a dependency loop ignore dependency and use timestamp order.
// Callers pass only the effects that overlap in one layer; with fewer than two, this is a plain timestamp sort.
// Public entry symbols: orderEffectsByDependency.

export interface DependencyOrderOptions<T> {
  timestampOf: (effect: T) => number;
  /** True when `dependent` depends on `dependency` (613.8a). Never called with the same effect twice. */
  dependsOn: (dependent: T, dependency: T) => boolean;
}

function byTimestamp(ts: number[]) {
  return (left: number, right: number) => (ts[left] - ts[right]) || (left - right);
}

/** Tarjan SCC ids; effects sharing an id form a dependency loop. */
function loopIds(n: number, deps: number[][]): number[] {
  const index = new Array<number>(n).fill(-1);
  const low = new Array<number>(n).fill(0);
  const comp = new Array<number>(n).fill(-1);
  const onStack = new Array<boolean>(n).fill(false);
  const stack: number[] = [];
  let counter = 0;
  let compCount = 0;
  const visit = (v: number): void => {
    index[v] = low[v] = counter++;
    stack.push(v);
    onStack[v] = true;
    for (const w of deps[v]) {
      if (index[w] < 0) { visit(w); low[v] = Math.min(low[v], low[w]); }
      else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
    }
    if (low[v] === index[v]) {
      let w: number;
      do { w = stack.pop() as number; onStack[w] = false; comp[w] = compCount; } while (w !== v);
      compCount += 1;
    }
  };
  for (let v = 0; v < n; v += 1) if (index[v] < 0) visit(v);
  return comp;
}

export function orderEffectsByDependency<T>(effects: readonly T[], options: DependencyOrderOptions<T>): T[] {
  const n = effects.length;
  const ts = effects.map((effect) => Number(options.timestampOf(effect)));
  const order = effects.map((_, i) => i).sort(byTimestamp(ts));
  if (n < 2) return order.map((i) => effects[i]);

  const deps: number[][] = effects.map(() => []);
  let anyDependency = false;
  for (let a = 0; a < n; a += 1) {
    for (let b = 0; b < n; b += 1) {
      if (a !== b && options.dependsOn(effects[a], effects[b])) { deps[a].push(b); anyDependency = true; }
    }
  }
  if (!anyDependency) return order.map((i) => effects[i]);

  const comp = loopIds(n, deps);
  const applied = new Array<boolean>(n).fill(false);
  const out: T[] = [];
  while (out.length < n) {
    // Earliest timestamp whose dependencies outside its own loop have all applied.
    const next = order.find((i) => !applied[i] && deps[i].every((d) => applied[d] || comp[d] === comp[i]));
    const pick = next ?? (order.find((i) => !applied[i]) as number);
    applied[pick] = true;
    out.push(effects[pick]);
  }
  return out;
}
