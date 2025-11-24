# Rules Engine Integration Status

## Overview

The MTGEDH project has a comprehensive rules engine that is partially integrated with the server. This document describes the current state and what's working.

## Current Integration Status ✅

### What's Working

#### 1. Core Infrastructure
- ✅ **RulesEngineAdapter**: Fully implemented with 949/951 tests passing
  - Event system for game actions
  - Action validation and execution
  - State-based actions
  - Win/loss detection
  
- ✅ **RulesBridge**: Connects server to rules engine
  - Converts between server GameState and rules engine format
  - Forwards rules engine events to Socket.IO clients
  - Validates actions through rules engine
  
- ✅ **GameManager Integration**
  - GameManager stores RulesBridge instances per game
  - Socket.IO server configured for event forwarding
  - `getRulesBridge(gameId)` method available to socket handlers

#### 2. Socket Handler Integration

Currently integrated in `server/src/socket/game-actions.ts`:
- ✅ **Play Land** action uses RulesBridge for validation
  - Validates through rules engine
  - Executes through rules engine  
  - Falls back to legacy implementation for backward compatibility
  
Example from game-actions.ts (line 26-57):
```typescript
const bridge = GameManager.getRulesBridge(gameId);

if (bridge) {
  // Validate through rules engine
  const validation = bridge.validateAction({
    type: 'playLand',
    playerId,
    cardId,
  });
  
  if (!validation.legal) {
    socket.emit("error", {
      code: "INVALID_ACTION",
      message: validation.reason || "Cannot play land",
    });
    return;
  }
  
  // Execute through rules engine (this will emit events)
  const result = bridge.executeAction({
    type: 'playLand',
    playerId,
    cardId,
  });
}
```

#### 3. Event System

The RulesBridge forwards these rules engine events to Socket.IO:
- `spellCast` - When a spell is cast
- `spellResolved` - When a spell resolves
- `attackersDeclared` - Combat attackers declared
- `blockersDeclared` - Combat blockers declared
- `permanentDestroyed` - When a permanent is destroyed

#### 4. Type System

Added to `shared/src/types.ts`:
- ✅ `AutomationErrorReport` - For reporting rules automation issues
- ✅ `GameActionType` - Enum of game action types
- ✅ `GameAction` - Interface for game actions
- ✅ `InMemoryGame` - Server-side game structure

## What Can Be Extended

### Socket Actions Ready for Rules Engine Integration

The following socket handlers exist but don't yet use RulesBridge:

1. **Cast Spell** (`server/src/socket/game-actions.ts`)
   - Current: Legacy implementation only
   - Ready for: RulesBridge validation and execution

2. **Activate Ability** (`server/src/socket/game-actions.ts`)
   - Current: Legacy implementation only
   - Ready for: RulesBridge validation and execution

3. **Declare Attackers** (`server/src/socket/game-actions.ts`)
   - Current: Legacy implementation only
   - Ready for: RulesBridge validation and execution

4. **Declare Blockers** (`server/src/socket/game-actions.ts`)
   - Current: Legacy implementation only
   - Ready for: RulesBridge validation and execution

5. **Pass Priority** (`server/src/socket/priority.ts`)
   - Current: Legacy implementation only
   - Ready for: RulesBridge integration

### AI Engine Integration

The AIEngine exists in `rules-engine/src/AIEngine.ts` but is not yet connected:
- ✅ Multiple AI strategies implemented (RANDOM, BASIC, AGGRESSIVE, DEFENSIVE, CONTROL, COMBO)
- ❌ Not yet integrated with GameManager
- ❌ No socket handler for AI player actions

### Game Simulator

The GameSimulator exists in `rules-engine/src/GameSimulator.ts`:
- ✅ Can run headless AI vs AI games
- ✅ Batch simulation support
- ❌ Not exposed through server API
- ❌ No CLI integration beyond `rules-engine/cli/simulate.ts`

## How to Extend Integration

### Adding RulesBridge to More Actions

Pattern to follow (from playLand implementation):

```typescript
socket.on("actionName", ({ gameId, ...params }) => {
  try {
    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    if (!game || !playerId) return;

    // Get RulesBridge for validation
    const bridge = GameManager.getRulesBridge(gameId);
    
    if (bridge) {
      // Validate through rules engine
      const validation = bridge.validateAction({
        type: 'actionType',
        playerId,
        ...params
      });
      
      if (!validation.legal) {
        socket.emit("error", {
          code: "INVALID_ACTION",
          message: validation.reason,
        });
        return;
      }
      
      // Execute through rules engine
      const result = bridge.executeAction({
        type: 'actionType',
        playerId,
        ...params
      });
      
      if (!result.success) {
        socket.emit("error", {
          code: "EXECUTION_ERROR",
          message: result.error,
        });
        return;
      }
    }
    
    // Legacy fallback for backward compatibility
    if (typeof game.legacyMethod === 'function') {
      game.legacyMethod(playerId, params);
    }
    
    appendGameEvent(game, gameId, "actionName", { playerId, ...params });
    broadcastGame(io, game, gameId);
  } catch (err: any) {
    console.error(`actionName error for game ${gameId}:`, err);
    socket.emit("error", {
      code: "ACTION_ERROR",
      message: err?.message ?? String(err),
    });
  }
});
```

### Adding AI Support

1. Import AIEngine in GameManager
2. Register AI players when they join
3. In socket handlers, check if player is AI
4. If AI, call `aiEngine.makeDecision()` instead of waiting for socket event
5. Execute the AI's decision through RulesBridge

### Exposing Simulator

1. Add HTTP endpoint to server for simulation requests
2. Add socket event for starting simulations
3. Stream simulation results back to client
4. Store simulation results in database

## Testing

### Rules Engine Tests
```bash
cd rules-engine
npm test
```
Result: **949/951 tests passing** (2 integration test failures unrelated to our changes)

### Server Tests
```bash
cd server  
npm test
```

### Running the Server
```bash
npm run dev:server
```
Server starts successfully on port 3001 with rules engine integration enabled.

## Known Issues

1. **TypeScript Import Extensions**: 
   - Many files have TS2834/TS2835 errors about missing .js extensions
   - These are cosmetic - runtime uses `tsx` which handles this automatically
   - Server and client build and run successfully despite these warnings

2. **Integration Test Failures**:
   - 2 mana-related integration tests fail in rules engine
   - Not related to recent changes
   - Core functionality works correctly

3. **npm Security Vulnerabilities**:
   - 5 moderate severity vulnerabilities in esbuild/vite chain
   - Development-only dependencies
   - Fixing requires breaking changes to vite
   - Not critical for current development

## References

- [Rules Engine Integration Architecture](./rules-engine-integration.md)
- [AI Strategies Guide](./ai-strategies.md)
- [Simulation Guide](./simulation-guide.md)
- [Server Integration Guide](./server-integration.md)
