/**
 * Tests for enhanced combat damage automation
 */
import { describe, it, expect } from 'vitest';
import {
  CombatDamagePhase,
  hasFirstStrikeDamage,
  hasRegularDamage,
  calculateLethalDamageForBlocker,
  assignDamageToBlockers,
  calculateTrampleToPlayer,
  processUnblockedAttacker,
  processBlockerDamageToAttacker,
  calculateLifelinkGains,
  determineCreatureDeaths,
  hasFirstStrikersInCombat,
  calculateCombatDamage,
} from '../src/combatDamageEnhanced';
import { extractCombatKeywords } from '../src/combatAutomation';
import type { BattlefieldPermanent, KnownCardRef } from '../../shared/src';

// Helper to create a test permanent
function createTestPermanent(
  id: string,
  name: string,
  power: number,
  toughness: number,
  oracleText: string = '',
  controllerId: string = 'player1'
): BattlefieldPermanent {
  return {
    id,
    controller: controllerId,
    owner: controllerId,
    tapped: false,
    summoningSickness: false,
    counters: {},
    attachments: [],
    modifiers: [],
    basePower: power,
    baseToughness: toughness,
    card: {
      id,
      name,
      power: power.toString(),
      toughness: toughness.toString(),
      type_line: 'Creature',
      oracle_text: oracleText,
      colors: [],
    } as KnownCardRef,
  } as BattlefieldPermanent;
}

describe('Combat Damage Phase Detection', () => {
  describe('hasFirstStrikeDamage', () => {
    it('should return true for first strike', () => {
      const perm = createTestPermanent('1', 'Knight', 2, 2, 'First strike');
      const keywords = extractCombatKeywords(perm);
      expect(hasFirstStrikeDamage(keywords)).toBe(true);
    });
    
    it('should return true for double strike', () => {
      const perm = createTestPermanent('1', 'Warrior', 3, 3, 'Double strike');
      const keywords = extractCombatKeywords(perm);
      expect(hasFirstStrikeDamage(keywords)).toBe(true);
    });
    
    it('should return false for regular creatures', () => {
      const perm = createTestPermanent('1', 'Bear', 2, 2);
      const keywords = extractCombatKeywords(perm);
      expect(hasFirstStrikeDamage(keywords)).toBe(false);
    });
  });
  
  describe('hasRegularDamage', () => {
    it('should return true for regular creatures', () => {
      const perm = createTestPermanent('1', 'Bear', 2, 2);
      const keywords = extractCombatKeywords(perm);
      expect(hasRegularDamage(keywords)).toBe(true);
    });
    
    it('should return true for double strike', () => {
      const perm = createTestPermanent('1', 'Warrior', 3, 3, 'Double strike');
      const keywords = extractCombatKeywords(perm);
      expect(hasRegularDamage(keywords)).toBe(true);
    });
    
    it('should return false for first strike only', () => {
      const perm = createTestPermanent('1', 'Knight', 2, 2, 'First strike');
      const keywords = extractCombatKeywords(perm);
      expect(hasRegularDamage(keywords)).toBe(false);
    });
  });
});

describe('Lethal Damage Calculation', () => {
  describe('calculateLethalDamageForBlocker', () => {
    it('should calculate normal lethal damage', () => {
      const attacker = createTestPermanent('1', 'Bear', 2, 2);
      const blocker = createTestPermanent('2', 'Soldier', 1, 3);
      
      expect(calculateLethalDamageForBlocker(attacker, blocker)).toBe(3);
    });
    
    it('should account for existing damage', () => {
      const attacker = createTestPermanent('1', 'Bear', 2, 2);
      const blocker = createTestPermanent('2', 'Soldier', 1, 3);
      
      expect(calculateLethalDamageForBlocker(attacker, blocker, 2)).toBe(1);
    });
    
    it('should return 1 for deathtouch', () => {
      const attacker = createTestPermanent('1', 'Assassin', 1, 1, 'Deathtouch');
      const blocker = createTestPermanent('2', 'Giant', 5, 5);
      
      expect(calculateLethalDamageForBlocker(attacker, blocker)).toBe(1);
    });
  });
});

