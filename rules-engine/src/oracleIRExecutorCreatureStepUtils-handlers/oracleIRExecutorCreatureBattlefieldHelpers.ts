/**
 * Origin parent: oracleIRExecutorCreatureStepUtils.ts
 * Cluster moved: P/T comparison readers, attacking/blocking helpers, permanentHasKeyword
 * Public: isAttackingPermanent, permanentHasKeyword, readPowerForComparison,
 *   readCreatureStatForComparison, readToughnessForComparison, resolveBlockersOfPermanent,
 *   resolveBlockingCreatureIds, isUnblockedAttackingPermanent
 */

import type { BattlefieldPermanent, GameState } from '../../../shared/src';
import { normalizeOracleText } from '../oracleIRExecutorPlayerUtils';
import { getCombinedPermanentText } from '../permanentText';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureBattlefieldLookup';

export function readPowerForComparison(permanent: BattlefieldPermanent | any): number | null {
  for (const candidate of [
    (permanent as any)?.effectivePower,
    (permanent as any)?.power,
    (permanent as any)?.basePower,
    (permanent as any)?.card?.power,
  ]) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) return numeric;
  }

  return null;
}

export function readToughnessForComparison(permanent: BattlefieldPermanent | any): number | null {
  for (const candidate of [
    (permanent as any)?.effectiveToughness,
    (permanent as any)?.toughness,
    (permanent as any)?.baseToughness,
    (permanent as any)?.card?.toughness,
  ]) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric)) return numeric;
  }

  return null;
}

export function readCreatureStatForComparison(
  permanent: BattlefieldPermanent | any,
  which: 'power' | 'toughness'
): number | null {
  return which === 'power'
    ? readPowerForComparison(permanent)
    : readToughnessForComparison(permanent);
}

export function isAttackingPermanent(permanent: BattlefieldPermanent | any): boolean {
  return Boolean((permanent as any)?.attacking || (permanent as any)?.defendingPlayerId || (permanent as any)?.attackingPlayerId);
}

export function resolveBlockersOfPermanent(state: GameState, blockedPermanentId: string): string[] {
  const blockedId = String(blockedPermanentId || '').trim();
  if (!blockedId) return [];

  const battlefield = getProcessedBattlefield(state);
  const blockerIds = new Set<string>();

  const blockedPermanent = battlefield.find(
    (permanent) => String((permanent as any)?.id || '').trim() === blockedId,
  ) as any;
  const blockedBy = Array.isArray(blockedPermanent?.blockedBy) ? blockedPermanent.blockedBy : [];
  for (const entry of blockedBy) {
    const blockerId = String((entry as any)?.blockerId || entry || '').trim();
    if (blockerId) blockerIds.add(blockerId);
  }

  const combat: any = (state as any).combat || {};
  if (Array.isArray(combat.attackers)) {
    const attackerEntry = combat.attackers.find(
      (entry: any) => String(entry?.permanentId || entry?.id || '').trim() === blockedId,
    );
    if (attackerEntry && Array.isArray(attackerEntry.blockedBy)) {
      for (const blockerId of attackerEntry.blockedBy) {
        const normalized = String(blockerId || '').trim();
        if (normalized) blockerIds.add(normalized);
      }
    }
  }
  if (Array.isArray(combat.blockers)) {
    for (const entry of combat.blockers) {
      const blocking = Array.isArray(entry?.blocking) ? entry.blocking : [];
      if (!blocking.some((id: unknown) => String(id || '').trim() === blockedId)) continue;
      const blockerId = String(entry?.permanentId || entry?.id || '').trim();
      if (blockerId) blockerIds.add(blockerId);
    }
  }

  return [...blockerIds].filter((blockerId) =>
    battlefield.some((permanent) => String((permanent as any)?.id || '').trim() === blockerId),
  );
}

export function resolveBlockingCreatureIds(state: GameState): string[] {
  const battlefield = getProcessedBattlefield(state);
  const blockerIds = new Set<string>();

  for (const permanent of battlefield) {
    const permanentId = String((permanent as any)?.id || '').trim();
    if (!permanentId) continue;
    const blocking = (permanent as any)?.blocking;
    if (Array.isArray(blocking) && blocking.length > 0) {
      blockerIds.add(permanentId);
      continue;
    }
    if (typeof blocking === 'string' && blocking.trim()) {
      blockerIds.add(permanentId);
    }
  }

  const combat: any = (state as any).combat || {};
  if (Array.isArray(combat.blockers)) {
    for (const entry of combat.blockers) {
      const blockerId = String(entry?.permanentId || entry?.id || '').trim();
      if (blockerId) blockerIds.add(blockerId);
    }
  }

  return [...blockerIds].filter(Boolean);
}

export function isUnblockedAttackingPermanent(permanent: BattlefieldPermanent | any): boolean {
  if (!isAttackingPermanent(permanent)) return false;
  const blockedBy = (permanent as any)?.blockedBy;
  return !Array.isArray(blockedBy) || blockedBy.length === 0;
}

export function permanentHasKeyword(permanent: BattlefieldPermanent | any, rawKeyword: string): boolean {
  const keyword = normalizeOracleText(rawKeyword);
  if (!keyword) return false;

  const combinedText = normalizeOracleText(getCombinedPermanentText(permanent));
  if (combinedText.includes(keyword)) return true;

  const keywordValues: unknown[] = [
    ...(Array.isArray((permanent as any)?.keywords) ? (permanent as any).keywords : []),
    ...(Array.isArray((permanent as any)?.card?.keywords) ? (permanent as any).card.keywords : []),
  ];

  return keywordValues.some(value => normalizeOracleText(String(value || '')) === keyword);
}
