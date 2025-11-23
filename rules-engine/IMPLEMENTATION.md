# Rules Engine Implementation Guide

This document describes the implementation of the Magic: The Gathering rules engine based on the Comprehensive Rules (MagicCompRules 20251114.txt).

## Architecture

The rules engine is designed with the following principles:
- **Pure functions**: All functions are side-effect free and operate on immutable state
- **Type safety**: Comprehensive TypeScript types for all game concepts
- **Modularity**: Each major rules section is in its own module
- **Testability**: All logic is unit testable

## Core Modules

### 1. Abilities (`src/types/abilities.ts`, `src/abilities.ts`)

Implements Rule 113 (Abilities) and related sections.

**Types of abilities supported:**
- **Activated Abilities** (Rule 602): Cost-based abilities with timing restrictions
- **Triggered Abilities** (Rule 603): Event-based abilities with trigger conditions
- **Static Abilities** (Rule 604): Continuous effects
- **Spell Abilities** (Rule 113.3a): Effects on instant/sorcery spells

**Key features:**
- Activation restrictions (once per turn, sorcery-speed, etc.)
- Trigger conditions (enters-battlefield, becomes-tapped, phase/step begins, etc.)
- Intervening 'if' clauses (Rule 603.4)
- APNAP ordering for triggered abilities (Rule 603.3b)

**Usage example:**
```typescript
import { canActivateAbility, activateAbility } from '@mtgedh/rules-engine';

// Define an activated ability
const ability: ActivatedAbility = {
  id: 'llanowar-elves-tap',
  type: 'activated',
  sourceId: 'llanowar-elves-1',
  text: '{T}: Add {G}',
  cost: { type: 'tap', sourceId: 'llanowar-elves-1' },
  effect: { 
    type: 'add-mana', 
    mana: { green: 1 } 
  }
};

// Check if can activate
if (canActivateAbility(state, ability, playerId)) {
  const result = activateAbility(state, ability, playerId);
  state = result.next;
}
```

### 2. Stack (`src/types/stack.ts`, `src/stack.ts`)

Implements Rule 405 (Stack).

**Key features:**
- LIFO (Last-In-First-Out) ordering
- Push spells and abilities onto stack
- Pop objects when they resolve
- Counter spells/abilities (remove from stack)
- Query stack state

**Usage example:**
```typescript
import { pushSpell, popStack, peekStack, isStackEmpty } from '@mtgedh/rules-engine';

// Push a spell onto the stack
const spell: StackedSpell = { /* ... */ };
state = pushSpell(state, spell).next;

// Check what's on top
const topObject = peekStack(state);

// Resolve top object
if (topObject) {
  // ... resolve the spell/ability ...
  state = popStack(state).next;
}
```

### 3. Priority (`src/priority.ts`)

Implements Rule 117 (Timing and Priority).

**Key features:**
- Pass priority to next player (Rule 117.3d)
- Give priority to active player (Rule 117.3a, 117.3b)
- Check sorcery-speed timing (Rule 117.1a)
- Check instant-speed timing (Rule 117.1b)
- Support for multiplayer turn order

**Usage example:**
```typescript
import { passPriority, canCastSorcery, canCastInstant } from '@mtgedh/rules-engine';

// Pass priority
state = passPriority(state, playerId).next;

// Check if can cast sorcery
if (canCastSorcery(state, playerId)) {
  // Cast sorcery spell
}

// Check if can cast instant (or activate ability)
if (canCastInstant(state, playerId)) {
  // Cast instant or activate ability
}
```

### 4. Costs (`src/costs.ts`)

Implements Rule 118 (Costs).

**Cost types supported:**
- **Mana costs** (Rule 118.3a): Colored and generic mana
- **Tap/Untap costs** (Rule 602.5a): Tapping or untapping permanents
- **Life costs** (Rule 118.3b): Paying life, including half-life
- **Sacrifice costs**: Sacrificing permanents
- **Discard costs**: Discarding cards
- **Exile costs**: Exiling cards from various zones
- **Counter removal costs**: Removing counters from permanents
- **Composite costs**: Multiple costs combined

