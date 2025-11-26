/**
 * Test suite for combat automation
 */

import { describe, it, expect } from 'vitest';
import {
  extractCombatKeywords,
  getCreaturePower,
  getCreatureToughness,
  createCombatCreature,
  canCreatureAttack,
  canCreatureBlock,
  calculateLethalDamage,
  calculateTrampleDamage,
  autoAssignCombatDamage,
  isCreatureKilled,
  resolveCombat,
  detectCombatTriggers,
} from '../src/combatAutomation';
import type { BattlefieldPermanent, KnownCardRef } from '../../shared/src';

// Helper to create a test permanent
function createTestPermanent(
  id: string,
  name: string,
  power: number,
  toughness: number,
  oracleText: string = '',
  controllerId: string = 'player1',
  options: Partial<BattlefieldPermanent> = {}
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
    card: {
      id,
      name,
      power: power.toString(),
      toughness: toughness.toString(),
      type_line: 'Creature',
      oracle_text: oracleText,
      colors: [],
    } as KnownCardRef,
    basePower: power,
    baseToughness: toughness,
    ...options,
  } as BattlefieldPermanent;
}

describe('Combat Keywords', () => {
  describe('extractCombatKeywords', () => {
    it('should detect flying keyword', () => {
      const perm = createTestPermanent('1', 'Bird', 2, 2, 'Flying');
      const keywords = extractCombatKeywords(perm);
      
      expect(keywords.flying).toBe(true);
      expect(keywords.reach).toBe(false);
    });

    it('should detect multiple keywords', () => {
      const perm = createTestPermanent('1', 'Angel', 4, 4, 'Flying, vigilance, lifelink');
      const keywords = extractCombatKeywords(perm);
      
      expect(keywords.flying).toBe(true);
      expect(keywords.vigilance).toBe(true);
      expect(keywords.lifelink).toBe(true);
      expect(keywords.trample).toBe(false);
    });

    it('should detect first strike and double strike correctly', () => {
      const firstStrike = createTestPermanent('1', 'Knight', 2, 2, 'First strike');
      const doubleStrike = createTestPermanent('2', 'Warrior', 3, 3, 'Double strike');
      
      const fs = extractCombatKeywords(firstStrike);
      const ds = extractCombatKeywords(doubleStrike);
      
      expect(fs.firstStrike).toBe(true);
      expect(fs.doubleStrike).toBe(false);
      expect(ds.firstStrike).toBe(false);
      expect(ds.doubleStrike).toBe(true);
    });

    it('should detect protection from colors', () => {
      const perm = createTestPermanent('1', 'Knight', 2, 2, 'Protection from black, protection from red');
      const keywords = extractCombatKeywords(perm);
      
      expect(keywords.protectionColors).toContain('B');
      expect(keywords.protectionColors).toContain('R');
      expect(keywords.protectionColors).not.toContain('W');
    });

    it('should detect defender', () => {
      const perm = createTestPermanent('1', 'Wall', 0, 5, 'Defender');
      const keywords = extractCombatKeywords(perm);
      
      expect(keywords.defender).toBe(true);
    });
  });
});

describe('Power and Toughness Calculation', () => {
  it('should calculate base power/toughness', () => {
    const perm = createTestPermanent('1', 'Bear', 2, 2);
    
    expect(getCreaturePower(perm)).toBe(2);
    expect(getCreatureToughness(perm)).toBe(2);
  });

  it('should include +1/+1 counters', () => {
    const perm = createTestPermanent('1', 'Bear', 2, 2, '', 'player1', {
      counters: { '+1/+1': 3 },
    });
    
    expect(getCreaturePower(perm)).toBe(5);
    expect(getCreatureToughness(perm)).toBe(5);
  });

  it('should subtract -1/-1 counters', () => {
    const perm = createTestPermanent('1', 'Bear', 2, 2, '', 'player1', {
      counters: { '-1/-1': 1 },
    });
    
    expect(getCreaturePower(perm)).toBe(1);
    expect(getCreatureToughness(perm)).toBe(1);
  });

  it('should not go below 0', () => {
    const perm = createTestPermanent('1', 'Bear', 2, 2, '', 'player1', {
      counters: { '-1/-1': 5 },
    });
    
    expect(getCreaturePower(perm)).toBe(0);
    expect(getCreatureToughness(perm)).toBe(0);
  });
});