describe('Damage Assignment to Blockers', () => {
  describe('assignDamageToBlockers', () => {
    it('should assign damage to single blocker', () => {
      const attacker = createTestPermanent('1', 'Bear', 3, 3);
      const blocker = createTestPermanent('2', 'Soldier', 1, 2);
      
      const { assignments, remainingDamage, blockersDying } = assignDamageToBlockers(
        attacker, [blocker], 3
      );
      
      expect(assignments).toHaveLength(1);
      expect(assignments[0].amount).toBe(2); // Lethal damage
      expect(remainingDamage).toBe(1); // Excess
      expect(blockersDying).toContain(blocker.id);
    });
    
    it('should assign damage to ordered blockers', () => {
      const attacker = createTestPermanent('1', 'Giant', 6, 6);
      const blocker1 = createTestPermanent('2', 'Soldier', 1, 2);
      const blocker2 = createTestPermanent('3', 'Knight', 2, 3);
      
      const { assignments, remainingDamage, blockersDying } = assignDamageToBlockers(
        attacker, [blocker1, blocker2], 6
      );
      
      expect(assignments).toHaveLength(2);
      expect(assignments[0].targetId).toBe(blocker1.id);
      expect(assignments[0].amount).toBe(2);
      expect(assignments[1].targetId).toBe(blocker2.id);
      expect(assignments[1].amount).toBe(3);
      expect(remainingDamage).toBe(1);
      expect(blockersDying).toHaveLength(2);
    });
    
    it('should optimize with deathtouch', () => {
      const attacker = createTestPermanent('1', 'Assassin', 3, 3, 'Deathtouch');
      const blocker1 = createTestPermanent('2', 'Giant', 5, 5);
      const blocker2 = createTestPermanent('3', 'Wurm', 6, 6);
      
      const { assignments, remainingDamage, blockersDying } = assignDamageToBlockers(
        attacker, [blocker1, blocker2], 3
      );
      
      expect(assignments[0].amount).toBe(1); // 1 is lethal with deathtouch
      expect(assignments[1].amount).toBe(1);
      expect(remainingDamage).toBe(1);
      expect(blockersDying).toHaveLength(2);
    });
  });
});

describe('Trample Damage', () => {
  describe('calculateTrampleToPlayer', () => {
    it('should calculate excess damage', () => {
      const attacker = createTestPermanent('1', 'Wurm', 6, 6, 'Trample');
      const blocker = createTestPermanent('2', 'Soldier', 1, 2);
      
      const trample = calculateTrampleToPlayer(attacker, [blocker], 2, 'player2');
      
      expect(trample).not.toBeNull();
      expect(trample!.amount).toBe(4);
      expect(trample!.properties.trample).toBe(true);
    });
    
    it('should return null for non-tramplers', () => {
      const attacker = createTestPermanent('1', 'Bear', 2, 2);
      const blocker = createTestPermanent('2', 'Soldier', 1, 1);
      
      const trample = calculateTrampleToPlayer(attacker, [blocker], 1, 'player2');
      
      expect(trample).toBeNull();
    });
    
    it('should return null if no excess', () => {
      const attacker = createTestPermanent('1', 'Bear', 2, 2, 'Trample');
      const blocker = createTestPermanent('2', 'Soldier', 1, 3);
      
      const trample = calculateTrampleToPlayer(attacker, [blocker], 2, 'player2');
      
      expect(trample).toBeNull();
    });
  });
});

describe('Unblocked Attacker', () => {
  describe('processUnblockedAttacker', () => {
    it('should deal damage to player', () => {
      const attacker = createTestPermanent('1', 'Bear', 2, 2);
      
      const assignment = processUnblockedAttacker(attacker, 'player2', CombatDamagePhase.REGULAR);
      
      expect(assignment).not.toBeNull();
      expect(assignment!.amount).toBe(2);
      expect(assignment!.targetType).toBe('player');
    });
    
    it('should not deal damage in wrong phase', () => {
      const attacker = createTestPermanent('1', 'Bear', 2, 2);
      
      const assignment = processUnblockedAttacker(attacker, 'player2', CombatDamagePhase.FIRST_STRIKE);
      
      expect(assignment).toBeNull();
    });
    
    it('should deal first strike damage in first strike phase', () => {
      const attacker = createTestPermanent('1', 'Knight', 2, 2, 'First strike');
      
      const assignment = processUnblockedAttacker(attacker, 'player2', CombatDamagePhase.FIRST_STRIKE);
      
      expect(assignment).not.toBeNull();
      expect(assignment!.amount).toBe(2);
    });
    
    it('should deal damage in both phases for double strike', () => {
      const attacker = createTestPermanent('1', 'Warrior', 3, 3, 'Double strike');
      
      const fs = processUnblockedAttacker(attacker, 'player2', CombatDamagePhase.FIRST_STRIKE);
      const reg = processUnblockedAttacker(attacker, 'player2', CombatDamagePhase.REGULAR);
      
      expect(fs).not.toBeNull();
      expect(reg).not.toBeNull();
    });
  });
});

