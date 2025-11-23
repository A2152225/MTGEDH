// Abilities implementation (rule 602 and 603)
import type { GameState, PlayerID } from '../../shared/src';
import { GamePhase } from '../../shared/src';
import type {
  ActivatedAbility,
  TriggeredAbility,
  TriggerCondition,
  ActivationRestriction
} from './types/abilities';
import type { PendingTriggeredAbility } from './types/stack';
import { canPayCost } from './costs';

export interface AbilityResult<T> {
  readonly next: T;
  readonly success: boolean;
  readonly log?: readonly string[];
}

/**
 * Check if an activated ability can be activated (rule 602.5)
 */
export function canActivateAbility(
  state: Readonly<GameState>,
  ability: ActivatedAbility,
  playerId: PlayerID
): boolean {
  // Rule 602.5: A player can't begin to activate an ability that's prohibited
  
  // Check timing restrictions (rule 602.5d, 602.5e)
  if (ability.timingRestriction === 'sorcery') {
    // Must follow sorcery timing: own main phase, stack empty, have priority
    if (!isMainPhase(state) || !isStackEmpty(state) || state.turnPlayer !== playerId) {
      return false;
    }
  }

  // Check if player has priority (rule 117.1b)
  if (state.priority !== playerId) {
    return false;
  }

  // Check activation restrictions
  if (ability.activationRestrictions) {
    for (const restriction of ability.activationRestrictions) {
      if (!checkActivationRestriction(state, restriction, ability.id)) {
        return false;
      }
    }
  }

  // Check if cost can be paid (rule 118.3)
  if (!canPayCost(state, playerId, ability.cost)) {
    return false;
  }

  return true;
}

/**
 * Check if a specific activation restriction is satisfied
 */
function checkActivationRestriction(
  state: Readonly<GameState>,
  restriction: ActivationRestriction,
  abilityId: string
): boolean {
  switch (restriction.type) {
    case 'once-per-turn':
      // Would need to track activations this turn
      return true; // Placeholder
    
    case 'X-times-per-turn':
      // Would need to track number of activations
      return true; // Placeholder
    
    case 'only-during-phase':
      return state.phase === restriction.phase;
    
    case 'only-during-step':
      return state.step === restriction.step;
    
    default:
      return true;
  }
}

/**
 * Activate an activated ability (rule 602.2)
 * Puts it on the stack and pays costs
 */
export function activateAbility(
  state: Readonly<GameState>,
  ability: ActivatedAbility,
  playerId: PlayerID,
  targets: readonly string[] = []
): AbilityResult<GameState> {
  if (!canActivateAbility(state, ability, playerId)) {
    return {
      next: state,
      success: false,
      log: ['Cannot activate ability - conditions not met']
    };
  }

  // Rule 602.2a: The ability is created on the stack
  const stackItem = {
    id: `ability-${ability.id}-${Date.now()}`,
    type: 'ability' as const,
    controller: playerId,
    targets
  };

  const newStack = [...state.stack, stackItem];

  return {
    next: {
      ...state,
      stack: newStack
    },
    success: true,
    log: [`${playerId} activated ability ${ability.id}`]
  };
}

/**
 * Check if a triggered ability should trigger (rule 603.2)
 */
export function checkTrigger(
  state: Readonly<GameState>,
  ability: TriggeredAbility,
  event: any
): boolean {
  // Check if the trigger condition matches the event
  if (!matchesTriggerCondition(ability.triggerCondition, event)) {
    return false;
  }

  // Check intervening 'if' clause (rule 603.4)
  if (ability.interveningIf) {
    if (!checkCondition(state, ability.interveningIf)) {
      return false;
    }
  }

  return true;
}

/**
 * Check if a trigger condition matches an event
 */
