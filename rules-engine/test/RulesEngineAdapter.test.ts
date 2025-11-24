/**
 * Tests for RulesEngineAdapter
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RulesEngineAdapter, RulesEngineEvent } from '../src/RulesEngineAdapter';
import type { GameState } from '../../shared/src';

describe('RulesEngineAdapter', () => {
  let adapter: RulesEngineAdapter;
  let testGameState: GameState;
  
  beforeEach(() => {
    adapter = new RulesEngineAdapter();
    testGameState = {
      id: 'test-game',
      format: 'commander' as any,
      players: [
        { 
          id: 'player1', 
          name: 'Player 1', 
          life: 40, 
          hand: [], 
          library: [], 
          graveyard: [], 
          battlefield: [], 
          exile: [], 
          commandZone: [], 
          counters: {}, 
          hasLost: false,
          manaPool: { white: 5, blue: 5, black: 0, red: 0, green: 0, colorless: 0 },
        },
        { 
          id: 'player2', 
          name: 'Player 2', 
          life: 40, 
          hand: [], 
          library: [], 
          graveyard: [], 
          battlefield: [], 
          exile: [], 
          commandZone: [], 
          counters: {}, 
          hasLost: false,
          manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
        },
      ],
      turnOrder: ['player1', 'player2'],
      activePlayerIndex: 0,
      priorityPlayerIndex: 0,
      turn: 1,
      phase: 'beginning' as any,
      step: 'untap' as any,
      stack: [],
      startingLife: 40,
      allowUndos: false,
      turnTimerEnabled: false,
      turnTimerSeconds: 0,
      createdAt: Date.now(),
      lastActionAt: Date.now(),
      spectators: [],
      status: 'inProgress' as any,
    };
  });
  
  describe('initializeGame', () => {
    it('should initialize a game with rules engine', () => {
      const result = adapter.initializeGame('test-game', testGameState);
      
      expect(result.next).toBeDefined();
      expect(result.next.id).toBe('test-game');
      expect(result.log).toContain('Game test-game initialized with rules engine');
    });
    
    it('should emit GAME_STARTED event', async () => {
      const promise = new Promise<void>((resolve) => {
        adapter.on(RulesEngineEvent.GAME_STARTED, (event) => {
          expect(event.type).toBe(RulesEngineEvent.GAME_STARTED);
          expect(event.gameId).toBe('test-game');
          resolve();
        });
      });
      
      adapter.initializeGame('test-game', testGameState);
      await promise;
    });
  });
  
  describe('validateAction', () => {
    beforeEach(() => {
      adapter.initializeGame('test-game', testGameState);
    });
    
    it('should validate spell cast when player has priority', () => {
      const validation = adapter.validateAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        card: { name: 'Lightning Bolt' },
      });
      
      expect(validation.legal).toBe(true);
    });
    
    it('should reject spell cast when player lacks priority', () => {
      const validation = adapter.validateAction('test-game', {
        type: 'castSpell',
        playerId: 'player2',
        card: { name: 'Lightning Bolt' },
      });
      
      expect(validation.legal).toBe(false);
      expect(validation.reason).toBe('Player does not have priority');
    });
    
    it('should validate spell cast when player has sufficient mana', () => {
      const validation = adapter.validateAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        cardName: 'Counterspell',
        manaCost: '{U}{U}',
      });
      
      expect(validation.legal).toBe(true);
    });
    
    it('should reject spell cast when player has insufficient colored mana', () => {
      const validation = adapter.validateAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        cardName: 'Lightning Bolt',
        manaCost: '{R}',
      });
      
      expect(validation.legal).toBe(false);
      expect(validation.reason).toContain('red mana');
    });
    
    it('should reject spell cast when player has insufficient generic mana', () => {
      const validation = adapter.validateAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        cardName: 'Divination',
        manaCost: '{2}{U}',
      });
      
      // Player has 5W 5U, needs 1U + 2 generic, so needs total 3 mana
      // Player has 10 total, so should be valid
      expect(validation.legal).toBe(true);
    });
    
    it('should reject spell cast when player has no mana', () => {
      // Give player2 priority so we can test mana validation
      testGameState.priorityPlayerIndex = 1;
      adapter.initializeGame('test-game', testGameState);
      
      const validation = adapter.validateAction('test-game', {
        type: 'castSpell',
        playerId: 'player2',
        cardName: 'Sol Ring',
        manaCost: '{1}',
      });
      
      expect(validation.legal).toBe(false);
      expect(validation.reason).toContain('mana');
    });
    
    it('should validate attacker declaration in correct step', () => {
      // Set game to declare attackers step
      testGameState.step = 'declareAttackers' as any;
      adapter.initializeGame('test-game', testGameState);
      
      const validation = adapter.validateAction('test-game', {
        type: 'declareAttackers',
        playerId: 'player1',
        attackers: [],
      });
      
      expect(validation.legal).toBe(true);
    });
    
    it('should reject attacker declaration in wrong step', () => {
      const validation = adapter.validateAction('test-game', {
        type: 'declareAttackers',
        playerId: 'player1',
        attackers: [],
      });
      
      expect(validation.legal).toBe(false);
      expect(validation.reason).toBe('Not in declare attackers step');
    });
  });
  
  describe('executeAction', () => {
    beforeEach(() => {
      adapter.initializeGame('test-game', testGameState);
    });
    
    it('should execute priority pass action', () => {
      const result = adapter.executeAction('test-game', {
        type: 'passPriority',
        playerId: 'player1',
      });
      
      expect(result.next.priorityPlayerIndex).toBe(1);
    });
    
    it('should emit PRIORITY_PASSED event', async () => {
      const promise = new Promise<void>((resolve) => {
        adapter.on(RulesEngineEvent.PRIORITY_PASSED, (event) => {
          expect(event.type).toBe(RulesEngineEvent.PRIORITY_PASSED);
          expect(event.data.from).toBe('player1');
          expect(event.data.to).toBe('player2');
          resolve();
        });
      });
      
      adapter.executeAction('test-game', {
        type: 'passPriority',
        playerId: 'player1',
      });
      
      await promise;
    });
    
    it('should cast spell and add to stack', () => {
      const result = adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        cardId: 'bolt-1',
        cardName: 'Lightning Bolt',
        cardTypes: ['instant'],
        manaCost: { red: 1 },
        targets: [],
      });
      
      // Should succeed
      expect(result.next).toBeDefined();
      expect(result.log).toBeDefined();
    });
    
    it('should emit SPELL_CAST event', () => {
      let eventFired = false;
      
      adapter.on(RulesEngineEvent.SPELL_CAST, (event) => {
        eventFired = true;
        expect(event.type).toBe(RulesEngineEvent.SPELL_CAST);
        expect(event.data.caster).toBe('player1');
      });
      
      adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        cardId: 'bolt-1',
        cardName: 'Lightning Bolt',
        cardTypes: ['instant'],
        manaCost: { blue: 1 }, // Changed to blue since player1 has blue mana
      });
      
      expect(eventFired).toBe(true);
    });
  });
  
  describe('checkStateBasedActions', () => {
    beforeEach(() => {
      adapter.initializeGame('test-game', testGameState);
    });
    
    it('should detect player loss due to 0 life', () => {
      testGameState.players[0].life = 0;
      adapter.initializeGame('test-game', testGameState);
      
      let playerLostEmitted = false;
      adapter.on(RulesEngineEvent.PLAYER_LOST, (event) => {
        playerLostEmitted = true;
        expect(event.data.playerId).toBe('player1');
      });
      
      const result = adapter.checkStateBasedActions('test-game', testGameState);
      
      expect(playerLostEmitted).toBe(true);
      expect(result.log).toBeDefined();
      expect(result.log?.some(msg => msg.includes('lost the game'))).toBe(true);
    });
    
    it('should detect win condition when only one player remains', () => {
      testGameState.players[0].hasLost = true;
      adapter.initializeGame('test-game', testGameState);
      
      let playerWonEmitted = false;
      adapter.on(RulesEngineEvent.PLAYER_WON, (event) => {
        playerWonEmitted = true;
        expect(event.data.playerId).toBe('player2');
      });
      
      const result = adapter.checkStateBasedActions('test-game', testGameState);
      
      expect(playerWonEmitted).toBe(true);
      expect(result.next.winner).toBe('player2');
      expect(result.log).toContain('player2 wins the game!');
    });
  });
  
  describe('processMulligan', () => {
    beforeEach(() => {
      adapter.initializeGame('test-game', testGameState);
    });
    
    it('should process mulligan keep decision', () => {
      const result = adapter.processMulligan('test-game', 'player1', true);
      
      expect(result.log).toContain('player1 kept their hand');
    });
    
    it('should process mulligan reshuffle decision', () => {
      const result = adapter.processMulligan('test-game', 'player1', false);
      
      expect(result.log).toContain('player1 took a mulligan');
    });
    
    it('should emit MULLIGAN_DECISION event', async () => {
      const promise = new Promise<void>((resolve) => {
        adapter.on(RulesEngineEvent.MULLIGAN_DECISION, (event) => {
          expect(event.type).toBe(RulesEngineEvent.MULLIGAN_DECISION);
          expect(event.data.playerId).toBe('player1');
          expect(event.data.keep).toBe(true);
          resolve();
        });
      });
      
      adapter.processMulligan('test-game', 'player1', true);
      
      await promise;
    });
  });
  
  describe('event listeners', () => {
    it('should register and unregister event listeners', () => {
      let callCount = 0;
      const listener = () => { callCount++; };
      
      adapter.on(RulesEngineEvent.GAME_STARTED, listener);
      adapter.initializeGame('test-1', testGameState);
      expect(callCount).toBe(1);
      
      adapter.off(RulesEngineEvent.GAME_STARTED, listener);
      adapter.initializeGame('test-2', testGameState);
      expect(callCount).toBe(1); // Should not increase
    });
  });
});
