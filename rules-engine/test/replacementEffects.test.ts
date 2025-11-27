/**
 * Tests for replacement effects parsing and application
 */
import { describe, it, expect } from 'vitest';
import {
  ReplacementEffectType,
  parseReplacementEffectsFromText,
  evaluateETBCondition,
  applyReplacementEffect,
  sortReplacementEffects,
} from '../src/replacementEffects';

describe('Replacement Effects', () => {
  describe('parseReplacementEffectsFromText', () => {
    it('should parse "enters the battlefield tapped" effect', () => {
      const oracleText = 'Evolving Wilds enters the battlefield tapped.';
      const effects = parseReplacementEffectsFromText(oracleText, 'perm-1', 'player-1', 'Evolving Wilds');
      
      expect(effects.length).toBeGreaterThan(0);
      expect(effects[0].type).toBe(ReplacementEffectType.ENTERS_TAPPED);
      expect(effects[0].isSelfReplacement).toBe(true);
    });
    
    it('should parse "enters with counters" effect', () => {
      const oracleText = 'Spike Feeder enters the battlefield with 2 +1/+1 counters on it.';
      const effects = parseReplacementEffectsFromText(oracleText, 'perm-1', 'player-1', 'Spike Feeder');
      
      expect(effects.length).toBeGreaterThan(0);
      expect(effects[0].type).toBe(ReplacementEffectType.ENTERS_WITH_COUNTERS);
      expect(effects[0].value).toBe('2:+1/+1');
    });
    
    it('should parse damage prevention effect', () => {
      const oracleText = 'Prevent all damage that would be dealt to creatures.';
      const effects = parseReplacementEffectsFromText(oracleText, 'perm-1', 'player-1', 'Fog');
      
      expect(effects.length).toBeGreaterThan(0);
      expect(effects[0].type).toBe(ReplacementEffectType.PREVENT_DAMAGE);
    });
    
    it('should parse "if would die, instead" effect', () => {
      const oracleText = 'If this creature would die, instead exile it with an indestructible counter.';
      const effects = parseReplacementEffectsFromText(oracleText, 'perm-1', 'player-1', 'Phoenix');
      
      expect(effects.length).toBeGreaterThan(0);
      expect(effects[0].type).toBe(ReplacementEffectType.DIES_WITH_EFFECT);
    });
    
    it('should parse token doubling effect', () => {
      const oracleText = 'If an effect would create one or more tokens, instead create twice that many.';
      const effects = parseReplacementEffectsFromText(oracleText, 'perm-1', 'player-1', 'Doubling Season');
      
      expect(effects.length).toBeGreaterThan(0);
      expect(effects[0].type).toBe(ReplacementEffectType.EXTRA_TOKENS);
    });
    
    it('should parse counter doubling effect', () => {
      const oracleText = 'If an effect would put one or more counters on a creature, instead put twice that many.';
      const effects = parseReplacementEffectsFromText(oracleText, 'perm-1', 'player-1', 'Doubling Season');
      
      expect(effects.length).toBeGreaterThan(0);
      expect(effects[0].type).toBe(ReplacementEffectType.EXTRA_COUNTERS);
    });
  });
  
  describe('evaluateETBCondition', () => {
    it('should handle always tapped lands', () => {
      const card = {
        oracle_text: 'Evolving Wilds enters the battlefield tapped.',
        name: 'Evolving Wilds',
      };
      
      const result = evaluateETBCondition(card as any, 0, []);
      expect(result.entersTapped).toBe(true);
    });
    
    it('should handle fast lands (2 or fewer other lands = untapped)', () => {
      const card = {
        oracle_text: 'This land enters the battlefield tapped unless you control two or fewer other lands.',
        name: 'Blooming Marsh',
      };
      
      // With 0 lands (first land), should be untapped
      const result1 = evaluateETBCondition(card as any, 0, []);
      expect(result1.entersTapped).toBe(false);
      
      // With 2 lands, should be untapped
      const result2 = evaluateETBCondition(card as any, 2, []);
      expect(result2.entersTapped).toBe(false);
      
      // With 3 lands, should be tapped
      const result3 = evaluateETBCondition(card as any, 3, []);
      expect(result3.entersTapped).toBe(true);
    });
    
    it('should handle slow lands (2 or more other lands = untapped)', () => {
      const card = {
        oracle_text: 'This land enters the battlefield tapped unless you control two or more other lands.',
        name: 'Deserted Beach',
      };
      
      // With 0 lands, should be tapped
      const result1 = evaluateETBCondition(card as any, 0, []);
      expect(result1.entersTapped).toBe(true);
      
      // With 1 land, should be tapped
      const result2 = evaluateETBCondition(card as any, 1, []);
      expect(result2.entersTapped).toBe(true);
      
      // With 2 lands, should be untapped
      const result3 = evaluateETBCondition(card as any, 2, []);
      expect(result3.entersTapped).toBe(false);
    });
    
    it('should handle check lands', () => {
      const card = {
        oracle_text: 'This land enters the battlefield tapped unless you control a Swamp or Mountain.',
        name: 'Dragonskull Summit',
      };
      
      // With no matching lands, should be tapped
      const result1 = evaluateETBCondition(card as any, 0, ['Plains', 'Island']);
      expect(result1.entersTapped).toBe(true);
      
      // With Swamp, should be untapped
      const result2 = evaluateETBCondition(card as any, 1, ['Swamp']);
      expect(result2.entersTapped).toBe(false);
      
      // With Mountain, should be untapped
      const result3 = evaluateETBCondition(card as any, 1, ['Mountain']);
      expect(result3.entersTapped).toBe(false);
    });
    
    it('should handle shock lands with life payment', () => {
      const card = {
        oracle_text: 'As this land enters the battlefield, you may pay 2 life. If you don\'t, it enters tapped.',
        name: 'Blood Crypt',
      };
      
      // Paid life, should be untapped
      const result1 = evaluateETBCondition(card as any, 0, [], true);
      expect(result1.entersTapped).toBe(false);
      expect(result1.playerChoice).toBe(true);
      
      // Didn't pay life, should be tapped
      const result2 = evaluateETBCondition(card as any, 0, [], false);
      expect(result2.entersTapped).toBe(true);
    });
  });
  
  describe('applyReplacementEffect', () => {
    it('should apply enters tapped effect', () => {
      const effect = {
        type: ReplacementEffectType.ENTERS_TAPPED,
        sourceId: 'perm-1',
        controllerId: 'player-1',
        affectedEvent: 'enters_battlefield',
        replacement: 'enters tapped',
        isSelfReplacement: true,
      };
      
      const result = applyReplacementEffect(effect, { permanentId: 'perm-1' });
      
      expect(result.applied).toBe(true);
      expect(result.modifiedEvent?.entersTapped).toBe(true);
    });
    
    it('should apply damage prevention effect', () => {
      const effect = {
        type: ReplacementEffectType.PREVENT_DAMAGE,
        sourceId: 'perm-1',
        controllerId: 'player-1',
        affectedEvent: 'damage',
        replacement: 'prevent damage',
        isSelfReplacement: false,
        value: 3,
      };
      
      const result = applyReplacementEffect(effect, { damage: 5 });
      
      expect(result.applied).toBe(true);
      expect(result.modifiedEvent?.damage).toBe(2);
    });
    
    it('should apply prevent all damage effect', () => {
      const effect = {
        type: ReplacementEffectType.PREVENT_DAMAGE,
        sourceId: 'perm-1',
        controllerId: 'player-1',
        affectedEvent: 'damage',
        replacement: 'prevent all damage',
        isSelfReplacement: false,
      };
      
      const result = applyReplacementEffect(effect, { damage: 10 });
      
      expect(result.applied).toBe(true);
      expect(result.modifiedEvent?.damage).toBe(0);
      expect(result.preventedEvent).toBe(true);
    });
    
    it('should apply token doubling effect', () => {
      const effect = {
        type: ReplacementEffectType.EXTRA_TOKENS,
        sourceId: 'perm-1',
        controllerId: 'player-1',
        affectedEvent: 'create_token',
        replacement: 'double',
        isSelfReplacement: false,
      };
      
      const result = applyReplacementEffect(effect, { tokenCount: 3 });
      
      expect(result.applied).toBe(true);
      expect(result.modifiedEvent?.tokenCount).toBe(6);
    });
    
    it('should apply counter doubling effect', () => {
      const effect = {
        type: ReplacementEffectType.EXTRA_COUNTERS,
        sourceId: 'perm-1',
        controllerId: 'player-1',
        affectedEvent: 'place_counter',
        replacement: 'double',
        isSelfReplacement: false,
      };
      
      const result = applyReplacementEffect(effect, { counterCount: 2 });
      
      expect(result.applied).toBe(true);
      expect(result.modifiedEvent?.counterCount).toBe(4);
    });
  });
  
  describe('sortReplacementEffects', () => {
    it('should sort self-replacement effects first', () => {
      const effects = [
        {
          type: ReplacementEffectType.PREVENT_DAMAGE,
          sourceId: 'other-perm',
          controllerId: 'player-1',
          affectedEvent: 'damage',
          replacement: 'prevent',
          isSelfReplacement: false,
        },
        {
          type: ReplacementEffectType.PREVENT_DAMAGE,
          sourceId: 'event-source',
          controllerId: 'player-1',
          affectedEvent: 'damage',
          replacement: 'prevent self',
          isSelfReplacement: true,
        },
      ];
      
      const sorted = sortReplacementEffects(effects, 'event-source');
      
      expect(sorted[0].isSelfReplacement).toBe(true);
      expect(sorted[0].sourceId).toBe('event-source');
    });
  });
});
