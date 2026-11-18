/**
 * Sticky combat declarations for the current seat/step window.
 *
 * Origin: large-board DECLARE_ATTACKERS/BLOCKERS wakes re-planned from scratch
 * after a failed declare or priority re-entry. Sticky reuse keeps the first plan
 * for the rest of the step (same pattern as MAIN1 sticky turn plans).
 *
 * Public: combatDecisionWindowKey, readStickyAttackPlan, writeStickyAttackPlan,
 *   filterStickyAttacksToLegal, readStickyBlockPlan, writeStickyBlockPlan,
 *   filterStickyBlocksToLegal.
 */

import type { PlayerID } from '../../../shared/src/types.js';
import type { AttackDeclaration } from './attackPlanner.js';

export type BlockAssignmentSticky = { blockerId: string; attackerId: string };

function combatStickyMap(gameState: any): Record<string, { windowKey: string; payload: unknown }> {
  if (!gameState || typeof gameState !== 'object') return {};
  return (gameState._aiStickyCombat ||= {}) as Record<string, { windowKey: string; payload: unknown }>;
}

export function combatDecisionWindowKey(
  gameState: any,
  playerId: PlayerID | string,
  kind: 'attack' | 'block',
): string {
  return [
    kind,
    String(playerId),
    String(gameState?.turnNumber ?? gameState?.turn ?? ''),
    String(gameState?.step ?? ''),
  ].join('|');
}

export function readStickyAttackPlan(
  gameState: any,
  playerId: PlayerID | string,
): AttackDeclaration[] | null {
  const windowKey = combatDecisionWindowKey(gameState, playerId, 'attack');
  const entry = combatStickyMap(gameState)[String(playerId)];
  if (!entry || entry.windowKey !== windowKey) return null;
  const payload = entry.payload;
  return Array.isArray(payload) ? (payload as AttackDeclaration[]) : null;
}

export function writeStickyAttackPlan(
  gameState: any,
  playerId: PlayerID | string,
  attackers: readonly AttackDeclaration[],
): void {
  const windowKey = combatDecisionWindowKey(gameState, playerId, 'attack');
  combatStickyMap(gameState)[String(playerId)] = {
    windowKey,
    payload: attackers.map((a) => ({
      creatureId: String(a.creatureId),
      defendingPlayerId: String(a.defendingPlayerId),
    })),
  };
}

/** Keep sticky attackers that are still legal; drop the rest. */
export function filterStickyAttacksToLegal(
  sticky: readonly AttackDeclaration[],
  legalAttackerIds: readonly string[],
): AttackDeclaration[] {
  const legal = new Set(legalAttackerIds.map(String));
  return sticky.filter((a) => legal.has(String(a.creatureId)));
}

export function readStickyBlockPlan(
  gameState: any,
  playerId: PlayerID | string,
): BlockAssignmentSticky[] | null {
  const windowKey = combatDecisionWindowKey(gameState, playerId, 'block');
  // Separate key namespace from attacks so attack/block don't clobber each other.
  const mapKey = `block:${String(playerId)}`;
  const entry = combatStickyMap(gameState)[mapKey];
  if (!entry || entry.windowKey !== windowKey) return null;
  const payload = entry.payload;
  return Array.isArray(payload) ? (payload as BlockAssignmentSticky[]) : null;
}

export function writeStickyBlockPlan(
  gameState: any,
  playerId: PlayerID | string,
  blockers: readonly BlockAssignmentSticky[],
): void {
  const windowKey = combatDecisionWindowKey(gameState, playerId, 'block');
  const mapKey = `block:${String(playerId)}`;
  combatStickyMap(gameState)[mapKey] = {
    windowKey,
    payload: blockers.map((b) => ({
      blockerId: String(b.blockerId),
      attackerId: String(b.attackerId),
    })),
  };
}

export function filterStickyBlocksToLegal(
  sticky: readonly BlockAssignmentSticky[],
  legalBlockerIds: readonly string[],
  attackerIds: readonly string[],
): BlockAssignmentSticky[] {
  const blockers = new Set(legalBlockerIds.map(String));
  const attackers = new Set(attackerIds.map(String));
  const usedBlockers = new Set<string>();
  const out: BlockAssignmentSticky[] = [];
  for (const b of sticky) {
    const blockerId = String(b.blockerId);
    const attackerId = String(b.attackerId);
    if (!blockers.has(blockerId) || !attackers.has(attackerId)) continue;
    if (usedBlockers.has(blockerId)) continue;
    usedBlockers.add(blockerId);
    out.push({ blockerId, attackerId });
  }
  return out;
}
