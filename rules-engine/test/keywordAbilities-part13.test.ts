/**
 * Tests for Part 13 Keyword Abilities (Rules 702.177-702.183)
 * BRJOM through EMGS era mechanics
 */

import { describe, it, expect } from 'vitest';
import {
  mobilize,
  executeMobilize,
  getMobilizeTokens,
  getMobilizeValue,
  hasRedundantMobilize,
  parseMobilizeValue,
  MOBILIZE_WARRIOR_TOKEN,
} from '../src/keywordAbilities';

describe('Part 13: Keyword Abilities (Rules 702.177-702.183)', () => {
  describe('Mobilize (702.181)', () => {
    it('should create Mobilize ability with value', () => {
      const ability = mobilize('creature1', 3);
      
      expect(ability.type).toBe('mobilize');
      expect(ability.source).toBe('creature1');
      expect(ability.mobilizeValue).toBe(3);
      expect(ability.tokenIds).toEqual([]);
    });

    it('should get mobilize value', () => {
      const ability = mobilize('creature1', 5);
      expect(getMobilizeValue(ability)).toBe(5);
    });

    it('should have correct Warrior token characteristics', () => {
      expect(MOBILIZE_WARRIOR_TOKEN.name).toBe('Warrior');
      expect(MOBILIZE_WARRIOR_TOKEN.colors).toContain('R');
      expect(MOBILIZE_WARRIOR_TOKEN.power).toBe(1);
      expect(MOBILIZE_WARRIOR_TOKEN.toughness).toBe(1);
      expect(MOBILIZE_WARRIOR_TOKEN.entersTapped).toBe(true);
      expect(MOBILIZE_WARRIOR_TOKEN.entersAttacking).toBe(true);
      expect(MOBILIZE_WARRIOR_TOKEN.sacrificeAtEndStep).toBe(true);
    });

    it('should execute mobilize and create Warrior tokens', () => {
      const result = executeMobilize('creature1', 3, 'player1');
      
      expect(result.ability.type).toBe('mobilize');
      expect(result.ability.mobilizeValue).toBe(3);
      expect(result.tokens).toHaveLength(3);
      
      // Check each token
      for (const token of result.tokens) {
        expect(token.controller).toBe('player1');
        expect(token.tapped).toBe(true); // Enters tapped
        expect(token.isToken).toBe(true);
        expect(token.basePower).toBe(1);
        expect(token.baseToughness).toBe(1);
        expect(token.sacrificeAtEndStep).toBe(true);
        expect(token.isAttacking).toBe(true);
        expect((token.card as any).name).toBe('Warrior');
      }
    });

    it('should get mobilize tokens after execution', () => {
      const result = executeMobilize('creature1', 2, 'player1');
      const tokenIds = getMobilizeTokens(result.ability);
      
      expect(tokenIds).toHaveLength(2);
    });

    it('should not have redundant mobilize abilities', () => {
      const abilities = [
        mobilize('creature1', 2),
        mobilize('creature2', 3),
      ];
      
      expect(hasRedundantMobilize(abilities)).toBe(false);
    });

    it('should parse mobilize value from oracle text', () => {
      expect(parseMobilizeValue('Mobilize 2 (Whenever this creature attacks...)')).toBe(2);
      expect(parseMobilizeValue('Mobilize 5')).toBe(5);
      expect(parseMobilizeValue('Flying')).toBeNull();
      expect(parseMobilizeValue('')).toBeNull();
    });

    it('should create unique token IDs', () => {
      const result = executeMobilize('creature1', 3, 'player1');
      const ids = result.tokens.map(t => t.id);
      const uniqueIds = new Set(ids);
      
      expect(uniqueIds.size).toBe(3); // All IDs should be unique
    });

    it('should include log message in result', () => {
      const result = executeMobilize('creature1', 2, 'player1');
      
      expect(result.log).toContain('Mobilize 2');
      expect(result.log).toContain('Warrior');
    });
  });
});
