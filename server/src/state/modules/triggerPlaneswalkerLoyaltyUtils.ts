import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { updateCounters } from './counters_tokens.js';

export interface PlaneswalkerLoyaltyCounterParams {
  readonly ctx: GameContext;
  readonly sourceName: string;
  readonly triggerItem: any;
  readonly battlefield: readonly any[];
}

/**
 * Spell-cast / ETB metadata path: adds loyalty counters when triggerItem carries
 * addsLoyaltyCounters (not parsed from oracle IR steps).
 * Routes through updateCounters so undo/replay persists the change.
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

  const permanentId = String(planeswalker.id || permId || '').trim();
  if (!permanentId) {
    return false;
  }

  const skipEventPersistence = Boolean((params.ctx as any)?.isReplaying);
  updateCounters(params.ctx, permanentId, { loyalty: addsLoyalty }, {
    ...(skipEventPersistence ? { skipEventPersistence: true } : {}),
  });

  const newLoyalty = Number((planeswalker as any)?.counters?.loyalty || 0);
  debug(1, `[executeTriggerEffect] Installed loyalty counter on ${params.sourceName}: added ${addsLoyalty}, now at ${newLoyalty}`);
  return true;
}
