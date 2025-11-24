# Rules Engine Integration Architecture

## Overview

The MTGEDH project now features a comprehensive rules engine integration that provides:
- **Unified API** for all game actions through `RulesEngineAdapter`
- **Event-driven architecture** for observing game state changes
- **AI automation** with multiple strategies via `AIEngine`
- **Full-game simulation** from mulligan to win condition via `GameSimulator`
- **Hybrid play modes** supporting both human and AI-controlled players

## Architecture Components

### 1. RulesEngineAdapter

The `RulesEngineAdapter` is the central interface for all rules operations. It provides:

#### Key Responsibilities
- **Action Validation**: Checks if actions are legal before execution
- **Atomic State Changes**: Ensures game state updates are consistent
- **Event Emission**: Notifies observers of game events
- **State-Based Actions**: Automatically checks and applies SBAs
- **Win/Loss Detection**: Determines game outcomes

#### Event System

The adapter emits events for all significant game actions:

```typescript
enum RulesEngineEvent {
  GAME_STARTED,
  TURN_STARTED,
  PHASE_STARTED,
  STEP_STARTED,
  PRIORITY_PASSED,
  MULLIGAN_DECISION,
  MULLIGAN_COMPLETED,
  SPELL_CAST,
  SPELL_COUNTERED,
  SPELL_RESOLVED,
  ABILITY_ACTIVATED,
  ABILITY_RESOLVED,
  COMBAT_DECLARED,
  ATTACKERS_DECLARED,
  BLOCKERS_DECLARED,
  DAMAGE_ASSIGNED,
  DAMAGE_DEALT,
  STATE_BASED_ACTIONS,
  PLAYER_LOST,
  PLAYER_WON,
  GAME_ENDED,
  CARD_DRAWN,
  CARD_DISCARDED,
  PERMANENT_DESTROYED,
  CARD_EXILED,
}
```

#### Example Usage

```typescript
import { rulesEngine, RulesEngineEvent } from '@mtgedh/rules-engine';

// Initialize a game
const gameState = createInitialGameState(gameId);
const result = rulesEngine.initializeGame(gameId, gameState);

// Listen to events
rulesEngine.on(RulesEngineEvent.SPELL_CAST, (event) => {
  console.log(`${event.data.caster} cast ${event.data.spell.card.name}`);
  updateUI(event);
});

// Validate and execute an action
const action = {
  type: 'castSpell',
  playerId: 'player1',
  card: { name: 'Lightning Bolt', types: ['Instant'] },
  targets: [{ type: 'player', id: 'player2' }],
};

const validation = rulesEngine.validateAction(gameId, action);
if (validation.legal) {
  const result = rulesEngine.executeAction(gameId, action);
  // State updated, events emitted
}
```

### 2. AIEngine

The `AIEngine` provides automated decision-making for AI-controlled players.

#### AI Strategies

- **RANDOM**: Completely random decisions (for testing)
- **BASIC**: Simple heuristic-based decisions
- **AGGRESSIVE**: Prioritizes attacking
- **DEFENSIVE**: Focuses on life preservation
- **CONTROL**: Emphasizes controlling the game
- **COMBO**: Tries to assemble combos

#### Decision Types

The AI can make decisions for:
- **Mulligan**: Keep or reshuffle opening hands
- **Spell Casting**: When and what to cast
- **Ability Activation**: Triggered and activated abilities
- **Target Selection**: Choosing valid targets
- **Attack Declaration**: Which creatures to attack with
- **Block Declaration**: How to assign blockers
- **Priority Passing**: When to pass priority
- **Discard/Sacrifice**: Choosing cards to discard or permanents to sacrifice

#### Example Usage

```typescript
import { aiEngine, AIStrategy, AIDecisionType } from '@mtgedh/rules-engine';

// Register an AI player
aiEngine.registerAI({
  playerId: 'ai1',
  strategy: AIStrategy.AGGRESSIVE,
  difficulty: 0.7,
  thinkTime: 1000, // ms delay for realism
});

// Get AI decision
const context = {
  gameState: currentGameState,
  playerId: 'ai1',
  decisionType: AIDecisionType.DECLARE_ATTACKERS,
  options: availableCreatures,
};

const decision = await aiEngine.makeDecision(context);
console.log(decision.reasoning); // "Aggressive: attack with everything"
console.log(decision.confidence); // 0.9

// Execute the decision
rulesEngine.executeAction(gameId, {
  type: 'declareAttackers',
  playerId: decision.playerId,
  attackers: decision.action.attackers,
});
```

### 3. GameSimulator

The `GameSimulator` runs complete games from start to finish.

#### Features

- **Headless Mode**: Runs without UI for batch testing
- **Reproducible**: Uses RNG seeding for deterministic results
- **Batch Simulations**: Run N games for statistical analysis
- **Configurable**: Support for different formats and player types
- **Event Logging**: Records all game events for debugging

#### Example Usage

```typescript
import { gameSimulator, PlayerType, AIStrategy } from '@mtgedh/rules-engine';

// Configure simulation
const config = {
  gameId: 'sim_game_1',
  players: [
    {
      id: 'ai1',
      name: 'Aggressive AI',
      type: PlayerType.AI,
      aiStrategy: AIStrategy.AGGRESSIVE,
      deckList: ['Forest', 'Mountain', ...],
    },
    {
      id: 'ai2',
      name: 'Defensive AI',
      type: PlayerType.AI,
      aiStrategy: AIStrategy.DEFENSIVE,
      deckList: ['Plains', 'Island', ...],
    },
  ],
  format: 'commander',
  startingLife: 40,
  maxTurns: 100,
  rngSeed: 12345,
  verbose: true,
  headless: true,
};

// Run single simulation
const result = await gameSimulator.runSimulation(config);
console.log(`Winner: ${result.winner}`);
console.log(`Total Turns: ${result.totalTurns}`);
console.log(`Duration: ${result.duration}ms`);

// Run batch simulation
const batchConfig = {
  config,
  iterations: 100,
};

const batchResults = await gameSimulator.runBatchSimulation(batchConfig);
console.log('Win Rates:', batchResults.winRates);
console.log('Average Turns:', batchResults.averageTurns);
```