function matchesTriggerCondition(
  condition: TriggerCondition,
  event: any
): boolean {
  switch (condition.type) {
    case 'enters-battlefield':
      return event.type === 'enter-battlefield' &&
             (!condition.filter || matchesFilter(event.permanent, condition.filter));
    
    case 'leaves-battlefield':
      return event.type === 'leave-battlefield' &&
             (!condition.filter || matchesFilter(event.permanent, condition.filter));
    
    case 'becomes-tapped':
      return event.type === 'tap' &&
             (!condition.filter || matchesFilter(event.permanent, condition.filter));
    
    case 'phase-begin':
      return event.type === 'phase-begin' && event.phase === condition.phase;
    
    case 'step-begin':
      return event.type === 'step-begin' && event.step === condition.step;
    
    case 'cast-spell':
      return event.type === 'cast-spell' &&
             (!condition.filter || matchesFilter(event.spell, condition.filter));
    
    case 'dies':
      return event.type === 'dies' &&
             (!condition.filter || matchesFilter(event.creature, condition.filter));
    
    default:
      return false;
  }
}

/**
 * Check if an object matches a filter
 * TODO: Implement proper object filtering based on types, subtypes, colors, controller, etc.
 * This is currently a placeholder that always returns true - UNSAFE for production
 */
function matchesFilter(object: any, filter: any): boolean {
  // Simplified filter matching
  return true; // Placeholder - REQUIRES IMPLEMENTATION
}

/**
 * Check if a condition is true
 * TODO: Implement condition evaluation for life totals, permanents controlled, etc.
 * This is currently a placeholder that always returns true - UNSAFE for production
 */
function checkCondition(state: Readonly<GameState>, condition: any): boolean {
  // Simplified condition checking
  return true; // Placeholder - REQUIRES IMPLEMENTATION
}

/**
 * Trigger a triggered ability (rule 603.2)
 * Creates a pending triggered ability that will be put on stack when player gets priority
 */
export function triggerAbility(
  state: Readonly<GameState>,
  ability: TriggeredAbility,
  controller: PlayerID,
  sourceId: string
): PendingTriggeredAbility {
  return {
    id: `triggered-${ability.id}-${Date.now()}`,
    ability,
    controller,
    sourceId,
    triggeredAt: Date.now()
  };
}

/**
 * Put triggered abilities on the stack (rule 603.3)
 * This happens when a player would receive priority
 */
export function putTriggeredAbilitiesOnStack(
  state: Readonly<GameState>,
  pending: readonly PendingTriggeredAbility[]
): AbilityResult<GameState> {
  if (pending.length === 0) {
    return {
      next: state,
      success: true
    };
  }

  // Rule 603.3b: Abilities are placed on stack in APNAP order
  const sorted = sortByAPNAP(pending, state);

  const newStack = [...state.stack];
  const logs: string[] = [];

  for (const triggered of sorted) {
    newStack.push({
      id: triggered.id,
      type: 'ability',
      controller: triggered.controller,
      targets: []
    });
    logs.push(`${triggered.controller}'s triggered ability from ${triggered.sourceId} put on stack`);
  }

  return {
    next: {
      ...state,
      stack: newStack
    },
    success: true,
    log: logs
  };
}

/**
 * Sort pending abilities by APNAP order (rule 603.3b)
 */
function sortByAPNAP(
  abilities: readonly PendingTriggeredAbility[],
  state: Readonly<GameState>
): readonly PendingTriggeredAbility[] {
  const activePlayer = state.turnPlayer;
  const playerOrder = state.players.map(p => p.id);

  return [...abilities].sort((a, b) => {
    const aIndex = playerOrder.indexOf(a.controller);
    const bIndex = playerOrder.indexOf(b.controller);
    
    // Active player first
    if (a.controller === activePlayer && b.controller !== activePlayer) return -1;
    if (b.controller === activePlayer && a.controller !== activePlayer) return 1;
    
    // Then by turn order
    return aIndex - bIndex;
  });
}

// Helper functions

function isMainPhase(state: Readonly<GameState>): boolean {
  return state.phase === GamePhase.FIRSTMAIN;
}

function isStackEmpty(state: Readonly<GameState>): boolean {
  return state.stack.length === 0;
}
