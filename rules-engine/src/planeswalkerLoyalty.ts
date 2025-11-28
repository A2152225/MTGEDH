/**
 * Planeswalker Loyalty Abilities
 * Rules 306 and 606
 * 
 * Implements planeswalker-specific rules including loyalty counters,
 * loyalty abilities, and planeswalker damage handling.
 */

/**
 * Loyalty ability types
 * Rule 606.3 - Loyalty abilities have a cost of adding or removing loyalty counters
 */
export type LoyaltyCostType = 'plus' | 'minus' | 'zero';

/**
 * Loyalty ability structure
 * Rule 606.3 - A loyalty ability has a loyalty cost
 */
export interface PlaneswalkerLoyaltyAbility {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly costType: LoyaltyCostType;
  readonly costAmount: number; // For +X it's positive, for -X it's the absolute value
  readonly effect: string;
  readonly targets?: readonly {
    readonly type: string;
    readonly description: string;
  }[];
  readonly isUltimate?: boolean; // Whether this is considered an "ultimate" ability
}

/**
 * Planeswalker state
 */
export interface PlaneswalkerState {
  readonly permanentId: string;
  readonly controllerId: string;
  readonly startingLoyalty: number;
  readonly currentLoyalty: number;
  readonly loyaltyAbilities: readonly PlaneswalkerLoyaltyAbility[];
  readonly activatedThisTurn: boolean;
  readonly abilityActivatedThisTurn?: string; // ID of ability activated this turn
}

/**
 * Result of attempting to activate a loyalty ability
 */
export interface LoyaltyActivationResult {
  readonly success: boolean;
  readonly newLoyalty?: number;
  readonly error?: string;
  readonly abilityActivated?: PlaneswalkerLoyaltyAbility;
}

/**
 * Creates a planeswalker state from card data
 * Rule 306.5b - A planeswalker enters with loyalty counters equal to printed loyalty
 * 
 * @param permanentId - The permanent ID
 * @param controllerId - Controller ID
 * @param startingLoyalty - Starting loyalty from card
 * @param loyaltyAbilities - The planeswalker's abilities
 * @returns Planeswalker state
 */
export function createPlaneswalkerState(
  permanentId: string,
  controllerId: string,
  startingLoyalty: number,
  loyaltyAbilities: readonly PlaneswalkerLoyaltyAbility[]
): PlaneswalkerState {
  return {
    permanentId,
    controllerId,
    startingLoyalty,
    currentLoyalty: startingLoyalty,
    loyaltyAbilities,
    activatedThisTurn: false,
  };
}

/**
 * Checks if a loyalty ability can be activated
 * Rule 606.3 - Can only activate one loyalty ability per turn, only as a sorcery
 * 
 * @param state - Planeswalker state
 * @param ability - Ability to activate
 * @param context - Game context
 * @returns Whether the ability can be activated
 */
export function canActivateLoyaltyAbility(
  state: PlaneswalkerState,
  ability: PlaneswalkerLoyaltyAbility,
  context: {
    isYourTurn: boolean;
    isMainPhase: boolean;
    stackEmpty: boolean;
    hasPriority: boolean;
  }
): { canActivate: boolean; reason?: string } {
  // Rule 606.3 - Only during your main phase when stack is empty (sorcery timing)
  if (!context.isYourTurn) {
    return { canActivate: false, reason: "Can only activate during your turn" };
  }
  
  if (!context.isMainPhase) {
    return { canActivate: false, reason: "Can only activate during a main phase" };
  }
  
  if (!context.stackEmpty) {
    return { canActivate: false, reason: "Can only activate when the stack is empty" };
  }
  
  if (!context.hasPriority) {
    return { canActivate: false, reason: "You don't have priority" };
  }
  
  // Rule 606.3 - Only one loyalty ability per turn
  if (state.activatedThisTurn) {
    return { canActivate: false, reason: "Already activated a loyalty ability this turn" };
  }
  
  // Check if we have enough loyalty for minus abilities
  if (ability.costType === 'minus' && state.currentLoyalty < ability.costAmount) {
    return { 
      canActivate: false, 
      reason: `Not enough loyalty (have ${state.currentLoyalty}, need ${ability.costAmount})`
    };
  }
  
  return { canActivate: true };
}

/**
 * Activates a loyalty ability
 * Rule 606.3 - Pay loyalty cost as part of activation
 * 
 * @param state - Planeswalker state
 * @param ability - Ability to activate
 * @returns Updated state and activation result
 */
export function activateLoyaltyAbility(
  state: PlaneswalkerState,
  ability: PlaneswalkerLoyaltyAbility
): { state: PlaneswalkerState; result: LoyaltyActivationResult } {
  // Calculate new loyalty
  let newLoyalty = state.currentLoyalty;
  
  switch (ability.costType) {
    case 'plus':
      newLoyalty += ability.costAmount;
      break;
    case 'minus':
      newLoyalty -= ability.costAmount;
      break;
    case 'zero':
      // No change to loyalty
      break;
  }
  
  const newState: PlaneswalkerState = {
    ...state,
    currentLoyalty: newLoyalty,
    activatedThisTurn: true,
    abilityActivatedThisTurn: ability.id,
  };
  
  return {
    state: newState,
    result: {
      success: true,
      newLoyalty,
      abilityActivated: ability,
    },
  };
}

/**
 * Applies damage to a planeswalker
 * Rule 120.3c - Damage dealt to a planeswalker removes that many loyalty counters
 * 
 * @param state - Planeswalker state
 * @param damage - Amount of damage
 * @returns Updated state
 */
