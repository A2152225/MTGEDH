/**
 * Derived continuous effects for AI spell-payment simulation clones.
 *
 * Origin parent: server/src/socket/ai-handlers/aiSpellPaymentPlanHelpers.ts
 * (cloneAISpellPaymentSimulationGame). New code, nothing moved.
 *
 * Cluster: the simulation clone is `JSON.parse(JSON.stringify(state))`, which drops the
 * non-enumerable `_derivedContinuousEffects` view. Without it every
 * `calculateManaProduction` / `getManaAbilitiesForPermanent` call on the clone recomputed
 * all continuous effects for the whole battlefield. A CPU profile of self-play shard 28
 * (38 permanents) showed 94% of a 180s tick in that recompute, 88s per response scan.
 *
 * The clone gets the view computed once, and it is recomputed only when the simulation has
 * changed something a continuous effect can read (battlefield membership, tapped state,
 * counters, zone sizes). Clones are throwaway and never saved, so no replay event applies.
 *
 * Public entry symbols: primeAISpellPaymentSimulationDerivedEffects,
 * refreshAISpellPaymentSimulationDerivedEffects.
 */
import { primeDerivedContinuousEffectsForScan } from "../../state/modules/staticEffectSpec.js";

const SIGNATURE_FIELD = '_aiSpellPaymentSimulationSignature';
const DERIVED_FIELD = '_derivedContinuousEffects';

function simulationSignature(state: any): string {
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const parts: string[] = [];
  for (const permanent of battlefield) {
    if (!permanent) continue;
    const counters = permanent.counters && typeof permanent.counters === 'object'
      ? Object.entries(permanent.counters)
        .filter(([, value]) => Number(value) !== 0)
        .map(([name, value]) => `${name}=${value}`)
        .sort()
        .join(',')
      : '';
    parts.push(`${permanent.id}:${permanent.controller}:${permanent.tapped ? 1 : 0}:${counters}`);
  }
  const zones = state?.zones && typeof state.zones === 'object' ? state.zones : {};
  for (const playerId of Object.keys(zones).sort()) {
    const zone = zones[playerId] || {};
    const size = (cards: unknown) => (Array.isArray(cards) ? cards.length : 0);
    parts.push(`${playerId}#${size(zone.hand)}/${size(zone.graveyard)}/${size(zone.exile)}`);
  }
  return parts.join('|');
}

function writeSignature(state: object, signature: string): void {
  Object.defineProperty(state, SIGNATURE_FIELD, {
    value: signature,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

/** Call once on a fresh simulation clone. Marks it as a clone and computes the view once. */
export function primeAISpellPaymentSimulationDerivedEffects(simulatedGame: any): void {
  const state = simulatedGame?.state;
  if (!state || typeof state !== 'object' || !Array.isArray(state.battlefield)) return;
  try {
    primeDerivedContinuousEffectsForScan(state);
    writeSignature(state, simulationSignature(state));
  } catch {
    // Leave the clone unprimed: readers then recompute per call, as they did before.
  }
}

/**
 * Recomputes the view when a simulated activation changed the clone since it was last
 * computed. No-op for anything that is not a primed simulation clone (the live game is
 * refreshed by SBA sync and must not be touched here).
 */
export function refreshAISpellPaymentSimulationDerivedEffects(game: any): void {
  const state = game?.state;
  if (!state || typeof state !== 'object') return;
  if (!Object.prototype.hasOwnProperty.call(state, SIGNATURE_FIELD)) return;
  try {
    const signature = simulationSignature(state);
    if (signature === (state as Record<string, unknown>)[SIGNATURE_FIELD]) return;
    delete (state as Record<string, unknown>)[DERIVED_FIELD];
    primeDerivedContinuousEffectsForScan(state);
    writeSignature(state, signature);
  } catch {
    // Fall back to per-call recompute for this clone.
    delete (state as Record<string, unknown>)[DERIVED_FIELD];
  }
}
