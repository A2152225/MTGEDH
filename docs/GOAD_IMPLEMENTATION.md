# Goad Mechanic Implementation Summary

## Overview
This implementation adds full support for the goad mechanic (MTG Rule 701.15) to the MTGEDH platform, including automatic enforcement of goad rules for both AI and human players.

## What is Goad?
Goad is a keyword action that forces creatures to attack if able, with the restriction that goaded creatures cannot attack the player who goaded them (unless that player is the only valid attack target).

### MTG Rules Reference
- **Rule 701.15**: Goad definition
- **Rule 701.15a**: Duration - until the next turn of the goading player
- **Rule 701.15b**: Goaded creatures must attack each combat if able, and must attack a player other than the goader if able
- **Rule 701.15c**: Multiple goad effects - a creature can be goaded by multiple players
- **Rule 701.15d**: Redundant goad - same player goading again has no effect

## Implementation Details

### 1. Data Model (`shared/src/types.ts`)
Added to `BattlefieldPermanent` interface:
```typescript
goadedBy?: string[];              // Player IDs who have goaded this creature
goadedUntil?: Readonly<Record<string, number>>; // Map of player ID -> turn number when goad expires
```

### 2. Core Combat Logic (`rules-engine/src/actions/combat.ts`)
New functions added:
- `isGoaded(permanent, currentTurn?)` - Check if creature is currently goaded
- `getGoadedBy(permanent, currentTurn?)` - Get active goaders with expiration filtering
- `getGoadedAttackTargets(permanent, allPlayers, currentTurn?)` - Determine valid attack targets
- `canGoadedCreatureAttack(permanent, targetPlayerId, allPlayers, currentTurn?)` - Validate attack legality
- `getGoadedAttackers(state, playerId)` - Get all goaded creatures that must attack

Enhanced `validateDeclareAttackers()` to:
- Verify all goaded creatures are attacking (if able)
- Prevent goaded creatures from attacking their goaders (unless only option)
- Support multiple simultaneous goad effects

### 3. AI Integration (`rules-engine/src/AIEngine.ts`)
Updated `makeBasicAttackDecision()` to:
- Automatically attack with all goaded creatures
- Select valid non-goader targets (lowest life heuristic)
- Attack goader when no other options exist
- Handle multiple goaders correctly
- Respect normal attack restrictions (tapped, summoning sickness, defender)

### 4. Server-Side Helpers (`server/src/state/modules/goad-effects.ts`)
Provides helper functions for applying goad effects and **unified goad detection**:

#### Goad Detection (delegates to rules-engine)
```typescript
getCurrentGoaders(creature, battlefield, currentTurn?)
isCreatureGoaded(creature, battlefield, currentTurn?)
```
These wrap `getGoadedBy()` from `rules-engine/src/actions/combat.ts`, which handles:
- Keyword-action goad (`goadedBy` / `goadedUntil`)
- Static conditional goad (Baeloth Barrityl: power comparison via `applyStaticAbilitiesToBattlefield`)
- Attached aura/equipment that grant "equipped/enchanted creature … is goaded"
- Legacy `{ goaded: { [playerId]: true } }` replay shape (server-only merge)

Server combat, `can-respond`, and `skipToPhase` goad enforcement all use `getCurrentGoaders`.

#### Single/Multiple Creature Goad
```typescript
applyGoadToCreature(creature, goaderId, expiryTurn)
applyGoadToCreatures(creatures, goaderId, expiryTurn)
```

#### Mass Goad Effects
```typescript
goadAllCreaturesControlledBy(battlefield, targetPlayerId, goaderId, expiryTurn)
```

#### Conditional Goad
```typescript
applyConditionalGoad(battlefield, goaderId, expiryTurn, condition)
```
Example: `baelothGoadCondition(baelothPower, baelothController)` - for Baeloth Barrityl

#### Automatic Cleanup
```typescript
removeExpiredGoads(battlefield, currentTurn, currentPlayerId)
```
Integrated into turn system (`server/src/state/modules/turn.ts`) to automatically remove expired goad effects at the start of each player's turn.

### 5. UI Implementation (`client/src/components/CombatSelectionModal.tsx`)
- Added `goaded` and `goadedBy` to `DangerIndicators` interface
- Orange 🎯GOAD badge displayed on goaded creatures
- Tooltip shows goad status and count of goaders
- Badge appears first in ability list for visibility

## Usage Examples

### Example 1: Simple Goad Effect
```typescript
// Card: "Goad target creature" 
const creature = battlefield.find(p => p.id === targetId);
if (creature) {
  const goadedCreature = applyGoadToCreature(
    creature,
    castingPlayerId,
    currentTurn + getTurnOffset(castingPlayerId, turnOrder)
  );
  // Update battlefield with goaded creature
}
```

