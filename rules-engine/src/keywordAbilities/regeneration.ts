/**
 * Regeneration mechanic implementation
 * Rule 701.15
 * 
 * Regeneration is a destruction replacement effect that creates a "shield"
 * around a permanent. When that permanent would be destroyed, the shield
 * is used up instead, preventing the destruction.
 */

/**
 * Represents a regeneration shield on a permanent
 * Rule 701.15a: A regeneration shield is created that lasts until end of turn
 */
export interface RegenerationShield {
  readonly id: string;
  readonly permanentId: string;
  readonly controllerId: string;
  readonly createdAt: number;
  readonly isUsed: boolean;
  readonly expiresAtEndOfTurn: boolean;
}

/**
 * Result of attempting to regenerate a permanent
 */
export interface RegenerationResult {
  readonly success: boolean;
  readonly shieldCreated: boolean;
  readonly shield?: RegenerationShield;
  readonly reason?: string;
}

/**
 * Result of using a regeneration shield
 */
export interface RegenerationUseResult {
  readonly regenerated: boolean;
  readonly shieldUsed: boolean;
  readonly permanentTapped: boolean;
  readonly removedFromCombat: boolean;
  readonly damageMarked: number;
  readonly reason?: string;
}

/**
 * Creates a regeneration shield for a permanent
 * Rule 701.15a: To regenerate a permanent means to create a replacement effect
 * that acts as a shield for that permanent
 * 
 * @param permanentId - The permanent being protected
 * @param controllerId - The controller of the regeneration effect
 * @returns A regeneration shield
 */
export function createRegenerationShield(
  permanentId: string,
  controllerId: string
): RegenerationShield {
  return {
    id: `regen-shield-${permanentId}-${Date.now()}`,
    permanentId,
    controllerId,
    createdAt: Date.now(),
    isUsed: false,
    expiresAtEndOfTurn: true,
  };
}

/**
 * Attempts to regenerate a permanent by creating a shield
 * Rule 701.15a: A permanent can have multiple regeneration shields
 * 
 * @param permanentId - The permanent to regenerate
 * @param controllerId - The controller
 * @param existingShields - Already existing shields on the permanent
 * @returns The result of the regeneration attempt
 */
export function regenerate(
  permanentId: string,
  controllerId: string,
  existingShields: readonly RegenerationShield[] = []
): RegenerationResult {
  // Multiple shields are allowed - each one can prevent one destruction
  const shield = createRegenerationShield(permanentId, controllerId);
  
  return {
    success: true,
    shieldCreated: true,
    shield,
  };
}

/**
 * Uses a regeneration shield when destruction would occur
 * Rule 701.15b: When the shielded permanent would be destroyed:
 * 1. The regeneration shield is used up
 * 2. All damage is removed from the permanent
 * 3. The permanent becomes tapped
 * 4. If attacking or blocking, it's removed from combat
 * 
 * @param shield - The shield to use
 * @param permanentIsTapped - Whether the permanent is already tapped
 * @param damageOnPermanent - Current damage on the permanent
 * @param isInCombat - Whether the permanent is in combat
 * @returns The result of using the shield
 */
export function useRegenerationShield(
  shield: RegenerationShield,
  permanentIsTapped: boolean,
  damageOnPermanent: number,
  isInCombat: boolean
): RegenerationUseResult {
  if (shield.isUsed) {
    return {
      regenerated: false,
      shieldUsed: false,
      permanentTapped: permanentIsTapped,
      removedFromCombat: false,
      damageMarked: damageOnPermanent,
      reason: 'Shield already used',
    };
  }
  
  return {
    regenerated: true,
    shieldUsed: true,
    permanentTapped: true, // Permanent becomes tapped
    removedFromCombat: isInCombat, // Removed from combat if applicable
    damageMarked: 0, // All damage removed
  };
}

