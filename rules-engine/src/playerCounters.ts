/**
 * playerCounters.ts
 * 
 * Comprehensive player counter management system.
 * Handles poison counters, energy counters, experience counters, and the
 * related game mechanics.
 * 
 * Rules Reference:
 * - Rule 122: Counters
 * - Rule 104.3d: Lose condition from poison counters
 * - Rule 702.90: Infect (damage as poison counters)
 * - Rule 702.80: Wither (damage as -1/-1 counters)
 * - Rule 702.164: Toxic (combat damage gives poison counters)
 * - Rule 702.70: Poisonous (triggered ability for poison counters)
 */

import type { PlayerID } from '../../shared/src';

/**
 * Counter types that can be placed on players
 */
export enum PlayerCounterType {
  POISON = 'poison',
  ENERGY = 'energy',
  EXPERIENCE = 'experience',
  RAD = 'rad', // Fallout set
  TICKET = 'ticket', // Unfinity
}

/**
 * Player counter state
 */
export interface PlayerCounterState {
  readonly playerId: PlayerID;
  readonly poison: number;
  readonly energy: number;
  readonly experience: number;
  readonly rad: number;
  readonly ticket: number;
  readonly other: Readonly<Record<string, number>>;
}

/**
 * Counter change event
 */
export interface CounterChangeEvent {
  readonly playerId: PlayerID;
  readonly counterType: string;
  readonly previousValue: number;
  readonly newValue: number;
  readonly delta: number;
  readonly sourceId?: string;
  readonly sourceName?: string;
}

/**
 * Result of a counter operation
 */
export interface CounterOperationResult {
  readonly state: PlayerCounterState;
  readonly changes: readonly CounterChangeEvent[];
  readonly loseConditionMet: boolean;
  readonly loseReason?: string;
}

/**
 * Create initial player counter state
 */
export function createPlayerCounterState(playerId: PlayerID): PlayerCounterState {
  return {
    playerId,
    poison: 0,
    energy: 0,
    experience: 0,
    rad: 0,
    ticket: 0,
    other: {},
  };
}

/**
 * Get the value of a counter on a player
 */
export function getPlayerCounter(
  state: PlayerCounterState,
  counterType: string
): number {
  switch (counterType) {
    case PlayerCounterType.POISON:
      return state.poison;
    case PlayerCounterType.ENERGY:
      return state.energy;
    case PlayerCounterType.EXPERIENCE:
      return state.experience;
    case PlayerCounterType.RAD:
      return state.rad;
    case PlayerCounterType.TICKET:
      return state.ticket;
    default:
      return state.other[counterType] ?? 0;
  }
}

/**
 * Add counters to a player
 * 
 * Rule 122.1a: Counters can be placed on players
 */
export function addPlayerCounters(
  state: PlayerCounterState,
  counterType: string,
  amount: number,
  sourceId?: string,
  sourceName?: string
): CounterOperationResult {
  if (amount <= 0) {
    return {
      state,
      changes: [],
      loseConditionMet: false,
    };
  }

  const previousValue = getPlayerCounter(state, counterType);
  const newValue = previousValue + amount;
  
  let newState: PlayerCounterState;
  
  switch (counterType) {
    case PlayerCounterType.POISON:
      newState = { ...state, poison: newValue };
      break;
    case PlayerCounterType.ENERGY:
      newState = { ...state, energy: newValue };
      break;
    case PlayerCounterType.EXPERIENCE:
      newState = { ...state, experience: newValue };
      break;
    case PlayerCounterType.RAD:
      newState = { ...state, rad: newValue };
      break;
    case PlayerCounterType.TICKET:
      newState = { ...state, ticket: newValue };
      break;
    default:
      newState = {
        ...state,
        other: { ...state.other, [counterType]: newValue },
      };
  }
  
  const change: CounterChangeEvent = {
    playerId: state.playerId,
    counterType,
    previousValue,
    newValue,
    delta: amount,
    sourceId,
    sourceName,
  };
  
  // Rule 104.3d: Ten or more poison counters causes loss
  const loseConditionMet = counterType === PlayerCounterType.POISON && newValue >= 10;
  
  return {
    state: newState,
    changes: [change],
    loseConditionMet,
    loseReason: loseConditionMet ? `Player has ${newValue} poison counters (Rule 104.3d)` : undefined,
  };
}

/**
 * Remove counters from a player
 * 
 * Rule 122.1a: Counters can be removed from players
 */
export function removePlayerCounters(
  state: PlayerCounterState,
  counterType: string,
  amount: number,
  sourceId?: string,
  sourceName?: string
): CounterOperationResult {
  if (amount <= 0) {
    return {
      state,
      changes: [],
      loseConditionMet: false,
    };
  }

  const previousValue = getPlayerCounter(state, counterType);
  // Cannot remove more counters than exist
  const actualRemoval = Math.min(previousValue, amount);
  const newValue = previousValue - actualRemoval;
  
  let newState: PlayerCounterState;
  
  switch (counterType) {
    case PlayerCounterType.POISON:
      newState = { ...state, poison: newValue };
      break;
    case PlayerCounterType.ENERGY:
      newState = { ...state, energy: newValue };
      break;
    case PlayerCounterType.EXPERIENCE:
      newState = { ...state, experience: newValue };
      break;
    case PlayerCounterType.RAD:
      newState = { ...state, rad: newValue };
      break;
    case PlayerCounterType.TICKET:
      newState = { ...state, ticket: newValue };
      break;
    default:
      newState = {
        ...state,
        other: { ...state.other, [counterType]: newValue },
      };
  }
  
  const change: CounterChangeEvent = {
    playerId: state.playerId,
    counterType,
    previousValue,
    newValue,
    delta: -actualRemoval,
    sourceId,
    sourceName,
  };
  
  return {
    state: newState,
    changes: [change],
    loseConditionMet: false,
  };
}

