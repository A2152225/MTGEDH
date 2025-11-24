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
