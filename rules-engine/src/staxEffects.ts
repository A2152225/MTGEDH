/**
 * Stax Effects Support
 * 
 * Handles "can't" restrictions aggregation for stax-style effects.
 * Stax effects are static abilities that restrict what players can do.
 * 
 * Examples:
 * - "Players can't cast more than one spell each turn" (Rule of Law)
 * - "Creatures can't attack you" (Ghostly Prison without paying)
 * - "Players can't search libraries" (Aven Mindcensor)
 */

/**
 * Types of stax restrictions
 */
export enum StaxRestrictionType {
  // Casting restrictions
  CANT_CAST_SPELLS = 'cant_cast_spells',
  SPELL_LIMIT_PER_TURN = 'spell_limit_per_turn',
  CANT_CAST_TYPE = 'cant_cast_type',
  CANT_CAST_UNLESS = 'cant_cast_unless',
  
  // Combat restrictions
  CANT_ATTACK = 'cant_attack',
  CANT_ATTACK_UNLESS = 'cant_attack_unless',
  CANT_BLOCK = 'cant_block',
  CANT_BLOCK_UNLESS = 'cant_block_unless',
  
  // Activation restrictions
  CANT_ACTIVATE_ABILITIES = 'cant_activate_abilities',
  ABILITY_LIMIT_PER_TURN = 'ability_limit_per_turn',
  
  // Library restrictions
  CANT_SEARCH_LIBRARY = 'cant_search_library',
  CANT_DRAW_EXTRA = 'cant_draw_extra',
  CANT_SHUFFLE = 'cant_shuffle',
  
  // Zone change restrictions
  CANT_ENTER_BATTLEFIELD = 'cant_enter_battlefield',
  CANT_LEAVE_GRAVEYARD = 'cant_leave_graveyard',
  CANT_BE_SACRIFICED = 'cant_be_sacrificed',
  
  // Counter restrictions
  CANT_GAIN_LIFE = 'cant_gain_life',
  CANT_GAIN_COUNTERS = 'cant_gain_counters',
  CANT_LOSE_COUNTERS = 'cant_lose_counters',
  
  // Untap restrictions
  DOESNT_UNTAP = 'doesnt_untap',
  CANT_UNTAP = 'cant_untap',
  
  // Regeneration restrictions
  CANT_REGENERATE = 'cant_regenerate',
  
  // Other
  CANT_TRANSFORM = 'cant_transform',
  CANT_PAY_LIFE = 'cant_pay_life',
  CUSTOM = 'custom',
}

/**
 * Target filter for stax effects
 */
export interface StaxTargetFilter {
  readonly affectsYou?: boolean;
  readonly affectsOpponents?: boolean;
  readonly affectsAll?: boolean;
  readonly cardTypes?: readonly string[];
  readonly colors?: readonly string[];
  readonly controller?: 'you' | 'opponents' | 'any';
  readonly specificPermanentId?: string;
  readonly customFilter?: string;
}

/**
 * A stax restriction from a specific source
 */
export interface StaxRestriction {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly controllerId: string;
  readonly type: StaxRestrictionType;
  readonly filter: StaxTargetFilter;
  readonly limit?: number; // For limits per turn
  readonly unlessCondition?: string; // "unless you pay {2}"
  readonly isActive: boolean;
}

/**
 * Result of checking a stax restriction
 */
export interface StaxCheckResult {
  readonly isRestricted: boolean;
  readonly restrictions: readonly StaxRestriction[];
  readonly canProceedWith?: string; // Condition to proceed
  readonly reason?: string;
}

/**
 * Aggregated stax state for the game
 */
export interface StaxState {
  readonly restrictions: readonly StaxRestriction[];
  readonly spellsCastThisTurn: Record<string, number>; // Player ID -> count
  readonly abilitiesActivatedThisTurn: Record<string, number>;
  readonly extraCardsDrawnThisTurn: Record<string, number>;
}

/**
 * Creates an empty stax state
 */
export function createEmptyStaxState(): StaxState {
  return {
    restrictions: [],
    spellsCastThisTurn: {},
    abilitiesActivatedThisTurn: {},
    extraCardsDrawnThisTurn: {},
  };
}

/**
 * Adds a stax restriction to the state
 * 
 * @param state - Current stax state
 * @param restriction - Restriction to add
 * @returns Updated state
 */
export function addStaxRestriction(
  state: StaxState,
  restriction: StaxRestriction
): StaxState {
  return {
    ...state,
    restrictions: [...state.restrictions, restriction],
  };
}

/**
 * Removes a stax restriction from the state
 * 
 * @param state - Current stax state
 * @param restrictionId - ID of restriction to remove
 * @returns Updated state
 */