## Integration with Server

The rules engine integrates with the existing server infrastructure:

### Server Integration Points

1. **GameManager**: Uses `RulesEngineAdapter` for state management
2. **Socket Handlers**: Route player actions through rules engine
3. **Event Broadcasting**: Translates rules events to Socket.IO events
4. **State Persistence**: Stores rule-validated state changes

### Example Server Integration

```typescript
// server/src/GameManager.ts
import { rulesEngine, RulesEngineEvent } from '@mtgedh/rules-engine';

class GameManager {
  private initializeGame(gameId: string) {
    const state = createInitialGameState(gameId);
    rulesEngine.initializeGame(gameId, state);
    
    // Forward rules events to Socket.IO
    rulesEngine.on(RulesEngineEvent.SPELL_CAST, (event) => {
      io.to(gameId).emit('spellCast', event.data);
    });
  }
  
  private handlePlayerAction(gameId: string, action: any) {
    // Validate through rules engine
    const validation = rulesEngine.validateAction(gameId, action);
    if (!validation.legal) {
      return { error: validation.reason };
    }
    
    // Execute through rules engine
    const result = rulesEngine.executeAction(gameId, action);
    
    // Broadcast updated state
    this.broadcastState(gameId);
    
    return result;
  }
}
```

## Client Integration

The client observes rules events through Socket.IO:

```typescript
// client/src/hooks/useGameSocket.ts
import { useEffect } from 'react';
import { socket } from '../socket';

export function useRulesEvents() {
  useEffect(() => {
    socket.on('spellCast', (data) => {
      // Update UI to show spell on stack
      showStackEntry(data.spell);
      playSound('spell_cast');
    });
    
    socket.on('combatDeclared', (data) => {
      // Highlight attacking creatures
      highlightAttackers(data.attackers);
    });
    
    socket.on('playerWon', (data) => {
      // Show victory screen
      showVictoryScreen(data.playerId, data.reason);
    });
    
    return () => {
      socket.off('spellCast');
      socket.off('combatDeclared');
      socket.off('playerWon');
    };
  }, []);
}
```

## Hybrid AI/Human Play

The system supports mixed player types in the same game:

```typescript
// Configure game with both AI and human players
const game = {
  players: [
    { id: 'human1', type: PlayerType.HUMAN, ... },
    { id: 'ai1', type: PlayerType.AI, aiStrategy: AIStrategy.BASIC, ... },
    { id: 'ai2', type: PlayerType.AI, aiStrategy: AIStrategy.AGGRESSIVE, ... },
  ],
};

// During gameplay, check player type
function handlePriorityPass(gameState) {
  const activePlayer = gameState.players[gameState.priorityPlayerIndex];
  
  if (aiEngine.isAI(activePlayer.id)) {
    // AI makes decision automatically
    const decision = await aiEngine.makeDecision({
      gameState,
      playerId: activePlayer.id,
      decisionType: AIDecisionType.PASS_PRIORITY,
      options: [],
    });
    
    rulesEngine.executeAction(gameState.id, decision.action);
  } else {
    // Human player: wait for UI input
    showPriorityPrompt(activePlayer.id);
  }
}
```

## Testing

The rules engine includes comprehensive tests:

```bash
# Run all rules engine tests (951 tests)
cd rules-engine
npm test

# Run specific test suite
npm test -- RulesEngineAdapter.test.ts

# Run tests in watch mode
npm run dev:test
```

### Test Coverage

- **RulesEngineAdapter**: 18 tests covering initialization, validation, execution, events, SBAs
- **AIEngine**: 21 tests covering all strategies and decision types
- **GameSimulator**: Integration tests for full game flow
- **Existing Rules**: 922 tests for comprehensive rules, keyword actions, abilities

## Performance Considerations

### Optimization Strategies

1. **Event Batching**: Group multiple events into single broadcasts
2. **State Diffing**: Only send changed portions of game state
3. **Lazy Evaluation**: Defer expensive calculations until needed
4. **Caching**: Store frequently accessed game state queries
5. **Parallel Simulations**: Run multiple simulations concurrently

### Benchmarks

Typical performance on standard hardware:
- Single AI turn: ~50-100ms
- Full game simulation (AI vs AI): ~500-2000ms
- Batch 100 simulations: ~1-5 minutes
- Event emission overhead: <1ms per event

## Troubleshooting

### Common Issues

**Issue**: Rules engine not validating actions
- **Solution**: Ensure game is initialized with `rulesEngine.initializeGame()`

**Issue**: AI not making decisions
- **Solution**: Check AI is registered with `aiEngine.registerAI()`

**Issue**: Events not being received
- **Solution**: Verify event listener is registered before action execution

**Issue**: Simulation hangs
- **Solution**: Set `maxTurns` to prevent infinite loops

**Issue**: Tests failing
- **Solution**: Ensure all dependencies are installed with `npm install`

## Next Steps

See the following guides for more information:
- [Extending AI Strategies](./ai-strategies.md)
- [Adding New Rule Modules](./keyword-actions-guide.md)
- [Simulation Harness Usage](./simulation-guide.md)
- [UI Integration Guide](./ui-integration.md)
