# Keyword Actions Developer Guide

This guide explains the modular keyword actions architecture and how to add new keyword actions to the rules engine.

## Architecture Overview

Keyword actions are now organized in a modular structure located in `rules-engine/src/keywordActions/`. Each keyword action is implemented in its own file, making the codebase easier to maintain and extend.

### Directory Structure

```
rules-engine/src/
├── keywordActions/
│   ├── index.ts              # Main export file
│   ├── activate.ts           # Rule 701.2
│   ├── attach.ts             # Rule 701.3
│   ├── behold.ts             # Rule 701.4
│   ├── cast.ts               # Rule 701.5
│   ├── counter.ts            # Rule 701.6
│   ├── create.ts             # Rule 701.7
│   ├── destroy.ts            # Rule 701.8
│   ├── discard.ts            # Rule 701.9
│   ├── double.ts             # Rule 701.10
│   ├── triple.ts             # Rule 701.11
│   ├── exchange.ts           # Rule 701.12
│   ├── exile.ts              # Rule 701.13
│   ├── fight.ts              # Rule 701.14
│   ├── goad.ts               # Rule 701.15
│   ├── investigate.ts        # Rule 701.16
│   ├── mill.ts               # Rule 701.17
│   ├── play.ts               # Rule 701.18
│   ├── regenerate.ts         # Rule 701.19
│   ├── reveal.ts             # Rule 701.20
│   ├── sacrifice.ts          # Rule 701.21
│   ├── scry.ts               # Rule 701.22
│   ├── search.ts             # Rule 701.23
│   ├── shuffle.ts            # Rule 701.24
│   ├── surveil.ts            # Rule 701.25
│   └── tapUntap.ts           # Rule 701.26
├── types/
│   └── keywordActions.ts     # Re-exports for backward compatibility
└── stateBasedActions.ts      # Rule 704 implementation
```

## How to Add a New Keyword Action

Follow these steps to add a new keyword action to the rules engine:

### 1. Create the Module File

Create a new file in `rules-engine/src/keywordActions/` named after the keyword action (e.g., `transform.ts` for the Transform action).

**Template:**

```typescript
/**
 * Rule 701.X: [Action Name]
 * 
 * [Brief description from comprehensive rules]
 * 
 * Reference: Rule 701.X from MagicCompRules 20251114.txt
 */

export interface [ActionName]Action {
  readonly type: '[action-name]';
  // Add relevant properties based on the action
  readonly targetId: string;
  // ... other properties
}

/**
 * Rule 701.X.a: [Sub-rule description]
 * 
 * [Detailed description from comprehensive rules]
 */
export function [actionName](
  // Parameters based on what the action needs
  targetId: string,
  // ... other parameters
): [ActionName]Action {
  return {
    type: '[action-name]',
    targetId,
    // ... other properties
  };
}

// Add any helper functions or validation functions
export function can[ActionName](
  // Parameters for validation
): boolean {
  // Validation logic based on comprehensive rules
  return true;
}
```

### 2. Update the Index File

Add your new action to `rules-engine/src/keywordActions/index.ts`:

```typescript
// Add to the exports section
export * from './[actionName]';

// Add to the type imports
import type { [ActionName]Action } from './[actionName]';

// Add to the KeywordAction union type
export type KeywordAction =
  // ... existing actions
  | [ActionName]Action;
```

### 3. Create Tests

Create comprehensive tests in `rules-engine/test/keywordActions-partX.test.ts` (or create a new test file if needed):

```typescript
import { describe, it, expect } from 'vitest';
import {
  [actionName],
  can[ActionName],
  // ... other imports
} from '../src/keywordActions';

describe('Rule 701.X: [Action Name]', () => {
  it('should [test description] (Rule 701.X.a)', () => {
    const action = [actionName]('target1');
    
    expect(action.type).toBe('[action-name]');
    expect(action.targetId).toBe('target1');
  });
  
  it('should validate [condition] (Rule 701.X.b)', () => {
    expect(can[ActionName](validCondition)).toBe(true);
    expect(can[ActionName](invalidCondition)).toBe(false);
  });
  
  // Add more test cases covering all sub-rules
});
```

### 4. Reference the Comprehensive Rules

Always include rule references in your code:

- Use JSDoc comments with the rule number (e.g., `Rule 701.X.a`)
- Quote relevant text from `MagicCompRules 20251114.txt`
- Reference the specific section in the file

