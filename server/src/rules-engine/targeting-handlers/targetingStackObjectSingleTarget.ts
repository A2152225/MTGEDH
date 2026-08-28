/**
 * Origin: server/src/rules-engine/target-availability.ts
 * Cluster: stack objects that must have a single target (Bolt Bend, Redirect)
 * Public: countStackItemTargets, stackItemHasExactlyOneTarget,
 *   stackItemMeetsSingleTargetRequirement
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

export function stackItemMeetsSingleTargetRequirement(
  stackItem: any,
  targetReqs?: { stackObjectMustHaveSingleTarget?: boolean } | null,
): boolean {
  if (!targetReqs?.stackObjectMustHaveSingleTarget) return true;
  if (isStackAbility(stackItem)) {
    return stackAbilityMeetsSingleTargetRequirement(stackItem);
  }
  return stackItemHasExactlyOneTarget(stackItem);
}
