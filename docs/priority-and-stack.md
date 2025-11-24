# Priority and Stack Handling

## Overview

The priority system in MTGEDH follows the Magic: The Gathering Comprehensive Rules for passing priority and resolving spells on the stack.

## Priority Passing

Priority is tracked per game and automatically rotates between active players when passing.

### Implementation

The priority system is implemented in `server/src/state/modules/priority.ts` and `server/src/state/modules/turn.ts`.

Key components:
- **Priority Holder**: Stored in `game.state.priority` (PlayerID)
- **Passes Tracking**: `ctx.passesInRow` tracks consecutive passes for stack resolution
- **Active Player**: Priority typically starts with the turn player

### Passing Priority

When a player passes priority:

1. Priority advances to the next active player clockwise
2. If the stack is not empty, the pass counter increments
3. When all players pass in succession (passes = number of players), the top spell resolves
4. If the stack is empty, passes are not tracked

```typescript
const result = game.passPriority(playerId);
// { changed: boolean, resolvedNow: boolean }
```

### Stack Resolution

The stack resolves items in LIFO (Last In, First Out) order:
- Most recent spell on top (resolves first)
- Numbered #N, #N-1, ..., #1 from top to bottom

## The Stack

The stack is a zone where spells and abilities wait to resolve. Only one item resolves at a time.

### Stack Operations

**Adding to Stack** (casting a spell):
```typescript
game.pushStack({
  id: 'unique_id',
  controller: playerId,
  card: cardObject,
  targets: ['target1', 'target2']
});
```

**Resolving Top Item**:
```typescript
game.resolveTopOfStack(); // Pops and resolves the top item
```

### Visual Stack Display

When the stack is not empty, a centered UI component displays:
- Number of items on stack
- Each spell name in resolution order
- Pass priority button (enabled when you have priority)
- Indicator showing who has priority

Players can hover over stack items to see card previews.

## Rules Engine Integration

### Current State

The rules engine bridge (`server/src/rules-bridge.ts`) provides:
- Action validation for casting spells and playing lands
- Event forwarding for game state changes
- Conversion between legacy state and rules engine format

### Known Limitations

1. **Win/Loss Events Disabled**: Temporarily disabled until rules engine properly validates win conditions
   - Prevents spam of "X wins the game!" on routine actions
   - Will be re-enabled when rules engine is fully integrated

2. **Land ETB Replacements**: Not yet implemented
   - All lands enter with default tapped state
   - "Enters tapped unless you pay 2 life" effects require rules engine

3. **State-Based Actions**: Partially implemented
   - Basic SBAs work (creature death from damage)
   - Advanced SBAs require full rules engine integration

## Socket Events

### Client → Server

**Pass Priority**:
```typescript
socket.emit('passPriority', { gameId, by: playerId });
```

**Cast Spell from Hand**:
```typescript
socket.emit('castSpellFromHand', { 
  gameId, 
  cardId, 
  targets: ['targetId1', 'targetId2'] 
});
```

**Cast Commander**:
```typescript
socket.emit('castCommander', { 
  gameId, 
  commanderId 
});
```

**Play Land**:
```typescript
socket.emit('playLand', { 
  gameId, 
  cardId 
});
```

### Server → Client

**State Update** (broadcast):
```typescript
socket.on('gameState', (state) => {
  // Updated game state with stack, priority, etc.
});
```

**Chat Messages**:
```typescript
socket.on('chat', (msg) => {
  // System messages like "Player cast Lightning Bolt"
});
```

## Testing

Priority and stack handling is covered by comprehensive tests in:
- `server/tests/gameplay.fixes.test.ts`
- `server/tests/turn.steps.test.ts`
- `server/tests/stack.counter.test.ts`

Run tests:
```bash
cd server && npm test
```

## Common Issues

### "Cannot set properties of undefined" on passPriority

**Cause**: The `passesInRow` object wasn't initialized in GameContext

**Fix**: Already fixed in this PR - `passesInRow: { value: 0 }` is now initialized in context creation

### Stack items showing in wrong order

The stack displays most recent (top) to oldest (bottom). This matches MTG rules where the last spell cast resolves first.

### "You don't have priority" error

This is expected behavior. Only the player with priority can:
- Cast spells (except during special timings)
- Activate abilities
- Pass priority

Wait for priority to pass to you, or check `game.state.priority` to see who currently has it.

## Future Enhancements

1. **Automatic Priority Passing**: Auto-pass when player has no legal actions
2. **Priority Stops**: Configure when to stop and prompt for actions
3. **Full Rules Engine**: Complete integration for all MTG rules
4. **Stack Interaction**: Click to target spells on the stack (e.g., Counterspell)
5. **Ability Stack Items**: Add activated and triggered abilities to the stack
6. **Split-Second**: Handle spells that don't allow responses

## References

- [MTG Comprehensive Rules - Section 117 (Timing and Priority)](https://magic.wizards.com/en/rules)
- [MTG Comprehensive Rules - Section 405 (Stack)](https://magic.wizards.com/en/rules)
