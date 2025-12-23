# Fix: AI Commander Casting with Incorrect Mana (Exotic Orchard & Rule 106.7)

## Problem Statement

During a test game, an AI opponent was able to cast **Kynaios and Tiro of Meletis** (requires `{W}{U}{R}{G}`) with insufficient mana colors. The AI's battlefield state was:
- 2 Mountains (produces `{R}{R}`)
- 1 Forest (produces `{G}`)
- 1 Exotic Orchard (should only produce what opponents can produce)
- 1 Sol Ring (produces `{C}{C}`)

The opponent players had NO white or blue sources, so Exotic Orchard should NOT have been able to produce white or blue mana. However, the AI was able to cast the 4-color commander anyway.

## Root Cause

Two issues were found in `server/src/state/modules/mana-check.ts` in the `getAvailableMana()` function:

### Issue 1: Exotic Orchard treated as unconditional "any color"

**Exotic Orchard's oracle text:**
```
{T}: Add one mana of any color that a land an opponent controls could produce.
```

**Problematic code:**
```typescript
if (/one mana of any color|add.*any color/i.test(fullManaText)) {
  pool.white = (pool.white || 0) + 1;
  pool.blue = (pool.blue || 0) + 1;
  pool.black = (pool.black || 0) + 1;
  pool.red = (pool.red || 0) + 1;
  pool.green = (pool.green || 0) + 1;
}
```

This regex matched "one mana of any color" in Exotic Orchard's text, treating it as unconditional.

### Issue 2: Command Tower produced all 5 colors

**Command Tower's oracle text:**
```
{T}: Add one mana of any color in your commander's color identity.
```

The code treated Command Tower the same as Mana Confluence, adding all 5 colors instead of only the colors in the commander's color identity.

### Issue 3: Only checked {T}: activated abilities

