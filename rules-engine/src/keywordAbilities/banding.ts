/**
 * Banding keyword ability implementation
 * Rule 702.22
 * 
 * Banding is a static ability that modifies the rules for declaring attackers
 * and assigning combat damage.
 */

/**
 * Banding ability
 * Rule 702.22a
 * 
 * Creatures with banding can form an attacking band with any number of
 * creatures with banding and up to one without.
 */
export interface BandingAbility {
  readonly type: 'banding';
  readonly source: string;
  readonly bandsWith?: string; // For "bands with other [type]"
}

/**
 * Represents a band of creatures attacking or blocking together
 * Rule 702.22d - A band can attack or block as a unit
 */
export interface Band {
  readonly id: string;
  readonly memberIds: readonly string[];
  readonly isAttacking: boolean;
  readonly isBlocking: boolean;
  readonly hasFullBanding: boolean; // At least one creature has full banding
}

/**
 * Damage assignment for a band
 * Rule 702.22e-f - The controller of the band chooses damage assignment
 */
export interface BandDamageAssignment {
  readonly bandId: string;
  readonly assignments: readonly {
    readonly creatureId: string;
    readonly damageReceived: number;
  }[];
  readonly totalDamageToAssign: number;
  readonly assignedBy: string; // Player ID who controls the band
}

/**
 * Creates a banding ability
 * Rule 702.22a
 * 
 * @param source - The creature with banding
 * @param bandsWith - Optional type for "bands with other"
 * @returns Banding ability
 */
export function banding(source: string, bandsWith?: string): BandingAbility {
  return {
    type: 'banding',
    source,
    bandsWith,
  };
}

/**
 * Creates a band of creatures
 * Rule 702.22b-d
 * 
 * @param memberIds - IDs of creatures in the band
 * @param isAttacking - Whether this is an attacking band
 * @param hasFullBanding - Whether any creature has full banding ability
 * @returns A band object
 */
export function createBand(
  memberIds: readonly string[],
  isAttacking: boolean,
  hasFullBanding: boolean
): Band {
  return {
    id: `band-${Date.now()}-${memberIds.join('-')}`,
    memberIds,
    isAttacking,
    isBlocking: !isAttacking,
    hasFullBanding,
  };
}

/**
 * Checks if creatures can form an attacking band
 * Rule 702.22b
 * 
 * @param creatures - Creatures attempting to band
 * @param bandingCreatures - Creatures with banding in the group
 * @returns True if valid attacking band
 */
export function canFormAttackingBand(
  creatures: readonly string[],
  bandingCreatures: readonly string[]
): boolean {
  if (bandingCreatures.length === 0) return false;
  
  // Can have any number with banding and up to one without
  const withoutBanding = creatures.filter(c => !bandingCreatures.includes(c));
  return withoutBanding.length <= 1;
}

/**
 * Checks if a defending player can form a blocking band
 * Rule 702.22c - "Bands with other"
 * 
 * @param blockers - Blocking creatures
 * @param bandingCreatures - Creatures with banding or "bands with other"
 * @param sharedType - The type that bands with (e.g., "Dinosaurs")
 * @returns True if valid blocking band
 */
export function canFormBlockingBand(
  blockers: readonly string[],
  bandingCreatures: readonly string[],
  sharedType?: string
): boolean {
  // At least one creature needs banding or bands with other
  if (bandingCreatures.length === 0) return false;
  
  // All blockers must share the specified type if using "bands with other"
  return blockers.length > 0;
}

/**
 * Validates damage assignment to a band
 * Rule 702.22e-f - The controller of the band divides damage
 * 
 * @param band - The band receiving damage
 * @param assignment - The proposed damage assignment
 * @returns Whether the assignment is valid
 */
export function validateBandDamageAssignment(
  band: Band,
  assignment: BandDamageAssignment
): { valid: boolean; reason?: string } {
  // Check that all members are in the assignment
  const assignedIds = new Set(assignment.assignments.map(a => a.creatureId));
  for (const memberId of band.memberIds) {
    if (!assignedIds.has(memberId)) {
      return { valid: false, reason: `Member ${memberId} not included in damage assignment` };
    }
  }
  
  // Check that total damage assigned equals the damage dealt
  const totalAssigned = assignment.assignments.reduce((sum, a) => sum + a.damageReceived, 0);
  if (totalAssigned !== assignment.totalDamageToAssign) {
    return { 
      valid: false, 
      reason: `Total damage assigned (${totalAssigned}) doesn't equal damage to assign (${assignment.totalDamageToAssign})` 
    };
  }
  
  // All damage must be non-negative
  for (const a of assignment.assignments) {
    if (a.damageReceived < 0) {
      return { valid: false, reason: `Negative damage assigned to ${a.creatureId}` };
    }
  }
  
  return { valid: true };
}

/**
 * Creates a damage assignment for a band
 * Rule 702.22e - The controller chooses how to divide damage
 * 
 * @param band - The band receiving damage
 * @param totalDamage - Total damage being dealt to the band
 * @param assignedBy - The player making the assignment
 * @param individualAssignments - Map of creature ID to damage received
 * @returns A damage assignment object
 */
export function createBandDamageAssignment(
  band: Band,
  totalDamage: number,
  assignedBy: string,
  individualAssignments: Record<string, number>
): BandDamageAssignment {
  const assignments = band.memberIds.map(id => ({
    creatureId: id,
    damageReceived: individualAssignments[id] || 0,
  }));
  
  return {
    bandId: band.id,
    assignments,
    totalDamageToAssign: totalDamage,
    assignedBy,
  };
}

/**
 * Gets the controller who can assign damage to a band
 * Rule 702.22e - Attacking band: attacking player's choice
 * Rule 702.22f - Blocking band: defending player's choice
 * 
 * @param band - The band
 * @param attackingPlayerId - The attacking player
 * @param defendingPlayerId - The defending player
 * @returns The ID of the player who assigns damage
 */
export function getDamageAssigner(
  band: Band,
  attackingPlayerId: string,
  defendingPlayerId: string
): string {
  // The controller of the banding creatures chooses how damage is assigned
  if (band.isAttacking) {
    return attackingPlayerId;
  } else {
    return defendingPlayerId;
  }
}

/**
 * Checks if multiple instances of banding are redundant
 * Rule 702.22g - Multiple instances of banding are redundant
 * 
 * @param abilities - Array of banding abilities
 * @returns True (multiple banding is redundant)
 */
export function hasRedundantBanding(abilities: readonly BandingAbility[]): boolean {
  return abilities.length > 1;
}
