# Fetch Lands and Tutors - Implementation Status

## Current Status

### ✅ What's Already Implemented

The keyword actions for search and sacrifice are fully implemented:

1. **Search** (`keywordActions/search.ts`) - Rule 701.23
   - Search any zone with criteria
   - Fail to find option for hidden zones
   - Public vs hidden zone handling
   - Search criteria by card type, name, color, mana value

2. **Sacrifice** (`keywordActions/sacrifice.ts`) - Rule 701.21
   - Sacrifice permanents from battlefield to graveyard
   - Validation that player controls the permanent
   - Proper handling (not destruction, bypasses indestructible)

### ❌ What Needs Additional Work

The keyword actions exist but are **not yet integrated into RulesEngineAdapter**, meaning they can't be executed through the game engine. Here's what needs to be done:

## Required Implementation

### 1. Add New Action Types

Add these action types to the `executeAction` method in RulesEngineAdapter:

```typescript
case 'searchLibrary':
  result = this.searchLibraryAction(gameId, action);
  break;
  
case 'sacrifice':
  result = this.sacrificePermanentAction(gameId, action);
  break;
```

### 2. Add New Events

Add these events to `RulesEngineEvent`:

```typescript
LIBRARY_SEARCHED = 'librarySearched',
LIBRARY_SHUFFLED = 'libraryShuffled',
PERMANENT_SACRIFICED = 'permanentSacrificed',
CARD_PUT_ONTO_BATTLEFIELD = 'cardPutOntoBattlefield',
```

### 3. Implement Action Handlers

#### Search Library Handler

```typescript
private searchLibraryAction(gameId: string, action: any): EngineResult<GameState> {
  const state = this.gameStates.get(gameId)!;
  const player = state.players.find(p => p.id === action.playerId);
  
  // Search library based on criteria
  // Show UI for player to select card(s)
  // Move card(s) to destination (hand, battlefield, etc.)
  // Shuffle library
  
  return { next: updatedState, log: ['Searched library'] };
}
```

#### Sacrifice Permanent Handler

```typescript
private sacrificePermanentAction(gameId: string, action: any): EngineResult<GameState> {
  const state = this.gameStates.get(gameId)!;
  
  // Validate can sacrifice
  // Move from battlefield to graveyard
  // Trigger dies abilities
  
  return { next: updatedState, log: ['Sacrificed permanent'] };
}
```

### 4. Zone Movement Utilities

Need utilities to move cards between zones:

```typescript
// Move card from library to hand
function moveToHand(state: GameState, playerId: string, cardId: string): GameState

// Move card from library to battlefield
function putOntoBattlefield(state: GameState, playerId: string, cardId: string, options?: { tapped: boolean }): GameState

// Shuffle library
function shuffleLibrary(state: GameState, playerId: string): GameState

// Move from battlefield to graveyard
function moveToGraveyard(state: GameState, cardId: string): GameState
```

## Example Usage (After Implementation)

### Evolving Wilds

```typescript
// Activate Evolving Wilds
rulesEngine.executeAction(gameId, {
  type: 'activateAbility',
  playerId: 'player1',
  ability: {
    id: 'evolving-wilds-tap',
    sourceId: 'evolving-wilds-1',
    sourceName: 'Evolving Wilds',
    controllerId: 'player1',
    effect: 'Search library for basic land, put onto battlefield tapped',
    additionalCosts: [
      { type: 'tap', sourceId: 'evolving-wilds-1' },
      { type: 'sacrifice', permanentId: 'evolving-wilds-1' }
    ],
  },
});

// This would internally:
// 1. Tap Evolving Wilds
// 2. Sacrifice it
// 3. Search library
// 4. Put land onto battlefield tapped
// 5. Shuffle library
```

### Fetchland (e.g., Polluted Delta)

