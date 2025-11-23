# Mana and Timing Features Implementation

This document describes the mana and timing features implemented for the MTG platform.

## Overview

The following features have been implemented:

1. **Tapping lands for mana** - Server-side logic to tap permanents for mana and track mana pools
2. **Mana pool management** - Per-player mana pools with automatic cleanup at step/phase boundaries
3. **Mana cost parsing and payment** - Rules engine support for parsing mana costs and auto-paying
4. **Untap step behavior** - Comprehensive untap logic with support for stun counters and untap prevention
5. **Timing validators** - Rules for when spells can be cast (priority, sorcery-speed restrictions)

## Server-Side Features

### Mana Pool Management

Each player has a mana pool tracked in `state.manaPools[playerId]` with the following structure:

```typescript
{
  W: number,      // White mana
  U: number,      // Blue mana
  B: number,      // Black mana
  R: number,      // Red mana
  G: number,      // Green mana
  C: number,      // Colorless mana
  generic: number // Generic mana (from any source)
}
```

### Tapping for Mana

The `tapForMana` function handles tapping a permanent for mana:
- Validates that the player controls the permanent
- Checks that the permanent is untapped
- Identifies basic land types and adds appropriate mana color
- Defaults to colorless mana for non-basic lands
- Marks the permanent as tapped

### Mana Pool Cleanup

Mana pools are automatically cleared at step/phase boundaries by calling `clearAllManaPools` in the `nextStep` function.

### Untap Step

The `applyUntapStep` function handles untapping permanents during the active player's untap step:

- Untaps tapped permanents controlled by the active player
- Respects untap prevention:
  - `stunCounters`: Decrements counter instead of untapping
  - `doesNotUntapNext`: Clears flag and stays tapped (one-time effect)
  - `doesNotUntapDuringUntapStep`: Stays tapped (continuous effect)
  - Global nonbasic lands effect (if active)

## Rules Engine

### Mana Cost Parsing

The `parseManaCost` function parses mana cost strings like `{2}{U}{U}`:

```typescript
const cost = parseManaCost('{2}{U}{U}');
// Returns: { generic: 2, U: 2, W: 0, B: 0, R: 0, G: 0, C: 0 }
```

### Mana Payment

- `canPayCost(pool, cost)`: Checks if a mana pool can pay a given cost
- `autoPayCost(pool, cost)`: Automatically pays a cost from a pool, returning the new pool

Payment strategy:
1. Pay all specific colored requirements first
2. Pay colorless requirement from C mana
3. Pay remaining generic from any leftover mana (colors first, then colorless, then generic)

### Timing Validators

The `canCastSpell` function validates whether a spell can be cast:
- Player must have priority
- Instants or cards with flash can be cast anytime with priority
- Sorcery-speed spells require:
  - Active player
  - Main phase
  - Empty stack

## Client-Side Integration

### Tap Visual (14° Rotation)

Tapped permanents are already rendered with a 14° rotation in the `BattlefieldGrid` component:

```tsx
transform: isTapped ? 'rotate(14deg)' : 'none'
```

### Mana Actions Utility

The `client/src/utils/manaActions.ts` module provides utilities:

```typescript
import { tapLandForMana, isLand, formatManaPool } from '../utils/manaActions';

// Tap a land for mana
tapLandForMana(gameId, permanentId, manaChoice);

// Check if a permanent is a land
if (isLand(perm)) { /* ... */ }

// Format mana pool for display
const display = formatManaPool(view.manaPools[playerId]);
// Returns: "{W}×2 {U}×3 {G}×1"
```

### Example Usage in Components

```tsx
const handlePermanentClick = (permId: string) => {
  const perm = view.battlefield.find(p => p.id === permId);
  if (!perm) return;
  
  // If it's a land and the player controls it
  if (isLand(perm) && perm.controller === yourPlayerId) {
    tapLandForMana(view.id, permId);
  }
};

<BattlefieldGrid 
  perms={permanents}
  onCardClick={handlePermanentClick}
  // ... other props
/>
```

## Socket Events

### Client to Server

- `tapForMana`: `{ gameId, permanentId, manaChoice? }`

### Event Persistence

Both `tapForMana` and `addMana` events are persisted to the game event log and replayed when loading games.

## Shared Types

### Extended BattlefieldPermanent

```typescript
{
  // ... existing fields
  stunCounters?: number;
  doesNotUntapNext?: boolean;
  doesNotUntapDuringUntapStep?: boolean;
}
```

### GameState Extensions

```typescript
{
  // ... existing fields
  manaPools?: Record<PlayerID, ManaPool>;
}
```

## Tests

### Mana Tests (`server/tests/mana.test.ts`)

9 tests covering:
- Mana cost parsing for simple and multi-color costs
- Colorless mana parsing
- Pool payment validation
- Generic mana payment with any color
- Auto-pay functionality
- Immutable pool operations

### Untap Tests (`server/tests/untap.test.ts`)

5 tests covering:
- Basic untap during controller's untap step
- Stun counter decrement instead of untap
- `doesNotUntapNext` flag handling
- `doesNotUntapDuringUntapStep` continuous effect
- Player-specific untap (only active player's permanents)

All tests passing ✓

## Future Enhancements

The following features are stubbed or partially implemented for future work:

1. **Spell casting cost integration**: Call timing validators and cost checkers from `castSpell` handler
2. **Manual mana payment**: UI for manually selecting which mana to pay with
3. **Stack resolution**: Automatic stack resolution when all players pass
4. **Visual stack component**: Client-side stack display
5. **Auto-pay setting**: Per-player preference for automatic mana payment
6. **Multi-color land support**: UI for choosing which color of mana to produce
7. **X costs**: Dynamic mana cost handling
8. **Hybrid and Phyrexian mana**: Extended mana symbol parsing

## Architecture Notes

- Mana pool operations are handled via the rules-engine for pure, deterministic behavior
- Server modules wrap rules-engine functions and manage game state mutations
- All mana and untap logic is fully replayed from event logs
- The turn module imports mana and untap modules directly to avoid circular dependencies
