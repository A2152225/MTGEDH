# AI Opponent Implementation Reference

This document captures key architectural details about the AI opponent system for future development reference.

## File Locations

### Core AI Files

| File | Purpose |
|------|---------|
| `server/src/socket/ai.ts` | Main AI game flow handling, turn progression, commander selection |
| `rules-engine/src/AIEngine.ts` | AI decision-making strategies and types |
| `server/src/socket/util.ts` | `checkAndTriggerAI()` called after broadcasts to trigger AI |

### Related Game State Files

| File | Purpose |
|------|---------|
| `server/src/state/modules/turn.ts` | Turn/step progression, `nextStep()`, `nextTurn()` |
| `server/src/state/modules/commander.ts` | Commander selection, triggers `pendingInitialDraw` → shuffle+draw 7 |
| `server/src/state/modules/zones.ts` | Library, hand, graveyard management |
| `server/src/state/context.ts` | Game context with state, libraries Map, zones |

## Key Implementation Details

### AI Turn Flow

```
handleAIGameFlow() [Pre-game: commander selection]
    ↓
handleAIPriority() [Active game: turn actions]
    ↓
Phase-specific handlers:
    - Beginning phase → advance step
    - Main phase → play land → advance step
    - Combat phase → declare attackers/blockers → advance step
    - Ending phase → advance step
    - Cleanup step → discard to hand size → advance turn
```

### Commander Selection Flow

1. `autoSelectAICommander()` called during pre-game
2. `findBestCommanders()` searches library for valid commanders
3. Commander must be:
   - Legendary
   - Either a creature OR has "can be your commander" text
   - Partner/Background pairs are supported
4. After selection:
   - `flagPendingOpeningDraw()` sets up draw trigger
   - `setCommander()` removes commander from library → command zone
   - Shuffle + draw 7 cards for opening hand

### AI Discard Logic

At cleanup step, AI discards down to max hand size:

1. Check for "no maximum hand size" effects (Reliquary Tower, etc.)
2. If over max, `chooseCardsToDiscard()` scores cards:
   - Lands: +100 (keep)
   - Creatures: +20 (keep)
   - Removal spells: +30 (keep)
   - Low CMC: +0-10 based on cost (keep cheaper)
3. Lowest scored cards are discarded first

### Color Identity Extraction

```typescript
extractColorIdentity(card) → string[]
```

Extracts colors from:
- `mana_cost` field (e.g., `{2}{G}{G}` → `['G']`)
- `color_identity` array (Scryfall provides this)
- `oracle_text` for ability costs (e.g., `{W}: ...` → `['W']`)

## Important Timing Values

| Constant | Value | Purpose |
|----------|-------|---------|
| `AI_THINK_TIME_MS` | 500ms | Delay before AI takes next action |
| `AI_REACTION_DELAY_MS` | 300ms | Delay for AI to respond to state changes |

## State Access Patterns

### Getting Player Zones
```typescript
const zones = game.state.zones?.[playerId] as any;
const library = zones?.library || [];
const hand = zones?.hand || [];
```

Note: Cast to `any` needed because runtime zones extend typed interface.

### Checking Turn State
```typescript
const isAITurn = game.state.turnPlayer === playerId;
const hasPriority = game.state.priority === playerId;
const stackEmpty = !game.state.stack || game.state.stack.length === 0;
```

### Phase/Step Detection
```typescript
const phase = String(game.state.phase || '').toLowerCase();
const step = String(game.state.step || '').toLowerCase();
const isMainPhase = phase.includes('main') || step.includes('main');
const isCleanupStep = step.includes('cleanup');
```

## Common Issues & Solutions

### AI Stuck at Untap Step
**Cause**: AI was only passing priority, not advancing steps
**Solution**: `handleAIPriority()` now calls `executeAdvanceStep()` instead of just `executePassPriority()` when it's the AI's turn

### Opening Hand Not Drawn
**Cause**: `pendingInitialDraw` flag cleared but draw not triggered
**Solution**: `autoSelectAICommander()` now verifies hand was drawn and manually triggers if needed

### Commander Not Found
**Cause**: Deck has no valid commander candidates
**Solution**: Fallback to any legendary card if no creature commanders found

## Testing

Tests are in `server/tests/ai.turn.test.ts`:
- Land card detection
- Commander validity checking
- Color identity extraction
- Discard priority scoring
- Max hand size calculation
- Phase/step detection

Run tests:
```bash
npx vitest run server/tests/ai.turn.test.ts
```

## Future Enhancements

- [ ] AI spell casting (mana payment, target selection)
- [ ] AI creature attacks (threat evaluation)
- [ ] AI combat blocking (trade evaluation)
- [ ] AI response to opponent spells (counters, removal timing)
- [ ] AI mulligan decisions

## Related Documentation

- [AI Strategies Guide](./ai-strategies.md) - Strategy creation and customization
- [Rules Engine Integration](./rules-engine-integration.md) - How AI interfaces with game rules
- [Simulation Guide](./simulation-guide.md) - Testing AI performance
