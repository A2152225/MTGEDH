/**
 * Start Your Engines! keyword ability (Rule 702.179)
 * 
 * From the MTG Comprehensive Rules (Nov 2025):
 * 
 * 702.179. Start Your Engines!
 * 702.179a Start your engines! is a static ability. If a player controls a permanent with start 
 * your engines! and that player has no speed, their speed becomes 1. This is a state-based action.
 * 702.179b Players do not have speed until a rule or effect sets their speed to a specific value.
 * 702.179c If a player has no speed and they are instructed to increase their speed by a certain 
 * value, their speed becomes that value.
 * 702.179d There is an inherent triggered ability associated with a player having 1 or more speed. 
 * This ability has no source and is controlled by that player. That ability is "Whenever one or 
 * more opponents lose life during your turn, if your speed is less than 4, your speed increases 
 * by 1. This ability triggers only once each turn."
 */

export interface StartYourEnginesAbility {
  readonly type: 'start-your-engines';
  readonly source: string;
  readonly playerSpeed: number;
  readonly speedTriggeredThisTurn: boolean;
}

export interface StartYourEnginesSummary {
  readonly source: string;
  readonly hasSpeed: boolean;
  readonly currentSpeed: number;
  readonly canIncreaseSpeed: boolean;
  readonly speedTriggeredThisTurn: boolean;
}

/**
 * Create a start your engines! ability
 * Rule 702.179a
 * @param source - The permanent with start your engines!
 * @returns Start your engines! ability object
 */
export function startYourEngines(source: string): StartYourEnginesAbility {
  return {
    type: 'start-your-engines',
    source,
    playerSpeed: 0,
    speedTriggeredThisTurn: false,
  };
}

/**
 * Apply state-based action for speed
 * Rule 702.179a - If player has no speed, it becomes 1
 * @param ability - Start your engines! ability
 * @returns Updated ability
 */
export function applySpeedSBA(ability: StartYourEnginesAbility): StartYourEnginesAbility {
  if (ability.playerSpeed === 0) {
    return {
      ...ability,
      playerSpeed: 1,
    };
  }
  return ability;
}

/**
 * Check whether the player currently has speed.
 * Rule 702.179b
 */
export function hasSpeed(ability: StartYourEnginesAbility): boolean {
  return ability.playerSpeed > 0;
}

/**
 * Increase speed by an arbitrary amount.
 * Rule 702.179c
 */
export function increaseSpeedBy(ability: StartYourEnginesAbility, amount: number): StartYourEnginesAbility {
  const increase = Math.max(0, Math.trunc(amount));
  if (increase === 0) {
    return ability;
  }

  return {
    ...ability,
    playerSpeed: ability.playerSpeed === 0 ? increase : ability.playerSpeed + increase,
  };
}

/**
 * Check whether the once-per-turn speed trigger can resolve.
 * Rule 702.179d
 */
export function canIncreaseSpeed(ability: StartYourEnginesAbility): boolean {
  return !ability.speedTriggeredThisTurn && ability.playerSpeed < 4;
}

/**
 * Increase speed when opponent loses life
 * Rule 702.179d - Once per turn, if speed < 4
 * @param ability - Start your engines! ability
 * @returns Updated ability or null if cannot increase
 */
export function increaseSpeed(ability: StartYourEnginesAbility): StartYourEnginesAbility | null {
  if (!canIncreaseSpeed(ability)) {
    return null;
  }
  
  return {
    ...ability,
    playerSpeed: ability.playerSpeed + 1,
    speedTriggeredThisTurn: true,
  };
}

/**
 * Reset speed trigger at end of turn
 * @param ability - Start your engines! ability
 * @returns Ability with trigger reset
 */
export function resetSpeedTrigger(ability: StartYourEnginesAbility): StartYourEnginesAbility {
  return {
    ...ability,
    speedTriggeredThisTurn: false,
  };
}

/**
 * Get current speed
 * @param ability - Start your engines! ability
 * @returns Current speed
 */
export function getCurrentSpeed(ability: StartYourEnginesAbility): number {
  return ability.playerSpeed;
}

/**
 * Multiple instances of start your engines! are redundant
 * @param abilities - Array of start your engines! abilities
 * @returns True if more than one
 */
export function hasRedundantStartYourEngines(abilities: readonly StartYourEnginesAbility[]): boolean {
  return abilities.length > 1;
}

export function createStartYourEnginesSummary(
  ability: StartYourEnginesAbility,
): StartYourEnginesSummary {
  return {
    source: ability.source,
    hasSpeed: hasSpeed(ability),
    currentSpeed: ability.playerSpeed,
    canIncreaseSpeed: canIncreaseSpeed(ability),
    speedTriggeredThisTurn: ability.speedTriggeredThisTurn,
  };
}
