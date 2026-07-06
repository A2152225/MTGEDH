import type { PlayerID } from '../../../../shared/src/index.js';
import { debug } from '../../utils/debug.js';

export interface PlaneswalkerLoyaltyCounterParams {
  readonly sourceName: string;
  readonly triggerItem: any;
  readonly battlefield: readonly any[];
}

/**
 * Spell-cast / ETB metadata path: adds loyalty counters when triggerItem carries
 * addsLoyaltyCounters (not parsed from oracle IR steps).
 */
export function applyPlaneswalkerLoyaltyCountersFromTriggerMetadata(
  params: PlaneswalkerLoyaltyCounterParams,
): boolean {
  const addsLoyalty = Number(params.triggerItem?.addsLoyaltyCounters || 0);
  if (addsLoyalty <= 0) {
    return false;
  }

  const permId = params.triggerItem?.permanentId || params.triggerItem?.source;
  const planeswalker = params.battlefield.find((p: any) => p && String(p.id) === String(permId));
  if (!planeswalker) {
    return false;
  }

  planeswalker.counters = planeswalker.counters || {};
  const currentLoyalty = parseInt(String(planeswalker.counters.loyalty || planeswalker.card?.loyalty || 0), 10) || 0;
  const newLoyalty = currentLoyalty + addsLoyalty;
  planeswalker.counters.loyalty = newLoyalty;

  debug(1, `[executeTriggerEffect] Installed loyalty counter on ${params.sourceName}: added ${addsLoyalty}, now at ${newLoyalty}`);
  return true;
}
