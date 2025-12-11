/**
 * goad.test.ts
 * 
 * Tests for goad mechanic (Rule 701.15)
 * - Goaded creatures must attack if able
 * - Goaded creatures cannot attack the goading player (unless only option)
 * - Proper integration with combat system
 * - AI correctly handles goaded creatures
 */

import { describe, it, expect } from 'vitest';
import type { GameState, BattlefieldPermanent, PlayerID } from '../../shared/src/types';
import { GameStep } from '../../shared/src/types';
import {
  isGoaded,
  getGoadedBy,
  getGoadedAttackTargets,
  canGoadedCreatureAttack,
  getGoadedAttackers,
  validateDeclareAttackers,
  type DeclareAttackersAction,
} from '../src/actions/combat';

describe('Rule 701.15: Goad Mechanic', () => {
  describe('isGoaded', () => {
    it('should return false for non-goaded creature', () => {
      const creature = {
        id: 'creature1',
        controller: 'player1',
        owner: 'player1',
        card: { name: 'Test Creature' },
      } as BattlefieldPermanent;
      
      expect(isGoaded(creature)).toBe(false);
    });
    
    it('should return true for goaded creature', () => {
      const creature = {
        id: 'creature1',
        controller: 'player1',
        owner: 'player1',
        card: { name: 'Test Creature' },
        goadedBy: ['player2'],
      } as BattlefieldPermanent;
      
      expect(isGoaded(creature)).toBe(true);
    });
    
    it('should return true for multiply-goaded creature', () => {
      const creature = {
        id: 'creature1',
        controller: 'player1',
        owner: 'player1',
        card: { name: 'Test Creature' },
        goadedBy: ['player2', 'player3'],
      } as BattlefieldPermanent;
      
      expect(isGoaded(creature)).toBe(true);
    });
    
    it('should handle expiration correctly', () => {
      const creature = {
        id: 'creature1',
        controller: 'player1',
        owner: 'player1',
        card: { name: 'Test Creature' },
        goadedBy: ['player2'],
        goadedUntil: { player2: 5 },
      } as BattlefieldPermanent;
      
      expect(isGoaded(creature, 3)).toBe(true); // Before expiration
      expect(isGoaded(creature, 5)).toBe(false); // At expiration
      expect(isGoaded(creature, 6)).toBe(false); // After expiration
    });
  });
  
  describe('getGoadedBy', () => {
    it('should return empty array for non-goaded creature', () => {
      const creature = {
        id: 'creature1',
        controller: 'player1',
        owner: 'player1',
        card: { name: 'Test Creature' },
      } as BattlefieldPermanent;
      
      expect(getGoadedBy(creature)).toEqual([]);
    });
    
    it('should return all goaders', () => {
      const creature = {
        id: 'creature1',
        controller: 'player1',
        owner: 'player1',
        card: { name: 'Test Creature' },
        goadedBy: ['player2', 'player3'],
      } as BattlefieldPermanent;
      
      const goaders = getGoadedBy(creature);
      expect(goaders).toContain('player2');
      expect(goaders).toContain('player3');
      expect(goaders).toHaveLength(2);
    });
    
    it('should filter expired goad effects', () => {
      const creature = {
        id: 'creature1',
        controller: 'player1',
        owner: 'player1',
        card: { name: 'Test Creature' },
        goadedBy: ['player2', 'player3'],
        goadedUntil: { player2: 5, player3: 8 },
      } as BattlefieldPermanent;
      
      const goaders = getGoadedBy(creature, 6);
      expect(goaders).toContain('player3'); // Still active
      expect(goaders).not.toContain('player2'); // Expired
      expect(goaders).toHaveLength(1);
    });
  });
  
  describe('getGoadedAttackTargets', () => {
    it('should exclude goaders from valid targets', () => {
      const creature = {
        id: 'creature1',
        controller: 'player1',
        owner: 'player1',
        card: { name: 'Test Creature' },
        goadedBy: ['player2'],
      } as BattlefieldPermanent;
      
      const allPlayers = ['player1', 'player2', 'player3', 'player4'];
      const targets = getGoadedAttackTargets(creature, allPlayers);
      
      expect(targets).toContain('player3');
      expect(targets).toContain('player4');
      expect(targets).not.toContain('player1'); // Controller
      expect(targets).not.toContain('player2'); // Goader
    });
    
    it('should allow attacking goader if only option (Rule 701.15b)', () => {
      const creature = {
        id: 'creature1',
        controller: 'player1',
        owner: 'player1',
        card: { name: 'Test Creature' },
        goadedBy: ['player2'],
      } as BattlefieldPermanent;
      
      // Only the goader and controller in the game
      const allPlayers = ['player1', 'player2'];
      const targets = getGoadedAttackTargets(creature, allPlayers);
      
      expect(targets).toContain('player2'); // Can attack goader as only option
      expect(targets).not.toContain('player1'); // Controller
    });
    
    it('should handle multiple goaders correctly', () => {
      const creature = {
        id: 'creature1',
        controller: 'player1',
        owner: 'player1',
        card: { name: 'Test Creature' },
        goadedBy: ['player2', 'player3'],
      } as BattlefieldPermanent;
      
      const allPlayers = ['player1', 'player2', 'player3', 'player4'];
      const targets = getGoadedAttackTargets(creature, allPlayers);
      
      expect(targets).toContain('player4'); // Only non-goader opponent
      expect(targets).not.toContain('player2'); // Goader
      expect(targets).not.toContain('player3'); // Goader
    });
    
    it('should allow attacking any goader if they are all options', () => {
      const creature = {
        id: 'creature1',
        controller: 'player1',
        owner: 'player1',
        card: { name: 'Test Creature' },
        goadedBy: ['player2', 'player3'],
      } as BattlefieldPermanent;
      
      // Only goaders and controller
      const allPlayers = ['player1', 'player2', 'player3'];
      const targets = getGoadedAttackTargets(creature, allPlayers);
      
      expect(targets).toContain('player2');
      expect(targets).toContain('player3');
      expect(targets).toHaveLength(2);
    });
  });
  
  describe('canGoadedCreatureAttack', () => {
    it('should allow attacking non-goader opponents', () => {
      const creature = {
        id: 'creature1',
        controller: 'player1',
        owner: 'player1',
        card: { name: 'Test Creature' },
        goadedBy: ['player2'],
      } as BattlefieldPermanent;
      
      const allPlayers = ['player1', 'player2', 'player3'];
      const result = canGoadedCreatureAttack(creature, 'player3', allPlayers);
      
      expect(result.canAttack).toBe(true);
    });
    
    it('should prevent attacking goader when other options exist', () => {
      const creature = {
        id: 'creature1',
        controller: 'player1',
        owner: 'player1',
        card: { name: 'Test Creature' },
        goadedBy: ['player2'],
      } as BattlefieldPermanent;
      
      const allPlayers = ['player1', 'player2', 'player3'];
      const result = canGoadedCreatureAttack(creature, 'player2', allPlayers);
      
      expect(result.canAttack).toBe(false);
      expect(result.reason).toContain('goaded');
    });
    
    it('should allow attacking goader when only option', () => {
      const creature = {
        id: 'creature1',
        controller: 'player1',
        owner: 'player1',
        card: { name: 'Test Creature' },
        goadedBy: ['player2'],
      } as BattlefieldPermanent;
      
      const allPlayers = ['player1', 'player2'];
      const result = canGoadedCreatureAttack(creature, 'player2', allPlayers);
      
      expect(result.canAttack).toBe(true);
    });
  });
  
  describe('getGoadedAttackers', () => {
    it('should return goaded creatures that can attack', () => {
      const battlefield: BattlefieldPermanent[] = [
        {
          id: 'creature1',
          controller: 'player1',
          owner: 'player1',
          card: { name: 'Goaded Creature', type_line: 'Creature' },
          goadedBy: ['player2'],
          tapped: false,
        } as BattlefieldPermanent,
        {
          id: 'creature2',
          controller: 'player1',
          owner: 'player1',
          card: { name: 'Normal Creature', type_line: 'Creature' },
          tapped: false,
        } as BattlefieldPermanent,
        {
          id: 'creature3',
          controller: 'player1',
          owner: 'player1',
          card: { name: 'Tapped Goaded Creature', type_line: 'Creature' },
          goadedBy: ['player2'],
          tapped: true,
        } as BattlefieldPermanent,
      ];
      
      const state: GameState = {
        turn: 5,
        battlefield,
        players: [
          { id: 'player1', life: 40, battlefield: [] } as any,
          { id: 'player2', life: 40, battlefield: [] } as any,
        ],
      } as GameState;
      
      const goadedAttackers = getGoadedAttackers(state, 'player1');
      
      expect(goadedAttackers).toContain('creature1'); // Goaded and can attack
      expect(goadedAttackers).not.toContain('creature2'); // Not goaded
      expect(goadedAttackers).not.toContain('creature3'); // Goaded but tapped
    });
  });
  
  describe('validateDeclareAttackers with goad', () => {
    it('should require goaded creatures to attack', () => {
      const battlefield: BattlefieldPermanent[] = [
        {
          id: 'creature1',
          controller: 'player1',
          owner: 'player1',
          card: { name: 'Goaded Creature', type_line: 'Creature' },
          goadedBy: ['player2'],
          tapped: false,
        } as BattlefieldPermanent,
      ];
      
      const state: GameState = {
        turn: 5,
        step: GameStep.DECLARE_ATTACKERS,
        activePlayerIndex: 0,
        battlefield,
        players: [
          { id: 'player1', life: 40, battlefield: [] } as any,
          { id: 'player2', life: 40, battlefield: [] } as any,
          { id: 'player3', life: 40, battlefield: [] } as any,
        ],
      } as GameState;
      
      // Declare attackers without the goaded creature
      const action: DeclareAttackersAction = {
        type: 'declareAttackers',
        playerId: 'player1',
        attackers: [], // Not attacking with goaded creature
      };
      
      const result = validateDeclareAttackers(state, action);
      
      expect(result.legal).toBe(false);
      expect(result.reason).toContain('goaded');
      expect(result.reason).toContain('must attack');
    });
    
    it('should accept attack with goaded creature', () => {
      const battlefield: BattlefieldPermanent[] = [
        {
          id: 'creature1',
          controller: 'player1',
          owner: 'player1',
          card: { name: 'Goaded Creature', type_line: 'Creature' },
          goadedBy: ['player2'],
          tapped: false,
        } as BattlefieldPermanent,
      ];
      
      const state: GameState = {
        turn: 5,
        step: GameStep.DECLARE_ATTACKERS,
        activePlayerIndex: 0,
        battlefield,
        players: [
          { id: 'player1', life: 40, battlefield: [] } as any,
          { id: 'player2', life: 40, battlefield: [] } as any,
          { id: 'player3', life: 40, battlefield: [] } as any,
        ],
      } as GameState;
      
      // Declare attackers with goaded creature attacking valid target
      const action: DeclareAttackersAction = {
        type: 'declareAttackers',
        playerId: 'player1',
        attackers: [
          { creatureId: 'creature1', defendingPlayerId: 'player3' },
        ],
      };
      
      const result = validateDeclareAttackers(state, action);
      
      expect(result.legal).toBe(true);
    });
    
    it('should reject goaded creature attacking goader', () => {
      const battlefield: BattlefieldPermanent[] = [
        {
          id: 'creature1',
          controller: 'player1',
          owner: 'player1',
          card: { name: 'Goaded Creature', type_line: 'Creature' },
          goadedBy: ['player2'],
          tapped: false,
        } as BattlefieldPermanent,
      ];
      
      const state: GameState = {
        turn: 5,
        step: GameStep.DECLARE_ATTACKERS,
        activePlayerIndex: 0,
        battlefield,
        players: [
          { id: 'player1', life: 40, battlefield: [] } as any,
          { id: 'player2', life: 40, battlefield: [] } as any,
          { id: 'player3', life: 40, battlefield: [] } as any,
        ],
      } as GameState;
      
      // Try to attack the goader
      const action: DeclareAttackersAction = {
        type: 'declareAttackers',
        playerId: 'player1',
        attackers: [
          { creatureId: 'creature1', defendingPlayerId: 'player2' },
        ],
      };
      
      const result = validateDeclareAttackers(state, action);
      
      expect(result.legal).toBe(false);
      expect(result.reason).toContain('goaded');
      expect(result.reason).toContain('cannot attack');
    });
    
    it('should allow goaded creature attacking goader when only option', () => {
      const battlefield: BattlefieldPermanent[] = [
        {
          id: 'creature1',
          controller: 'player1',
          owner: 'player1',
          card: { name: 'Goaded Creature', type_line: 'Creature' },
          goadedBy: ['player2'],
          tapped: false,
        } as BattlefieldPermanent,
      ];
      
      const state: GameState = {
        turn: 5,
        step: GameStep.DECLARE_ATTACKERS,
        activePlayerIndex: 0,
        battlefield,
        players: [
          { id: 'player1', life: 40, battlefield: [] } as any,
          { id: 'player2', life: 40, battlefield: [] } as any,
        ],
      } as GameState;
      
      // Attack goader as only option
      const action: DeclareAttackersAction = {
        type: 'declareAttackers',
        playerId: 'player1',
        attackers: [
          { creatureId: 'creature1', defendingPlayerId: 'player2' },
        ],
      };
      
      const result = validateDeclareAttackers(state, action);
      
      expect(result.legal).toBe(true);
    });
  });
});
