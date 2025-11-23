/**
 * Rule 117: Timing and Priority
 * System that determines which player can take actions
 */

import { ControllerID } from './objects';

/**
 * Rule 117.1 - Priority determines which player can take actions
 * Player with priority may cast spells, activate abilities, take special actions
 */
export interface PriorityState {
  readonly currentPlayer: ControllerID;
  readonly hasPassedInSuccession: Map<ControllerID, boolean>;
  readonly turnOrder: readonly ControllerID[];
}

/**
 * Rule 117.1a - Instant spells can be cast any time with priority
 * Noninstant spells only during main phase with priority and empty stack
 */
export enum SpellTiming {
  INSTANT = 'instant',      // Can cast with priority
  SORCERY = 'sorcery'       // Only main phase, own turn, empty stack
}

/**
 * Check if player can cast spell based on timing
 */
export interface CastingConstraints {
  readonly hasPriority: boolean;
  readonly isMainPhase: boolean;
  readonly isOwnTurn: boolean;
  readonly isStackEmpty: boolean;
}

/**
 * Rule 117.1a - Instant timing check
 */
export function canCastInstant(constraints: CastingConstraints): boolean {
  return constraints.hasPriority;
}

/**
 * Rule 117.1a - Sorcery timing check
 */
export function canCastSorcery(constraints: CastingConstraints): boolean {
  return constraints.hasPriority &&
         constraints.isMainPhase &&
         constraints.isOwnTurn &&
         constraints.isStackEmpty;
}

/**
 * Rule 117.1b - Activated abilities can be activated any time with priority
 */
export function canActivateAbility(constraints: CastingConstraints): boolean {
  return constraints.hasPriority;
}

/**
 * Rule 117.1d - Mana abilities can be activated:
 * - When have priority
 * - When casting spell/activating ability that requires mana
 * - When rule/effect asks for mana payment
 */
export enum ManaAbilityTiming {
  WITH_PRIORITY = 'with_priority',
  DURING_PAYMENT = 'during_payment',
  WHEN_REQUESTED = 'when_requested'
}

/**
 * Rule 117.2 - Other abilities/actions don't require priority
 */
export enum AutomaticAction {
  TRIGGERED_ABILITY = 'triggered_ability',     // 117.2a
  STATIC_ABILITY = 'static_ability',           // 117.2b
  TURN_BASED_ACTION = 'turn_based_action',     // 117.2c
  STATE_BASED_ACTION = 'state_based_action',   // 117.2d
  RESOLVING_SPELL = 'resolving_spell'          // 117.2e
}

/**
 * Rule 117.3 - Which player has priority
 */

/**
 * Rule 117.3a - Active player receives priority at beginning of most steps/phases
 * After turn-based actions and triggered abilities are put on stack
 * No priority during untap step or usually cleanup step
 */
export interface PriorityWindow {
  readonly step: string;
  readonly phase: string;
  readonly grantsPriority: boolean;
  readonly toActivePlayer: boolean;
}

/**
 * Rule 117.3b - Active player receives priority after spell/ability resolves
 */
export function getPlayerAfterResolution(activePlayer: ControllerID): ControllerID {
  return activePlayer;
}

/**
 * Rule 117.3c - Player receives priority after casting spell, activating ability,
 * or taking special action
 */
export function getPlayerAfterAction(actingPlayer: ControllerID): ControllerID {
  return actingPlayer;
}

/**
 * Rule 117.3d - Passing priority
 * If player passes, announce mana in pool, then next player in turn order gets priority
 */
export interface PriorityPass {
  readonly passingPlayer: ControllerID;
  readonly manaInPool: boolean;
  readonly nextPlayer: ControllerID;
}

/**
 * Get next player in turn order
 */
export function getNextPlayerInTurnOrder(
  currentPlayer: ControllerID,
  turnOrder: readonly ControllerID[]
): ControllerID {
  const currentIndex = turnOrder.indexOf(currentPlayer);
  if (currentIndex === -1) {
    throw new Error('Current player not in turn order');
  }
  
  const nextIndex = (currentIndex + 1) % turnOrder.length;
  return turnOrder[nextIndex];
}

/**
 * Rule 117.4 - If all players pass in succession
 * Top of stack resolves, or if stack empty, phase/step ends
 */
export function allPlayersPassedInSuccession(
  passedMap: ReadonlyMap<ControllerID, boolean>,
  turnOrder: readonly ControllerID[]
): boolean {
  return turnOrder.every(playerId => passedMap.get(playerId) === true);
}

/**
 * Action when all players pass
 */
export enum AllPassAction {
  RESOLVE_TOP_OF_STACK = 'resolve_top_of_stack',
  END_PHASE_OR_STEP = 'end_phase_or_step'
}

/**
 * Rule 117.5 - Priority granting process
 * 1. Perform state-based actions (repeat until none performed)
 * 2. Put triggered abilities on stack (repeat from step 1 if any triggered)
 * 3. Grant priority to appropriate player
 */
export interface PriorityGrantSequence {
  readonly performStateBasedActions: boolean;
  readonly putTriggeredAbilitiesOnStack: boolean;
  readonly repeatUntilNone: boolean;
  readonly thenGrantPriority: boolean;
}

/**
 * Rule 117.7 - Casting/activating in response
 * New spell/ability resolves first
 */
export function isInResponseTo(
  newSpellId: string,
  existingSpellId: string,
  stackOrder: readonly string[]
): boolean {
  const newIndex = stackOrder.indexOf(newSpellId);
  const existingIndex = stackOrder.indexOf(existingSpellId);
  
  // New spell should be later in stack (higher index) to resolve first
  return newIndex > existingIndex;
}

/**
 * Priority action types
 */
export enum PriorityAction {
  CAST_SPELL = 'cast_spell',
  ACTIVATE_ABILITY = 'activate_ability',
  SPECIAL_ACTION = 'special_action',
  PASS = 'pass'
}

/**
 * Priority system state
 */
export interface PrioritySystem {
  readonly currentPriorityPlayer: ControllerID;
  readonly turnOrder: readonly ControllerID[];
  readonly activePlayer: ControllerID;
  readonly passedInSuccession: ReadonlyMap<ControllerID, boolean>;
  readonly stackIsEmpty: boolean;
}

/**
 * Pass priority and get next player
 */
export function passPriority(
  system: Readonly<PrioritySystem>
): PrioritySystem {
  const nextPlayer = getNextPlayerInTurnOrder(
    system.currentPriorityPlayer,
    system.turnOrder
  );
  
  const newPassedMap = new Map(system.passedInSuccession);
  newPassedMap.set(system.currentPriorityPlayer, true);
  
  return {
    ...system,
    currentPriorityPlayer: nextPlayer,
    passedInSuccession: newPassedMap
  };
}

/**
 * Grant priority after action (resets passed-in-succession)
 */
export function grantPriorityAfterAction(
  system: Readonly<PrioritySystem>,
  actingPlayer: ControllerID
): PrioritySystem {
  return {
    ...system,
    currentPriorityPlayer: actingPlayer,
    passedInSuccession: new Map() // Reset all passes
  };
}
