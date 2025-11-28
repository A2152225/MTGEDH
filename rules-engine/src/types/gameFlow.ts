/**
 * Rules 101-104: Game Flow and Golden Rules
 * Fundamental game rules, players, starting, and ending the game
 */

import { ControllerID } from './objects';

/**
 * Rule 101: The Magic Golden Rules
 * Fundamental rules that govern card interactions
 */

/**
 * Rule 101.1 - Card text overrides rules
 * "The card takes precedence"
 */
export interface CardOverrideRule {
  readonly ruleOverridden: string;
  readonly cardEffect: string;
  readonly onlyOverridesSpecificSituation: boolean;
}

/**
 * Rule 101.2 - "Can't" beats "Can"
 * When one effect allows something and another prevents it, the prevention wins
 */
export function cantBeatsCan(
  canEffect: boolean,
  cantEffect: boolean
): boolean {
  if (cantEffect) {
    return false; // Can't effect takes precedence
  }
  return canEffect;
}

/**
 * Rule 101.3 - Impossible instructions are ignored
 */
export function isInstructionPossible(instruction: string): boolean {
  // In actual implementation, would validate if instruction can be performed
  // If impossible, it's ignored (returns false)
  return true; // Placeholder
}

/**
 * Rule 101.4 - APNAP Order
 * Active Player, Nonactive Player order for simultaneous choices/actions
 */
export interface APNAPOrder {
  readonly activePlayer: ControllerID;
  readonly nonactivePlayers: readonly ControllerID[];  // In turn order
}

/**
 * Get APNAP order for making choices
 */
export function getAPNAPOrder(
  activePlayer: ControllerID,
  allPlayers: readonly ControllerID[]
): APNAPOrder {
  const nonactivePlayers = allPlayers.filter(p => p !== activePlayer);
  return {
    activePlayer,
    nonactivePlayers
  };
}

/**
 * Rule 101.4d - APNAP restart
 * If a nonactive player's choice causes the active player (or earlier nonactive player)
 * to make a choice, APNAP order restarts
 */
export interface ChoiceSequence {
  readonly playerMakingChoice: ControllerID;
  readonly choicesMade: Map<ControllerID, string>;
  readonly needsRestart: boolean;
}

/**
 * Rule 102: Players
 */

/**
 * Rule 102.1 - Player definitions
 */
export interface Player {
  readonly id: ControllerID;
  readonly name: string;
  readonly isActive: boolean;  // Is this player the active player?
  readonly seat: number;       // Position in turn order
  readonly team?: string;      // For team games
}

/**
 * Rule 102.2 - In two-player game, opponent is the other player
 */
export function getOpponent(
  playerId: ControllerID,
  allPlayers: readonly Player[]
): Player | null {
  if (allPlayers.length !== 2) {
    return null; // Not a two-player game
  }
  return allPlayers.find(p => p.id !== playerId) || null;
}

/**
 * Rule 102.3 - Teammates and opponents in multiplayer
 */
export function getTeammates(
  playerId: ControllerID,
  allPlayers: readonly Player[]
): Player[] {
  const player = allPlayers.find(p => p.id === playerId);
  if (!player || !player.team) {
    return [];
  }
  return allPlayers.filter(p => p.id !== playerId && p.team === player.team);
}

export function getOpponents(
  playerId: ControllerID,
  allPlayers: readonly Player[]
): Player[] {
  const player = allPlayers.find(p => p.id === playerId);
  if (!player) {
    return [];
  }
  
  if (player.team) {
    // Team game - opponents are players not on your team
    return allPlayers.filter(p => p.team !== player.team);
  } else {
    // Non-team game - opponents are all other players
    return allPlayers.filter(p => p.id !== playerId);
  }
}

/**
 * Rule 103: Starting the Game
 */

/**
 * Rule 103.1 - Determine starting player
 */
export interface StartingPlayerDetermination {
  readonly method: 'random' | 'agreement' | 'effect';
  readonly startingPlayer: ControllerID;
}