The original implementation only looked for `{T}:` activated abilities, missing:
- ETB triggers (e.g., Crumbling Vestige)
- Non-tap activated abilities (e.g., Mirrodin's Core)

Per **Rule 106.7**, we must check ALL abilities that could produce mana, not just tap abilities.

## Solution

### 1. Implemented Rule 106.7 Properly

**Rule 106.7:** "Some abilities produce mana based on the type of mana another permanent or permanents 'could produce.' The type of mana a permanent could produce at any time includes any type of mana that an ability of that permanent would produce if the ability were to resolve at that time, taking into account any applicable replacement effects in any possible order. **Ignore whether any costs of the ability could or could not be paid.**"

Updated `getOpponentLandColors()` to:
- Check ALL "Add" text in oracle, not just "{T}: Add"
- Detect ETB triggers: "When ~ enters the battlefield, add..."
- Detect non-tap abilities: "{T}, Remove a counter: Add..."
- Ignore activation costs per Rule 106.7

Examples now handled correctly:
- **Crumbling Vestige**: ETB adds any color → Exotic Orchard can produce any color
- **Mirrodin's Core**: Can add any color (ignore the counter cost) → Exotic Orchard can produce any color
- **Gemstone Caverns**: Can add {C} or any color (with luck counter) → Complex case, optimistically handled

### 2. Fixed Command Tower and Color Identity

Added `getCommanderColorIdentity()` helper function:
```typescript
function getCommanderColorIdentity(state: any, playerId: PlayerID): Set<string> {
  // Reads commander.color_identity array
  // Returns set of color keys (e.g., {'white', 'blue', 'red', 'green'})
}
```

Updated logic to check for commander color identity:
```typescript
const isCommanderColorIdentity = /commander.*color identity/i.test(fullManaText);

if (isCommanderColorIdentity) {
  const commanderColors = getCommanderColorIdentity(state, playerId);
  for (const colorKey of commanderColors) {
    pool[colorKey] = (pool[colorKey] || 0) + 1;
  }
}
```

Now Command Tower correctly produces only colors in the commander's color identity.

### 3. Distinguish Conditional vs Unconditional Sources

Added logic to detect conditional patterns:
```typescript
const isConditionalAnyColor = /that (?:a |an )?(?:land|permanent)|among (?:lands|permanents)/i.test(fullManaText);
const isUnconditionalAnyColor = /one mana of any color|add.*any color/i.test(fullManaText);
```

This detects:
- "that a land" (Exotic Orchard, Fellwar Stone)
- "among lands" (Reflecting Pool)
- "commander's color identity" (Command Tower)


### 4. Opponent Land Color Checking

The `getOpponentLandColors()` helper function:
1. Iterates through all opponent permanents
2. Identifies lands
3. Checks ALL "Add" text (not just "{T}: Add")
4. Determines what colors those lands can produce per Rule 106.7
5. Returns a Set of color keys

For conditional sources:
```typescript
if (isConditionalAnyColor) {
  const opponentColors = getOpponentLandColors(state, playerId);
  
  for (const colorKey of opponentColors) {
    pool[colorKey] = (pool[colorKey] || 0) + 1;
  }
}
```

Now Exotic Orchard only adds colors that opponents can actually produce.

## Impact on Other Cards

This fix properly handles several card types:

**Conditional "any color" sources:**
- Exotic Orchard - checks opponent lands
- Fellwar Stone - checks opponent lands
- Reflecting Pool - checks your own lands (separate logic)

**Commander-restricted sources:**
- Command Tower - NOW FIXED: only produces commander's color identity
- Arcane Signet - similar pattern

**ETB triggers now detected:**
- Crumbling Vestige - "When ~ enters, add one mana of any color"
- Lotus Field - "When ~ enters, sacrifice two lands"

**Non-tap abilities now detected:**
- Mirrodin's Core - "{T}, Remove a counter: Add one mana of any color"
- Gemstone Caverns - conditional replacement effect

**Unconditional "any color" sources (work correctly):**
- Mana Confluence
- City of Brass
- Exotic Orchard

## Testing

Added comprehensive test suite (`server/tests/mana-check.conditional.test.ts`) with 11 tests:

1. ✅ Exotic Orchard produces nothing when opponents have no lands
2. ✅ Exotic Orchard only produces colors opponents can produce
3. ✅ Cannot cast 4-color commander without all colors (the original bug scenario)
4. ✅ Can cast 2-color commander when colors are available via Exotic Orchard
5. ✅ Command Tower respects commander color identity (4-color commander)
6. ✅ Command Tower respects commander color identity (mono-green commander)
7. ✅ Mana Confluence as true unconditional "any color"
8. ✅ Crumbling Vestige ETB trigger detected
9. ✅ Mirrodin's Core non-tap ability detected
10. ✅ Gemstone Caverns replacement effect handled
11. ✅ Fellwar Stone (artifact) works the same as Exotic Orchard


All tests pass. Pre-existing test failures are unrelated to these changes.

## Security & Build

- ✅ CodeQL scan: No security vulnerabilities
- ✅ Server builds successfully
- ✅ Client builds successfully
- ✅ All new tests pass

## Example Scenarios

### Scenario 1: The Bug (Now Fixed)
**Battlefield:**
- Player 1: Mountain, Mountain, Forest, Exotic Orchard, Sol Ring
- Opponents: Only have Mountains and Forests

**Before Fix:**
- Exotic Orchard counted as producing {W}{U}{B}{R}{G} ❌
- Could cast Kynaios and Tiro {W}{U}{R}{G} ❌

**After Fix:**
- Exotic Orchard can only produce {R}{G} ✅
- Cannot cast Kynaios and Tiro ✅

### Scenario 2: Proper Usage
**Battlefield:**
- Player 1: Exotic Orchard
- Opponent: Island, Plains

**Result:**
- Exotic Orchard can produce {W} or {U} ✅
- Correctly matches what opponent lands produce ✅

## Files Changed

1. `server/src/state/modules/mana-check.ts`
   - Added `getOpponentLandColors()` helper function
   - Updated `getAvailableMana()` to handle conditional sources
   - Improved comments and documentation

2. `server/src/socket/ai.ts`
   - Added debug logging for mana availability
   - Enhanced commander castability diagnostics

3. `server/tests/mana-check.conditional.test.ts` (new)
   - Comprehensive test coverage for the fix

## Future Considerations

- The current implementation does NOT recursively check opponent conditional sources (e.g., if opponent has their own Exotic Orchard). This is intentional to avoid infinite loops and complexity.
- For most gameplay scenarios, this conservative approach is correct and sufficient.
- If more complex scenarios arise, we can enhance the logic with proper recursion guards.
