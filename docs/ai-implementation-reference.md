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

## AI Spell Casting

### Mana Calculation

```typescript
// Calculate available mana from all untapped mana sources
calculateAvailableMana(game, playerId) → { total, colors, sourcesByColor }
```

- `total`: Total mana available (lands + mana rocks + mana dorks)
- `colors`: Map of color → count of sources that can produce it
- `sourcesByColor`: Map of color → list of source IDs

Mana sources include:
- **Lands**: Basic lands, dual lands, fetch lands
- **Mana rocks**: Sol Ring, Mana Crypt, Signets, etc.
- **Mana creatures**: Llanowar Elves, Birds of Paradise, etc.

Sol Ring and similar sources that produce 2 mana are counted properly.

### Land Entry Behavior

AI handles special land entry conditions:

**Shock Lands** (Blood Crypt, Breeding Pool, etc.):
- AI pays 2 life if life > 10 (enter untapped for tempo)
- AI lets it enter tapped if life ≤ 10 (preserve life)

**Tap Lands** (Temples, Guildgates, Refuges):
- Automatically enter tapped

```typescript
landEntersTapped(card) → boolean  // Always enters tapped?
isShockLand(cardName) → boolean   // Pay life option?
shouldAIPayShockLandLife(game, playerId) → boolean  // AI decision
```

### Spell Cost Parsing

```typescript
parseSpellCost("{2}{G}{G}") → { cmc: 4, colors: { G: 2 }, generic: 2, hybrids: [] }
parseSpellCost("{R/W}{R/W}") → { cmc: 2, colors: {}, generic: 0, hybrids: [["R","W"], ["R","W"]] }
```

Handles:
- Generic mana (`{1}`, `{2}`)
- Colored mana (`{W}`, `{U}`, `{B}`, `{R}`, `{G}`)
- Hybrid mana (`{R/W}`, `{2/G}`)

### Spell Priority

AI casts spells based on priority scoring:
- Creatures: +30 (board presence)
- Removal (destroy/exile): +25
- Card draw: +20
- Artifacts/enchantments: +20
- Ramp (land search): +15
- Low CMC bonus: +0 to +10

### Mana Source Selection for Payment

`getPaymentSources()` intelligently selects which sources to tap:
1. Prefers single-color sources for colored requirements (saves multi-color)
2. Prefers lands over artifacts/creatures for colored mana
3. Uses Sol Ring (2 mana) efficiently for generic costs
4. Returns source IDs with their assigned color to produce

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
