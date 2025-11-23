// Priority implementation following rule 117
import type { GameState, PlayerID } from '../../shared/src';
import { GamePhase } from '../../shared/src';

export interface PriorityResult<T> {
  readonly next: T;
  readonly log?: readonly string[];
}

/**
 * Pass priority to the next player (rule 117.3d)
 * If all players pass in succession, the top object on stack resolves or phase ends
 */
export function passPriority(
  state: Readonly<GameState>,
  playerId: PlayerID
): PriorityResult<GameState> {
  // Verify the player has priority
  if (state.priority !== playerId) {
    return {
      next: state,
      log: [`${playerId} cannot pass priority - doesn't have it`]
    };
  }

  const playerOrder = state.players.map(p => p.id);
  if (playerOrder.length === 0) {
    return { next: state };
  }

  const currentIndex = playerOrder.indexOf(playerId);
  const nextIndex = (currentIndex + 1) % playerOrder.length;
  const nextPlayer = playerOrder[nextIndex];

  return {
    next: {
      ...state,
      priority: nextPlayer
    },
    log: [`${playerId} passed priority to ${nextPlayer}`]
  };
}

/**
 * Give priority to a specific player (rule 117.3a, 117.3b, 117.3c)
 * This is called:
 * - At the beginning of steps/phases (active player gets priority)
 * - After a spell/ability resolves (active player gets priority)
 * - After casting/activating (same player gets priority)
 */
export function givePriority(
  state: Readonly<GameState>,
  playerId: PlayerID
): PriorityResult<GameState> {
  return {
    next: {
      ...state,
      priority: playerId
    },
    log: [`${playerId} receives priority`]
  };
}

/**
 * Get the active player (rule 117.3a)
 * The active player is the one whose turn it is
 */
export function getActivePlayer(state: Readonly<GameState>): PlayerID {
  return state.turnPlayer;
}

/**
 * Give priority to the active player (rule 117.3a, 117.3b)
 * This is the most common priority grant
 */
export function giveActivePlayerPriority(
  state: Readonly<GameState>
): PriorityResult<GameState> {
  const activePlayer = getActivePlayer(state);
  return givePriority(state, activePlayer);
}

/**
 * Check if a player has priority
 */
export function hasPriority(
  state: Readonly<GameState>,
  playerId: PlayerID
): boolean {
  return state.priority === playerId;
}

/**
 * Check if all players have passed priority in succession (rule 117.4)
 * This would be tracked with additional state, but for now we just check basic conditions
 */
export function checkAllPlayersPassed(
  state: Readonly<GameState>,
  passedPlayers: readonly PlayerID[]
): boolean {
  // All players must have passed
  const allPlayerIds = state.players.map(p => p.id);
  return allPlayerIds.every(id => passedPlayers.includes(id));
}

/**
 * Reset priority tracking when a spell/ability is cast or activated (rule 117.3c)
 * After someone takes an action, priority passing resets
 */
export function resetPriorityPasses(): readonly PlayerID[] {
  return [];
}

/**
 * Record that a player passed priority
 */
export function recordPriorityPass(
  passedPlayers: readonly PlayerID[],
  playerId: PlayerID
): readonly PlayerID[] {
  if (passedPlayers.includes(playerId)) {
    return passedPlayers;
  }
  return [...passedPlayers, playerId];
}

/**
 * Determine what happens when all players pass (rule 117.4)
 * - If stack is not empty: top object resolves
 * - If stack is empty: current step/phase ends
 */
export interface AllPassedResult {
  readonly shouldResolveTop: boolean;
  readonly shouldEndPhase: boolean;
}

export function getAllPassedAction(state: Readonly<GameState>): AllPassedResult {
  const hasStackObjects = state.stack.length > 0;

  return {
    shouldResolveTop: hasStackObjects,
    shouldEndPhase: !hasStackObjects
  };
}

/**
 * Check if a player can receive priority in the current step (rule 117.3a)
 * Players don't get priority during untap step
 */
export function canReceivePriority(state: Readonly<GameState>): boolean {
  // Rule 117.3a: No player receives priority during the untap step
  if (state.step === 'UNTAP') {
    return false;
  }

  // Rule 514.3: Players usually don't get priority during cleanup step
  // (except in special cases when triggered abilities trigger or state-based actions happen)
  // For simplicity, we'll allow it for now but note this edge case
  
  return true;
}

/**
 * Get the next player in turn order after the given player
 */
export function getNextPlayer(
  state: Readonly<GameState>,
  currentPlayer: PlayerID
): PlayerID {
  const playerOrder = state.players.map(p => p.id);
  const currentIndex = playerOrder.indexOf(currentPlayer);
  const nextIndex = (currentIndex + 1) % playerOrder.length;
  return playerOrder[nextIndex];
}

/**
 * Check if it's a main phase and stack is empty (for sorcery-speed actions)
 * Rule 117.1a: A player may cast a noninstant spell during their main phase
 * any time they have priority and the stack is empty
 */
export function canCastSorcery(
  state: Readonly<GameState>,
  playerId: PlayerID
): boolean {
  const isActivePlayer = state.turnPlayer === playerId;
  // Main phase is represented as FIRSTMAIN in the enum
  // Note: There may be a second main phase but it's not in the enum
  const isMainPhase = state.phase === GamePhase.FIRSTMAIN;
  const stackEmpty = state.stack.length === 0;
  const playerHasPriority = state.priority === playerId;

  return isActivePlayer && isMainPhase && stackEmpty && playerHasPriority;
}

/**
 * Check if a player can cast an instant (or activate an ability) (rule 117.1a, 117.1b)
 * Requires only having priority
 */
export function canCastInstant(
  state: Readonly<GameState>,
  playerId: PlayerID
): boolean {
  return state.priority === playerId;
}
