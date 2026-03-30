/**
 * Fear keyword ability implementation
 * Rule 702.36
 * 
 * Fear is an evasion ability.
 */

/**
 * Fear ability
 * Rule 702.36a
 * 
 * A creature with fear can't be blocked except by artifact creatures and/or black creatures.
 */
export interface FearAbility {
  readonly type: 'fear';
  readonly source: string;
}

export interface FearBlockResult {
  readonly blockerId: string;
  readonly canBlock: boolean;
  readonly reason: 'artifact' | 'black' | 'artifact-and-black' | 'not-eligible' | 'attacker-without-fear';
}

/**
 * Creates a fear ability
 * Rule 702.36a
 * 
 * @param source - The creature with fear
 * @returns Fear ability
 */
export function fear(source: string): FearAbility {
  return {
    type: 'fear',
    source,
  };
}

/**
 * Checks if a creature can block a creature with fear
 * Rule 702.36a
 * 
 * @param blockerIsArtifact - Whether the blocker is an artifact creature
 * @param blockerIsBlack - Whether the blocker is black
 * @returns True if the blocker can block fear
 */
export function canBlockFear(blockerIsArtifact: boolean, blockerIsBlack: boolean): boolean {
  return blockerIsArtifact || blockerIsBlack;
}

export function canBlockAttackerWithFear(
  attackerHasFear: boolean,
  blockerIsArtifact: boolean,
  blockerIsBlack: boolean
): boolean {
  if (!attackerHasFear) {
    return true;
  }

  return canBlockFear(blockerIsArtifact, blockerIsBlack);
}

export function createFearBlockResult(
  blockerId: string,
  attackerHasFear: boolean,
  blockerIsArtifact: boolean,
  blockerIsBlack: boolean
): FearBlockResult {
  if (!attackerHasFear) {
    return {
      blockerId,
      canBlock: true,
      reason: 'attacker-without-fear',
    };
  }

  if (blockerIsArtifact && blockerIsBlack) {
    return {
      blockerId,
      canBlock: true,
      reason: 'artifact-and-black',
    };
  }

  if (blockerIsArtifact) {
    return {
      blockerId,
      canBlock: true,
      reason: 'artifact',
    };
  }

  if (blockerIsBlack) {
    return {
      blockerId,
      canBlock: true,
      reason: 'black',
    };
  }

  return {
    blockerId,
    canBlock: false,
    reason: 'not-eligible',
  };
}

/**
 * Checks if multiple fear abilities are redundant
 * Rule 702.36b - Multiple instances of fear are redundant
 * 
 * @param abilities - Array of fear abilities
 * @returns True if more than one fear
 */
export function hasRedundantFear(abilities: readonly FearAbility[]): boolean {
  return abilities.length > 1;
}
