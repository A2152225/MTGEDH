/**
 * Tests for trigger parsing from oracle text
 */
import { describe, it, expect } from 'vitest';
import {
  TriggerEvent,
  TriggerKeyword,
  parseTriggeredAbilitiesFromText,
  createEndStepTrigger,
  createLandfallTrigger,
  createCombatDamageToPlayerTrigger,
  createSpellCastTrigger,
  createLifeGainTrigger,
  createSacrificeTrigger,
  createCompoundTrigger,
  checkMultipleTriggers,
} from '../src/triggeredAbilities';

describe('Trigger Parsing', () => {
  describe('parseTriggeredAbilitiesFromText', () => {
    it('should parse ETB trigger from oracle text', () => {
      const oracleText = 'When Mulldrifter enters the battlefield, draw two cards.';
      const abilities = parseTriggeredAbilitiesFromText(oracleText, 'perm-1', 'player-1', 'Mulldrifter');
      
      expect(abilities.length).toBeGreaterThan(0);
      expect(abilities[0].keyword).toBe(TriggerKeyword.WHEN);
      expect(abilities[0].event).toBe(TriggerEvent.ENTERS_BATTLEFIELD);
    });
    
    it('should parse dies trigger from oracle text', () => {
      const oracleText = 'When Blood Artist dies, target player loses 1 life and you gain 1 life.';
      const abilities = parseTriggeredAbilitiesFromText(oracleText, 'perm-1', 'player-1', 'Blood Artist');
      
      expect(abilities.length).toBeGreaterThan(0);
      expect(abilities[0].event).toBe(TriggerEvent.DIES);
    });
    
    it('should parse whenever trigger for attacks', () => {
      const oracleText = 'Whenever Etali attacks, exile the top card of each player\'s library.';
      const abilities = parseTriggeredAbilitiesFromText(oracleText, 'perm-1', 'player-1', 'Etali');
      
      expect(abilities.length).toBeGreaterThan(0);
      expect(abilities[0].keyword).toBe(TriggerKeyword.WHENEVER);
      expect(abilities[0].event).toBe(TriggerEvent.ATTACKS);
    });
    
    it('should parse upkeep trigger', () => {
      const oracleText = 'At the beginning of your upkeep, you may draw a card.';
      const abilities = parseTriggeredAbilitiesFromText(oracleText, 'perm-1', 'player-1', 'Test Card');
      
      expect(abilities.length).toBeGreaterThan(0);
      expect(abilities[0].keyword).toBe(TriggerKeyword.AT);
      expect(abilities[0].event).toBe(TriggerEvent.BEGINNING_OF_UPKEEP);
      expect(abilities[0].optional).toBe(true);
    });
    
    it('should parse landfall trigger', () => {
      const oracleText = 'Whenever a land enters the battlefield under your control, put a +1/+1 counter on this creature.';
      const abilities = parseTriggeredAbilitiesFromText(oracleText, 'perm-1', 'player-1', 'Scute Swarm');
      
      expect(abilities.length).toBeGreaterThan(0);
      expect(abilities[0].event).toBe(TriggerEvent.LANDFALL);
    });
    
    it('should parse combat damage to player trigger', () => {
      const oracleText = 'Whenever this creature deals combat damage to a player, draw a card.';
      const abilities = parseTriggeredAbilitiesFromText(oracleText, 'perm-1', 'player-1', 'Ninja');
      
      expect(abilities.length).toBeGreaterThan(0);
      expect(abilities[0].event).toBe(TriggerEvent.DEALS_COMBAT_DAMAGE_TO_PLAYER);
    });
    
    it('should parse spell cast trigger', () => {
      const oracleText = 'Whenever you cast a creature spell, create a 1/1 token.';
      const abilities = parseTriggeredAbilitiesFromText(oracleText, 'perm-1', 'player-1', 'Token Maker');
      
      expect(abilities.length).toBeGreaterThan(0);
      expect(abilities[0].event).toBe(TriggerEvent.CREATURE_SPELL_CAST);
    });
    
    it('should parse life gain trigger', () => {
      const oracleText = 'Whenever you gain life, put a +1/+1 counter on this creature.';
      const abilities = parseTriggeredAbilitiesFromText(oracleText, 'perm-1', 'player-1', 'Archangel');
      
      expect(abilities.length).toBeGreaterThan(0);
      expect(abilities[0].event).toBe(TriggerEvent.GAINED_LIFE);
    });
    
    it('should detect optional triggers with "you may"', () => {
      const oracleText = 'Whenever this creature attacks, you may draw a card.';
      const abilities = parseTriggeredAbilitiesFromText(oracleText, 'perm-1', 'player-1', 'Test');
      
      expect(abilities.length).toBeGreaterThan(0);
      expect(abilities[0].optional).toBe(true);
    });
    
    it('should parse end step trigger', () => {
      const oracleText = 'At the beginning of your end step, create a 1/1 token.';
      const abilities = parseTriggeredAbilitiesFromText(oracleText, 'perm-1', 'player-1', 'Token Maker');
      
      expect(abilities.length).toBeGreaterThan(0);
      expect(abilities[0].event).toBe(TriggerEvent.BEGINNING_OF_END_STEP);
    });
    
    it('should parse sacrifice trigger', () => {
      const oracleText = 'Whenever you sacrifice an artifact, you may draw a card.';
      const abilities = parseTriggeredAbilitiesFromText(oracleText, 'perm-1', 'player-1', 'Artifact Synergy');
      
      expect(abilities.length).toBeGreaterThan(0);
      expect(abilities[0].event).toBe(TriggerEvent.ARTIFACT_SACRIFICED);
    });
  });
  
  describe('Trigger factory functions', () => {
    it('should create end step trigger', () => {
      const trigger = createEndStepTrigger('perm-1', 'Test Card', 'player-1', 'Create a token');
      
      expect(trigger.keyword).toBe(TriggerKeyword.AT);
      expect(trigger.event).toBe(TriggerEvent.BEGINNING_OF_END_STEP);
    });
    
    it('should create landfall trigger', () => {
      const trigger = createLandfallTrigger('perm-1', 'Test Card', 'player-1', 'Draw a card');
      
      expect(trigger.keyword).toBe(TriggerKeyword.WHENEVER);
      expect(trigger.event).toBe(TriggerEvent.LANDFALL);
    });
    
    it('should create combat damage to player trigger', () => {
      const trigger = createCombatDamageToPlayerTrigger('perm-1', 'Test Card', 'player-1', 'Draw a card');
      
      expect(trigger.event).toBe(TriggerEvent.DEALS_COMBAT_DAMAGE_TO_PLAYER);
    });
    
    it('should create spell cast trigger with filter', () => {
      const trigger = createSpellCastTrigger('perm-1', 'Test Card', 'player-1', 'Scry 1', { cardType: 'creature' });
      
      expect(trigger.event).toBe(TriggerEvent.CREATURE_SPELL_CAST);
    });
    
    it('should create life gain trigger', () => {
      const trigger = createLifeGainTrigger('perm-1', 'Test Card', 'player-1', 'Put a counter');
      
      expect(trigger.event).toBe(TriggerEvent.GAINED_LIFE);
    });
    
    it('should create sacrifice trigger with filter', () => {
      const trigger = createSacrificeTrigger('perm-1', 'Test Card', 'player-1', 'Draw a card', { permanentType: 'creature' });
      
      expect(trigger.event).toBe(TriggerEvent.CREATURE_SACRIFICED);
    });
  });
  
  describe('Compound triggers', () => {
    it('should create compound trigger for multiple events', () => {
      const triggers = createCompoundTrigger(
        'perm-1',
        'Test Card',
        'player-1',
        [TriggerEvent.ATTACKS, TriggerEvent.BLOCKS],
        'Deal 1 damage'
      );
      
      expect(triggers.length).toBe(2);
      expect(triggers[0].event).toBe(TriggerEvent.ATTACKS);
      expect(triggers[1].event).toBe(TriggerEvent.BLOCKS);
    });
    
    it('should check multiple triggers correctly', () => {
      const events = [TriggerEvent.ATTACKS, TriggerEvent.BLOCKS];
      
      expect(checkMultipleTriggers(events, TriggerEvent.ATTACKS)).toBe(true);
      expect(checkMultipleTriggers(events, TriggerEvent.BLOCKS)).toBe(true);
      expect(checkMultipleTriggers(events, TriggerEvent.DIES)).toBe(false);
    });
  });
  
  describe('New trigger event types', () => {
    it('should have all zone change events', () => {
      expect(TriggerEvent.PUT_INTO_GRAVEYARD).toBe('put_into_graveyard');
      expect(TriggerEvent.PUT_INTO_HAND).toBe('put_into_hand');
      expect(TriggerEvent.RETURNED_TO_HAND).toBe('returned_to_hand');
      expect(TriggerEvent.MILLED).toBe('milled');
    });
    
    it('should have all combat events', () => {
      expect(TriggerEvent.ATTACKS_ALONE).toBe('attacks_alone');
      expect(TriggerEvent.BLOCKED).toBe('blocked');
      expect(TriggerEvent.BECOMES_BLOCKED).toBe('becomes_blocked');
      expect(TriggerEvent.UNBLOCKED).toBe('unblocked');
      expect(TriggerEvent.DEALS_COMBAT_DAMAGE).toBe('deals_combat_damage');
      expect(TriggerEvent.DEALS_COMBAT_DAMAGE_TO_PLAYER).toBe('deals_combat_damage_to_player');
    });
    
    it('should have all turn structure events', () => {
      expect(TriggerEvent.BEGINNING_OF_TURN).toBe('beginning_of_turn');
      expect(TriggerEvent.BEGINNING_OF_DRAW_STEP).toBe('beginning_of_draw_step');
      expect(TriggerEvent.BEGINNING_OF_PRECOMBAT_MAIN).toBe('beginning_of_precombat_main');
      expect(TriggerEvent.BEGINNING_OF_POSTCOMBAT_MAIN).toBe('beginning_of_postcombat_main');
      expect(TriggerEvent.END_OF_COMBAT).toBe('end_of_combat');
      expect(TriggerEvent.CLEANUP_STEP).toBe('cleanup_step');
    });
    
    it('should have all spell/ability events', () => {
      expect(TriggerEvent.CREATURE_SPELL_CAST).toBe('creature_spell_cast');
      expect(TriggerEvent.NONCREATURE_SPELL_CAST).toBe('noncreature_spell_cast');
      expect(TriggerEvent.INSTANT_OR_SORCERY_CAST).toBe('instant_or_sorcery_cast');
      expect(TriggerEvent.SPELL_COUNTERED).toBe('spell_countered');
    });
    
    it('should have all state change events', () => {
      expect(TriggerEvent.GAINED_LIFE).toBe('gained_life');
      expect(TriggerEvent.LOST_LIFE).toBe('lost_life');
      expect(TriggerEvent.LIFE_PAID).toBe('life_paid');
    });
    
    it('should have all token/permanent events', () => {
      expect(TriggerEvent.TOKEN_CREATED).toBe('token_created');
      expect(TriggerEvent.TRANSFORMED).toBe('transformed');
      expect(TriggerEvent.BECAME_MONSTROUS).toBe('became_monstrous');
      expect(TriggerEvent.EQUIPPED).toBe('equipped');
    });
    
    it('should have all player action events', () => {
      expect(TriggerEvent.LANDFALL).toBe('landfall');
      expect(TriggerEvent.SEARCHED_LIBRARY).toBe('searched_library');
      expect(TriggerEvent.SCRIED).toBe('scried');
      expect(TriggerEvent.SURVEIL).toBe('surveil');
    });
    
    it('should have all sacrifice events', () => {
      expect(TriggerEvent.SACRIFICED).toBe('sacrificed');
      expect(TriggerEvent.CREATURE_SACRIFICED).toBe('creature_sacrificed');
      expect(TriggerEvent.ARTIFACT_SACRIFICED).toBe('artifact_sacrificed');
    });
  });
});