describe('Attack Validation', () => {
  it('should allow untapped creature to attack', () => {
    const perm = createTestPermanent('1', 'Bear', 2, 2);
    const creature = createCombatCreature(perm);
    
    const result = canCreatureAttack(creature, true, true);
    expect(result.canAttack).toBe(true);
  });

  it('should prevent tapped creature from attacking', () => {
    const perm = createTestPermanent('1', 'Bear', 2, 2, '', 'player1', { tapped: true });
    const creature = createCombatCreature(perm);
    
    const result = canCreatureAttack(creature, true, true);
    expect(result.canAttack).toBe(false);
    expect(result.reason).toContain('tapped');
  });

  it('should prevent defender from attacking', () => {
    const perm = createTestPermanent('1', 'Wall', 0, 5, 'Defender');
    const creature = createCombatCreature(perm);
    
    const result = canCreatureAttack(creature, true, true);
    expect(result.canAttack).toBe(false);
    expect(result.reason).toContain('defender');
  });

  it('should prevent creature with summoning sickness from attacking', () => {
    const perm = createTestPermanent('1', 'Bear', 2, 2, '', 'player1', { summoningSickness: true });
    const creature = createCombatCreature(perm);
    
    const result = canCreatureAttack(creature, true, false);
    expect(result.canAttack).toBe(false);
    expect(result.reason).toContain('summoning sickness');
  });

  it('should allow creature with haste to attack despite summoning sickness', () => {
    const perm = createTestPermanent('1', 'Bear', 2, 2, 'Haste', 'player1', { summoningSickness: true });
    const creature = createCombatCreature(perm);
    
    const result = canCreatureAttack(creature, true, false);
    expect(result.canAttack).toBe(true);
  });
});

describe('Block Validation', () => {
  it('should allow untapped creature to block', () => {
    const blockerPerm = createTestPermanent('1', 'Bear', 2, 2);
    const attackerPerm = createTestPermanent('2', 'Goblin', 1, 1);
    const blocker = createCombatCreature(blockerPerm);
    const attacker = createCombatCreature(attackerPerm);
    
    const result = canCreatureBlock(blocker, attacker, []);
    expect(result.legal).toBe(true);
  });

  it('should prevent non-flying from blocking flying', () => {
    const blockerPerm = createTestPermanent('1', 'Bear', 2, 2);
    const attackerPerm = createTestPermanent('2', 'Bird', 2, 2, 'Flying');
    const blocker = createCombatCreature(blockerPerm);
    const attacker = createCombatCreature(attackerPerm);
    
    const result = canCreatureBlock(blocker, attacker, []);
    expect(result.legal).toBe(false);
    expect(result.reason).toContain('flying');
  });

  it('should allow reach to block flying', () => {
    const blockerPerm = createTestPermanent('1', 'Spider', 2, 4, 'Reach');
    const attackerPerm = createTestPermanent('2', 'Bird', 2, 2, 'Flying');
    const blocker = createCombatCreature(blockerPerm);
    const attacker = createCombatCreature(attackerPerm);
    
    const result = canCreatureBlock(blocker, attacker, []);
    expect(result.legal).toBe(true);
  });

  it('should handle menace requirement', () => {
    const blockerPerm = createTestPermanent('1', 'Bear', 2, 2);
    const attackerPerm = createTestPermanent('2', 'Goblin', 2, 2, 'Menace');
    const blocker = createCombatCreature(blockerPerm);
    const attacker = createCombatCreature(attackerPerm);
    
    const result = canCreatureBlock(blocker, attacker, []);
    expect(result.legal).toBe(true);
    expect(result.requiredBlockers).toBe(2);
  });

  it('should prevent skulk from being blocked by larger creatures', () => {
    const blockerPerm = createTestPermanent('1', 'Giant', 5, 5);
    const attackerPerm = createTestPermanent('2', 'Rogue', 1, 1, 'Skulk');
    const blocker = createCombatCreature(blockerPerm);
    const attacker = createCombatCreature(attackerPerm);
    
    const result = canCreatureBlock(blocker, attacker, []);
    expect(result.legal).toBe(false);
    expect(result.reason).toContain('skulk');
  });

  it('should prevent non-shadow from blocking shadow', () => {
    const blockerPerm = createTestPermanent('1', 'Bear', 2, 2);
    const attackerPerm = createTestPermanent('2', 'Shade', 2, 2, 'Shadow');
    const blocker = createCombatCreature(blockerPerm);
    const attacker = createCombatCreature(attackerPerm);
    
    const result = canCreatureBlock(blocker, attacker, []);
    expect(result.legal).toBe(false);
    expect(result.reason).toContain('shadow');
  });
});

