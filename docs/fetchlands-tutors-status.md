# Fetch Lands and Tutors - Implementation Status

## Current Status: ✅ IMPLEMENTED

### What's Implemented

The fetch land and tutor functionality is now fully implemented in the modular action system:

1. **Sacrifice** (`actions/sacrifice.ts`) - Rule 701.21
   - Moves permanent from battlefield to graveyard
   - Validates controller owns the permanent
   - Emits PERMANENT_SACRIFICED event

2. **Search Library** (`actions/searchLibrary.ts`) - Rule 701.23
   - Search any zone with criteria (card type, name, color, mana value)
   - Fail to find option for hidden zones
   - Put cards into hand, battlefield, graveyard, or back on library
   - Optional tapped entry for lands
   - Automatic library shuffle after search

3. **Fetchland Activation** (`actions/fetchland.ts`)
   - Complete sequence: tap, pay life (optional), sacrifice, search
   - Supports Evolving Wilds style (enters tapped, no life payment)
   - Supports true fetchlands (enters untapped, pays 1 life)

4. **Combat** (`actions/combat.ts`)
   - Declare attackers with proper validation
   - Declare blockers
   - Combat damage dealing
   - Commander damage tracking

### Events Emitted

The following events are emitted for UI integration:

```typescript
PERMANENT_SACRIFICED = 'permanentSacrificed'
LIBRARY_SEARCHED = 'librarySearched'  
LIBRARY_SHUFFLED = 'libraryShuffled'
CARD_PUT_ONTO_BATTLEFIELD = 'cardPutOntoBattlefield'
CARD_PUT_INTO_HAND = 'cardPutIntoHand'
LIFE_PAID = 'lifePaid'
```

## Usage Examples

### Evolving Wilds

```typescript
import { executeFetchland, createEvolvingWildsAction } from './actions';

// Create the action
const action = createEvolvingWildsAction('player1', 'evolving-wilds-1', 'forest-card-id');

// Execute
const result = executeFetchland(gameId, action, context);
// Result: Evolving Wilds sacrificed, Forest put onto battlefield tapped, library shuffled
```

### Polluted Delta (True Fetchland)

```typescript
import { executeFetchland, createEnemyFetchlandAction } from './actions';

// Create the action  
const action = createEnemyFetchlandAction(
  'player1', 
  'polluted-delta-1', 
  'island', 
  'swamp',
  'selected-land-id'
);

// Execute
const result = executeFetchland(gameId, action, context);
// Result: 1 life paid, Polluted Delta sacrificed, land enters untapped
```

### Demonic Tutor

```typescript
import { executeSearchLibrary } from './actions';

const action = {
  type: 'searchLibrary',
  playerId: 'player1',
  criteria: { maxResults: 1 }, // Any card
  destination: 'hand',
  shuffle: true,
  selectedCardIds: ['selected-card-id'],
};

const result = executeSearchLibrary(gameId, action, context);
```

### Rampant Growth

```typescript
import { executeSearchLibrary } from './actions';

const action = {
  type: 'searchLibrary',
  playerId: 'player1',
  criteria: { cardType: 'basic land', maxResults: 1 },
  destination: 'battlefield',
  tapped: true,
  shuffle: true,
};

const result = executeSearchLibrary(gameId, action, context);
```

## Tests

All functionality is covered by tests in `rules-engine/test/actions.test.ts`:

- Sacrifice validation and execution
- Search library with various criteria
- Fail to find handling
- Fetchland complete sequence
- Combat damage and commander damage

## Files

- `rules-engine/src/actions/sacrifice.ts` - Sacrifice action
- `rules-engine/src/actions/searchLibrary.ts` - Search library action  
- `rules-engine/src/actions/fetchland.ts` - Fetchland activation
- `rules-engine/src/actions/combat.ts` - Combat actions
- `rules-engine/src/actions/index.ts` - Exports
- `rules-engine/src/core/events.ts` - Event definitions
- `rules-engine/test/actions.test.ts` - Test suite