```typescript
rulesEngine.executeAction(gameId, {
  type: 'activateAbility',
  playerId: 'player1',
  ability: {
    id: 'polluted-delta-fetch',
    sourceId: 'polluted-delta-1',
    sourceName: 'Polluted Delta',
    controllerId: 'player1',
    effect: 'Search for Island or Swamp',
    additionalCosts: [
      { type: 'tap', sourceId: 'polluted-delta-1' },
      { type: 'life', amount: 1 },
      { type: 'sacrifice', permanentId: 'polluted-delta-1' }
    ],
  },
});
```

### Tutor Spell (e.g., Demonic Tutor)

```typescript
// Cast Demonic Tutor
rulesEngine.executeAction(gameId, {
  type: 'castSpell',
  playerId: 'player1',
  cardId: 'demonic-tutor-1',
  cardName: 'Demonic Tutor',
  cardTypes: ['sorcery'],
  manaCost: { black: 1, generic: 1 },
});

// When it resolves:
rulesEngine.executeAction(gameId, {
  type: 'searchLibrary',
  playerId: 'player1',
  criteria: {
    maxResults: 1, // Search for any one card
  },
  destination: 'hand',
  shuffle: true,
});
```

### Rampant Growth

```typescript
// Cast Rampant Growth
rulesEngine.executeAction(gameId, {
  type: 'castSpell',
  playerId: 'player1',
  cardId: 'rampant-growth-1',
  cardName: 'Rampant Growth',
  cardTypes: ['sorcery'],
  manaCost: { green: 1, generic: 1 },
});

// When it resolves:
rulesEngine.executeAction(gameId, {
  type: 'searchLibrary',
  playerId: 'player1',
  criteria: {
    cardType: 'Basic Land',
    maxResults: 1,
  },
  destination: 'battlefield',
  tapped: false,
  shuffle: true,
});
```

## UI Considerations

When searching library, the UI needs to:

1. **Show library cards** to the searching player (in a searchable/filterable view)
2. **Apply criteria filters** to highlight valid choices
3. **Allow selection** of cards (up to maxResults)
4. **Support "fail to find"** option for hidden zones
5. **Handle "reveal"** requirement when specified
6. **Show to opponents** what was found (if required by effect)
7. **Shuffle animation** after search completes

## Testing Requirements

After implementation, need tests for:

```typescript
describe('Fetch Lands and Tutors', () => {
  it('should sacrifice fetch land and search library');
  it('should allow fail to find in hidden zones');
  it('should put land onto battlefield from library');
  it('should shuffle library after search');
  it('should search for specific card type');
  it('should handle "reveal" requirement');
  it('should trigger dies abilities when sacrificing');
  it('should handle multiple search results');
});
```

## Implementation Priority

1. **High Priority** (core fetch land functionality):
   - Zone movement utilities
   - Sacrifice integration
   - Basic library search
   - Shuffle library

2. **Medium Priority** (tutors and advanced search):
   - Complex search criteria
   - UI for card selection
   - Reveal mechanics

3. **Low Priority** (edge cases):
   - Searching other players' libraries
   - Searching non-library zones
   - Merged permanent handling

## Estimated Effort

- **Basic fetch lands**: 4-6 hours
  - Zone movement utilities: 2 hours
  - Sacrifice integration: 1 hour
  - Basic search: 2 hours
  - Testing: 1 hour

- **Full tutor support**: 8-10 hours
  - UI for card selection: 4 hours
  - Advanced search criteria: 2 hours
  - Multiple results handling: 2 hours
  - Testing: 2 hours

## Files That Need Updates

1. `rules-engine/src/RulesEngineAdapter.ts` - Add action handlers
2. `rules-engine/src/zoneMovement.ts` (new file) - Zone utilities
3. `rules-engine/test/fetchlands.test.ts` (new file) - Tests
4. `server/src/socket/game-actions.ts` - Wire to server
5. Client UI components for library search

## Conclusion

**Fetch lands and tutors will NOT work yet** - they need the additional integration work outlined above. The keyword actions are implemented but not connected to the game engine. This is a good next step for the implementation.