describe('Blocker Damage to Attacker', () => {
  describe('processBlockerDamageToAttacker', () => {
    it('should deal damage to attacker', () => {
      const blocker = createTestPermanent('1', 'Bear', 2, 2);
      const attacker = createTestPermanent('2', 'Soldier', 1, 1);
      
      const assignment = processBlockerDamageToAttacker(blocker, attacker, CombatDamagePhase.REGULAR);
      
      expect(assignment).not.toBeNull();
      expect(assignment!.amount).toBe(2);
      expect(assignment!.targetId).toBe(attacker.id);
    });
  });
});

describe('Lifelink Gains', () => {
  describe('calculateLifelinkGains', () => {
    it('should calculate lifelink from assignments', () => {
      const assignments = [
        {
          sourceId: 'attacker1',
          sourceName: 'Vampire',
          sourceController: 'player1',
          targetId: 'player2',
          targetType: 'player' as const,
          amount: 3,
          phase: CombatDamagePhase.REGULAR,
          properties: { deathtouch: false, lifelink: true, trample: false, infect: false, wither: false },
        },
        {
          sourceId: 'attacker2',
          sourceName: 'Bear',
          sourceController: 'player1',
          targetId: 'player2',
          targetType: 'player' as const,
          amount: 2,
          phase: CombatDamagePhase.REGULAR,
          properties: { deathtouch: false, lifelink: false, trample: false, infect: false, wither: false },
        },
      ];
      
      const gains = calculateLifelinkGains(assignments);
      
      expect(gains['player1']).toBe(3);
    });
    
    it('should accumulate from multiple lifelink sources', () => {
      const assignments = [
        {
          sourceId: 'a1',
          sourceName: 'V1',
          sourceController: 'player1',
          targetId: 'player2',
          targetType: 'player' as const,
          amount: 3,
          phase: CombatDamagePhase.REGULAR,
          properties: { deathtouch: false, lifelink: true, trample: false, infect: false, wither: false },
        },
        {
          sourceId: 'a2',
          sourceName: 'V2',
          sourceController: 'player1',
          targetId: 'player2',
          targetType: 'player' as const,
          amount: 4,
          phase: CombatDamagePhase.REGULAR,
          properties: { deathtouch: false, lifelink: true, trample: false, infect: false, wither: false },
        },
      ];
      
      const gains = calculateLifelinkGains(assignments);
      
      expect(gains['player1']).toBe(7);
    });
  });
});

describe('Creature Deaths', () => {
  describe('determineCreatureDeaths', () => {
    it('should detect lethal damage', () => {
      const assignments = [
        {
          sourceId: 'a1',
          sourceName: 'Bear',
          sourceController: 'player1',
          targetId: 'blocker1',
          targetType: 'creature' as const,
          amount: 3,
          phase: CombatDamagePhase.REGULAR,
          properties: { deathtouch: false, lifelink: false, trample: false, infect: false, wither: false },
        },
      ];
      
      const deaths = determineCreatureDeaths(assignments, {
        'blocker1': { toughness: 3, existingDamage: 0, indestructible: false },
      });
      
      expect(deaths).toContain('blocker1');
    });
    
    it('should account for existing damage', () => {
      const assignments = [
        {
          sourceId: 'a1',
          sourceName: 'Bear',
          sourceController: 'player1',
          targetId: 'blocker1',
          targetType: 'creature' as const,
          amount: 1,
          phase: CombatDamagePhase.REGULAR,
          properties: { deathtouch: false, lifelink: false, trample: false, infect: false, wither: false },
        },
      ];
      
      const deaths = determineCreatureDeaths(assignments, {
        'blocker1': { toughness: 3, existingDamage: 2, indestructible: false },
      });
      
      expect(deaths).toContain('blocker1');
    });
    
    it('should detect deathtouch kills', () => {
      const assignments = [
        {
          sourceId: 'a1',
          sourceName: 'Assassin',
          sourceController: 'player1',
          targetId: 'blocker1',
          targetType: 'creature' as const,
          amount: 1,
          phase: CombatDamagePhase.REGULAR,
          properties: { deathtouch: true, lifelink: false, trample: false, infect: false, wither: false },
        },
      ];
      
      const deaths = determineCreatureDeaths(assignments, {
        'blocker1': { toughness: 10, existingDamage: 0, indestructible: false },
      });
      
      expect(deaths).toContain('blocker1');
    });
    
    it('should not kill indestructible creatures', () => {
      const assignments = [
        {
          sourceId: 'a1',
          sourceName: 'Bear',
          sourceController: 'player1',
          targetId: 'blocker1',
          targetType: 'creature' as const,
          amount: 10,
          phase: CombatDamagePhase.REGULAR,
          properties: { deathtouch: true, lifelink: false, trample: false, infect: false, wither: false },
        },
      ];
      
      const deaths = determineCreatureDeaths(assignments, {
        'blocker1': { toughness: 3, existingDamage: 0, indestructible: true },
      });
      
      expect(deaths).toHaveLength(0);
    });
  });
});

