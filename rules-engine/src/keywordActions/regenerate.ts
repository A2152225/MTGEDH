/**
 * Rule 701.19: Regenerate
 * 
 * Regeneration is a destruction-replacement effect. The word "instead" doesn't
 * appear on the card but is implicit in the definition.
 * 
 * Reference: Rule 701.19
 */

export interface RegenerateAction {
  readonly type: 'regenerate';
  readonly permanentId: string;
}

export interface RegenerationShield {
  readonly permanentId: string;
  readonly timestamp: number;
  readonly active: boolean;
}

/**
 * Rule 701.19a: Create a regeneration shield
 * 
 * If the effect of a resolving spell or ability regenerates a permanent, it
 * creates a replacement effect that protects the permanent the next time it
 * would be destroyed this turn. In this case, "Regenerate [permanent]" means
 * "The next time [permanent] would be destroyed this turn, instead remove all
 * damage marked on it and tap it. If it's an attacking or blocking creature,
 * remove it from combat."
 */
export function createRegenerationShield(permanentId: string): RegenerationShield {
  return {
    permanentId,
    timestamp: Date.now(),
    active: true,
  };
}

/**
 * Rule 701.19b: Using the regeneration shield
 * 
 * When a permanent would be destroyed, if it has a regeneration shield, the
 * regeneration shield is used up and the permanent is regenerated instead.
 */
export function useRegenerationShield(
  shield: RegenerationShield
): RegenerationShield {
  return {
    ...shield,
    active: false,
  };
}

/**
 * Rule 701.19c: Regeneration effects
 * 
 * When a permanent regenerates:
 * 1. Remove all damage marked on it
 * 2. Tap it
 * 3. If it's attacking or blocking, remove it from combat
 */
export interface RegenerationResult {
  readonly regenerated: boolean;
  readonly damageRemoved: boolean;
  readonly tapped: boolean;
  readonly removedFromCombat: boolean;
}

export function applyRegeneration(
  wasAttackingOrBlocking: boolean
): RegenerationResult {
  return {
    regenerated: true,
    damageRemoved: true,
    tapped: true,
    removedFromCombat: wasAttackingOrBlocking,
  };
}

/**
 * Rule 701.19d: Multiple regeneration shields
 * 
 * If a permanent has multiple regeneration shields, each one is used separately
 * and in the order they were created.
 */
export function hasActiveShield(shields: readonly RegenerationShield[]): boolean {
  return shields.some(shield => shield.active);
}

export function getNextActiveShield(
  shields: readonly RegenerationShield[]
): RegenerationShield | null {
  return shields.find(shield => shield.active) || null;
}