export function removeStaxRestriction(
  state: StaxState,
  restrictionId: string
): StaxState {
  return {
    ...state,
    restrictions: state.restrictions.filter(r => r.id !== restrictionId),
  };
}

/**
 * Removes all restrictions from a source
 * 
 * @param state - Current stax state
 * @param sourceId - Source permanent ID
 * @returns Updated state
 */
export function removeStaxRestrictionsFromSource(
  state: StaxState,
  sourceId: string
): StaxState {
  return {
    ...state,
    restrictions: state.restrictions.filter(r => r.sourceId !== sourceId),
  };
}

/**
 * Checks if a player can cast a spell
 * 
 * @param state - Current stax state
 * @param playerId - Player trying to cast
 * @param spellInfo - Information about the spell
 * @returns Check result
 */
export function canCastSpell(
  state: StaxState,
  playerId: string,
  spellInfo: {
    cardTypes?: readonly string[];
    colors?: readonly string[];
    manaValue?: number;
  }
): StaxCheckResult {
  const applicableRestrictions: StaxRestriction[] = [];
  
  for (const restriction of state.restrictions) {
    if (!restriction.isActive) continue;
    
    // Check casting restrictions
    if (restriction.type === StaxRestrictionType.CANT_CAST_SPELLS) {
      if (appliesToPlayer(restriction.filter, playerId, restriction.controllerId)) {
        applicableRestrictions.push(restriction);
      }
    }
    
    // Check spell limits
    if (restriction.type === StaxRestrictionType.SPELL_LIMIT_PER_TURN) {
      if (appliesToPlayer(restriction.filter, playerId, restriction.controllerId)) {
        const castThisTurn = state.spellsCastThisTurn[playerId] || 0;
        if (restriction.limit !== undefined && castThisTurn >= restriction.limit) {
          applicableRestrictions.push(restriction);
        }
      }
    }
    
    // Check type-specific restrictions
    if (restriction.type === StaxRestrictionType.CANT_CAST_TYPE) {
      if (appliesToPlayer(restriction.filter, playerId, restriction.controllerId)) {
        if (matchesCardTypes(restriction.filter.cardTypes, spellInfo.cardTypes)) {
          applicableRestrictions.push(restriction);
        }
      }
    }
  }
  
  if (applicableRestrictions.length === 0) {
    return { isRestricted: false, restrictions: [] };
  }
  
  // Check for "unless" conditions
  const unlessConditions = applicableRestrictions
    .filter(r => r.unlessCondition)
    .map(r => r.unlessCondition!);
  
  return {
    isRestricted: true,
    restrictions: applicableRestrictions,
    canProceedWith: unlessConditions.length > 0 ? unlessConditions.join(' and ') : undefined,
    reason: `Restricted by: ${applicableRestrictions.map(r => r.sourceName).join(', ')}`,
  };
}

/**
 * Checks if a creature can attack
 * 
 * @param state - Current stax state
 * @param creatureId - Creature trying to attack
 * @param controllerId - Controller of the creature
 * @param defendingPlayerId - Player being attacked
 * @returns Check result
 */
export function canAttack(
  state: StaxState,
  creatureId: string,
  controllerId: string,
  defendingPlayerId: string
): StaxCheckResult {
  const applicableRestrictions: StaxRestriction[] = [];
  
  for (const restriction of state.restrictions) {
    if (!restriction.isActive) continue;
    
    if (restriction.type === StaxRestrictionType.CANT_ATTACK) {
      // Check if this restriction applies to this creature
      if (restriction.filter.specificPermanentId === creatureId ||
          appliesToPlayer(restriction.filter, controllerId, restriction.controllerId)) {
        applicableRestrictions.push(restriction);
      }
    }
    
    if (restriction.type === StaxRestrictionType.CANT_ATTACK_UNLESS) {
      if (restriction.filter.affectsOpponents && 
          restriction.controllerId !== controllerId) {
        applicableRestrictions.push(restriction);
      }
    }
  }
  
  if (applicableRestrictions.length === 0) {
    return { isRestricted: false, restrictions: [] };
  }
  
  const unlessConditions = applicableRestrictions
    .filter(r => r.unlessCondition)
    .map(r => r.unlessCondition!);
  
  return {
    isRestricted: true,
    restrictions: applicableRestrictions,
    canProceedWith: unlessConditions.length > 0 ? unlessConditions.join(' and ') : undefined,
    reason: `Attack restricted by: ${applicableRestrictions.map(r => r.sourceName).join(', ')}`,
  };
}

