import { reportHookFailure } from '../../shared/src/hookFailureReporter.js';
/**
 * Player-counter gain hook for the Oracle IR executor.
 *
 * Experience (and other player counters written through adjustPlayerCounter / proliferate)
 * live on a plain rules-engine state and do not import the server's Winding Constrictor
 * replacement. The server registers one adjustment once at startup; a missing hook leaves
 * the written amount unchanged.
 *
 * Public: registerPlayerCounterGainAdjustment, resolvePlayerCounterGainFromHook
 * Leaf: imports nothing from the rest of the rules-engine.
 */
export type PlayerCounterGainAdjustment = (
  state: any,
  playerId: string,
  counter: string,
  amount: number,
) => number;

let registeredAdjustment: PlayerCounterGainAdjustment | null = null;

export function registerPlayerCounterGainAdjustment(adjustment: PlayerCounterGainAdjustment | null): void {
  registeredAdjustment = adjustment;
}

/** Final non-negative amount to add when playerId would get `amount` of `counter`. */
export function resolvePlayerCounterGainFromHook(
  state: any,
  playerId: string,
  counter: string,
  amount: number,
): number {
  if (!registeredAdjustment || !(amount > 0)) return amount;
  try {
    const next = Number(registeredAdjustment(state, String(playerId || ''), String(counter || ''), amount));
    return Number.isFinite(next) ? Math.max(0, Math.trunc(next)) : amount;
  } catch (err) {
    reportHookFailure('playerCounterGainHook', err, { source: 'playerCounterGainHook' });
    return amount;
  }
}