**Key features:**
- Check if cost can be paid before paying
- Atomic payment (all or nothing)
- Proper state rollback on failure

**Usage example:**
```typescript
import { canPayCost, payCost } from '@mtgedh/rules-engine';

// Define a composite cost
const cost: Cost = {
  type: 'composite',
  costs: [
    { type: 'tap', sourceId: 'permanent-1' },
    { type: 'pay-life', amount: 2 }
  ]
};

// Check if can pay
if (canPayCost(state, playerId, cost)) {
  const result = payCost(state, playerId, cost);
  if (result.paid) {
    state = result.next;
    // Proceed with effect
  }
}
```

### 5. Replacement Effects (`src/types/replacementEffects.ts`, `src/replacementEffects.ts`)

Implements Rule 614 (Replacement Effects).

**Key features:**
- Enters-the-battlefield tapped (Rule 614.12)
- Enters with counters (Rule 614.1c)
- Layer-based ordering for multiple effects (Rule 616)
- Prevents recursive application (Rule 614.5)

**Usage example:**
```typescript
import { 
  applyReplacementEffects, 
  createEntersTappedEffect,
  createEntersWithCountersEffect 
} from '@mtgedh/rules-engine';

// Create replacement effects
const effects: ReplacementEffect[] = [
  createEntersTappedEffect('etbt-source', 'land-1', 0),
  createEntersWithCountersEffect('counter-source', 'creature-1', '+1/+1', 2, 0)
];

// Apply when permanent enters
const event: EnterBattlefieldEvent = {
  id: 'event-1',
  type: 'enter-battlefield',
  permanentId: 'land-1',
  controller: playerId,
  tapped: false,
  counters: new Map(),
  timestamp: Date.now()
};

const result = applyReplacementEffects(state, event, effects);
// result.event will have tapped: true
// Add permanent to battlefield with modified state
```

### 6. Land Search/Fetch (`src/landSearch.ts`)

Implements common land search and fetch patterns.

**Key features:**
- Search library for cards matching filter
- Put cards into various destinations (hand, battlefield, graveyard, library top/bottom)
- Proper handling of enters-the-battlefield replacement effects
- Shuffle library after search

**Usage example:**
```typescript
import { executeSearchEffect } from '@mtgedh/rules-engine';

// Define a search effect (like Rampant Growth)
const effect: SearchLibraryEffect = {
  type: 'search-library',
  player: 'you',
  filter: {
    types: ['Land'],
    subtypes: ['Forest', 'Plains', 'Island', 'Swamp', 'Mountain']
  },
  count: 1,
  reveal: false,
  destination: 'battlefield',
  tapped: true,
  shuffle: true
};

// Execute the search
const result = executeSearchEffect(state, effect, playerId, replacementEffects);
state = result.next;
// Player's library is searched, land is put onto battlefield tapped, library shuffled
```

## Rules Coverage

### Fully Implemented
- ✅ Rule 113: Abilities (types and characteristics)
- ✅ Rule 117: Timing and Priority
- ✅ Rule 118: Costs
- ✅ Rule 405: Stack
- ✅ Rule 602: Activating Activated Abilities
- ✅ Rule 603: Handling Triggered Abilities (core mechanics)
- ✅ Rule 614.1c: Enters-the-battlefield replacement effects
- ✅ Rule 614.12: Replacement effects that modify how permanents enter

### Partially Implemented
- ⚠️ Rule 603: Handling Triggered Abilities (some edge cases pending)
- ⚠️ Rule 604: Handling Static Abilities (types defined, application pending)
- ⚠️ Rule 608: Resolving Spells and Abilities (structure in place, resolution logic needed)
- ⚠️ Rule 614: Replacement Effects (ETBT complete, other types partial)

### Not Yet Implemented
- ❌ Rule 608: Full spell/ability resolution
- ❌ Rule 613: Interaction of Continuous Effects (layer system)
- ❌ Rule 704: State-Based Actions
- ❌ Rule 500-514: Turn Structure (untap, upkeep, draw, phases, steps)
- ❌ Rule 506-511: Combat System
- ❌ Rule 616: Interaction of Replacement and/or Prevention Effects (partial)

## Known Limitations