/**
 * Checks if a player can search their library
 * 
 * @param state - Current stax state
 * @param playerId - Player trying to search
 * @returns Check result
 */
export function canSearchLibrary(
  state: StaxState,
  playerId: string
): StaxCheckResult {
  const applicableRestrictions: StaxRestriction[] = [];
  
  for (const restriction of state.restrictions) {
    if (!restriction.isActive) continue;
    
    if (restriction.type === StaxRestrictionType.CANT_SEARCH_LIBRARY) {
      if (appliesToPlayer(restriction.filter, playerId, restriction.controllerId)) {
        applicableRestrictions.push(restriction);
      }
    }
  }
  
  if (applicableRestrictions.length === 0) {
    return { isRestricted: false, restrictions: [] };
  }
  
  return {
    isRestricted: true,
    restrictions: applicableRestrictions,
    reason: `Search restricted by: ${applicableRestrictions.map(r => r.sourceName).join(', ')}`,
  };
}

/**
 * Checks if a player can gain life
 * 
 * @param state - Current stax state
 * @param playerId - Player trying to gain life
 * @returns Check result
 */
export function canGainLife(
  state: StaxState,
  playerId: string
): StaxCheckResult {
  const applicableRestrictions: StaxRestriction[] = [];
  
  for (const restriction of state.restrictions) {
    if (!restriction.isActive) continue;
    
    if (restriction.type === StaxRestrictionType.CANT_GAIN_LIFE) {
      if (appliesToPlayer(restriction.filter, playerId, restriction.controllerId)) {
        applicableRestrictions.push(restriction);
      }
    }
  }
  
  if (applicableRestrictions.length === 0) {
    return { isRestricted: false, restrictions: [] };
  }
  
  return {
    isRestricted: true,
    restrictions: applicableRestrictions,
    reason: `Life gain restricted by: ${applicableRestrictions.map(r => r.sourceName).join(', ')}`,
  };
}

/**
 * Checks if a permanent can be regenerated
 * 
 * @param state - Current stax state
 * @param permanentId - The permanent
 * @returns Check result
 */
export function canRegenerate(
  state: StaxState,
  permanentId: string
): StaxCheckResult {
  const applicableRestrictions: StaxRestriction[] = [];
  
  for (const restriction of state.restrictions) {
    if (!restriction.isActive) continue;
    
    if (restriction.type === StaxRestrictionType.CANT_REGENERATE) {
      if (restriction.filter.specificPermanentId === permanentId ||
          restriction.filter.affectsAll) {
        applicableRestrictions.push(restriction);
      }
    }
  }
  
  if (applicableRestrictions.length === 0) {
    return { isRestricted: false, restrictions: [] };
  }
  
  return {
    isRestricted: true,
    restrictions: applicableRestrictions,
    reason: `Regeneration prevented by: ${applicableRestrictions.map(r => r.sourceName).join(', ')}`,
  };
}

/**
 * Checks if a permanent untaps during untap step
 * 
 * @param state - Current stax state
 * @param permanentId - The permanent
 * @param controllerId - Controller of the permanent
 * @returns Check result
 */
export function canUntapDuringUntapStep(
  state: StaxState,
  permanentId: string,
  controllerId: string
): StaxCheckResult {
  const applicableRestrictions: StaxRestriction[] = [];
  
  for (const restriction of state.restrictions) {
    if (!restriction.isActive) continue;
    
    if (restriction.type === StaxRestrictionType.DOESNT_UNTAP ||
        restriction.type === StaxRestrictionType.CANT_UNTAP) {
      if (restriction.filter.specificPermanentId === permanentId ||
          appliesToPlayer(restriction.filter, controllerId, restriction.controllerId)) {
        applicableRestrictions.push(restriction);
      }
    }
  }
  
  if (applicableRestrictions.length === 0) {
    return { isRestricted: false, restrictions: [] };
  }
  
  return {
    isRestricted: true,
    restrictions: applicableRestrictions,
    reason: `Untap prevented by: ${applicableRestrictions.map(r => r.sourceName).join(', ')}`,
  };
}

/**
 * Records that a player cast a spell (for limit tracking)
 * 
 * @param state - Current stax state
 * @param playerId - Player who cast
 * @returns Updated state
 */
export function recordSpellCast(
  state: StaxState,
  playerId: string
): StaxState {
  const currentCount = state.spellsCastThisTurn[playerId] || 0;
  return {
    ...state,
    spellsCastThisTurn: {
      ...state.spellsCastThisTurn,
      [playerId]: currentCount + 1,
    },
  };
}

/**
 * Resets turn-based tracking at end of turn
 * 
 * @param state - Current stax state
 * @returns Updated state
 */
