# Server Rules Engine Integration Guide

## Overview

The `RulesBridge` provides integration between the existing server game state management and the new rules engine. This allows gradual migration while maintaining backward compatibility.

## Architecture

```
┌─────────────────┐
│  Socket Handler │
│  (game-actions) │
└────────┬────────┘
         │
         v
┌────────────────────┐      ┌──────────────────┐
│   RulesBridge      │─────▶│  RulesEngine     │
│  (Validation &     │      │  (Core Rules)    │
│   Event Forwarding)│◀─────│                  │
└────────┬───────────┘      └──────────────────┘
         │
         v
┌────────────────────┐
│  Existing Game     │
│  State Management  │
└────────────────────┘
```

## Usage

### 1. Initialize Bridge in GameManager

```typescript
// server/src/GameManager.ts
import { createRulesBridge } from './rules-bridge.js';

class GameManager {
  private rulesBridges: Map<string, RulesBridge> = new Map();
  
  ensureGame(gameId: string, io: Server) {
    const game = this.games.get(gameId) || this.createGame(gameId);
    
    // Create rules bridge if not exists
    if (!this.rulesBridges.has(gameId)) {
      const bridge = createRulesBridge(gameId, io);
      bridge.initialize(game.state);
      this.rulesBridges.set(gameId, bridge);
    }
    
    return game;
  }
}
```

### 2. Validate Actions in Socket Handlers

```typescript
// server/src/socket/game-actions.ts
import type { RulesBridge } from '../rules-bridge.js';

export function registerGameActions(io: Server, socket: Socket, rulesBridge: RulesBridge) {
  socket.on("castSpell", ({ gameId, cardId, targets }) => {
    const playerId = socket.data.playerId;
    
    // Validate through rules engine
    const validation = rulesBridge.validateAction({
      type: 'castSpell',
      playerId,
      cardId,
      targets,
    });
    
    if (!validation.legal) {
      socket.emit("error", {
        code: "INVALID_ACTION",
        message: validation.reason,
      });
      return;
    }
    
    // Execute action (automatically triggers rules engine events)
    const result = rulesBridge.executeAction({
      type: 'castSpell',
      playerId,
      cardId,
      targets,
    });
    
    if (!result.success) {
      socket.emit("error", {
        code: "EXECUTION_ERROR",
        message: result.error,
      });
    }
  });
}
```

### 3. Client-Side Event Handling

```typescript
// client/src/hooks/useRulesEvents.ts
import { useEffect } from 'react';
import { socket } from '../socket';

export function useRulesEvents() {
  useEffect(() => {
    // Spell events
    socket.on('spellCast', (data) => {
      console.log(`${data.caster} cast ${data.spell.card.name}`);
      // Update UI: show spell on stack
      showStackEntry(data.spell);
      playSound('spell_cast');
    });
    
    socket.on('spellResolved', (data) => {
      console.log('Spell resolved:', data.spell.card.name);
      // Update UI: remove from stack, apply effects
      removeFromStack(data.spell);
    });
    
    // Combat events
    socket.on('attackersDeclared', (data) => {
      console.log('Attackers declared:', data.attackers);
      // Update UI: highlight attacking creatures
      highlightAttackers(data.attackers);
    });
    
    socket.on('blockersDeclared', (data) => {
      console.log('Blockers declared:', data.blockers);
      // Update UI: show blocking assignments
      showBlocking(data.blockers);
    });
    
    socket.on('damageDealt', (data) => {
      console.log('Damage dealt:', data.damage);
      // Update UI: animate damage
      animateDamage(data.damage);
    });
    
    // State-based actions
    socket.on('stateBasedActions', (data) => {
      console.log('State-based actions:', data.actions);
      // Update UI: show automatic game actions
      data.actions.forEach(action => showSBANotification(action));
    });
    
    // Win/loss events
    socket.on('playerLost', (data) => {
      console.log(`${data.playerId} lost:`, data.reason);
      // Update UI: mark player as eliminated
      markPlayerEliminated(data.playerId, data.reason);
    });
    
    socket.on('playerWon', (data) => {
      console.log(`${data.playerId} won!`);
      // Update UI: show victory screen
      showVictoryScreen(data.playerId);
    });
    
    socket.on('gameEnded', (data) => {
      console.log('Game ended:', data.reason);
      // Update UI: show game over
      showGameOver(data.winner, data.reason);
    });
    
    return () => {
      socket.off('spellCast');
      socket.off('spellResolved');
      socket.off('attackersDeclared');
      socket.off('blockersDeclared');
      socket.off('damageDealt');
      socket.off('stateBasedActions');
      socket.off('playerLost');
      socket.off('playerWon');
      socket.off('gameEnded');
    };
  }, []);
}
```

## Events Reference

### Spell Events
- `spellCast` - A spell was cast and added to the stack
- `spellResolved` - A spell resolved from the stack
- `spellCountered` - A spell was countered

### Combat Events
- `attackersDeclared` - Attackers were declared
- `blockersDeclared` - Blockers were declared  
- `damageDealt` - Combat or spell damage was dealt

### Game Flow Events
- `priorityPassed` - Priority passed to next player
- `stateBasedActions` - Automatic game actions occurred

### Win/Loss Events
- `playerLost` - A player lost the game
- `playerWon` - A player won the game
- `gameEnded` - The game has ended

### Card Events
- `cardDrawn` - A card was drawn
- `permanentDestroyed` - A permanent was destroyed
- `cardExiled` - A card was exiled

## Automated Trigger Handling

The rules engine automatically handles many triggers through the event system:

```typescript
// Example: Automatic ETB (enters-the-battlefield) triggers
rulesEngine.on(RulesEngineEvent.PERMANENT_ENTERED, (event) => {
  const card = event.data.permanent;
  
  // Check for ETB abilities
  if (card.abilities?.includes('ETB')) {
    // Automatically trigger the ability
    rulesEngine.executeAction(gameId, {
      type: 'triggerAbility',
      cardId: card.id,
      ability: 'ETB',
      controller: event.data.controller,
    });
  }
  
  // Check for token creation
  if (card.text?.includes('create') && card.text?.includes('token')) {
    // Parse and create tokens automatically
    const tokens = parseTokenCreation(card.text);
    tokens.forEach(token => {
      rulesEngine.executeAction(gameId, {
        type: 'createToken',
        token,
        controller: event.data.controller,
      });
    });
  }
});
```

## Migration Strategy

### Phase 1: Validation Only (Current)
- Use RulesBridge to validate actions
- Keep existing state management
- Forward rules events to clients
- No breaking changes

### Phase 2: Hybrid Mode
- Some actions use rules engine execution
- Some still use legacy state management
- Gradual migration of socket handlers

### Phase 3: Full Integration
- All actions through rules engine
- Remove legacy state management
- Complete automation of triggers and SBAs

## Benefits

1. **Validation** - All actions checked against MTG rules
2. **Automation** - Triggers and SBAs handled automatically
3. **Events** - Rich event system for UI updates
4. **Testing** - Can simulate games for testing
5. **Backward Compatible** - Works with existing code
6. **Gradual Migration** - No need to rewrite everything at once

## Next Steps

1. Wire RulesBridge into GameManager
2. Add validation to key socket handlers (castSpell, declareAttackers, etc.)
3. Implement client-side event handlers
4. Test with real gameplay
5. Gradually migrate more actions to rules engine execution
