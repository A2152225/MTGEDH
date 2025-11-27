/**
 * Tests for player counters module
 */
import { describe, it, expect } from 'vitest';
import {
  createPlayerCounterState,
  getPlayerCounter,
  addPlayerCounters,
  removePlayerCounters,
  payEnergy,
  canPayEnergy,
  hasLostDueToPoison,
  processInfectDamageToPlayer,
  processToxicCombatDamage,
  processPoisonousAbility,
  gainExperience,
  gainEnergy,
  getPlayerCounterTypes,
  playerHasCounters,
  proliferatePlayer,
  PlayerCounterType,
} from '../src/playerCounters';

describe('Player Counters', () => {
  describe('createPlayerCounterState', () => {
    it('should create initial state with all counters at zero', () => {
      const state = createPlayerCounterState('player1');
      
      expect(state.playerId).toBe('player1');
      expect(state.poison).toBe(0);
      expect(state.energy).toBe(0);
      expect(state.experience).toBe(0);
      expect(state.rad).toBe(0);
      expect(state.ticket).toBe(0);
    });
  });

  describe('addPlayerCounters', () => {
    it('should add poison counters', () => {
      const state = createPlayerCounterState('player1');
      const result = addPlayerCounters(state, PlayerCounterType.POISON, 3);
      
      expect(result.state.poison).toBe(3);
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].delta).toBe(3);
      expect(result.loseConditionMet).toBe(false);
    });

    it('should trigger lose condition at 10 poison', () => {
      const state = createPlayerCounterState('player1');
      const result = addPlayerCounters(state, PlayerCounterType.POISON, 10);
      
      expect(result.state.poison).toBe(10);
      expect(result.loseConditionMet).toBe(true);
      expect(result.loseReason).toContain('poison counters');
    });

    it('should add energy counters', () => {
      const state = createPlayerCounterState('player1');
      const result = addPlayerCounters(state, PlayerCounterType.ENERGY, 5);
      
      expect(result.state.energy).toBe(5);
      expect(result.loseConditionMet).toBe(false);
    });

    it('should add experience counters', () => {
      const state = createPlayerCounterState('player1');
      const result = addPlayerCounters(state, PlayerCounterType.EXPERIENCE, 2);
      
      expect(result.state.experience).toBe(2);
    });

    it('should handle custom counter types', () => {
      const state = createPlayerCounterState('player1');
      const result = addPlayerCounters(state, 'custom_counter', 7);
      
      expect(result.state.other['custom_counter']).toBe(7);
    });
  });

  describe('removePlayerCounters', () => {
    it('should remove counters', () => {
      let state = createPlayerCounterState('player1');
      state = addPlayerCounters(state, PlayerCounterType.POISON, 5).state;
      
      const result = removePlayerCounters(state, PlayerCounterType.POISON, 2);
      
      expect(result.state.poison).toBe(3);
      expect(result.changes[0].delta).toBe(-2);
    });

    it('should not go below zero', () => {
      let state = createPlayerCounterState('player1');
      state = addPlayerCounters(state, PlayerCounterType.POISON, 3).state;
      
      const result = removePlayerCounters(state, PlayerCounterType.POISON, 5);
      
      expect(result.state.poison).toBe(0);
      expect(result.changes[0].delta).toBe(-3);
    });
  });

  describe('payEnergy', () => {
    it('should pay energy when sufficient', () => {
      let state = createPlayerCounterState('player1');
      state = addPlayerCounters(state, PlayerCounterType.ENERGY, 5).state;
      
      const result = payEnergy(state, 3);
      
      expect(result).not.toBeNull();
      expect(result!.state.energy).toBe(2);
    });

    it('should return null when insufficient energy', () => {
      let state = createPlayerCounterState('player1');
      state = addPlayerCounters(state, PlayerCounterType.ENERGY, 2).state;
      
      const result = payEnergy(state, 5);
      
      expect(result).toBeNull();
    });
  });

  describe('canPayEnergy', () => {
    it('should return true when sufficient energy', () => {
      let state = createPlayerCounterState('player1');
      state = addPlayerCounters(state, PlayerCounterType.ENERGY, 5).state;
      
      expect(canPayEnergy(state, 3)).toBe(true);
      expect(canPayEnergy(state, 5)).toBe(true);
    });

    it('should return false when insufficient energy', () => {
      let state = createPlayerCounterState('player1');
      state = addPlayerCounters(state, PlayerCounterType.ENERGY, 2).state;
      
      expect(canPayEnergy(state, 3)).toBe(false);
    });
  });

  describe('hasLostDueToPoison', () => {
    it('should return false below 10 poison', () => {
      let state = createPlayerCounterState('player1');
      state = addPlayerCounters(state, PlayerCounterType.POISON, 9).state;
      
      expect(hasLostDueToPoison(state)).toBe(false);
    });

    it('should return true at 10 or more poison', () => {
      let state = createPlayerCounterState('player1');
      state = addPlayerCounters(state, PlayerCounterType.POISON, 10).state;
      
      expect(hasLostDueToPoison(state)).toBe(true);
    });
  });

  describe('processInfectDamageToPlayer', () => {
    it('should give poison counters equal to damage', () => {
      const state = createPlayerCounterState('player1');
      const result = processInfectDamageToPlayer(state, 4, 'source1', 'Blightsteel Colossus');
      
      expect(result.state.poison).toBe(4);
      expect(result.changes[0].sourceName).toBe('Blightsteel Colossus');
    });
  });

  describe('processToxicCombatDamage', () => {
    it('should give poison counters equal to toxic value', () => {
      const state = createPlayerCounterState('player1');
      const result = processToxicCombatDamage(state, 3, 'source1', 'Phyrexian Obliterator');
      
      expect(result.state.poison).toBe(3);
    });
  });

  describe('processPoisonousAbility', () => {
    it('should give poison counters equal to poisonous value', () => {
      const state = createPlayerCounterState('player1');
      const result = processPoisonousAbility(state, 1, 'source1', 'Virulent Sliver');
      
      expect(result.state.poison).toBe(1);
    });
  });

  describe('gainExperience', () => {
    it('should add experience counters', () => {
      const state = createPlayerCounterState('player1');
      const result = gainExperience(state, 2, 'source1', 'Mizzix of the Izmagnus');
      
      expect(result.state.experience).toBe(2);
    });
  });

  describe('gainEnergy', () => {
    it('should add energy counters', () => {
      const state = createPlayerCounterState('player1');
      const result = gainEnergy(state, 3, 'source1', 'Aetherworks Marvel');
      
      expect(result.state.energy).toBe(3);
    });
  });

  describe('getPlayerCounterTypes', () => {
    it('should return all counter types player has', () => {
      let state = createPlayerCounterState('player1');
      state = addPlayerCounters(state, PlayerCounterType.POISON, 2).state;
      state = addPlayerCounters(state, PlayerCounterType.ENERGY, 5).state;
      
      const types = getPlayerCounterTypes(state);
      
      expect(types).toContain(PlayerCounterType.POISON);
      expect(types).toContain(PlayerCounterType.ENERGY);
      expect(types).not.toContain(PlayerCounterType.EXPERIENCE);
    });

    it('should return empty array when no counters', () => {
      const state = createPlayerCounterState('player1');
      const types = getPlayerCounterTypes(state);
      
      expect(types).toHaveLength(0);
    });
  });

  describe('playerHasCounters', () => {
    it('should return true when player has counters', () => {
      let state = createPlayerCounterState('player1');
      state = addPlayerCounters(state, PlayerCounterType.POISON, 1).state;
      
      expect(playerHasCounters(state)).toBe(true);
    });

    it('should return false when player has no counters', () => {
      const state = createPlayerCounterState('player1');
      
      expect(playerHasCounters(state)).toBe(false);
    });
  });

  describe('proliferatePlayer', () => {
    it('should add one of each counter type player has', () => {
      let state = createPlayerCounterState('player1');
      state = addPlayerCounters(state, PlayerCounterType.POISON, 3).state;
      state = addPlayerCounters(state, PlayerCounterType.ENERGY, 2).state;
      
      const result = proliferatePlayer(state, 'source1', 'Atraxa, Praetors\' Voice');
      
      expect(result.state.poison).toBe(4);
      expect(result.state.energy).toBe(3);
      expect(result.state.experience).toBe(0); // Was 0, stays 0
    });

    it('should trigger lose condition if proliferate brings poison to 10', () => {
      let state = createPlayerCounterState('player1');
      state = addPlayerCounters(state, PlayerCounterType.POISON, 9).state;
      
      const result = proliferatePlayer(state);
      
      expect(result.state.poison).toBe(10);
      expect(result.loseConditionMet).toBe(true);
    });

    it('should do nothing if player has no counters', () => {
      const state = createPlayerCounterState('player1');
      const result = proliferatePlayer(state);
      
      expect(result.state).toEqual(state);
      expect(result.changes).toHaveLength(0);
    });
  });
});
