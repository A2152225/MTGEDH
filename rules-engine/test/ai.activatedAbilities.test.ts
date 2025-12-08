/**
 * Tests for AI activated ability decision-making
 * Validates that the AI properly detects, evaluates, and uses activated abilities
 */

import { describe, it, expect } from 'vitest';
import { AIEngine, AIStrategy, AIDecisionType, type AIDecisionContext } from '../src/AIEngine';
import type { GameState, BattlefieldPermanent, PlayerID } from '../../shared/src/types';

describe('AI Activated Abilities', () => {
  const aiEngine = new AIEngine();
  const playerId: PlayerID = 'player1';
  const opponentId: PlayerID = 'player2';
  
  // Register AI player
  aiEngine.registerAI({
    playerId,
    strategy: AIStrategy.BASIC,
    difficulty: 0.5,
  });
  
  describe('Activated Ability Detection', () => {
    it('should detect Humble Defector tap ability', async () => {
      const humbleDefector: BattlefieldPermanent = {
        id: 'perm1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          name: 'Humble Defector',
          type_line: 'Creature — Human Rogue',
          oracle_text: '{T}: Draw two cards. Target opponent gains control of Humble Defector. Activate only during your turn.',
          power: '2',
          toughness: '1',
          mana_cost: '{1}{R}',
        },
      };
      
      const gameState: Partial<GameState> = {
        phase: 'MAIN',
        turnPlayer: playerId,
        priority: playerId,
        battlefield: [humbleDefector],
        stack: [],
        players: [
          { id: playerId, name: 'AI', life: 40, hand: [], battlefield: [] } as any,
          { id: opponentId, name: 'Opponent', life: 40, hand: [], battlefield: [] } as any,
        ],
      };
      
      const context: AIDecisionContext = {
        gameState: gameState as GameState,
        playerId,
        decisionType: AIDecisionType.ACTIVATE_ABILITY,
        options: [],
      };
      
      const decision = await aiEngine.makeDecision(context);
      
      // AI should want to activate this ability (draw cards is valuable!)
      expect(decision).toBeDefined();
      expect(decision.type).toBe(AIDecisionType.ACTIVATE_ABILITY);
      expect(decision.action?.activate).toBe(true);
      expect(decision.action?.cardName).toBe('Humble Defector');
    });
    
    it('should not activate tapped permanents', async () => {
      const tappedDefector: BattlefieldPermanent = {
        id: 'perm1',
        controller: playerId,
        owner: playerId,
        tapped: true, // Already tapped!
        summoningSickness: false,
        counters: {},
        card: {
          name: 'Humble Defector',
          type_line: 'Creature — Human Rogue',
          oracle_text: '{T}: Draw two cards. Target opponent gains control of Humble Defector.',
          power: '2',
          toughness: '1',
        },
      };
      
      const gameState: Partial<GameState> = {
        phase: 'MAIN',
        turnPlayer: playerId,
        priority: playerId,
        battlefield: [tappedDefector],
        stack: [],
        players: [
          { id: playerId, name: 'AI', life: 40, hand: [], battlefield: [] } as any,
          { id: opponentId, name: 'Opponent', life: 40, hand: [], battlefield: [] } as any,
        ],
      };
      
      const context: AIDecisionContext = {
        gameState: gameState as GameState,
        playerId,
        decisionType: AIDecisionType.ACTIVATE_ABILITY,
        options: [],
      };
      
      const decision = await aiEngine.makeDecision(context);
      
      // AI should not activate (permanent is tapped)
      expect(decision.action?.activate).toBe(false);
    });
    
    it('should not activate abilities on creatures with summoning sickness', async () => {
      const sickDefector: BattlefieldPermanent = {
        id: 'perm1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: true, // Just entered battlefield
        counters: {},
        card: {
          name: 'Humble Defector',
          type_line: 'Creature — Human Rogue',
          oracle_text: '{T}: Draw two cards. Target opponent gains control of Humble Defector.',
          power: '2',
          toughness: '1',
        },
      };
      
      const gameState: Partial<GameState> = {
        phase: 'MAIN',
        turnPlayer: playerId,
        priority: playerId,
        battlefield: [sickDefector],
        stack: [],
        players: [
          { id: playerId, name: 'AI', life: 40, hand: [], battlefield: [] } as any,
          { id: opponentId, name: 'Opponent', life: 40, hand: [], battlefield: [] } as any,
        ],
      };
      
      const context: AIDecisionContext = {
        gameState: gameState as GameState,
        playerId,
        decisionType: AIDecisionType.ACTIVATE_ABILITY,
        options: [],
      };
      
      const decision = await aiEngine.makeDecision(context);
      
      // AI should not activate (has summoning sickness)
      expect(decision.action?.activate).toBe(false);
    });
  });
  
  describe('Activated Ability Evaluation', () => {
    it('should highly value card draw abilities', async () => {
      const cardDrawer: BattlefieldPermanent = {
        id: 'perm1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          name: 'Archmage Emeritus',
          type_line: 'Creature — Human Wizard',
          oracle_text: '{T}: Draw two cards.',
          power: '2',
          toughness: '2',
        },
      };
      
      const makerRock: BattlefieldPermanent = {
        id: 'perm2',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          name: 'Mana Rock',
          type_line: 'Artifact',
          oracle_text: '{T}: Add {C}.',
        },
      };
      
      const gameState: Partial<GameState> = {
        phase: 'MAIN',
        turnPlayer: playerId,
        priority: playerId,
        battlefield: [cardDrawer, makerRock],
        stack: [],
        players: [
          { id: playerId, name: 'AI', life: 40, hand: [], battlefield: [] } as any,
          { id: opponentId, name: 'Opponent', life: 40, hand: [], battlefield: [] } as any,
        ],
      };
      
      const context: AIDecisionContext = {
        gameState: gameState as GameState,
        playerId,
        decisionType: AIDecisionType.ACTIVATE_ABILITY,
        options: [],
      };
      
      const decision = await aiEngine.makeDecision(context);
      
      // AI should prefer card draw over mana generation
      expect(decision.action?.activate).toBe(true);
      expect(decision.action?.cardName).toBe('Archmage Emeritus');
    });
    
    it('should value tutoring abilities', async () => {
      const tutor: BattlefieldPermanent = {
        id: 'perm1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          name: 'Expedition Map',
          type_line: 'Artifact',
          oracle_text: '{2}, {T}, Sacrifice Expedition Map: Search your library for a land card, reveal it, put it into your hand, then shuffle.',
        },
      };
      
      const gameState: Partial<GameState> = {
        phase: 'MAIN',
        turnPlayer: playerId,
        priority: playerId,
        battlefield: [tutor],
        stack: [],
        players: [
          { id: playerId, name: 'AI', life: 40, hand: [], battlefield: [] } as any,
          { id: opponentId, name: 'Opponent', life: 40, hand: [], battlefield: [] } as any,
        ],
      };
      
      const context: AIDecisionContext = {
        gameState: gameState as GameState,
        playerId,
        decisionType: AIDecisionType.ACTIVATE_ABILITY,
        options: [],
      };
      
      const decision = await aiEngine.makeDecision(context);
      
      // AI should value tutoring abilities
      expect(decision.action?.activate).toBe(true);
      expect(decision.action?.cardName).toBe('Expedition Map');
    });
  });
  
  describe('Sorcery Speed Restrictions', () => {
    it('should not activate sorcery-speed abilities during opponent turn', async () => {
      const defector: BattlefieldPermanent = {
        id: 'perm1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          name: 'Humble Defector',
          type_line: 'Creature — Human Rogue',
          oracle_text: '{T}: Draw two cards. Target opponent gains control of Humble Defector. Activate only as a sorcery.',
          power: '2',
          toughness: '1',
        },
      };
      
      const gameState: Partial<GameState> = {
        phase: 'MAIN',
        turnPlayer: opponentId, // Opponent's turn!
        priority: playerId,
        battlefield: [defector],
        stack: [],
        players: [
          { id: playerId, name: 'AI', life: 40, hand: [], battlefield: [] } as any,
          { id: opponentId, name: 'Opponent', life: 40, hand: [], battlefield: [] } as any,
        ],
      };
      
      const context: AIDecisionContext = {
        gameState: gameState as GameState,
        playerId,
        decisionType: AIDecisionType.ACTIVATE_ABILITY,
        options: [],
      };
      
      const decision = await aiEngine.makeDecision(context);
      
      // AI should not activate (not AI's turn, sorcery speed restriction)
      expect(decision.action?.activate).toBe(false);
    });
    
    it('should not activate sorcery-speed abilities with stack not empty', async () => {
      const defector: BattlefieldPermanent = {
        id: 'perm1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        card: {
          name: 'Humble Defector',
          type_line: 'Creature — Human Rogue',
          oracle_text: '{T}: Draw two cards. Target opponent gains control of Humble Defector. Activate only as a sorcery.',
          power: '2',
          toughness: '1',
        },
      };
      
      const gameState: Partial<GameState> = {
        phase: 'MAIN',
        turnPlayer: playerId,
        priority: playerId,
        battlefield: [defector],
        stack: [{ id: 'spell1', type: 'spell' } as any], // Stack not empty!
        players: [
          { id: playerId, name: 'AI', life: 40, hand: [], battlefield: [] } as any,
          { id: opponentId, name: 'Opponent', life: 40, hand: [], battlefield: [] } as any,
        ],
      };
      
      const context: AIDecisionContext = {
        gameState: gameState as GameState,
        playerId,
        decisionType: AIDecisionType.ACTIVATE_ABILITY,
        options: [],
      };
      
      const decision = await aiEngine.makeDecision(context);
      
      // AI should not activate (stack not empty, sorcery speed restriction)
      expect(decision.action?.activate).toBe(false);
    });
  });
});
