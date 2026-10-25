/**
 * Magnetic Mountain upkeep wiring: when the "that player may choose any number of tapped COLOR creatures ...
 * pay {N} for each ... untap those creatures" trigger resolves, queue a TARGET_SELECTION (0..max picks) for the
 * upkeep player, flagged upkeepPaidUntapSelection. The response is applied by resolveUpkeepPaidUntapSelection.
 */
import type { GameContext } from '../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { getMaxGenericManaAvailable, payGenericManaWithAvailableSources } from '../../socket/util.js';
import { parsePaidUntapClause, getPaidUntapOffers } from './upkeepPaidUntapChoice.js';
import { debug } from '../../utils/debug.js';

export function queueUpkeepPaidUntapFromTrigger(ctx: GameContext, sourceName: string, description: string, triggerItem: any, state: any): boolean {
  const spec = parsePaidUntapClause(description);
  if (!spec) return false;
  if ((ctx as any).isReplaying) return true;
  const playerId = String(triggerItem?.upkeepPlayerId || state?.turnPlayer || state?.activePlayer || '');
  const sourceId = String(triggerItem?.permanentId || triggerItem?.source || triggerItem?.sourceId || '');
  const offer = getPaidUntapOffers(state, playerId).find((o) => o.sourceId === sourceId)
    || (getPaidUntapOffers(state, playerId).length === 1 ? getPaidUntapOffers(state, playerId)[0] : undefined);
  if (!playerId || !offer) return true; // nothing tapped of that color: trigger does nothing
  const affordable = spec.cost > 0 ? Math.floor(getMaxGenericManaAvailable(state, playerId) / spec.cost) : offer.eligibleIds.length;
  const maxTargets = Math.min(offer.eligibleIds.length, affordable);
  if (maxTargets <= 0) return true;
  const gameId = String((ctx as any).gameId || (ctx as any).id || triggerItem?.gameId || '');
  if (!gameId) return true;
  const bf: any[] = state.battlefield || [];
  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.TARGET_SELECTION,
    playerId,
    sourceId: offer.sourceId,
    sourceName,
    description: sourceName + ': choose tapped creatures to untap, paying {' + spec.cost + '} for each',
    mandatory: false,
    validTargets: offer.eligibleIds.map((id) => {
      const perm = bf.find((x) => String(x?.id) === id);
      return { id, label: String(perm?.card?.name || 'Creature'), name: String(perm?.card?.name || 'Creature'), type: 'permanent', controller: playerId, imageUrl: perm?.card?.image_uris?.small };
    }),
    targetTypes: ['creature'],
    minTargets: 0,
    maxTargets,
    targetDescription: 'tapped creatures to untap ({' + spec.cost + '} each)',
    upkeepPaidUntapSelection: true,
    upkeepPaidUntapCostPerCreature: spec.cost,
  } as any);
  debug(2, '[upkeepPaidUntap] queued for ' + playerId + ' from ' + sourceName + ' (max ' + maxTargets + ')');
  return true;
}

/** Pay {N} per chosen creature (generic, auto from pool then sources) and untap them. */
export function resolveUpkeepPaidUntapSelection(state: any, step: any, playerId: string, selections: string[]): { untapped: string[]; paid: number; tappedForMana: string[]; sacrificedForMana?: string[]; paymentManaDelta?: Record<string, number>; error?: string } {
  const cost = Math.max(0, Number(step?.upkeepPaidUntapCostPerCreature || 0));
  const valid = new Set(((step?.validTargets || []) as any[]).map((t) => String(t.id)));
  const bf: any[] = state?.battlefield || [];
  const chosen = Array.from(new Set((selections || []).map(String))).filter((id) => valid.has(id)
    && bf.some((x) => String(x?.id) === id && x.tapped && String(x.controller) === playerId));
  if (!chosen.length) return { untapped: [], paid: 0, tappedForMana: [] };
  const payment = payGenericManaWithAvailableSources(state, playerId, cost * chosen.length, { excludedPermanentIds: chosen } as any);
  if (!payment.ok) return { untapped: [], paid: 0, tappedForMana: [], error: payment.error || 'Cannot pay' };
  for (const id of chosen) { const perm = bf.find((x) => String(x?.id) === id); if (perm) perm.tapped = false; }
  return {
    untapped: chosen,
    paid: cost * chosen.length,
    tappedForMana: payment.tappedPermanents || [],
    sacrificedForMana: (payment as any).sacrificedPermanents || [],
    paymentManaDelta: (payment as any).paymentManaDelta || {},
  };
}
