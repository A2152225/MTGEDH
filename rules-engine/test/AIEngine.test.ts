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
      players: [
        {
          id: 'ai1',
          name: 'AI Player 1',
          life: 40,
          hand: [
            { id: 'card1', name: 'Forest', types: ['Land'] },
            { id: 'card2', name: 'Mountain', types: ['Land'] },
            { id: 'card3', name: 'Lightning Bolt', types: ['Instant'] },
          ],
          library: [],
          graveyard: [],
          battlefield: [],
          exile: [],
          commandZone: [],
          counters: {},
          hasLost: false,
        },
        {
          id: 'ai2',
          name: 'AI Player 2',
          life: 40,
          hand: [],
          library: [],
          graveyard: [],
          battlefield: [],
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
      
      testGameState.players[0].battlefield = [
        { id: 'creature1', name: 'Grizzly Bears', types: ['Creature'], tapped: false },
        { id: 'creature2', name: 'Serra Angel', types: ['Creature'], tapped: false },
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
      testGameState.players[0].battlefield = [
        { id: 'creature1', name: 'Grizzly Bears', types: ['Creature'], tapped: true },
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
      
      testGameState.players[0].battlefield = [
        { id: 'creature1', name: 'Grizzly Bears', types: ['Creature'], tapped: false },
        { id: 'creature2', name: 'Serra Angel', types: ['Creature'], tapped: false },
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
      testGameState.players[0].battlefield = [
        { id: 'creature1', name: 'Grizzly Bears', types: ['Creature'], tapped: false },
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
});
