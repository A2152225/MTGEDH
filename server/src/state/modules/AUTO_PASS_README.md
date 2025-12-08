# Auto-Pass Priority System

## Overview

The auto-pass priority system automatically passes priority for players who cannot respond during a priority window. This improves gameplay flow by eliminating unnecessary waiting when a player has no legal actions available.

## Architecture

The system is designed to be **modular** with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────┐
│                      Priority System                         │
│  (priority.ts - autoPassIfCannotRespond)                    │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   Can Respond Module                         │
│  (can-respond.ts - main orchestration)                      │
│  • canRespond() - main entry point                          │
│  • canCastAnySpell() - check spell casting                  │
│  • canActivateAnyAbility() - check ability activation       │
└──────────┬────────────────────────┬─────────────────────────┘
           │                        │
           ▼                        ▼
┌──────────────────────┐  ┌──────────────────────┐
│  Mana Check Module   │  │ Alternate Costs      │
│  (mana-check.ts)     │  │ (alternate-costs.ts) │
│                      │  │                      │
│  • parseManaCost()   │  │  • Force of Will     │
│  • canPayManaCost()  │  │  • Fierce Guardian   │
│  • getTotalMana()    │  │  • Pact cycle        │
│  • getMaxXValue()    │  │  • Convoke           │
│                      │  │  • Delve             │
│                      │  │  • Improvise         │
└──────────────────────┘  └──────────────────────┘
```

## Modules

### 1. can-respond.ts

**Main orchestration module** that determines if a player can respond.

#### Functions:
- `canRespond(ctx, playerId)` - Main entry point. Returns `true` if player can respond.
- `canCastAnySpell(ctx, playerId)` - Checks if player can cast any instant or flash spell.
- `canActivateAnyAbility(ctx, playerId)` - Checks if player can activate any abilities.

#### Logic Flow:
1. Check if player has instants or flash spells in hand
2. For each spell, check if mana cost can be paid OR alternate cost is available
3. Check if player has any activatable abilities on battlefield
4. Return `true` if ANY response is available, `false` otherwise

### 2. mana-check.ts

**Mana validation module** for checking if costs can be paid.

#### Functions:
- `parseManaCost(manaCost)` - Parse mana cost string into components
- `canPayManaCost(pool, parsedCost)` - Check if a cost can be paid from pool
- `getTotalManaFromPool(pool)` - Calculate total mana available
- `getMaxXValue(pool, parsedCost)` - Calculate max X for X spells
- `getManaPoolFromState(state, playerId)` - Get player's mana pool

#### Example:
```typescript
const pool = { white: 1, blue: 2, black: 0, red: 0, green: 0, colorless: 1 };
const cost = parseManaCost("{2}{U}{U}"); // Counterspell
const canPay = canPayManaCost(pool, cost); // true
```

### 3. alternate-costs.ts

**Alternate casting cost patterns** module.

#### Supported Patterns:
1. **Force of Will** - Exile blue card + pay 1 life
   - Check: Player has 1+ life AND blue card in hand
   
2. **Commander-dependent** (Fierce Guardianship, Deflecting Swat)
   - Check: Player controls a commander (legendary creature)
   
3. **Pact cycle** - Free now, pay on next upkeep
   - Check: Always available
   
4. **Convoke** - Tap creatures to help pay
   - Check: Player has untapped creatures
   
5. **Delve** - Exile cards from graveyard to help pay
   - Check: Player has cards in graveyard
   
6. **Improvise** - Tap artifacts to help pay
   - Check: Player has untapped artifacts

#### Functions:
- `hasPayableAlternateCost(ctx, playerId, card)` - Main checker
- `hasForceOfWillAlternateCost(...)` - Specific pattern
- `hasCommanderFreeAlternateCost(...)` - Specific pattern
- `hasPactAlternateCost(...)` - Specific pattern
- `hasConvokeAlternateCost(...)` - Specific pattern
- `hasDelveAlternateCost(...)` - Specific pattern
- `hasImproviseAlternateCost(...)` - Specific pattern
- `getAlternateCostDescription(...)` - Get human-readable descriptions

### 4. priority.ts

**Priority management** with auto-pass integration.

#### Functions:
- `autoPassIfCannotRespond(ctx, playerId)` - Check and auto-pass if needed
- `passPriority(ctx, playerId)` - Pass priority (existing function)

#### Integration:
```typescript
// Check if auto-pass is enabled for player
const autoPassPlayers = state.autoPassPlayers || new Set();
if (autoPassPlayers.has(playerId)) {
  // Check if player can respond
  if (!canRespond(ctx, playerId)) {
    // Auto-pass priority
    passPriority(ctx, playerId);
  }
}
```

## Usage

### Client-Side

#### Enable/Disable Auto-Pass:
```typescript
socket.emit("setAutoPass", { 
  gameId: "game123", 
  enabled: true 
});
```

#### Query Response Capability:
```typescript
socket.emit("checkCanRespond", { gameId: "game123" });

