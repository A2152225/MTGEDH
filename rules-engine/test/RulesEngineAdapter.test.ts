/**
 * Tests for RulesEngineAdapter
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RulesEngineAdapter, RulesEngineEvent } from '../src/RulesEngineAdapter';
import type { GameState } from '../../shared/src';
import { GameStep } from '../../shared/src';

describe('RulesEngineAdapter', () => {
  let adapter: RulesEngineAdapter;
  let testGameState: GameState;
  
  beforeEach(() => {
    adapter = new RulesEngineAdapter();
    testGameState = {
      id: 'test-game',
      format: 'commander' as any,
      life: {},
      turnPlayer: 'player1',
      priority: 'player1',
      active: true,
      players: [
        { 
          id: 'player1', 
          name: 'Player 1', 
          seat: 0,
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
          seat: 1,
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
      battlefield: [],
      commandZone: {},
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

    it('should require permission to play a land from exile', () => {
      const stateWithExileLand: any = {
        ...testGameState,
        phase: 'precombatMain' as any,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                exile: [{ id: 'land-ex1', name: 'Mountain', type_line: 'Basic Land — Mountain' }],
              }
            : p
        ),
        turn: 1,
        landsPlayedThisTurn: { player1: 0 },
      };

      adapter.initializeGame('test-game', stateWithExileLand);
      const denied = adapter.validateAction('test-game', {
        type: 'playLand',
        playerId: 'player1',
        fromZone: 'exile',
        cardId: 'land-ex1',
      });
      expect(denied.legal).toBe(false);

      stateWithExileLand.playableFromExile = { player1: { 'land-ex1': 10 } };
      adapter.initializeGame('test-game', stateWithExileLand);
      const allowed = adapter.validateAction('test-game', {
        type: 'playLand',
        playerId: 'player1',
        fromZone: 'exile',
        cardId: 'land-ex1',
      });
      expect(allowed.legal).toBe(true);
    });

    it('should require permission to cast from exile', () => {
      const stateWithExile: any = {
        ...testGameState,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                exile: [{ id: 'ex1', name: 'Opt', type_line: 'Instant' }],
              }
            : p
        ),
        turn: 1,
      };

      // No playableFromExile entry => should be illegal.
      adapter.initializeGame('test-game', stateWithExile);
      const denied = adapter.validateAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        fromZone: 'exile',
        cardId: 'ex1',
        card: { name: 'Opt', type_line: 'Instant' },
      });
      expect(denied.legal).toBe(false);

      // Omitting fromZone defaults to hand; since the card isn't in hand, it should be illegal.
      adapter.initializeGame('test-game', stateWithExile);
      const deniedNoFromZone = adapter.validateAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        cardId: 'ex1',
        card: { name: 'Opt', type_line: 'Instant' },
      });
      expect(deniedNoFromZone.legal).toBe(false);

      // Add permission => should be legal.
      stateWithExile.playableFromExile = { player1: { ex1: 10 } };
      adapter.initializeGame('test-game', stateWithExile);
      const allowed = adapter.validateAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        fromZone: 'exile',
        cardId: 'ex1',
        card: { name: 'Opt', type_line: 'Instant' },
      });
      expect(allowed.legal).toBe(true);
    });
    
    it('should validate attacker declaration in correct step', () => {
      // Set game to declare attackers step
      testGameState.step = GameStep.DECLARE_ATTACKERS;
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
      const stateWithHand: any = {
        ...testGameState,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                hand: [{ id: 'opt-1', name: 'Opt', type_line: 'Instant' }],
              }
            : p
        ),
      };

      adapter.initializeGame('test-game', stateWithHand);
      const result = adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        cardId: 'opt-1',
        cardName: 'Opt',
        cardTypes: ['instant'],
        manaCost: '{U}',
        targets: [],
      });
      
      // Should succeed
      expect(result.next).toBeDefined();
      expect(result.log).toBeDefined();
    });
    
    it('should emit SPELL_CAST event', () => {
      let eventFired = false;

      const stateWithHand: any = {
        ...testGameState,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                hand: [{ id: 'opt-1', name: 'Opt', type_line: 'Instant' }],
              }
            : p
        ),
      };

      adapter.initializeGame('test-game', stateWithHand);
      
      adapter.on(RulesEngineEvent.SPELL_CAST, (event) => {
        eventFired = true;
        expect(event.type).toBe(RulesEngineEvent.SPELL_CAST);
        expect(event.data.caster).toBe('player1');
      });
      
      adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        cardId: 'opt-1',
        cardName: 'Opt',
        cardTypes: ['instant'],
        manaCost: '{U}',
      });
      
      expect(eventFired).toBe(true);
    });

    it('should play a land from exile when permitted', () => {
      const stateWithExileLand: any = {
        ...testGameState,
        phase: 'precombatMain' as any,
        step: 'main' as any,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                exile: [{ id: 'land-ex1', name: 'Mountain', type_line: 'Basic Land — Mountain', canBePlayedBy: 'player1', playableUntilTurn: 10 }],
              }
            : p
        ),
        playableFromExile: { player1: { 'land-ex1': 10 } },
        turn: 1,
        landsPlayedThisTurn: { player1: 0 },
        battlefield: [],
      };

      adapter.initializeGame('test-game', stateWithExileLand);
      const result = adapter.executeAction('test-game', {
        type: 'playLand',
        playerId: 'player1',
        fromZone: 'exile',
        cardId: 'land-ex1',
      });

      const p1 = result.next.players.find(p => p.id === 'player1') as any;
      expect((p1.exile || []).some((c: any) => c.id === 'land-ex1')).toBe(false);
      expect(((result.next as any).battlefield || []).some((perm: any) => perm.id === 'land-ex1')).toBe(true);
      expect((result.next as any).landsPlayedThisTurn?.player1).toBe(1);
      expect((result.next as any).playableFromExile?.player1?.['land-ex1']).toBeUndefined();
    });

    it('should remove a spell from exile when it is cast from exile', () => {
      const stateWithExile: any = {
        ...testGameState,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                exile: [{ id: 'ex1', name: 'Opt', type_line: 'Instant', canBePlayedBy: 'player1', playableUntilTurn: 10 }],
                manaPool: { white: 5, blue: 5, black: 0, red: 0, green: 0, colorless: 0 },
              }
            : p
        ),
        playableFromExile: { player1: { ex1: 10 } },
        turn: 1,
      };

      adapter.initializeGame('test-game', stateWithExile);
      const result = adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        fromZone: 'exile',
        cardId: 'ex1',
        cardName: 'Opt',
        cardTypes: ['instant'],
        manaCost: { blue: 1 },
        targets: [],
      });

      const p1 = result.next.players.find(p => p.id === 'player1') as any;
      expect((p1.exile || []).some((c: any) => c.id === 'ex1')).toBe(false);
      expect((result.next as any).playableFromExile?.player1?.ex1).toBeUndefined();
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