### 5. Run Tests

```bash
cd rules-engine
npm test
```

Ensure all tests pass, including the new ones you've created.

## Best Practices

### Naming Conventions

- **File names**: Use camelCase for multi-word actions (e.g., `tapUntap.ts`)
- **Interface names**: Use PascalCase with "Action" suffix (e.g., `TapUntapAction`)
- **Function names**: Use camelCase (e.g., `tapPermanent`, `canTap`)
- **Type field**: Use kebab-case (e.g., `'tap-untap'`)

### Code Organization

1. **Document thoroughly**: Every interface, function, and type should have JSDoc comments with rule references
2. **Keep it focused**: Each file should only contain the implementation for one keyword action
3. **Use TypeScript properly**: Make use of `readonly`, union types, and proper type annotations
4. **Handle edge cases**: Reference specific rules for edge cases and unusual interactions

### Rule References

Always structure your code to mirror the comprehensive rules:

```typescript
/**
 * Rule 701.X.a: Main action
 */
export function mainAction() { ... }

/**
 * Rule 701.X.b: Special case or restriction
 */
export function specialCase() { ... }

/**
 * Rule 701.X.c: Another aspect of the action
 */
export function anotherAspect() { ... }
```

### Testing

- Test the happy path (normal usage)
- Test edge cases mentioned in the comprehensive rules
- Test invalid inputs and restrictions
- Test interactions with other game rules (when applicable)

## Common Patterns

### Actions with Multiple Modes

```typescript
export interface MultiModeAction {
  readonly type: 'multi-mode';
  readonly mode: 'option-a' | 'option-b' | 'option-c';
  readonly targetId: string;
}

export function optionA(targetId: string): MultiModeAction {
  return { type: 'multi-mode', mode: 'option-a', targetId };
}

export function optionB(targetId: string): MultiModeAction {
  return { type: 'multi-mode', mode: 'option-b', targetId };
}
```

### Actions with Validation

```typescript
export function canPerformAction(
  object: { id: string; type: string },
  requirements: Requirements
): boolean {
  // Validate based on comprehensive rules
  if (!meetsRequirement1) return false;
  if (!meetsRequirement2) return false;
  return true;
}
```

### Actions with State Tracking

```typescript
export interface ActionState {
  readonly objectId: string;
  readonly active: boolean;
  readonly timestamp: number;
}

export function createState(objectId: string): ActionState {
  return {
    objectId,
    active: true,
    timestamp: Date.now(),
  };
}
```

## State-Based Actions

State-based actions (Rule 704) are implemented separately in `rules-engine/src/stateBasedActions.ts`. These are not keyword actions but automatic game actions that occur whenever certain conditions are met.

When implementing keyword actions that interact with state-based actions (e.g., Destroy, Regenerate), make sure to reference the appropriate state-based action rules.

## Examples

### Simple Action (Exile)

```typescript
export interface ExileAction {
  readonly type: 'exile';
  readonly objectId: string;
  readonly fromZone: string;
}

export function exileObject(
  objectId: string,
  fromZone: string
): ExileAction {
  return {
    type: 'exile',
    objectId,
    fromZone,
  };
}
```

### Complex Action (Scry)

```typescript
export interface ScryAction {
  readonly type: 'scry';
  readonly playerId: string;
  readonly count: number;
  readonly topCards?: readonly string[];
  readonly bottomCards?: readonly string[];
}

export function scry(playerId: string, count: number): ScryAction {
  return { type: 'scry', playerId, count };
}

export function completeScry(
  playerId: string,
  count: number,
  topCards: readonly string[],
  bottomCards: readonly string[]
): ScryAction {
  if (topCards.length + bottomCards.length !== count) {
    throw new Error('Scry decision must account for all cards');
  }
  return { type: 'scry', playerId, count, topCards, bottomCards };
}
```

## Additional Resources

- **Comprehensive Rules**: `MagicCompRules 20251114.txt` (in repository root)
- **Existing Tests**: Look at `test/keywordActions-part2.test.ts` and `test/keywordActions-part3.test.ts` for examples
- **Architecture Doc**: `docs/architecture.md`

## Getting Help

If you're unsure about how to implement a particular keyword action:

1. Review similar actions in the existing codebase
2. Consult the comprehensive rules for the exact wording and subrules
3. Look at the test files to understand expected behavior
4. Reference the MTG Judge community resources for complex interactions

Happy coding! 🎮✨