socket.on("canRespondResponse", (response) => {
  console.log("Can respond:", response.canRespond);
  // response = { canRespond: true/false, gameId, playerId }
});
```

### Server-Side

#### Manual Check:
```typescript
import { canRespond } from './state/modules/can-respond';

const ctx = createGameContext(game);
const playerCanRespond = canRespond(ctx, playerId);

if (!playerCanRespond) {
  // Auto-pass or show message
}
```

#### In Priority Flow:
```typescript
import { autoPassIfCannotRespond } from './state/modules/priority';

// When priority passes to a player
const autoPassed = autoPassIfCannotRespond(ctx, playerId);
if (autoPassed) {
  console.log(`Auto-passed priority for ${playerId}`);
}
```

## Testing

Comprehensive test suite in `server/tests/can-respond.test.ts`:

- ✅ 16 tests covering all scenarios
- ✅ Empty hand checks
- ✅ Instant/flash spell checks
- ✅ Mana availability checks
- ✅ Alternate cost checks (Force of Will, Fierce Guardianship)
- ✅ Ability activation checks
- ✅ Tapped/untapped permanent checks

Run tests:
```bash
npx vitest run server/tests/can-respond.test.ts
```

## Extending the System

### Adding New Alternate Cost Patterns

1. Create a new checker function in `alternate-costs.ts`:
```typescript
export function hasNewPatternAlternateCost(
  ctx: GameContext,
  playerId: PlayerID,
  card: any
): boolean {
  // Check if pattern can be used
  const oracleText = (card.oracle_text || "").toLowerCase();
  
  // Pattern detection
  if (!oracleText.includes("your pattern text")) {
    return false;
  }
  
  // Cost check
  // ... your logic ...
  
  return true;
}
```

2. Add to `hasPayableAlternateCost()`:
```typescript
export function hasPayableAlternateCost(...) {
  // ... existing checks ...
  if (hasNewPatternAlternateCost(ctx, playerId, card)) return true;
  
  return false;
}
```

3. Add to description getter (optional):
```typescript
export function getAlternateCostDescription(...) {
  // ... existing descriptions ...
  if (hasNewPatternAlternateCost(ctx, playerId, card)) {
    descriptions.push("Your pattern description");
  }
  
  return descriptions;
}
```

### Adding New Ability Checks

Modify `hasActivatableAbility()` in `can-respond.ts` to add new patterns:

```typescript
// Check for new ability pattern
const newAbilityPattern = /your pattern here/i;
if (newAbilityPattern.test(oracleText)) {
  // Check if ability can be activated
  return true;
}
```

## Performance Considerations

- **Lazy evaluation**: Functions return early when condition is met
- **Simple checks first**: Mana checks before complex pattern matching
- **No unnecessary iterations**: Stop at first available response
- **Minimal allocations**: Reuse data structures where possible

## Edge Cases and Limitations

### Current Limitations:

1. **Targeting requirements not checked**: System assumes if cost can be paid, targets exist
   - Future enhancement: Add target validation
   
2. **Split cards / MDFCs**: Not fully supported
   - Future enhancement: Check both faces
   
3. **Complex alternate costs**: Some edge cases not covered
   - e.g., Pitch spells with multiple color options
   - Future enhancement: More pattern matchers
   
4. **Timing restrictions**: Doesn't check if it's the right time to cast
   - e.g., Sorcery speed restrictions for some effects
   - System only checks priority windows

### Error Handling:

- **Safe defaults**: On error, returns `true` (can respond) to avoid auto-passing incorrectly
- **Logging**: All errors logged to console with `[canRespond]` prefix
- **Graceful degradation**: Missing fields default to safe values

## Future Enhancements

1. **Target validation**: Check if valid targets exist for spells/abilities
2. **More alternate costs**: Additional patterns (Miracle, Madness, etc.)
3. **Timing restrictions**: Better understanding of when abilities can be activated
4. **Performance optimization**: Caching frequently checked values
5. **UI indicators**: Visual feedback showing why player can/cannot respond
6. **Smart auto-pass**: Only auto-pass when nothing on stack or specific conditions
7. **Player preferences**: Granular control (e.g., "always prompt for counterspells")

## References

- MTG Comprehensive Rules: Priority (117), Casting Spells (601)
- Alternate costs: Rules 118.9, 702.32 (Convoke), 702.65 (Delve), 702.77 (Improvise)
- Priority passing: Rules 117.3-117.5
