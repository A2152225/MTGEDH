# Control Change Mechanics Implementation

## Overview

This document describes the implementation of control change mechanics for cards like **Humble Defector** and similar effects that transfer control of permanents between players.

## Architecture

### Components

1. **Backend (Server)**
   - Socket handlers for control change requests and confirmations
   - Activated ability detection and validation
   - AI player auto-selection logic

2. **Frontend (Client)**
   - UI modal for opponent selection
   - Event handling for control change requests
   - Confirmation flow back to server

3. **Rules Engine**
   - Activated ability registry with control change flags
   - AI evaluation of control-swapping abilities

4. **Testing**
   - Unit tests for control change mechanics
   - Registry validation tests

## How It Works

### Activation Flow

1. **Player Activates Ability**
   - Player clicks on Humble Defector's tap ability button
   - Client emits `activateBattlefieldAbility` event with card and ability ID

2. **Server Validation**
   - Server checks if ability matches control change pattern in registry
   - Validates costs (mana, tap, timing restrictions)
   - For Humble Defector: validates it's the player's turn

3. **Cost Payment**
   - Server immediately pays costs (taps permanent, consumes mana)
   - Stores pending activation with metadata (card name, draw count, etc.)

4. **Opponent Selection**
   - Server gathers valid opponents (alive, not the activating player)
   - Emits `controlChangeOpponentRequest` to player
   - For AI: Automatically selects random opponent after 500ms delay

5. **Confirmation**
   - Player (or AI) selects opponent
   - Client emits `confirmControlChangeOpponent` with selected opponent ID
   - Server processes the effect

6. **Effect Resolution**
   - Draw cards if specified (e.g., Humble Defector draws 2)
   - Change permanent's `controller` property
   - Keep `owner` property unchanged (important for tracking original owner)
   - Broadcast state change to all players

## Key Files

### Backend
- `server/src/socket/interaction.ts` - Main control change logic
  - Lines 2805-2970: Control change ability detection and processing
- `server/src/socket/game-actions.ts` - General control change handler
  - Lines 8240-8306: `changePermanentControl` event handler

### Frontend
- `client/src/App.tsx` - UI state and event handling
  - Lines 620-646: Control change opponent modal state
  - Lines 2063-2102: Socket event listener
  - Lines 4924-4981: Modal rendering

### Rules Engine
- `rules-engine/src/cards/activatedAbilityCards.ts` - Card registry
  - Lines 94-102: Humble Defector configuration

### Tests
- `rules-engine/test/control-change.test.ts` - Control change tests
- `rules-engine/test/ai.activatedAbilities.test.ts` - AI activation tests (lines 23-67)

## Configuration Format

### Activated Ability Registry

```typescript
{
  'humble defector': {
    cardName: 'Humble Defector',
    tapAbility: {
      cost: '{T}',
      effect: 'Draw two cards. Target opponent gains control of Humble Defector.',
      targetType: 'opponent',
      controlChange: true,
      timingRestriction: 'your_turn',
    },
  },
}
```

### Key Properties
- `controlChange: true` - Marks this as a control-changing ability
- `targetType: 'opponent'` - Specifies valid targets
- `timingRestriction` - Limits when ability can be activated
- `effect` - Parsed for additional effects like card draw

## Adding New Control-Change Cards

To add support for a new control-change card:

1. **Add to Registry** (`rules-engine/src/cards/activatedAbilityCards.ts`):
```typescript
'card name': {
  cardName: 'Card Name',
  tapAbility: {
    cost: '{cost}',
    effect: 'Effect text including control change',
    targetType: 'opponent',
    controlChange: true,
    timingRestriction: 'sorcery' | 'your_turn', // if applicable
  },
},
```

2. **Test It**:
   - Add test case to `control-change.test.ts`
   - Verify registry entry is correct
   - Test with both human and AI players

3. **Done!** The system automatically handles:
   - Cost validation
   - Opponent selection
   - AI decision-making
   - Effect resolution

## AI Behavior

The AI evaluates control-change abilities in `AIEngine.ts`:
- **Value Calculation**: Line 2767-2772
  - Draws cards → High value (+8 per card)
  - Opponent gains control → Moderate penalty (-3)
  - Net benefit for Humble Defector: ~13 points (16 - 3)