/**
 * Pay energy counters as a cost
 * 
 * Energy counters are a resource that can be paid for effects.
 * Returns null if payment cannot be made.
 */
export function payEnergy(
  state: PlayerCounterState,
  amount: number,
  sourceId?: string,
  sourceName?: string
): CounterOperationResult | null {
  if (amount <= 0) {
    return {
      state,
      changes: [],
      loseConditionMet: false,
    };
  }
  
  if (state.energy < amount) {
    // Cannot pay - insufficient energy
    return null;
  }
  
  return removePlayerCounters(state, PlayerCounterType.ENERGY, amount, sourceId, sourceName);
}

/**
 * Check if player can pay energy cost
 */
export function canPayEnergy(state: PlayerCounterState, amount: number): boolean {
  return state.energy >= amount;
}

/**
 * Check if player has lost due to poison counters
 * 
 * Rule 104.3d: A player with ten or more poison counters loses the game.
 */
export function hasLostDueToPoison(state: PlayerCounterState): boolean {
  return state.poison >= 10;
}

/**
 * Process infect damage to a player
 * 
 * Rule 702.90b: Damage dealt to a player by a source with infect doesn't cause 
 * that player to lose life. Instead, it causes that source's controller to give 
 * the player that many poison counters.
 */
export function processInfectDamageToPlayer(
  state: PlayerCounterState,
  damage: number,
  sourceId?: string,
  sourceName?: string
): CounterOperationResult {
  return addPlayerCounters(state, PlayerCounterType.POISON, damage, sourceId, sourceName);
}

/**
 * Process toxic combat damage
 * 
 * Rule 702.164c: Combat damage dealt to a player by a creature with toxic causes 
 * that creature's controller to give the player a number of poison counters equal 
 * to that creature's total toxic value, in addition to the damage's other results.
 */
export function processToxicCombatDamage(
  state: PlayerCounterState,
  toxicValue: number,
  sourceId?: string,
  sourceName?: string
): CounterOperationResult {
  return addPlayerCounters(state, PlayerCounterType.POISON, toxicValue, sourceId, sourceName);
}

/**
 * Process poisonous triggered ability
 * 
 * Rule 702.70: "Poisonous N" means "Whenever this creature deals combat damage 
 * to a player, that player gets N poison counters."
 */
export function processPoisonousAbility(
  state: PlayerCounterState,
  poisonousValue: number,
  sourceId?: string,
  sourceName?: string
): CounterOperationResult {
  return addPlayerCounters(state, PlayerCounterType.POISON, poisonousValue, sourceId, sourceName);
}

/**
 * Gain experience counters
 * 
 * Experience counters are primarily used with Commander experience abilities.
 */
export function gainExperience(
  state: PlayerCounterState,
  amount: number,
  sourceId?: string,
  sourceName?: string
): CounterOperationResult {
  return addPlayerCounters(state, PlayerCounterType.EXPERIENCE, amount, sourceId, sourceName);
}

/**
 * Gain energy counters
 */
export function gainEnergy(
  state: PlayerCounterState,
  amount: number,
  sourceId?: string,
  sourceName?: string
): CounterOperationResult {
  return addPlayerCounters(state, PlayerCounterType.ENERGY, amount, sourceId, sourceName);
}

/**
 * Get all counter types a player has (for proliferate targeting)
 */
export function getPlayerCounterTypes(state: PlayerCounterState): string[] {
  const types: string[] = [];
  
  if (state.poison > 0) types.push(PlayerCounterType.POISON);
  if (state.energy > 0) types.push(PlayerCounterType.ENERGY);
  if (state.experience > 0) types.push(PlayerCounterType.EXPERIENCE);
  if (state.rad > 0) types.push(PlayerCounterType.RAD);
  if (state.ticket > 0) types.push(PlayerCounterType.TICKET);
  
  for (const [type, count] of Object.entries(state.other)) {
    if (count > 0) types.push(type);
  }
  
  return types;
}

/**
 * Check if player has any counters (for proliferate eligibility)
 */
export function playerHasCounters(state: PlayerCounterState): boolean {
  return getPlayerCounterTypes(state).length > 0;
}

/**
 * Apply proliferate to a player
 * Adds one counter of each type the player already has.
 */
export function proliferatePlayer(
  state: PlayerCounterState,
  sourceId?: string,
  sourceName?: string
): CounterOperationResult {
  const counterTypes = getPlayerCounterTypes(state);
  
  if (counterTypes.length === 0) {
    return {
      state,
      changes: [],
      loseConditionMet: false,
    };
  }
  
  let currentState = state;
  const allChanges: CounterChangeEvent[] = [];
  let loseConditionMet = false;
  let loseReason: string | undefined;
  
  for (const counterType of counterTypes) {
    const result = addPlayerCounters(currentState, counterType, 1, sourceId, sourceName);
    currentState = result.state;
    allChanges.push(...result.changes);
    
    if (result.loseConditionMet) {
      loseConditionMet = true;
      loseReason = result.loseReason;
    }
  }
  
  return {
    state: currentState,
    changes: allChanges,
    loseConditionMet,
    loseReason,
  };
}
