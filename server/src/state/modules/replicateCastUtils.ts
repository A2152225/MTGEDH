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

const GRANTED_REPLICATE_RE = /\b([a-z ,]+?) spells you cast have replicate\s*((?:\{[^}]+\})+)/i;

function spellMatchesGrantedTypes(card: any, typeWords: string): boolean {
  const typeLine = String(card?.type_line || '').toLowerCase();
  const words = String(typeWords || '').toLowerCase().split(/\s*(?:,|\band\b|\bor\b)\s*/).map(w => w.trim()).filter(Boolean);
  if (words.length === 0) return false;
  return words.some(w => w === 'all' || typeLine.includes(w.replace(/s$/, '')));
}

/** "Artifact spells you cast have replicate {2}{U}" (Hugh, First of Many) from permanents the caster controls. */
export function getGrantedReplicateManaCost(state: any, playerId: PlayerID, card: any): string | null {
  const battlefield: any[] = Array.isArray(state?.battlefield) ? state.battlefield : [];
  for (const perm of battlefield) {
    if (!perm || String(perm.controller || '') !== String(playerId)) continue;
    const text = String(perm.card?.oracle_text || perm.oracle_text || '');
    const m = text.match(GRANTED_REPLICATE_RE);
    if (!m) continue;
    if (spellMatchesGrantedTypes(card, m[1])) return m[2];
  }
  return null;
}

/** Printed replicate cost, else a grant stamped at cast time (grantedReplicateCost). */
export function readReplicateManaCost(card: any, oracleText?: string): string | null {
  return parseReplicateManaCost(String(oracleText || card?.oracle_text || ''))
    || (String(card?.grantedReplicateCost || '').trim() || null);
}

/** Stamp a static replicate grant on the cast card(s) so later prompts and on-cast triggers see it. */
export function stampGrantedReplicateCost(state: any, playerId: PlayerID, cards: any[], oracleText?: string): void {
  const primary = cards.find(Boolean);
  if (parseReplicateManaCost(String(oracleText || primary?.oracle_text || ''))) return;
  const granted = getGrantedReplicateManaCost(state, playerId, primary);
  for (const c of cards) {
    if (!c || typeof c !== 'object') continue;
    if (granted) c.grantedReplicateCost = granted; else delete c.grantedReplicateCost;
  }
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