export function applyDamageToPlaneswalker(
  state: PlaneswalkerState,
  damage: number
): PlaneswalkerState {
  const newLoyalty = Math.max(0, state.currentLoyalty - damage);
  
  return {
    ...state,
    currentLoyalty: newLoyalty,
  };
}

/**
 * Adds loyalty counters to a planeswalker
 * 
 * @param state - Planeswalker state
 * @param amount - Amount to add
 * @returns Updated state
 */
export function addLoyalty(
  state: PlaneswalkerState,
  amount: number
): PlaneswalkerState {
  return {
    ...state,
    currentLoyalty: state.currentLoyalty + amount,
  };
}

/**
 * Removes loyalty counters from a planeswalker
 * 
 * @param state - Planeswalker state
 * @param amount - Amount to remove
 * @returns Updated state
 */
export function removeLoyalty(
  state: PlaneswalkerState,
  amount: number
): PlaneswalkerState {
  return {
    ...state,
    currentLoyalty: Math.max(0, state.currentLoyalty - amount),
  };
}

/**
 * Checks if planeswalker should be put into graveyard (SBA)
 * Rule 306.9 - A planeswalker with 0 or less loyalty is put into graveyard
 * 
 * @param state - Planeswalker state
 * @returns Whether the planeswalker should die
 */
export function shouldPlaneswalkerDie(state: PlaneswalkerState): boolean {
  return state.currentLoyalty <= 0;
}

/**
 * Resets the "activated this turn" flag at end of turn
 * 
 * @param state - Planeswalker state
 * @returns Updated state
 */
export function resetTurnState(state: PlaneswalkerState): PlaneswalkerState {
  return {
    ...state,
    activatedThisTurn: false,
    abilityActivatedThisTurn: undefined,
  };
}

/**
 * Parses loyalty abilities from oracle text
 * 
 * @param oracleText - Oracle text of the planeswalker
 * @param sourceId - Source permanent ID
 * @param sourceName - Source permanent name
 * @returns Array of loyalty abilities
 */
export function parseLoyaltyAbilities(
  oracleText: string,
  sourceId: string,
  sourceName: string
): PlaneswalkerLoyaltyAbility[] {
  const abilities: PlaneswalkerLoyaltyAbility[] = [];
  
  // Match loyalty ability patterns like "+1:", "−2:", "0:"
  // Note: Uses both regular minus (-) and minus sign (−)
  const abilityPattern = /([+−\-]?)(\d+):\s*([^+−\-]+?)(?=(?:[+−\-]\d+:|$))/gi;
  let match;
  let index = 0;
  
  while ((match = abilityPattern.exec(oracleText)) !== null) {
    const sign = match[1];
    const amount = parseInt(match[2], 10);
    const effect = match[3].trim();
    
    let costType: LoyaltyCostType;
    if (sign === '+') {
      costType = 'plus';
    } else if (sign === '−' || sign === '-') {
      costType = 'minus';
    } else {
      costType = 'zero';
    }
    
    // Check if this looks like an ultimate (typically high minus cost with powerful effect)
    const isUltimate = costType === 'minus' && amount >= 6;
    
    // Check for targets in the effect
    const hasTarget = effect.toLowerCase().includes('target');
    const targets = hasTarget ? [{
      type: 'any',
      description: extractTargetFromEffect(effect),
    }] : undefined;
    
    abilities.push({
      id: `${sourceId}-loyalty-${index}`,
      sourceId,
      sourceName,
      costType,
      costAmount: amount,
      effect,
      targets,
      isUltimate,
    });
    
    index++;
  }
  
  return abilities;
}

/**
 * Extracts target description from effect text
 */
function extractTargetFromEffect(effect: string): string {
  const match = effect.match(/target\s+([^.]+)/i);
  return match ? match[1].trim() : 'target';
}

/**
 * Gets the starting loyalty from card data
 * 
 * @param loyaltyString - Loyalty value from card (might be "X" or a number)
 * @param defaultValue - Default if not parseable
 * @returns Starting loyalty number
 */
export function parseStartingLoyalty(
  loyaltyString: string | number | undefined,
  defaultValue: number = 0
): number {
  if (loyaltyString === undefined || loyaltyString === null) {
    return defaultValue;
  }
  
  if (typeof loyaltyString === 'number') {
    return loyaltyString;
  }
  
  // Handle "X" loyalty (e.g., Nissa, Steward of Elements)
  if (loyaltyString.toUpperCase() === 'X') {
    return 0; // X will be determined when entering
  }
  
  const parsed = parseInt(loyaltyString, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Checks if a card type line indicates a planeswalker
 * 
 * @param typeLine - Card type line
 * @returns Whether this is a planeswalker
 */
export function isPlaneswalker(typeLine: string): boolean {
  return typeLine.toLowerCase().includes('planeswalker');
}

/**
 * Gets all available loyalty abilities for current state
 * 
 * @param state - Planeswalker state
 * @param context - Game context
 * @returns Available abilities with activation status
 */
export function getAvailableLoyaltyAbilities(
  state: PlaneswalkerState,
  context: {
    isYourTurn: boolean;
    isMainPhase: boolean;
    stackEmpty: boolean;
    hasPriority: boolean;
  }
): Array<{
  ability: PlaneswalkerLoyaltyAbility;
  canActivate: boolean;
  reason?: string;
}> {
  return state.loyaltyAbilities.map(ability => {
    const { canActivate, reason } = canActivateLoyaltyAbility(state, ability, context);
    return {
      ability,
      canActivate,
      reason,
    };
  });
}
