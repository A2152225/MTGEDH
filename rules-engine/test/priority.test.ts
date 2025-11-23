/**
 * Tests for Rule 117: Timing and Priority
 */
import { describe, it, expect } from 'vitest';
import {
  SpellTiming,
  CastingConstraints,
  canCastInstant,
  canCastSorcery,
  canActivateAbility,
  getNextPlayerInTurnOrder,
  allPlayersPassedInSuccession,
  passPriority,
  grantPriorityAfterAction,
  PrioritySystem
} from '../src/types/priority';

describe('Rule 117: Timing and Priority', () => {
  describe('Rule 117.1a - Instant vs sorcery timing', () => {
    it('should allow casting instant with priority only', () => {
      const withPriority: CastingConstraints = {
        hasPriority: true,
        isMainPhase: false,
        isOwnTurn: false,
        isStackEmpty: false
      };

      expect(canCastInstant(withPriority)).toBe(true);
    });

    it('should not allow casting instant without priority', () => {
      const withoutPriority: CastingConstraints = {
        hasPriority: false,
        isMainPhase: true,
        isOwnTurn: true,
        isStackEmpty: true
      };

      expect(canCastInstant(withoutPriority)).toBe(false);
    });

    it('should allow casting sorcery only during own main phase with empty stack', () => {
      const sorceryTiming: CastingConstraints = {
        hasPriority: true,
        isMainPhase: true,
        isOwnTurn: true,
        isStackEmpty: true
      };

      expect(canCastSorcery(sorceryTiming)).toBe(true);
    });

    it('should not allow casting sorcery when stack is not empty', () => {
      const notEmptyStack: CastingConstraints = {
        hasPriority: true,
        isMainPhase: true,
        isOwnTurn: true,
        isStackEmpty: false
      };

      expect(canCastSorcery(notEmptyStack)).toBe(false);
    });

    it('should not allow casting sorcery on opponent\'s turn', () => {
      const opponentTurn: CastingConstraints = {
        hasPriority: true,
        isMainPhase: true,
        isOwnTurn: false,
        isStackEmpty: true
      };

      expect(canCastSorcery(opponentTurn)).toBe(false);
    });

    it('should not allow casting sorcery outside main phase', () => {
      const notMainPhase: CastingConstraints = {
        hasPriority: true,
        isMainPhase: false,
        isOwnTurn: true,
        isStackEmpty: true
      };

      expect(canCastSorcery(notMainPhase)).toBe(false);
    });
  });

  describe('Rule 117.1b - Activated abilities', () => {
    it('should allow activating with priority', () => {
      const constraints: CastingConstraints = {
        hasPriority: true,
        isMainPhase: false,
        isOwnTurn: false,
        isStackEmpty: false
      };

      expect(canActivateAbility(constraints)).toBe(true);
    });

    it('should not allow without priority', () => {
      const constraints: CastingConstraints = {
        hasPriority: false,
        isMainPhase: true,
        isOwnTurn: true,
        isStackEmpty: true
      };

      expect(canActivateAbility(constraints)).toBe(false);
    });
  });

  describe('Rule 117.3d - Priority passing', () => {
    it('should pass to next player in turn order', () => {
      const turnOrder = ['player-1', 'player-2', 'player-3'];
      
      expect(getNextPlayerInTurnOrder('player-1', turnOrder)).toBe('player-2');
      expect(getNextPlayerInTurnOrder('player-2', turnOrder)).toBe('player-3');
      expect(getNextPlayerInTurnOrder('player-3', turnOrder)).toBe('player-1');
    });

    it('should throw error if player not in turn order', () => {
      const turnOrder = ['player-1', 'player-2'];
      
      expect(() => getNextPlayerInTurnOrder('player-3', turnOrder)).toThrow();
    });
  });

  describe('Rule 117.4 - All players pass in succession', () => {
    it('should detect when all players have passed', () => {
      const passedMap = new Map<string, boolean>();
      passedMap.set('player-1', true);
      passedMap.set('player-2', true);
      passedMap.set('player-3', true);
      
      const turnOrder = ['player-1', 'player-2', 'player-3'];
      
      expect(allPlayersPassedInSuccession(passedMap, turnOrder)).toBe(true);
    });

    it('should detect when not all players have passed', () => {
      const passedMap = new Map<string, boolean>();
      passedMap.set('player-1', true);
      passedMap.set('player-2', false);
      passedMap.set('player-3', true);
      
      const turnOrder = ['player-1', 'player-2', 'player-3'];
      
      expect(allPlayersPassedInSuccession(passedMap, turnOrder)).toBe(false);
    });
  });

  describe('Priority system operations', () => {
    it('should pass priority correctly', () => {
      const system: PrioritySystem = {
        currentPriorityPlayer: 'player-1',
        turnOrder: ['player-1', 'player-2', 'player-3'],
        activePlayer: 'player-1',
        passedInSuccession: new Map(),
        stackIsEmpty: false
      };

      const newSystem = passPriority(system);
      
      expect(newSystem.currentPriorityPlayer).toBe('player-2');
      expect(newSystem.passedInSuccession.get('player-1')).toBe(true);
    });

    it('should reset passes after action', () => {
      const passedMap = new Map<string, boolean>();
      passedMap.set('player-1', true);
      passedMap.set('player-2', true);
      
      const system: PrioritySystem = {
        currentPriorityPlayer: 'player-2',
        turnOrder: ['player-1', 'player-2', 'player-3'],
        activePlayer: 'player-1',
        passedInSuccession: passedMap,
        stackIsEmpty: false
      };

      const newSystem = grantPriorityAfterAction(system, 'player-2');
      
      expect(newSystem.currentPriorityPlayer).toBe('player-2');
      expect(newSystem.passedInSuccession.size).toBe(0); // Reset
    });
  });

  describe('Spell timing enums', () => {
    it('should define timing types', () => {
      expect(SpellTiming.INSTANT).toBe('instant');
      expect(SpellTiming.SORCERY).toBe('sorcery');
    });
  });
});
