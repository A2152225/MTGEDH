/**
 * Crew keyword ability (Rule 702.122)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.122. Crew
 * 702.122a Crew is an activated ability of Vehicle cards. "Crew N" means "Tap any number of 
 * other untapped creatures you control with total power N or greater: This permanent becomes 
 * an artifact creature until end of turn."
 * 702.122b A creature "crews a Vehicle" when it's tapped to pay the cost to activate a Vehicle's 
 * crew ability.
 * 702.122c If an effect states that a creature "can't crew Vehicles," that creature can't be 
 * tapped to pay the crew cost of a Vehicle.
 * 702.122d Some Vehicles have abilities that trigger when they become crewed. "Whenever [this 
 * Vehicle] becomes crewed" means "Whenever a crew ability of [this Vehicle] resolves."
 */

export interface CrewAbility {
  readonly type: 'crew';
  readonly source: string;
  readonly crewValue: number;
  readonly isCrewed: boolean;
  readonly crewedCreatures: readonly string[];
}

export interface CrewSummary {
  readonly source: string;
  readonly crewValue: number;
  readonly isCrewed: boolean;
  readonly crewedCreatureCount: number;
  readonly canActivate: boolean;
  readonly powerShortfall: number;
}

type CrewCandidate = {
  readonly controller?: string;
  readonly tapped?: boolean;
  readonly isTapped?: boolean;
  readonly cantCrewVehicles?: boolean;
  readonly type_line?: string;
  readonly card?: {
    readonly type_line?: string;
  };
};

function isCreatureLike(candidate: CrewCandidate): boolean {
  const typeLine = String(candidate.type_line || candidate.card?.type_line || '').toLowerCase();
  return typeLine.includes('creature');
}

/**
 * Create a crew ability
 * Rule 702.122a
 * @param source - The Vehicle with crew
 * @param crewValue - Minimum total power required
 * @returns Crew ability object
 */
export function crew(source: string, crewValue: number): CrewAbility {
  return {
    type: 'crew',
    source,
    crewValue,
    isCrewed: false,
    crewedCreatures: [],
  };
}

/**
 * Activate crew ability
 * Rule 702.122a - Tap creatures with total power N or greater
 * @param ability - Crew ability
 * @param creatureIds - IDs of creatures tapping to crew
 * @param totalPower - Total power of tapped creatures
 * @returns Updated ability if total power is sufficient
 */
export function activateCrew(
  ability: CrewAbility,
  creatureIds: readonly string[],
  totalPower: number
): CrewAbility | null {
  if (totalPower < ability.crewValue) {
    return null;
  }
  
  return {
    ...ability,
    isCrewed: true,
    crewedCreatures: creatureIds,
  };
}

/**
 * Check if Vehicle is crewed
 * @param ability - Crew ability
 * @returns True if crewed
 */
export function isCrewed(ability: CrewAbility): boolean {
  return ability.isCrewed;
}

/**
 * Get creatures that crewed the Vehicle
 * Rule 702.122b
 * @param ability - Crew ability
 * @returns IDs of creatures that crewed
 */
export function getCrewedCreatures(ability: CrewAbility): readonly string[] {
  return ability.crewedCreatures;
}

/**
 * Uncrew at end of turn
 * @param ability - Crew ability
 * @returns Ability with isCrewed reset
 */
export function uncrew(ability: CrewAbility): CrewAbility {
  return {
    ...ability,
    isCrewed: false,
    crewedCreatures: [],
  };
}

/**
 * Check whether a creature can be tapped to crew a Vehicle.
 */
export function canTapForCrew(candidate: CrewCandidate, controllerId: string): boolean {
  const isTapped = candidate.tapped === true || candidate.isTapped === true;
  return String(candidate.controller || '') === String(controllerId || '')
    && !isTapped
    && candidate.cantCrewVehicles !== true
    && isCreatureLike(candidate);
}

/**
 * Validate whether the chosen creatures satisfy a crew activation.
 */
export function canActivateCrew(
  ability: CrewAbility,
  creatureIds: readonly string[],
  totalPower: number,
): boolean {
  return creatureIds.length > 0 && totalPower >= ability.crewValue;
}

/**
 * Return how much more total power is needed to crew the Vehicle.
 */
export function getCrewPowerShortfall(ability: CrewAbility, totalPower: number): number {
  return Math.max(0, ability.crewValue - Math.max(0, totalPower));
}

/**
 * Multiple instances of crew are not redundant
 * @param abilities - Array of crew abilities
 * @returns False
 */
export function hasRedundantCrew(abilities: readonly CrewAbility[]): boolean {
  return false;
}

export function createCrewSummary(
  ability: CrewAbility,
  totalPower: number,
): CrewSummary {
  return {
    source: ability.source,
    crewValue: ability.crewValue,
    isCrewed: ability.isCrewed,
    crewedCreatureCount: ability.crewedCreatures.length,
    canActivate: canActivateCrew(ability, ability.crewedCreatures, totalPower),
    powerShortfall: getCrewPowerShortfall(ability, totalPower),
  };
}
