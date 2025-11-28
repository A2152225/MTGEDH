/**
 * Rule 405: Stack
 * 
 * The stack is a zone where spells and abilities wait to resolve.
 * It operates on a last-in-first-out (LIFO) basis.
 * 
 * Based on MagicCompRules 20251114.txt
 */

import type { StackObject } from './spellCasting';

/**
 * Rule 405.1: The stack is a zone
 * Spells and abilities on the stack are objects
 */
export interface Stack {
  readonly objects: readonly StackObject[];
}

/**
 * Represents a group of simultaneous triggers that need ordering
 * Rule 603.3b: If multiple triggered abilities controlled by the same player
 * trigger at the same time, that player chooses the order they go on the stack.
 */
export interface SimultaneousTriggerGroup {
  readonly controllerId: string;
  readonly triggers: readonly StackObject[];
  readonly requiresOrdering: boolean;
}

/**
 * Result of checking for simultaneous triggers that need ordering
 */
export interface SimultaneousTriggerCheck {
  /** Groups of triggers by controller that need ordering */
  readonly groups: readonly SimultaneousTriggerGroup[];
  /** Whether any player needs to choose trigger order */
  readonly requiresPlayerChoice: boolean;
}

/**
 * Create an empty stack
 */
export function createEmptyStack(): Stack {
  return { objects: [] };
}

/**
 * Rule 405.2: When spell is cast or ability activated, it goes on stack
 */
export function pushToStack(
  stack: Readonly<Stack>,
  object: StackObject
): { stack: Stack; log: string[] } {
  return {
    stack: {
      objects: [...stack.objects, object],
    },
    log: [`Added ${object.cardName} to stack (position ${stack.objects.length + 1})`],
  };
}

/**
 * Rule 405.3: When spell or ability resolves, it's removed from stack
 * Last-in-first-out (LIFO)
 */
export function popFromStack(
  stack: Readonly<Stack>
): { stack: Stack; object?: StackObject; log: string[] } {
  if (stack.objects.length === 0) {
    return {
      stack,
      log: ['Stack is empty'],
    };
  }
  
  const objects = [...stack.objects];
  const object = objects.pop()!;
  
  return {
    stack: { objects },
    object,
    log: [`Resolving ${object.cardName} from stack`],
  };
}

/**
 * Get the top object on the stack without removing it
 */
export function peekStack(stack: Readonly<Stack>): StackObject | undefined {
  return stack.objects[stack.objects.length - 1];
}

/**
 * Check if stack is empty
 */
export function isStackEmpty(stack: Readonly<Stack>): boolean {
  return stack.objects.length === 0;
}

/**
 * Rule 608: Resolving Spells and Abilities
 */
export interface ResolutionResult {
  readonly success: boolean;
  readonly countered: boolean;
  readonly destination?: 'graveyard' | 'battlefield' | 'exile' | 'hand';
  readonly effects?: readonly string[];
  readonly log?: readonly string[];
}

/**
 * Rule 608.2b: Check if all targets are still legal
 */
export function validateTargets(
  object: StackObject,
  legalTargets: readonly string[]
): { valid: boolean; reason?: string } {
  if (!object.targets || object.targets.length === 0) {
    return { valid: true };
  }
  
  // Check if all targets are still legal
  const illegalTargets = object.targets.filter(t => !legalTargets.includes(t));
  
  if (illegalTargets.length === object.targets.length) {
    // All targets are illegal - spell/ability is countered
    return {
      valid: false,
      reason: 'All targets are illegal',
    };
  }
  
  return { valid: true };
}

/**
 * Rule 608.2: Resolution process
 */
export function resolveStackObject(
  object: StackObject,
  legalTargets: readonly string[]
): ResolutionResult {
  const logs: string[] = [];
  
  // Check target validity
  const targetValidation = validateTargets(object, legalTargets);
  
  if (!targetValidation.valid) {
    logs.push(`${object.cardName} countered - ${targetValidation.reason}`);
    return {
      success: false,
      countered: true,
      destination: 'graveyard',
      log: logs,
    };
  }
  
  logs.push(`${object.cardName} resolves`);
  
  // Determine destination based on object type
  let destination: ResolutionResult['destination'] = 'graveyard';
  
  if (object.type === 'ability') {
    // Abilities cease to exist
    destination = undefined;
  }
  
  return {
    success: true,
    countered: false,
    destination,
    log: logs,
  };
}

