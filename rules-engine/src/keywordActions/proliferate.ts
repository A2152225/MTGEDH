/**
 * Rule 701.34: Proliferate
 * 
 * To proliferate means to choose any number of permanents and/or players that
 * have a counter, then give each one additional counter of each kind that
 * permanent or player already has.
 * 
 * Reference: Rule 701.34
 */

export interface ProliferateAction {
  readonly type: 'proliferate';
  readonly playerId: string; // Player performing the proliferate
  readonly targets: readonly ProliferateTarget[];
}

export interface ProliferateTarget {
  readonly targetId: string; // Permanent or player ID
  readonly targetType: 'permanent' | 'player';
  readonly countersToAdd: ReadonlyMap<string, number>; // Counter type -> count
}

/**
 * Rule 701.34a: Proliferate
 * 
 * To proliferate means to choose any number of permanents and/or players that
 * have a counter, then give each one additional counter of each kind that
 * permanent or player already has.
 */
export function proliferate(
  playerId: string,
  targets: readonly ProliferateTarget[]
): ProliferateAction {
  return {
    type: 'proliferate',
    playerId,
    targets,
  };
}

/**
 * Create a proliferate target from existing counters
 */
export function createProliferateTarget(
  targetId: string,
  targetType: 'permanent' | 'player',
  existingCounters: ReadonlyMap<string, number>
): ProliferateTarget {
  // Each existing counter type gets +1
  const countersToAdd = new Map<string, number>();
  const entries = Array.from(existingCounters.entries());
  for (const [counterType, count] of entries) {
    if (count > 0) {
      countersToAdd.set(counterType, 1); // Add 1 of each type
    }
  }
  
  return {
    targetId,
    targetType,
    countersToAdd,
  };
}

/**
 * Rule 701.34b: Two-Headed Giant poison counters
 * 
 * In a Two-Headed Giant game, poison counters are shared by the team. If more
 * than one player on a team is chosen this way, only one of those players can
 * be given an additional poison counter. The player who proliferates chooses
 * which player that is.
 */
export function handleTwoHeadedGiantPoison(
  targets: readonly ProliferateTarget[],
  teams: ReadonlyMap<string, string> // playerId -> teamId
): readonly ProliferateTarget[] {
  const teamPoisonGiven = new Set<string>();
  
  return targets.map(target => {
    if (target.targetType !== 'player') return target;
    
    const teamId = teams.get(target.targetId);
    if (!teamId) return target;
    
    // Check if this target has poison counters
    const hasPoisonCounter = target.countersToAdd.has('poison');
    if (!hasPoisonCounter) return target;
    
    // If team already got poison, remove it from this target
    if (teamPoisonGiven.has(teamId)) {
      const newCounters = new Map(target.countersToAdd);
      newCounters.delete('poison');
      return {
        ...target,
        countersToAdd: newCounters,
      };
    }
    
    // Mark team as having received poison
    teamPoisonGiven.add(teamId);
    return target;
  });
}

/**
 * Check if a permanent or player can be chosen for proliferate
 */
export function canBeProliferateTarget(
  counters: ReadonlyMap<string, number>
): boolean {
  // Must have at least one counter
  const values = Array.from(counters.values());
  for (const count of values) {
    if (count > 0) return true;
  }
  return false;
}

/**
 * Calculate total counters that will be added by proliferate
 */
export function calculateProliferateCounters(
  existingCounters: ReadonlyMap<string, number>
): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  const entries = Array.from(existingCounters.entries());
  for (const [type, count] of entries) {
    if (count > 0) {
      result.set(type, 1); // Add 1 of each existing counter type
    }
  }
  
  return result;
}