/**
 * Marks a shield as used
 * 
 * @param shield - The shield to mark as used
 * @returns The updated shield
 */
export function markShieldUsed(shield: RegenerationShield): RegenerationShield {
  return {
    ...shield,
    isUsed: true,
  };
}

/**
 * Checks if a permanent can be regenerated
 * Rule 701.15c: Some effects say a permanent "can't be regenerated"
 * 
 * @param permanentId - The permanent to check
 * @param cantRegenerateEffects - Active "can't be regenerated" effects
 * @returns Whether regeneration is possible
 */
export function canRegenerate(
  permanentId: string,
  cantRegenerateEffects: readonly string[] = []
): boolean {
  return !cantRegenerateEffects.includes(permanentId);
}

/**
 * Gets all unused shields for a permanent
 * 
 * @param permanentId - The permanent to check
 * @param shields - All regeneration shields
 * @returns Unused shields for the permanent
 */
export function getAvailableShields(
  permanentId: string,
  shields: readonly RegenerationShield[]
): RegenerationShield[] {
  return shields.filter(s => s.permanentId === permanentId && !s.isUsed);
}

/**
 * Checks if a permanent has an available regeneration shield
 * 
 * @param permanentId - The permanent to check
 * @param shields - All regeneration shields
 * @returns Whether a shield is available
 */
export function hasRegenerationShield(
  permanentId: string,
  shields: readonly RegenerationShield[]
): boolean {
  return getAvailableShields(permanentId, shields).length > 0;
}

/**
 * Removes expired shields (at end of turn)
 * Rule 701.15a: The shield lasts until end of turn or until it's used
 * 
 * @param shields - Current shields
 * @returns Shields that should remain (not expired)
 */
export function removeExpiredShields(
  shields: readonly RegenerationShield[]
): RegenerationShield[] {
  return shields.filter(s => !s.expiresAtEndOfTurn);
}

/**
 * Processes destruction with regeneration shields
 * This is the main entry point for handling destruction attempts
 * 
 * @param permanentId - The permanent being destroyed
 * @param shields - Available regeneration shields
 * @param permanentIsTapped - Current tapped state
 * @param damageOnPermanent - Current damage
 * @param isInCombat - Combat status
 * @param cantRegenerate - Whether regeneration is prevented
 * @returns The result of the destruction attempt
 */
export function processDestructionWithRegeneration(
  permanentId: string,
  shields: readonly RegenerationShield[],
  permanentIsTapped: boolean,
  damageOnPermanent: number,
  isInCombat: boolean,
  cantRegenerate: boolean = false
): {
  wasRegenerated: boolean;
  updatedShields: RegenerationShield[];
  permanentTapped: boolean;
  removedFromCombat: boolean;
  damageRemoved: boolean;
} {
  // Check if regeneration is prevented
  if (cantRegenerate) {
    return {
      wasRegenerated: false,
      updatedShields: [...shields],
      permanentTapped: permanentIsTapped,
      removedFromCombat: false,
      damageRemoved: false,
    };
  }
  
  // Find an available shield
  const availableShields = getAvailableShields(permanentId, shields);
  if (availableShields.length === 0) {
    return {
      wasRegenerated: false,
      updatedShields: [...shields],
      permanentTapped: permanentIsTapped,
      removedFromCombat: false,
      damageRemoved: false,
    };
  }
  
  // Use the first available shield
  const shieldToUse = availableShields[0];
  const result = useRegenerationShield(
    shieldToUse,
    permanentIsTapped,
    damageOnPermanent,
    isInCombat
  );
  
  // Update shields - mark the used one
  const updatedShields = shields.map(s =>
    s.id === shieldToUse.id ? markShieldUsed(s) : s
  );
  
  return {
    wasRegenerated: result.regenerated,
    updatedShields,
    permanentTapped: result.permanentTapped,
    removedFromCombat: result.removedFromCombat,
    damageRemoved: result.regenerated,
  };
}
