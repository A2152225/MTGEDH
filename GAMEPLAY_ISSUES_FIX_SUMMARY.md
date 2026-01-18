# Gameplay Issues Fix Summary

## Overview
This PR addresses multiple critical gameplay issues reported during testing, including AI behavior bugs, card-specific logic errors, and missing game rules implementation.

## Issues Fixed

### 1. AI Life Below 1 - Players Not Being Eliminated ✅
**Problem:** AI players with life <= 0 continued to be attacked and remained active in the game.

**Root Cause:** The `applyStateBasedActions` function in the rules engine only checked creature death conditions, not player loss conditions (Rule 704.5a).

**Solution:**
- Modified `server/src/rules-engine/index.ts`:
  - Updated `EngineSBAResult` type to include `playersLost: readonly string[]`
  - Added player life check to `applyStateBasedActions()` - players with life <= 0 are marked as lost
- Modified `server/src/state/modules/counters_tokens.ts`:
  - Updated `runSBA()` to process `playersLost` array
  - Sets `player.hasLost = true` and `player.lostReason` for players who lose
- Modified `shared/src/types.ts`:
  - Added `lostReason?: string` property to `PlayerRef` interface

**Commit:** 9bac456

### 2. Growing Rites of Itlimoc - Playing Enchantment as Land ✅
**Problem:** AI and players could play "Growing Rites of Itlimoc" (a transform card with "Legendary Enchantment // Legendary Land" type line) as a land, even though only the back face is a land.

**Root Cause:** Both `isLandCard()` in AI logic and `playLand` validation used simple pattern matching on the full type_line string, which matched "// Legendary Land" on the back face.

**Solution:**
- Modified `server/src/socket/ai.ts`:
  - Updated `isLandCard()` to check transform card layouts
  - For transform/double_faced_token cards, checks only the front face type_line
- Modified `server/src/socket/game-actions.ts`:
  - Updated `playLand` handler to check front face for transform cards
  - Provides clear error message: "must be cast as a spell, not played as a land"

**Commit:** 9bac456

### 3. Brash Taunter - Can't Target Tapped Creatures ✅
**Problem:** Fight abilities couldn't select tapped creatures as targets.

**Root Cause:** The fight modal in the client had a hard-coded `controller: 'opponent'` filter and didn't receive the `targetFilter` from the server. While `tapStatus: 'any'` was set, the controller filter was incorrect.

**Solution:**
- Modified `client/src/App.tsx`:
  - Added `targetFilter` to `fightTargetModalData` state type
  - Updated `handleFightTargetRequest` to store `targetFilter` from server
  - Modified fight modal rendering to use server-provided filter values
  - Controller now correctly comes from `fightTargetModalData.targetFilter.controller`

**Commit:** 6f37b19

### 4. TypeScript Compilation Errors ✅
**Problem:** Build failed with duplicate variable declarations and missing type properties.

**Solution:**
- Fixed duplicate declarations of `layout` and `cardFaces` in `playLand` handler (changed to `let` at first occurrence)
- Added `lostReason?: string` to `PlayerRef` interface

**Commit:** 81dfa54

## Issues Identified But Not Fixed

### 5. Exotic Orchard / conditional “any color” mana (AI + validation) ✅
**Problem (original report):** AI could treat Exotic Orchard as unconditional “any color”, enabling illegal casts.

**Current status:** Implemented.
- `server/src/state/modules/mana-check.ts` now distinguishes unconditional “any color” from conditional sources (Exotic Orchard / Fellwar Stone / similar) and evaluates conditional colors via opponent permanents.
- AI uses the shared `getAvailableMana()` from `mana-check.ts`.

**Notes / remaining risk:** If there are still AI miscasts, the next likely gap is *mana multipliers / doublers during payment*, not Exotic Orchard itself.

### 6. Nature’s Claim life gain ✅
**Problem (original report):** Controller of the destroyed artifact/enchantment didn’t gain 4 life.

**Current status:** Implemented.
- `server/src/state/modules/stack.ts` captures the target permanent’s controller before destruction and applies the 4 life gain on resolution.

### 7. Elixir of Immortality shuffle ✅
**Problem (original report):** Elixir gained life but didn’t shuffle itself + graveyard into library.

**Current status:** Implemented.
- `server/src/state/modules/zone-manipulation.ts` provides `handleElixirShuffle()`.
- `server/src/state/modules/stack.ts` calls that helper when resolving the Elixir pattern.

### 8. “Whenever this creature is dealt damage” triggers (Brash Taunter, Boros Reckoner, etc.) ✅
**Problem (original report):** Damage-received triggers weren’t firing broadly (only fight).

**Current status:** Implemented.
- Damage-received triggers are queued via `processDamageReceivedTriggers()` from:
  - Combat damage (turn module)
  - Fight resolution (resolution queue handler)
  - Spell/ability damage patterns (stack module)
- Pending triggers are emitted to the controller for target selection from `server/src/socket/game-actions.ts` (via `checkAndEmitDamageTriggers()`).

**Note:** The UX is driven by priority flow (damage triggers are emitted after `passPriority` runs), so a game state that never advances priority won’t surface them.

## Testing
- ✅ All TypeScript compilation errors fixed
- ✅ Server builds successfully
- ✅ Client builds successfully
- ⚠️ Manual testing needed to verify:
  - Players properly eliminated at life 0
  - Growing Rites rejected when played as land
  - Brash Taunter can target tapped creatures
  - Nature’s Claim grants 4 life to the destroyed permanent’s controller
  - Elixir of Immortality shuffles graveyard + itself into library

## Files Modified
- `server/src/rules-engine/index.ts` - SBA for player loss
- `server/src/state/modules/counters_tokens.ts` - Process player loss
- `server/src/socket/ai.ts` - Transform card land detection
- `server/src/socket/game-actions.ts` - Transform card validation
- `client/src/App.tsx` - Fight target filtering
- `shared/src/types.ts` - PlayerRef type update

## Impact
- **Critical fixes:** 4/4 issues listed above are implemented
- **Build status:** ✅ Compiles successfully
- **Remaining work:** Follow-ups are primarily regression tests + edge cases (e.g., AI mana doublers during payment)
