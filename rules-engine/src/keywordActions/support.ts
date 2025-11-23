/**
 * Rule 701.41: Support
 * 
 * "Support N" on a permanent means "Put a +1/+1 counter on each of up to N other
 * target creatures." "Support N" on an instant or sorcery spell means "Put a
 * +1/+1 counter on each of up to N target creatures."
 * 
 * Reference: Rule 701.41
 */

export interface SupportAction {
  readonly type: 'support';
  readonly sourceId: string; // Permanent or spell with support
  readonly sourceType: 'permanent' | 'instant-sorcery';
  readonly n: number; // Up to N targets
  readonly targetCreatureIds: readonly string[];
}

/**
 * Rule 701.41a: Support N
 * 
 * "Support N" on a permanent means "Put a +1/+1 counter on each of up to N other
 * target creatures." "Support N" on an instant or sorcery spell means "Put a
 * +1/+1 counter on each of up to N target creatures."
 */
export function supportFromPermanent(
  permanentId: string,
  n: number,
  targetCreatureIds: readonly string[]
): SupportAction {
  return {
    type: 'support',
    sourceId: permanentId,
    sourceType: 'permanent',
    n,
    targetCreatureIds,
  };
}

export function supportFromSpell(
  spellId: string,
  n: number,
  targetCreatureIds: readonly string[]
): SupportAction {
  return {
    type: 'support',
    sourceId: spellId,
    sourceType: 'instant-sorcery',
    n,
    targetCreatureIds,
  };
}

/**
 * Validate support targets
 */
export function canTargetForSupport(
  sourceId: string,
  sourceType: 'permanent' | 'instant-sorcery',
  targetId: string
): boolean {
  // Permanent support can't target itself ("other target creatures")
  if (sourceType === 'permanent' && sourceId === targetId) {
    return false;
  }
  
  // Spell support can target any creature
  return true;
}

/**
 * Get valid support target count
 */
export function getValidSupportTargets(
  sourceId: string,
  sourceType: 'permanent' | 'instant-sorcery',
  potentialTargets: readonly string[],
  n: number
): readonly string[] {
  let validTargets = potentialTargets;
  
  // Filter out self if from permanent
  if (sourceType === 'permanent') {
    validTargets = potentialTargets.filter(id => id !== sourceId);
  }
  
  // Up to N targets
  return validTargets.slice(0, n);
}

/**
 * Support result
 */
export interface SupportResult {
  readonly countersAdded: ReadonlyMap<string, number>; // creatureId -> counter count
}

export function createSupportResult(
  targetCreatureIds: readonly string[]
): SupportResult {
  const countersAdded = new Map<string, number>();
  
  for (const creatureId of targetCreatureIds) {
    countersAdded.set(creatureId, 1); // Each gets one +1/+1 counter
  }
  
  return {
    countersAdded,
  };
}
