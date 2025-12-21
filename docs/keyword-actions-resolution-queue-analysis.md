# Keyword Actions Resolution Queue Integration Analysis

**Date:** December 21, 2024  
**Task:** Verify which keyword actions are implemented and can work properly with the resolution queue

## Executive Summary

Out of **66 keyword actions** implemented in the rules-engine:
- **~50 actions** are deterministic and don't require queue integration (they happen automatically)
- **3 actions** are fully integrated with the resolution queue
- **3-5 actions** are partially integrated (have type definitions but need handlers)
- **5-8 actions** may need investigation for queue integration

## Categories of Keyword Actions

### Category 1: Deterministic Actions (No Player Choice Needed)

These actions happen automatically when triggered. **No queue integration needed.**

**Zone Movement Actions:**
- `exile` - Moves to exile zone, automatic
- `destroy` - Destroys permanent, automatic
- `sacrifice` - Sacrifices permanent, automatic

**State Change Actions:**
- `attach` - Moves attachment to object, automatic
- `tap/untap` - Changes tap state, automatic
- `transform` - Transforms double-faced card, automatic
- `convert` - Converts transforming double-faced card, automatic
- `exert` - Exerts permanent, automatic
- `detain` - Prevents actions until next untap, automatic
- `goad` - Goads creature, automatic
- `suspect` - Suspects creature, automatic
- `cloak` - Cloaks permanent, automatic
- `regenerate` - Creates regeneration shield, automatic

**Token/Counter Actions:**
- `create` - Creates tokens, automatic
- `populate` - Copies a token, automatic
- `investigate` - Creates Clue token, automatic
- `incubate` - Creates Incubator token, automatic
- `adapt` - Adds +1/+1 counters if not adapted, automatic
- `support` - Adds +1/+1 counters to target creatures, automatic
- `bolster` - Adds counters to weakest creature, automatic
- `amass` - Creates/modifies Army token, automatic
- `monstrosity` - Adds counters and makes monstrous, automatic
- `endure` - Creates token, automatic
- `harness` - Adds energy counters, automatic

**Special Mechanics:**
- `activate` - References Rule 602, handled by activated ability system
- `behold` - Reveals a quality, automatic
- `cast` - References Rule 601, handled by spell casting system
- `counter` - Counters spell/ability, automatic
- `shuffle` - Shuffles library, automatic
- `fight` - Creatures deal damage to each other, automatic
- `meld` - Melds cards, automatic
- `assemble` - Assembles Contraption, automatic
- `collect evidence` - Exiles from graveyard with mana value, automatic
- `forage` - Exiles from graveyard or sacrifices Food, automatic
- `manifest` - Creates face-down creature, automatic
- `manifest dread` - Creates face-down creatures, automatic
- `explore` - Reveals and optionally puts +1/+1 counter, automatic
- `connive` - Draw and discard, automatic
- `learn` - Creates Lesson token or discards, automatic
- `venture into dungeon` - Advances in dungeon, automatic
- `ring tempts you` - Tempts with the Ring, automatic
- `time travel` - Manipulates time counters, automatic
- `discover` - Exiles until lower MV, choice to cast (similar to cascade)
- `villainous choice` - Creates choice for opponent, automatic
- `airbend`, `earthbend`, `waterbend` - Avatar-specific, automatic
- `double`, `triple` - Double/triple value, usually automatic
- `exchange` - Exchange control/life/etc, automatic with specified targets
- `play` - Play a land or cast a spell (handled by regular game flow)
- `reveal` - Reveal cards (usually automatic, player knows what to reveal)

### Category 2: Actions with Player Choices (NEED Queue Integration)

These require the player to make decisions during resolution.

#### ✅ Fully Integrated with Resolution Queue

1. **CASCADE** (`ResolutionStepType.CASCADE`)
   - ✅ Has type definition
   - ✅ Has handler in `handleStepResponse()`
   - ✅ Client integration complete
   - Status: **Fully Implemented**

2. **LIBRARY_SEARCH** (`ResolutionStepType.LIBRARY_SEARCH`)
   - ✅ Has type definition
   - ✅ Has handler in `handleStepResponse()`
   - ✅ Used for various search effects
   - Status: **Fully Implemented**

3. **PONDER_EFFECT** (`ResolutionStepType.PONDER_EFFECT`)
   - ✅ Has type definition
   - ✅ Has case in switch statement
   - ✅ Handles Ponder, Preordain, Brainstorm variants
   - Status: **Fully Implemented**

#### 🔶 Partially Integrated (Have Type, Need Handler)

4. **SCRY** (`ResolutionStepType.SCRY`)
   - ✅ Has type definition in `types.ts`
   - ✅ Has `ScryStep` interface
   - ✅ Mapped in `LEGACY_PENDING_TO_STEP_TYPE`
   - ✅ Has case in switch for field extraction
   - ❌ **Missing handler in `handleStepResponse()`**
   - Current: Uses legacy `beginScry`/`confirmScry` socket handlers
   - Priority: **HIGH** (very common mechanic)
   - Next Step: Implement `handleScryResponse()`

5. **SURVEIL** (`ResolutionStepType.SURVEIL`)
   - ✅ Has type definition in `types.ts`
   - ✅ Mapped in `LEGACY_PENDING_TO_STEP_TYPE`
   - ❌ No interface defined
   - ❌ **Missing handler in `handleStepResponse()`**
   - Current: Uses legacy `beginSurveil`/`confirmSurveil` socket handlers
   - Priority: **HIGH** (common mechanic)
   - Next Step: Create `SurveilStep` interface and `handleSurveilResponse()`