describe('Damage Calculation', () => {
  describe('calculateLethalDamage', () => {
    it('should calculate normal lethal damage', () => {
      const attackerPerm = createTestPermanent('1', 'Bear', 2, 2);
      const defenderPerm = createTestPermanent('2', 'Soldier', 2, 3);
      const attacker = createCombatCreature(attackerPerm);
      const defender = createCombatCreature(defenderPerm);
      
      expect(calculateLethalDamage(attacker, defender)).toBe(3);
    });

    it('should calculate 1 lethal damage with deathtouch', () => {
      const attackerPerm = createTestPermanent('1', 'Assassin', 1, 1, 'Deathtouch');
      const defenderPerm = createTestPermanent('2', 'Giant', 5, 5);
      const attacker = createCombatCreature(attackerPerm);
      const defender = createCombatCreature(defenderPerm);
      
      expect(calculateLethalDamage(attacker, defender)).toBe(1);
    });

    it('should account for existing damage', () => {
      const attackerPerm = createTestPermanent('1', 'Bear', 2, 2);
      const defenderPerm = createTestPermanent('2', 'Soldier', 2, 5, '', 'player1', {
        counters: { damage: 3 },
      });
      const attacker = createCombatCreature(attackerPerm);
      const defender = createCombatCreature(defenderPerm);
      
      expect(calculateLethalDamage(attacker, defender)).toBe(2);
    });
  });

  describe('calculateTrampleDamage', () => {
    it('should calculate trample damage', () => {
      const attackerPerm = createTestPermanent('1', 'Beast', 6, 6, 'Trample');
      const blockerPerm = createTestPermanent('2', 'Soldier', 2, 2);
      const attacker = createCombatCreature(attackerPerm);
      const blocker = createCombatCreature(blockerPerm);
      
      const trample = calculateTrampleDamage(attacker, [blocker], [{ blockerId: blocker.id, damage: 2 }]);
      expect(trample).toBe(4);
    });

    it('should return 0 for non-trample creatures', () => {
      const attackerPerm = createTestPermanent('1', 'Bear', 2, 2);
      const blockerPerm = createTestPermanent('2', 'Soldier', 1, 1);
      const attacker = createCombatCreature(attackerPerm);
      const blocker = createCombatCreature(blockerPerm);
      
      const trample = calculateTrampleDamage(attacker, [blocker], [{ blockerId: blocker.id, damage: 1 }]);
      expect(trample).toBe(0);
    });
  });
});

describe('Auto Damage Assignment', () => {
  it('should assign all damage to player when unblocked', () => {
    const attackerPerm = createTestPermanent('1', 'Bear', 2, 2);
    const attacker = createCombatCreature(attackerPerm);
    
    const result = autoAssignCombatDamage(attacker, [], 'player2');
    
    expect(result.needsPlayerChoice).toBe(false);
    expect(result.assignments).toHaveLength(1);
    expect(result.assignments[0].targetType).toBe('player');
    expect(result.assignments[0].amount).toBe(2);
  });

  it('should assign damage to single blocker and back', () => {
    const attackerPerm = createTestPermanent('1', 'Bear', 2, 2);
    const blockerPerm = createTestPermanent('2', 'Soldier', 1, 1);
    const attacker = createCombatCreature(attackerPerm);
    const blocker = createCombatCreature(blockerPerm);
    
    const result = autoAssignCombatDamage(attacker, [blocker], 'player2');
    
    expect(result.needsPlayerChoice).toBe(false);
    // Should have attacker->blocker and blocker->attacker
    expect(result.assignments.length).toBe(2);
  });

  it('should require player choice for multiple blockers', () => {
    const attackerPerm = createTestPermanent('1', 'Bear', 5, 5);
    const blocker1Perm = createTestPermanent('2', 'Soldier', 1, 1);
    const blocker2Perm = createTestPermanent('3', 'Knight', 2, 2);
    const attacker = createCombatCreature(attackerPerm);
    const blocker1 = createCombatCreature(blocker1Perm);
    const blocker2 = createCombatCreature(blocker2Perm);
    
    const result = autoAssignCombatDamage(attacker, [blocker1, blocker2], 'player2');
    
    expect(result.needsPlayerChoice).toBe(true);
    expect(result.choiceInfo?.type).toBe('blocker_order');
  });

  it('should include trample damage to player', () => {
    const attackerPerm = createTestPermanent('1', 'Beast', 6, 6, 'Trample');
    const blockerPerm = createTestPermanent('2', 'Soldier', 1, 2);
    const attacker = createCombatCreature(attackerPerm);
    const blocker = createCombatCreature(blockerPerm);
    
    const result = autoAssignCombatDamage(attacker, [blocker], 'player2');
    
    expect(result.needsPlayerChoice).toBe(false);
    const playerDamage = result.assignments.find(a => a.targetType === 'player');
    expect(playerDamage).toBeDefined();
    expect(playerDamage!.amount).toBe(4); // 6 power - 2 toughness = 4 trample
    expect(playerDamage!.isTrampleDamage).toBe(true);
  });
});

