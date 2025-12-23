# Steel Hellkite Implementation Example

## Card Text
**Steel Hellkite** {6}
Artifact Creature — Dragon

Flying
{2}: This creature gets +1/+0 until end of turn.
{X}: Destroy each nonland permanent with mana value X whose controller was dealt combat damage by this creature this turn. Activate only once each turn.

## Implementation Flow

### Phase 1: Combat Damage
```
Turn Player attacks with Steel Hellkite
↓
Steel Hellkite deals combat damage to opponent
↓
Server tracks: steelHellkite.dealtCombatDamageTo = Set(['opponent_id'])
```

### Phase 2: Activate X Ability
```
Player clicks Steel Hellkite's X ability button
↓
Modal appears: "Choose X Value for Steel Hellkite"
Player selects X = 3 (using slider or number input)
↓
Client emits: socket.emit('activateAbility', {
  gameId,
  permanentId: 'steel_hellkite_id',
  abilityIndex: 2,
  xValue: 3
})
```

### Phase 3: Server Processing
```
Server receives activation request
↓
Validates:
  ✓ Steel Hellkite dealt combat damage this turn
  ✓ X value provided (3)
  ✓ Ability not activated yet this turn
↓
Finds all nonland permanents with mana value 3
controlled by players in dealtCombatDamageTo Set
↓
Destroys matching permanents:
  - Opponent's 3-mana creature (destroyed)
  - Opponent's 3-mana artifact (destroyed)
  - Opponent's land (skipped - is a land)
  - Other player's 3-mana permanent (skipped - wasn't damaged)
↓
Marks: steelHellkite.activatedThisTurn = true
↓
Returns: "Steel Hellkite: Destroyed 2 permanent(s) with mana value 3"
```

### Phase 4: End of Turn Cleanup
```
Cleanup step begins
↓
Server clears:
  - steelHellkite.dealtCombatDamageTo (damage tracking)
  - steelHellkite.activatedThisTurn (activation flag)
↓
Ready for next turn
```

## Example Scenarios

### Scenario 1: Basic Usage
- Turn 5: Steel Hellkite deals 5 damage to Player B
- Main Phase 2: Activate with X=3
- Result: Destroys all of Player B's 3-mana permanents

### Scenario 2: Multiple Opponents
- Turn 7: Steel Hellkite deals damage to both Player B and Player C
- Main Phase 2: Activate with X=2
- Result: Destroys all 2-mana permanents controlled by both Player B and C

### Scenario 3: No Damage Dealt
- Turn 4: Steel Hellkite is blocked, deals no player damage
- Try to activate X ability
- Result: Error - "Steel Hellkite has not dealt combat damage to any players this turn"

### Scenario 4: Once Per Turn
- Turn 6: Steel Hellkite deals damage to Player B
- Main Phase 2: Activate with X=4 (destroys permanents)
- Try to activate again with X=2
- Result: Error - "This ability can only be activated once per turn"

## Code Files Modified

### New File: `server/src/state/modules/x-activated-abilities.ts`
- Registry of X-cost activated abilities
- `executeSteelHellkiteAbility()` implementation
- Combat damage tracking helpers
- Mana value calculation

### Modified: `server/src/socket/automation.ts`
- Integrated X-ability handling in `processActivateAbility()`
- Validates X value and combat damage
- Calls Steel Hellkite execution logic

### Modified: `server/src/state/modules/turn.ts`
- `dealCombatDamage()`: Tracks Steel Hellkite combat damage
- `endTemporaryEffects()`: Clears damage tracking at end of turn

## Similar Cards Supported

The registry in `x-activated-abilities.ts` includes:

1. **Steel Hellkite** - Destroy permanents with mana value X
2. **Heliod, the Radiant Dawn** - Target creature with mana value X gains lifelink
3. **Ramos, Dragon Engine** - Remove X counters, add X mana

Additional cards can be added following the same pattern.
