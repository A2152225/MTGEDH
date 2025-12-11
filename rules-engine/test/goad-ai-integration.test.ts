/**
 * goad-ai-integration.test.ts
 * 
 * Integration tests for goad mechanic with AI players
 * Tests that AI correctly handles goaded creatures in combat
 */

import { describe, it, expect } from 'vitest';
import { AIEngine, AIStrategy, type AIDecisionContext, AIDecisionType } from '../src/AIEngine';
import type { GameState, BattlefieldPermanent } from '../../shared/src/types';
import { GameStep } from '../../shared/src/types';

describe('Goad AI Integration', () => {
  describe('AI attack decisions with goaded creatures', () => {
    it('should force AI to attack with goaded creatures', async () => {
      const aiEngine = new AIEngine();
      aiEngine.registerAI({
        playerId: 'ai-player',
        strategy: AIStrategy.BASIC,
        difficulty: 0.8,
      });
      
      const battlefield: BattlefieldPermanent[] = [
        {
          id: 'goaded-creature',
          controller: 'ai-player',
          owner: 'ai-player',
          card: { 
            name: 'Goaded Bear', 
            type_line: 'Creature — Bear',
            power: '3',
            toughness: '3',
          },
          goadedBy: ['player2'],
          tapped: false,
        } as BattlefieldPermanent,
        {
          id: 'normal-creature',
          controller: 'ai-player',
          owner: 'ai-player',
          card: { 
            name: 'Normal Bear', 
            type_line: 'Creature — Bear',
            power: '2',
            toughness: '2',
          },
          tapped: false,
        } as BattlefieldPermanent,
      ];
      
      const gameState: GameState = {
        turn: 5,
        step: GameStep.DECLARE_ATTACKERS,
        activePlayerIndex: 0,
        battlefield,
        players: [
          { id: 'ai-player', life: 40, battlefield } as any,
          { id: 'player2', life: 40, battlefield: [] } as any,
          { id: 'player3', life: 40, battlefield: [] } as any,
        ],
      } as GameState;
      
      const context: AIDecisionContext = {
        gameState,
        playerId: 'ai-player',
        decisionType: AIDecisionType.DECLARE_ATTACKERS,
        options: [],
      };
      
      const decision = await aiEngine.makeDecision(context);
      
      expect(decision.type).toBe(AIDecisionType.DECLARE_ATTACKERS);
      expect(decision.action.attackers).toBeDefined();
      
      // Check that goaded creature is attacking
      const attackingCreatureIds = decision.action.attackers.map((a: any) => a.creatureId);
      expect(attackingCreatureIds).toContain('goaded-creature');
      
      // Check that goaded creature is NOT attacking the goader
      const goadedAttack = decision.action.attackers.find((a: any) => a.creatureId === 'goaded-creature');
      expect(goadedAttack).toBeDefined();
      expect(goadedAttack.defendingPlayerId).not.toBe('player2'); // Should not attack goader
      expect(['player3'].includes(goadedAttack.defendingPlayerId)).toBe(true); // Should attack other player
    });
    
    it('should allow AI to attack goader when only option', async () => {
      const aiEngine = new AIEngine();
      aiEngine.registerAI({
        playerId: 'ai-player',
        strategy: AIStrategy.BASIC,
        difficulty: 0.8,
      });
      
      const battlefield: BattlefieldPermanent[] = [
        {
          id: 'goaded-creature',
          controller: 'ai-player',
          owner: 'ai-player',
          card: { 
            name: 'Goaded Bear', 
            type_line: 'Creature — Bear',
            power: '3',
            toughness: '3',
          },
          goadedBy: ['player2'],
          tapped: false,
        } as BattlefieldPermanent,
      ];
      
      // Only two players: AI and the goader
      const gameState: GameState = {
        turn: 5,
        step: GameStep.DECLARE_ATTACKERS,
        activePlayerIndex: 0,
        battlefield,
        players: [
          { id: 'ai-player', life: 40, battlefield } as any,
          { id: 'player2', life: 40, battlefield: [] } as any,
        ],
      } as GameState;
      
      const context: AIDecisionContext = {
        gameState,
        playerId: 'ai-player',
        decisionType: AIDecisionType.DECLARE_ATTACKERS,
        options: [],
      };
      
      const decision = await aiEngine.makeDecision(context);
      
      expect(decision.type).toBe(AIDecisionType.DECLARE_ATTACKERS);
      expect(decision.action.attackers).toBeDefined();
      
      // Check that goaded creature is attacking
      const attackingCreatureIds = decision.action.attackers.map((a: any) => a.creatureId);
      expect(attackingCreatureIds).toContain('goaded-creature');
      
      // Check that goaded creature IS attacking the goader (only option)
      const goadedAttack = decision.action.attackers.find((a: any) => a.creatureId === 'goaded-creature');
      expect(goadedAttack).toBeDefined();
      expect(goadedAttack.defendingPlayerId).toBe('player2'); // Must attack goader as only option
    });
    
    it('should handle multiple goaded creatures correctly', async () => {
      const aiEngine = new AIEngine();
      aiEngine.registerAI({
        playerId: 'ai-player',
        strategy: AIStrategy.BASIC,
        difficulty: 0.8,
      });
      
      const battlefield: BattlefieldPermanent[] = [
        {
          id: 'goaded-creature-1',
          controller: 'ai-player',
          owner: 'ai-player',
          card: { 
            name: 'Goaded Bear 1', 
            type_line: 'Creature — Bear',
            power: '3',
            toughness: '3',
          },
          goadedBy: ['player2'],
          tapped: false,
        } as BattlefieldPermanent,
        {
          id: 'goaded-creature-2',
          controller: 'ai-player',
          owner: 'ai-player',
          card: { 
            name: 'Goaded Bear 2', 
            type_line: 'Creature — Bear',
            power: '2',
            toughness: '2',
          },
          goadedBy: ['player3'],
          tapped: false,
        } as BattlefieldPermanent,
        {
          id: 'normal-creature',
          controller: 'ai-player',
          owner: 'ai-player',
          card: { 
            name: 'Normal Bear', 
            type_line: 'Creature — Bear',
            power: '2',
            toughness: '2',
          },
          tapped: false,
        } as BattlefieldPermanent,
      ];
      
      const gameState: GameState = {
        turn: 5,
        step: GameStep.DECLARE_ATTACKERS,
        activePlayerIndex: 0,
        battlefield,
        players: [
          { id: 'ai-player', life: 40, battlefield } as any,
          { id: 'player2', life: 40, battlefield: [] } as any,
          { id: 'player3', life: 40, battlefield: [] } as any,
          { id: 'player4', life: 40, battlefield: [] } as any,
        ],
      } as GameState;
      
      const context: AIDecisionContext = {
        gameState,
        playerId: 'ai-player',
        decisionType: AIDecisionType.DECLARE_ATTACKERS,
        options: [],
      };
      
      const decision = await aiEngine.makeDecision(context);
      
      expect(decision.type).toBe(AIDecisionType.DECLARE_ATTACKERS);
      expect(decision.action.attackers).toBeDefined();
      
      const attackingCreatureIds = decision.action.attackers.map((a: any) => a.creatureId);
      
      // Both goaded creatures must attack
      expect(attackingCreatureIds).toContain('goaded-creature-1');
      expect(attackingCreatureIds).toContain('goaded-creature-2');
      
      // Check valid targets
      const goaded1Attack = decision.action.attackers.find((a: any) => a.creatureId === 'goaded-creature-1');
      const goaded2Attack = decision.action.attackers.find((a: any) => a.creatureId === 'goaded-creature-2');
      
      expect(goaded1Attack.defendingPlayerId).not.toBe('player2'); // Can't attack goader
      expect(goaded2Attack.defendingPlayerId).not.toBe('player3'); // Can't attack goader
      
      // Both should attack valid targets
      expect(['player3', 'player4'].includes(goaded1Attack.defendingPlayerId)).toBe(true);
      expect(['player2', 'player4'].includes(goaded2Attack.defendingPlayerId)).toBe(true);
    });
    
    it('should not attack with tapped goaded creature', async () => {
      const aiEngine = new AIEngine();
      aiEngine.registerAI({
        playerId: 'ai-player',
        strategy: AIStrategy.BASIC,
        difficulty: 0.8,
      });
      
      const battlefield: BattlefieldPermanent[] = [
        {
          id: 'tapped-goaded',
          controller: 'ai-player',
          owner: 'ai-player',
          card: { 
            name: 'Tapped Goaded Bear', 
            type_line: 'Creature — Bear',
            power: '3',
            toughness: '3',
          },
          goadedBy: ['player2'],
          tapped: true, // Can't attack because tapped
        } as BattlefieldPermanent,
        {
          id: 'untapped-goaded',
          controller: 'ai-player',
          owner: 'ai-player',
          card: { 
            name: 'Untapped Goaded Bear', 
            type_line: 'Creature — Bear',
            power: '2',
            toughness: '2',
          },
          goadedBy: ['player2'],
          tapped: false,
        } as BattlefieldPermanent,
      ];
      
      const gameState: GameState = {
        turn: 5,
        step: GameStep.DECLARE_ATTACKERS,
        activePlayerIndex: 0,
        battlefield,
        players: [
          { id: 'ai-player', life: 40, battlefield } as any,
          { id: 'player2', life: 40, battlefield: [] } as any,
          { id: 'player3', life: 40, battlefield: [] } as any,
        ],
      } as GameState;
      
      const context: AIDecisionContext = {
        gameState,
        playerId: 'ai-player',
        decisionType: AIDecisionType.DECLARE_ATTACKERS,
        options: [],
      };
      
      const decision = await aiEngine.makeDecision(context);
      
      const attackingCreatureIds = decision.action.attackers.map((a: any) => a.creatureId);
      
      // Tapped creature should not attack
      expect(attackingCreatureIds).not.toContain('tapped-goaded');
      
      // Untapped goaded creature must attack
      expect(attackingCreatureIds).toContain('untapped-goaded');
    });
  });
});