describe('Creature Death Check', () => {
  it('should detect lethal damage', () => {
    const perm = createTestPermanent('1', 'Bear', 2, 2);
    const creature = createCombatCreature(perm);
    
    expect(isCreatureKilled(creature, 2, false)).toBe(true);
    expect(isCreatureKilled(creature, 1, false)).toBe(false);
  });

  it('should detect deathtouch as lethal', () => {
    const perm = createTestPermanent('1', 'Giant', 5, 5);
    const creature = createCombatCreature(perm);
    
    expect(isCreatureKilled(creature, 1, true)).toBe(true);
  });

  it('should not kill indestructible creatures', () => {
    const perm = createTestPermanent('1', 'God', 5, 5, 'Indestructible');
    const creature = createCombatCreature(perm);
    
    expect(isCreatureKilled(creature, 10, false)).toBe(false);
    expect(isCreatureKilled(creature, 1, true)).toBe(false);
  });
});

describe('Combat Triggers', () => {
  it('should detect attack triggers', () => {
    const perm = createTestPermanent('1', 'Dragon', 4, 4, 'Whenever this creature attacks, add RRR.');
    const triggers = detectCombatTriggers(perm, 'attack');
    
    expect(triggers).toHaveLength(1);
    expect(triggers[0].triggerType).toBe('attack');
    expect(triggers[0].effect.toLowerCase()).toContain('add rrr');
  });

  it('should detect block triggers', () => {
    const perm = createTestPermanent('1', 'Wall', 0, 5, 'Whenever this creature blocks, draw a card.');
    const triggers = detectCombatTriggers(perm, 'block');
    
    expect(triggers).toHaveLength(1);
    expect(triggers[0].triggerType).toBe('block');
  });

  it('should detect damage dealt triggers', () => {
    const perm = createTestPermanent('1', 'Ninja', 2, 2, 'Whenever this creature deals combat damage to a player, draw a card.');
    const triggers = detectCombatTriggers(perm, 'damage_dealt');
    
    expect(triggers).toHaveLength(1);
    expect(triggers[0].triggerType).toBe('damage_dealt');
  });
});

describe('Full Combat Resolution', () => {
  it('should resolve unblocked combat', () => {
    const attackerPerm = createTestPermanent('1', 'Bear', 2, 2, '', 'player1');
    const attacker = createCombatCreature(attackerPerm);
    
    const result = resolveCombat(
      [{ attacker, defendingPlayerId: 'player2' }],
      [],
      { player1: 40, player2: 40 }
    );
    
    expect(result.damageAssignments).toHaveLength(1);
    expect(result.lifeTotal.player2).toBe(38);
    expect(result.creaturesKilled).toHaveLength(0);
  });

  it('should resolve blocked combat with creature death', () => {
    const attackerPerm = createTestPermanent('1', 'Bear', 2, 2, '', 'player1');
    const blockerPerm = createTestPermanent('2', 'Soldier', 1, 1, '', 'player2');
    const attacker = createCombatCreature(attackerPerm);
    const blocker = createCombatCreature(blockerPerm);
    
    const result = resolveCombat(
      [{ attacker, defendingPlayerId: 'player2' }],
      [{ blocker, attackerId: attacker.id }],
      { player1: 40, player2: 40 }
    );
    
    expect(result.creaturesKilled).toContain(blocker.id);
    expect(result.lifeTotal.player2).toBe(40); // No damage to player
  });

  it('should track lifelink life gain', () => {
    const attackerPerm = createTestPermanent('1', 'Vampire', 3, 3, 'Lifelink', 'player1');
    const attacker = createCombatCreature(attackerPerm);
    
    const result = resolveCombat(
      [{ attacker, defendingPlayerId: 'player2' }],
      [],
      { player1: 40, player2: 40 }
    );
    
    expect(result.lifeGained.player1).toBe(3);
    expect(result.lifeTotal.player1).toBe(43);
    expect(result.lifeTotal.player2).toBe(37);
  });
});
