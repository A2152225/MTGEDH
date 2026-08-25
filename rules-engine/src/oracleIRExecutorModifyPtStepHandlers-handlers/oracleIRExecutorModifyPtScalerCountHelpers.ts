/**
 * Origin parent: oracleIRExecutorModifyPtStepHandlers.ts
 * Cluster moved: battlefield scaler count helpers used by resolveReferenceScalerScale
 *   and leftover applyModifyPtStep
 * Public: countAttackingCreaturesMatching, countCreaturesBlockedByTarget,
 *   countCreaturesBlockingTarget, countBasicLandTypesAmongLandsYouControl,
 *   countArtifactsYouControl, countOtherAttackingAurochs,
 *   countControlledCreaturesWithSubtype, countPartyCreatures,
 *   countBloodTokensForPlayer
 */

import type { GameState, PlayerID } from '../../../shared/src';

export function countAttackingCreaturesMatching(
  state: GameState,
  targetCreatureId: string,
  options?: {
    readonly subtype?: string;
    readonly excludeTarget?: boolean;
    readonly controllerId?: PlayerID;
    readonly onlyControlledBy?: PlayerID;
  }
): number {
  const combat: any = (state as any).combat || {};
  const attackingIds = Array.isArray(combat.attackers)
    ? combat.attackers.map((entry: any) => String(entry?.permanentId || entry?.id || '').trim()).filter(Boolean)
    : [];
  const excludedId = options?.excludeTarget ? String(targetCreatureId || '').trim() : '';
  const subtype = String(options?.subtype || '').trim().toLowerCase();
  const subtypePattern = subtype ? new RegExp(`\\b${subtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i') : null;
  const battlefield = Array.isArray((state as any).battlefield) ? (state as any).battlefield : [];

  return battlefield.filter((permanent: any) => {
    const permanentId = String(permanent?.id || permanent?.permanentId || '').trim();
    if (!permanentId || (excludedId && permanentId === excludedId)) return false;
    const isAttacking = Boolean(permanent?.attacking) || attackingIds.includes(permanentId);
    if (!isAttacking) return false;
    if (options?.onlyControlledBy) {
      const controller = String(permanent?.controller || permanent?.controllerId || '').trim();
      if (controller !== String(options.onlyControlledBy || '').trim()) return false;
    }
    if (subtypePattern) {
      const typeLine = String(
        permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || ''
      );
      if (!subtypePattern.test(typeLine)) return false;
    }
    return true;
  }).length;
}

export function countCreaturesBlockedByTarget(state: GameState, targetCreatureId: string): number {
  const targetId = String(targetCreatureId || '').trim();
  if (!targetId) return 0;
  const combat: any = (state as any).combat || {};
  if (Array.isArray(combat.blockers)) {
    const entry = combat.blockers.find(
      (candidate: any) => String(candidate?.permanentId || candidate?.id || '').trim() === targetId
    );
    if (entry && Array.isArray(entry.blocking)) {
      return new Set(entry.blocking.map((id: any) => String(id || '').trim()).filter(Boolean)).size;
    }
  }
  return 0;
}

export function countCreaturesBlockingTarget(state: GameState, targetCreatureId: string): number {
  const targetId = String(targetCreatureId || '').trim();
  if (!targetId) return 0;
  const battlefield = Array.isArray((state as any).battlefield) ? (state as any).battlefield : [];
  const targetPermanent = battlefield.find(
    (perm: any) => String(perm?.id || perm?.permanentId || '').trim() === targetId
  );
  if (targetPermanent && Array.isArray((targetPermanent as any).blockedBy)) {
    return new Set(
      ((targetPermanent as any).blockedBy as readonly unknown[])
        .map((id) => String(id || '').trim())
        .filter(Boolean)
    ).size;
  }

  const combat: any = (state as any).combat || {};
  const attackerEntry = Array.isArray(combat.attackers)
    ? combat.attackers.find((entry: any) => String(entry?.permanentId || '').trim() === targetId)
    : null;
  if (attackerEntry && Array.isArray(attackerEntry.blockedBy)) {
    return new Set(attackerEntry.blockedBy.map((id: any) => String(id || '').trim()).filter(Boolean)).size;
  }

  if (Array.isArray(combat.blockers)) {
    return combat.blockers.filter((entry: any) =>
      Array.isArray(entry?.blocking) && entry.blocking.some((id: any) => String(id || '').trim() === targetId)
    ).length;
  }

  return 0;
}

export function countBasicLandTypesAmongLandsYouControl(state: GameState, controllerId: PlayerID): number {
  const basicLandTypes = new Set(['plains', 'island', 'swamp', 'mountain', 'forest']);
  const found = new Set<string>();
  const battlefield = Array.isArray((state as any).battlefield) ? (state as any).battlefield : [];
  for (const permanent of battlefield) {
    if (String(permanent?.controllerId || permanent?.controller || '').trim() !== String(controllerId || '').trim()) continue;
    const typeLine = String(permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || '').toLowerCase();
    if (!/\bland\b/i.test(typeLine)) continue;
    for (const basicType of basicLandTypes) {
      if (new RegExp(`\\b${basicType}\\b`, 'i').test(typeLine)) found.add(basicType);
    }
  }
  return found.size;
}

export function countArtifactsYouControl(state: GameState, controllerId: PlayerID): number {
  const battlefield = Array.isArray((state as any).battlefield) ? (state as any).battlefield : [];
  return battlefield.filter((permanent: any) => {
    if (String(permanent?.controllerId || permanent?.controller || '').trim() !== String(controllerId || '').trim()) return false;
    const typeLine = String(permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || '').toLowerCase();
    return /\bartifact\b/i.test(typeLine);
  }).length;
}

export function countOtherAttackingAurochs(state: GameState, targetCreatureId: string): number {
  const targetId = String(targetCreatureId || '').trim();
  const combat: any = (state as any).combat || {};
  const attackingIds = Array.isArray(combat.attackers)
    ? combat.attackers.map((entry: any) => String(entry?.permanentId || entry?.id || '').trim()).filter(Boolean)
    : [];
  if (attackingIds.length === 0) return 0;

  const battlefield = Array.isArray((state as any).battlefield) ? (state as any).battlefield : [];
  return battlefield.filter((permanent: any) => {
    const permanentId = String(permanent?.id || permanent?.permanentId || '').trim();
    if (!permanentId || permanentId === targetId || !attackingIds.includes(permanentId)) return false;
    const typeLine = String(permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || '').toLowerCase();
    const name = String(permanent?.card?.name || permanent?.name || '').toLowerCase();
    return /\baurochs\b/i.test(typeLine) || /\baurochs\b/i.test(name);
  }).length;
}

export function countControlledCreaturesWithSubtype(
  state: GameState,
  controllerId: PlayerID,
  subtype: string
): number {
  const normalizedSubtype = String(subtype || '').trim().toLowerCase();
  if (!normalizedSubtype) return 0;
  const escaped = normalizedSubtype.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const subtypePattern = new RegExp(`\\b${escaped}s?\\b`, 'i');
  const battlefield = Array.isArray((state as any).battlefield) ? (state as any).battlefield : [];
  return battlefield.filter((permanent: any) => {
    if (String(permanent?.controllerId || permanent?.controller || '').trim() !== String(controllerId || '').trim()) {
      return false;
    }
    const typeLine = String(
      permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || ''
    ).toLowerCase();
    return /\bcreature\b/i.test(typeLine) && subtypePattern.test(typeLine);
  }).length;
}

export function countPartyCreatures(state: GameState, controllerId: PlayerID): number {
  const partyClasses = ['cleric', 'rogue', 'warrior', 'wizard'];
  const battlefield = Array.isArray((state as any).battlefield) ? (state as any).battlefield : [];
  let count = 0;
  for (const klass of partyClasses) {
    const hasMember = battlefield.some((permanent: any) => {
      if (String(permanent?.controller || permanent?.controllerId || '').trim() !== String(controllerId || '').trim()) {
        return false;
      }
      const typeLine = String(
        permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || ''
      ).toLowerCase();
      return /\bcreature\b/i.test(typeLine) && new RegExp(`\\b${klass}s?\\b`, 'i').test(typeLine);
    });
    if (hasMember) count += 1;
  }
  return count;
}

export function countBloodTokensForPlayer(state: GameState, playerId: PlayerID): number {
  const battlefield = Array.isArray((state as any).battlefield) ? (state as any).battlefield : [];
  return battlefield.reduce((sum: number, permanent: any) => {
    if (String(permanent?.controller || permanent?.controllerId || '').trim() !== String(playerId || '').trim()) {
      return sum;
    }
    const counters = (permanent as any)?.counters;
    if (!counters || typeof counters !== 'object') return sum;
    const blood = Number((counters as any).blood ?? (counters as any).Blood ?? 0);
    return sum + (Number.isFinite(blood) ? Math.max(0, blood) : 0);
  }, 0);
}

