/**
 * Rule 116: Special Actions
 * Actions players can take when they have priority that don't use the stack
 */

import { ObjectID, ControllerID, Zone } from './objects';

/**
 * Rule 116.1 - Special actions don't use the stack
 * Not to be confused with turn-based actions or state-based actions
 */
export enum SpecialActionType {
  // Rule 116.2a - Playing a land
  PLAY_LAND = 'play_land',
  
  // Rule 116.2b - Turning face-down creature face up
  TURN_FACE_UP = 'turn_face_up',
  
  // Rule 116.2c - Action to end continuous effect or stop delayed trigger
  END_EFFECT = 'end_effect',
  
  // Rule 116.2d - Action to ignore static ability effect
  IGNORE_STATIC_EFFECT = 'ignore_static_effect',
  
  // Rule 116.2e - Discard at instant speed (Circling Vultures)
  INSTANT_DISCARD = 'instant_discard',
  
  // Rule 116.2f - Suspend a card
  SUSPEND = 'suspend',
  
  // Rule 116.2g - Put companion into hand
  COMPANION_TO_HAND = 'companion_to_hand',
  
  // Rule 116.2h - Foretell a card
  FORETELL = 'foretell',
  
  // Rule 116.2i - Roll planar die (Planechase)
  ROLL_PLANAR_DIE = 'roll_planar_die',
  
  // Rule 116.2j - Turn conspiracy face up
  TURN_CONSPIRACY_FACE_UP = 'turn_conspiracy_face_up',
  
  // Rule 116.2k - Plot a card
  PLOT = 'plot',
  
  // Rule 116.2m - Pay unlock cost
  PAY_UNLOCK_COST = 'pay_unlock_cost'
}

/**
 * Base interface for all special actions
 */
export interface SpecialAction {
  readonly type: SpecialActionType;
  readonly playerId: ControllerID;
  readonly requiresPriority: boolean;  // All special actions require priority
}

/**
 * Rule 116.2a - Playing a land
 * Can only be taken once per turn during main phase with stack empty
 */
export interface PlayLandAction extends SpecialAction {
  readonly type: SpecialActionType.PLAY_LAND;
  readonly cardId: ObjectID;
  readonly requiresMainPhase: boolean;  // Must be main phase
  readonly requiresEmptyStack: boolean;  // Stack must be empty
  readonly requiresOwnTurn: boolean;    // Must be player's turn
  readonly landsPlayedThisTurn: number;
  readonly maxLandsPerTurn: number;     // Usually 1
}

/**
 * Rule 116.2b - Turning face-down creature face up
 * Can be taken any time player has priority
 */
export interface TurnFaceUpAction extends SpecialAction {
  readonly type: SpecialActionType.TURN_FACE_UP;
  readonly permanentId: ObjectID;
  readonly cost?: string;  // Morph cost or similar
}

/**
 * Rule 116.2f - Suspend
 * Can exile card with suspend if could begin to cast it
 */
export interface SuspendAction extends SpecialAction {
  readonly type: SpecialActionType.SUSPEND;
  readonly cardId: ObjectID;
  readonly suspendCost: string;
  readonly timeCounters: number;
}

/**
 * Rule 116.2g - Companion
 * Pay {3} to put companion from outside game into hand
 * Only during main phase with empty stack, once per game
 */
export interface CompanionAction extends SpecialAction {
  readonly type: SpecialActionType.COMPANION_TO_HAND;
  readonly companionId: ObjectID;
  readonly requiresMainPhase: boolean;
  readonly requiresEmptyStack: boolean;
  readonly requiresOwnTurn: boolean;
  readonly alreadyUsedThisGame: boolean;
}

/**
 * Rule 116.2h - Foretell
 * Pay {2} and exile card face down during own turn
 */
export interface ForetellAction extends SpecialAction {
  readonly type: SpecialActionType.FORETELL;
  readonly cardId: ObjectID;
  readonly cost: string;  // Usually {2}
  readonly requiresOwnTurn: boolean;
}

/**
 * Rule 116.2k - Plot
 * Exile card during own turn with empty stack
 */
export interface PlotAction extends SpecialAction {
  readonly type: SpecialActionType.PLOT;
  readonly cardId: ObjectID;
  readonly requiresOwnTurn: boolean;
  readonly requiresEmptyStack: boolean;
}

/**
 * Rule 116.2i - Roll planar die
 * Costs mana equal to times previously rolled this turn
 */
export interface RollPlanarDieAction extends SpecialAction {
  readonly type: SpecialActionType.ROLL_PLANAR_DIE;
  readonly requiresMainPhase: boolean;
  readonly requiresEmptyStack: boolean;
  readonly requiresOwnTurn: boolean;
  readonly timesRolledThisTurn: number;
  readonly cost: number;  // Generic mana cost
}

/**
 * Rule 116.3 - Player receives priority after taking special action
 */
export function playerReceivesPriorityAfterSpecialAction(): boolean {
  return true;
}

/**
 * Check if a special action can be taken
 */
export interface SpecialActionConstraints {
  readonly hasPriority: boolean;
  readonly isMainPhase: boolean;
  readonly isStackEmpty: boolean;
  readonly isOwnTurn: boolean;
}

/**
 * Validate if special action can be taken based on type
 */
export function canTakeSpecialAction(
  action: SpecialAction,
  constraints: SpecialActionConstraints
): boolean {
  // All special actions require priority
  if (!constraints.hasPriority) {
    return false;
  }
  
  switch (action.type) {
    case SpecialActionType.PLAY_LAND:
      const playLand = action as PlayLandAction;
      return constraints.isMainPhase &&
             constraints.isStackEmpty &&
             constraints.isOwnTurn &&
             playLand.landsPlayedThisTurn < playLand.maxLandsPerTurn;
    
    case SpecialActionType.TURN_FACE_UP:
      // Can be taken any time with priority
      return true;
    
    case SpecialActionType.SUSPEND:
      // Can be taken if could begin to cast the card
      return true; // Would need additional casting checks
    
    case SpecialActionType.COMPANION_TO_HAND:
      const companion = action as CompanionAction;
      return constraints.isMainPhase &&
             constraints.isStackEmpty &&
             constraints.isOwnTurn &&
             !companion.alreadyUsedThisGame;
    
    case SpecialActionType.FORETELL:
      const foretell = action as ForetellAction;
      return constraints.isOwnTurn && foretell.requiresOwnTurn;
    
    case SpecialActionType.PLOT:
      const plot = action as PlotAction;
      return constraints.isOwnTurn &&
             constraints.isStackEmpty &&
             plot.requiresOwnTurn &&
             plot.requiresEmptyStack;
    
    case SpecialActionType.ROLL_PLANAR_DIE:
      const roll = action as RollPlanarDieAction;
      return constraints.isMainPhase &&
             constraints.isStackEmpty &&
             constraints.isOwnTurn;
    
    default:
      return false;
  }
}

/**
 * Special action result
 */
export interface SpecialActionResult {
  readonly success: boolean;
  readonly newPriorityPlayer?: ControllerID;  // Rule 116.3
  readonly error?: string;
}
