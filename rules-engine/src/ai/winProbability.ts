/**
 * Softmax win probabilities from seat values.
 *
 * Origin: AI_Upgrade Phase 1 (P1-2).
 * Public entry symbols: winProbabilities.
 */

import type { PlayerID } from '../../../shared/src/types.js';

/**
 * P_i = exp(V_i / tau) / sum_j exp(V_j / tau) over live seats.
 * Subtracts max before exp so large gaps cannot overflow.
 * Eliminated seats get probability 0; remaining renormalise.
 */
export function winProbabilities(
  values: Record<PlayerID, number>,
  eliminated: PlayerID[],
  tau = 1,
): Record<PlayerID, number> {
  if (!(tau > 0)) throw new RangeError('tau must be positive');

  const out: Record<PlayerID, number> = {};
  for (const id of Object.keys(values) as PlayerID[]) {
    out[id] = 0;
  }

  const eliminatedSet = new Set(eliminated.map(String));
  const live = (Object.keys(values) as PlayerID[]).filter((id) => !eliminatedSet.has(String(id)));
  if (live.length === 0) return out;

  let max = -Infinity;
  for (const id of live) {
    const v = values[id];
    if (v > max) max = v;
  }

  let sum = 0;
  for (const id of live) {
    const e = Math.exp((values[id] - max) / tau);
    out[id] = e;
    sum += e;
  }
  for (const id of live) {
    out[id] /= sum;
  }
  return out;
}