/**
 * Counter a spell or ability on the stack
 * Rule 701.5: Counter
 */
export function counterStackObject(
  stack: Readonly<Stack>,
  objectId: string
): { stack: Stack; countered: boolean; log: string[] } {
  const objectIndex = stack.objects.findIndex(o => o.id === objectId);
  
  if (objectIndex === -1) {
    return {
      stack,
      countered: false,
      log: ['Object not found on stack'],
    };
  }
  
  const objects = [...stack.objects];
  const [removed] = objects.splice(objectIndex, 1);
  
  return {
    stack: { objects },
    countered: true,
    log: [`${removed.cardName} countered`],
  };
}

/**
 * Get stack size
 */
export function getStackSize(stack: Readonly<Stack>): number {
  return stack.objects.length;
}

/**
 * Find objects on stack by controller
 */
export function getStackObjectsByController(
  stack: Readonly<Stack>,
  controllerId: string
): readonly StackObject[] {
  return stack.objects.filter(o => o.controllerId === controllerId);
}

/**
 * Check if a specific spell is on the stack
 */
export function isSpellOnStack(
  stack: Readonly<Stack>,
  spellId: string
): boolean {
  return stack.objects.some(o => o.spellId === spellId);
}

/**
 * Rule 603.3b: Group simultaneous triggers by controller
 * When multiple triggered abilities controlled by the same player would go on the stack,
 * that player chooses the order they are put on the stack.
 * 
 * @param triggers - Array of triggered abilities that triggered simultaneously
 * @returns Groups of triggers by controller, indicating which need ordering
 */
export function groupSimultaneousTriggers(
  triggers: readonly StackObject[]
): SimultaneousTriggerCheck {
  // Group triggers by controller
  const triggersByController = new Map<string, StackObject[]>();
  
  for (const trigger of triggers) {
    const controllerId = trigger.controllerId;
    if (!triggersByController.has(controllerId)) {
      triggersByController.set(controllerId, []);
    }
    triggersByController.get(controllerId)!.push(trigger);
  }
  
  // Create groups, marking which ones need ordering (more than 1 trigger)
  const groups: SimultaneousTriggerGroup[] = [];
  let requiresPlayerChoice = false;
  
  for (const [controllerId, controllerTriggers] of triggersByController) {
    const requiresOrdering = controllerTriggers.length > 1;
    if (requiresOrdering) {
      requiresPlayerChoice = true;
    }
    groups.push({
      controllerId,
      triggers: controllerTriggers,
      requiresOrdering,
    });
  }
  
  return {
    groups,
    requiresPlayerChoice,
  };
}

/**
 * Rule 603.3b: Apply player's chosen order for their simultaneous triggers
 * The triggers are put on the stack in the order chosen by the player,
 * with the last one in the chosen order being on top of the stack (resolving first).
 * 
 * @param triggers - The triggers to order
 * @param orderedIds - The IDs in the order the player wants them to resolve (first = resolves first = goes on stack last)
 * @returns The triggers in stack order (last element = top of stack = resolves first)
 */