- **Opponent Selection**: Server-side (interaction.ts:2892-2969)
  - Currently random selection
  - Future: Smart selection based on game state

## Game State Properties

### Temporary State (during activation)
- `game.state.pendingControlChangeActivations` - Stores activations awaiting opponent selection
  ```typescript
  {
    [activationId: string]: {
      playerId: string;
      permanentId: string;
      cardName: string;
      drawCards: number;
    }
  }
  ```

### Permanent State (for temporary control changes)
- `game.state.controlChangeEffects` - Tracks "until end of turn" control changes
  ```typescript
  [{
    permanentId: string;
    originalController: string;
    newController: string;
    duration: 'eot' | 'permanent' | 'turn';
    appliedAt: number;
  }]
  ```

## Future Enhancements

### Risky Move Implementation
Risky Move requires additional features:
1. **Upkeep Trigger** - Detect beginning of upkeep
2. **Control Handoff** - Cycle control to next player
3. **Coin Flip** - Integrate randomness system
4. **Creature Selection** - Modal for choosing creature to potentially lose

### Temporary Control Changes
Currently, all control changes are permanent. To support "until end of turn" effects:
1. Track control changes in `game.state.controlChangeEffects`
2. Add cleanup during end-of-turn processing
3. Revert `controller` to `originalController`

### Smarter AI
Improve AI opponent selection:
- Target player with most life (pose as bigger threat)
- Target player with fewest blockers
- Consider political implications in multiplayer

## Testing Checklist

- [x] Unit tests for control change mechanics
- [x] Registry validation for Humble Defector
- [x] Multiple control changes on same permanent
- [x] Owner property remains unchanged
- [ ] Manual UI testing with human players
- [ ] AI activation in real game scenario
- [ ] Multiplayer games with 3+ players
- [ ] Integration with undo system

## Known Limitations

1. **Type Safety**: Some game state properties use `as any` casting
   - Solution: Define proper TypeScript interfaces for game state
   - Affected areas: player objects, pendingControlChangeActivations

2. **No Undo Support**: Control changes not integrated with undo system
   - Solution: Add control change events to undo tracking

3. **Simple AI**: AI randomly selects opponents
   - Solution: Implement strategic opponent selection

4. **No Temporary Control**: All control changes are permanent
   - Solution: Implement end-of-turn cleanup for temporary effects

5. **Text Parsing Robustness**
   - Current draw count parsing only handles "one" and "two"
   - Fallback pattern matching could produce false positives
   - Solution: Use more robust number parsing library and precise regex patterns

6. **AI Delay Edge Cases**
   - AI setTimeout doesn't check if game state changed during delay
   - Solution: Validate game/permanent still exists before executing AI action

7. **State Initialization**: controlChangeEffects not always initialized
   - Solution: Initialize in game state constructor for consistency

## Future Improvements Priority

### High Priority
- [ ] Add proper TypeScript interfaces for game state
- [ ] Validate game state in AI timeout callbacks
- [ ] Initialize controlChangeEffects in game constructor

### Medium Priority
- [ ] Improve number text parsing (handle three, four, five, etc.)
- [ ] More precise regex for control change detection
- [ ] Integrate with undo system

### Low Priority
- [ ] Smarter AI opponent selection
- [ ] Support temporary control changes
- [ ] Add logging/debugging improvements

## Related Cards

Cards that could use this system:
- **Act of Treason** - Temporary control (until end of turn) + untap + haste
- **Threaten** - Similar to Act of Treason
- **Dominate** - Enchant creature, gain control
- **Control Magic** - Enchant creature, gain control
- **Risky Move** - Enchantment that changes control each upkeep + coin flip
- **Switcheroo** - Exchange control of two creatures
- **Juxtapose** - Exchange control of artifacts or creatures

## References

- MTG Comprehensive Rules: Section 108.3 (Control and Ownership)
- Scryfall: [Humble Defector](https://scryfall.com/card/c16/129/humble-defector)
- Issue: Cards like Humble Defector need activated ability targeting and control change support
