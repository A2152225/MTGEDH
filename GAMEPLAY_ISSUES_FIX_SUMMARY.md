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

### 5. Exotic Orchard - Generating Multiple Mana
**Problem:** Exotic Orchard appears to generate more than 1 mana per tap.

**Investigation:** 
- Exotic Orchard has oracle text: "Add one mana of any color that a land an opponent controls could produce"
- The `getManaProduction()` function correctly identifies it can produce any color
- The issue may be related to mana doublers (Mana Reflection, etc.) being present but not accounted for in AI's `executeAICastSpell()` logic
- Human players use `interaction.ts` which has `getManaMultiplier()` and `getExtraManaProduction()`, but AI uses simplified logic in `ai.ts` that doesn't account for these effects

**Recommendation:** Update AI mana production logic to check for mana doublers before tapping lands for spells.

### 6. Nature's Claim - Life Gain Not Working
**Problem:** Player didn't gain life when Sol Ring was destroyed.

**Investigation:** Oracle text: "Destroy target artifact or enchantment. Its controller gains 4 life."

**Potential Issue:** Life gain triggers may not be detecting the controller of the destroyed permanent correctly, or the trigger isn't firing at all for instant-speed destruction.

**Recommendation:** Investigate life gain trigger detection for spell effects.

### 7. Elixir of Immortality - Not Shuffling Graveyard
**Problem:** Elixir taps but doesn't shuffle itself and graveyard into library.

**Investigation:** Oracle text: "{2}, {T}: You gain 5 life. Shuffle this artifact and your graveyard into their owner's library."

**Root Cause:** The shuffle effect is not implemented. This would require:
- Detecting the shuffle pattern in activated abilities
- Moving cards from graveyard to library
- Moving the artifact itself to library
- Shuffling the library
- Broadcasting state changes

**Recommendation:** Implement graveyard shuffle logic for Elixir and similar cards. This is a substantial feature addition.

### 8. Brash Taunter - Damage Trigger Not Firing After Fight
**Problem:** "Whenever this creature is dealt damage" trigger doesn't fire.

**Investigation:**
- Brash Taunter is in `KNOWN_DAMAGE_RECEIVED_TRIGGERS` table
- The `checkDamageDealtTriggers()` function exists and works during fights
- However, it's ONLY called in `interaction.ts` for fight resolution (lines 6349-6350)
- It's NOT called during combat damage, spell damage, or other damage sources

**Root Cause:** Damage triggers are only implemented for fight abilities, not for general damage.

**Recommendation:** Call `checkDamageDealtTriggers()` from:
- Combat damage resolution in `turn.ts` or `combat-mechanics.ts`
- Spell damage resolution in `stack.ts`
- Any other damage-dealing effects

This would require refactoring to make the function accessible across modules.

## Testing
- ✅ All TypeScript compilation errors fixed
- ✅ Server builds successfully
- ✅ Client builds successfully
- ⚠️ Manual testing needed to verify:
  - Players properly eliminated at life 0
  - Growing Rites rejected when played as land
  - Brash Taunter can target tapped creatures

## Files Modified
- `server/src/rules-engine/index.ts` - SBA for player loss
- `server/src/state/modules/counters_tokens.ts` - Process player loss
- `server/src/socket/ai.ts` - Transform card land detection
- `server/src/socket/game-actions.ts` - Transform card validation
- `client/src/App.tsx` - Fight target filtering
- `shared/src/types.ts` - PlayerRef type update

## Impact
- **Critical fixes:** 3/6 issues fully resolved
- **Build status:** ✅ Compiles successfully
- **Remaining work:** 3 issues require more extensive implementation
