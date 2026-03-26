/**
 * Tests for RulesEngineAdapter
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RulesEngineAdapter, RulesEngineEvent } from '../src/RulesEngineAdapter';
import type { GameState } from '../../shared/src';
import { GameStep } from '../../shared/src';
import {
  createDelayedTrigger,
  DelayedTriggerTiming,
  registerDelayedTrigger,
} from '../src/delayedTriggeredAbilities';
import { createEmblemFromPlaneswalker } from '../src/emblemSupport';
import { applyTemporaryCantLoseAndOpponentsCantWinEffect } from '../src/winEffectCards';
import { makeMerfolkIterationState } from './helpers/merfolkIterationFixture';

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

    it('should require permission to cast from graveyard', () => {
      const stateWithGraveyard: any = {
        ...testGameState,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                graveyard: [{ id: 'gy1', name: 'Opt', type_line: 'Instant' }],
              }
            : p
        ),
        turn: 1,
      };

      adapter.initializeGame('test-game', stateWithGraveyard);
      const denied = adapter.validateAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        fromZone: 'graveyard',
        cardId: 'gy1',
        card: { name: 'Opt', type_line: 'Instant' },
      });
      expect(denied.legal).toBe(false);

      stateWithGraveyard.playableFromGraveyard = { player1: { gy1: 10 } };
      adapter.initializeGame('test-game', stateWithGraveyard);
      const allowed = adapter.validateAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        fromZone: 'graveyard',
        cardId: 'gy1',
        card: { name: 'Opt', type_line: 'Instant' },
      });
      expect(allowed.legal).toBe(true);
    });

    it('should require permission to play a land from graveyard', () => {
      const stateWithGraveyardLand: any = {
        ...testGameState,
        phase: 'precombatMain' as any,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                graveyard: [{ id: 'gy-land', name: 'Mountain', type_line: 'Basic Land - Mountain' }],
              }
            : p
        ),
        turn: 1,
        landsPlayedThisTurn: { player1: 0 },
      };

      adapter.initializeGame('test-game', stateWithGraveyardLand);
      const denied = adapter.validateAction('test-game', {
        type: 'playLand',
        playerId: 'player1',
        fromZone: 'graveyard',
        cardId: 'gy-land',
      });
      expect(denied.legal).toBe(false);

      stateWithGraveyardLand.playableFromGraveyard = { player1: { 'gy-land': 10 } };
      adapter.initializeGame('test-game', stateWithGraveyardLand);
      const allowed = adapter.validateAction('test-game', {
        type: 'playLand',
        playerId: 'player1',
        fromZone: 'graveyard',
        cardId: 'gy-land',
      });
      expect(allowed.legal).toBe(true);
    });

    it('should derive spell timing from the source-zone card when action card data is omitted', () => {
      const stateWithSorceryInHand: any = {
        ...testGameState,
        phase: 'beginning' as any,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                hand: [{ id: 'sorcery-1', name: 'Divination', type_line: 'Sorcery' }],
              }
            : p
        ),
      };

      adapter.initializeGame('test-game', stateWithSorceryInHand);
      const validation = adapter.validateAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        cardId: 'sorcery-1',
      });

      expect(validation.legal).toBe(false);
      expect(validation.reason).toContain('main phase');
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

    it('should derive cast metadata from the source-zone card when action fields are omitted', () => {
      const stateWithHand: any = {
        ...testGameState,
        phase: 'precombatMain' as any,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                hand: [{ id: 'opt-derive', name: 'Opt', type_line: 'Instant', oracle_text: 'Draw a card.' }],
              }
            : p
        ),
      };

      adapter.initializeGame('test-game', stateWithHand);
      const result = adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        cardId: 'opt-derive',
        manaCost: '{U}',
        targets: [],
      });

      expect(result.log).toContain('player1 announces Opt');
      const stackObjects = ((adapter as any).stacks.get('test-game')?.objects || []) as any[];
      expect(stackObjects).toHaveLength(1);
      expect(stackObjects[0].cardName).toBe('Opt');
    });

    it('returns a buyback spell to hand after resolution when the buyback cost is paid', () => {
      const stateWithBuybackSpell: any = {
        ...testGameState,
        phase: 'precombatMain' as any,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                hand: [
                  {
                    id: 'buyback-spell',
                    name: 'Whispers Test',
                    type_line: 'Instant',
                    mana_cost: '{1}{U}',
                    oracle_text: 'Target opponent loses 1 life.\nBuyback {3}',
                  },
                ],
                manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 4 },
              }
            : p
        ),
      };

      adapter.initializeGame('test-game', stateWithBuybackSpell);
      const castResult = adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        cardId: 'buyback-spell',
        cardTypes: ['instant'],
        targets: ['player2'],
        payBuyback: true,
      });

      const casterAfterCast = castResult.next.players.find(p => p.id === 'player1') as any;
      expect(casterAfterCast.manaPool).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });

      const resolveResult = adapter.executeAction('test-game', {
        type: 'resolveStack',
      });

      const caster = resolveResult.next.players.find(p => p.id === 'player1') as any;
      const opponent = resolveResult.next.players.find(p => p.id === 'player2') as any;
      expect((caster.hand || []).some((c: any) => c.id === 'buyback-spell')).toBe(true);
      expect((caster.graveyard || []).some((c: any) => c.id === 'buyback-spell')).toBe(false);
      expect(opponent.life).toBe(39);
    });

    it('puts a buyback spell into graveyard after resolution when the buyback cost is not paid', () => {
      const stateWithBuybackSpell: any = {
        ...testGameState,
        phase: 'precombatMain' as any,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                hand: [
                  {
                    id: 'buyback-spell-plain',
                    name: 'Whispers Test',
                    type_line: 'Instant',
                    mana_cost: '{1}{U}',
                    oracle_text: 'Target opponent loses 1 life.\nBuyback {3}',
                  },
                ],
                manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 1 },
              }
            : p
        ),
      };

      adapter.initializeGame('test-game', stateWithBuybackSpell);
      adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        cardId: 'buyback-spell-plain',
        cardTypes: ['instant'],
        manaCost: '{1}{U}',
        targets: ['player2'],
      });

      const resolveResult = adapter.executeAction('test-game', {
        type: 'resolveStack',
      });

      const caster = resolveResult.next.players.find(p => p.id === 'player1') as any;
      const opponent = resolveResult.next.players.find(p => p.id === 'player2') as any;
      expect((caster.hand || []).some((c: any) => c.id === 'buyback-spell-plain')).toBe(false);
      expect((caster.graveyard || []).some((c: any) => c.id === 'buyback-spell-plain')).toBe(true);
      expect(opponent.life).toBe(39);
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

    it('should charge replicate costs and resolve one copy per payment using the same targets', () => {
      const stateWithReplicateSpell: any = {
        ...testGameState,
        phase: 'precombatMain' as any,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                hand: [
                  {
                    id: 'pyromatics',
                    name: 'Replicate Test',
                    type_line: 'Instant',
                    mana_cost: '{1}{U}',
                    oracle_text: 'Target opponent loses 1 life.\nReplicate {1}{U}',
                  },
                ],
                manaPool: { white: 0, blue: 3, black: 0, red: 0, green: 0, colorless: 3 },
              }
            : p
        ),
      };

      adapter.initializeGame('test-game', stateWithReplicateSpell);
      const castResult = adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        cardId: 'pyromatics',
        cardTypes: ['instant'],
        targets: ['player2'],
        replicateCount: 2,
      });

      const casterAfterCast = castResult.next.players.find(p => p.id === 'player1') as any;
      expect(casterAfterCast.manaPool).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });

      const resolveResult = adapter.executeAction('test-game', {
        type: 'resolveStack',
      });

      const player2 = resolveResult.next.players.find(p => p.id === 'player2');
      expect(player2?.life).toBe(37);
    });

    it("should resolve Sevinne's Reclamation from graveyard and replay the copied spell onto the remaining unique target", () => {
      const stateWithGraveyard: any = {
        ...testGameState,
        phase: 'precombatMain' as any,
        step: 'main' as any,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                graveyard: [
                  {
                    id: 'sev',
                    name: "Sevinne's Reclamation",
                    type_line: 'Sorcery',
                    canBePlayedBy: 'player1',
                    playableUntilTurn: 10,
                  },
                  { id: 'target-a', name: 'Soul-Guide Lantern', type_line: 'Artifact', mana_cost: '{1}', mana_value: 1 },
                  { id: 'target-b', name: 'Wayfarer Bauble', type_line: 'Artifact', mana_cost: '{1}', mana_value: 1 },
                ],
                manaPool: { white: 5, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
              }
            : p
        ),
        playableFromGraveyard: { player1: { sev: 10 } },
        turn: 1,
      };

      adapter.initializeGame('test-game', stateWithGraveyard);
      const castResult = adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        fromZone: 'graveyard',
        cardId: 'sev',
        cardName: "Sevinne's Reclamation",
        cardTypes: ['sorcery'],
        manaCost: { white: 1 },
        targets: ['target-a'],
        oracleText:
          'Return target permanent card with mana value 3 or less from your graveyard to the battlefield. If this spell was cast from a graveyard, you may copy this spell and may choose a new target for the copy.',
      });
      expect(castResult.next).toBeDefined();

      const resolveResult = adapter.executeAction('test-game', {
        type: 'resolveStack',
      });

      expect(((resolveResult.next.players.find(p => p.id === 'player1') as any)?.graveyard || []).map((c: any) => c.id)).toEqual([
        'sev',
      ]);
      expect(((resolveResult.next.battlefield || []) as any[]).map((perm: any) => perm.card?.id).sort()).toEqual([
        'target-a',
        'target-b',
      ]);
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

    it('should cast a spell from exile without spending mana when the permission waives mana cost', () => {
      const stateWithFreeExileCast: any = {
        ...testGameState,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                exile: [
                  {
                    id: 'free-ex1',
                    name: 'Lightning Bolt',
                    type_line: 'Instant',
                    canBePlayedBy: 'player1',
                    playableUntilTurn: 10,
                    withoutPayingManaCost: true,
                  },
                ],
                manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
              }
            : p
        ),
        playableFromExile: { player1: { 'free-ex1': 10 } },
        turn: 1,
      };

      adapter.initializeGame('test-game', stateWithFreeExileCast);
      const result = adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        fromZone: 'exile',
        cardId: 'free-ex1',
        cardName: 'Lightning Bolt',
        cardTypes: ['instant'],
        manaCost: { red: 1 },
        targets: [],
      });

      const p1 = result.next.players.find(p => p.id === 'player1') as any;
      expect((p1.exile || []).some((c: any) => c.id === 'free-ex1')).toBe(false);
      expect(p1.manaPool).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
    });

    it('should remove a spell from graveyard when it is cast from graveyard', () => {
      const stateWithGraveyard: any = {
        ...testGameState,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                graveyard: [{ id: 'gy1', name: 'Opt', type_line: 'Instant', canBePlayedBy: 'player1', playableUntilTurn: 10 }],
                manaPool: { white: 5, blue: 5, black: 0, red: 0, green: 0, colorless: 0 },
              }
            : p
        ),
        playableFromGraveyard: { player1: { gy1: 10 } },
        turn: 1,
      };

      adapter.initializeGame('test-game', stateWithGraveyard);
      const result = adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        fromZone: 'graveyard',
        cardId: 'gy1',
        cardName: 'Opt',
        cardTypes: ['instant'],
        manaCost: { blue: 1 },
        targets: [],
      });

      const p1 = result.next.players.find(p => p.id === 'player1') as any;
      expect((p1.graveyard || []).some((c: any) => c.id === 'gy1')).toBe(false);
      expect((result.next as any).playableFromGraveyard?.player1?.gy1).toBeUndefined();
    });

    it('should cast a spell from graveyard using its printed mana cost when flashback metadata says mana_cost', () => {
      const stateWithFlashbackManaCost: any = {
        ...testGameState,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                graveyard: [
                  {
                    id: 'gy-flash',
                    name: 'Lightning Bolt',
                    type_line: 'Instant',
                    mana_cost: '{R}',
                    canBePlayedBy: 'player1',
                    playableUntilTurn: 10,
                    graveyardCastCost: 'mana_cost',
                  },
                ],
                manaPool: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 0 },
              }
            : p
        ),
        playableFromGraveyard: { player1: { 'gy-flash': 10 } },
        turn: 1,
      };

      adapter.initializeGame('test-game', stateWithFlashbackManaCost);
      const result = adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        fromZone: 'graveyard',
        cardId: 'gy-flash',
        cardName: 'Lightning Bolt',
        cardTypes: ['instant'],
        targets: [],
      });

      const p1 = result.next.players.find(p => p.id === 'player1') as any;
      expect((p1.graveyard || []).some((c: any) => c.id === 'gy-flash')).toBe(false);
      expect(p1.manaPool).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
    });

    it('should cast a spell from graveyard using an explicit graveyard cast cost string', () => {
      const stateWithFlashbackRawCost: any = {
        ...testGameState,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                graveyard: [
                  {
                    id: 'gy-think-twice',
                    name: 'Think Twice',
                    type_line: 'Instant',
                    mana_cost: '{1}{U}',
                    canBePlayedBy: 'player1',
                    playableUntilTurn: 10,
                    graveyardCastCostRaw: '{2}{U}',
                  },
                ],
                manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 2 },
              }
            : p
        ),
        playableFromGraveyard: { player1: { 'gy-think-twice': 10 } },
        turn: 1,
      };

      adapter.initializeGame('test-game', stateWithFlashbackRawCost);
      const result = adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        fromZone: 'graveyard',
        cardId: 'gy-think-twice',
        cardName: 'Think Twice',
        cardTypes: ['instant'],
        targets: [],
      });

      const p1 = result.next.players.find(p => p.id === 'player1') as any;
      expect((p1.graveyard || []).some((c: any) => c.id === 'gy-think-twice')).toBe(false);
      expect(p1.manaPool).toEqual({ white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 });
    });

    it('should cast a disturb card from graveyard using its disturb cost and resolve it transformed', () => {
      const stateWithDisturb: any = {
        ...testGameState,
        phase: 'precombatMain',
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                graveyard: [
                  {
                    id: 'geist-front',
                    name: 'Benevolent Geist',
                    type_line: 'Creature — Spirit',
                    mana_cost: '{2}{W}',
                    oracle_text: 'Disturb {1}{W}',
                    card_faces: [
                      {
                        name: 'Benevolent Geist',
                        type_line: 'Creature — Spirit',
                        oracle_text: 'Disturb {1}{W}',
                        power: '2',
                        toughness: '2',
                      },
                      {
                        name: 'Malevolent Hermit',
                        type_line: 'Enchantment Creature — Spirit',
                        oracle_text: 'Flying',
                        power: '2',
                        toughness: '1',
                      },
                    ],
                  },
                ],
                manaPool: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
              }
            : p
        ),
        turn: 1,
      };

      adapter.initializeGame('test-game', stateWithDisturb);
      const castResult = adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        fromZone: 'graveyard',
        cardId: 'geist-front',
        cardTypes: ['creature'],
        targets: [],
      });
      const resolveResult = adapter.executeAction('test-game', { type: 'resolveStack' });

      const p1 = resolveResult.next.players.find(p => p.id === 'player1') as any;
      const permanent = (resolveResult.next.battlefield || [])[0] as any;

      expect((p1.graveyard || []).some((card: any) => card.id === 'geist-front')).toBe(false);
      expect(permanent?.card?.name || permanent?.name).toBe('Malevolent Hermit');
      expect(String(permanent?.card?.type_line || permanent?.type_line || '')).toContain('Enchantment Creature');
      expect((castResult.next.players.find(p => p.id === 'player1') as any)?.manaPool).toEqual({
        white: 0,
        blue: 0,
        black: 0,
        red: 0,
        green: 0,
        colorless: 0,
      });
    });

    it('should put a graveyard-cast instant back into graveyard after it resolves when no exile replacement applies', () => {
      const stateWithFlashbackRawCost: any = {
        ...testGameState,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                graveyard: [
                  {
                    id: 'gy-think-twice-resolve',
                    name: 'Think Twice',
                    type_line: 'Instant',
                    oracle_text: 'Draw a card.',
                    mana_cost: '{1}{U}',
                    canBePlayedBy: 'player1',
                    playableUntilTurn: 10,
                    graveyardCastCostRaw: '{2}{U}',
                  },
                ],
                manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 2 },
              }
            : p
        ),
        playableFromGraveyard: { player1: { 'gy-think-twice-resolve': 10 } },
        turn: 1,
      };

      adapter.initializeGame('test-game', stateWithFlashbackRawCost);
      adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        fromZone: 'graveyard',
        cardId: 'gy-think-twice-resolve',
        cardName: 'Think Twice',
        cardTypes: ['instant'],
        targets: [],
      });

      const resolveResult = adapter.executeAction('test-game', {
        type: 'resolveStack',
      });

      const p1 = resolveResult.next.players.find(p => p.id === 'player1') as any;
      expect((p1.graveyard || []).some((c: any) => c.id === 'gy-think-twice-resolve')).toBe(true);
      expect((p1.exile || []).some((c: any) => c.id === 'gy-think-twice-resolve')).toBe(false);
    });

    it('should exile a graveyard-cast instant after it resolves when graveyard metadata says to exile on stack exit', () => {
      const stateWithGearhulkStylePermission: any = {
        ...testGameState,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                graveyard: [
                  {
                    id: 'gy-bolt-exile',
                    name: 'Lightning Bolt',
                    type_line: 'Instant',
                    oracle_text: 'Lightning Bolt deals 3 damage to any target.',
                    mana_cost: '{R}',
                    canBePlayedBy: 'player1',
                    playableUntilTurn: 10,
                    withoutPayingManaCost: true,
                    exileInsteadOfGraveyard: true,
                  },
                ],
                manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
              }
            : p
        ),
        playableFromGraveyard: { player1: { 'gy-bolt-exile': 10 } },
        turn: 1,
      };

      adapter.initializeGame('test-game', stateWithGearhulkStylePermission);
      adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        fromZone: 'graveyard',
        cardId: 'gy-bolt-exile',
        cardName: 'Lightning Bolt',
        cardTypes: ['instant'],
        targets: ['player2'],
      });

      const resolveResult = adapter.executeAction('test-game', {
        type: 'resolveStack',
      });

      const p1 = resolveResult.next.players.find(p => p.id === 'player1') as any;
      expect((p1.graveyard || []).some((c: any) => c.id === 'gy-bolt-exile')).toBe(false);
      expect((p1.exile || []).some((c: any) => c.id === 'gy-bolt-exile')).toBe(true);
    });

    it('should exile a hand-cast rebound instant after it resolves and schedule a your-next-upkeep delayed trigger', () => {
      const stateWithReboundInHand: any = {
        ...testGameState,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                hand: [
                  {
                    id: 'staggershock-hand',
                    name: 'Staggershock',
                    type_line: 'Instant',
                    oracle_text: 'Staggershock deals 2 damage to any target.\nRebound',
                    mana_cost: '{2}{R}',
                  },
                ],
                manaPool: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 2 },
              }
            : p
        ),
        turn: 1,
      };

      adapter.initializeGame('test-game', stateWithReboundInHand);
      adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        fromZone: 'hand',
        cardId: 'staggershock-hand',
        cardName: 'Staggershock',
        cardTypes: ['instant'],
        targets: ['player2'],
      });

      const resolveResult = adapter.executeAction('test-game', { type: 'resolveStack' });
      const p1 = resolveResult.next.players.find(p => p.id === 'player1') as any;
      const delayedRegistry = (resolveResult.next as any).delayedTriggerRegistry;

      expect((p1.hand || []).some((c: any) => c.id === 'staggershock-hand')).toBe(false);
      expect((p1.graveyard || []).some((c: any) => c.id === 'staggershock-hand')).toBe(false);
      expect((p1.exile || []).some((c: any) => c.id === 'staggershock-hand')).toBe(true);
      expect(delayedRegistry?.triggers || []).toHaveLength(1);
      expect(delayedRegistry.triggers[0]).toMatchObject({
        sourceId: 'staggershock-hand',
        sourceName: 'Staggershock',
        controllerId: 'player1',
        timing: 'your_next_upkeep',
        effect: 'You may cast this card from exile without paying its mana cost.',
      });
    });

    it('should not schedule rebound when the spell with Rebound was not cast from hand', () => {
      const stateWithReboundInGraveyard: any = {
        ...testGameState,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                graveyard: [
                  {
                    id: 'staggershock-graveyard',
                    name: 'Staggershock',
                    type_line: 'Instant',
                    oracle_text: 'Staggershock deals 2 damage to any target.\nRebound',
                    mana_cost: '{2}{R}',
                    canBePlayedBy: 'player1',
                    playableUntilTurn: 10,
                    withoutPayingManaCost: true,
                  },
                ],
                manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
              }
            : p
        ),
        playableFromGraveyard: { player1: { 'staggershock-graveyard': 10 } },
        turn: 1,
      };

      adapter.initializeGame('test-game', stateWithReboundInGraveyard);
      adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        fromZone: 'graveyard',
        cardId: 'staggershock-graveyard',
        cardName: 'Staggershock',
        cardTypes: ['instant'],
        targets: ['player2'],
      });

      const resolveResult = adapter.executeAction('test-game', { type: 'resolveStack' });
      const p1 = resolveResult.next.players.find(p => p.id === 'player1') as any;
      const delayedRegistry = (resolveResult.next as any).delayedTriggerRegistry;

      expect((p1.graveyard || []).some((c: any) => c.id === 'staggershock-graveyard')).toBe(true);
      expect((p1.exile || []).some((c: any) => c.id === 'staggershock-graveyard')).toBe(false);
      expect(delayedRegistry?.triggers || []).toHaveLength(0);
    });

    it('should cast a spell from graveyard by paying a discard additional cost', () => {
      const stateWithDiscardFlashback: any = {
        ...testGameState,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                hand: [{ id: 'discard-me', name: 'Spare Land', type_line: 'Basic Land - Mountain' }],
                graveyard: [
                  {
                    id: 'gy-retrace',
                    name: 'Retrace Test',
                    type_line: 'Instant',
                    graveyardCastCostRaw: '{1}{R}',
                    graveyardAdditionalCost: { kind: 'discard', count: 1, raw: 'discard a card' },
                    canBePlayedBy: 'player1',
                    playableUntilTurn: 10,
                  },
                ],
                manaPool: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 1 },
              }
            : p
        ),
        playableFromGraveyard: { player1: { 'gy-retrace': 10 } },
        turn: 1,
      };

      adapter.initializeGame('test-game', stateWithDiscardFlashback);
      const result = adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        fromZone: 'graveyard',
        cardId: 'gy-retrace',
        cardName: 'Retrace Test',
        cardTypes: ['instant'],
        targets: [],
      });

      const p1 = result.next.players.find(p => p.id === 'player1') as any;
      expect((p1.hand || []).some((c: any) => c.id === 'discard-me')).toBe(false);
      expect((p1.graveyard || []).some((c: any) => c.id === 'discard-me')).toBe(true);
      expect((p1.graveyard || []).some((c: any) => c.id === 'gy-retrace')).toBe(false);
    });

    it('should cast a spell from graveyard by discarding a land when the additional cost is land-filtered', () => {
      const stateWithFilteredDiscard: any = {
        ...testGameState,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                hand: [
                  { id: 'keep-spell', name: 'Opt', type_line: 'Instant' },
                  { id: 'discard-land', name: 'Forest', type_line: 'Basic Land - Forest' },
                ],
                graveyard: [
                  {
                    id: 'gy-six',
                    name: 'Six Test',
                    type_line: 'Instant',
                    graveyardCastCostRaw: '{1}{G}',
                    graveyardAdditionalCost: { kind: 'discard', count: 1, filterText: 'land', raw: 'discarding a land card' },
                    canBePlayedBy: 'player1',
                    playableUntilTurn: 10,
                  },
                ],
                manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 1 },
              }
            : p
        ),
        playableFromGraveyard: { player1: { 'gy-six': 10 } },
        turn: 1,
      };

      adapter.initializeGame('test-game', stateWithFilteredDiscard);
      const result = adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        fromZone: 'graveyard',
        cardId: 'gy-six',
        cardName: 'Six Test',
        cardTypes: ['instant'],
        targets: [],
      });

      const p1 = result.next.players.find(p => p.id === 'player1') as any;
      expect((p1.hand || []).some((c: any) => c.id === 'keep-spell')).toBe(true);
      expect((p1.hand || []).some((c: any) => c.id === 'discard-land')).toBe(false);
      expect((p1.graveyard || []).some((c: any) => c.id === 'discard-land')).toBe(true);
    });

    it('should cast a spell from graveyard by paying a sacrifice additional cost', () => {
      const stateWithSacrificeFlashback: any = {
        ...testGameState,
        battlefield: [
          {
            id: 'land-sac',
            controller: 'player1',
            owner: 'player1',
            card: { id: 'land-sac-card', name: 'Mountain', type_line: 'Basic Land - Mountain' },
            tapped: false,
            summoningSickness: false,
            attachments: [],
            counters: {},
          },
        ],
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                graveyard: [
                  {
                    id: 'gy-brood',
                    name: 'Exploration Broodship',
                    type_line: 'Instant',
                    graveyardCastCostRaw: '{G}',
                    graveyardAdditionalCost: { kind: 'sacrifice', count: 1, filterText: 'land', raw: 'sacrificing a land' },
                    canBePlayedBy: 'player1',
                    playableUntilTurn: 10,
                  },
                ],
                manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 1, colorless: 0 },
              }
            : p
        ),
        playableFromGraveyard: { player1: { 'gy-brood': 10 } },
        turn: 1,
      };

      adapter.initializeGame('test-game', stateWithSacrificeFlashback);
      const result = adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        fromZone: 'graveyard',
        cardId: 'gy-brood',
        cardName: 'Exploration Broodship',
        cardTypes: ['instant'],
        targets: [],
      });

      const p1 = result.next.players.find(p => p.id === 'player1') as any;
      expect(((result.next as any).battlefield || []).some((perm: any) => perm.id === 'land-sac')).toBe(false);
      expect((p1.graveyard || []).some((c: any) => c.id === 'land-sac-card')).toBe(true);
      expect((p1.graveyard || []).some((c: any) => c.id === 'gy-brood')).toBe(false);
    });

    it('should cast a spell from graveyard by removing counters from creatures you control', () => {
      const stateWithCounterRemovalCost: any = {
        ...testGameState,
        phase: 'precombatMain' as any,
        step: 'main' as any,
        battlefield: [
          {
            id: 'counter-creature-a',
            controller: 'player1',
            owner: 'player1',
            card: { id: 'counter-creature-a-card', name: 'Counter Bear A', type_line: 'Creature - Bear', power: '3', toughness: '3' },
            power: '3',
            toughness: '3',
            tapped: false,
            summoningSickness: false,
            attachments: [],
            counters: { '+1/+1': 3 },
          },
          {
            id: 'counter-creature-b',
            controller: 'player1',
            owner: 'player1',
            card: { id: 'counter-creature-b-card', name: 'Counter Bear B', type_line: 'Creature - Bear', power: '3', toughness: '3' },
            power: '3',
            toughness: '3',
            tapped: false,
            summoningSickness: false,
            attachments: [],
            counters: { '+1/+1': 3 },
          },
        ],
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                graveyard: [
                  {
                    id: 'gy-quilled',
                    name: 'Quilled Greatwurm',
                    type_line: 'Creature - Wurm',
                    graveyardCastCostRaw: '{4}{G}{G}',
                    graveyardAdditionalCost: {
                      kind: 'remove_counter',
                      count: 6,
                      filterText: 'creatures you control',
                      raw: 'removing six counters from among creatures you control',
                    },
                    canBePlayedBy: 'player1',
                    playableUntilTurn: 10,
                  },
                ],
                manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 2, colorless: 4 },
              }
            : p
        ),
        playableFromGraveyard: { player1: { 'gy-quilled': 10 } },
        turn: 1,
      };

      adapter.initializeGame('test-game', stateWithCounterRemovalCost);
      const result = adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        fromZone: 'graveyard',
        cardId: 'gy-quilled',
        cardName: 'Quilled Greatwurm',
        cardTypes: ['creature'],
        targets: [],
      });

      const battlefield = (result.next.battlefield || []) as any[];
      expect(battlefield.find((perm: any) => perm.id === 'counter-creature-a')?.counters || {}).toEqual({});
      expect(battlefield.find((perm: any) => perm.id === 'counter-creature-b')?.counters || {}).toEqual({});
      expect(((result.next.players.find(p => p.id === 'player1') as any)?.graveyard || []).some((c: any) => c.id === 'gy-quilled')).toBe(false);
    });

    it('should cast a spell from graveyard by exiling other graveyard cards as an additional cost', () => {
      const stateWithEscapeCost: any = {
        ...testGameState,
        phase: 'precombatMain' as any,
        step: 'main' as any,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                graveyard: [
                  {
                    id: 'gy-escape',
                    name: 'Ox of Agonas',
                    type_line: 'Creature - Ox',
                    graveyardCastCostRaw: '{R}{R}',
                    graveyardAdditionalCost: {
                      kind: 'exile_from_graveyard',
                      count: 3,
                      raw: 'exile three other cards from your graveyard',
                    },
                    canBePlayedBy: 'player1',
                    playableUntilTurn: 10,
                  },
                  { id: 'fuel-1', name: 'Opt', type_line: 'Instant' },
                  { id: 'fuel-2', name: 'Shock', type_line: 'Instant' },
                  { id: 'fuel-3', name: 'Ponder', type_line: 'Sorcery' },
                ],
                exile: [],
                manaPool: { white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 0 },
              }
            : p
        ),
        playableFromGraveyard: { player1: { 'gy-escape': 10 } },
        turn: 1,
      };

      adapter.initializeGame('test-game', stateWithEscapeCost);
      const result = adapter.executeAction('test-game', {
        type: 'castSpell',
        playerId: 'player1',
        fromZone: 'graveyard',
        cardId: 'gy-escape',
        cardName: 'Ox of Agonas',
        cardTypes: ['creature'],
        targets: [],
      });

      const p1 = result.next.players.find(p => p.id === 'player1') as any;
      expect((p1.graveyard || []).map((c: any) => c.id)).toEqual([]);
      expect((p1.exile || []).map((c: any) => c.id).sort()).toEqual(['fuel-1', 'fuel-2', 'fuel-3']);
    });

    it('should play a land from graveyard when permitted', () => {
      const stateWithGraveyardLand: any = {
        ...testGameState,
        phase: 'precombatMain' as any,
        step: 'main' as any,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                graveyard: [{ id: 'gy-land', name: 'Mountain', type_line: 'Basic Land - Mountain', canBePlayedBy: 'player1', playableUntilTurn: 10 }],
              }
            : p
        ),
        playableFromGraveyard: { player1: { 'gy-land': 10 } },
        turn: 1,
        landsPlayedThisTurn: { player1: 0 },
        battlefield: [],
      };

      adapter.initializeGame('test-game', stateWithGraveyardLand);
      const result = adapter.executeAction('test-game', {
        type: 'playLand',
        playerId: 'player1',
        fromZone: 'graveyard',
        cardId: 'gy-land',
      });

      const p1 = result.next.players.find(p => p.id === 'player1') as any;
      expect((p1.graveyard || []).some((c: any) => c.id === 'gy-land')).toBe(false);
      expect(((result.next as any).battlefield || []).some((perm: any) => perm.id === 'gy-land')).toBe(true);
      expect((result.next as any).landsPlayedThisTurn?.player1).toBe(1);
      expect((result.next as any).playableFromGraveyard?.player1?.['gy-land']).toBeUndefined();
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

    it('should resolve optional tap-or-untap trigger from singleton permanent stack target', () => {
      const start = makeMerfolkIterationState({
        id: 'test-game',
        battlefield: makeMerfolkIterationState().battlefield.map((perm: any) =>
          perm.id === 'nykthos-shrine-to-nyx' ? { ...perm, tapped: true } : perm
        ),
      } as any);

      adapter.initializeGame('test-game', start as any);

      const adapterAny = adapter as any;
      const stacks = adapterAny.stacks as Map<string, any>;
      stacks.set('test-game', {
        objects: [
          {
            id: 'stack-trigger-reejerey',
            spellId: 'merrow-reejerey',
            cardName: 'Merrow Reejerey',
            controllerId: 'p1',
            targets: ['nykthos-shrine-to-nyx'],
            timestamp: Date.now(),
            type: 'ability',
            triggerMeta: {
              effectText: 'You may tap or untap target permanent.',
              triggerEventDataSnapshot: {
                sourceId: 'merrow-reejerey',
                sourceControllerId: 'p1',
              },
            },
          },
        ],
      });

      const result = adapter.executeAction('test-game', {
        type: 'resolveStack',
      });

      const nykthos = result.next.battlefield.find((perm: any) => perm.id === 'nykthos-shrine-to-nyx') as any;
      expect(nykthos?.tapped).toBe(false);
    });

    it('should emit CHOICE_REQUIRED for unresolved Merrow Reejerey trigger choices during stack resolution', () => {
      const start = makeMerfolkIterationState({
        id: 'test-game',
      } as any);

      adapter.initializeGame('test-game', start as any);

      const observedEvents: any[] = [];
      adapter.on(RulesEngineEvent.CHOICE_REQUIRED, (event) => {
        observedEvents.push(event);
      });

      const adapterAny = adapter as any;
      const stacks = adapterAny.stacks as Map<string, any>;
      stacks.set('test-game', {
        objects: [
          {
            id: 'stack-trigger-reejerey-choice',
            spellId: 'merrow-reejerey',
            cardName: 'Merrow Reejerey',
            controllerId: 'p1',
            targets: [],
            timestamp: Date.now(),
            type: 'ability',
            triggerMeta: {
              effectText: 'You may tap or untap target permanent.',
              triggerEventDataSnapshot: {
                sourceId: 'merrow-reejerey',
                sourceControllerId: 'p1',
              },
            },
          },
        ],
      });

      const result = adapter.executeAction('test-game', {
        type: 'resolveStack',
      });

      const nykthos = result.next.battlefield.find((perm: any) => perm.id === 'nykthos-shrine-to-nyx') as any;
      expect(nykthos?.tapped).toBe(false);
      expect(observedEvents).toHaveLength(1);
      expect(observedEvents[0].type).toBe(RulesEngineEvent.CHOICE_REQUIRED);
      expect(observedEvents[0].data.sourceName).toBe('Merrow Reejerey');
      expect(observedEvents[0].data.choiceEvents.map((choice: any) => choice.type)).toEqual([
        'may_ability',
        'target_selection',
        'option_choice',
      ]);
    });

    it('should emit CHOICE_REQUIRED for unresolved target-opponent trigger choices during stack resolution', () => {
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

      const observedEvents: any[] = [];
      adapter.on(RulesEngineEvent.CHOICE_REQUIRED, (event) => {
        observedEvents.push(event);
      });

      const adapterAny = adapter as any;
      const stacks = adapterAny.stacks as Map<string, any>;
      stacks.set('test-game', {
        objects: [
          {
            id: 'stack-trigger-target-opponent-choice',
            spellId: 'grim-harbinger',
            cardName: 'Grim Harbinger',
            controllerId: 'player1',
            targets: [],
            timestamp: Date.now(),
            type: 'ability',
            triggerMeta: {
              effectText: 'Target opponent loses 1 life.',
              triggerEventDataSnapshot: {
                sourceId: 'grim-harbinger',
                sourceControllerId: 'player1',
              },
            },
          },
        ],
      });

      const result = adapter.executeAction('test-game', {
        type: 'resolveStack',
      });

      const player2 = result.next.players.find(p => p.id === 'player2');
      const player3 = result.next.players.find(p => p.id === 'player3');
      expect(player2?.life).toBe(40);
      expect(player3?.life).toBe(40);
      expect(observedEvents).toHaveLength(1);
      expect(observedEvents[0].data.choiceEvents.map((choice: any) => choice.type)).toEqual([
        'target_selection',
      ]);
      expect(observedEvents[0].data.choiceEvents[0].targetTypes).toEqual(['opponent']);
    });

    it('should emit CHOICE_REQUIRED for unresolved target-player trigger choices during stack resolution', () => {
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

      const observedEvents: any[] = [];
      adapter.on(RulesEngineEvent.CHOICE_REQUIRED, (event) => {
        observedEvents.push(event);
      });

      const adapterAny = adapter as any;
      const stacks = adapterAny.stacks as Map<string, any>;
      stacks.set('test-game', {
        objects: [
          {
            id: 'stack-trigger-target-player-choice',
            spellId: 'benevolent-seer',
            cardName: 'Benevolent Seer',
            controllerId: 'player1',
            targets: [],
            timestamp: Date.now(),
            type: 'ability',
            triggerMeta: {
              effectText: 'Target player gains 2 life.',
              triggerEventDataSnapshot: {
                sourceId: 'benevolent-seer',
                sourceControllerId: 'player1',
              },
            },
          },
        ],
      });

      const result = adapter.executeAction('test-game', {
        type: 'resolveStack',
      });

      const player1 = result.next.players.find(p => p.id === 'player1');
      const player2 = result.next.players.find(p => p.id === 'player2');
      const player3 = result.next.players.find(p => p.id === 'player3');
      expect(player1?.life).toBe(40);
      expect(player2?.life).toBe(40);
      expect(player3?.life).toBe(40);
      expect(observedEvents).toHaveLength(1);
      expect(observedEvents[0].data.choiceEvents.map((choice: any) => choice.type)).toEqual([
        'target_selection',
      ]);
      expect(observedEvents[0].data.choiceEvents[0].targetTypes).toEqual(['player']);
    });

    it('should emit CHOICE_REQUIRED for unresolved choose_mode trigger choices during stack resolution', () => {
      adapter.initializeGame('test-game', testGameState);

      const observedEvents: any[] = [];
      adapter.on(RulesEngineEvent.CHOICE_REQUIRED, (event) => {
        observedEvents.push(event);
      });

      const adapterAny = adapter as any;
      const stacks = adapterAny.stacks as Map<string, any>;
      stacks.set('test-game', {
        objects: [
          {
            id: 'stack-trigger-choose-mode-choice',
            spellId: 'black-market-connections',
            cardName: 'Black Market Connections',
            controllerId: 'player1',
            targets: [],
            timestamp: Date.now(),
            type: 'ability',
            triggerMeta: {
              effectText: 'Choose up to three -\n\u2022 Sell Contraband - You lose 1 life. Create a Treasure token.\n\u2022 Buy Information - You lose 2 life. Draw a card.\n\u2022 Hire a Mercenary - You lose 3 life. Create a 3/2 colorless Shapeshifter creature token with changeling.',
              triggerEventDataSnapshot: {
                sourceId: 'black-market-connections',
                sourceControllerId: 'player1',
              },
            },
          },
        ],
      });

      const result = adapter.executeAction('test-game', {
        type: 'resolveStack',
      });

      const player1 = result.next.players.find(p => p.id === 'player1');
      expect(player1?.life).toBe(40);
      expect(observedEvents).toHaveLength(1);
      expect(observedEvents[0].data.choiceEvents.map((choice: any) => choice.type)).toEqual([
        'mode_selection',
      ]);
      expect(observedEvents[0].data.choiceEvents[0].modes.map((mode: any) => mode.id)).toEqual([
        'Sell Contraband',
        'Buy Information',
        'Hire a Mercenary',
      ]);
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

    it('should skip triggered oracle effect when intervening-if is flagged but clause is missing', () => {
      const adapterAny = adapter as any;
      const stacks = adapterAny.stacks as Map<string, any>;
      stacks.set('test-game', {
        objects: [
          {
            id: 'stack-trigger-3',
            spellId: 'trigger-source-3',
            cardName: 'Intervening Trigger Missing Clause',
            controllerId: 'player1',
            targets: [],
            timestamp: Date.now(),
            type: 'ability',
            triggerMeta: {
              effectText: 'Target opponent loses 1 life.',
              hasInterveningIf: true,
              triggerEventDataSnapshot: {
                sourceId: 'trigger-source-3',
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
      expect(player2?.life).toBe(40);
      expect(result.log?.some(msg => msg.includes('intervening-if missing clause'))).toBe(true);
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

    it('should tap the source permanent when an activated ability has a tap additional cost', () => {
      const stateWithPermanent: any = {
        ...testGameState,
        battlefield: [
          {
            id: 'tap-source',
            controller: 'player1',
            owner: 'player1',
            name: 'Tapper',
            card: { id: 'tap-source-card', name: 'Tapper', type_line: 'Artifact' },
            tapped: false,
            summoningSickness: false,
            attachments: [],
            counters: {},
          },
        ],
      };

      adapter.initializeGame('test-game', stateWithPermanent);
      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        ability: {
          id: 'tap-ability',
          sourceId: 'tap-source',
          sourceName: 'Tapper',
          controllerId: 'player1',
          additionalCosts: [
            {
              type: 'tap',
              description: 'Tap this permanent',
              isOptional: false,
              isMandatory: true,
            },
          ],
          effect: 'Target opponent loses 1 life.',
          targets: ['player2'],
        },
      });

      const source = (activateResult.next.battlefield || []).find((perm: any) => perm.id === 'tap-source') as any;
      expect(source?.tapped).toBe(true);
    });

    it('should tap the source itself when it satisfies a filtered tap additional cost', () => {
      const stateWithMerfolkSource: any = {
        ...testGameState,
        battlefield: [
          {
            id: 'drowner-source',
            controller: 'player1',
            owner: 'player1',
            name: 'Drowner of Secrets',
            card: { id: 'drowner-source-card', name: 'Drowner of Secrets', type_line: 'Creature - Merfolk Wizard' },
            tapped: false,
            summoningSickness: false,
            attachments: [],
            counters: {},
          },
        ],
      };

      adapter.initializeGame('test-game', stateWithMerfolkSource);
      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        ability: {
          id: 'drowner-ability',
          sourceId: 'drowner-source',
          sourceName: 'Drowner of Secrets',
          controllerId: 'player1',
          additionalCosts: [
            {
              type: 'tap',
              description: 'Tap an untapped Merfolk you control',
              isOptional: false,
              isMandatory: true,
            },
          ],
          effect: 'Target player mills a card.',
          targets: ['player2'],
        },
      });

      const source = (activateResult.next.battlefield || []).find((perm: any) => perm.id === 'drowner-source') as any;
      expect(source?.tapped).toBe(true);
    });

    it('should tap a selected noncreature kindred permanent for a filtered tap additional cost', () => {
      const stateWithKindredPermanent: any = {
        ...testGameState,
        battlefield: [
          {
            id: 'drowner-source',
            controller: 'player1',
            owner: 'player1',
            name: 'Drowner of Secrets',
            card: { id: 'drowner-source-card', name: 'Drowner of Secrets', type_line: 'Creature - Merfolk Wizard' },
            tapped: false,
            summoningSickness: false,
            attachments: [],
            counters: {},
          },
          {
            id: 'merrow-commerce',
            controller: 'player1',
            owner: 'player1',
            name: 'Merrow Commerce',
            card: { id: 'merrow-commerce-card', name: 'Merrow Commerce', type_line: 'Kindred Enchantment - Merfolk' },
            tapped: false,
            summoningSickness: false,
            attachments: [],
            counters: {},
          },
        ],
      };

      adapter.initializeGame('test-game', stateWithKindredPermanent);
      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        additionalCostPermanentIds: ['merrow-commerce'],
        ability: {
          id: 'drowner-ability-kindred',
          sourceId: 'drowner-source',
          sourceName: 'Drowner of Secrets',
          controllerId: 'player1',
          additionalCosts: [
            {
              type: 'tap',
              description: 'Tap an untapped Merfolk you control',
              isOptional: false,
              isMandatory: true,
            },
          ],
          effect: 'Target player mills a card.',
          targets: ['player2'],
        },
      });

      const source = (activateResult.next.battlefield || []).find((perm: any) => perm.id === 'drowner-source') as any;
      const merrowCommerce = (activateResult.next.battlefield || []).find((perm: any) => perm.id === 'merrow-commerce') as any;
      expect(source?.tapped).toBe(false);
      expect(merrowCommerce?.tapped).toBe(true);
    });

    it('should tap multiple selected permanents for a counted tap additional cost', () => {
      const stateWithMerfolkTeam: any = {
        ...testGameState,
        battlefield: [
          {
            id: 'team-source',
            controller: 'player1',
            owner: 'player1',
            name: 'Merfolk Tactician',
            card: { id: 'team-source-card', name: 'Merfolk Tactician', type_line: 'Creature - Merfolk Wizard' },
            tapped: false,
            summoningSickness: false,
            attachments: [],
            counters: {},
          },
          {
            id: 'merfolk-a',
            controller: 'player1',
            owner: 'player1',
            name: 'Merfolk A',
            card: { id: 'merfolk-a-card', name: 'Merfolk A', type_line: 'Creature - Merfolk' },
            tapped: false,
            summoningSickness: false,
            attachments: [],
            counters: {},
          },
          {
            id: 'merfolk-b',
            controller: 'player1',
            owner: 'player1',
            name: 'Merfolk B',
            card: { id: 'merfolk-b-card', name: 'Merfolk B', type_line: 'Kindred Artifact - Merfolk' },
            tapped: false,
            summoningSickness: false,
            attachments: [],
            counters: {},
          },
        ],
      };

      adapter.initializeGame('test-game', stateWithMerfolkTeam);
      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        additionalCostPermanentIds: ['merfolk-a', 'merfolk-b'],
        ability: {
          id: 'mentor-ability',
          sourceId: 'team-source',
          sourceName: 'Merfolk Tactician',
          controllerId: 'player1',
          additionalCosts: [
            {
              type: 'tap',
              description: 'Tap two untapped Merfolk you control',
              isOptional: false,
              isMandatory: true,
            },
          ],
          effect: 'Target player mills a card.',
          targets: ['player2'],
        },
      });

      const merfolkA = (activateResult.next.battlefield || []).find((perm: any) => perm.id === 'merfolk-a') as any;
      const merfolkB = (activateResult.next.battlefield || []).find((perm: any) => perm.id === 'merfolk-b') as any;
      const source = (activateResult.next.battlefield || []).find((perm: any) => perm.id === 'team-source') as any;
      expect(merfolkA?.tapped).toBe(true);
      expect(merfolkB?.tapped).toBe(true);
      expect(source?.tapped).toBe(false);
    });

    it('should return Summon the School from graveyard after tapping four Merfolk permanents', () => {
      const stateWithSummonInGraveyard: any = {
        ...testGameState,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                graveyard: [
                  {
                    id: 'summon-card',
                    name: 'Summon the School',
                    oracle_text: 'Create two 1/1 blue Merfolk Wizard creature tokens. Tap four untapped Merfolk you control: Return Summon the School from your graveyard to your hand.',
                    type_line: 'Tribal Sorcery - Merfolk',
                  },
                ],
                hand: [],
              }
            : p
        ),
        battlefield: [
          {
            id: 'merfolk-a',
            controller: 'player1',
            owner: 'player1',
            name: 'Merfolk A',
            card: { id: 'merfolk-a-card', name: 'Merfolk A', type_line: 'Creature - Merfolk' },
            tapped: false,
            summoningSickness: false,
            attachments: [],
            counters: {},
          },
          {
            id: 'merfolk-b',
            controller: 'player1',
            owner: 'player1',
            name: 'Merfolk B',
            card: { id: 'merfolk-b-card', name: 'Merfolk B', type_line: 'Creature - Merfolk' },
            tapped: false,
            summoningSickness: false,
            attachments: [],
            counters: {},
          },
          {
            id: 'merfolk-c',
            controller: 'player1',
            owner: 'player1',
            name: 'Merfolk C',
            card: { id: 'merfolk-c-card', name: 'Merfolk C', type_line: 'Creature - Merfolk' },
            tapped: false,
            summoningSickness: false,
            attachments: [],
            counters: {},
          },
          {
            id: 'merrow-commerce',
            controller: 'player1',
            owner: 'player1',
            name: 'Merrow Commerce',
            card: { id: 'merrow-commerce-card', name: 'Merrow Commerce', type_line: 'Kindred Enchantment - Merfolk' },
            tapped: false,
            summoningSickness: false,
            attachments: [],
            counters: {},
          },
        ],
      };

      adapter.initializeGame('test-game', stateWithSummonInGraveyard);
      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        additionalCostPermanentIds: ['merfolk-a', 'merfolk-b', 'merfolk-c', 'merrow-commerce'],
        ability: {
          id: 'summon-school-return',
          sourceId: 'summon-card',
          sourceName: 'Summon the School',
          sourceZone: 'graveyard',
          controllerId: 'player1',
          additionalCosts: [
            {
              type: 'tap',
              description: 'Tap four untapped Merfolk you control',
              isOptional: false,
              isMandatory: true,
            },
          ],
          effect: 'Return this permanent from your graveyard to your hand.',
        },
      });

      const resolveResult = adapter.executeAction('test-game', { type: 'resolveStack' });
      const player1 = resolveResult.next.players.find(p => p.id === 'player1') as any;

      expect((player1.hand || []).some((card: any) => card.id === 'summon-card')).toBe(true);
      expect((player1.graveyard || []).some((card: any) => card.id === 'summon-card')).toBe(false);
      expect((resolveResult.next.battlefield || []).find((perm: any) => perm.id === 'merfolk-a')?.tapped).toBe(true);
      expect((resolveResult.next.battlefield || []).find((perm: any) => perm.id === 'merfolk-b')?.tapped).toBe(true);
      expect((resolveResult.next.battlefield || []).find((perm: any) => perm.id === 'merfolk-c')?.tapped).toBe(true);
      expect((resolveResult.next.battlefield || []).find((perm: any) => perm.id === 'merrow-commerce')?.tapped).toBe(true);
      expect(activateResult.log.some(line => line.includes('tapped 4 permanent(s)'))).toBe(true);
    });

    it('should activate a Channel ability from hand by discarding its source card', () => {
      const stateWithChannelCard: any = {
        ...testGameState,
        phase: 'precombatMain' as any,
        step: 'main' as any,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                hand: [
                  {
                    id: 'channel-card',
                    name: 'Twinshot Sniper',
                    oracle_text: 'Channel — {1}{R}, Discard this card: It deals 2 damage to any target.',
                    type_line: 'Artifact Creature - Goblin Archer',
                  },
                ],
                graveyard: [],
                manaPool: { white: 0, blue: 0, black: 0, red: 1, green: 0, colorless: 1 },
              }
            : p
        ),
      };

      adapter.initializeGame('test-game', stateWithChannelCard);
      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        ability: {
          id: 'channel-ability',
          sourceId: 'channel-card',
          sourceName: 'Twinshot Sniper',
          sourceZone: 'hand',
          controllerId: 'player1',
          manaCost: { generic: 1, red: 1 },
          additionalCosts: [
            {
              type: 'discard',
              description: 'Discard this card',
              isOptional: false,
              isMandatory: true,
            },
          ],
          effect: 'It deals 2 damage to any target.',
          targets: ['player2'],
        },
      });

      const player1 = activateResult.next.players.find(p => p.id === 'player1') as any;
      expect((player1.hand || []).some((card: any) => card.id === 'channel-card')).toBe(false);
      expect((player1.graveyard || []).some((card: any) => card.id === 'channel-card')).toBe(true);
      expect(player1.manaPool.red).toBe(0);
      expect(player1.manaPool.colorless).toBe(0);
    });

    it('should activate a Forecast ability from hand during upkeep without moving the revealed card', () => {
      const stateWithForecastCard: any = {
        ...testGameState,
        phase: 'beginning' as any,
        step: 'upkeep' as any,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                hand: [
                  {
                    id: 'forecast-card',
                    name: 'Pride of the Clouds',
                    oracle_text: 'Forecast — {2}{W}, Reveal this card from your hand: Create a 1/1 white and blue Bird creature token with flying. Activate only during your upkeep and only once each turn.',
                    type_line: 'Creature - Human Wizard',
                  },
                ],
                manaPool: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
              }
            : p
        ),
      };

      adapter.initializeGame('test-game', stateWithForecastCard);
      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        activationsThisTurn: 0,
        ability: {
          id: 'forecast-ability',
          sourceId: 'forecast-card',
          sourceName: 'Pride of the Clouds',
          sourceZone: 'hand',
          controllerId: 'player1',
          manaCost: { generic: 2, white: 1 },
          additionalCosts: [
            {
              type: 'reveal',
              description: 'Reveal this card from your hand',
              isOptional: false,
              isMandatory: true,
            },
          ],
          restrictions: [
            {
              type: 'timing',
              description: 'Activate only during your upkeep',
              requiresOwnTurn: true,
              requiresUpkeep: true,
            },
            {
              type: 'frequency',
              description: 'Activate only once each turn',
              maxPerTurn: 1,
            },
          ],
          effect: 'Create a 1/1 white and blue Bird creature token with flying.',
        },
      });

      const player1 = activateResult.next.players.find(p => p.id === 'player1') as any;
      expect((player1.hand || []).some((card: any) => card.id === 'forecast-card')).toBe(true);
      expect(player1.manaPool.white).toBe(0);
      expect(player1.manaPool.colorless).toBe(0);
      expect(activateResult.log.some(line => line.includes('revealed 1 card(s)'))).toBe(true);
    });

    it('should reject a Forecast ability from hand outside upkeep', () => {
      const stateWithForecastCard: any = {
        ...testGameState,
        phase: 'precombatMain' as any,
        step: 'main' as any,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                hand: [
                  {
                    id: 'forecast-card',
                    name: 'Pride of the Clouds',
                    oracle_text: 'Forecast — {2}{W}, Reveal this card from your hand: Create a 1/1 white and blue Bird creature token with flying. Activate only during your upkeep and only once each turn.',
                    type_line: 'Creature - Human Wizard',
                  },
                ],
                manaPool: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
              }
            : p
        ),
      };

      adapter.initializeGame('test-game', stateWithForecastCard);
      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        activationsThisTurn: 0,
        ability: {
          id: 'forecast-ability',
          sourceId: 'forecast-card',
          sourceName: 'Pride of the Clouds',
          sourceZone: 'hand',
          controllerId: 'player1',
          manaCost: { generic: 2, white: 1 },
          additionalCosts: [
            {
              type: 'reveal',
              description: 'Reveal this card from your hand',
              isOptional: false,
              isMandatory: true,
            },
          ],
          restrictions: [
            {
              type: 'timing',
              description: 'Activate only during your upkeep',
              requiresOwnTurn: true,
              requiresUpkeep: true,
            },
          ],
          effect: 'Create a 1/1 white and blue Bird creature token with flying.',
        },
      });

      const player1 = activateResult.next.players.find(p => p.id === 'player1') as any;
      expect(activateResult.log).toContain('Can only activate during your upkeep');
      expect((player1.hand || []).some((card: any) => card.id === 'forecast-card')).toBe(true);
      expect(player1.manaPool.white).toBe(1);
      expect(player1.manaPool.colorless).toBe(2);
    });

    it('should resolve a Transmute ability from hand by discarding the source and tutoring a same-mana-value card', () => {
      const stateWithTransmuteCard: any = {
        ...testGameState,
        phase: 'precombatMain' as any,
        step: 'main' as any,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                hand: [
                  {
                    id: 'transmute-card',
                    name: 'Muddle the Mixture',
                    oracle_text: 'Transmute {1}{U}{U}',
                    mana_cost: '{U}{U}',
                    cmc: 2,
                    type_line: 'Instant',
                  },
                ],
                graveyard: [],
                library: [
                  { id: 'mv-match', name: 'Arcane Signet', mana_cost: '{2}', cmc: 2, type_line: 'Artifact' },
                  { id: 'miss', name: 'Cancel', mana_cost: '{1}{U}{U}', cmc: 3, type_line: 'Instant' },
                ],
                manaPool: { white: 0, blue: 2, black: 0, red: 0, green: 0, colorless: 1 },
              }
            : p
        ),
      };

      adapter.initializeGame('test-game', stateWithTransmuteCard);
      adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        ability: {
          id: 'transmute-ability',
          sourceId: 'transmute-card',
          sourceName: 'Muddle the Mixture',
          sourceZone: 'hand',
          controllerId: 'player1',
          manaCost: { generic: 1, blue: 2 },
          additionalCosts: [
            {
              type: 'discard',
              description: 'Discard this card',
              isOptional: false,
              isMandatory: true,
            },
          ],
          restrictions: [
            {
              type: 'timing',
              description: 'Activate only as a sorcery',
              requiresSorceryTiming: true,
            },
          ],
          effect: 'Search your library for a card with the same mana value as this card, reveal it, put it into your hand, then shuffle. Activate only as a sorcery.',
        },
      });

      const resolveResult = adapter.executeAction('test-game', { type: 'resolveStack' });
      const player1 = resolveResult.next.players.find(p => p.id === 'player1') as any;

      expect((player1.hand || []).map((card: any) => card.id)).toContain('mv-match');
      expect((player1.hand || []).map((card: any) => card.id)).not.toContain('transmute-card');
      expect((player1.graveyard || []).map((card: any) => card.id)).toContain('transmute-card');
      expect((player1.library || []).map((card: any) => card.id)).not.toContain('mv-match');
    });

    it('should resolve an Encore-style ability effect from the stack by creating one attacking copy per opponent', () => {
      const stateWithEncoreCard: any = {
        ...testGameState,
        players: [
          {
            ...(testGameState.players[0] as any),
            id: 'player1',
            hand: [],
            graveyard: [
              {
                id: 'other-grave-card',
                name: 'Other Card',
                type_line: 'Sorcery',
              },
            ],
            exile: [
              {
                id: 'encore-card',
                name: 'Impaler Shrike',
                oracle_text: 'Flying\nWhen Impaler Shrike dies, you may draw three cards.\nEncore {5}{U}{U}',
                type_line: 'Creature - Bird Horror',
                power: '3',
                toughness: '1',
              },
            ],
            library: [],
            manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
          },
          { ...(testGameState.players[1] as any), id: 'player2', hand: [], graveyard: [], exile: [], library: [] },
          {
            ...(testGameState.players[1] as any),
            id: 'player3',
            name: 'Player 3',
            seat: 2,
            hand: [],
            graveyard: [],
            exile: [],
            library: [],
            manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
          },
        ],
        turnOrder: ['player1', 'player2', 'player3'],
        phase: 'precombatMain' as any,
        step: 'main1' as any,
        battlefield: [],
      };

      adapter.initializeGame('test-game', stateWithEncoreCard);
      adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        ability: {
          id: 'encore-ability',
          sourceId: 'encore-card',
          sourceName: 'Impaler Shrike',
          sourceZone: 'exile',
          controllerId: 'player1',
          effect: "For each opponent, create a token that's a copy of it. Those tokens enter tapped and attacking. They gain haste. Sacrifice them at the beginning of the next end step. Activate only as a sorcery.",
        },
      });

      const resolveResult = adapter.executeAction('test-game', { type: 'resolveStack' });
      const tokens = (resolveResult.next.battlefield || []).filter((perm: any) => perm.isToken);

      expect(tokens).toHaveLength(2);
      expect(tokens.map((token: any) => token.defendingPlayerId).sort()).toEqual(['player2', 'player3']);
      expect(tokens.every((token: any) => token.tapped)).toBe(true);
      expect(tokens.every((token: any) => (token.grantedAbilities || []).includes('haste'))).toBe(true);
    });

    it('should process becomes-monstrous triggers after a monstrosity ability resolves', () => {
      const stateWithMonstrousTrigger: any = {
        ...testGameState,
        players: [
          {
            ...(testGameState.players[0] as any),
            id: 'player1',
            hand: [],
            library: [
              {
                id: 'drawn-card',
                name: 'Drawn Card',
                type_line: 'Instant',
              },
            ],
            graveyard: [],
            exile: [],
            manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 3 },
          },
          { ...(testGameState.players[1] as any), id: 'player2', hand: [], graveyard: [], exile: [], library: [] },
        ],
        battlefield: [
          {
            id: 'monstrous-source',
            controller: 'player1',
            owner: 'player1',
            ownerId: 'player1',
            tapped: false,
            summoningSickness: false,
            counters: {},
            power: 3,
            toughness: 3,
            basePower: 3,
            baseToughness: 3,
            card: {
              id: 'monstrous-source-card',
              name: 'Test Monster',
              type_line: 'Creature - Beast',
              oracle_text: 'Whenever this creature becomes monstrous, draw a card.',
              power: '3',
              toughness: '3',
            },
          },
        ] as any,
        phase: 'precombatMain' as any,
        step: 'main1' as any,
      } as any;

      adapter.initializeGame('test-game', stateWithMonstrousTrigger);
      adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        ability: {
          id: 'monstrosity-ability',
          sourceId: 'monstrous-source',
          sourceName: 'Test Monster',
          sourceZone: 'battlefield',
          controllerId: 'player1',
          manaCost: { colorless: 3 },
          effect: 'Monstrosity 3.',
        },
      });

      const resolveResult = adapter.executeAction('test-game', { type: 'resolveStack' });
      const player1 = resolveResult.next.players.find(p => p.id === 'player1') as any;
      const source = (resolveResult.next.battlefield as any[]).find((perm: any) => perm.id === 'monstrous-source') as any;

      expect(source?.isMonstrous).toBe(true);
      expect((source?.counters || {})['+1/+1']).toBe(3);
      expect((player1.hand || []).map((card: any) => card.id)).toEqual(['drawn-card']);
      expect(resolveResult.log.some(entry => entry.includes('became monstrous triggers'))).toBe(true);
    });

    it('should resolve Encore end-to-end from the graveyard after paying the self-exile additional cost', () => {
      const stateWithEncoreCard: any = {
        ...testGameState,
        players: [
          {
            ...(testGameState.players[0] as any),
            id: 'player1',
            hand: [],
            graveyard: [
              {
                id: 'encore-card',
                name: 'Impaler Shrike',
                oracle_text: 'Flying\nWhen Impaler Shrike dies, you may draw three cards.\nEncore {5}{U}{U}',
                type_line: 'Creature - Bird Horror',
                power: '3',
                toughness: '1',
              },
              {
                id: 'other-grave-card',
                name: 'Other Card',
                type_line: 'Sorcery',
              },
            ],
            exile: [],
            library: [],
            manaPool: { white: 0, blue: 2, black: 0, red: 0, green: 0, colorless: 5 },
          },
          { ...(testGameState.players[1] as any), id: 'player2', hand: [], graveyard: [], exile: [], library: [] },
          {
            ...(testGameState.players[1] as any),
            id: 'player3',
            name: 'Player 3',
            seat: 2,
            hand: [],
            graveyard: [],
            exile: [],
            library: [],
            manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
          },
        ],
        turnOrder: ['player1', 'player2', 'player3'],
        phase: 'precombatMain' as any,
        step: 'main1' as any,
        battlefield: [],
      };

      adapter.initializeGame('test-game', stateWithEncoreCard);
      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        ability: {
          id: 'encore-ability',
          sourceId: 'encore-card',
          sourceName: 'Impaler Shrike',
          sourceZone: 'graveyard',
          controllerId: 'player1',
          manaCost: { generic: 5, blue: 2 },
          additionalCosts: [
            {
              type: 'exile',
              description: 'Exile this card from your graveyard',
              isOptional: false,
              isMandatory: true,
            },
          ],
          restrictions: [
            {
              type: 'timing',
              description: 'Activate only as a sorcery',
              requiresSorceryTiming: true,
            },
          ],
          effect:
            "For each opponent, create a token that's a copy of it. Those tokens enter tapped and attacking. They gain haste. Sacrifice them at the beginning of the next end step. Activate only as a sorcery.",
        },
      });
      const activatedPlayer = activateResult.next.players.find(p => p.id === 'player1') as any;

      expect((activatedPlayer.graveyard || []).map((card: any) => card.id)).not.toContain('encore-card');
      expect((activatedPlayer.exile || []).map((card: any) => card.id)).toContain('encore-card');

      const resolveResult = adapter.executeAction('test-game', { type: 'resolveStack' });
      const resolvePlayer = resolveResult.next.players.find(p => p.id === 'player1') as any;
      const tokens = (resolveResult.next.battlefield || []).filter((perm: any) => perm.isToken);

      expect((resolvePlayer.exile || []).map((card: any) => card.id)).toContain('encore-card');
      expect(tokens).toHaveLength(2);
      expect(tokens.map((token: any) => token.defendingPlayerId).sort()).toEqual(['player2', 'player3']);
      expect(tokens.every((token: any) => token.attackingPlayerId === 'player1')).toBe(true);
      expect(tokens.every((token: any) => token.tapped)).toBe(true);
      expect(tokens.every((token: any) => (token.grantedAbilities || []).includes('haste'))).toBe(true);
    });

    it('should pay life when an activated ability has a life additional cost', () => {
      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        ability: {
          id: 'life-ability',
          sourceId: 'life-source',
          sourceName: 'Blood Device',
          controllerId: 'player1',
          additionalCosts: [
            {
              type: 'life',
              description: 'Pay 2 life',
              isOptional: false,
              isMandatory: true,
            },
          ],
          effect: 'Target opponent loses 1 life.',
          targets: ['player2'],
        },
      });

      const player1 = activateResult.next.players.find(p => p.id === 'player1');
      expect(player1?.life).toBe(38);
    });

    it('should reduce a creature activation mana cost with Training Grounds', () => {
      const stateWithReducer: any = {
        ...testGameState,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 2 },
              }
            : p
        ),
        battlefield: [
          {
            id: 'training-grounds',
            controller: 'player1',
            owner: 'player1',
            name: 'Training Grounds',
            card: { id: 'training-grounds-card', name: 'Training Grounds', type_line: 'Enchantment' },
            tapped: false,
            summoningSickness: false,
            attachments: [],
            counters: {},
          },
          {
            id: 'merfolk-source',
            controller: 'player1',
            owner: 'player1',
            name: 'Merfolk Looter',
            card: { id: 'merfolk-source-card', name: 'Merfolk Looter', type_line: 'Creature - Merfolk Rogue' },
            tapped: false,
            summoningSickness: false,
            attachments: [],
            counters: {},
          },
        ],
      };

      adapter.initializeGame('test-game', stateWithReducer);
      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        ability: {
          id: 'reduced-ability',
          sourceId: 'merfolk-source',
          sourceName: 'Merfolk Looter',
          controllerId: 'player1',
          manaCost: { blue: 1, generic: 2 },
          effect: 'Draw a card, then discard a card.',
        },
      });

      const player1 = activateResult.next.players.find(p => p.id === 'player1') as any;
      expect(player1.manaPool.blue).toBe(0);
      expect(player1.manaPool.colorless).toBe(2);
    });

    it("should not let Training Grounds reduce a creature activation below one mana", () => {
      const stateWithReducer: any = {
        ...testGameState,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
              }
            : p
        ),
        battlefield: [
          {
            id: 'training-grounds',
            controller: 'player1',
            owner: 'player1',
            name: 'Training Grounds',
            card: { id: 'training-grounds-card', name: 'Training Grounds', type_line: 'Enchantment' },
            tapped: false,
            summoningSickness: false,
            attachments: [],
            counters: {},
          },
          {
            id: 'one-mana-creature',
            controller: 'player1',
            owner: 'player1',
            name: 'One-Mana Creature',
            card: { id: 'one-mana-creature-card', name: 'One-Mana Creature', type_line: 'Creature - Shapeshifter' },
            tapped: false,
            summoningSickness: false,
            attachments: [],
            counters: {},
          },
        ],
      };

      adapter.initializeGame('test-game', stateWithReducer);
      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        ability: {
          id: 'floor-ability',
          sourceId: 'one-mana-creature',
          sourceName: 'One-Mana Creature',
          controllerId: 'player1',
          manaCost: { generic: 1 },
          effect: 'Target opponent loses 1 life.',
          targets: ['player2'],
        },
      });

      const player1 = activateResult.next.players.find(p => p.id === 'player1') as any;
      expect(player1.manaPool.colorless).toBe(0);
    });

    it('should not let Training Grounds reduce a noncreature activation mana cost', () => {
      const stateWithReducer: any = {
        ...testGameState,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 2 },
              }
            : p
        ),
        battlefield: [
          {
            id: 'training-grounds',
            controller: 'player1',
            owner: 'player1',
            name: 'Training Grounds',
            card: { id: 'training-grounds-card', name: 'Training Grounds', type_line: 'Enchantment' },
            tapped: false,
            summoningSickness: false,
            attachments: [],
            counters: {},
          },
          {
            id: 'artifact-source',
            controller: 'player1',
            owner: 'player1',
            name: 'Mana Vault Door',
            card: { id: 'artifact-source-card', name: 'Mana Vault Door', type_line: 'Artifact' },
            tapped: false,
            summoningSickness: false,
            attachments: [],
            counters: {},
          },
        ],
      };

      adapter.initializeGame('test-game', stateWithReducer);
      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        ability: {
          id: 'artifact-ability',
          sourceId: 'artifact-source',
          sourceName: 'Mana Vault Door',
          controllerId: 'player1',
          manaCost: { generic: 2 },
          effect: 'Target opponent loses 1 life.',
          targets: ['player2'],
        },
      });

      const player1 = activateResult.next.players.find(p => p.id === 'player1') as any;
      expect(player1.manaPool.colorless).toBe(0);
    });

    it('should exile the source permanent when an activated ability has a self-exile additional cost', () => {
      const stateWithPermanent: any = {
        ...testGameState,
        battlefield: [
          {
            id: 'exile-source',
            controller: 'player1',
            owner: 'player1',
            name: 'Vanishing Engine',
            card: { id: 'exile-source-card', name: 'Vanishing Engine', type_line: 'Artifact' },
            tapped: false,
            summoningSickness: false,
            attachments: [],
            counters: {},
          },
        ],
      };

      adapter.initializeGame('test-game', stateWithPermanent);
      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        ability: {
          id: 'exile-ability',
          sourceId: 'exile-source',
          sourceName: 'Vanishing Engine',
          controllerId: 'player1',
          additionalCosts: [
            {
              type: 'exile',
              description: 'Exile this artifact',
              isOptional: false,
              isMandatory: true,
            },
          ],
          effect: 'Target opponent loses 1 life.',
          targets: ['player2'],
        },
      });

      const source = (activateResult.next.battlefield || []).find((perm: any) => perm.id === 'exile-source') as any;
      expect(source).toBeUndefined();
      const player1 = activateResult.next.players.find(p => p.id === 'player1') as any;
      expect((player1.exile || []).some((card: any) => card.id === 'exile-source-card')).toBe(true);
    });

    it('should exile the selected hand card when an activated ability has a hand-exile additional cost', () => {
      const stateWithHand: any = {
        ...testGameState,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                hand: [
                  { id: 'keep-hand-card', name: 'Keep Me', type_line: 'Instant' },
                  { id: 'pitch-hand-card', name: 'Pitch Me', type_line: 'Artifact' },
                ],
                exile: [],
              }
            : p
        ),
      };

      adapter.initializeGame('test-game', stateWithHand);
      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        additionalCostCardIds: ['pitch-hand-card'],
        ability: {
          id: 'hand-exile-ability',
          sourceId: 'hand-exile-source',
          sourceName: 'Soul Furnace',
          controllerId: 'player1',
          additionalCosts: [
            {
              type: 'exile',
              description: 'Exile a card from your hand',
              isOptional: false,
              isMandatory: true,
            },
          ],
          effect: 'Target opponent loses 1 life.',
          targets: ['player2'],
        },
      });

      const player1 = activateResult.next.players.find(p => p.id === 'player1') as any;
      expect((player1.hand || []).some((card: any) => card.id === 'pitch-hand-card')).toBe(false);
      expect((player1.hand || []).some((card: any) => card.id === 'keep-hand-card')).toBe(true);
      expect((player1.exile || []).some((card: any) => card.id === 'pitch-hand-card')).toBe(true);
    });

    it('should exile the selected graveyard card when an activated ability has a graveyard-exile additional cost', () => {
      const stateWithGraveyard: any = {
        ...testGameState,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                graveyard: [
                  { id: 'keep-grave-card', name: 'Stay Buried', type_line: 'Sorcery' },
                  { id: 'fuel-grave-card', name: 'Fuel Me', type_line: 'Creature' },
                ],
                exile: [],
              }
            : p
        ),
      };

      adapter.initializeGame('test-game', stateWithGraveyard);
      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        additionalCostCardIds: ['fuel-grave-card'],
        ability: {
          id: 'grave-exile-ability',
          sourceId: 'grave-exile-source',
          sourceName: 'Tomb Furnace',
          controllerId: 'player1',
          additionalCosts: [
            {
              type: 'exile',
              description: 'Exile a card from your graveyard',
              isOptional: false,
              isMandatory: true,
            },
          ],
          effect: 'Target opponent loses 1 life.',
          targets: ['player2'],
        },
      });

      const player1 = activateResult.next.players.find(p => p.id === 'player1') as any;
      expect((player1.graveyard || []).some((card: any) => card.id === 'fuel-grave-card')).toBe(false);
      expect((player1.graveyard || []).some((card: any) => card.id === 'keep-grave-card')).toBe(true);
      expect((player1.exile || []).some((card: any) => card.id === 'fuel-grave-card')).toBe(true);
    });

    it('should discard the selected card when an activated ability has a discard additional cost', () => {
      const stateWithHand: any = {
        id: 'test-game',
        format: 'commander',
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
            hand: [
              { id: 'keep-card', name: 'Keep Me', type_line: 'Instant' },
              { id: 'discard-card', name: 'Pitch Me', type_line: 'Sorcery' },
            ],
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
        phase: 'precombatMain',
        step: 'main',
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
        status: 'inProgress',
      };

      adapter.initializeGame('test-game', stateWithHand);
      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        additionalCostCardIds: ['discard-card'],
        ability: {
          id: 'discard-ability',
          sourceId: 'discard-source',
          sourceName: 'Pitch Device',
          controllerId: 'player1',
          additionalCosts: [
            {
              type: 'discard',
              description: 'Discard 1 card(s)',
              isOptional: false,
              isMandatory: true,
            },
          ],
          effect: 'Target opponent loses 1 life.',
          targets: ['player2'],
        },
      });

      expect(activateResult.log).toContain('player1 discarded 1 card(s)');
      const player1 = activateResult.next.players.find(p => p.id === 'player1') as any;
      expect((player1.hand || []).some((card: any) => card.id === 'discard-card')).toBe(false);
      expect((player1.hand || []).some((card: any) => card.id === 'keep-card')).toBe(true);
      expect((player1.graveyard || []).some((card: any) => card.id === 'discard-card')).toBe(true);
    });

    it('should honor discard filter text when an activated ability requires discarding a land card', () => {
      const stateWithHand: any = {
        ...testGameState,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                hand: [
                  { id: 'spell-card', name: 'Shock', type_line: 'Instant' },
                  { id: 'land-card', name: 'Mountain', type_line: 'Basic Land - Mountain' },
                ],
                graveyard: [],
              }
            : p
        ),
      };

      adapter.initializeGame('test-game', stateWithHand);
      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        additionalCostCardIds: ['land-card'],
        ability: {
          id: 'discard-land-ability',
          sourceId: 'discard-land-source',
          sourceName: 'Geomancer',
          controllerId: 'player1',
          additionalCosts: [
            {
              type: 'discard',
              description: 'Discard a land card',
              isOptional: false,
              isMandatory: true,
            },
          ],
          effect: 'Target opponent loses 1 life.',
          targets: ['player2'],
        },
      });

      const player1 = activateResult.next.players.find(p => p.id === 'player1') as any;
      expect((player1.hand || []).some((card: any) => card.id === 'spell-card')).toBe(true);
      expect((player1.hand || []).some((card: any) => card.id === 'land-card')).toBe(false);
      expect((player1.graveyard || []).some((card: any) => card.id === 'land-card')).toBe(true);
    });

    it('should untap the source permanent when an activated ability has an untap additional cost', () => {
      const stateWithTappedPermanent: any = {
        ...testGameState,
        battlefield: [
          {
            id: 'untap-source',
            controller: 'player1',
            owner: 'player1',
            name: 'Clockwork Engine',
            card: { id: 'untap-source-card', name: 'Clockwork Engine', type_line: 'Artifact' },
            tapped: true,
            summoningSickness: false,
            attachments: [],
            counters: {},
          },
        ],
      };

      adapter.initializeGame('test-game', stateWithTappedPermanent);
      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        ability: {
          id: 'untap-ability',
          sourceId: 'untap-source',
          sourceName: 'Clockwork Engine',
          controllerId: 'player1',
          additionalCosts: [
            {
              type: 'untap',
              description: 'Untap this permanent',
              isOptional: false,
              isMandatory: true,
            },
          ],
          effect: 'Target opponent loses 1 life.',
          targets: ['player2'],
        },
      });

      const source = (activateResult.next.battlefield || []).find((perm: any) => perm.id === 'untap-source') as any;
      expect(source?.tapped).toBe(false);
    });

    it('should resolve a Gilder Bairn-style untap cost activation by doubling counters on the target permanent', () => {
      const stateWithCounters: any = {
        ...testGameState,
        battlefield: [
          {
            id: 'gilder-source',
            controller: 'player1',
            owner: 'player1',
            name: 'Gilder Bairn',
            card: { id: 'gilder-source-card', name: 'Gilder Bairn', type_line: 'Creature - Ouphe' },
            tapped: true,
            summoningSickness: false,
            attachments: [],
            counters: {},
          },
          {
            id: 'counter-target',
            controller: 'player1',
            owner: 'player1',
            name: 'Counter Target',
            card: { id: 'counter-target-card', name: 'Counter Target', type_line: 'Artifact Creature - Construct' },
            tapped: false,
            summoningSickness: false,
            attachments: [],
            counters: { '+1/+1': 2, charge: 1 },
          },
        ],
      };

      adapter.initializeGame('test-game', stateWithCounters);
      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        ability: {
          id: 'gilder-ability',
          sourceId: 'gilder-source',
          sourceName: 'Gilder Bairn',
          controllerId: 'player1',
          additionalCosts: [
            {
              type: 'untap',
              description: 'Untap this permanent',
              isOptional: false,
              isMandatory: true,
            },
          ],
          effect: 'For each kind of counter on target permanent, put another of that kind of counter on that permanent.',
          targets: ['counter-target'],
        },
      });
      const resolveResult = adapter.executeAction('test-game', { type: 'resolveStack' });
      const target = (resolveResult.next.battlefield || []).find((perm: any) => perm.id === 'counter-target') as any;

      expect((target?.counters || {})['+1/+1']).toBe(4);
      expect((target?.counters || {}).charge).toBe(2);
      expect(activateResult.log.some(line => line.includes('untapped to activate'))).toBe(true);
    });

    it('should sacrifice the source permanent when an activated ability has a sacrifice additional cost', () => {
      const stateWithPermanent: any = {
        ...testGameState,
        battlefield: [
          {
            id: 'sac-source',
            controller: 'player1',
            owner: 'player1',
            name: 'Self-Destruct Button',
            card: { id: 'sac-source-card', name: 'Self-Destruct Button', type_line: 'Artifact' },
            tapped: false,
            summoningSickness: false,
            attachments: [],
            counters: {},
          },
        ],
      };

      adapter.initializeGame('test-game', stateWithPermanent);
      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        ability: {
          id: 'sac-ability',
          sourceId: 'sac-source',
          sourceName: 'Self-Destruct Button',
          controllerId: 'player1',
          additionalCosts: [
            {
              type: 'sacrifice',
              description: 'Sacrifice this permanent',
              isOptional: false,
              isMandatory: true,
            },
          ],
          effect: 'Target opponent loses 1 life.',
          targets: ['player2'],
        },
      });

      const source = (activateResult.next.battlefield || []).find((perm: any) => perm.id === 'sac-source') as any;
      expect(source).toBeUndefined();
      const player1 = activateResult.next.players.find(p => p.id === 'player1') as any;
      expect((player1.graveyard || []).some((card: any) => card.id === 'sac-source-card')).toBe(true);
    });

    it('should remove counters from the selected permanents when an activated ability has a remove-counter additional cost', () => {
      const stateWithCounters: any = {
        ...testGameState,
        battlefield: [
          {
            id: 'counter-source',
            controller: 'player1',
            owner: 'player1',
            name: 'Counter Engine',
            card: { id: 'counter-source-card', name: 'Counter Engine', type_line: 'Artifact' },
            tapped: false,
            summoningSickness: false,
            attachments: [],
            counters: { '+1/+1': 1 },
          },
          {
            id: 'counter-helper',
            controller: 'player1',
            owner: 'player1',
            name: 'Counter Helper',
            card: { id: 'counter-helper-card', name: 'Counter Helper', type_line: 'Artifact Creature' },
            tapped: false,
            summoningSickness: false,
            attachments: [],
            counters: { '+1/+1': 1 },
          },
        ],
      };

      adapter.initializeGame('test-game', stateWithCounters);
      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        additionalCostPermanentIds: ['counter-source', 'counter-helper'],
        ability: {
          id: 'counter-ability',
          sourceId: 'counter-source',
          sourceName: 'Counter Engine',
          controllerId: 'player1',
          additionalCosts: [
            {
              type: 'remove_counter',
              description: 'Remove 2 +1/+1 counter(s)',
              isOptional: false,
              isMandatory: true,
            },
          ],
          effect: 'Target opponent loses 1 life.',
          targets: ['player2'],
        },
      });

      const source = (activateResult.next.battlefield || []).find((perm: any) => perm.id === 'counter-source') as any;
      const helper = (activateResult.next.battlefield || []).find((perm: any) => perm.id === 'counter-helper') as any;
      expect(source?.counters || {}).toEqual({});
      expect(helper?.counters || {}).toEqual({});
    });

    it('should honor counter-removal filter text when an activated ability removes counters from a creature you control', () => {
      const stateWithCounters: any = {
        ...testGameState,
        battlefield: [
          {
            id: 'counter-filter-source',
            controller: 'player1',
            owner: 'player1',
            name: 'Filter Engine',
            card: { id: 'counter-filter-source-card', name: 'Filter Engine', type_line: 'Artifact' },
            tapped: false,
            summoningSickness: false,
            attachments: [],
            counters: { '+1/+1': 1 },
          },
          {
            id: 'counter-creature',
            controller: 'player1',
            owner: 'player1',
            name: 'Helpful Bear',
            card: { id: 'counter-creature-card', name: 'Helpful Bear', type_line: 'Creature - Bear' },
            tapped: false,
            summoningSickness: false,
            attachments: [],
            counters: { '+1/+1': 1 },
          },
        ],
      };

      adapter.initializeGame('test-game', stateWithCounters);
      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        additionalCostPermanentIds: ['counter-creature'],
        ability: {
          id: 'counter-filter-ability',
          sourceId: 'counter-filter-source',
          sourceName: 'Filter Engine',
          controllerId: 'player1',
          additionalCosts: [
            {
              type: 'remove_counter',
              description: 'Remove 1 +1/+1 counter(s) from a creature you control',
              isOptional: false,
              isMandatory: true,
            },
          ],
          effect: 'Target opponent loses 1 life.',
          targets: ['player2'],
        },
      });

      const source = (activateResult.next.battlefield || []).find((perm: any) => perm.id === 'counter-filter-source') as any;
      const creature = (activateResult.next.battlefield || []).find((perm: any) => perm.id === 'counter-creature') as any;
      expect(source?.counters || {}).toEqual({ '+1/+1': 1 });
      expect(creature?.counters || {}).toEqual({});
    });

    it('should exile the selected graveyard card when an activated ability has an exile additional cost', () => {
      const stateWithGraveyard: any = {
        ...testGameState,
        players: testGameState.players.map(p =>
          p.id === 'player1'
            ? {
                ...(p as any),
                graveyard: [
                  { id: 'grave-a', name: 'Spent Spell', type_line: 'Instant' },
                  { id: 'grave-b', name: 'Fuel Card', type_line: 'Sorcery' },
                ],
                exile: [],
              }
            : p
        ),
      };

      adapter.initializeGame('test-game', stateWithGraveyard);
      const activateResult = adapter.executeAction('test-game', {
        type: 'activateAbility',
        playerId: 'player1',
        additionalCostCardIds: ['grave-b'],
        ability: {
          id: 'exile-ability',
          sourceId: 'exile-source',
          sourceName: 'Crypt Device',
          controllerId: 'player1',
          additionalCosts: [
            {
              type: 'exile',
              description: 'Exile a card from your graveyard',
              isOptional: false,
              isMandatory: true,
            },
          ],
          effect: 'Target opponent loses 1 life.',
          targets: ['player2'],
        },
      });

      const player1 = activateResult.next.players.find(p => p.id === 'player1') as any;
      expect((player1.graveyard || []).some((card: any) => card.id === 'grave-b')).toBe(false);
      expect((player1.graveyard || []).some((card: any) => card.id === 'grave-a')).toBe(true);
      expect((player1.exile || []).some((card: any) => card.id === 'grave-b')).toBe(true);
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

    it('should process Afflict during declareBlockers for the blocked attacker', () => {
      const stateWithAfflict: any = {
        ...testGameState,
        step: GameStep.DECLARE_BLOCKERS,
        combat: {
          phase: 'declareAttackers',
          attackers: [
            {
              permanentId: 'afflict-attacker',
              defending: 'player2',
              blockedBy: [],
            },
          ],
          blockers: [],
        },
        battlefield: [
          {
            id: 'afflict-attacker',
            controller: 'player1',
            owner: 'player1',
            tapped: true,
            card: {
              id: 'afflict-card',
              name: 'Storm Fleet Sprinter',
              type_line: 'Creature - Orc Pirate',
              oracle_text: 'Afflict 2',
              power: '3',
              toughness: '2',
            },
          },
          {
            id: 'blocker-1',
            controller: 'player2',
            owner: 'player2',
            tapped: false,
            card: {
              id: 'blocker-card',
              name: 'Shield Bearer',
              type_line: 'Creature - Human Soldier',
              oracle_text: '',
              power: '1',
              toughness: '4',
            },
          },
        ],
      };

      adapter.initializeGame('test-game', stateWithAfflict);
      const result = adapter.executeAction('test-game', {
        type: 'declareBlockers',
        playerId: 'player2',
        blockers: [
          { blockerId: 'blocker-1', attackerId: 'afflict-attacker', damageOrder: ['afflict-attacker'] },
        ],
      });

      const player2 = result.next.players.find((p: any) => p.id === 'player2') as any;
      expect(player2.life).toBe(38);
    });

    it('should process Renown during dealCombatDamage only for the matching attacker once', () => {
      const stateWithRenown: any = {
        ...testGameState,
        battlefield: [
          {
            id: 'renown-attacker',
            controller: 'player1',
            owner: 'player1',
            tapped: true,
            counters: {},
            power: 2,
            toughness: 2,
            basePower: 2,
            baseToughness: 2,
            card: {
              id: 'renown-card',
              name: 'Topan Freeblade',
              type_line: 'Creature - Human Soldier',
              oracle_text: 'Renown 1',
              power: '2',
              toughness: '2',
            },
          },
        ],
      };

      adapter.initializeGame('test-game', stateWithRenown);
      const first = adapter.executeAction('test-game', {
        type: 'dealCombatDamage',
        playerId: 'player1',
        attackers: [
          {
            attackerId: 'renown-attacker',
            defendingPlayerId: 'player2',
            damage: 2,
            creature: { name: 'Topan Freeblade', power: 2, toughness: 2 },
          },
        ],
      });
      const firstSource = first.next.battlefield.find((perm: any) => perm.id === 'renown-attacker') as any;

      expect((firstSource?.counters || {})['+1/+1']).toBe(1);
      expect(firstSource?.isRenowned).toBe(true);

      const second = adapter.executeAction('test-game', {
        type: 'dealCombatDamage',
        playerId: 'player1',
        attackers: [
          {
            attackerId: 'renown-attacker',
            defendingPlayerId: 'player2',
            damage: 2,
            creature: { name: 'Topan Freeblade', power: 2, toughness: 2 },
          },
        ],
      });
      const secondSource = second.next.battlefield.find((perm: any) => perm.id === 'renown-attacker') as any;

      expect((secondSource?.counters || {})['+1/+1']).toBe(1);
      expect(secondSource?.isRenowned).toBe(true);
    });

    it('should process Ingest during dealCombatDamage for the matching attacker', () => {
      const stateWithIngest: any = {
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
        ],
        battlefield: [
          {
            id: 'ingest-attacker',
            controller: 'player1',
            owner: 'player1',
            tapped: true,
            card: {
              id: 'ingest-card',
              name: 'Benthic Infiltrator',
              type_line: 'Creature - Eldrazi Drone',
              oracle_text: 'Ingest',
              power: '1',
              toughness: '4',
            },
          },
        ],
      };

      adapter.initializeGame('test-game', stateWithIngest);
      const result = adapter.executeAction('test-game', {
        type: 'dealCombatDamage',
        playerId: 'player1',
        attackers: [
          {
            attackerId: 'ingest-attacker',
            defendingPlayerId: 'player2',
            damage: 1,
            creature: { name: 'Benthic Infiltrator', power: 1, toughness: 4 },
          },
        ],
      });
      const player2 = result.next.players.find((p: any) => p.id === 'player2') as any;

      expect((player2.library || []).map((card: any) => card.id)).toEqual(['p2c2']);
      expect((player2.exile || []).map((card: any) => card.id)).toEqual(['p2c1']);
    });

    it('should process Poisonous during dealCombatDamage for the matching attacker', () => {
      const stateWithPoisonous: any = {
        ...testGameState,
        players: [
          {
            ...testGameState.players[0],
            counters: {},
          },
          {
            ...testGameState.players[1],
            counters: {},
            poisonCounters: 0,
          },
        ],
        battlefield: [
          {
            id: 'poisonous-attacker',
            controller: 'player1',
            owner: 'player1',
            tapped: true,
            card: {
              id: 'poisonous-card',
              name: 'Pit Scorpion',
              type_line: 'Creature - Scorpion',
              oracle_text: 'Poisonous 3',
              power: '1',
              toughness: '1',
            },
          },
        ],
      };

      adapter.initializeGame('test-game', stateWithPoisonous);
      const result = adapter.executeAction('test-game', {
        type: 'dealCombatDamage',
        playerId: 'player1',
        attackers: [
          {
            attackerId: 'poisonous-attacker',
            defendingPlayerId: 'player2',
            damage: 1,
            creature: { name: 'Pit Scorpion', power: 1, toughness: 1 },
          },
        ],
      });
      const player2 = result.next.players.find((p: any) => p.id === 'player2') as any;

      expect(player2.poisonCounters).toBe(3);
      expect((player2.counters || {}).poison).toBe(3);
    });

    it('should process Infect during dealCombatDamage as poison instead of life loss', () => {
      const stateWithInfect: any = {
        ...testGameState,
        players: [
          {
            ...testGameState.players[0],
            counters: {},
          },
          {
            ...testGameState.players[1],
            life: 40,
            counters: {},
            poisonCounters: 0,
          },
        ],
        battlefield: [
          {
            id: 'infect-attacker',
            controller: 'player1',
            owner: 'player1',
            tapped: true,
            card: {
              id: 'infect-card',
              name: 'Plague Stinger',
              type_line: 'Creature - Insect Horror',
              oracle_text: 'Flying, infect',
              power: '1',
              toughness: '1',
            },
          },
        ],
      };

      adapter.initializeGame('test-game', stateWithInfect);
      const result = adapter.executeAction('test-game', {
        type: 'dealCombatDamage',
        playerId: 'player1',
        attackers: [
          {
            attackerId: 'infect-attacker',
            defendingPlayerId: 'player2',
            damage: 1,
            creature: { name: 'Plague Stinger', power: 1, toughness: 1 },
          },
        ],
      });
      const player2 = result.next.players.find((p: any) => p.id === 'player2') as any;

      expect(player2.life).toBe(40);
      expect(player2.poisonCounters).toBe(1);
      expect((player2.counters || {}).poison).toBe(1);
    });

    it('should process Infect to a blocker as -1/-1 counters without normal damage', () => {
      const stateWithInfectBlocker: any = {
        ...testGameState,
        battlefield: [
          {
            id: 'infect-attacker',
            controller: 'player1',
            owner: 'player1',
            tapped: true,
            card: {
              id: 'infect-card',
              name: 'Plague Stinger',
              type_line: 'Creature - Insect Horror',
              oracle_text: 'Flying, infect',
              power: '1',
              toughness: '1',
            },
          },
          {
            id: 'bear-blocker',
            controller: 'player2',
            owner: 'player2',
            tapped: false,
            counters: {},
            card: {
              id: 'bear-card',
              name: 'Runeclaw Bear',
              type_line: 'Creature - Bear',
              oracle_text: '',
              power: '2',
              toughness: '2',
            },
          },
        ],
      };

      adapter.initializeGame('test-game', stateWithInfectBlocker);
      const result = adapter.executeAction('test-game', {
        type: 'dealCombatDamage',
        playerId: 'player1',
        attackers: [
          {
            attackerId: 'infect-attacker',
            damage: 1,
            creature: { name: 'Plague Stinger', power: 1, toughness: 1 },
            blockedBy: [{ blockerId: 'bear-blocker', damageAssigned: 1 }],
          },
        ],
      });
      const blocker = (result.next.battlefield as any[]).find((perm: any) => perm.id === 'bear-blocker');

      expect(blocker).toBeTruthy();
      expect((blocker?.counters || {})['-1/-1']).toBe(1);
      expect((blocker?.counters || {}).damage || 0).toBe(0);
      expect(result.log.some(msg => msg.includes('placing 1 -1/-1 counters'))).toBe(true);
    });

    it('should process Wither to a blocker as -1/-1 counters without normal damage', () => {
      const stateWithWitherBlocker: any = {
        ...testGameState,
        battlefield: [
          {
            id: 'wither-attacker',
            controller: 'player1',
            owner: 'player1',
            tapped: true,
            card: {
              id: 'wither-card',
              name: 'Boggart Ram-Gang',
              type_line: 'Creature - Goblin Warrior',
              oracle_text: 'Haste, wither',
              power: '3',
              toughness: '3',
            },
          },
          {
            id: 'ogre-blocker',
            controller: 'player2',
            owner: 'player2',
            tapped: false,
            counters: {},
            card: {
              id: 'ogre-card',
              name: 'Hill Ogre',
              type_line: 'Creature - Ogre',
              oracle_text: '',
              power: '3',
              toughness: '3',
            },
          },
        ],
      };

      adapter.initializeGame('test-game', stateWithWitherBlocker);
      const result = adapter.executeAction('test-game', {
        type: 'dealCombatDamage',
        playerId: 'player1',
        attackers: [
          {
            attackerId: 'wither-attacker',
            damage: 2,
            creature: { name: 'Boggart Ram-Gang', power: 3, toughness: 3 },
            blockedBy: [{ blockerId: 'ogre-blocker', damageAssigned: 2 }],
          },
        ],
      });
      const blocker = (result.next.battlefield as any[]).find((perm: any) => perm.id === 'ogre-blocker');

      expect(blocker).toBeTruthy();
      expect((blocker?.counters || {})['-1/-1']).toBe(2);
      expect((blocker?.counters || {}).damage || 0).toBe(0);
      expect(result.log.some(msg => msg.includes('placing 2 -1/-1 counters'))).toBe(true);
    });

    it('should move a blocker to the graveyard when infect damage gives it 0 toughness', () => {
      const stateWithLethalInfect: any = {
        ...testGameState,
        battlefield: [
          {
            id: 'infect-attacker',
            controller: 'player1',
            owner: 'player1',
            tapped: true,
            card: {
              id: 'infect-card',
              name: 'Plague Stinger',
              type_line: 'Creature - Insect Horror',
              oracle_text: 'Flying, infect',
              power: '1',
              toughness: '1',
            },
          },
          {
            id: 'mite-blocker',
            controller: 'player2',
            owner: 'player2',
            tapped: false,
            counters: {},
            card: {
              id: 'mite-card',
              name: 'Mite Token',
              type_line: 'Artifact Creature - Phyrexian Mite',
              oracle_text: '',
              power: '1',
              toughness: '1',
            },
          },
        ],
      };

      adapter.initializeGame('test-game', stateWithLethalInfect);
      const result = adapter.executeAction('test-game', {
        type: 'dealCombatDamage',
        playerId: 'player1',
        attackers: [
          {
            attackerId: 'infect-attacker',
            damage: 1,
            creature: { name: 'Plague Stinger', power: 1, toughness: 1 },
            blockedBy: [{ blockerId: 'mite-blocker', damageAssigned: 1 }],
          },
        ],
      });
      const player2 = result.next.players.find((p: any) => p.id === 'player2') as any;

      expect((result.next.battlefield as any[]).some((perm: any) => perm.id === 'mite-blocker')).toBe(false);
      expect((player2.graveyard || []).some((card: any) => card.id === 'mite-card' || card.id === 'mite-blocker')).toBe(true);
      expect(result.log.some(msg => msg.includes('dies (0 or less toughness)'))).toBe(true);
    });

    it('should process Toxic during dealCombatDamage as life loss plus poison counters', () => {
      const stateWithToxic: any = {
        ...testGameState,
        players: [
          {
            ...testGameState.players[0],
            counters: {},
          },
          {
            ...testGameState.players[1],
            life: 40,
            counters: {},
            poisonCounters: 0,
          },
        ],
        battlefield: [
          {
            id: 'toxic-attacker',
            controller: 'player1',
            owner: 'player1',
            tapped: true,
            card: {
              id: 'toxic-card',
              name: 'Bilious Skulldweller',
              type_line: 'Creature - Phyrexian Skulldweller',
              oracle_text: 'Deathtouch, toxic 1',
              power: '1',
              toughness: '1',
            },
          },
        ],
      };

      adapter.initializeGame('test-game', stateWithToxic);
      const result = adapter.executeAction('test-game', {
        type: 'dealCombatDamage',
        playerId: 'player1',
        attackers: [
          {
            attackerId: 'toxic-attacker',
            defendingPlayerId: 'player2',
            damage: 1,
            creature: { name: 'Bilious Skulldweller', power: 1, toughness: 1 },
          },
        ],
      });
      const player2 = result.next.players.find((p: any) => p.id === 'player2') as any;

      expect(player2.life).toBe(39);
      expect(player2.poisonCounters).toBe(1);
      expect((player2.counters || {}).poison).toBe(1);
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

    it('should not emit player loss when Platinum Angel protects the player', () => {
      testGameState.players[0].life = 0;
      testGameState.battlefield = [
        {
          id: 'angel1',
          controller: 'player1',
          owner: 'player1',
          card: {
            name: 'Platinum Angel',
            type_line: 'Artifact Creature — Angel',
            power: '4',
            toughness: '4',
            oracle_text: "You can't lose the game and your opponents can't win the game.",
          },
        } as any,
      ];
      adapter.initializeGame('test-game', testGameState);

      let playerLostEmitted = false;
      adapter.on(RulesEngineEvent.PLAYER_LOST, () => {
        playerLostEmitted = true;
      });

      const result = adapter.checkStateBasedActions('test-game', testGameState);

      expect(playerLostEmitted).toBe(false);
      expect(result.log?.some(msg => msg.includes('is protected by Platinum Angel'))).toBe(true);
    });

    it("should not emit player loss when Gideon's emblem protects the player", () => {
      const emblem = createEmblemFromPlaneswalker('player1', 'Gideon of the Trials')!.emblem;
      testGameState.players[0].life = 0;
      (testGameState.players[0] as any).emblems = [emblem];
      testGameState.battlefield = [
        {
          id: 'gideon1',
          controller: 'player1',
          owner: 'player1',
          counters: { loyalty: 3 },
          card: {
            name: 'Gideon of the Trials',
            type_line: 'Legendary Planeswalker — Gideon',
            oracle_text: '',
          },
        } as any,
      ];
      adapter.initializeGame('test-game', testGameState);

      let playerLostEmitted = false;
      adapter.on(RulesEngineEvent.PLAYER_LOST, () => {
        playerLostEmitted = true;
      });

      const result = adapter.checkStateBasedActions('test-game', testGameState);

      expect(playerLostEmitted).toBe(false);
      expect(result.log?.some(msg => msg.includes("Gideon's Emblem"))).toBe(true);
    });

    it("should not emit player loss when a temporary can't-lose effect protects the player", () => {
      testGameState.players[0].life = 0;
      const protectedState = applyTemporaryCantLoseAndOpponentsCantWinEffect(
        testGameState,
        'angel-grace',
        "Angel's Grace",
        'player1',
        'player1',
        "You can't lose the game this turn and your opponents can't win the game this turn."
      ).state;
      adapter.initializeGame('test-game', protectedState as any);

      let playerLostEmitted = false;
      adapter.on(RulesEngineEvent.PLAYER_LOST, () => {
        playerLostEmitted = true;
      });

      const result = adapter.checkStateBasedActions('test-game', protectedState as any);

      expect(playerLostEmitted).toBe(false);
      expect(result.log?.some(msg => msg.includes("Angel's Grace"))).toBe(true);
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

    it("should block last-player-standing wins when an opponent says opponents can't win", () => {
      testGameState.players[0].hasLost = true;
      testGameState.battlefield = [
        {
          id: 'angel1',
          controller: 'player1',
          owner: 'player1',
          card: {
            name: 'Platinum Angel',
            type_line: 'Artifact Creature — Angel',
            power: '4',
            toughness: '4',
            oracle_text: "You can't lose the game and your opponents can't win the game.",
          },
        } as any,
      ];
      adapter.initializeGame('test-game', testGameState);

      let playerWonEmitted = false;
      adapter.on(RulesEngineEvent.PLAYER_WON, () => {
        playerWonEmitted = true;
      });

      const result = adapter.checkStateBasedActions('test-game', testGameState);

      expect(playerWonEmitted).toBe(false);
      expect(result.next.winner).toBeUndefined();
      expect(result.log?.some(msg => msg.includes('cannot win because of Platinum Angel'))).toBe(true);
    });

    it('should detect lethal damage on effective creatures', () => {
      testGameState.battlefield = [
        {
          id: 'animated-relic',
          controller: 'player1',
          owner: 'player1',
          counters: { damage: 3 },
          effectiveTypes: ['Artifact', 'Creature'],
          card: {
            name: 'Animated Relic',
            type_line: 'Artifact',
            power: '3',
            toughness: '3',
            oracle_text: '',
          },
        } as any,
      ];
      adapter.initializeGame('test-game', testGameState);

      const result = adapter.checkStateBasedActions('test-game', testGameState);

      expect(result.next.battlefield.some((perm: any) => perm.id === 'animated-relic')).toBe(false);
      expect(result.log.some(msg => msg.includes('Animated Relic dies (lethal damage)'))).toBe(true);
    });

    it('should detect zero loyalty on effective planeswalkers', () => {
      testGameState.battlefield = [
        {
          id: 'awakened-walker',
          controller: 'player1',
          owner: 'player1',
          counters: { loyalty: 0 },
          effectiveTypes: ['Artifact', 'Planeswalker'],
          card: {
            name: 'Awakened Walker',
            type_line: 'Artifact',
            oracle_text: '',
          },
        } as any,
      ];
      adapter.initializeGame('test-game', testGameState);

      const result = adapter.checkStateBasedActions('test-game', testGameState);

      expect(result.next.battlefield.some((perm: any) => perm.id === 'awakened-walker')).toBe(false);
      expect(result.log.some(msg => msg.includes('Awakened Walker dies (0 loyalty)'))).toBe(true);
    });
  });

  describe('delayed control-loss triggers', () => {
    it('puts prior control-loss delayed triggers on the stack and resolves them against bound objects', () => {
      const delayedTrigger = createDelayedTrigger(
        'krovikan-vampire',
        'Krovikan Vampire',
        'player1',
        DelayedTriggerTiming.WHEN_CONTROL_LOST,
        'You sacrifice that creature.',
        1,
        {
          watchingPermanentId: 'krovikan-vampire',
          eventDataSnapshot: {
            sourceId: 'krovikan-vampire',
            sourceControllerId: 'player1',
            chosenObjectIds: ['stolen-creature'],
          },
        }
      );

      const startState: GameState = {
        ...testGameState,
        battlefield: [
          {
            id: 'krovikan-vampire',
            controller: 'player1',
            owner: 'player1',
            card: {
              name: 'Krovikan Vampire',
              type_line: 'Creature - Vampire',
              power: '3',
              toughness: '3',
            },
          },
          {
            id: 'stolen-creature',
            controller: 'player1',
            owner: 'player2',
            card: {
              name: 'Captured Bear',
              type_line: 'Creature - Bear',
              power: '2',
              toughness: '2',
            },
          },
        ] as any,
        delayedTriggerRegistry: registerDelayedTrigger(
          { triggers: [], firedTriggerIds: [] },
          delayedTrigger
        ),
      } as any;

      adapter.initializeGame('test-game', startState);

      const nextState: GameState = {
        ...startState,
        battlefield: [
          {
            id: 'krovikan-vampire',
            controller: 'player2',
            owner: 'player1',
            card: {
              name: 'Krovikan Vampire',
              type_line: 'Creature - Vampire',
              power: '3',
              toughness: '3',
            },
          },
          {
            id: 'stolen-creature',
            controller: 'player1',
            owner: 'player2',
            card: {
              name: 'Captured Bear',
              type_line: 'Creature - Bear',
              power: '2',
              toughness: '2',
            },
          },
        ] as any,
      } as any;

      const processed = (adapter as any).processControlLossDelayedTriggers('test-game', startState, nextState);

      expect(processed.state.delayedTriggerRegistry.triggers).toHaveLength(0);
      expect(processed.state.delayedTriggerRegistry.firedTriggerIds).toContain(delayedTrigger.id);
      expect((processed.state.stack as any[])).toHaveLength(1);
      expect((processed.state.stack as any[])[0]?.cardName).toContain('Krovikan Vampire trigger');

      ((adapter as any).gameStates as Map<string, GameState>).set('test-game', processed.state);
      const resolveResult = adapter.executeAction('test-game', { type: 'resolveStack' });

      expect((resolveResult.next.battlefield as any[]).map((perm: any) => perm.id)).toEqual(['krovikan-vampire']);
    });
  });

  describe('delayed dies triggers', () => {
    it('puts watched dies triggers on the stack and resolves them after the creature hits the graveyard', () => {
      const delayedTrigger = createDelayedTrigger(
        'not-dead',
        'Not Dead After All',
        'player1',
        DelayedTriggerTiming.WHEN_DIES,
        'Return it to the battlefield tapped under its owner\'s control, then create a Treasure token.',
        1,
        {
          watchingPermanentId: 'captured-bear',
          eventDataSnapshot: {
            sourceId: 'not-dead',
            sourceControllerId: 'player1',
            targetPermanentId: 'captured-bear',
            chosenObjectIds: ['captured-bear'],
          },
        }
      );

      const startState: GameState = {
        ...testGameState,
        battlefield: [
          {
            id: 'captured-bear',
            controller: 'player1',
            owner: 'player1',
            tapped: false,
            attachments: [],
            counters: {},
            card: {
              id: 'captured-bear',
              name: 'Captured Bear',
              type_line: 'Creature - Bear',
              power: '2',
              toughness: '2',
            },
          },
        ] as any,
        delayedTriggerRegistry: registerDelayedTrigger(
          { triggers: [], firedTriggerIds: [] },
          delayedTrigger
        ),
      } as any;

      adapter.initializeGame('test-game', startState);

      const nextState: GameState = {
        ...startState,
        battlefield: [] as any,
        players: startState.players.map(player =>
          player.id === 'player1'
            ? {
                ...player,
                graveyard: [
                  ...(player.graveyard || []),
                  {
                    id: 'captured-bear',
                    name: 'Captured Bear',
                    type_line: 'Creature - Bear',
                    power: '2',
                    toughness: '2',
                  },
                ],
              }
            : player
        ),
      } as any;

      const processed = (adapter as any).processDiesDelayedTriggers('test-game', startState, nextState);

      expect(processed.state.delayedTriggerRegistry.triggers).toHaveLength(0);
      expect(processed.state.delayedTriggerRegistry.firedTriggerIds).toContain(delayedTrigger.id);
      expect((processed.state.stack as any[])).toHaveLength(1);

      ((adapter as any).gameStates as Map<string, GameState>).set('test-game', processed.state);
      const resolveResult = adapter.executeAction('test-game', { type: 'resolveStack' });

      const player1 = resolveResult.next.players.find(player => player.id === 'player1') as any;
      expect((player1.graveyard || []).map((card: any) => card.id)).toEqual([]);
      expect(
        (resolveResult.next.battlefield as any[]).some(
          (perm: any) => String(perm?.card?.id || perm?.id || '') === 'captured-bear'
        )
      ).toBe(true);
      expect((resolveResult.next.battlefield as any[]).some((perm: any) => perm.card?.name === 'Treasure')).toBe(true);
    });

    it('expires watched dies triggers when the watched permanent leaves without dying', () => {
      const delayedTrigger = createDelayedTrigger(
        'flame-wreathed-phoenix',
        'Flame-Wreathed Phoenix',
        'player1',
        DelayedTriggerTiming.WHEN_DIES,
        "Return it to its owner's hand.",
        1,
        {
          watchingPermanentId: 'phoenix',
          effectData: {
            expireWhenPermanentLeavesBattlefield: true,
          },
          eventDataSnapshot: {
            sourceId: 'phoenix',
            sourceControllerId: 'player1',
            targetPermanentId: 'phoenix',
            chosenObjectIds: ['phoenix'],
          },
        }
      );

      const startState: GameState = {
        ...testGameState,
        battlefield: [
          {
            id: 'phoenix',
            controller: 'player1',
            owner: 'player1',
            tapped: false,
            attachments: [],
            counters: {},
            card: {
              id: 'phoenix',
              name: 'Flame-Wreathed Phoenix',
              type_line: 'Creature - Phoenix',
              power: '3',
              toughness: '3',
            },
          },
        ] as any,
        delayedTriggerRegistry: registerDelayedTrigger(
          { triggers: [], firedTriggerIds: [] },
          delayedTrigger
        ),
      } as any;

      adapter.initializeGame('test-game', startState);

      const nextState: GameState = {
        ...startState,
        battlefield: [] as any,
        players: startState.players.map(player =>
          player.id === 'player1'
            ? {
                ...player,
                hand: [
                  ...(player.hand || []),
                  {
                    id: 'phoenix',
                    name: 'Flame-Wreathed Phoenix',
                    type_line: 'Creature - Phoenix',
                    power: '3',
                    toughness: '3',
                  },
                ],
              }
            : player
        ),
      } as any;

      const processed = (adapter as any).processDiesDelayedTriggers('test-game', startState, nextState);

      expect(processed.state.delayedTriggerRegistry.triggers).toHaveLength(0);
      expect(processed.state.delayedTriggerRegistry.firedTriggerIds).toHaveLength(0);
      expect((processed.state.stack as any[])).toHaveLength(0);
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
