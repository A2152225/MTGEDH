/**
 * Origin: server/src/rules-engine/target-availability.ts
 * Cluster: stack objects that must have a single target (Bolt Bend, Redirect)
 *   or that target only a single permanent or player (Chef's Kiss).
 * Public: countStackItemTargets, stackItemHasExactlyOneTarget,
 *   uniqueStackTargetIds, stackItemMeetsSingleTargetRequirement
 */

import { parseTargetRequirements } from './targetingParseTargetRequirements.js';

function isConcreteStackTarget(entry: unknown): boolean {
  if (entry == null || entry === '') return false;
  if (typeof entry === 'string' || typeof entry === 'number') return true;
  if (typeof entry === 'object') {
    const record = entry as { id?: unknown; playerId?: unknown; targetId?: unknown };
    return Boolean(record.id || record.playerId || record.targetId);
  }
  return false;
}

function readTargetId(entry: unknown): string {
  if (entry == null || entry === '') return '';
  if (typeof entry === 'string' || typeof entry === 'number') return String(entry).trim();
  if (typeof entry === 'object') {
    const record = entry as { id?: unknown; playerId?: unknown; targetId?: unknown };
    return String(record.id || record.playerId || record.targetId || '').trim();
  }
  return '';
}

export function countStackItemTargets(stackItem: any): number {
  if (!stackItem) return 0;
  const targets = stackItem.targets;
  if (Array.isArray(targets)) {
    return targets.filter(isConcreteStackTarget).length;
  }
  if (isConcreteStackTarget(stackItem.target) || isConcreteStackTarget(stackItem.targetId)) {
    return 1;
  }
  return 0;
}

export function uniqueStackTargetIds(stackItem: any): string[] {
  if (!stackItem) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  const pushId = (value: unknown) => {
    const id = readTargetId(value);
    if (!id || seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  if (Array.isArray(stackItem.targets)) {
    for (const entry of stackItem.targets) pushId(entry);
  } else {
    pushId(stackItem.target);
    pushId(stackItem.targetId);
  }
  return ids;
}

export function stackItemHasExactlyOneTarget(stackItem: any): boolean {
  return countStackItemTargets(stackItem) === 1;
}

function isStackAbility(stackItem: any): boolean {
  const type = String(stackItem?.type || '').toLowerCase();
  return type === 'ability' || type === 'triggered_ability' || type === 'activated_ability';
}

function stackAbilityMeetsSingleTargetRequirement(stackItem: any): boolean {
  const stamped = countStackItemTargets(stackItem);
  if (stamped >= 2) return false;
  if (stamped === 1) return true;

  // Optional "you may" triggers often sit on the stack with needsTargetSelection
  // and no chosen targets yet. Parse the effect clause (not full-card oracle) so
  // single-target abilities such as Aura Shards stay legal for Bolt Bend, while
  // untargeted spells stay illegal.
  const effectText = String(stackItem?.effect || stackItem?.description || '').trim();
  if (effectText) {
    const reqs = parseTargetRequirements(effectText);
    return reqs.needsTargets && reqs.minTargets === 1 && reqs.maxTargets === 1;
  }
  return stackItem?.requiresTarget === true || stackItem?.needsTargetSelection === true;
}

function isPermanentOrPlayerId(id: string, state: any): boolean {
  if (!id) return false;
  if (!state) return true;
  const players = Array.isArray(state?.players) ? state.players : [];
  if (players.some((player: any) => String(player?.id || '').trim() === id)) return true;
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  if (battlefield.some((perm: any) => String(perm?.id || '').trim() === id)) return true;
  return false;
}

function stackItemTargetsOnlySinglePermanentOrPlayer(stackItem: any, state: any): boolean {
  const uniqueIds = uniqueStackTargetIds(stackItem);
  if (uniqueIds.length !== 1) return false;
  return isPermanentOrPlayerId(uniqueIds[0]!, state);
}

export function stackItemMeetsSingleTargetRequirement(
  stackItem: any,
  targetReqs?: {
    stackObjectMustHaveSingleTarget?: boolean;
    stackObjectMustTargetOnlySinglePermanentOrPlayer?: boolean;
  } | null,
  state?: any,
): boolean {
  if (targetReqs?.stackObjectMustTargetOnlySinglePermanentOrPlayer) {
    return stackItemTargetsOnlySinglePermanentOrPlayer(stackItem, state);
  }
  if (!targetReqs?.stackObjectMustHaveSingleTarget) return true;
  if (isStackAbility(stackItem)) {
    return stackAbilityMeetsSingleTargetRequirement(stackItem);
  }
  return stackItemHasExactlyOneTarget(stackItem);
}
