// server/src/state/modules/derivedContinuousEffectsScanScope.ts
//
// Origin: new module (no parent). Companion to primeDerivedContinuousEffectsForScan in
// staticEffectSpec.ts, for scans that read the live game state rather than a throwaway copy.
//
// Public entry symbols:
//   runWithDerivedContinuousEffectsForScan
//
// The derived continuous-effects view is a non-enumerable field that the executor's
// `{ ...state }` copies drop, and it is only rebuilt at the next state-based-action sync. A trigger
// scan that runs in between asks "which abilities does this permanent have?" once per permanent,
// and every one of those questions rebuilt the whole view. With 97 permanents on the battlefield
// (66 Borg tokens) one card going to the graveyard cost 97 rebuilds and about 155 seconds.
//
// This computes the view once for the duration of a read-only scan and removes it afterwards, so
// later code that changes the battlefield never reads a stale view.

import { primeDerivedContinuousEffectsForScan, readDerivedContinuousEffects } from './staticEffectSpec.js';

const DERIVED_FIELD = '_derivedContinuousEffects';

/** Run a read-only battlefield scan with the derived continuous-effects view computed at most once. */
export function runWithDerivedContinuousEffectsForScan<T>(state: unknown, scan: () => T): T {
  if (!state || typeof state !== 'object' || readDerivedContinuousEffects(state)) return scan();

  let primed = false;
  try {
    primed = Boolean(primeDerivedContinuousEffectsForScan(state));
  } catch {
    primed = false;
  }
  try {
    return scan();
  } finally {
    if (primed) delete (state as Record<string, unknown>)[DERIVED_FIELD];
  }
}