describe('First Strikers Detection', () => {
  describe('hasFirstStrikersInCombat', () => {
    it('should detect first striker attackers', () => {
      const attackers = [createTestPermanent('1', 'Knight', 2, 2, 'First strike')];
      const blockers = [createTestPermanent('2', 'Bear', 2, 2)];
      
      expect(hasFirstStrikersInCombat(attackers, blockers)).toBe(true);
    });
    
    it('should detect first striker blockers', () => {
      const attackers = [createTestPermanent('1', 'Bear', 2, 2)];
      const blockers = [createTestPermanent('2', 'Knight', 2, 2, 'First strike')];
      
      expect(hasFirstStrikersInCombat(attackers, blockers)).toBe(true);
    });
    
    it('should return false when no first strikers', () => {
      const attackers = [createTestPermanent('1', 'Bear', 2, 2)];
      const blockers = [createTestPermanent('2', 'Soldier', 1, 1)];
      
      expect(hasFirstStrikersInCombat(attackers, blockers)).toBe(false);
    });
  });
});

describe('Full Combat Damage Calculation', () => {
  describe('calculateCombatDamage', () => {
    it('should calculate unblocked damage', () => {
      const attacker = createTestPermanent('1', 'Bear', 2, 2, '', 'player1');
      
      const result = calculateCombatDamage(
        [{ attacker, defendingPlayerId: 'player2', orderedBlockers: [] }],
        { player1: 40, player2: 40 },
        {},
        Date.now()
      );
      
      expect(result.assignments).toHaveLength(1);
      expect(result.lifeChanges['player2']).toBe(-2);
    });
    
    it('should calculate blocked combat', () => {
      const attacker = createTestPermanent('1', 'Bear', 2, 2, '', 'player1');
      const blocker = createTestPermanent('2', 'Soldier', 1, 1, '', 'player2');
      
      const result = calculateCombatDamage(
        [{ attacker, defendingPlayerId: 'player2', orderedBlockers: [blocker] }],
        { player1: 40, player2: 40 },
        { 
          [attacker.id]: { toughness: 2, existingDamage: 0, indestructible: false },
          [blocker.id]: { toughness: 1, existingDamage: 0, indestructible: false },
        },
        Date.now()
      );
      
      // Should have damage to blocker and from blocker to attacker
      expect(result.assignments.length).toBeGreaterThanOrEqual(2);
      expect(result.creaturesKilled).toContain(blocker.id);
    });
    
    it('should handle lifelink', () => {
      const attacker = createTestPermanent('1', 'Vampire', 3, 3, 'Lifelink', 'player1');
      
      const result = calculateCombatDamage(
        [{ attacker, defendingPlayerId: 'player2', orderedBlockers: [] }],
        { player1: 40, player2: 40 },
        {},
        Date.now()
      );
      
      expect(result.lifeChanges['player1']).toBe(3); // Gained 3 life
      expect(result.lifeChanges['player2']).toBe(-3); // Lost 3 life
    });
    
    it('should handle double strike', () => {
      const attacker = createTestPermanent('1', 'Warrior', 3, 3, 'Double strike', 'player1');
      
      const result = calculateCombatDamage(
        [{ attacker, defendingPlayerId: 'player2', orderedBlockers: [] }],
        { player1: 40, player2: 40 },
        {},
        Date.now()
      );
      
      // Should deal damage in both phases
      expect(result.firstStrikeAssignments).toHaveLength(1);
      expect(result.regularAssignments).toHaveLength(1);
      expect(result.lifeChanges['player2']).toBe(-6); // 3 + 3
    });
    
    it('should handle trample', () => {
      const attacker = createTestPermanent('1', 'Wurm', 6, 6, 'Trample', 'player1');
      const blocker = createTestPermanent('2', 'Soldier', 1, 2, '', 'player2');
      
      const result = calculateCombatDamage(
        [{ attacker, defendingPlayerId: 'player2', orderedBlockers: [blocker] }],
        { player1: 40, player2: 40 },
        { 
          [blocker.id]: { toughness: 2, existingDamage: 0, indestructible: false },
        },
        Date.now()
      );
      
      // Should have damage to blocker and trample to player
      const playerDamage = result.assignments.filter(a => a.targetType === 'player');
      expect(playerDamage.length).toBeGreaterThan(0);
      expect(playerDamage[0].properties.trample).toBe(true);
    });
  });
});