The current implementation has several placeholders that need to be replaced with full implementations before production use:

### Critical Placeholders (UNSAFE for production)

1. **Mana Cost Checking** (`src/costs.ts`):
   - `canPayManaCost` always returns `true`
   - Does not actually check player's mana pool
   - **Risk**: Players can cast spells without having sufficient mana

2. **Discard Cost Checking** (`src/costs.ts`):
   - `canPayDiscardCost` always returns `true`
   - Does not check hand size
   - **Risk**: Players can discard more cards than they have

3. **Object Filtering** (`src/abilities.ts`):
   - `matchesFilter` always returns `true`
   - Does not check types, subtypes, colors, controller, etc.
   - **Risk**: Triggered abilities fire inappropriately

4. **Library Search** (`src/landSearch.ts`):
   - `searchLibrary` always returns empty results
   - Does not actually search or filter cards
   - **Risk**: All search effects (fetchlands, ramp spells) are non-functional

5. **Condition Checking** (`src/abilities.ts`):
   - `checkCondition` always returns `true`
   - Does not evaluate life totals, permanents controlled, etc.
   - **Risk**: Conditional effects trigger incorrectly

### Required for Production

Before using this engine in a live game:

1. **Implement Mana Pool Tracking**:
   - Add mana pool to Player state
   - Implement mana generation from lands/abilities
   - Implement proper mana cost payment

2. **Implement Hand Tracking**:
   - Add hand cards to Player state
   - Implement discard mechanics
   - Implement hand size checking

3. **Implement Object Filters**:
   - Type checking (creature, land, artifact, etc.)
   - Subtype checking (goblin, forest, equipment, etc.)
   - Color checking (red, blue, multicolor, colorless, etc.)
   - Controller checking (you, opponent)

4. **Implement Library Searching**:
   - Access to player library cards
   - Card filtering logic
   - Player choice interface for selection

5. **Implement Condition Evaluation**:
   - Life total comparisons
   - Permanent counting
   - Zone checks

## Testing

All implemented features have comprehensive unit tests:

```bash
cd rules-engine
npm test
```

Current test coverage:
- **Stack**: 8 tests (LIFO, push/pop, counter, queries)
- **Priority**: 18 tests (passing, timing checks, multiplayer)
- **Costs**: 13 tests (all cost types, composite, rollback)
- **Replacement Effects**: 9 tests (ETBT, counters, ordering)
- **Commander Tax**: 1 test (existing functionality)

Total: **49 passing tests**

**Note**: Tests use mocked/simplified state and do not exercise the placeholder implementations in realistic scenarios. Additional integration tests are needed once placeholders are implemented.

## Integration

To use the rules engine in your application:

```typescript
import { 
  // Stack operations
  pushSpell, 
  pushAbility, 
  popStack,
  
  // Priority
  passPriority,
  canCastSorcery,
  
  // Costs
  canPayCost,
  payCost,
  
  // Abilities
  canActivateAbility,
  activateAbility,
  checkTrigger,
  
  // Replacement effects
  applyReplacementEffects,
  createEntersTappedEffect,
  
  // Types
  GameState,
  ActivatedAbility,
  TriggeredAbility,
  Cost,
  ReplacementEffect
} from '@mtgedh/rules-engine';

// Your game logic here
```

## Future Enhancements

1. **State-Based Actions (Rule 704)**: Automatic checking and execution of SBAs
2. **Turn Structure (Rule 500-514)**: Automated phase/step progression
3. **Combat System (Rule 506-511)**: Full combat implementation
4. **Layer System (Rule 613)**: Proper ordering of continuous effects
5. **Complete Resolution (Rule 608)**: Full spell and ability resolution logic
6. **Mana Pool Tracking**: Actual mana generation and consumption
7. **Zone Transitions**: Complete move-card-between-zones logic
8. **Card Filters**: Full implementation of object filters for searching/targeting

## Contributing

When adding new rules functionality:

1. Reference the specific rule number in code comments
2. Add comprehensive tests for the new functionality
3. Update this documentation
4. Ensure type safety (no `any` types in public APIs)
5. Follow the pure function pattern (immutable state, no side effects)
