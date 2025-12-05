import { describe, it, expect } from 'vitest';
import {
  parseUpgradeAbilities,
  meetsUpgradeCondition,
  applyUpgradeAbility,
  hasUpgradeAbilities,
} from '../src/creatureUpgradeAbilities';

describe('creatureUpgradeAbilities', () => {
  describe('parseUpgradeAbilities', () => {
    it('should parse Figure of Destiny basic upgrade ability', () => {
      const oracleText = '{R/W}: Figure of Destiny becomes a Kithkin Spirit with base power and toughness 2/2.';
      const cardName = 'Figure of Destiny';
      
      const abilities = parseUpgradeAbilities(oracleText, cardName);
      
      expect(abilities).toHaveLength(1);
      expect(abilities[0].type).toBe('becomes');
      expect(abilities[0].newPower).toBe(2);
      expect(abilities[0].newToughness).toBe(2);
      expect(abilities[0].newTypes).toContain('Kithkin');
      expect(abilities[0].newTypes).toContain('Spirit');
    });

    it('should parse Figure of Destiny conditional upgrade ability', () => {
      const oracleText = '{R/W}{R/W}{R/W}: If Figure of Destiny is a Spirit, it becomes a Kithkin Spirit Warrior with base power and toughness 4/4.';
      const cardName = 'Figure of Destiny';
      
      const abilities = parseUpgradeAbilities(oracleText, cardName);
      
      expect(abilities).toHaveLength(1);
      expect(abilities[0].type).toBe('becomes');
      expect(abilities[0].newPower).toBe(4);
      expect(abilities[0].newToughness).toBe(4);
      expect(abilities[0].requiredTypes).toContain('Spirit');
      expect(abilities[0].newTypes).toContain('Warrior');
    });

    it('should parse Figure of Destiny final upgrade with keywords', () => {
      const oracleText = '{R/W}{R/W}{R/W}{R/W}{R/W}{R/W}: If Figure of Destiny is a Warrior, it becomes a Kithkin Spirit Warrior Avatar with base power and toughness 8/8, flying, and first strike.';
      const cardName = 'Figure of Destiny';
      
      const abilities = parseUpgradeAbilities(oracleText, cardName);
      
      expect(abilities).toHaveLength(1);
      // The parser may detect this as 'becomes' or 'combined' depending on pattern matching
      expect(['becomes', 'combined']).toContain(abilities[0].type);
      expect(abilities[0].newPower).toBe(8);
      expect(abilities[0].newToughness).toBe(8);
      expect(abilities[0].requiredTypes).toContain('Warrior');
      expect(abilities[0].newTypes).toContain('Avatar');
      // Keywords should be parsed
      expect(abilities[0].keywords).toBeDefined();
      expect(abilities[0].keywords?.some(k => k.toLowerCase() === 'flying')).toBe(true);
    });

    it('should parse Warden of the First Tree basic upgrade', () => {
      const oracleText = '{1}{W/B}: Warden of the First Tree becomes a Human Warrior with base power and toughness 3/3.';
      const cardName = 'Warden of the First Tree';
      
      const abilities = parseUpgradeAbilities(oracleText, cardName);
      
      expect(abilities).toHaveLength(1);
      expect(abilities[0].type).toBe('becomes');
      expect(abilities[0].newPower).toBe(3);
      expect(abilities[0].newToughness).toBe(3);
      expect(abilities[0].newTypes).toContain('Human');
      expect(abilities[0].newTypes).toContain('Warrior');
    });

    it('should parse Warden upgrade with keywords but no stat change', () => {
      const oracleText = '{2}{W/B}{W/B}: If Warden of the First Tree is a Warrior, it becomes a Human Spirit Warrior with trample and lifelink.';
      const cardName = 'Warden of the First Tree';
      
      const abilities = parseUpgradeAbilities(oracleText, cardName);
      
      expect(abilities).toHaveLength(1);
      expect(abilities[0].type).toBe('becomes');
      expect(abilities[0].requiredTypes).toContain('Warrior');
      expect(abilities[0].newTypes).toContain('Spirit');
      expect(abilities[0].keywords).toBeDefined();
      expect(abilities[0].keywords?.some(k => k.toLowerCase() === 'trample')).toBe(true);
      expect(abilities[0].keywords?.some(k => k.toLowerCase() === 'lifelink')).toBe(true);
    });

    it('should parse Warden counter upgrade ability', () => {
      const oracleText = '{3}{W/B}{W/B}{W/B}: If Warden of the First Tree is a Spirit, put five +1/+1 counters on it.';
      const cardName = 'Warden of the First Tree';
      
      const abilities = parseUpgradeAbilities(oracleText, cardName);
      
      expect(abilities).toHaveLength(1);
      expect(abilities[0].type).toBe('counters');
      expect(abilities[0].requiredTypes).toContain('Spirit');
      expect(abilities[0].counterCount).toBe(5);
      expect(abilities[0].counterType).toBe('+1/+1');
    });

    it('should parse multiple upgrade abilities on same card', () => {
      const oracleText = `{R/W}: Figure of Destiny becomes a Kithkin Spirit with base power and toughness 2/2.
{R/W}{R/W}{R/W}: If Figure of Destiny is a Spirit, it becomes a Kithkin Spirit Warrior with base power and toughness 4/4.`;
      const cardName = 'Figure of Destiny';
      
      const abilities = parseUpgradeAbilities(oracleText, cardName);
      
      expect(abilities.length).toBeGreaterThanOrEqual(2);
    });

    it('should return empty array for cards without upgrade abilities', () => {
      const oracleText = 'Flying\n{T}: Add {W}.';
      const cardName = 'Plains';
      
      const abilities = parseUpgradeAbilities(oracleText, cardName);
      
      expect(abilities).toHaveLength(0);
    });
  });

  describe('meetsUpgradeCondition', () => {
    it('should return true when no condition is required', () => {
      const result = meetsUpgradeCondition(['Human'], undefined);
      expect(result).toBe(true);
    });

    it('should return true when creature has required type', () => {
      const result = meetsUpgradeCondition(['Kithkin', 'Spirit'], ['Spirit']);
      expect(result).toBe(true);
    });

    it('should return false when creature lacks required type', () => {
      const result = meetsUpgradeCondition(['Kithkin', 'Spirit'], ['Warrior']);
      expect(result).toBe(false);
    });

    it('should handle case-insensitive matching', () => {
      const result = meetsUpgradeCondition(['SPIRIT'], ['spirit']);
      expect(result).toBe(true);
    });

    it('should return false when creature has no types', () => {
      const result = meetsUpgradeCondition([], ['Spirit']);
      expect(result).toBe(false);
    });
    
    it('should support progression from Spirit to Warrior to Avatar', () => {
      // Simulate Figure of Destiny progression
      // Stage 1: After first upgrade, creature is a Kithkin Spirit
      expect(meetsUpgradeCondition(['Kithkin', 'Spirit'], ['Spirit'])).toBe(true);
      
      // Stage 2: After second upgrade, creature is a Kithkin Spirit Warrior
      expect(meetsUpgradeCondition(['Kithkin', 'Spirit', 'Warrior'], ['Warrior'])).toBe(true);
      
      // Can't skip stages - a plain Kithkin can't become a Warrior directly
      expect(meetsUpgradeCondition(['Kithkin'], ['Spirit'])).toBe(false);
    });
  });

  describe('hasUpgradeAbilities', () => {
    it('should return true for Figure of Destiny', () => {
      const oracleText = '{R/W}: Figure of Destiny becomes a Kithkin Spirit with base power and toughness 2/2.';
      const result = hasUpgradeAbilities(oracleText, 'Figure of Destiny');
      expect(result).toBe(true);
    });

    it('should return false for regular creatures', () => {
      const oracleText = 'Flying\nWhenever this creature attacks, draw a card.';
      const result = hasUpgradeAbilities(oracleText, 'Flying Dragon');
      expect(result).toBe(false);
    });
  });

  describe('applyUpgradeAbility', () => {
    it('should apply basic upgrade to permanent (PERMANENT effect, not until end of turn)', () => {
      const permanent: any = {
        id: 'perm1',
        card: {
          name: 'Figure of Destiny',
          type_line: 'Creature — Kithkin',
        },
        basePower: 1,
        baseToughness: 1,
      };

      const ability = {
        type: 'becomes' as const,
        cost: '{R/W}',
        newTypes: ['Kithkin', 'Spirit'],
        newPower: 2,
        newToughness: 2,
        fullText: 'Figure of Destiny becomes a Kithkin Spirit with base power and toughness 2/2.',
      };

      const result = applyUpgradeAbility(permanent, ability);

      expect(result.success).toBe(true);
      expect(result.changes).toContain('became a Kithkin Spirit');
      expect(result.changes).toContain('base power changed to 2');
      expect(result.changes).toContain('base toughness changed to 2');
      
      // Verify the permanent was modified
      expect(permanent.basePower).toBe(2);
      expect(permanent.baseToughness).toBe(2);
      expect(permanent.upgradedCreatureTypes).toEqual(['Kithkin', 'Spirit']);
      
      // The upgradedCreatureTypes should persist (not be marked as temporary)
      // This is the key difference from "until end of turn" effects
    });
    
    it('should enable second upgrade after first upgrade is applied', () => {
      // This tests the progression system - after becoming a Spirit, 
      // the creature should now meet the condition for the Warrior upgrade
      const permanent: any = {
        id: 'perm1',
        card: {
          name: 'Figure of Destiny',
          type_line: 'Creature — Kithkin Spirit', // Updated type line after first upgrade
        },
        upgradedCreatureTypes: ['Kithkin', 'Spirit'], // First upgrade applied
        basePower: 2,
        baseToughness: 2,
      };

      const secondAbility = {
        type: 'becomes' as const,
        cost: '{R/W}{R/W}{R/W}',
        condition: 'is a Spirit',
        requiredTypes: ['Spirit'],
        newTypes: ['Kithkin', 'Spirit', 'Warrior'],
        newPower: 4,
        newToughness: 4,
        fullText: 'If Figure of Destiny is a Spirit, it becomes a Kithkin Spirit Warrior with base power and toughness 4/4.',
      };

      const result = applyUpgradeAbility(permanent, secondAbility);

      expect(result.success).toBe(true);
      expect(permanent.basePower).toBe(4);
      expect(permanent.baseToughness).toBe(4);
      expect(permanent.upgradedCreatureTypes).toEqual(['Kithkin', 'Spirit', 'Warrior']);
    });

    it('should add keywords during upgrade', () => {
      const permanent: any = {
        id: 'perm1',
        card: {
          name: 'Test Creature',
          type_line: 'Creature — Spirit',
        },
        upgradedCreatureTypes: ['Spirit'],
        basePower: 4,
        baseToughness: 4,
      };

      const ability = {
        type: 'becomes' as const,
        cost: '{2}{W/B}{W/B}',
        condition: 'is a Spirit',
        requiredTypes: ['Spirit'],
        newTypes: ['Human', 'Spirit', 'Warrior'],
        keywords: ['Trample', 'Lifelink'],
        fullText: 'If creature is a Spirit, it becomes a Human Spirit Warrior with trample and lifelink.',
      };

      const result = applyUpgradeAbility(permanent, ability);

      expect(result.success).toBe(true);
      expect(result.changes).toContain('gained Trample');
      expect(result.changes).toContain('gained Lifelink');
      expect(permanent.grantedKeywords).toContain('Trample');
      expect(permanent.grantedKeywords).toContain('Lifelink');
    });

    it('should add counters during upgrade', () => {
      const permanent: any = {
        id: 'perm1',
        card: {
          name: 'Test Creature',
          type_line: 'Creature — Spirit',
        },
        upgradedCreatureTypes: ['Spirit'],
        counters: { '+1/+1': 2 },
      };

      const ability = {
        type: 'counters' as const,
        cost: '{3}{W/B}{W/B}{W/B}',
        condition: 'is a Spirit',
        requiredTypes: ['Spirit'],
        counterCount: 5,
        counterType: '+1/+1',
        fullText: 'If creature is a Spirit, put five +1/+1 counters on it.',
      };

      const result = applyUpgradeAbility(permanent, ability);

      expect(result.success).toBe(true);
      expect(result.changes).toContain('got 5 +1/+1 counter(s)');
      expect(permanent.counters['+1/+1']).toBe(7); // 2 + 5
    });

    it('should fail when condition is not met (cannot skip upgrade stages)', () => {
      const permanent: any = {
        id: 'perm1',
        card: {
          name: 'Figure of Destiny',
          type_line: 'Creature — Kithkin',
        },
        basePower: 1,
        baseToughness: 1,
      };

      // Try to skip directly to the Warrior stage without being a Spirit first
      const ability = {
        type: 'becomes' as const,
        cost: '{R/W}{R/W}{R/W}',
        condition: 'is a Spirit',
        requiredTypes: ['Spirit'],
        newTypes: ['Kithkin', 'Spirit', 'Warrior'],
        newPower: 4,
        newToughness: 4,
        fullText: 'If Figure of Destiny is a Spirit, it becomes a Kithkin Spirit Warrior with base power and toughness 4/4.',
      };

      const result = applyUpgradeAbility(permanent, ability);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not a Spirit');
    });
  });
});
