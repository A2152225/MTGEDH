/**
 * Impending (CR 702.176): cast for alternate cost; enters with N time counters;
 * isn't a creature while it has a time counter; at beginning of your end step,
 * remove a time counter.
 *
 * Public: spellWasCastWithImpendingPaid, applyImpendingOnPermanentEntry,
 * processImpendingEndStepCounterRemoval.
 */

import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { debug } from '../../utils/debug.js';
import { parseImpendingInfo } from './alternate-costs.js';
import { queueCounterRemovedTriggers } from './triggers/counters.js';

export function spellWasCastWithImpendingPaid(stackItem?: any, card?: any): boolean {
  const alt = String(stackItem?.alternateCostId || card?.alternateCostId || '').toLowerCase().trim();
  if (alt === 'impending') return true;
  return stackItem?.impendingCostWasPaid === true || card?.impendingCostWasPaid === true;
}

function timeCounterCount(permanent: any): number {
  return Math.max(0, Number(permanent?.counters?.time ?? permanent?.counters?.['time'] ?? 0) || 0);
}

function syncImpendingCreatureStatus(permanent: any): void {
  if (!permanent) return;
  const impending = permanent.wasImpendingCast === true || permanent.impendingCostWasPaid === true;
  if (!impending) return;
  permanent.notCreature = timeCounterCount(permanent) > 0;
}

/**
 * When a permanent enters after being cast for its impending cost: put N time
 * counters on it and mark it not a creature until the last is removed.
 */
export function applyImpendingOnPermanentEntry(
  ctx: GameContext,
  permanent: any,
  controller: PlayerID,
  sourceName: string,
  stackItem?: any,
): void {
  if (!permanent?.id) return;
  const card = permanent?.card || {};
  const oracleText = String(card?.oracle_text || '');
  const info = parseImpendingInfo(oracleText);
  if (!info) return;
  if (!spellWasCastWithImpendingPaid(stackItem, card)) return;

  const stampedCounters = Number(
    stackItem?.impendingTimeCounters
    ?? card?.impendingTimeCounters
    ?? info.timeCounters,
  );
  const count = Number.isFinite(stampedCounters) && stampedCounters > 0
    ? Math.floor(stampedCounters)
    : info.timeCounters;

  permanent.counters = { ...(permanent.counters || {}) };
  permanent.counters.time = Math.max(Number(permanent.counters.time || 0), count);
  permanent.impendingCostWasPaid = true;
  permanent.wasImpendingCast = true;
  permanent.impendingTimeCountersInitial = count;
  permanent.card = {
    ...(permanent.card || {}),
    impendingCostWasPaid: true,
    wasImpendingCast: true,
    impendingTimeCounters: count,
  };
  syncImpendingCreatureStatus(permanent);

  debug(2, `[impending] ${sourceName || card?.name || permanent.id} enters with ${count} time counter(s) for ${controller}`);
}

/**
 * At the beginning of the turn player's end step: remove one time counter from
 * each of their impending permanents that still has one.
 */
export function processImpendingEndStepCounterRemoval(ctx: GameContext): void {
  const state = (ctx as any).state;
  if (!state) return;
  const turnPlayer = String(state.turnPlayer || '').trim();
  if (!turnPlayer) return;

  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  let changed = false;
  for (const permanent of battlefield) {
    if (!permanent) continue;
    if (String(permanent.controller || '').trim() !== turnPlayer) continue;
    const impending = permanent.wasImpendingCast === true || permanent.impendingCostWasPaid === true;
    if (!impending) continue;
    if (timeCounterCount(permanent) <= 0) {
      syncImpendingCreatureStatus(permanent);
      continue;
    }

    permanent.counters = { ...(permanent.counters || {}) };
    permanent.counters.time = Math.max(0, Number(permanent.counters.time || 0) - 1);
    queueCounterRemovedTriggers(ctx, permanent, String(permanent.id || ''), { time: 1 });
    syncImpendingCreatureStatus(permanent);
    changed = true;
    debug(2, `[impending] Removed time counter from ${permanent.card?.name || permanent.id} (${permanent.counters.time} remain)`);
  }
  if (changed) ctx.bumpSeq();
}
