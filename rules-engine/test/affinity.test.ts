/**
 * Tests for Affinity mechanic
 */
import { describe, it, expect } from 'vitest';
import {
  hasAffinity,
  parseAffinityType,
  AFFINITY_CARDS,
  type AffinityConfig,
} from '../src/cards/costReduction';

describe('Affinity Mechanic', () => {
  describe('Well-known affinity cards', () => {
    it('should recognize Thoughtcast', () => {
      expect(hasAffinity('Thoughtcast')).toBe(true);
      const config = AFFINITY_CARDS['thoughtcast'];
      expect(config?.affinityFor).toBe('artifacts');
      expect(config?.reductionPer).toBe(1);
    });

    it('should recognize Frogmite', () => {
      expect(hasAffinity('Frogmite')).toBe(true);
      const config = AFFINITY_CARDS['frogmite'];
      expect(config?.affinityFor).toBe('artifacts');
    });

    it('should recognize Myr Enforcer', () => {
      expect(hasAffinity('Myr Enforcer')).toBe(true);
      const config = AFFINITY_CARDS['myr enforcer'];
      expect(config?.affinityFor).toBe('artifacts');
    });
  });

  describe('Parse affinity from oracle text', () => {
    it('should parse affinity for artifacts', () => {
      const oracleText = 'Affinity for artifacts (This spell costs {1} less to cast for each artifact you control.)';
      const type = parseAffinityType(oracleText);
      expect(type).toBe('artifacts');
    });

    it('should parse affinity for Plains', () => {
      const oracleText = 'Affinity for Plains';
      const type = parseAffinityType(oracleText);
      expect(type).toBe('plains');
    });

    it('should parse affinity for equipment', () => {
      const oracleText = 'Affinity for Equipment';
      const type = parseAffinityType(oracleText);
      expect(type).toBe('equipment');
    });

    it('should return undefined for non-affinity text', () => {
      const oracleText = 'Draw a card';
      const type = parseAffinityType(oracleText);
      expect(type).toBeUndefined();
    });
  });

  describe('hasAffinity detection', () => {
    it('should detect affinity in oracle text', () => {
      const result = hasAffinity(
        'Unknown Card',
        'Affinity for creatures (This spell costs {1} less to cast for each creature you control.)'
      );
      expect(result).toBe(true);
    });

    it('should detect affinity case-insensitively', () => {
      const result = hasAffinity(
        'Unknown Card',
        'AFFINITY FOR ARTIFACTS'
      );
      expect(result).toBe(true);
    });

    it('should not detect affinity when not present', () => {
      const result = hasAffinity(
        'Lightning Bolt',
        'Lightning Bolt deals 3 damage to any target.'
      );
      expect(result).toBe(false);
    });
  });

  describe('Affinity cost calculation examples', () => {
    it('should calculate Thoughtcast cost with 5 artifacts', () => {
      // Thoughtcast base cost: {4}{U}
      // With 5 artifacts: {U} (reduced by 4)
      const baseCost = { generic: 4, blue: 1 };
      const artifactCount = 5;
      const reduction = Math.min(baseCost.generic || 0, artifactCount);
      
      const finalCost = {
        ...baseCost,
        generic: Math.max(0, (baseCost.generic || 0) - reduction),
      };

      expect(finalCost.generic).toBe(0);
      expect(finalCost.blue).toBe(1);
    });

    it('should calculate Frogmite cost with 4 artifacts', () => {
      // Frogmite base cost: {4}
      // With 4 artifacts: {0} (free)
      const baseCost = { generic: 4 };
      const artifactCount = 4;
      const reduction = Math.min(baseCost.generic || 0, artifactCount);
      
      const finalCost = {
        generic: Math.max(0, (baseCost.generic || 0) - reduction),
      };

      expect(finalCost.generic).toBe(0);
    });

    it('should not reduce beyond generic cost', () => {
      // Card with {2}{R}
      // 5 artifacts, but only 2 generic to reduce
      const baseCost = { generic: 2, red: 1 };
      const artifactCount = 5;
      const reduction = Math.min(baseCost.generic || 0, artifactCount);
      
      const finalCost = {
        ...baseCost,
        generic: Math.max(0, (baseCost.generic || 0) - reduction),
      };

      expect(finalCost.generic).toBe(0);
      expect(finalCost.red).toBe(1); // Colored mana not affected
    });
  });
});
