/**
 * Station keyword ability (Rule 702.184)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.184. Station
 * 702.184a Station is an activated ability. "Station" means "Tap another untapped creature you 
 * control: Put a number of charge counters on this permanent equal to the tapped creature's power. 
 * Activate only as a sorcery."
 * 702.184b Each card printed with a station ability is known as a station card. It has a 
 * nonstandard layout and includes station symbols that are themselves keyword abilities.
 * 702.184c Static abilities may modify the result of a station ability by causing it to use a 
 * characteristic other than the tapped creature's power to determine the number of counters placed 
 * on the permanent with the station ability.
 */

export interface StationAbility {
  readonly type: 'station';
  readonly source: string;
  readonly chargeCounters: number;
  readonly tappedCreatures: readonly string[];
}

/**
 * Create a station ability
 * Rule 702.184a
 * @param source - The permanent with station
 * @returns Station ability object
 */
export function station(source: string): StationAbility {
  return {
    type: 'station',
    source,
    chargeCounters: 0,
    tappedCreatures: [],
  };
}

/**
 * Activate station ability
 * Rule 702.184a - Tap creature, add charge counters equal to power
 * @param ability - Station ability
 * @param tappedCreature - ID of tapped creature
 * @param creaturePower - Power of tapped creature
 * @returns Updated ability
 */
export function activateStation(
  ability: StationAbility,
  tappedCreature: string,
  creaturePower: number
): StationAbility {
  return {
    ...ability,
    chargeCounters: ability.chargeCounters + creaturePower,
    tappedCreatures: [...ability.tappedCreatures, tappedCreature],
  };
}

/**
 * Get charge counters
 * @param ability - Station ability
 * @returns Number of charge counters
 */
export function getChargeCounters(ability: StationAbility): number {
  return ability.chargeCounters;
}

/**
 * Multiple instances of station are not redundant
 * @param abilities - Array of station abilities
 * @returns False
 */
export function hasRedundantStation(abilities: readonly StationAbility[]): boolean {
  return false;
}