export function applyTriggerOrder(
  triggers: readonly StackObject[],
  orderedIds: readonly string[]
): { orderedTriggers: readonly StackObject[]; log: string[] } {
  const logs: string[] = [];
  
  // Create a map for quick lookup
  const triggerMap = new Map(triggers.map(t => [t.id, t]));
  
  // Order triggers according to player's choice
  // The orderedIds represents resolution order (first = resolves first)
  // Stack is LIFO, so we need to reverse: last in orderedIds goes on stack first
  const orderedTriggers: StackObject[] = [];
  
  for (const id of orderedIds) {
    const trigger = triggerMap.get(id);
    if (trigger) {
      orderedTriggers.push(trigger);
      triggerMap.delete(id);
    }
  }
  
  // Add any triggers not in the ordered list (shouldn't happen in normal use)
  for (const trigger of triggerMap.values()) {
    orderedTriggers.push(trigger);
    logs.push(`Warning: Trigger ${trigger.id} was not in the ordered list`);
  }
  
  // Reverse so that the first in resolution order is last on stack (top)
  const stackOrder = orderedTriggers.reverse();
  
  logs.push(`Triggers ordered for stack: ${stackOrder.map(t => t.cardName).join(' -> ')}`);
  
  return {
    orderedTriggers: stackOrder,
    log: logs,
  };
}

/**
 * Rule 603.3b + APNAP: Put multiple simultaneous triggers on the stack
 * Active player puts their triggers on first (choosing order), then each other player in turn order.
 * 
 * @param stack - Current stack state
 * @param triggerGroups - Groups of triggers with player-chosen ordering applied
 * @param turnOrder - Array of player IDs in turn order, starting with active player
 * @returns Updated stack with triggers added in correct order
 */
export function pushSimultaneousTriggersToStack(
  stack: Readonly<Stack>,
  triggerGroups: readonly SimultaneousTriggerGroup[],
  turnOrder: readonly string[]
): { stack: Stack; log: string[] } {
  const logs: string[] = [];
  let currentStack = stack;
  
  // Sort groups by turn order (APNAP - Active Player, Non-Active Player)
  const sortedGroups = [...triggerGroups].sort((a, b) => {
    const aIndex = turnOrder.indexOf(a.controllerId);
    const bIndex = turnOrder.indexOf(b.controllerId);
    return aIndex - bIndex;
  });
  
  // Add triggers to stack in APNAP order
  // Active player's triggers go on first (bottom), so they resolve last
  for (const group of sortedGroups) {
    for (const trigger of group.triggers) {
      const result = pushToStack(currentStack, trigger);
      currentStack = result.stack;
      logs.push(...result.log);
    }
  }
  
  logs.push(`Added ${triggerGroups.reduce((sum, g) => sum + g.triggers.length, 0)} simultaneous triggers to stack in APNAP order`);
  
  return {
    stack: currentStack,
    log: logs,
  };
}

/**
 * Counter movement tracking for cards like Reyhan, Last of the Abzan
 * and Forgotten Ancient.
 */
export interface CounterMovement {
  readonly sourceId: string;
  readonly sourceName: string;
  readonly targetId: string;
  readonly targetName: string;
  readonly counterType: string;
  readonly count: number;
}

/**
 * Parse counter movement from oracle text
 * Handles patterns like:
 * - "you may put its counters on target creature" (Reyhan)
 * - "you may move any number of +1/+1 counters from ~ onto other creatures" (Forgotten Ancient)
 */
export function parseCounterMovementAbility(
  oracleText: string
): { canMoveCounters: boolean; counterType?: string; restriction?: string } {
  const text = oracleText.toLowerCase();
  
  // Reyhan pattern: "put its counters on target creature"
  if (text.includes('put its counters on') || text.includes('put those counters on')) {
    return {
      canMoveCounters: true,
      counterType: 'all', // Moves all counter types
    };
  }
  
  // Forgotten Ancient pattern: "move any number of +1/+1 counters"
  const moveMatch = text.match(/move (?:any number of )?([+\-\d\/]+) counters? from/i);
  if (moveMatch) {
    return {
      canMoveCounters: true,
      counterType: moveMatch[1],
    };
  }
  
  // Generic counter movement: "move a counter from"
  if (text.includes('move') && text.includes('counter') && text.includes('from')) {
    const counterTypeMatch = text.match(/move (?:a |an |one )?([+\-\d\/]+|\w+) counter/i);
    return {
      canMoveCounters: true,
      counterType: counterTypeMatch?.[1] || '+1/+1',
    };
  }
  
  return { canMoveCounters: false };
}
