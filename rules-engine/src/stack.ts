// Stack implementation following rule 405 and 608
import type { GameState, PlayerID } from '../../shared/src';
import type { StackObject, StackedSpell, StackedAbility } from './types/stack';

export interface StackResult<T> {
  readonly next: T;
  readonly log?: readonly string[];
}

/**
 * Push a spell onto the stack (rule 601.2a)
 * The spell becomes the topmost object on the stack
 */
export function pushSpell(
  state: Readonly<GameState>,
  spell: StackedSpell
): StackResult<GameState> {
  const newStack = [...state.stack, {
    id: spell.id,
    type: 'spell' as const,
    controller: spell.controller,
    card: { id: spell.cardId, name: 'Spell' } as any, // Simplified card reference
    targets: spell.targets as any,
  }];

  return {
    next: {
      ...state,
      stack: newStack as any
    },
    log: [`${spell.controller} cast spell ${spell.cardId}`]
  };
}

/**
 * Push an ability onto the stack (rule 602.2a for activated, rule 603.3 for triggered)
 * The ability becomes the topmost object on the stack
 */
export function pushAbility(
  state: Readonly<GameState>,
  ability: StackedAbility
): StackResult<GameState> {
  const newStack = [...state.stack, {
    id: ability.id,
    type: 'ability' as const,
    controller: ability.controller,
    targets: ability.targets as any,
  }];

  const abilityType = ability.ability.type === 'triggered' ? 'triggered ability' : 'activated ability';

  return {
    next: {
      ...state,
      stack: newStack as any
    },
    log: [`${ability.controller}'s ${abilityType} from ${ability.sourceId} was put on the stack`]
  };
}

/**
 * Remove the top object from the stack (when it resolves or is countered)
 * Rule 608.2m: After resolution or being countered, the spell/ability is removed from the stack
 */
export function popStack(
  state: Readonly<GameState>
): StackResult<GameState> {
  if (state.stack.length === 0) {
    return { next: state };
  }

  const newStack = state.stack.slice(0, -1);
  const popped = state.stack[state.stack.length - 1];

  return {
    next: {
      ...state,
      stack: newStack
    },
    log: [`Resolved/removed ${popped.type} ${popped.id} from stack`]
  };
}

/**
 * Get the top object on the stack (the one that will resolve next)
 * Rule 608.1: Objects resolve one at a time, starting with the one on top (LIFO)
 */
export function peekStack(state: Readonly<GameState>): StackObject | undefined {
  if (state.stack.length === 0) {
    return undefined;
  }
  return state.stack[state.stack.length - 1] as any;
}

/**
 * Check if the stack is empty
 * Important for timing restrictions (e.g., playing lands, activating loyalty abilities)
 */
export function isStackEmpty(state: Readonly<GameState>): boolean {
  return state.stack.length === 0;
}

/**
 * Counter a spell or ability on the stack (rule 701.5)
 * The object is removed from the stack without resolving
 */
export function counterStackObject(
  state: Readonly<GameState>,
  objectId: string
): StackResult<GameState> {
  const index = state.stack.findIndex(obj => obj.id === objectId);
  if (index === -1) {
    return { next: state, log: [`Cannot counter ${objectId} - not on stack`] };
  }

  const newStack = [
    ...state.stack.slice(0, index),
    ...state.stack.slice(index + 1)
  ];

  const countered = state.stack[index];

  return {
    next: {
      ...state,
      stack: newStack
    },
    log: [`Countered ${countered.type} ${countered.id}`]
  };
}

/**
 * Remove all objects from the stack (used in cleanup or special effects)
 */
export function clearStack(state: Readonly<GameState>): StackResult<GameState> {
  if (state.stack.length === 0) {
    return { next: state };
  }

  return {
    next: {
      ...state,
      stack: []
    },
    log: ['Cleared all objects from the stack']
  };
}

/**
 * Get all spells on the stack controlled by a specific player
 */
export function getPlayerSpells(
  state: Readonly<GameState>,
  playerId: PlayerID
): readonly StackObject[] {
  return state.stack.filter(obj => obj.type === 'spell' && obj.controller === playerId) as any;
}

/**
 * Get all abilities on the stack from a specific source
 */
export function getAbilitiesFromSource(
  state: Readonly<GameState>,
  sourceId: string
): readonly StackObject[] {
  return state.stack.filter(obj => obj.type === 'ability' && (obj as any).sourceId === sourceId) as any;
}
