# Resolution Queue System

The unified Resolution Queue system provides a single, consistent way to handle all player interactions and choices in the game. This replaces the legacy `pending*` state fields and `handlePending*` functions.

## 🎯 For Future Development: Always Use the Queue

**When implementing ANY new player interaction, ALWAYS use the resolution queue system.**

### Quick Start

1. **Define the step type** in `types.ts` if it doesn't exist
2. **Add the step** to the queue using `ResolutionQueueManager.addStep()`
3. **Handle the response** in `resolution.ts` with a response handler
4. **Update the client** to handle the step type in `resolutionStepPrompt` listener

## 📚 Key Concepts

### ResolutionStep
A single player choice/action that needs resolution. Each step represents one decision a player must make.

### ResolutionQueue
FIFO queue of `ResolutionStep`s for a game. Steps are automatically ordered by APNAP (Active Player, Non-Active Player) rules.

### ResolutionQueueManager
Central manager that handles adding, completing, and querying steps across all games.

## 🔄 Migration Status

### ✅ Fully Migrated (Use These as Examples)
- `CASCADE` - See `processPendingCascades()` in `resolution.ts`
- `BOUNCE_LAND_CHOICE` - Full queue integration
- `LIBRARY_SEARCH` - Uses queue via intermediate state
- `JOIN_FORCES` - Queue-based with APNAP ordering
- `TEMPTING_OFFER` - Queue-based with opponent choices
- `PONDER_EFFECT` - Legacy handler removed, queue only
- `TARGET_SELECTION` for spell casting - Now uses Resolution Queue via `requestCastSpell` and `handleCastSpellFromHand`
  - Legacy `targetSelectionRequest` / `targetSelectionConfirm` still available but deprecated
  - Client uses `target_selection` step type in `handleResolutionStepPrompt`

### ⚠️ Needs Migration
- `pendingTriggerOrdering` - Still has legacy handler
- `pendingKynaiosChoice` - Still has legacy handler (fallback when gameId missing)
- `pendingEntrapmentManeuver` - Still has legacy handler
- Color/creature type choices - Using module-level Maps
- Per-opponent targeting (`perOpponentTargetSelectionRequest`) - Still using legacy flow

## 📖 How to Add a New Player Choice

### Step 1: Define the Step Type

Add to `types.ts` if not present:

```typescript
export enum ResolutionStepType {
  // ... existing types
  MY_NEW_CHOICE = 'my_new_choice',
}

// Add to LEGACY_PENDING_TO_STEP_TYPE if you need intermediate state
export const LEGACY_PENDING_TO_STEP_TYPE: Record<string, ResolutionStepType> = {
  // ... existing mappings
  pendingMyNewChoice: ResolutionStepType.MY_NEW_CHOICE,
};

// Define the step interface
export interface MyNewChoiceStep extends BaseResolutionStep {
  readonly type: ResolutionStepType.MY_NEW_CHOICE;
  readonly choices: readonly string[];
  readonly sourceCard: KnownCardRef;
  // ... other step-specific fields
}

// Add to the ResolutionStep union type
export type ResolutionStep = 
  | TargetSelectionStep
  | MyNewChoiceStep  // Add your step here
  | BaseResolutionStep;
```

### Step 2: Add the Step to the Queue

When the choice is needed:

```typescript
import { ResolutionQueueManager, ResolutionStepType } from '../state/resolution/index.js';

// Add the step
ResolutionQueueManager.addStep(gameId, {
  type: ResolutionStepType.MY_NEW_CHOICE,
  playerId: playerWhoMustChoose,
  description: 'Choose a card to sacrifice',
  mandatory: true,
  sourceId: sourceCardId,
  sourceName: 'Card Name',
  choices: ['Option 1', 'Option 2', 'Option 3'],
  sourceCard: cardRef,
});
```

### Step 3: Handle the Response (Server)

Add a handler in `server/src/socket/resolution.ts`:

```typescript
// Add to handleStepResponse switch statement
case ResolutionStepType.MY_NEW_CHOICE:
  handleMyNewChoiceResponse(io, game, gameId, step, response);
  break;

// Implement the handler function
function handleMyNewChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const choice = response.selections; // The player's choice
  
  const myStep = step as MyNewChoiceStep;
  
  // Apply the game effect based on the choice
  // ... your game logic here
  
  // Emit chat message
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: `${getPlayerName(game, pid)} chose ${choice}`,
    ts: Date.now(),
  });
  
  // Update sequence counter if needed
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}
```

### Step 4: Handle on Client

Add handling in `client/src/App.tsx` in the `handleResolutionStepPrompt` function:

```typescript
const handleResolutionStepPrompt = (payload: { gameId: string; step: any }) => {
  if (payload.gameId !== safeView?.id) return;
  
  const step = payload.step;
  
  // ... existing cases
  
  // Add your new case
  else if (step.type === 'my_new_choice') {
    setMyNewChoicePrompt({
      gameId: payload.gameId,
      choices: step.choices,
      sourceCard: step.sourceCard,
      stepId: step.id,  // Important: Store step ID for response
    });
    setMyNewChoiceModalOpen(true);
  }
};
```