/**
 * Rule 103.2 - Additional pre-game steps
 */
export interface PreGameStep {
  readonly type: 'sideboard' | 'companion' | 'commander' | 'stickers' | 'conspiracy';
  readonly completed: boolean;
}

/**
 * Rule 103.3 - Shuffle and create libraries
 */
export function shuffleDeck(deckCards: readonly string[]): string[] {
  // In actual implementation, would randomize order
  return [...deckCards];
}

/**
 * Rule 103.4 - Starting life total
 */
export enum StartingLifeTotal {
  STANDARD = 20,
  TWO_HEADED_GIANT = 30,
  COMMANDER = 40,
  BRAWL_TWO_PLAYER = 25,
  BRAWL_MULTIPLAYER = 30,
  ARCHENEMY = 40
}

/**
 * Rule 103.5 - Mulligan process
 */
export interface MulliganState {
  readonly playerId: ControllerID;
  readonly mulligansTaken: number;
  readonly currentHandSize: number;
  readonly hasKeptHand: boolean;
}

/**
 * Take a mulligan
 */
export function takeMulligan(
  state: MulliganState,
  startingHandSize: number
): MulliganState {
  return {
    ...state,
    mulligansTaken: state.mulligansTaken + 1,
    currentHandSize: startingHandSize,
    hasKeptHand: false
  };
}

/**
 * Keep current hand
 */
export function keepHand(
  state: MulliganState,
  mulligansTaken: number
): MulliganState {
  return {
    ...state,
    hasKeptHand: true,
    currentHandSize: state.currentHandSize - mulligansTaken
  };
}

/**
 * Rule 103.5c - Free mulligan in multiplayer
 */
export function isFreeMulligan(
  mulligansTaken: number,
  isMultiplayer: boolean
): boolean {
  return isMultiplayer && mulligansTaken === 0;
}

/**
 * Rule 103.6 - Opening hand actions
 */
export interface OpeningHandAction {
  readonly cardId: string;
  readonly actionType: 'reveal' | 'put_onto_battlefield' | 'other';
  readonly playerId: ControllerID;
}

/**
 * Rule 103.8 - First turn
 */
export interface FirstTurnRules {
  readonly startingPlayerSkipsDrawStep: boolean;  // Rule 103.8a - Two-player
  readonly twoHeadedGiantSkipsDrawStep: boolean;  // Rule 103.8b
  readonly multiplayerSkipsDrawStep: boolean;     // Rule 103.8c - false
}

export function getFirstTurnRules(
  playerCount: number,
  isTwoHeadedGiant: boolean
): FirstTurnRules {
  if (isTwoHeadedGiant) {
    return {
      startingPlayerSkipsDrawStep: true,
      twoHeadedGiantSkipsDrawStep: true,
      multiplayerSkipsDrawStep: false
    };
  }
  
  if (playerCount === 2) {
    return {
      startingPlayerSkipsDrawStep: true,
      twoHeadedGiantSkipsDrawStep: false,
      multiplayerSkipsDrawStep: false
    };
  }
  
  // Multiplayer (not 2HG)
  return {
    startingPlayerSkipsDrawStep: false,
    twoHeadedGiantSkipsDrawStep: false,
    multiplayerSkipsDrawStep: false
  };
}

/**
 * Rule 104: Ending the Game
 */

/**
 * Rule 104.1 - Game ends when player wins, draw, or restart
 */
export enum GameEndReason {
  PLAYER_WIN = 'player_win',
  TEAM_WIN = 'team_win',
  DRAW = 'draw',
  RESTART = 'restart'
}

/**
 * Rule 104.2 - Ways to win
 */
export enum WinCondition {
  OPPONENTS_LEFT = 'opponents_left',        // Rule 104.2a
  EFFECT_STATES_WIN = 'effect_states_win',  // Rule 104.2b
  TEAM_WIN = 'team_win',                     // Rule 104.2c
  EMPEROR_WIN = 'emperor_win'                // Rule 104.2d
}

/**
 * Rule 104.3 - Ways to lose
 */
