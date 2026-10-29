/**
 * Replicate additional-cost helpers (CR 702.56).
 * "Replicate {cost}" means you may pay {cost} any number of times as you cast the spell.
 * The on-cast trigger then copies the spell once per payment.
 *
 * Public entry symbols: parseReplicateManaCost, expandManaCostWithReplicate,
 * getMaxAffordableReplicateTimes, readReplicateCount, stampReplicateCount,
 * pendingReplicateCountFields.
 */

import type { PlayerID } from '../../../../shared/src/index.js';
import {
  expandManaCostWithMultikicker,
  getMaxAffordableMultikickerTimes,
} from './multikickerCastUtils.js';

export function parseReplicateManaCost(oracleText: string): string | null {
  const match = String(oracleText || '').match(/\breplicate\s*((?:\{[^}]+\})+)/i);
  const cost = String(match?.[1] || '').trim();
  return cost || null;
}

export function expandManaCostWithReplicate(
  baseManaCost: string,
  replicateCost: string | null | undefined,
  timesPaid: number,
): string {
  return expandManaCostWithMultikicker(baseManaCost, replicateCost, timesPaid);
}

export function getMaxAffordableReplicateTimes(
  game: any,
  playerId: PlayerID,
  baseManaCost: string,
  replicateCost: string,
  options?: {
    minValue?: number;
    maxValue?: number;
    excludedHandCardIds?: string[];
  },
): number {
  return getMaxAffordableMultikickerTimes(game, playerId, baseManaCost, replicateCost, options);
}

export function readReplicateCount(source: any): number {
  const raw = source?.replicateCount ?? source?.card?.replicateCount;
  const count = Math.floor(Number(raw));
  return Number.isFinite(count) && count > 0 ? count : 0;
}

export function stampReplicateCount(card: any, timesPaid: number): void {
  if (!card || typeof card !== 'object') return;
  const times = Math.max(0, Math.floor(Number(timesPaid) || 0));
  if (times <= 0) {
    delete card.replicateCount;
    return;
  }
  card.replicateCount = times;
}

export function pendingReplicateCountFields(card: any): { replicateCount?: number } {
  const count = readReplicateCount(card);
  return count > 0 ? { replicateCount: count } : {};
}
