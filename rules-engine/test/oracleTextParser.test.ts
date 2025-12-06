/**
 * Tests for oracle text parsing
 */
import { describe, it, expect } from 'vitest';
import {
  parseOracleText,
  parseActivatedAbility,
  parseTriggeredAbility,
  parseReplacementEffect,
  parseKeywordActions,
  parseKeywords,
  parseDelayedTrigger,
  hasTriggeredAbility,
  hasActivatedAbility,
  hasReplacementEffect,
  AbilityType,
} from '../src/oracleTextParser';

describe('Oracle Text Parser', () => {
  describe('parseActivatedAbility', () => {
    it('should parse basic tap mana ability', () => {
      const result = parseActivatedAbility('{T}: Add {G}.');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.ACTIVATED);
      expect(result?.cost).toBe('{T}');
      expect(result?.effect).toBe('Add {G}.');
      expect(result?.isManaAbility).toBe(true);
    });

    it('should parse activated ability with mana cost', () => {
      const result = parseActivatedAbility('{1}{R}, Sacrifice a goblin: It deals 2 damage to any target.');
      expect(result).not.toBeNull();
      expect(result?.cost).toBe('{1}{R}, Sacrifice a goblin');
      expect(result?.effect).toBe('It deals 2 damage to any target.');
      expect(result?.isManaAbility).toBe(false);
    });

    it('should parse planeswalker loyalty ability', () => {
      const result = parseActivatedAbility('+1: You gain 2 life.');
      expect(result).not.toBeNull();
      expect(result?.isLoyaltyAbility).toBe(true);
      expect(result?.cost).toBe('+1');
      expect(result?.effect).toBe('You gain 2 life.');
    });

    it('should parse negative loyalty ability', () => {
      const result = parseActivatedAbility('−3: Return target creature to its owner\'s hand.');
      expect(result).not.toBeNull();
      expect(result?.isLoyaltyAbility).toBe(true);
      expect(result?.cost).toBe('−3');
    });

    it('should parse keyword abilities with cost', () => {
      const result = parseActivatedAbility('Equip {2}');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.KEYWORD);
      expect(result?.cost).toBe('{2}');
      expect(result?.effect).toBe('Equip');
    });

    it('should parse cycling ability', () => {
      const result = parseActivatedAbility('Cycling {1}');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.KEYWORD);
      expect(result?.cost).toBe('{1}');
      expect(result?.effect).toBe('Cycling');
    });

    it('should detect optional abilities with "you may"', () => {
      const result = parseActivatedAbility('{T}: You may draw a card.');
      expect(result).not.toBeNull();
      expect(result?.isOptional).toBe(true);
    });
  });

  describe('parseTriggeredAbility', () => {
    it('should parse "When enters" ETB trigger', () => {
      const result = parseTriggeredAbility('When this creature enters the battlefield, draw a card.');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.TRIGGERED);
      expect(result?.triggerKeyword).toBe('when');
      expect(result?.triggerCondition).toBe('this creature enters the battlefield');
      expect(result?.effect).toBe('draw a card.');
    });

    it('should parse "Whenever" landfall trigger', () => {
      const result = parseTriggeredAbility('Whenever a land enters the battlefield under your control, you gain 1 life.');
      expect(result).not.toBeNull();
      expect(result?.triggerKeyword).toBe('whenever');
      expect(result?.triggerCondition).toBe('a land enters the battlefield under your control');
      expect(result?.effect).toBe('you gain 1 life.');
    });

    it('should parse "At the beginning" upkeep trigger', () => {
      const result = parseTriggeredAbility('At the beginning of your upkeep, sacrifice this creature.');
      expect(result).not.toBeNull();
      expect(result?.triggerKeyword).toBe('at');
      expect(result?.triggerCondition).toBe('the beginning of your upkeep');
    });

    it('should parse "At each" trigger', () => {
      const result = parseTriggeredAbility('At the beginning of each end step, return this to your hand.');
      expect(result).not.toBeNull();
      expect(result?.triggerKeyword).toBe('at');
      expect(result?.triggerCondition).toBe('the beginning of each end step');
    });

    it('should parse intervening-if clause', () => {
      const result = parseTriggeredAbility('When this permanent enters the battlefield, if you control three artifacts, draw a card.');
      expect(result).not.toBeNull();
      expect(result?.interveningIf).toBe('you control three artifacts');
      expect(result?.effect).toBe('draw a card.');
    });

    it('should detect optional "you may" triggers', () => {
      const result = parseTriggeredAbility('Whenever this creature attacks, you may draw a card.');
      expect(result).not.toBeNull();
      expect(result?.isOptional).toBe(true);
    });

    it('should parse targets in triggered abilities', () => {
      const result = parseTriggeredAbility('When this creature dies, target player loses 1 life.');
      expect(result).not.toBeNull();
      expect(result?.targets).toContain('player');
    });
  });

  describe('parseReplacementEffect', () => {
    it('should parse "If would, instead" replacement', () => {
      const result = parseReplacementEffect('If you would draw a card, exile the top two cards of your library instead.');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.REPLACEMENT);
      expect(result?.triggerCondition).toBe('you');
      expect(result?.effect).toBe('exile the top two cards of your library');
    });

    it('should parse "enters the battlefield tapped" replacement', () => {
      const result = parseReplacementEffect('This land enters the battlefield tapped.');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.REPLACEMENT);
    });

    it('should parse "As enters the battlefield" clone effect', () => {
      const result = parseReplacementEffect('As Clone enters the battlefield, you may choose a creature on the battlefield.');
      expect(result).not.toBeNull();
      expect(result?.type).toBe(AbilityType.REPLACEMENT);
      expect(result?.isOptional).toBe(true);
    });
  });

  describe('parseKeywordActions', () => {
    it('should parse scry action', () => {
      const result = parseKeywordActions('Scry 2.');
      expect(result).toContainEqual(expect.objectContaining({
        action: 'scry',
        value: 2,
      }));
    });

    it('should parse mill action', () => {
      const result = parseKeywordActions('Target player mills 4 cards.');
      expect(result).toContainEqual(expect.objectContaining({
        action: 'mill',
        value: 4,
      }));
    });

    it('should parse token creation', () => {
      const result = parseKeywordActions('Create a 1/1 white Soldier creature token.');
      expect(result).toContainEqual(expect.objectContaining({
        action: 'create',
      }));
    });

    it('should parse power/toughness modification', () => {
      const result = parseKeywordActions('Target creature gets +2/+2 until end of turn.');
      expect(result).toContainEqual(expect.objectContaining({
        action: 'ptMod',
        value: '+2/+2',
      }));
    });

    it('should parse life gain', () => {
      const result = parseKeywordActions('You gain 3 life.');
      expect(result).toContainEqual(expect.objectContaining({
        action: 'gainLife',
        value: 3,
      }));
    });

    it('should parse damage dealing', () => {
      const result = parseKeywordActions('This creature deals 2 damage to any target.');
      expect(result).toContainEqual(expect.objectContaining({
        action: 'dealDamage',
        value: 2,
      }));
    });
  });

  describe('parseKeywords', () => {
    it('should detect flying', () => {
      expect(parseKeywords('Flying')).toContain('flying');
    });

    it('should detect multiple keywords', () => {
      const result = parseKeywords('Flying, vigilance, lifelink');
      expect(result).toContain('flying');
      expect(result).toContain('vigilance');
      expect(result).toContain('lifelink');
    });

    it('should detect deathtouch', () => {
      expect(parseKeywords('Deathtouch')).toContain('deathtouch');
    });

    it('should detect trample', () => {
      expect(parseKeywords('Trample')).toContain('trample');
    });

    it('should detect first strike and double strike', () => {
      expect(parseKeywords('First strike')).toContain('first strike');
      expect(parseKeywords('Double strike')).toContain('double strike');
    });

    it('should detect hexproof and shroud', () => {
      expect(parseKeywords('Hexproof')).toContain('hexproof');
      expect(parseKeywords('Shroud')).toContain('shroud');
    });

    it('should detect indestructible', () => {
      expect(parseKeywords('Indestructible')).toContain('indestructible');
    });

    it('should detect protection', () => {
      expect(parseKeywords('Protection from red')).toContain('protection');
    });
  });

  describe('parseDelayedTrigger', () => {
    it('should parse end step delayed trigger', () => {
      const result = parseDelayedTrigger('Exile it at the beginning of the next end step.');
      expect(result).not.toBeNull();
      expect(result?.effect).toBe('Exile it');
      expect(result?.timing).toBe('end step');
    });

    it('should parse upkeep delayed trigger', () => {
      const result = parseDelayedTrigger('Return this card to the battlefield at the beginning of the next upkeep.');
      expect(result).not.toBeNull();
      expect(result?.timing).toBe('upkeep');
    });
  });

  describe('parseOracleText (comprehensive)', () => {
    it('should parse a card with both triggered and activated abilities', () => {
      const text = 'When this creature enters the battlefield, draw a card.\n{T}: Add {G}.';
      const result = parseOracleText(text);
      
      expect(result.isTriggered).toBe(true);
      expect(result.isActivated).toBe(true);
      expect(result.abilities.length).toBeGreaterThanOrEqual(2);
    });

    it('should parse modal spell text', () => {
      const text = 'Choose one —\n• Counter target spell.\n• Draw two cards.';
      const result = parseOracleText(text);
      
      expect(result.hasModes).toBe(true);
    });

    it('should detect targeting in spells', () => {
      const text = 'Destroy target creature.';
      const result = parseOracleText(text);
      
      expect(result.hasTargets).toBe(true);
    });

    it('should parse complex planeswalker card', () => {
      const text = '+1: You gain 2 life.\n−2: Put a +1/+1 counter on each creature you control.\n−6: You get an emblem with "Whenever a creature dies, return it to the battlefield under your control."';
      const result = parseOracleText(text);
      
      expect(result.isActivated).toBe(true);
      expect(result.abilities.filter(a => a.isLoyaltyAbility).length).toBe(3);
    });

    it('should parse Mulldrifter-style ETB', () => {
      const text = 'When Mulldrifter enters the battlefield, draw two cards.';
      const result = parseOracleText(text, 'Mulldrifter');
      
      expect(result.isTriggered).toBe(true);
      expect(result.abilities.length).toBeGreaterThan(0);
    });
  });

  describe('Quick check functions', () => {
    describe('hasTriggeredAbility', () => {
      it('should detect "when" triggers', () => {
        expect(hasTriggeredAbility('When this creature dies, draw a card.')).toBe(true);
      });

      it('should detect "whenever" triggers', () => {
        expect(hasTriggeredAbility('Whenever a creature enters, put a counter on it.')).toBe(true);
      });

      it('should detect "at the beginning" triggers', () => {
        expect(hasTriggeredAbility('At the beginning of your upkeep, scry 1.')).toBe(true);
      });

      it('should return false for non-triggered text', () => {
        expect(hasTriggeredAbility('Flying, vigilance')).toBe(false);
      });
    });

    describe('hasActivatedAbility', () => {
      it('should detect activated ability with colon', () => {
        expect(hasActivatedAbility('{T}: Add {G}.')).toBe(true);
      });

      it('should not confuse triggered abilities', () => {
        expect(hasActivatedAbility('When this enters: draw a card.')).toBe(false);
      });

      it('should return false for simple keywords', () => {
        expect(hasActivatedAbility('Flying')).toBe(false);
      });
    });

    describe('hasReplacementEffect', () => {
      it('should detect "instead" replacement', () => {
        expect(hasReplacementEffect('If would die, exile it instead.')).toBe(true);
      });

      it('should detect "enters tapped" replacement', () => {
        expect(hasReplacementEffect('This land enters the battlefield tapped.')).toBe(true);
      });

      it('should detect "enters with" replacement', () => {
        expect(hasReplacementEffect('This creature enters the battlefield with two +1/+1 counters.')).toBe(true);
      });

      it('should detect "As enters" replacement', () => {
        expect(hasReplacementEffect('As Clone enters the battlefield, choose a creature.')).toBe(true);
      });
    });
  });

  describe('Continuation Sentence Merging', () => {
    it('should merge ". Spend" restriction sentences (Altar of the Lost)', () => {
      const text = '{T}: Add two mana in any combination of colors. Spend this mana only to cast spells with flashback from a graveyard.';
      const result = parseOracleText(text);
      
      // Should have one activated ability with the full effect including the restriction
      const activatedAbilities = result.abilities.filter(a => a.type === AbilityType.ACTIVATED);
      expect(activatedAbilities.length).toBeGreaterThanOrEqual(1);
      
      // The effect should include both the mana production and the spending restriction
      const manaAbility = activatedAbilities[0];
      expect(manaAbility.effect).toContain('Add two mana');
      expect(manaAbility.effect).toContain('Spend this mana only to cast spells with flashback');
    });

    it('should merge ". Then" continuation sentences', () => {
      const text = 'Draw two cards. Then discard a card.';
      const result = parseOracleText(text);
      
      // Should parse as a single static ability with the complete effect
      const staticAbilities = result.abilities.filter(a => a.type === AbilityType.STATIC);
      expect(staticAbilities.length).toBeGreaterThanOrEqual(1);
      expect(staticAbilities[0].text).toContain('Draw two cards');
      expect(staticAbilities[0].text).toContain('Then discard a card');
    });

    it('should merge ". You may" continuation sentences', () => {
      const text = 'Exile target creature. You may cast it until end of turn.';
      const result = parseOracleText(text);
      
      // Should be a single ability with both parts
      const staticAbilities = result.abilities.filter(a => a.type === AbilityType.STATIC);
      expect(staticAbilities.length).toBeGreaterThanOrEqual(1);
      expect(staticAbilities[0].text).toContain('Exile target creature');
      expect(staticAbilities[0].text).toContain('You may cast it');
    });

    it('should merge ". If you do" continuation sentences', () => {
      const text = 'Sacrifice a creature. If you do, draw two cards.';
      const result = parseOracleText(text);
      
      const staticAbilities = result.abilities.filter(a => a.type === AbilityType.STATIC);
      expect(staticAbilities.length).toBeGreaterThanOrEqual(1);
      expect(staticAbilities[0].text).toContain('Sacrifice a creature');
      expect(staticAbilities[0].text).toContain('If you do');
    });

    it('should merge ". It gains" continuation sentences', () => {
      const text = 'Target creature gets +2/+0 until end of turn. It gains first strike until end of turn.';
      const result = parseOracleText(text);
      
      const staticAbilities = result.abilities.filter(a => a.type === AbilityType.STATIC);
      expect(staticAbilities.length).toBeGreaterThanOrEqual(1);
      expect(staticAbilities[0].text).toContain('+2/+0');
      expect(staticAbilities[0].text).toContain('It gains first strike');
    });

    it('should merge ". Return" continuation sentences', () => {
      const text = 'Exile target creature. Return it to the battlefield under your control at the beginning of the next end step.';
      const result = parseOracleText(text);
      
      const staticAbilities = result.abilities.filter(a => a.type === AbilityType.STATIC);
      expect(staticAbilities.length).toBeGreaterThanOrEqual(1);
      expect(staticAbilities[0].text).toContain('Exile target creature');
      expect(staticAbilities[0].text).toContain('Return it to the battlefield');
    });

    it('should merge ". Until" duration sentences', () => {
      const text = 'Target creature gains vigilance. Until end of turn, it also gains lifelink.';
      const result = parseOracleText(text);
      
      const staticAbilities = result.abilities.filter(a => a.type === AbilityType.STATIC);
      expect(staticAbilities.length).toBeGreaterThanOrEqual(1);
      expect(staticAbilities[0].text).toContain('vigilance');
      expect(staticAbilities[0].text).toContain('Until end of turn');
    });

    it('should merge ". Create" token creation sentences', () => {
      const text = 'Draw a card. Create a 1/1 white Soldier creature token.';
      const result = parseOracleText(text);
      
      const staticAbilities = result.abilities.filter(a => a.type === AbilityType.STATIC);
      expect(staticAbilities.length).toBeGreaterThanOrEqual(1);
      expect(staticAbilities[0].text).toContain('Draw a card');
      expect(staticAbilities[0].text).toContain('Create a 1/1');
    });

    it('should merge ". That" reference sentences', () => {
      const text = 'Put a +1/+1 counter on target creature. That creature gains trample until end of turn.';
      const result = parseOracleText(text);
      
      const staticAbilities = result.abilities.filter(a => a.type === AbilityType.STATIC);
      expect(staticAbilities.length).toBeGreaterThanOrEqual(1);
      expect(staticAbilities[0].text).toContain('+1/+1 counter');
      expect(staticAbilities[0].text).toContain('That creature gains trample');
    });

    it('should merge ". Activate" restriction sentences', () => {
      const text = '{2}, {T}: Draw a card. Activate only as a sorcery.';
      const result = parseOracleText(text);
      
      const activatedAbilities = result.abilities.filter(a => a.type === AbilityType.ACTIVATED);
      expect(activatedAbilities.length).toBeGreaterThanOrEqual(1);
      expect(activatedAbilities[0].effect).toContain('Draw a card');
      expect(activatedAbilities[0].effect).toContain('Activate only as a sorcery');
    });

    it('should NOT merge triggered abilities starting with "When"', () => {
      const text = 'When this creature enters the battlefield, draw a card.\nWhen this creature dies, lose 1 life.';
      const result = parseOracleText(text);
      
      // Should have TWO separate triggered abilities
      const triggeredAbilities = result.abilities.filter(a => a.type === AbilityType.TRIGGERED);
      expect(triggeredAbilities.length).toBe(2);
    });

    it('should NOT merge triggered abilities starting with "Whenever"', () => {
      const text = 'Whenever a creature enters, scry 1.\nWhenever a creature dies, gain 1 life.';
      const result = parseOracleText(text);
      
      // Should have TWO separate triggered abilities
      const triggeredAbilities = result.abilities.filter(a => a.type === AbilityType.TRIGGERED);
      expect(triggeredAbilities.length).toBe(2);
    });

    it('should merge multiple continuation sentences in sequence', () => {
      const text = 'Destroy target creature. It can\'t be regenerated. Draw a card.';
      const result = parseOracleText(text);
      
      const staticAbilities = result.abilities.filter(a => a.type === AbilityType.STATIC);
      expect(staticAbilities.length).toBeGreaterThanOrEqual(1);
      expect(staticAbilities[0].text).toContain('Destroy target creature');
      expect(staticAbilities[0].text).toContain('can\'t be regenerated');
      expect(staticAbilities[0].text).toContain('Draw a card');
    });

    it('should handle complex card with multiple abilities', () => {
      const text = 'Flying\n{T}: Add {U}. Spend this mana only to cast instant or sorcery spells.\nWhenever you cast an instant or sorcery spell, scry 1.';
      const result = parseOracleText(text);
      
      // Should have:
      // 1. Flying keyword
      expect(result.keywords).toContain('flying');
      
      // 2. One activated ability with merged effect
      const activatedAbilities = result.abilities.filter(a => a.type === AbilityType.ACTIVATED);
      expect(activatedAbilities.length).toBeGreaterThanOrEqual(1);
      const manaAbility = activatedAbilities.find(a => a.effect?.includes('Add {U}'));
      expect(manaAbility).toBeDefined();
      expect(manaAbility?.effect).toContain('Spend this mana only to cast');
      
      // 3. One triggered ability (should NOT merge with activated ability)
      const triggeredAbilities = result.abilities.filter(a => a.type === AbilityType.TRIGGERED);
      expect(triggeredAbilities.length).toBeGreaterThanOrEqual(1);
    });

    it('should only merge when continuation appears after ". " (period space)', () => {
      // Test that "Spend" at the start of oracle text is NOT treated as continuation
      const spendAtStart = 'Spend this mana only to cast instant or sorcery spells.';
      const startResult = parseOracleText(spendAtStart);
      // Should parse as a static ability, not be ignored
      expect(startResult.abilities.length).toBeGreaterThanOrEqual(1);

      // Test that "Spend" after ". " IS treated as continuation
      const spendAfterPeriod = '{T}: Add {U}. Spend this mana only to cast instant or sorcery spells.';
      const afterResult = parseOracleText(spendAfterPeriod);
      const activatedAbilities = afterResult.abilities.filter(a => a.type === AbilityType.ACTIVATED);
      expect(activatedAbilities.length).toBe(1);
      expect(activatedAbilities[0].effect).toContain('Add {U}');
      expect(activatedAbilities[0].effect).toContain('Spend this mana');
    });

    it('should not merge when term appears after newline instead of period', () => {
      // Newlines separate abilities, so "Then" on a new line should NOT merge
      const textWithNewline = 'Draw a card.\nThen each opponent loses 1 life.';
      const result = parseOracleText(textWithNewline);
      
      // Should have TWO separate abilities (split by newline)
      const staticAbilities = result.abilities.filter(a => a.type === AbilityType.STATIC);
      expect(staticAbilities.length).toBeGreaterThanOrEqual(2);
    });
  });
});
