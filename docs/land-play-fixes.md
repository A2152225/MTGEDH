# Land Play and Turn Management Fixes

## Summary

Fixed multiple issues related to playing lands from hand, including zone management, turn-based land limits, and battlefield display.

## Issues Fixed

### 1. Lands not removed from hand when played
**Problem:** When playing a land, the card object remained in the player's hand zone while also appearing on the battlefield.

**Solution:** Updated `playLand()` function in `server/src/state/modules/stack.ts` to:
- Accept both card ID (from socket) and card object (from event replay)
- Find the card in the player's hand by ID
- Remove the card from the hand array
- Update the hand count
- Add the permanent to battlefield with complete card data

### 2. Unable to play lands on subsequent turns
**Problem:** The `landsPlayedThisTurn` counter was never reset, preventing players from playing lands after the first turn.

**Solution:** Updated turn advancement in `server/src/state/modules/turn.ts`:
- `nextTurn()` now resets `landsPlayedThisTurn` to 0 for all players
- `nextStep()` calls `nextTurn()` when advancing from cleanup step
- Land counter properly resets at the start of each new turn

### 3. No validation preventing multiple lands per turn
**Problem:** Server didn't validate the land-per-turn limit.

**Solution:** Added validation in `server/src/socket/game-actions.ts`:
- Check `landsPlayedThisTurn` before processing playLand request
- Return clear error message: "You have already played a land this turn"
- Client already had UI feedback via `reasonCannotPlayLand()`

### 4. Lands showing as placeholder IDs instead of card data
**Problem:** When a land was played, the permanent showed `perm_fy8ia570` instead of the actual card name/image.

**Solution:** 
- `playLand()` now properly extracts and preserves all card data when moving from hand to battlefield
- The card object passed to the permanent includes: id, name, type_line, oracle_text, image_uris, etc.
- Client's `LandRow` component already filters and displays lands correctly using `isLandTypeLine()`

### 5. Missing enum values
**Problem:** Tests referenced `GamePhase.PRECOMBAT_MAIN`, `GamePhase.POSTCOMBAT_MAIN`, `GameStep.END`, and `GameStep.CLEANUP` which didn't exist in the shared type definitions.

**Solution:** Added missing enum values in `shared/src/types.ts`:
- `GamePhase`: PRECOMBAT_MAIN, POSTCOMBAT_MAIN, END
- `GameStep`: END, CLEANUP

## Files Modified

### Core Logic
- `server/src/state/modules/stack.ts` - Fixed `playLand()` to remove card from hand
- `server/src/state/modules/turn.ts` - Reset land counter in `nextTurn()` and `nextStep()`
- `server/src/socket/game-actions.ts` - Added validation to prevent multiple lands per turn

### Type Definitions  
- `shared/src/types.ts` - Added missing GamePhase and GameStep enum values

### Tests
- `server/tests/turn.lands.test.ts` - Added comprehensive tests:
  - Verify land is removed from hand when played
  - Verify land appears on battlefield with correct card data
  - Verify land counter increments and resets
  - Verify can play one land per turn across multiple turns

### Supporting Files
- `server/src/state/gameState.ts` - Created re-export for test compatibility

## Testing

New tests verify:
1. Playing a land removes it from hand and updates hand count
2. Land appears on battlefield with complete card data (not just ID)
3. `landsPlayedThisTurn` increments when land is played
4. `landsPlayedThisTurn` resets to 0 for all players on turn advancement
5. Can play exactly one land per turn, with ability restored each new turn

## Client-Side Integration

The client already has the necessary UI components in place:
- `LandRow` component displays lands in a dedicated section
- `isLandTypeLine()` function filters lands using regex `/\bland\b/i`
- `reasonCannotPlayLand()` provides user feedback when lands can't be played
- `HandGallery` displays "Land ✕" badge on lands that can't be played

No client changes were needed - the fixes work seamlessly with existing UI.

## Validation Flow

1. **Client side:** User double-clicks land in hand
2. **Client validation:** `reasonCannotPlayLand()` checks:
   - Is it your turn?
   - Are you in a main phase?
   - Have you already played a land this turn?
3. **Socket emission:** If valid, emits `playLand` event with cardId
4. **Server validation:** Game action handler checks:
   - Land limit not exceeded
   - (Rules engine validation if enabled)
5. **State update:** `playLand()` function:
   - Finds card in hand by ID
   - Removes from hand, updates count
   - Adds to battlefield with full card data
   - Increments `landsPlayedThisTurn`
6. **Client update:** State broadcast triggers re-render
   - Hand shows one fewer card
   - Land appears in dedicated land section
   - Land shows proper name/image (not placeholder ID)

## Turn Advancement Flow

1. **Next Turn button clicked** or **Next Step advances through cleanup**
2. **`nextTurn()` called:**
   - Advances to next player
   - Sets phase to "beginning", step to "UNTAP"  
   - Sets priority to new active player
   - **Resets `landsPlayedThisTurn[playerId] = 0` for all players**
3. **State broadcast:** All players see updated turn/priority
4. **Next turn:** Active player can now play another land

## Additional Notes

- Land type detection is case-insensitive: `/\bland\b/i`
- Supports all land types: Basic Land, Snow Land, Artifact Land, Creature Land, etc.
- Works with both cardId (socket) and card object (event replay)
- Backward compatible with rules engine when enabled
