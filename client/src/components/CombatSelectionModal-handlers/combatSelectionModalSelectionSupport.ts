// Origin parent: client/src/components/CombatSelectionModal.tsx
// Cluster moved: checkMenaceBlocking, cloneSelectedBlockers, getBlockerAssignments,
// countBlockingCreatures, countTotalBlockAssignments, splitCreatureGroups, buildAttackerSelections.
// Public entry symbols: checkMenaceBlocking, cloneSelectedBlockers, getBlockerAssignments,
// countBlockingCreatures, countTotalBlockAssignments, splitCreatureGroups, buildAttackerSelections.
// Leaf must not import CombatSelectionModal.tsx or CombatSelectionModal-handlers/index.ts.

import type { BattlefieldPermanent } from '../../../../shared/src';
import type { AttackerSelection } from './combatSelectionModalTypes';
import type { CreatureGroup } from './combatSelectionModalGroupCreatures';
import type { DangerIndicators } from './combatSelectionModalCreatureInfo';

/**
 * Check if a creature with menace can be legally blocked by the selected blockers
 */
export function checkMenaceBlocking(
  attackerId: string, 
  attackerDangers: DangerIndicators, 
  selectedBlockers: Map<string, Set<string>>
): { isLegal: boolean; message?: string } {
  if (!attackerDangers.menace) {
    return { isLegal: true };
  }
  
  const blockersForAttacker = Array.from(selectedBlockers.entries())
    .filter(([_, attackerIds]) => attackerIds.has(attackerId))
    .length;
  
  if (blockersForAttacker === 0) {
    return { isLegal: true }; // Not blocking is legal
  }
  
  if (blockersForAttacker === 1) {
    return { isLegal: false, message: 'Menace requires 2+ blockers' };
  }
  
  return { isLegal: true };
}

export function cloneSelectedBlockers(source: Map<string, Set<string>>): Map<string, Set<string>> {
  return new Map(Array.from(source.entries()).map(([blockerId, attackerIds]) => [blockerId, new Set(attackerIds)]));
}

export function getBlockerAssignments(selectedBlockers: Map<string, Set<string>>, blockerId: string): string[] {
  return Array.from(selectedBlockers.get(blockerId) || []);
}

export function countBlockingCreatures(selectedBlockers: Map<string, Set<string>>): number {
  return Array.from(selectedBlockers.values()).filter(attackerIds => attackerIds.size > 0).length;
}

export function countTotalBlockAssignments(selectedBlockers: Map<string, Set<string>>): number {
  return Array.from(selectedBlockers.values()).reduce((total, attackerIds) => total + attackerIds.size, 0);
}

export function splitCreatureGroups(groups: CreatureGroup[]): { unique: CreatureGroup[]; stacks: CreatureGroup[] } {
  const unique: CreatureGroup[] = [];
  const stacks: CreatureGroup[] = [];
  for (const group of groups) {
    if (group.creatures.length > 1) stacks.push(group);
    else unique.push(group);
  }
  return { unique, stacks };
}

export function buildAttackerSelections(
  selectedAttackers: Map<string, string | undefined>,
  availableCreatures: BattlefieldPermanent[],
): AttackerSelection[] {
  const creatureMeta = new Map<string, { groupId: string; virtualIndex: number }>();
  for (const creature of availableCreatures) {
    const groupId = (creature as any)._virtualFromGroup as string | undefined;
    const virtualIndex = (creature as any)._virtualIndex as number | undefined;
    if (groupId && typeof virtualIndex === 'number') {
      creatureMeta.set(creature.id, { groupId, virtualIndex });
    }
  }

  const groupedBuckets = new Map<string, { groupId: string; target?: string; count: number }>();
  const individuals: AttackerSelection[] = [];

  for (const [creatureId, target] of selectedAttackers.entries()) {
    const meta = creatureMeta.get(creatureId);
    if (meta) {
      const bucketKey = `${meta.groupId}|${target || ''}`;
      const existing = groupedBuckets.get(bucketKey);
      if (existing) {
        existing.count += 1;
      } else {
        groupedBuckets.set(bucketKey, {
          groupId: meta.groupId,
          target,
          count: 1,
        });
      }
      continue;
    }

    individuals.push({
      creatureId,
      targetPlayerId: target,
    });
  }

  const grouped: AttackerSelection[] = Array.from(groupedBuckets.values()).map((bucket) => ({
    groupId: bucket.groupId,
    count: bucket.count,
    targetPlayerId: bucket.target,
  }));

  return [...individuals, ...grouped];
}
