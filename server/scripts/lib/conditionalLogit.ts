/**
 * Conditional logit fit for evaluator weights (P1-3).
 *
 * Origin: AI_Upgrade Phase 1 (P1-3).
 * Public entry symbols: Example, softmax, lossAndGrad, fit, logLoss, reliability.
 */

export interface Example {
  gameId: string;
  pod: string;
  /** One row per live seat; columns = FEATURE_NAMES order. */
  X: number[][];
  winnerIdx: number;
}

export interface ReliabilityBucket {
  lo: number;
  hi: number;
  n: number;
  predicted: number;
  observed: number;
  gap: number;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function sumSquares(v: number[]): number {
  let s = 0;
  for (const x of v) s += x * x;
  return s;
}

function norm(v: number[]): number {
  return Math.sqrt(sumSquares(v));
}

/** Softmax with max-subtraction (same trick as winProbabilities). */
export function softmax(scores: number[]): number[] {
  let max = -Infinity;
  for (const s of scores) if (s > max) max = s;
  const exps = scores.map((s) => Math.exp(s - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

export function lossAndGrad(
  data: Example[],
  w: number[],
  l2: number,
): { loss: number; grad: number[] } {
  let loss = 0;
  const grad = new Array(w.length).fill(0);
  for (const e of data) {
    const scores = e.X.map((x) => dot(w, x));
    const p = softmax(scores);
    loss -= Math.log(Math.max(p[e.winnerIdx], 1e-12));
    for (let k = 0; k < w.length; k++) {
      let expected = 0;
      for (let j = 0; j < p.length; j++) expected += p[j] * e.X[j][k];
      grad[k] += expected - e.X[e.winnerIdx][k];
    }
  }
  const n = Math.max(1, data.length);
  for (let k = 0; k < w.length; k++) {
    grad[k] = grad[k] / n + 2 * l2 * w[k];
  }
  return { loss: loss / n + l2 * sumSquares(w), grad };
}

export function fit(data: Example[], l2: number, maxIter = 5000): number[] {
  if (data.length === 0) return [];
  const dim = data[0].X[0]?.length ?? 0;
  let w = new Array(dim).fill(0);
  let step = 1;
  for (let iter = 0; iter < maxIter; iter++) {
    const { loss, grad } = lossAndGrad(data, w, l2);
    if (norm(grad) < 1e-6) break;
    let accepted = false;
    for (step *= 2; step > 1e-12; step /= 2) {
      const w2 = w.map((v, k) => v - step * grad[k]);
      if (lossAndGrad(data, w2, l2).loss <= loss - 1e-4 * step * sumSquares(grad)) {
        w = w2;
        accepted = true;
        break;
      }
    }
    if (!accepted || step <= 1e-12) break;
  }
  return w;
}

export function logLoss(data: Example[], w: number[]): number {
  if (data.length === 0) return Number.NaN;
  let loss = 0;
  for (const e of data) {
    const p = softmax(e.X.map((x) => dot(w, x)));
    loss -= Math.log(Math.max(p[e.winnerIdx], 1e-12));
  }
  return loss / data.length;
}

export function reliability(
  data: Example[],
  w: number[],
  buckets = 10,
): ReliabilityBucket[] {
  const width = 1 / buckets;
  const acc = Array.from({ length: buckets }, (_, i) => ({
    lo: i * width,
    hi: (i + 1) * width,
    n: 0,
    sumPred: 0,
    wins: 0,
  }));
  for (const e of data) {
    const p = softmax(e.X.map((x) => dot(w, x)));
    for (let j = 0; j < p.length; j++) {
      let idx = Math.min(buckets - 1, Math.floor(p[j] / width));
      if (idx < 0) idx = 0;
      acc[idx].n += 1;
      acc[idx].sumPred += p[j];
      if (j === e.winnerIdx) acc[idx].wins += 1;
    }
  }
  return acc.map((b) => {
    const predicted = b.n ? b.sumPred / b.n : 0;
    const observed = b.n ? b.wins / b.n : 0;
    return {
      lo: b.lo,
      hi: b.hi,
      n: b.n,
      predicted,
      observed,
      gap: Math.abs(observed - predicted),
    };
  });
}

export function uniformLogLoss(data: Example[]): number {
  if (data.length === 0) return Number.NaN;
  let s = 0;
  for (const e of data) s += Math.log(e.X.length);
  return s / data.length;
}