### Step 5: Submit Response from Client

When the player makes their choice:

```typescript
// In your modal's onConfirm handler
socket.emit("submitResolutionResponse", {
  gameId: safeView.id,
  stepId: stepId,  // From the step you received
  selections: selectedChoice,  // The player's choice
  cancelled: false,
});
```

## 🏗️ Intermediate State Pattern (Hybrid Approach)

Some effects are created in state modules (like `stack.ts`) that don't have access to `gameId`. For these, use the intermediate state pattern:

### 1. Create Intermediate State
```typescript
// In state module (e.g., stack.ts)
(state as any).pendingMyChoice = (state as any).pendingMyChoice || {};
(state as any).pendingMyChoice[playerId] = {
  sourceCard: card,
  choices: ['A', 'B', 'C'],
};
```

### 2. Migrate to Queue
```typescript
// In resolution.ts or game-actions.ts
export function processPendingMyChoices(
  io: Server,
  game: any,
  gameId: string
): void {
  const pending = (game.state as any).pendingMyChoice;
  if (!pending) return;
  
  for (const [playerId, data] of Object.entries(pending)) {
    // Add to resolution queue
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MY_NEW_CHOICE,
      playerId,
      // ... map data to step fields
    });
    
    // Clear the intermediate state
    delete (game.state as any).pendingMyChoice[playerId];
  }
}
```

### 3. Call Migration Function
```typescript
// After stack resolution or at appropriate time
processPendingMyChoices(io, game, gameId);
```

## 🚫 What NOT to Do

### ❌ DON'T Create New handlePending* Functions
```typescript
// BAD - Don't do this
export function handlePendingMyChoice(io: Server, game: any, gameId: string) {
  const pending = game.state?.pendingMyChoice;
  // ... legacy pattern
}
```

### ❌ DON'T Create Custom Socket Handlers
```typescript
// BAD - Don't do this
socket.on("resolveMyChoice", ({ gameId, choice }) => {
  // ... custom handler
});
```

### ❌ DON'T Use Module-Level Maps/State
```typescript
// BAD - Avoid this pattern
const pendingChoices: Map<string, MyChoice> = new Map();
```

### ✅ DO Use the Resolution Queue
```typescript
// GOOD - Always do this
ResolutionQueueManager.addStep(gameId, {
  type: ResolutionStepType.MY_NEW_CHOICE,
  // ... step config
});
```

## 🔍 Examples to Study

### Simple Choice: Bounce Land
See `handleBounceLandChoiceResponse()` in `resolution.ts` for a straightforward example.

### Complex Choice with APNAP: Join Forces  
See `handleJoinForcesResponse()` for multiplayer, ordered resolution.

### Intermediate State Migration: Cascade
See `processPendingCascades()` for the pattern of migrating from state to queue.

### Client Integration: Cascade Modal
See how `CascadeModal` submits responses via `submitResolutionResponse` in `App.tsx`.

## 📋 Checklist for New Player Interactions

- [ ] Added step type to `ResolutionStepType` enum
- [ ] Created step interface extending `BaseResolutionStep`
- [ ] Added step to `ResolutionStep` union type
- [ ] Implemented `ResolutionQueueManager.addStep()` call
- [ ] Added response handler in `handleStepResponse()` switch
- [ ] Implemented response handler function
- [ ] Added client-side handling in `handleResolutionStepPrompt()`
- [ ] Created/updated client modal for the choice
- [ ] Client submits via `submitResolutionResponse`
- [ ] Tested with both human and AI players
- [ ] Updated this README if introducing new patterns

## 🎓 Key Principles

1. **Single Queue**: One queue per game, not multiple pending fields
2. **APNAP Ordering**: Queue automatically handles turn order
3. **Type Safety**: Use TypeScript interfaces for all steps
4. **Consistent API**: All responses via `submitResolutionResponse`
5. **AI Support**: Queue system integrates with AI decision making
6. **No Legacy Code**: Never create new `handlePending*` functions

## 📞 Integration Points

- **Server Entry**: `server/src/socket/resolution.ts` - Socket handlers
- **Queue Manager**: `server/src/state/resolution/ResolutionQueueManager.ts`
- **Types**: `server/src/state/resolution/types.ts`
- **Client Entry**: `client/src/App.tsx` - `handleResolutionStepPrompt()`
- **Client Response**: All modals submit via `submitResolutionResponse`

## 🔄 Future Work

To complete the migration, the following legacy handlers need to be converted:

1. `pendingTriggerOrdering` → Migrate to TRIGGER_ORDER queue type
2. `pendingKynaiosChoice` → Migrate to KYNAIOS_CHOICE queue type (partially done)
3. `pendingEntrapmentManeuver` → Migrate to ENTRAPMENT_MANEUVER queue type
4. Color/Creature type selections → Migrate from module Maps to queue

For each migration, follow the same pattern demonstrated in the CASCADE migration (commits `a8b85b5`, `6d7574d`, `d32732b`).

---

**Remember: When in doubt, look at how CASCADE was migrated. It's the most recent and complete example of the migration pattern.**