### Example 2: Mass Goad
```typescript
// Card: "Goad all creatures target player controls"
const updatedBattlefield = goadAllCreaturesControlledBy(
  battlefield,
  targetPlayerId,
  castingPlayerId,
  expiryTurn
);
```

### Example 3: Conditional Goad (Baeloth Barrityl)
```typescript
// "Creatures your opponents control with power less than Baeloth's power are goaded"
const baelothPower = getEffectivePower(baeloth);
const condition = baelothGoadCondition(baelothPower, baelothController);
const updatedBattlefield = applyConditionalGoad(
  battlefield,
  baelothController,
  expiryTurn,
  condition
);
```

## Test Coverage

### Unit Tests (`rules-engine/test/goad.test.ts`) - 25 tests
- Basic goad detection
- Multiple goaders support
- Expiration tracking
- Valid target determination
- Attack validation with goad restrictions
- Static Baeloth goad via battlefield scan
- Edge cases (goader as only option)

### AI Integration Tests (`rules-engine/test/goad-ai-integration.test.ts`) - 5 tests  
- AI forces goaded creatures to attack
- AI selects valid non-goader targets
- AI attacks goader when only option
- AI handles multiple goaded creatures
- AI respects tapped/summoning sickness

### Server Tests
- `server/tests/goad-static-death.unit.test.ts` — static goad detection, death clause matching (6 tests)
- `server/tests/goad-baeloth.integration.test.ts` — skipToPhase block, non-goaded skip allowed, Treasure on stack resolve (3 tests)
- Existing: `can-respond.test.ts` (Bloodthirsty Blade equipped goad), Oracle IR goad trigger/spell tests

**All goad-focused tests passing ✅**

## Verification

### Compilation Status
- ✅ Client: Compiles successfully
- ✅ Server: No new errors introduced (28 pre-existing errors remain)
- ✅ Rules Engine: Compiles successfully
- ✅ Shared: Compiles successfully

### Integration Points
- ✅ Combat validation system
- ✅ AI decision engine
- ✅ Turn transition system (automatic expiration)
- ✅ UI combat modal
- ✅ Type system (shared types)

## Known Limitations & Future Work

### Current Scope
This implementation provides **full goad rule enforcement** including keyword-action goad (Oracle IR `kind: 'goad'`), static conditional goad (Baeloth), attached equipment/aura goad, skip-past-combat blocking, and Baeloth's death trigger.

### Remaining gaps
- Client UI may not show static goad badge when only `staticGoadedBy` applies (no `goadedBy` array)
- Replay event coverage for Baeloth death trigger + skipToPhase goad block not yet added

### Recommended Next Steps
1. Client goad indicator for static/attached goad (read `getCurrentGoaders` or sync `staticGoadedBy` to view)
2. Replay integration tests for skipToPhase goad block and Baeloth treasure death
3. Continue Oracle IR migration batch 265 — see `docs/oracle-ir-session-handoff.md`

## Card Examples to Implement

### Direct Goad
- **Disrupt Decorum** - "Goad all creatures your opponents control"
- **Karazikar, the Eye Tyrant** - "Whenever an opponent attacks another opponent, draw a card and that creature gains first strike"
- **Propaganda** variants with goad riders

### Conditional Goad
- **Baeloth Barrityl, Entertainer** - "Creatures your opponents control with power less than Baeloth's power are goaded"

### Goad on Trigger
- **Bloodthirsty Blade** (Equipment) - "Equipped creature gets +2/+0 and is goaded"
- **Vengeful Ancestor** - "Goad all creatures you don't control"

## Files Modified

### New Files
1. `rules-engine/test/goad.test.ts` - Unit tests
2. `rules-engine/test/goad-ai-integration.test.ts` - AI integration tests
3. `server/src/state/modules/goad-effects.ts` - Server helper functions

### Modified Files
1. `shared/src/types.ts` - Added goad fields to BattlefieldPermanent
2. `rules-engine/src/actions/combat.ts` - Combat validation and helpers
3. `rules-engine/src/AIEngine.ts` - AI attack decisions with goad
4. `server/src/state/modules/turn.ts` - Expiration cleanup
5. `client/src/components/CombatSelectionModal.tsx` - UI indicator

## Conclusion
The goad mechanic is now fully integrated into the game engine with:
- ✅ Complete rule enforcement
- ✅ AI support
- ✅ UI indicators  
- ✅ Comprehensive testing
- ✅ Helper functions for card implementation
- ✅ Automatic expiration handling

The infrastructure is ready for implementing specific goad cards and effects.
