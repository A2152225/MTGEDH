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
    
    it('should parse Hardened Scales counter modification effect', () => {
      const oracleText = 'If one or more +1/+1 counters would be put on a creature you control, that many plus one +1/+1 counters are put on it instead.';
      const effects = parseReplacementEffectsFromText(oracleText, 'perm-1', 'player-1', 'Hardened Scales');
      
      expect(effects.length).toBeGreaterThan(0);
      const modifiedEffect = effects.find(e => e.type === ReplacementEffectType.MODIFIED_COUNTERS);
      expect(modifiedEffect).toBeDefined();
      expect(modifiedEffect?.value).toBe('+1');
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
    
    it('should apply Hardened Scales counter modification effect', () => {
      const effect = {
        type: ReplacementEffectType.MODIFIED_COUNTERS,
        sourceId: 'hardened-scales-1',
        controllerId: 'player-1',
        affectedEvent: 'place_counter',
        replacement: 'place that many plus one instead',
        isSelfReplacement: false,
        value: '+1',
      };
      
      const result = applyReplacementEffect(effect, { counterCount: 2 });
      
      expect(result.applied).toBe(true);
      expect(result.modifiedEvent?.counterCount).toBe(3); // 2 + 1 = 3
    });
    
    it('should apply Hardened Scales effect with single counter', () => {
      const effect = {
        type: ReplacementEffectType.MODIFIED_COUNTERS,
        sourceId: 'hardened-scales-1',
        controllerId: 'player-1',
        affectedEvent: 'place_counter',
        replacement: 'place that many plus one instead',
        isSelfReplacement: false,
        value: '+1',
      };
      
      const result = applyReplacementEffect(effect, { counterCount: 1 });
      
      expect(result.applied).toBe(true);
      expect(result.modifiedEvent?.counterCount).toBe(2); // 1 + 1 = 2
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
  
  describe('Mox Diamond-style conditional ETB', () => {
    it('should parse Mox Diamond replacement effect', () => {
      const oracleText = 'If Mox Diamond would enter the battlefield, you may discard a land card instead. If you do, put Mox Diamond onto the battlefield. If you don\'t, put it into its owner\'s graveyard.';
      const effects = parseReplacementEffectsFromText(oracleText, 'mox-diamond-1', 'player-1', 'Mox Diamond');
      
      expect(effects.length).toBeGreaterThan(0);
      const conditionalEffect = effects.find(e => e.type === ReplacementEffectType.ENTERS_CONDITIONAL);
      expect(conditionalEffect).toBeDefined();
      expect(conditionalEffect?.requiresChoice).toBe(true);
      expect(conditionalEffect?.requiredAction).toContain('discard a land card');
      expect(conditionalEffect?.isSelfReplacement).toBe(true);
    });
    
    it('should apply Mox Diamond effect when player chooses to discard', () => {
      const effect = {
        type: ReplacementEffectType.ENTERS_CONDITIONAL,
        sourceId: 'mox-diamond-1',
        controllerId: 'player-1',
        affectedEvent: 'enters_battlefield',
        replacement: 'put Mox Diamond onto the battlefield',
        isSelfReplacement: true,
        requiresChoice: true,
        requiredAction: 'discard a land card',
        elseEffect: 'put it into its owner\'s graveyard',
      };
      
      const result = applyReplacementEffect(effect, { permanentId: 'mox-diamond-1', playerMadeChoice: true });
      
      expect(result.applied).toBe(true);
      expect(result.modifiedEvent?.enters).toBe(true);
    });
    
    it('should apply Mox Diamond effect when player declines to discard', () => {
      const effect = {
        type: ReplacementEffectType.ENTERS_CONDITIONAL,
        sourceId: 'mox-diamond-1',
        controllerId: 'player-1',
        affectedEvent: 'enters_battlefield',
        replacement: 'put Mox Diamond onto the battlefield',
        isSelfReplacement: true,
        requiresChoice: true,
        requiredAction: 'discard a land card',
        elseEffect: 'put it into its owner\'s graveyard',
      };
      
      const result = applyReplacementEffect(effect, { permanentId: 'mox-diamond-1', playerMadeChoice: false });
      
      expect(result.applied).toBe(true);
      expect(result.modifiedEvent?.enters).toBe(false);
      expect(result.modifiedEvent?.goesToGraveyard).toBe(true);
      expect(result.preventedEvent).toBe(true);
    });
  });
  
  describe('Undead Alchemist-style combat damage to mill', () => {
    it('should parse Undead Alchemist combat damage replacement', () => {
      const oracleText = 'If a Zombie you control would deal combat damage to a player, instead that player mills that many cards.';
      const effects = parseReplacementEffectsFromText(oracleText, 'undead-alchemist-1', 'player-1', 'Undead Alchemist');
      
      expect(effects.length).toBeGreaterThan(0);
      const millEffect = effects.find(e => e.type === ReplacementEffectType.COMBAT_DAMAGE_TO_MILL);
      expect(millEffect).toBeDefined();
      expect(millEffect?.appliesToTypes).toContain('Zombie');
    });
    
    it('should apply combat damage to mill replacement for matching creature type', () => {
      const effect = {
        type: ReplacementEffectType.COMBAT_DAMAGE_TO_MILL,
        sourceId: 'undead-alchemist-1',
        controllerId: 'player-1',
        affectedEvent: 'combat_damage_to_player',
        replacement: 'player mills cards instead',
        isSelfReplacement: false,
        appliesToTypes: ['Zombie'],
        value: 'damage_amount',
      };
      
      const result = applyReplacementEffect(effect, { damage: 3, attackerTypes: ['Zombie', 'Creature'] });
      
      expect(result.applied).toBe(true);
      expect(result.modifiedEvent?.damage).toBe(0);
      expect(result.modifiedEvent?.millAmount).toBe(3);
      expect(result.modifiedEvent?.replacedByMill).toBe(true);
    });
    
    it('should not apply combat damage to mill for non-matching creature type', () => {
      const effect = {
        type: ReplacementEffectType.COMBAT_DAMAGE_TO_MILL,
        sourceId: 'undead-alchemist-1',
        controllerId: 'player-1',
        affectedEvent: 'combat_damage_to_player',
        replacement: 'player mills cards instead',
        isSelfReplacement: false,
        appliesToTypes: ['Zombie'],
        value: 'damage_amount',
      };
      
      const result = applyReplacementEffect(effect, { damage: 3, attackerTypes: ['Human', 'Creature'] });
      
      expect(result.applied).toBe(false);
    });
  });
  
  describe('Graveyard to exile replacement (Rest in Peace style)', () => {
    it('should parse Rest in Peace graveyard replacement', () => {
      const oracleText = 'If a card or token would be put into a graveyard from anywhere, exile it instead.';
      const effects = parseReplacementEffectsFromText(oracleText, 'rest-in-peace-1', 'player-1', 'Rest in Peace');
      
      expect(effects.length).toBeGreaterThan(0);
      const exileEffect = effects.find(e => e.type === ReplacementEffectType.GRAVEYARD_TO_EXILE);
      expect(exileEffect).toBeDefined();
    });
    
    it('should parse Leyline of the Void opponent-only replacement', () => {
      const oracleText = "If a card would be put into an opponent's graveyard from anywhere, exile it instead.";
      const effects = parseReplacementEffectsFromText(oracleText, 'leyline-1', 'player-1', 'Leyline of the Void');
      
      expect(effects.length).toBeGreaterThan(0);
      const exileEffect = effects.find(e => e.type === ReplacementEffectType.GRAVEYARD_TO_EXILE);
      expect(exileEffect).toBeDefined();
      expect(exileEffect?.condition).toBe('opponent_only');
    });
    
    it('should apply graveyard to exile replacement', () => {
      const effect = {
        type: ReplacementEffectType.GRAVEYARD_TO_EXILE,
        sourceId: 'rest-in-peace-1',
        controllerId: 'player-1',
        affectedEvent: 'put_into_graveyard',
        replacement: 'exile instead',
        isSelfReplacement: false,
      };
      
      const result = applyReplacementEffect(effect, { cardId: 'card-1', destination: 'graveyard' });
      
      expect(result.applied).toBe(true);
      expect(result.modifiedEvent?.destination).toBe('exile');
      expect(result.modifiedEvent?.replacedByExile).toBe(true);
    });
  });
  
  describe('Oona-style exile from library', () => {
    it('should parse Oona exile from library pattern', () => {
      const oracleText = '{X}{U/B}: Choose a color. Target opponent exiles the top X cards of their library. For each card of the chosen color exiled this way, create a 1/1 blue and black Faerie Rogue creature token with flying.';
      const effects = parseReplacementEffectsFromText(oracleText, 'oona-1', 'player-1', 'Oona, Queen of the Fae');
      
      expect(effects.length).toBeGreaterThan(0);
      const exileEffect = effects.find(e => e.type === ReplacementEffectType.MILL_TO_EXILE);
      expect(exileEffect).toBeDefined();
      expect(exileEffect?.value).toBe('X');
    });
    
    it('should apply mill to exile replacement', () => {
      const effect = {
        type: ReplacementEffectType.MILL_TO_EXILE,
        sourceId: 'oona-1',
        controllerId: 'player-1',
        affectedEvent: 'mill',
        replacement: 'exile instead of mill',
        isSelfReplacement: false,
        value: 'X',
      };
      
      const result = applyReplacementEffect(effect, { xValue: 5 });
      
      expect(result.applied).toBe(true);
      expect(result.modifiedEvent?.millCount).toBe(5);
      expect(result.modifiedEvent?.destination).toBe('exile');
      expect(result.modifiedEvent?.exiledFromLibrary).toBe(true);
    });
  });
});
