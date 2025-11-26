/**
 * Tests for cleanup step damage clearing (Rule 514.2)
 */
import { describe, it, expect } from 'vitest';
import {
  createCleanupStepState,
  checkHandSize,
  clearDamageFromPermanents,
  endTemporaryEffects,
  shouldCleanupGrantPriority,
  needsAdditionalCleanupStep,
  executeCleanupStep,
  applyDamageClearing,
  hasLethalDamage,
  getPermanentsWithDamage,
  type DamageTrackedPermanent,
  type TemporaryEffect,
} from '../src/cleanupStep';

describe('Cleanup Step - Rule 514', () => {
  describe('createCleanupStepState', () => {
    it('creates initial state with all flags false', () => {
      const state = createCleanupStepState();
      expect(state.handSizeChecked).toBe(false);
      expect(state.damageCleared).toBe(false);
      expect(state.effectsEnded).toBe(false);
      expect(state.pendingStateBasedActions).toBe(false);
      expect(state.pendingTriggers).toBe(false);
      expect(state.additionalCleanupNeeded).toBe(false);
    });
  });

  describe('checkHandSize - Rule 514.1', () => {
    it('requires no discard when at or below max', () => {
      expect(checkHandSize(5, 7).discardRequired).toBe(0);
      expect(checkHandSize(7, 7).discardRequired).toBe(0);
    });

    it('calculates correct discard amount when over max', () => {
      expect(checkHandSize(8, 7).discardRequired).toBe(1);
      expect(checkHandSize(10, 7).discardRequired).toBe(3);
      expect(checkHandSize(15, 7).discardRequired).toBe(8);
    });

    it('handles infinite hand size (Reliquary Tower)', () => {
      const result = checkHandSize(20, Infinity);
      expect(result.discardRequired).toBe(0);
      expect(result.logs).toContain('No maximum hand size');
    });

    it('handles negative max hand size as infinite', () => {
      const result = checkHandSize(20, -1);
      expect(result.discardRequired).toBe(0);
    });
  });

  describe('clearDamageFromPermanents - Rule 514.2 / 703.4p', () => {
    it('clears damage from all permanents with damage', () => {
      const permanents: DamageTrackedPermanent[] = [
        { id: 'p1', name: 'Creature 1', controller: 'player1', markedDamage: 3 },
        { id: 'p2', name: 'Creature 2', controller: 'player1', markedDamage: 5 },
        { id: 'p3', name: 'Creature 3', controller: 'player2', markedDamage: 0 },
      ];

      const result = clearDamageFromPermanents(permanents);
      
      expect(result.clearedPermanents).toContain('p1');
      expect(result.clearedPermanents).toContain('p2');
      expect(result.clearedPermanents).not.toContain('p3');
      expect(result.clearedPermanents.length).toBe(2);
    });

    it('returns empty array when no permanents have damage', () => {
      const permanents: DamageTrackedPermanent[] = [
        { id: 'p1', controller: 'player1', markedDamage: 0 },
        { id: 'p2', controller: 'player1', markedDamage: 0 },
      ];

      const result = clearDamageFromPermanents(permanents);
      expect(result.clearedPermanents.length).toBe(0);
    });

    it('logs each permanent that has damage cleared', () => {
      const permanents: DamageTrackedPermanent[] = [
        { id: 'p1', name: 'Grizzly Bears', controller: 'player1', markedDamage: 1 },
      ];

      const result = clearDamageFromPermanents(permanents);
      expect(result.logs.some(l => l.includes('Grizzly Bears'))).toBe(true);
    });
  });

  describe('endTemporaryEffects - Rule 514.2', () => {
    it('ends all "until end of turn" effects', () => {
      const effects: TemporaryEffect[] = [
        { id: 'e1', type: 'until_end_of_turn', description: 'Giant Growth +3/+3' },
        { id: 'e2', type: 'until_end_of_turn', description: 'Titanic Growth +4/+4' },
      ];

      const result = endTemporaryEffects(effects);
      expect(result.endedEffects).toContain('e1');
      expect(result.endedEffects).toContain('e2');
    });

    it('ends all "this turn" effects', () => {
      const effects: TemporaryEffect[] = [
        { id: 'e1', type: 'this_turn', description: 'Cannot block this turn' },
      ];

      const result = endTemporaryEffects(effects);
      expect(result.endedEffects).toContain('e1');
    });

    it('ends all "until cleanup" effects', () => {
      const effects: TemporaryEffect[] = [
        { id: 'e1', type: 'until_cleanup', description: 'Gains haste' },
      ];

      const result = endTemporaryEffects(effects);
      expect(result.endedEffects).toContain('e1');
    });
  });

  describe('shouldCleanupGrantPriority - Rule 514.3', () => {
    it('does not grant priority normally', () => {
      const result = shouldCleanupGrantPriority(false, false);
      expect(result.grantsPriority).toBe(false);
    });

    it('grants priority when state-based actions pending', () => {
      const result = shouldCleanupGrantPriority(true, false);
      expect(result.grantsPriority).toBe(true);
      expect(result.reason).toContain('State-based actions');
    });

    it('grants priority when triggers pending', () => {
      const result = shouldCleanupGrantPriority(false, true);
      expect(result.grantsPriority).toBe(true);
      expect(result.reason).toContain('Triggered abilities');
    });
  });

  describe('needsAdditionalCleanupStep - Rule 514.3a', () => {
    it('needs additional cleanup when priority granted and actions taken', () => {
      expect(needsAdditionalCleanupStep(true, true)).toBe(true);
    });

    it('does not need additional cleanup when no priority was granted', () => {
      expect(needsAdditionalCleanupStep(false, true)).toBe(false);
    });

    it('does not need additional cleanup when no actions taken', () => {
      expect(needsAdditionalCleanupStep(true, false)).toBe(false);
    });
  });

  describe('executeCleanupStep', () => {
    it('performs full cleanup with hand size check and damage clearing', () => {
      const permanents: DamageTrackedPermanent[] = [
        { id: 'p1', name: 'Grizzly Bears', controller: 'player1', markedDamage: 1 },
      ];
      const effects: TemporaryEffect[] = [
        { id: 'e1', type: 'until_end_of_turn', description: 'Giant Growth' },
      ];

      const result = executeCleanupStep('player1', 9, 7, permanents, effects);
      
      expect(result.discardRequired).toBe(2);
      expect(result.permanentsWithDamageCleared).toContain('p1');
      expect(result.effectsEnded).toContain('e1');
      expect(result.needsPriority).toBe(false);
    });

    it('grants priority when SBAs or triggers pending', () => {
      const result = executeCleanupStep('player1', 7, 7, [], [], true, false);
      expect(result.needsPriority).toBe(true);
    });
  });

  describe('applyDamageClearing', () => {
    it('clears markedDamage from all permanents', () => {
      const battlefield = [
        { id: 'p1', markedDamage: 3 },
        { id: 'p2', markedDamage: 0 },
        { id: 'p3', markedDamage: 5 },
      ];

      const result = applyDamageClearing(battlefield);
      
      expect(result[0].markedDamage).toBe(0);
      expect(result[1].markedDamage).toBe(0);
      expect(result[2].markedDamage).toBe(0);
    });

    it('clears damage counters format', () => {
      const battlefield = [
        { id: 'p1', counters: { damage: 3, '+1/+1': 2 } },
      ];

      const result = applyDamageClearing(battlefield);
      
      expect(result[0].counters?.damage).toBe(0);
      expect(result[0].counters?.['+1/+1']).toBe(2); // Other counters preserved
    });

    it('preserves other permanent properties', () => {
      const battlefield = [
        { id: 'p1', name: 'Test', controller: 'player1', markedDamage: 3, tapped: true },
      ];

      const result = applyDamageClearing(battlefield);
      
      expect((result[0] as any).name).toBe('Test');
      expect((result[0] as any).controller).toBe('player1');
      expect((result[0] as any).tapped).toBe(true);
    });
  });

  describe('hasLethalDamage', () => {
    it('detects lethal damage when damage >= toughness', () => {
      expect(hasLethalDamage(3, 3)).toBe(true);
      expect(hasLethalDamage(3, 5)).toBe(true);
    });

    it('returns false when damage < toughness', () => {
      expect(hasLethalDamage(3, 2)).toBe(false);
      expect(hasLethalDamage(5, 1)).toBe(false);
    });

    it('considers deathtouch (any damage is lethal)', () => {
      expect(hasLethalDamage(10, 1, true)).toBe(true);
      expect(hasLethalDamage(100, 1, true)).toBe(true);
    });

    it('deathtouch requires at least 1 damage', () => {
      expect(hasLethalDamage(10, 0, true)).toBe(false);
    });
  });

  describe('getPermanentsWithDamage', () => {
    it('finds all permanents with damage marked', () => {
      const battlefield = [
        { id: 'p1', name: 'A', controller: 'player1', markedDamage: 3 },
        { id: 'p2', name: 'B', controller: 'player1', markedDamage: 0 },
        { id: 'p3', name: 'C', controller: 'player2', damage: 2 },
        { id: 'p4', name: 'D', controller: 'player2', counters: { damage: 1 } },
      ];

      const result = getPermanentsWithDamage(battlefield);
      
      expect(result.length).toBe(3);
      expect(result.find(p => p.id === 'p1')?.markedDamage).toBe(3);
      expect(result.find(p => p.id === 'p3')?.markedDamage).toBe(2);
      expect(result.find(p => p.id === 'p4')?.markedDamage).toBe(1);
    });
  });
});
