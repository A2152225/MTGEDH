/**
 * Forecast keyword ability (Rule 702.57)
 * 
 * @module keywordAbilities/forecast
 */

/**
 * Represents a forecast ability on a card.
 * Rule 702.57: Forecast is an activated ability that functions only while the card with 
 * forecast is in a player's hand. "Forecast—[Activated ability]" means "[Activated ability]. 
 * Activate only during your upkeep and only once each turn."
 */
export interface ForecastAbility {
  readonly type: 'forecast';
  readonly ability: string;
  readonly cost: string;
  readonly source: string;
  readonly activatedThisTurn: boolean;
}

/**
 * Creates a forecast ability.
 * 
 * @param source - The source card with forecast
 * @param cost - The activation cost
 * @param ability - The forecast ability text
 * @returns A forecast ability
 * 
 * @example
 * ```typescript
 * const ability = forecast('Pride of the Clouds', '{2}{W}{U}', 'Create a 1/1 white and blue Bird creature token with flying');
 * ```
 */
export function forecast(source: string, cost: string, ability: string): ForecastAbility {
  return {
    type: 'forecast',
    ability,
    cost,
    source,
    activatedThisTurn: false
  };
}

/**
 * Checks if forecast can be activated.
 * 
 * @param ability - The forecast ability
 * @param isUpkeep - Whether it's currently the upkeep step
 * @param isYourTurn - Whether it's the controller's turn
 * @returns True if can be activated
 */
export function canActivateForecast(ability: ForecastAbility, isUpkeep: boolean, isYourTurn: boolean): boolean {
  return isUpkeep && isYourTurn && !ability.activatedThisTurn;
}

/**
 * Activates the forecast ability.
 * 
 * @param ability - The forecast ability
 * @returns Updated ability
 */
export function activateForecast(ability: ForecastAbility): ForecastAbility {
  return {
    ...ability,
    activatedThisTurn: true
  };
}

/**
 * Resets forecast for a new turn.
 * 
 * @param ability - The forecast ability
 * @returns Ability with activatedThisTurn reset
 */
export function resetForecast(ability: ForecastAbility): ForecastAbility {
  return {
    ...ability,
    activatedThisTurn: false
  };
}