export enum LoseCondition {
  CONCEDE = 'concede',                    // Rule 104.3a
  ZERO_LIFE = 'zero_life',                // Rule 104.3b - State-based action
  LIBRARY_EMPTY = 'library_empty',        // Rule 104.3c - State-based action
  POISON_COUNTERS = 'poison_counters',    // Rule 104.3d - 10 or more
  EFFECT_STATES_LOSE = 'effect_states_lose', // Rule 104.3e
  WIN_AND_LOSE = 'win_and_lose',          // Rule 104.3f - Lose takes precedence
  TEAM_LOST = 'team_lost',                // Rule 104.3g
  COMMANDER_DAMAGE = 'commander_damage',  // Rule 104.3j - 21+ combat damage
  TOURNAMENT_PENALTY = 'tournament_penalty' // Rule 104.3k
}

/**
 * Check if player has lost due to state-based actions
 */
export interface PlayerLossCheck {
  readonly playerId: ControllerID;
  readonly lifeTotal: number;
  readonly poisonCounters: number;
  readonly librarySize: number;
  readonly commanderDamage?: Map<string, number>;  // Commander ID -> damage dealt
}

/**
 * Rule 104.3b - Zero or less life (state-based action that causes loss)
 * This is the game-ending check
 */
export function checkLifeTotalLoss(lifeTotal: number): boolean {
  return lifeTotal <= 0;
}

/**
 * Rule 104.3c - Cannot draw from empty library
 */
export function hasLostDueToEmptyLibrary(
  librarySize: number,
  cardsTriedToDraw: number
): boolean {
  return cardsTriedToDraw > librarySize;
}

/**
 * Rule 104.3d - Ten or more poison counters
 */
export function hasLostDueToPoison(poisonCounters: number): boolean {
  return poisonCounters >= 10;
}

/**
 * Rule 104.3j - Commander damage (21 or more from same commander)
 */
export function hasLostDueToCommanderDamage(
  commanderDamage: Map<string, number>
): boolean {
  const values = Array.from(commanderDamage.values());
  for (const damage of values) {
    if (damage >= 21) {
      return true;
    }
  }
  return false;
}

/**
 * Check all state-based loss conditions
 */
export function checkPlayerLoss(check: PlayerLossCheck): LoseCondition | null {
  if (checkLifeTotalLoss(check.lifeTotal)) {
    return LoseCondition.ZERO_LIFE;
  }
  
  if (hasLostDueToPoison(check.poisonCounters)) {
    return LoseCondition.POISON_COUNTERS;
  }
  
  if (check.commanderDamage && hasLostDueToCommanderDamage(check.commanderDamage)) {
    return LoseCondition.COMMANDER_DAMAGE;
  }
  
  return null;
}

/**
 * Rule 104.3f - Win and lose simultaneously means lose
 */
export function resolveSimultaneousWinLose(
  wouldWin: boolean,
  wouldLose: boolean
): 'win' | 'lose' | 'continue' {
  if (wouldLose) {
    return 'lose'; // Losing takes precedence
  }
  if (wouldWin) {
    return 'win';
  }
  return 'continue';
}

/**
 * Rule 104.4 - Ways for game to be a draw
 */
export enum DrawCondition {
  ALL_LOSE = 'all_lose',              // Rule 104.4a
  MANDATORY_LOOP = 'mandatory_loop',  // Rule 104.4b
  EFFECT_STATES_DRAW = 'effect_states_draw' // Rule 104.4c
}

/**
 * Rule 104.4a - All players lose simultaneously
 */
export function checkSimultaneousLoss(
  players: readonly Player[],
  lostPlayers: Set<ControllerID>
): boolean {
  const remainingPlayers = players.filter(p => !lostPlayers.has(p.id));
  return remainingPlayers.length === 0;
}

/**
 * Game result
 */
export interface GameResult {
  readonly endReason: GameEndReason;
  readonly winners?: readonly ControllerID[];
  readonly losers?: readonly ControllerID[];
  readonly isDraw: boolean;
}
