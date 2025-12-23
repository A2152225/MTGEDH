/**
 * Tests for AIEngine
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AIEngine, AIStrategy, AIDecisionType } from '../src/AIEngine';
import type { GameState } from '../../shared/src';
import type { AIDecisionContext } from '../src/AIEngine';

describe('AIEngine', () => {
  let aiEngine: AIEngine;
  let testGameState: GameState;
  
  beforeEach(() => {
    aiEngine = new AIEngine();
    testGameState = {
      id: 'test-game',
      format: 'commander' as any,
      life: {},
      turnPlayer: 'ai1',
      priority: 'ai1',
      active: true,
      players: [
        {
          id: 'ai1',
          name: 'AI Player 1',
          seat: 0,
          life: 40,
          hand: [
            { id: 'card1', name: 'Forest', types: ['Land'] },
            { id: 'card2', name: 'Mountain', types: ['Land'] },
            { id: 'card3', name: 'Lightning Bolt', types: ['Instant'] },
          ],
          library: [],
          graveyard: [],
          exile: [],
          commandZone: [],
          counters: {},
          hasLost: false,
        },
        {
          id: 'ai2',
          name: 'AI Player 2',
          seat: 1,
          life: 40,
          hand: [],
          library: [],
          graveyard: [],
          exile: [],
          commandZone: [],
          counters: {},
          hasLost: false,
        },
      ],
      turnOrder: ['ai1', 'ai2'],
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
  
  describe('AI Player Management', () => {
    it('should register an AI player', () => {
      aiEngine.registerAI({
        playerId: 'ai1',
        strategy: AIStrategy.BASIC,
        difficulty: 0.5,
      });
      
      expect(aiEngine.isAI('ai1')).toBe(true);
      expect(aiEngine.isAI('human1')).toBe(false);
    });
    
    it('should unregister an AI player', () => {
      aiEngine.registerAI({
        playerId: 'ai1',
        strategy: AIStrategy.BASIC,
      });
      
      expect(aiEngine.isAI('ai1')).toBe(true);
      
      aiEngine.unregisterAI('ai1');
      
      expect(aiEngine.isAI('ai1')).toBe(false);
    });
    
    it('should retrieve AI configuration', () => {
      const config = {
        playerId: 'ai1',
        strategy: AIStrategy.AGGRESSIVE,
        difficulty: 0.7,
      };
      
      aiEngine.registerAI(config);
      
      const retrieved = aiEngine.getAIConfig('ai1');
      expect(retrieved).toEqual(config);
    });
  });
  
  describe('Mulligan Decisions', () => {
    beforeEach(() => {
      aiEngine.registerAI({
        playerId: 'ai1',
        strategy: AIStrategy.BASIC,
        thinkTime: 0, // No delay for tests
      });
    });
    
    it('should make mulligan decision based on land count', async () => {
      const context: AIDecisionContext = {
        gameState: testGameState,
        playerId: 'ai1',
        decisionType: AIDecisionType.MULLIGAN,
        options: [true, false],
      };
      
      const decision = await aiEngine.makeDecision(context);
      
      expect(decision.type).toBe(AIDecisionType.MULLIGAN);
      expect(decision.playerId).toBe('ai1');
      expect(decision.action.keep).toBeDefined();
      expect(decision.reasoning).toBeDefined();
    });
    
    it('should keep hand with 2-5 lands', async () => {
      const context: AIDecisionContext = {
        gameState: testGameState,
        playerId: 'ai1',
        decisionType: AIDecisionType.MULLIGAN,
        options: [],
      };
      
      const decision = await aiEngine.makeDecision(context);
      
      // Hand has 2 lands, should keep
      expect(decision.action.keep).toBe(true);
      expect(decision.confidence).toBeGreaterThan(0.5);
    });
    
    it('should mulligan hand with too few lands', async () => {
      testGameState.players[0].hand = [
        { id: 'card1', name: 'Lightning Bolt', types: ['Instant'] },
        { id: 'card2', name: 'Grizzly Bears', types: ['Creature'] },
        { id: 'card3', name: 'Cancel', types: ['Instant'] },
      ];
      
      const context: AIDecisionContext = {
        gameState: testGameState,
        playerId: 'ai1',
        decisionType: AIDecisionType.MULLIGAN,
        options: [],
      };
      
      const decision = await aiEngine.makeDecision(context);
      
      // Hand has 0 lands, should mulligan
      expect(decision.action.keep).toBe(false);
      expect(decision.confidence).toBeLessThan(0.5);
    });
  });
  
  describe('Attack Decisions', () => {
    beforeEach(() => {
      aiEngine.registerAI({
        playerId: 'ai1',
        strategy: AIStrategy.BASIC,
        thinkTime: 0,
      });
      
      testGameState.battlefield = [
        { id: 'creature1', name: 'Grizzly Bears', card: { type_line: 'Creature — Bear', name: 'Grizzly Bears' }, controller: 'ai1', tapped: false },
        { id: 'creature2', name: 'Serra Angel', card: { type_line: 'Creature — Angel', name: 'Serra Angel' }, controller: 'ai1', tapped: false },
      ];
    });
    
    it('should make attack decision', async () => {
      const context: AIDecisionContext = {
        gameState: testGameState,
        playerId: 'ai1',
        decisionType: AIDecisionType.DECLARE_ATTACKERS,
        options: [],
      };
      
      const decision = await aiEngine.makeDecision(context);
      
      expect(decision.type).toBe(AIDecisionType.DECLARE_ATTACKERS);
      expect(decision.action.attackers).toBeDefined();
      expect(Array.isArray(decision.action.attackers)).toBe(true);
    });
    
    it('should not attack with tapped creatures', async () => {
      testGameState.battlefield = [
        { id: 'creature1', name: 'Grizzly Bears', card: { type_line: 'Creature — Bear', name: 'Grizzly Bears' }, controller: 'ai1', tapped: true },
      ];
      
      const context: AIDecisionContext = {
        gameState: testGameState,
        playerId: 'ai1',
        decisionType: AIDecisionType.DECLARE_ATTACKERS,
        options: [],
      };
      
      const decision = await aiEngine.makeDecision(context);
      
      expect(decision.action.attackers.length).toBe(0);
    });
  });
  
  describe('Strategy Variations', () => {
    it('should make aggressive decisions', async () => {
      aiEngine.registerAI({
        playerId: 'ai1',
        strategy: AIStrategy.AGGRESSIVE,
        thinkTime: 0,
      });
      
      testGameState.battlefield = [
        { id: 'creature1', name: 'Grizzly Bears', card: { type_line: 'Creature — Bear', name: 'Grizzly Bears', power: '2', toughness: '2' }, controller: 'ai1', tapped: false },
        { id: 'creature2', name: 'Serra Angel', card: { type_line: 'Creature — Angel', name: 'Serra Angel', power: '4', toughness: '4' }, controller: 'ai1', tapped: false },
      ];
      
      const context: AIDecisionContext = {
        gameState: testGameState,
        playerId: 'ai1',
        decisionType: AIDecisionType.DECLARE_ATTACKERS,
        options: [],
      };
      
      const decision = await aiEngine.makeDecision(context);
      
      // Aggressive AI should attack with all creatures
      expect(decision.action.attackers.length).toBe(2);
      expect(decision.confidence).toBeGreaterThan(0.8);
      expect(decision.reasoning).toContain('Aggressive');
    });
    
    it('should make defensive decisions', async () => {
      aiEngine.registerAI({
        playerId: 'ai1',
        strategy: AIStrategy.DEFENSIVE,
        thinkTime: 0,
      });
      
      testGameState.players[0].life = 10; // Low life
      testGameState.battlefield = [
        { id: 'creature1', name: 'Grizzly Bears', card: { type_line: 'Creature — Bear', name: 'Grizzly Bears' }, controller: 'ai1', tapped: false },
      ];
      
      const context: AIDecisionContext = {
        gameState: testGameState,
        playerId: 'ai1',
        decisionType: AIDecisionType.DECLARE_ATTACKERS,
        options: [],
      };
      
      const decision = await aiEngine.makeDecision(context);
      
      // Defensive AI with low life should not attack
      expect(decision.action.attackers.length).toBe(0);
      expect(decision.reasoning).toContain('Defensive');
    });
    
    it('should make random decisions', async () => {
      aiEngine.registerAI({
        playerId: 'ai1',
        strategy: AIStrategy.RANDOM,
        thinkTime: 0,
      });
      
      const context: AIDecisionContext = {
        gameState: testGameState,
        playerId: 'ai1',
        decisionType: AIDecisionType.PASS_PRIORITY,
        options: [],
      };
      
      const decision = await aiEngine.makeDecision(context);
      
      expect(decision.type).toBe(AIDecisionType.PASS_PRIORITY);
      expect(decision.reasoning).toContain('Random');
    });
  });
  
  describe('Decision History', () => {
    beforeEach(() => {
      aiEngine.registerAI({
        playerId: 'ai1',
        strategy: AIStrategy.BASIC,
        thinkTime: 0,
      });
    });
    
    it('should track decision history', async () => {
      const context: AIDecisionContext = {
        gameState: testGameState,
        playerId: 'ai1',
        decisionType: AIDecisionType.PASS_PRIORITY,
        options: [],
      };
      
      await aiEngine.makeDecision(context);
      await aiEngine.makeDecision(context);
      
      const history = aiEngine.getDecisionHistory('ai1');
      expect(history.length).toBe(2);
    });
    
    it('should clear decision history', async () => {
      const context: AIDecisionContext = {
        gameState: testGameState,
        playerId: 'ai1',
        decisionType: AIDecisionType.PASS_PRIORITY,
        options: [],
      };
      
      await aiEngine.makeDecision(context);
      
      aiEngine.clearHistory('ai1');
      
      const history = aiEngine.getDecisionHistory('ai1');
      expect(history.length).toBe(0);
    });
  });
  
  describe('New Decision Types', () => {
    beforeEach(() => {
      aiEngine.registerAI({
        playerId: 'ai1',
        strategy: AIStrategy.BASIC,
        thinkTime: 0,
      });
      
      testGameState.battlefield = [
        { 
          id: 'creature1', 
          name: 'Grizzly Bears', 
          controller: 'ai1',
          card: { 
            name: 'Grizzly Bears', 
            type_line: 'Creature - Bear', 
            power: '2', 
            toughness: '2' 
          },
          basePower: 2,
          baseToughness: 2,
          tapped: false,
          counters: {},
        },
        { 
          id: 'token1', 
          name: 'Treasure', 
          controller: 'ai1',
          card: { 
            name: 'Treasure', 
            type_line: 'Artifact - Treasure',
          },
          isToken: true,
          tapped: false,
          counters: {},
        },
      ];
    });
    
    it('should make sacrifice decisions prioritizing tokens', async () => {
      const context: AIDecisionContext = {
        gameState: testGameState,
        playerId: 'ai1',
        decisionType: AIDecisionType.SACRIFICE,
        options: [],
        constraints: { count: 1, type: 'permanent' },
      };
      
      const decision = await aiEngine.makeDecision(context);
      
      expect(decision.type).toBe(AIDecisionType.SACRIFICE);
      expect(decision.action.sacrificed).toBeDefined();
      expect(decision.action.sacrificed.length).toBe(1);
      // Should prefer sacrificing the token (lower value)
      expect(decision.action.sacrificed[0]).toBe('token1');
    });
    
    it('should make target selection decisions', async () => {
      const context: AIDecisionContext = {
        gameState: testGameState,
        playerId: 'ai1',
        decisionType: AIDecisionType.SELECT_TARGET,
        options: [testGameState.players[1]], // opponent
        constraints: { count: 1, type: 'player' },
      };
      
      const decision = await aiEngine.makeDecision(context);
      
      expect(decision.type).toBe(AIDecisionType.SELECT_TARGET);
      expect(decision.action.targets).toBeDefined();
      expect(decision.action.targets.length).toBe(1);
    });
    
    it('should make triggered ability decisions', async () => {
      const context: AIDecisionContext = {
        gameState: testGameState,
        playerId: 'ai1',
        decisionType: AIDecisionType.TRIGGERED_ABILITY,
        options: [],
        constraints: { optional: true, effect: 'draw a card' },
      };
      
      const decision = await aiEngine.makeDecision(context);
      
      expect(decision.type).toBe(AIDecisionType.TRIGGERED_ABILITY);
      expect(decision.action.accept).toBe(true); // Should accept draw effects
    });
    
    it('should decline harmful optional triggers', async () => {
      const context: AIDecisionContext = {
        gameState: testGameState,
        playerId: 'ai1',
        decisionType: AIDecisionType.TRIGGERED_ABILITY,
        options: [],
        constraints: { optional: true, effect: 'sacrifice a creature' },
      };
      
      const decision = await aiEngine.makeDecision(context);
      
      expect(decision.type).toBe(AIDecisionType.TRIGGERED_ABILITY);
      expect(decision.action.accept).toBe(false); // Should decline sacrifice effects
    });
    
    it('should make token creation decisions', async () => {
      const context: AIDecisionContext = {
        gameState: testGameState,
        playerId: 'ai1',
        decisionType: AIDecisionType.CREATE_TOKEN,
        options: ['1/1 Soldier', '2/2 Zombie'],
        constraints: { type: 'creature', count: 2 },
      };
      
      const decision = await aiEngine.makeDecision(context);
      
      expect(decision.type).toBe(AIDecisionType.CREATE_TOKEN);
      expect(decision.action.tokenType).toBeDefined();
      expect(decision.action.count).toBe(2);
    });
    
    it('should make discard decisions', async () => {
      testGameState.players[0].hand = [
        { id: 'land1', name: 'Forest', types: ['Land'] },
        { id: 'spell1', name: 'Lightning Bolt', types: ['Instant'], cmc: 1 },
        { id: 'creature1', name: 'Tarmogoyf', types: ['Creature'], cmc: 2 },
      ];
      
      const context: AIDecisionContext = {
        gameState: testGameState,
        playerId: 'ai1',
        decisionType: AIDecisionType.DISCARD,
        options: [],
        constraints: { count: 1 },
      };
      
      const decision = await aiEngine.makeDecision(context);
      
      expect(decision.type).toBe(AIDecisionType.DISCARD);
      expect(decision.action.discarded).toBeDefined();
      expect(decision.action.discarded.length).toBe(1);
      // Should discard land (lowest value in hand)
      expect(decision.action.discarded[0]).toBe('land1');
    });
    
    it('should make mode choice decisions', async () => {
      const context: AIDecisionContext = {
        gameState: testGameState,
        playerId: 'ai1',
        decisionType: AIDecisionType.CHOOSE_MODE,
        options: ['mode1', 'mode2', 'mode3'],
        constraints: { count: 2 },
      };
      
      const decision = await aiEngine.makeDecision(context);
      
      expect(decision.type).toBe(AIDecisionType.CHOOSE_MODE);
      expect(decision.action.modes).toBeDefined();
      expect(decision.action.modes.length).toBe(2);
    });
  });
});
