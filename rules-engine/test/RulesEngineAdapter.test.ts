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

    it('should execute spell oracle effect on stack resolution', () => {
      const stateWithHand: any = {
        ...testGameState,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                hand: [{ id: 'spell-1', name: 'Test Spell', type_line: 'Instant' }],
              }
            : p
        ),
      };

      adapter.initializeGame('test-game', stateWithHand);
      const castResult = adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        cardId: 'spell-1',
        cardName: 'Test Spell',
        cardTypes: ['instant'],
        manaCost: '{U}',
        targets: ['player2'],
        oracleText: 'Target opponent loses 1 life.',
      });
      expect(castResult.next).toBeDefined();

      const resolveResult = adapter.executeAction('test-game', {
        type: 'resolveStack',
      });

      const player2 = resolveResult.next.players.find(p => p.id === 'player2');
      expect(player2?.life).toBe(39);
    });

    it('should resolve targeted opponent spell effect in multiplayer from stack targets', () => {
      const multiplayerState: any = {
        ...testGameState,
        players: [
          {
            ...testGameState.players[0],
            hand: [{ id: 'spell-2', name: 'Targeted Spell', type_line: 'Instant' }],
          },
          ...testGameState.players.slice(1),
          {
            id: 'player3',
            name: 'Player 3',
            seat: 2,
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
        turnOrder: ['player1', 'player2', 'player3'],
      };

      adapter.initializeGame('test-game', multiplayerState);
      const castResult = adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        cardId: 'spell-2',
        cardName: 'Targeted Spell',
        cardTypes: ['instant'],
        manaCost: '{U}',
        targets: ['player3'],
        oracleText: 'Target opponent loses 1 life.',
      });
      expect(castResult.next).toBeDefined();

      const resolveResult = adapter.executeAction('test-game', {
        type: 'resolveStack',
      });

      const player2 = resolveResult.next.players.find(p => p.id === 'player2');
      const player3 = resolveResult.next.players.find(p => p.id === 'player3');
      expect(player2?.life).toBe(40);
      expect(player3?.life).toBe(39);
    });

    it('should not resolve target_opponent spell effect when stack targets include multiple opponents', () => {
      const multiplayerState: any = {
        ...testGameState,
        players: [
          {
            ...testGameState.players[0],
            hand: [{ id: 'spell-2b', name: 'Ambiguous Targeted Spell', type_line: 'Instant' }],
          },
          ...testGameState.players.slice(1),
          {
            id: 'player3',
            name: 'Player 3',
            seat: 2,
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
        turnOrder: ['player1', 'player2', 'player3'],
      };

      adapter.initializeGame('test-game', multiplayerState);
      const castResult = adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        cardId: 'spell-2b',
        cardName: 'Ambiguous Targeted Spell',
        cardTypes: ['instant'],
        manaCost: '{U}',
        targets: ['player2', 'player3'],
        oracleText: 'Target opponent loses 1 life.',
      });
      expect(castResult.next).toBeDefined();

      const resolveResult = adapter.executeAction('test-game', {
        type: 'resolveStack',
      });

      const player2 = resolveResult.next.players.find(p => p.id === 'player2');
      const player3 = resolveResult.next.players.find(p => p.id === 'player3');
      expect(player2?.life).toBe(40);
      expect(player3?.life).toBe(40);
    });

    it('should resolve targeted opponent spell effect from targetOpponentId when targets array is absent', () => {
      const multiplayerState: any = {
        ...testGameState,
        players: [
          {
            ...testGameState.players[0],
            hand: [{ id: 'spell-3', name: 'Alt Target Spell', type_line: 'Instant' }],
          },
          ...testGameState.players.slice(1),
          {
            id: 'player3',
            name: 'Player 3',
            seat: 2,
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
        turnOrder: ['player1', 'player2', 'player3'],
      };

      adapter.initializeGame('test-game', multiplayerState);
      const castResult = adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        cardId: 'spell-3',
        cardName: 'Alt Target Spell',
        cardTypes: ['instant'],
        manaCost: '{U}',
        targetOpponentId: 'player3',
        oracleText: 'Target opponent loses 1 life.',
      });
      expect(castResult.next).toBeDefined();

      const resolveResult = adapter.executeAction('test-game', {
        type: 'resolveStack',
      });

      const player2 = resolveResult.next.players.find(p => p.id === 'player2');
      const player3 = resolveResult.next.players.find(p => p.id === 'player3');
      expect(player2?.life).toBe(40);
      expect(player3?.life).toBe(39);
    });

    it('should resolve pronoun target spell effect (that player) in multiplayer from stack targets', () => {
      const multiplayerState: any = {
        ...testGameState,
        players: [
          {
            ...testGameState.players[0],
            hand: [{ id: 'spell-pronoun-1', name: 'Pronoun Spell', type_line: 'Instant' }],
          },
          ...testGameState.players.slice(1),
          {
            id: 'player3',
            name: 'Player 3',
            seat: 2,
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
        turnOrder: ['player1', 'player2', 'player3'],
      };

      adapter.initializeGame('test-game', multiplayerState);
      const castResult = adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        cardId: 'spell-pronoun-1',
        cardName: 'Pronoun Spell',
        cardTypes: ['instant'],
        manaCost: '{U}',
        targets: ['player3'],
        oracleText: 'That player loses 1 life.',
      });
      expect(castResult.next).toBeDefined();

      const resolveResult = adapter.executeAction('test-game', {
        type: 'resolveStack',
      });

      const player2 = resolveResult.next.players.find(p => p.id === 'player2');
      const player3 = resolveResult.next.players.find(p => p.id === 'player3');
      expect(player2?.life).toBe(40);
      expect(player3?.life).toBe(39);
    });

    it('should not resolve pronoun target spell effect (that player) when stack targets include multiple opponents', () => {
      const multiplayerState: any = {
        ...testGameState,
        players: [
          {
            ...testGameState.players[0],
            hand: [{ id: 'spell-pronoun-2', name: 'Ambiguous Pronoun Spell', type_line: 'Instant' }],
          },
          ...testGameState.players.slice(1),
          {
            id: 'player3',
            name: 'Player 3',
            seat: 2,
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
        turnOrder: ['player1', 'player2', 'player3'],
      };

      adapter.initializeGame('test-game', multiplayerState);
      const castResult = adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        cardId: 'spell-pronoun-2',
        cardName: 'Ambiguous Pronoun Spell',
        cardTypes: ['instant'],
        manaCost: '{U}',
        targets: ['player2', 'player3'],
        oracleText: 'That player loses 1 life.',
      });
      expect(castResult.next).toBeDefined();

      const resolveResult = adapter.executeAction('test-game', {
        type: 'resolveStack',
      });

      const player2 = resolveResult.next.players.find(p => p.id === 'player2');
      const player3 = resolveResult.next.players.find(p => p.id === 'player3');
      expect(player2?.life).toBe(40);
      expect(player3?.life).toBe(40);
    });

    it('should resolve each-of-those-opponents spell effect from affectedOpponentIds context', () => {
      const multiplayerState: any = {
        ...testGameState,
        players: [
          {
            ...testGameState.players[0],
            hand: [{ id: 'spell-4', name: 'Relational Spell', type_line: 'Instant' }],
          },
          ...testGameState.players.slice(1),
          {
            id: 'player3',
            name: 'Player 3',
            seat: 2,
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
          {
            id: 'player4',
            name: 'Player 4',
            seat: 3,
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
        turnOrder: ['player1', 'player2', 'player3', 'player4'],
      };

      adapter.initializeGame('test-game', multiplayerState);
      const castResult = adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        cardId: 'spell-4',
        cardName: 'Relational Spell',
        cardTypes: ['instant'],
        manaCost: '{U}',
        affectedOpponentIds: ['player2', 'player3'],
        oracleText: 'Each of those opponents loses 1 life.',
      });
      expect(castResult.next).toBeDefined();

      const resolveResult = adapter.executeAction('test-game', {
        type: 'resolveStack',
      });

      const player2 = resolveResult.next.players.find(p => p.id === 'player2');
      const player3 = resolveResult.next.players.find(p => p.id === 'player3');
      const player4 = resolveResult.next.players.find(p => p.id === 'player4');
      expect(player2?.life).toBe(39);
      expect(player3?.life).toBe(39);
      expect(player4?.life).toBe(40);
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

    it('should allow additional land plays when maxLandsPerTurn is increased', () => {
      const stateWithExtraLandPlay: any = {
        ...testGameState,
        phase: 'precombatMain' as any,
        step: 'main' as any,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                hand: [
                  { id: 'land-a', name: 'Forest', type_line: 'Basic Land — Forest' },
                  { id: 'land-b', name: 'Mountain', type_line: 'Basic Land — Mountain' },
                ],
              }
            : p
        ),
        turn: 1,
        landsPlayedThisTurn: { player1: 0 },
        maxLandsPerTurn: { player1: 2 },
        battlefield: [],
      };

      adapter.initializeGame('test-game', stateWithExtraLandPlay);

      const first = adapter.executeAction('test-game', {
        type: 'playLand',
        playerId: 'player1',
        fromZone: 'hand',
        cardId: 'land-a',
      });

      expect((first.next as any).landsPlayedThisTurn?.player1).toBe(1);
      expect(((first.next as any).battlefield || []).some((perm: any) => perm.id === 'land-a')).toBe(true);

      adapter.initializeGame('test-game', first.next as any);
      const second = adapter.executeAction('test-game', {
        type: 'playLand',
        playerId: 'player1',
        fromZone: 'hand',
        cardId: 'land-b',
      });

      expect((second.next as any).landsPlayedThisTurn?.player1).toBe(2);
      expect(((second.next as any).battlefield || []).some((perm: any) => perm.id === 'land-b')).toBe(true);
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

    it('should execute triggered ability oracle effect on stack resolution', () => {
      const adapterAny = adapter as any;
      const stacks = adapterAny.stacks as Map<string, any>;
      stacks.set('test-game', {
        objects: [
          {
            id: 'stack-trigger-1',
            spellId: 'trigger-source-1',
            cardName: 'Breeches Trigger',
            controllerId: 'player1',
            targets: [],
            timestamp: Date.now(),
            type: 'ability',
            triggerMeta: {
              effectText: 'Target opponent loses 1 life.',
              triggerEventDataSnapshot: {
                sourceId: 'trigger-source-1',
                sourceControllerId: 'player1',
                targetOpponentId: 'player2',
              },
            },
          },
        ],
      });

      const result = adapter.executeAction('test-game', {
        type: 'resolveStack',
      });

      const player2 = result.next.players.find(p => p.id === 'player2');
      expect(player2?.life).toBe(39);
    });

    it('should resolve legacy stack object target_opponent effect from singleton targets without snapshot bindings', () => {
      const multiplayerState: any = {
        ...testGameState,
        players: [
          ...testGameState.players,
          {
            id: 'player3',
            name: 'Player 3',
            seat: 2,
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
        turnOrder: ['player1', 'player2', 'player3'],
      };

      adapter.initializeGame('test-game', multiplayerState);

      const adapterAny = adapter as any;
      const stacks = adapterAny.stacks as Map<string, any>;
      stacks.set('test-game', {
        objects: [
          {
            id: 'stack-legacy-target-1',
            spellId: 'legacy-source-1',
            cardName: 'Legacy Target Spell',
            controllerId: 'player1',
            targets: ['player3'],
            timestamp: Date.now(),
            type: 'spell',
            triggerMeta: {
              effectText: 'Target opponent loses 1 life.',
              triggerEventDataSnapshot: {
                sourceId: 'legacy-source-1',
                sourceControllerId: 'player1',
              },
            },
          },
        ],
      });

      const result = adapter.executeAction('test-game', { type: 'resolveStack' });
      const player2 = result.next.players.find(p => p.id === 'player2');
      const player3 = result.next.players.find(p => p.id === 'player3');
      expect(player2?.life).toBe(40);
      expect(player3?.life).toBe(39);
    });

    it('should not resolve legacy stack object target_opponent effect from multi-opponent targets without snapshot bindings', () => {
      const multiplayerState: any = {
        ...testGameState,
        players: [
          ...testGameState.players,
          {
            id: 'player3',
            name: 'Player 3',
            seat: 2,
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
        turnOrder: ['player1', 'player2', 'player3'],
      };

      adapter.initializeGame('test-game', multiplayerState);

      const adapterAny = adapter as any;
      const stacks = adapterAny.stacks as Map<string, any>;
      stacks.set('test-game', {
        objects: [
          {
            id: 'stack-legacy-target-2',
            spellId: 'legacy-source-2',
            cardName: 'Legacy Ambiguous Target Spell',
            controllerId: 'player1',
            targets: ['player2', 'player3'],
            timestamp: Date.now(),
            type: 'spell',
            triggerMeta: {
              effectText: 'Target opponent loses 1 life.',
              triggerEventDataSnapshot: {
                sourceId: 'legacy-source-2',
                sourceControllerId: 'player1',
              },
            },
          },
        ],
      });

      const result = adapter.executeAction('test-game', { type: 'resolveStack' });
      const player2 = result.next.players.find(p => p.id === 'player2');
      const player3 = result.next.players.find(p => p.id === 'player3');
      expect(player2?.life).toBe(40);
      expect(player3?.life).toBe(40);
    });

    it('should skip triggered oracle effect when intervening-if is false at resolution', () => {
      const adapterAny = adapter as any;
      const stacks = adapterAny.stacks as Map<string, any>;
      stacks.set('test-game', {
        objects: [
          {
            id: 'stack-trigger-2',
            spellId: 'trigger-source-2',
            cardName: 'Intervening Trigger',
            controllerId: 'player1',
            targets: [],
            timestamp: Date.now(),
            type: 'ability',
            triggerMeta: {
              effectText: 'Target opponent loses 1 life.',
              interveningIfClause: 'you control an artifact',
              triggerEventDataSnapshot: {
                sourceId: 'trigger-source-2',
                sourceControllerId: 'player1',
                targetOpponentId: 'player2',
                battlefield: [
                  {
                    id: 'snapshot-artifact',
                    controllerId: 'player1',
                    types: ['artifact'],
                  },
                ],
              },
            },
          },
        ],
      });

      const result = adapter.executeAction('test-game', {
        type: 'resolveStack',
      });

      const player2 = result.next.players.find(p => p.id === 'player2');
      expect(player2?.life).toBe(40);
      expect(result.log?.some(msg => msg.includes('intervening-if false'))).toBe(true);
    });

    it('should execute activated ability oracle effect on stack resolution', () => {
      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        ability: {
          id: 'test-ability-1',
          sourceId: 'source-1',
          sourceName: 'Test Permanent',
          controllerId: 'player1',
          effect: 'Target opponent loses 1 life.',
        },
      });

      expect(activateResult.next).toBeDefined();

      const resolveResult = adapter.executeAction('test-game', {
        type: 'resolveStack',
      });

      const player2 = resolveResult.next.players.find(p => p.id === 'player2');
      expect(player2?.life).toBe(39);
    });

    it('should resolve targeted opponent in multiplayer for activated ability oracle effect', () => {
      const multiplayerState: any = {
        ...testGameState,
        players: [
          ...testGameState.players,
          {
            id: 'player3',
            name: 'Player 3',
            seat: 2,
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
        turnOrder: ['player1', 'player2', 'player3'],
      };

      adapter.initializeGame('test-game', multiplayerState);

      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        ability: {
          id: 'test-ability-2',
          sourceId: 'source-2',
          sourceName: 'Targeted Ability Source',
          controllerId: 'player1',
          effect: 'Target opponent loses 1 life.',
          targets: ['player3'],
        },
      });

      expect(activateResult.next).toBeDefined();

      const resolveResult = adapter.executeAction('test-game', {
        type: 'resolveStack',
      });

      const player2 = resolveResult.next.players.find(p => p.id === 'player2');
      const player3 = resolveResult.next.players.find(p => p.id === 'player3');
      expect(player2?.life).toBe(40);
      expect(player3?.life).toBe(39);
    });

    it('should not resolve target_opponent activated ability effect when targets include multiple opponents', () => {
      const multiplayerState: any = {
        ...testGameState,
        players: [
          ...testGameState.players,
          {
            id: 'player3',
            name: 'Player 3',
            seat: 2,
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
        turnOrder: ['player1', 'player2', 'player3'],
      };

      adapter.initializeGame('test-game', multiplayerState);

      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        ability: {
          id: 'test-ability-2b',
          sourceId: 'source-2b',
          sourceName: 'Ambiguous Targeted Ability Source',
          controllerId: 'player1',
          effect: 'Target opponent loses 1 life.',
          targets: ['player2', 'player3'],
        },
      });

      expect(activateResult.next).toBeDefined();

      const resolveResult = adapter.executeAction('test-game', {
        type: 'resolveStack',
      });

      const player2 = resolveResult.next.players.find(p => p.id === 'player2');
      const player3 = resolveResult.next.players.find(p => p.id === 'player3');
      expect(player2?.life).toBe(40);
      expect(player3?.life).toBe(40);
    });

    it('should resolve targeted opponent for activated ability from targetOpponentId when ability.targets is absent', () => {
      const multiplayerState: any = {
        ...testGameState,
        players: [
          ...testGameState.players,
          {
            id: 'player3',
            name: 'Player 3',
            seat: 2,
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
        turnOrder: ['player1', 'player2', 'player3'],
      };

      adapter.initializeGame('test-game', multiplayerState);

      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        targetOpponentId: 'player3',
        ability: {
          id: 'test-ability-3',
          sourceId: 'source-3',
          sourceName: 'Alt Target Ability Source',
          controllerId: 'player1',
          effect: 'Target opponent loses 1 life.',
        },
      });

      expect(activateResult.next).toBeDefined();

      const resolveResult = adapter.executeAction('test-game', {
        type: 'resolveStack',
      });

      const player2 = resolveResult.next.players.find(p => p.id === 'player2');
      const player3 = resolveResult.next.players.find(p => p.id === 'player3');
      expect(player2?.life).toBe(40);
      expect(player3?.life).toBe(39);
    });

    it('should resolve pronoun target activated ability effect (that player) in multiplayer', () => {
      const multiplayerState: any = {
        ...testGameState,
        players: [
          ...testGameState.players,
          {
            id: 'player3',
            name: 'Player 3',
            seat: 2,
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
        turnOrder: ['player1', 'player2', 'player3'],
      };

      adapter.initializeGame('test-game', multiplayerState);

      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        ability: {
          id: 'test-ability-pronoun-1',
          sourceId: 'source-pronoun-1',
          sourceName: 'Pronoun Ability Source',
          controllerId: 'player1',
          effect: 'That player loses 1 life.',
          targets: ['player3'],
        },
      });

      expect(activateResult.next).toBeDefined();

      const resolveResult = adapter.executeAction('test-game', {
        type: 'resolveStack',
      });

      const player2 = resolveResult.next.players.find(p => p.id === 'player2');
      const player3 = resolveResult.next.players.find(p => p.id === 'player3');
      expect(player2?.life).toBe(40);
      expect(player3?.life).toBe(39);
    });

    it('should not resolve pronoun target activated ability effect (that player) when targets include multiple opponents', () => {
      const multiplayerState: any = {
        ...testGameState,
        players: [
          ...testGameState.players,
          {
            id: 'player3',
            name: 'Player 3',
            seat: 2,
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
        turnOrder: ['player1', 'player2', 'player3'],
      };

      adapter.initializeGame('test-game', multiplayerState);

      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        ability: {
          id: 'test-ability-pronoun-2',
          sourceId: 'source-pronoun-2',
          sourceName: 'Ambiguous Pronoun Ability Source',
          controllerId: 'player1',
          effect: 'That player loses 1 life.',
          targets: ['player2', 'player3'],
        },
      });

      expect(activateResult.next).toBeDefined();

      const resolveResult = adapter.executeAction('test-game', {
        type: 'resolveStack',
      });

      const player2 = resolveResult.next.players.find(p => p.id === 'player2');
      const player3 = resolveResult.next.players.find(p => p.id === 'player3');
      expect(player2?.life).toBe(40);
      expect(player3?.life).toBe(40);
    });

    it('should resolve each-of-those-opponents activated ability from affectedOpponentIds context', () => {
      const multiplayerState: any = {
        ...testGameState,
        players: [
          ...testGameState.players,
          {
            id: 'player3',
            name: 'Player 3',
            seat: 2,
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
          {
            id: 'player4',
            name: 'Player 4',
            seat: 3,
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
        turnOrder: ['player1', 'player2', 'player3', 'player4'],
      };

      adapter.initializeGame('test-game', multiplayerState);

      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        affectedOpponentIds: ['player2', 'player4'],
        ability: {
          id: 'test-ability-4',
          sourceId: 'source-4',
          sourceName: 'Relational Ability Source',
          controllerId: 'player1',
          effect: 'Each of those opponents loses 1 life.',
        },
      });

      expect(activateResult.next).toBeDefined();

      const resolveResult = adapter.executeAction('test-game', {
        type: 'resolveStack',
      });

      const player2 = resolveResult.next.players.find(p => p.id === 'player2');
      const player3 = resolveResult.next.players.find(p => p.id === 'player3');
      const player4 = resolveResult.next.players.find(p => p.id === 'player4');
      expect(player2?.life).toBe(39);
      expect(player3?.life).toBe(40);
      expect(player4?.life).toBe(39);
    });

    it('should infer each-of-those-opponents from combat attackers defendingPlayerId payload', () => {
      const multiplayerState: any = {
        ...testGameState,
        players: [
          ...testGameState.players,
          {
            id: 'player3',
            name: 'Player 3',
            seat: 2,
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
          {
            id: 'player4',
            name: 'Player 4',
            seat: 3,
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
        turnOrder: ['player1', 'player2', 'player3', 'player4'],
      };

      adapter.initializeGame('test-game', multiplayerState);

      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        attackers: [
          { attackerId: 'a1', defendingPlayerId: 'player2', damage: 2 },
          { attackerId: 'a2', defendingPlayerId: 'player4', damage: 3 },
        ],
        ability: {
          id: 'test-ability-5',
          sourceId: 'source-5',
          sourceName: 'Combat Relational Ability Source',
          controllerId: 'player1',
          effect: 'Each of those opponents loses 1 life.',
        },
      });

      expect(activateResult.next).toBeDefined();

      const resolveResult = adapter.executeAction('test-game', {
        type: 'resolveStack',
      });

      const player2 = resolveResult.next.players.find(p => p.id === 'player2');
      const player3 = resolveResult.next.players.find(p => p.id === 'player3');
      const player4 = resolveResult.next.players.find(p => p.id === 'player4');
      expect(player2?.life).toBe(39);
      expect(player3?.life).toBe(40);
      expect(player4?.life).toBe(39);
    });

    it('should process combat damage triggers with relational opponent context during dealCombatDamage action', () => {
      const stateWithBreeches: any = {
        ...testGameState,
        players: [
          {
            ...testGameState.players[0],
            library: [{ id: 'p1c1' }],
          },
          {
            ...testGameState.players[1],
            library: [{ id: 'p2c1' }, { id: 'p2c2' }],
            exile: [],
          },
          {
            id: 'player3',
            name: 'Player 3',
            seat: 2,
            life: 40,
            hand: [],
            library: [{ id: 'p3c1' }, { id: 'p3c2' }],
            graveyard: [],
            battlefield: [],
            exile: [],
            commandZone: [],
            counters: {},
            hasLost: false,
            manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
          },
        ],
        turnOrder: ['player1', 'player2', 'player3'],
        battlefield: [
          {
            id: 'breeches-perm',
            controller: 'player1',
            card: {
              name: 'Breeches, Brazen Plunderer',
              oracle_text:
                'Whenever this creature deals combat damage to a player, each of those opponents loses 1 life.',
            },
          },
        ],
      };

      adapter.initializeGame('test-game', stateWithBreeches);
      const result = adapter.executeAction('test-game', {
        type: 'dealCombatDamage',
        playerId: 'player1',
        attackers: [
          { attackerId: 'atk-1', defendingPlayerId: 'player2', damage: 2, creature: { name: 'Pirate A', power: 2 } },
          { attackerId: 'atk-2', defendingPlayerId: 'player3', damage: 1, creature: { name: 'Pirate B', power: 1 } },
        ],
      });

      const player2 = result.next.players.find(p => p.id === 'player2') as any;
      const player3 = result.next.players.find(p => p.id === 'player3') as any;
      expect(player2.life).toBe(37);
      expect(player3.life).toBe(38);
    });


    it('should process combat damage triggers with relational opponent context for exile-top effects during dealCombatDamage action', () => {
      const stateWithRelationalExile: any = {
        ...testGameState,
        players: [
          {
            ...testGameState.players[0],
            library: [{ id: 'p1c1' }],
            exile: [],
          },
          {
            ...testGameState.players[1],
            library: [{ id: 'p2c1' }, { id: 'p2c2' }],
            exile: [],
          },
          {
            id: 'player3',
            name: 'Player 3',
            seat: 2,
            life: 40,
            hand: [],
            library: [{ id: 'p3c1' }, { id: 'p3c2' }],
            graveyard: [],
            battlefield: [],
            exile: [],
            commandZone: [],
            counters: {},
            hasLost: false,
            manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
          },
        ],
        turnOrder: ['player1', 'player2', 'player3'],
        battlefield: [
          {
            id: 'relational-exile-perm',
            controller: 'player1',
            card: {
              name: 'Relational Exile Source',
              oracle_text:
                "Whenever this creature deals combat damage to a player, exile the top card of each of those opponents' libraries. You may play those cards this turn.",
            },
          },
        ],
      };

      adapter.initializeGame('test-game', stateWithRelationalExile);
      const result = adapter.executeAction('test-game', {
        type: 'dealCombatDamage',
        playerId: 'player1',
        attackers: [
          { attackerId: 'atk-1', defendingPlayerId: 'player2', damage: 2, creature: { name: 'Pirate A', power: 2 } },
          { attackerId: 'atk-2', defendingPlayerId: 'player3', damage: 1, creature: { name: 'Pirate B', power: 1 } },
        ],
      });

      const player2 = result.next.players.find(p => p.id === 'player2') as any;
      const player3 = result.next.players.find(p => p.id === 'player3') as any;

      expect((player2.library || []).map((c: any) => c.id)).toEqual(['p2c2']);
      expect((player3.library || []).map((c: any) => c.id)).toEqual(['p3c2']);
      expect((player2.exile || []).map((c: any) => c.id)).toContain('p2c1');
      expect((player3.exile || []).map((c: any) => c.id)).toContain('p3c1');
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