export function resetTurnTracking(state: StaxState): StaxState {
  return {
    ...state,
    spellsCastThisTurn: {},
    abilitiesActivatedThisTurn: {},
    extraCardsDrawnThisTurn: {},
  };
}

/**
 * Helper: Checks if a restriction filter applies to a player
 */
function appliesToPlayer(
  filter: StaxTargetFilter,
  targetPlayerId: string,
  sourceControllerId: string
): boolean {
  if (filter.affectsAll) return true;
  if (filter.affectsYou && targetPlayerId === sourceControllerId) return true;
  if (filter.affectsOpponents && targetPlayerId !== sourceControllerId) return true;
  return false;
}

/**
 * Helper: Checks if card types match filter
 */
function matchesCardTypes(
  filterTypes: readonly string[] | undefined,
  cardTypes: readonly string[] | undefined
): boolean {
  if (!filterTypes || filterTypes.length === 0) return false;
  if (!cardTypes || cardTypes.length === 0) return false;
  
  return filterTypes.some(ft => 
    cardTypes.some(ct => ct.toLowerCase() === ft.toLowerCase())
  );
}

/**
 * Parses stax restrictions from oracle text
 * 
 * @param oracleText - The oracle text
 * @param sourceId - Source permanent ID
 * @param sourceName - Source permanent name
 * @param controllerId - Controller of the source
 * @returns Array of stax restrictions
 */
export function parseStaxFromText(
  oracleText: string,
  sourceId: string,
  sourceName: string,
  controllerId: string
): StaxRestriction[] {
  const restrictions: StaxRestriction[] = [];
  const text = oracleText.toLowerCase();
  
  // "Each player can't cast more than one spell each turn"
  const spellLimitMatch = text.match(/(?:each )?player(?:s)? can(?:'t| not) cast more than (\w+) spell/i);
  if (spellLimitMatch) {
    const limit = wordToNumber(spellLimitMatch[1]) || 1;
    restrictions.push({
      id: `${sourceId}-spell-limit`,
      sourceId,
      sourceName,
      controllerId,
      type: StaxRestrictionType.SPELL_LIMIT_PER_TURN,
      filter: { affectsAll: true },
      limit,
      isActive: true,
    });
  }
  
  // "Creatures can't attack you unless..."
  if (text.includes("creatures can't attack you") || text.includes("can't attack you unless")) {
    const unlessMatch = text.match(/can't attack you unless[^.]+/i);
    restrictions.push({
      id: `${sourceId}-cant-attack`,
      sourceId,
      sourceName,
      controllerId,
      type: StaxRestrictionType.CANT_ATTACK_UNLESS,
      filter: { affectsOpponents: true },
      unlessCondition: unlessMatch ? unlessMatch[0].replace("can't attack you unless ", '') : undefined,
      isActive: true,
    });
  }
  
  // "Players can't search libraries"
  if (text.includes("can't search") && text.includes("librar")) {
    restrictions.push({
      id: `${sourceId}-cant-search`,
      sourceId,
      sourceName,
      controllerId,
      type: StaxRestrictionType.CANT_SEARCH_LIBRARY,
      filter: { affectsAll: true },
      isActive: true,
    });
  }
  
  // "Players can't gain life"
  if (text.includes("can't gain life")) {
    const affectsOpponentsOnly = text.includes("opponents can't gain life");
    restrictions.push({
      id: `${sourceId}-cant-gain-life`,
      sourceId,
      sourceName,
      controllerId,
      type: StaxRestrictionType.CANT_GAIN_LIFE,
      filter: affectsOpponentsOnly ? { affectsOpponents: true } : { affectsAll: true },
      isActive: true,
    });
  }
  
  // "...doesn't untap during"
  if (text.includes("doesn't untap during") || text.includes("don't untap during")) {
    restrictions.push({
      id: `${sourceId}-doesnt-untap`,
      sourceId,
      sourceName,
      controllerId,
      type: StaxRestrictionType.DOESNT_UNTAP,
      filter: { affectsAll: true },
      isActive: true,
    });
  }
  
  // "...can't be regenerated"
  if (text.includes("can't be regenerated")) {
    restrictions.push({
      id: `${sourceId}-cant-regenerate`,
      sourceId,
      sourceName,
      controllerId,
      type: StaxRestrictionType.CANT_REGENERATE,
      filter: { affectsAll: true },
      isActive: true,
    });
  }
  
  return restrictions;
}

/**
 * Converts word numbers to digits
 */
function wordToNumber(word: string): number | undefined {
  const map: Record<string, number> = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
  };
  return map[word.toLowerCase()];
}