6. **PROLIFERATE** (`ResolutionStepType.PROLIFERATE`)
   - ✅ Has type definition in `types.ts`
   - ✅ Mapped in `LEGACY_PENDING_TO_STEP_TYPE`
   - ❌ No interface defined
   - ❌ **Missing handler in `handleStepResponse()`**
   - Current: Uses `pendingProliferate` array pattern
   - Priority: **HIGH** (common in certain deck types)
   - Next Step: Create `ProliferateStep` interface and `handleProliferateResponse()`

7. **DISCARD_EFFECT** (`ResolutionStepType.DISCARD_EFFECT`)
   - ✅ Has type definition in `types.ts`
   - ✅ Mapped in `LEGACY_PENDING_TO_STEP_TYPE` as `pendingDiscard`
   - ❌ Different from `DISCARD_SELECTION` (which is already handled)
   - Current: Uses `pendingDiscard` state pattern
   - Analysis: May be redundant with `DISCARD_SELECTION`
   - Priority: **MEDIUM** (investigate if needed)

8. **MILL** (`ResolutionStepType.MILL`)
   - ✅ Has type definition in `types.ts`
   - ✅ Mapped in `LEGACY_PENDING_TO_STEP_TYPE`
   - Current: Uses `pendingMill` state pattern
   - Analysis: Mill is deterministic - queue may only be for tracking triggers
   - Priority: **LOW** (may not need queue integration)

#### ❓ Need Investigation (May Need Queue Integration)

9. **VOTE** (keyword action defined in rules-engine)
   - Has implementation in `rules-engine/src/keywordActions/vote.ts`
   - Multiplayer mechanic where each player votes
   - Should use queue for APNAP ordering
   - Priority: **MEDIUM**
   - Next Step: Check if already handled elsewhere

10. **FATESEAL** (keyword action defined in rules-engine)
    - Similar to scry but for opponent's library
    - Has implementation in `rules-engine/src/keywordActions/fateseal.ts`
    - Priority: **MEDIUM**
    - Next Step: Check if needs queue integration

11. **CLASH** (keyword action defined in rules-engine)
    - Reveal top card, choose to put on bottom
    - Has implementation in `rules-engine/src/keywordActions/clash.ts`
    - Priority: **LOW** (less common)

12. **PLANESWALK** (keyword action defined in rules-engine)
    - Planar die or planeswalk to new plane
    - Planechase variant
    - Priority: **LOW** (casual variant)

13. **SET IN MOTION** / **ABANDON** (Archenemy)
    - Archenemy-specific mechanics
    - Priority: **LOW** (casual variant)

14. **OPEN ATTRACTION** / **ROLL VISIT ATTRACTIONS** (Un-set)
    - Un-set specific mechanics
    - Priority: **LOW** (casual/un-set)

## Summary Statistics

| Category | Count | Status |
|----------|-------|--------|
| Deterministic (No queue needed) | ~50 | ✅ Complete |
| Fully Integrated | 3 | ✅ Complete |
| Partially Integrated (High Priority) | 3 | 🔶 Need handlers |
| Partially Integrated (Medium/Low) | 2 | 🔶 Need investigation |
| Need Investigation | 6 | ❓ Research needed |
| **Total Keyword Actions** | **66** | |

## Implementation Priority

### 🔴 High Priority (Common, Partially Implemented)

1. **SCRY** - Migrate from legacy socket handlers to resolution queue
   - Implement `handleScryResponse()` 
   - Test with common scry cards
   - Remove legacy handlers

2. **SURVEIL** - Migrate from legacy socket handlers to resolution queue
   - Create `SurveilStep` interface
   - Implement `handleSurveilResponse()`
   - Test with surveil cards
   - Remove legacy handlers

3. **PROLIFERATE** - Migrate from array pattern to resolution queue
   - Create `ProliferateStep` interface
   - Implement `handleProliferateResponse()`
   - Test with proliferate cards
   - Migrate from `pendingProliferate` array

### 🟡 Medium Priority

4. **VOTE** - Investigate and potentially implement
5. **FATESEAL** - Investigate and potentially implement
6. **DISCARD_EFFECT** - Determine if redundant with DISCARD_SELECTION

### 🟢 Low Priority (Specialized/Uncommon)

7. **CLASH** - Less common mechanic
8. **MILL** - May not need queue (deterministic)
9. Archenemy mechanics (PLANESWALK, SET IN MOTION, ABANDON)
10. Un-set mechanics (OPEN ATTRACTION, ROLL VISIT ATTRACTIONS)

## Next Steps

1. ✅ Complete this analysis document
2. Begin implementing high-priority handlers:
   - Start with SCRY (most common)
   - Then SURVEIL
   - Then PROLIFERATE
3. Follow the pattern from CASCADE migration (see commits a8b85b5, 6d7574d, d32732b)
4. Test each implementation thoroughly
5. Update resolution queue README with new patterns

## References

- Resolution Queue System: `/server/src/state/resolution/README.md`
- Resolution Types: `/server/src/state/resolution/types.ts`
- Resolution Handlers: `/server/src/socket/resolution.ts`
- Keyword Actions: `/rules-engine/src/keywordActions/`
- CASCADE Migration Example: Best reference for implementation pattern
