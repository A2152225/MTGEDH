/**
 * Tests for trigger parsing from oracle text
 */
import { describe, it, expect } from 'vitest';
import type { GameState } from '../../shared/src';
import { makeMerfolkIterationState } from './helpers/merfolkIterationFixture';
import { ChoiceEventType } from '../src/choiceEvents';
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
  createEmptyTriggerQueue,
  putTriggersOnStack,
  processEvent,
  buildResolutionEventDataFromGameState,
  buildTriggeredAbilityEventDataFromChoices,
  buildTriggerEventDataFromPayloads,
  buildStackTriggerMetaFromEventData,
  buildOracleIRExecutionEventHintFromTriggerData,
  buildTriggeredAbilityChoiceEvents,
  executeTriggeredAbilityEffectWithOracleIR,
  processEventAndExecuteTriggeredOracle,
  evaluateTriggerCondition,
} from '../src/triggeredAbilities';

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    id: 'game1',
    format: 'commander',
    players: [
      {
        id: 'p1',
        name: 'P1',
        seat: 0,
        life: 40,
        library: [{ id: 'p1c1' }, { id: 'p1c2' }],
        hand: [],
        graveyard: [],
        exile: [],
      } as any,
      {
        id: 'p2',
        name: 'P2',
        seat: 1,
        life: 40,
        library: [{ id: 'p2c1' }, { id: 'p2c2' }],
        hand: [],
        graveyard: [],
        exile: [],
      } as any,
      {
        id: 'p3',
        name: 'P3',
        seat: 2,
        life: 40,
        library: [{ id: 'p3c1' }, { id: 'p3c2' }],
        hand: [],
        graveyard: [],
        exile: [],
      } as any,
    ],
    startingLife: 40,
    life: {},
    turnPlayer: 'p1',
    priority: 'p1',
    stack: [],
    battlefield: [],
    commandZone: {} as any,
    phase: 'pre_game' as any,
    active: true,
    ...overrides,
  } as any;
}

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

    it('should preserve each filter on upkeep triggers', () => {
      const oracleText = 'At the beginning of each upkeep, draw a card.';
      const abilities = parseTriggeredAbilitiesFromText(oracleText, 'perm-1', 'player-1', 'Shared Upkeep Source');

      expect(abilities).toHaveLength(1);
      expect(abilities[0].event).toBe(TriggerEvent.BEGINNING_OF_UPKEEP);
      expect(abilities[0].triggerFilter).toBe('each');
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

    it('should preserve multi-sentence trigger effects on the same line', () => {
      const oracleText =
        "Whenever this creature deals combat damage to a player, exile the top card of each of those opponents' libraries. You may play those cards this turn.";
      const abilities = parseTriggeredAbilitiesFromText(oracleText, 'perm-1', 'player-1', 'Relational Exile Source');

      expect(abilities.length).toBeGreaterThan(0);
      expect(abilities[0].event).toBe(TriggerEvent.DEALS_COMBAT_DAMAGE_TO_PLAYER);
      expect(String(abilities[0].effect || '')).toContain("exile the top card of each of those opponents' libraries");
      expect(String(abilities[0].effect || '')).toContain('you may play those cards this turn');
    });

    it('should preserve multiline trigger effects until the next trigger header', () => {
      const oracleText =
        "Whenever this creature deals combat damage to a player, exile the top card of each of those opponents' libraries.\nYou may play those cards this turn.";
      const abilities = parseTriggeredAbilitiesFromText(oracleText, 'perm-1', 'player-1', 'Relational Exile Source');

      expect(abilities.length).toBeGreaterThan(0);
      expect(abilities[0].event).toBe(TriggerEvent.DEALS_COMBAT_DAMAGE_TO_PLAYER);
      expect(String(abilities[0].effect || '')).toContain('you may play those cards this turn');
    });

    it('should split adjacent trigger headers into separate parsed abilities', () => {
      const oracleText =
        'Whenever this creature attacks, draw a card. Whenever this creature deals combat damage to a player, create a Treasure token.';
      const abilities = parseTriggeredAbilitiesFromText(oracleText, 'perm-1', 'player-1', 'Dual Trigger Source');

      expect(abilities.length).toBe(2);
      expect(abilities[0].event).toBe(TriggerEvent.ATTACKS);
      expect(abilities[1].event).toBe(TriggerEvent.DEALS_COMBAT_DAMAGE_TO_PLAYER);
      expect(String(abilities[0].effect || '')).toContain('draw a card');
      expect(String(abilities[1].effect || '')).toContain('create a treasure token');
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

    it('should parse Judge of Currents as a Merfolk tap trigger', () => {
      const oracleText = 'Whenever a Merfolk you control becomes tapped, you may gain 1 life.';
      const abilities = parseTriggeredAbilitiesFromText(oracleText, 'perm-1', 'player-1', 'Judge of Currents');

      expect(abilities).toHaveLength(1);
      expect(abilities[0].event).toBe(TriggerEvent.BECOMES_TAPPED);
      expect(abilities[0].triggerFilter).toBe('a merfolk you control becomes tapped');
      expect(abilities[0].optional).toBe(true);
    });

    it('preserves filtered controlled-creature dies triggers with keyword exclusions', () => {
      const oracleText =
        "Whenever a creature you control without flying dies, return it to the battlefield under its owner's control with a flying counter on it.";
      const abilities = parseTriggeredAbilitiesFromText(oracleText, 'perm-1', 'player-1', 'Luminous Broodmoth');

      expect(abilities).toHaveLength(1);
      expect(abilities[0].event).toBe(TriggerEvent.CONTROLLED_CREATURE_DIED);
      expect(abilities[0].triggerFilter).toBe('a creature you control without flying dies');
      expect(String(abilities[0].effect || '')).toContain('with a flying counter on it');
    });

    it('preserves controlled-creature dies filters with ownership exclusions', () => {
      const oracleText =
        "Whenever a creature you control but don't own dies, return it to the battlefield under its owner's control and you draw a card.";
      const abilities = parseTriggeredAbilitiesFromText(oracleText, 'edea-1', 'player-1', 'Edea, Possessed Sorceress');

      expect(abilities).toHaveLength(1);
      expect(abilities[0].event).toBe(TriggerEvent.CONTROLLED_CREATURE_DIED);
      expect(abilities[0].triggerFilter).toBe("a creature you control but don't own dies");
    });

    it('preserves subtype and counter-qualified dies filters', () => {
      const thunderboltsAbilities = parseTriggeredAbilitiesFromText(
        "Whenever a Villain you control dies, return it to the battlefield under its owner's control with a finality counter on it.",
        'thunderbolts',
        'player-1',
        'Thunderbolts Conspiracy'
      );
      const marchesaAbilities = parseTriggeredAbilitiesFromText(
        'Whenever a creature you control with a +1/+1 counter on it dies, return that card to the battlefield under your control at the beginning of the next end step.',
        'marchesa',
        'player-1',
        'Marchesa, the Black Rose'
      );

      expect(thunderboltsAbilities).toHaveLength(1);
      expect(thunderboltsAbilities[0].event).toBe(TriggerEvent.DIES);
      expect(thunderboltsAbilities[0].triggerFilter).toBe('a villain you control dies');
      expect(marchesaAbilities).toHaveLength(1);
      expect(marchesaAbilities[0].event).toBe(TriggerEvent.CONTROLLED_CREATURE_DIED);
      expect(marchesaAbilities[0].triggerFilter).toBe('a creature you control with a +1/+1 counter on it dies');
    });

    it('preserves attached-host dies filters for enchanted and equipped triggers', () => {
      const giftAbilities = parseTriggeredAbilitiesFromText(
        'When enchanted creature dies, return that card to the battlefield under its owner\'s control.',
        'gift-1',
        'player-1',
        'Gift of Immortality'
      );
      const orbAbilities = parseTriggeredAbilitiesFromText(
        "When equipped creature dies, return that card to the battlefield under your control at the beginning of the next end step.",
        'orb-1',
        'player-1',
        'Resurrection Orb'
      );

      expect(giftAbilities).toHaveLength(1);
      expect(giftAbilities[0].event).toBe(TriggerEvent.DIES);
      expect(giftAbilities[0].triggerFilter).toBe('enchanted creature dies');
      expect(orbAbilities).toHaveLength(1);
      expect(orbAbilities[0].event).toBe(TriggerEvent.DIES);
      expect(orbAbilities[0].triggerFilter).toBe('equipped creature dies');
    });

    it('preserves damage-provenance dies filters for Dread Slaver, Soul Collector, and Scythe of the Wretched', () => {
      const dreadAbilities = parseTriggeredAbilitiesFromText(
        'Whenever a creature dealt damage by this creature this turn dies, return it to the battlefield under your control.',
        'dread-slaver',
        'player-1',
        'Dread Slaver'
      );
      const soulAbilities = parseTriggeredAbilitiesFromText(
        'Whenever a creature dealt damage by this creature this turn dies, return that card to the battlefield under your control.',
        'soul-collector',
        'player-1',
        'Soul Collector'
      );
      const scytheAbilities = parseTriggeredAbilitiesFromText(
        'Whenever a creature dealt damage by equipped creature this turn dies, return that card to the battlefield under your control.',
        'scythe',
        'player-1',
        'Scythe of the Wretched'
      );

      expect(dreadAbilities).toHaveLength(1);
      expect(dreadAbilities[0].event).toBe(TriggerEvent.DIES);
      expect(dreadAbilities[0].triggerFilter).toBe('a creature dealt damage by this creature this turn dies');
      expect(soulAbilities).toHaveLength(1);
      expect(soulAbilities[0].event).toBe(TriggerEvent.DIES);
      expect(soulAbilities[0].triggerFilter).toBe('a creature dealt damage by this creature this turn dies');
      expect(scytheAbilities).toHaveLength(1);
      expect(scytheAbilities[0].event).toBe(TriggerEvent.DIES);
      expect(scytheAbilities[0].triggerFilter).toBe('a creature dealt damage by equipped creature this turn dies');
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
      expect(abilities[0].triggerFilter).toBe('your');
    });

    it('should preserve each filter on end-step triggers', () => {
      const oracleText = 'At the beginning of each end step, draw a card.';
      const abilities = parseTriggeredAbilitiesFromText(oracleText, 'perm-1', 'player-1', 'Shared End Source');

      expect(abilities).toHaveLength(1);
      expect(abilities[0].event).toBe(TriggerEvent.BEGINNING_OF_END_STEP);
      expect(abilities[0].triggerFilter).toBe('each');
    });

    it('should preserve your-turn filter on beginning of combat triggers', () => {
      const oracleText = 'At the beginning of combat on your turn, create a token that\'s a copy of equipped creature.';
      const abilities = parseTriggeredAbilitiesFromText(oracleText, 'perm-1', 'player-1', 'Combat Source');

      expect(abilities).toHaveLength(1);
      expect(abilities[0].event).toBe(TriggerEvent.BEGINNING_OF_COMBAT);
      expect(abilities[0].triggerFilter).toBe('your');
    });

    it('should preserve each filter on beginning of combat triggers', () => {
      const oracleText = 'At the beginning of each combat, draw a card.';
      const abilities = parseTriggeredAbilitiesFromText(oracleText, 'perm-1', 'player-1', 'Shared Combat Source');

      expect(abilities).toHaveLength(1);
      expect(abilities[0].event).toBe(TriggerEvent.BEGINNING_OF_COMBAT);
      expect(abilities[0].triggerFilter).toBe('each');
    });

    it('should parse generic beginning of combat triggers', () => {
      const oracleText = 'At the beginning of combat, draw a card.';
      const abilities = parseTriggeredAbilitiesFromText(oracleText, 'perm-1', 'player-1', 'Combat Source');

      expect(abilities).toHaveLength(1);
      expect(abilities[0].event).toBe(TriggerEvent.BEGINNING_OF_COMBAT);
      expect(abilities[0].triggerFilter).toBeUndefined();
    });
    
    it('should parse sacrifice trigger', () => {
      const oracleText = 'Whenever you sacrifice an artifact, you may draw a card.';
      const abilities = parseTriggeredAbilitiesFromText(oracleText, 'perm-1', 'player-1', 'Artifact Synergy');
      
      expect(abilities.length).toBeGreaterThan(0);
      expect(abilities[0].event).toBe(TriggerEvent.ARTIFACT_SACRIFICED);
    });

    it('should capture intervening-if metadata from trigger condition', () => {
      const oracleText = 'Whenever a creature attacks, if you control an artifact, draw a card.';
      const abilities = parseTriggeredAbilitiesFromText(oracleText, 'perm-1', 'player-1', 'Test Card');

      expect(abilities.length).toBeGreaterThan(0);
      expect(Boolean((abilities[0] as any).hasInterveningIf)).toBe(true);
      expect((abilities[0] as any).interveningIfClause).toBe('you control an artifact');
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

  describe('Oracle IR execution hint adapter', () => {
    it('builds normalized trigger event data from combat assignments', () => {
      const eventData = buildTriggerEventDataFromPayloads('p1', {
        attackers: [
          { attackerId: 'a1', defendingPlayerId: 'p2', damage: 2 },
          { attackerId: 'a2', defendingPlayerId: 'p3', damage: 1 },
        ],
      });

      expect(eventData.sourceControllerId).toBe('p1');
      expect(eventData.affectedOpponentIds).toEqual(['p2', 'p3']);
      expect(eventData.opponentsDealtDamageIds).toEqual(['p2', 'p3']);
      expect(eventData.targetOpponentId).toBeUndefined();
    });

    it('builds normalized trigger event data from explicit target fields', () => {
      const eventData = buildTriggerEventDataFromPayloads('p1', {
        targetOpponentId: 'p3',
      });

      expect(eventData.sourceControllerId).toBe('p1');
      expect(eventData.targetOpponentId).toBe('p3');
      expect(eventData.targetPlayerId).toBe('p3');
      expect(eventData.affectedOpponentIds).toEqual(['p3']);
    });

    it('does not let generic targetId override explicit targetOpponentId for targetPlayerId inference', () => {
      const eventData = buildTriggerEventDataFromPayloads('p1', {
        targetId: 'perm-42',
        targetOpponentId: 'p3',
      });

      expect(eventData.targetId).toBe('perm-42');
      expect(eventData.targetOpponentId).toBe('p3');
      expect(eventData.targetPlayerId).toBe('p3');
    });

    it('does not infer targetPlayerId from generic targetId when no player-scoped target fields exist', () => {
      const eventData = buildTriggerEventDataFromPayloads('p1', {
        targetId: 'perm-99',
      });

      expect(eventData.targetId).toBe('perm-99');
      expect(eventData.targetPlayerId).toBeUndefined();
      expect(eventData.targetOpponentId).toBeUndefined();
    });

    it('infers targetPermanentId from a singleton generic target when no player target exists', () => {
      const eventData = buildTriggerEventDataFromPayloads('p1', {
        targets: ['perm-99'],
      });

      expect(eventData.targetPermanentId).toBe('perm-99');
      expect(eventData.targetPlayerId).toBeUndefined();
      expect(eventData.targetOpponentId).toBeUndefined();
    });

    it('does not infer affectedPlayerIds from generic targetIds when player-scoped target fields are absent', () => {
      const eventData = buildTriggerEventDataFromPayloads('p1', {
        targetIds: ['perm-1', 'perm-2'],
      });

      expect(eventData.affectedPlayerIds).toBeUndefined();
      expect(eventData.affectedOpponentIds).toBeUndefined();
    });

    it('infers affectedPlayerIds from player-scoped target arrays', () => {
      const eventData = buildTriggerEventDataFromPayloads('p1', {
        targetPlayerIds: ['p2', 'p2'],
        targetOpponentIds: ['p3'],
      });

      expect(eventData.affectedPlayerIds).toEqual(['p2', 'p3']);
      expect(eventData.affectedOpponentIds).toEqual(['p2', 'p3']);
    });

    it('sanitizes opponent-scoped fields to exclude controller id', () => {
      const eventData = buildTriggerEventDataFromPayloads('p1', {
        targetOpponentId: 'p1',
        affectedOpponentIds: ['p1', 'p2', 'p2'],
        opponentsDealtDamageIds: ['p1', 'p3'],
      });

      expect(eventData.targetOpponentId).toBe('p2');
      expect(eventData.affectedOpponentIds).toEqual(['p2']);
      expect(eventData.opponentsDealtDamageIds).toEqual(['p3']);
    });

    it('normalizes whitespace-padded sourceControllerId for opponent sanitization', () => {
      const eventData = buildTriggerEventDataFromPayloads('  p1  ', {
        targetOpponentId: 'p1',
        affectedOpponentIds: ['p1', 'p2'],
      });

      expect(eventData.sourceControllerId).toBe('p1');
      expect(eventData.targetOpponentId).toBe('p2');
      expect(eventData.affectedOpponentIds).toEqual(['p2']);
    });

    it('ignores object-valued IDs in trigger event-data normalization', () => {
      const eventData = buildTriggerEventDataFromPayloads('p1', {
        targetOpponentId: { bad: true } as any,
        affectedOpponentIds: [{ id: 'p2' } as any, 'p3'],
        affectedPlayerIds: [{ id: 'p2' } as any, 'p2'],
      });

      expect(eventData.targetOpponentId).toBe('p3');
      expect(eventData.affectedOpponentIds).toEqual(['p3']);
      expect(eventData.affectedPlayerIds).toEqual(['p2']);
    });

    it('builds stack trigger meta snapshot from normalized event data', () => {
      const meta = buildStackTriggerMetaFromEventData(
        'Target opponent loses 1 life.',
        'src-1',
        'p1',
        undefined,
        {
          targetOpponentId: 'p3',
          attackers: [
            { attackerId: 'a1', defendingPlayerId: 'p2' },
          ],
        } as any
      );

      expect(meta.effectText).toBe('Target opponent loses 1 life.');
      expect(meta.triggerEventDataSnapshot?.sourceId).toBe('src-1');
      expect(meta.triggerEventDataSnapshot?.sourceControllerId).toBe('p1');
      expect(meta.triggerEventDataSnapshot?.targetOpponentId).toBe('p3');
      expect(meta.triggerEventDataSnapshot?.affectedOpponentIds).toEqual(['p2']);
      expect(meta.triggerEventDataSnapshot?.opponentsDealtDamageIds).toEqual(['p2']);
    });

    it('builds hint with explicit target bindings', () => {
      const hint = buildOracleIRExecutionEventHintFromTriggerData({
        targetPlayerId: 'p2',
        targetOpponentId: 'p3',
      });

      expect(hint).toEqual({
        targetPlayerId: 'p2',
        targetOpponentId: 'p3',
        affectedPlayerIds: undefined,
        affectedOpponentIds: undefined,
        opponentsDealtDamageIds: undefined,
      });
    });

    it('builds deduped relational-opponent hint from affected/opponents-dealt-damage ids', () => {
      const hint = buildOracleIRExecutionEventHintFromTriggerData({
        affectedOpponentIds: ['p2', 'p2', 'p3'],
        opponentsDealtDamageIds: ['p3', 'p4'],
      });

      expect(hint?.affectedOpponentIds).toEqual(['p2', 'p3']);
      expect(hint?.opponentsDealtDamageIds).toEqual(['p3', 'p4']);
    });

    it('keeps targetOpponentId available for relational fallback when list fields are absent', () => {
      const hint = buildOracleIRExecutionEventHintFromTriggerData({
        targetOpponentId: 'p3',
      });

      expect(hint).toEqual({
        targetPlayerId: undefined,
        targetOpponentId: 'p3',
        affectedPlayerIds: undefined,
        affectedOpponentIds: undefined,
        opponentsDealtDamageIds: undefined,
      });
    });

    it('returns undefined when event data has no selector-relevant fields', () => {
      const hint = buildOracleIRExecutionEventHintFromTriggerData({ sourceId: 'abc' });
      expect(hint).toBeUndefined();
    });

    it('sanitizes opponent-scoped hint fields to exclude source controller id', () => {
      const hint = buildOracleIRExecutionEventHintFromTriggerData({
        sourceControllerId: 'p1',
        targetOpponentId: 'p1',
        affectedOpponentIds: ['p1', 'p2', 'p2'],
        opponentsDealtDamageIds: ['p1', 'p3'],
      });

      expect(hint).toEqual({
        targetPlayerId: undefined,
        targetOpponentId: 'p2',
        affectedPlayerIds: undefined,
        affectedOpponentIds: ['p2'],
        opponentsDealtDamageIds: ['p3'],
      });
    });

    it('sanitizes opponent-scoped hint fields when sourceControllerId has whitespace', () => {
      const hint = buildOracleIRExecutionEventHintFromTriggerData({
        sourceControllerId: '  p1  ',
        targetOpponentId: 'p1',
        affectedOpponentIds: ['p1', 'p2'],
      });

      expect(hint).toEqual({
        targetPlayerId: undefined,
        targetOpponentId: 'p2',
        affectedPlayerIds: undefined,
        affectedOpponentIds: ['p2'],
        opponentsDealtDamageIds: undefined,
      });
    });

    it('normalizes whitespace-padded IDs in hint adapter fields', () => {
      const hint = buildOracleIRExecutionEventHintFromTriggerData({
        sourceControllerId: ' p1 ',
        targetPlayerId: ' p2 ',
        targetOpponentId: ' p3 ',
        affectedPlayerIds: [' p2 ', 'p2'],
        affectedOpponentIds: [' p3 ', 'p3'],
      });

      expect(hint).toEqual({
        targetPlayerId: 'p2',
        targetOpponentId: 'p3',
        affectedPlayerIds: ['p2'],
        affectedOpponentIds: ['p3'],
        opponentsDealtDamageIds: undefined,
      });
    });

    it('ignores object-valued IDs in hint adapter fields', () => {
      const hint = buildOracleIRExecutionEventHintFromTriggerData({
        sourceControllerId: 'p1',
        targetPlayerId: { bad: true } as any,
        targetOpponentId: { bad: true } as any,
        affectedPlayerIds: [{ id: 'p2' } as any, 'p2'],
        affectedOpponentIds: [{ id: 'p3' } as any, 'p3'],
      });

      expect(hint).toEqual({
        targetPlayerId: undefined,
        targetOpponentId: 'p3',
        affectedPlayerIds: ['p2'],
        affectedOpponentIds: ['p3'],
        opponentsDealtDamageIds: undefined,
      });
    });
  });

  describe('Triggered ability Oracle IR execution integration', () => {
    it('executes contextual each_of_those_opponents effect from TriggerEventData in multiplayer', () => {
      const start = makeState();

      const result = executeTriggeredAbilityEffectWithOracleIR(
        start,
        {
          controllerId: 'p1',
          sourceId: 'breeches-1',
          sourceName: 'Breeches, Brazen Plunderer',
          effect:
            "Exile the top card of each of those opponents' libraries. You may play those cards this turn, and you may spend mana as though it were mana of any color to cast those spells.",
        },
        {
          opponentsDealtDamageIds: ['p2'],
        }
      );

      const p2 = result.state.players.find(p => p.id === 'p2') as any;
      const p3 = result.state.players.find(p => p.id === 'p3') as any;

      expect(result.appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
      expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
      expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1']);
      expect(p3.library.map((c: any) => c.id)).toEqual(['p3c1', 'p3c2']);
      expect(p3.exile || []).toHaveLength(0);
    });

    it('executes target_opponent effect from TriggerEventData target binding in multiplayer', () => {
      const start = makeState();

      const result = executeTriggeredAbilityEffectWithOracleIR(
        start,
        {
          controllerId: 'p1',
          sourceId: 'test-1',
          sourceName: 'Test Trigger Source',
          effect: 'Target opponent loses 1 life.',
        },
        {
          targetOpponentId: 'p3',
        }
      );

      const p2 = result.state.players.find(p => p.id === 'p2') as any;
      const p3 = result.state.players.find(p => p.id === 'p3') as any;

      expect(result.appliedSteps.some(s => s.kind === 'lose_life')).toBe(true);
      expect(p2.life).toBe(40);
      expect(p3.life).toBe(39);
    });

    it('processEventAndExecuteTriggeredOracle auto-processes contextual opponent subset trigger effects', () => {
      const start = makeState();
      const abilities = [
        {
          id: 'breeches-trigger',
          sourceId: 'breeches-1',
          sourceName: 'Breeches, Brazen Plunderer',
          controllerId: 'p1',
          keyword: TriggerKeyword.WHENEVER,
          event: TriggerEvent.DEALS_COMBAT_DAMAGE_TO_PLAYER,
          effect:
            "Exile the top card of each of those opponents' libraries. You may play those cards this turn, and you may spend mana as though it were mana of any color to cast those spells.",
        } as any,
      ];

      const result = processEventAndExecuteTriggeredOracle(
        start,
        TriggerEvent.DEALS_COMBAT_DAMAGE_TO_PLAYER,
        abilities,
        { opponentsDealtDamageIds: ['p2', 'p3'] }
      );

      const p2 = result.state.players.find(p => p.id === 'p2') as any;
      const p3 = result.state.players.find(p => p.id === 'p3') as any;

      expect(result.triggers).toHaveLength(1);
      expect(result.executions).toHaveLength(1);
      expect(result.executions[0].appliedSteps.some(s => s.kind === 'impulse_exile_top')).toBe(true);
      expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
      expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1']);
      expect(p3.library.map((c: any) => c.id)).toEqual(['p3c2']);
      expect((p3.exile || []).map((c: any) => c.id)).toEqual(['p3c1']);
    });

    it('processEventAndExecuteTriggeredOracle auto-processes target_opponent-bound effects', () => {
      const start = makeState();
      const abilities = [
        {
          id: 'life-trigger',
          sourceId: 'source-1',
          sourceName: 'Life Trigger',
          controllerId: 'p1',
          keyword: TriggerKeyword.WHENEVER,
          event: TriggerEvent.ATTACKS,
          effect: 'Target opponent loses 1 life.',
        } as any,
      ];

      const result = processEventAndExecuteTriggeredOracle(start, TriggerEvent.ATTACKS, abilities, { targetOpponentId: 'p2' });
      const p2 = result.state.players.find(p => p.id === 'p2') as any;
      const p3 = result.state.players.find(p => p.id === 'p3') as any;

      expect(result.triggers).toHaveLength(1);
      expect(result.executions).toHaveLength(1);
      expect(result.executions[0].appliedSteps.some(s => s.kind === 'lose_life')).toBe(true);
      expect(p2.life).toBe(39);
      expect(p3.life).toBe(40);
      expect(result.triggers[0]?.triggerEventDataSnapshot?.targetOpponentId).toBe('p2');
    });

    it('processEventAndExecuteTriggeredOracle auto-processes optional tap-or-untap effects from singleton permanent targets', () => {
      const start = makeMerfolkIterationState({
        battlefield: makeMerfolkIterationState().battlefield.map((perm: any) =>
          perm.id === 'nykthos-shrine-to-nyx' ? { ...perm, tapped: true } : perm
        ),
      });
      const abilities = [
        {
          id: 'reejerey-trigger',
          sourceId: 'merrow-reejerey',
          sourceName: 'Merrow Reejerey',
          controllerId: 'p1',
          keyword: TriggerKeyword.WHENEVER,
          event: TriggerEvent.CREATURE_SPELL_CAST,
          effect: 'You may tap or untap target permanent.',
          optional: true,
        } as any,
      ];

      const result = processEventAndExecuteTriggeredOracle(
        start,
        TriggerEvent.CREATURE_SPELL_CAST,
        abilities,
        { targets: ['nykthos-shrine-to-nyx'] } as any
      );

      const nykthos = result.state.battlefield.find((perm: any) => perm.id === 'nykthos-shrine-to-nyx') as any;

      expect(result.executions).toHaveLength(1);
      expect(result.executions[0].appliedSteps.some(step => step.kind === 'tap_or_untap')).toBe(true);
      expect(nykthos.tapped).toBe(false);
      expect(result.triggers[0]?.triggerEventDataSnapshot?.targetPermanentId).toBe('nykthos-shrine-to-nyx');
    });

    it('buildTriggeredAbilityChoiceEvents returns ordered Merrow choice prompts when target and tap state are unresolved', () => {
      const start = makeMerfolkIterationState();
      const ability = {
        id: 'reejerey-choice-trigger',
        sourceId: 'merrow-reejerey',
        sourceName: 'Merrow Reejerey',
        controllerId: 'p1',
        keyword: TriggerKeyword.WHENEVER,
        event: TriggerEvent.CREATURE_SPELL_CAST,
        effect: 'You may tap or untap target permanent.',
        optional: true,
      } as any;

      const events = buildTriggeredAbilityChoiceEvents(start, ability);
      const targetEvent = events.find(event => event.type === ChoiceEventType.TARGET_SELECTION) as any;
      const optionEvent = events.find(event => event.type === ChoiceEventType.OPTION_CHOICE) as any;

      expect(events.map(event => event.type)).toEqual([
        ChoiceEventType.MAY_ABILITY,
        ChoiceEventType.TARGET_SELECTION,
        ChoiceEventType.OPTION_CHOICE,
      ]);
      expect(targetEvent.validTargets.some((target: any) => target.id === 'nykthos-shrine-to-nyx')).toBe(true);
      expect(optionEvent.options.map((option: any) => option.id)).toEqual(['tap', 'untap']);
    });

    it('buildTriggeredAbilityChoiceEvents suppresses resolved trigger choices already supplied by event context', () => {
      const start = makeMerfolkIterationState();
      const ability = {
        id: 'reejerey-choice-trigger-resolved',
        sourceId: 'merrow-reejerey',
        sourceName: 'Merrow Reejerey',
        controllerId: 'p1',
        keyword: TriggerKeyword.WHENEVER,
        event: TriggerEvent.CREATURE_SPELL_CAST,
        effect: 'You may tap or untap target permanent.',
        optional: true,
      } as any;

      const events = buildTriggeredAbilityChoiceEvents(start, ability, {
        targets: ['nykthos-shrine-to-nyx'],
        tapOrUntapChoice: 'untap',
      } as any);

      expect(events.map(event => event.type)).toEqual([ChoiceEventType.MAY_ABILITY]);
    });

    it('buildTriggeredAbilityEventDataFromChoices maps Merrow grouped responses into execution overrides', () => {
      const start = makeMerfolkIterationState();

      const overrides = buildTriggeredAbilityEventDataFromChoices(start, 'p1', [
        {
          type: 'option_choice',
          mayAbilityPrompt: true,
          selections: 'yes',
        },
        {
          type: 'target_selection',
          targetTypes: ['permanent'],
          selections: ['nykthos-shrine-to-nyx'],
        },
        {
          type: 'option_choice',
          selections: 'untap',
        },
      ] as any);

      expect(overrides).toMatchObject({
        targetPermanentId: 'nykthos-shrine-to-nyx',
        tapOrUntapChoice: 'untap',
      });
    });

    it('executes Merrow Reejerey from grouped choice-derived execution data', () => {
      const start = makeMerfolkIterationState({
        battlefield: makeMerfolkIterationState().battlefield.map((perm: any) =>
          perm.id === 'nykthos-shrine-to-nyx' ? { ...perm, tapped: true } : perm
        ),
      });

      const overrides = buildTriggeredAbilityEventDataFromChoices(start, 'p1', [
        {
          type: 'option_choice',
          mayAbilityPrompt: true,
          selections: 'yes',
        },
        {
          type: 'target_selection',
          targetTypes: ['permanent'],
          selections: ['nykthos-shrine-to-nyx'],
        },
        {
          type: 'option_choice',
          selections: 'untap',
        },
      ] as any);

      const executionEventData = buildResolutionEventDataFromGameState(start, 'p1', overrides);
      const result = executeTriggeredAbilityEffectWithOracleIR(
        start,
        {
          controllerId: 'p1',
          sourceId: 'merrow-reejerey',
          sourceName: 'Merrow Reejerey',
          effect: 'You may tap or untap target permanent.',
        },
        executionEventData,
        { allowOptional: true }
      );

      const nykthos = result.state.battlefield.find((perm: any) => perm.id === 'nykthos-shrine-to-nyx') as any;
      expect(nykthos?.tapped).toBe(false);
      expect(result.appliedSteps.some((step: any) => step.kind === 'tap_or_untap')).toBe(true);
      expect(result.pendingOptionalSteps).toHaveLength(0);
    });

    it('buildTriggeredAbilityChoiceEvents returns target-opponent prompt when target opponent is unresolved', () => {
      const start = makeState();
      const ability = {
        id: 'target-opponent-choice-trigger',
        sourceId: 'grim-harbinger',
        sourceName: 'Grim Harbinger',
        controllerId: 'p1',
        keyword: TriggerKeyword.WHENEVER,
        event: TriggerEvent.CREATURE_DIES,
        effect: 'Target opponent loses 1 life.',
        optional: false,
      } as any;

      const events = buildTriggeredAbilityChoiceEvents(start, ability);
      const targetEvent = events[0] as any;

      expect(events.map(event => event.type)).toEqual([ChoiceEventType.TARGET_SELECTION]);
      expect(targetEvent.targetTypes).toEqual(['opponent']);
      expect(targetEvent.validTargets.map((target: any) => target.id)).toEqual(['p2', 'p3']);
    });

    it('buildTriggeredAbilityEventDataFromChoices maps grouped opponent target responses', () => {
      const start = makeState();

      const overrides = buildTriggeredAbilityEventDataFromChoices(start, 'p1', [
        {
          type: 'target_selection',
          targetTypes: ['opponent'],
          selections: ['p2'],
        },
      ] as any);

      expect(overrides).toMatchObject({
        targetOpponentId: 'p2',
        targetPlayerId: 'p2',
      });
    });

    it('executes target-opponent trigger steps from grouped choice-derived execution data', () => {
      const start = makeState();

      const overrides = buildTriggeredAbilityEventDataFromChoices(start, 'p1', [
        {
          type: 'target_selection',
          targetTypes: ['opponent'],
          selections: ['p2'],
        },
      ] as any);

      const executionEventData = buildResolutionEventDataFromGameState(start, 'p1', overrides);
      const result = executeTriggeredAbilityEffectWithOracleIR(
        start,
        {
          controllerId: 'p1',
          sourceId: 'grim-harbinger',
          sourceName: 'Grim Harbinger',
          effect: 'Target opponent loses 1 life.',
        },
        executionEventData,
        { allowOptional: true }
      );

      const p2 = result.state.players.find((entry: any) => entry.id === 'p2') as any;
      const p3 = result.state.players.find((entry: any) => entry.id === 'p3') as any;

      expect(p2.life).toBe(39);
      expect(p3.life).toBe(40);
      expect(result.appliedSteps.some((step: any) => step.kind === 'lose_life')).toBe(true);
    });

    it('buildTriggeredAbilityChoiceEvents returns target-player prompt when target player is unresolved', () => {
      const start = makeState();
      const ability = {
        id: 'target-player-choice-trigger',
        sourceId: 'benevolent-seer',
        sourceName: 'Benevolent Seer',
        controllerId: 'p1',
        keyword: TriggerKeyword.WHENEVER,
        event: TriggerEvent.CREATURE_DIES,
        effect: 'Target player gains 2 life.',
        optional: false,
      } as any;

      const events = buildTriggeredAbilityChoiceEvents(start, ability);
      const targetEvent = events[0] as any;

      expect(events.map(event => event.type)).toEqual([ChoiceEventType.TARGET_SELECTION]);
      expect(targetEvent.targetTypes).toEqual(['player']);
      expect(targetEvent.validTargets.map((target: any) => target.id)).toEqual(['p1', 'p2', 'p3']);
    });

    it('buildTriggeredAbilityEventDataFromChoices maps grouped player target responses', () => {
      const start = makeState();

      const overrides = buildTriggeredAbilityEventDataFromChoices(start, 'p1', [
        {
          type: 'target_selection',
          targetTypes: ['player'],
          selections: ['p2'],
        },
      ] as any);

      expect(overrides).toMatchObject({
        targetPlayerId: 'p2',
        targetOpponentId: 'p2',
      });
    });

    it('buildTriggeredAbilityChoiceEvents returns a permanent-target prompt for Rocket-Powered Goblin Glider attach triggers', () => {
      const start = makeState({
        battlefield: [
          {
            id: 'rocket',
            controller: 'p1',
            owner: 'p1',
            tapped: false,
            card: {
              id: 'rocket-card',
              name: 'Rocket-Powered Goblin Glider',
              type_line: 'Artifact - Equipment',
            },
          },
          {
            id: 'bear',
            controller: 'p1',
            owner: 'p1',
            tapped: false,
            card: {
              id: 'bear-card',
              name: 'Target Bear',
              type_line: 'Creature - Bear',
            },
          },
        ] as any,
      });
      const ability = {
        id: 'rocket-choice-trigger',
        sourceId: 'rocket',
        sourceName: 'Rocket-Powered Goblin Glider',
        controllerId: 'p1',
        keyword: TriggerKeyword.WHEN,
        event: TriggerEvent.ENTERS_BATTLEFIELD,
        effect: 'Attach it to target creature you control.',
        optional: false,
      } as any;

      const events = buildTriggeredAbilityChoiceEvents(start, ability);
      const targetEvent = events[0] as any;

      expect(events.map(event => event.type)).toEqual([ChoiceEventType.TARGET_SELECTION]);
      expect(targetEvent.targetTypes).toEqual(['permanent']);
      expect(targetEvent.validTargets.map((target: any) => target.id)).toEqual(['bear']);
    });

    it('executes target-player trigger steps from grouped choice-derived execution data', () => {
      const start = makeState();

      const overrides = buildTriggeredAbilityEventDataFromChoices(start, 'p1', [
        {
          type: 'target_selection',
          targetTypes: ['player'],
          selections: ['p2'],
        },
      ] as any);

      const executionEventData = buildResolutionEventDataFromGameState(start, 'p1', overrides);
      const result = executeTriggeredAbilityEffectWithOracleIR(
        start,
        {
          controllerId: 'p1',
          sourceId: 'benevolent-spark',
          sourceName: 'Benevolent Spark',
          effect: 'Target player gains 2 life.',
        },
        executionEventData,
        { allowOptional: true }
      );

      const p1 = result.state.players.find((entry: any) => entry.id === 'p1') as any;
      const p2 = result.state.players.find((entry: any) => entry.id === 'p2') as any;

      expect(p1.life).toBe(40);
      expect(p2.life).toBe(42);
      expect(result.appliedSteps.some((step: any) => step.kind === 'gain_life')).toBe(true);
    });

    it('buildTriggeredAbilityChoiceEvents returns mode-selection prompt when choose_mode is unresolved', () => {
      const start = makeState();
      const ability = {
        id: 'black-market-connections-choice-trigger',
        sourceId: 'black-market-connections',
        sourceName: 'Black Market Connections',
        controllerId: 'p1',
        keyword: TriggerKeyword.AT,
        event: TriggerEvent.BEGINNING_OF_PRECOMBAT_MAIN,
        effect: 'Choose up to three -\n\u2022 Sell Contraband - You lose 1 life. Create a Treasure token.\n\u2022 Buy Information - You lose 2 life. Draw a card.\n\u2022 Hire a Mercenary - You lose 3 life. Create a 3/2 colorless Shapeshifter creature token with changeling.',
        optional: false,
      } as any;

      const events = buildTriggeredAbilityChoiceEvents(start, ability);
      const modeEvent = events[0] as any;

      expect(events.map(event => event.type)).toEqual([ChoiceEventType.MODE_SELECTION]);
      expect(modeEvent.minModes).toBe(0);
      expect(modeEvent.maxModes).toBe(3);
      expect(modeEvent.modes.map((mode: any) => mode.id)).toEqual([
        'Sell Contraband',
        'Buy Information',
        'Hire a Mercenary',
      ]);
    });

    it('buildTriggeredAbilityEventDataFromChoices collects selected mode ids from grouped mode responses', () => {
      const start = makeState();

      const overrides = buildTriggeredAbilityEventDataFromChoices(start, 'p1', [
        {
          type: 'mode_selection',
          selections: ['Sell Contraband', 'Buy Information'],
        },
      ] as any);

      expect(overrides.selectedModeIds).toEqual(['Sell Contraband', 'Buy Information']);
    });

    it('executes choose_mode trigger steps when selectedModeIds are supplied', () => {
      const start = makeState();
      const beforePlayer = start.players.find((entry: any) => entry.id === 'p1') as any;
      const beforeLife = beforePlayer.life;
      const beforeHandSize = Array.isArray(beforePlayer.hand) ? beforePlayer.hand.length : 0;

      const result = executeTriggeredAbilityEffectWithOracleIR(
        start,
        {
          controllerId: 'p1',
          sourceId: 'black-market-connections',
          sourceName: 'Black Market Connections',
          effect: 'Choose up to three -\n\u2022 Sell Contraband - You lose 1 life. Create a Treasure token.\n\u2022 Buy Information - You lose 2 life. Draw a card.\n\u2022 Hire a Mercenary - You lose 3 life. Create a 3/2 colorless Shapeshifter creature token with changeling.',
        },
        {
          selectedModeIds: ['Sell Contraband', 'Buy Information'],
        } as any
      );

      const player = result.state.players.find((entry: any) => entry.id === 'p1') as any;
      const treasure = result.state.battlefield.find((perm: any) => String(perm?.card?.name || '').includes('Treasure')) as any;

      expect(player.life).toBe(beforeLife - 3);
      expect((player.hand || []).length).toBe(beforeHandSize + 1);
      expect(treasure).toBeTruthy();
      expect(result.pendingOptionalSteps).toHaveLength(0);
      expect(result.appliedSteps.some((step: any) => step.kind === 'choose_mode')).toBe(true);
    });

    it('processEventAndExecuteTriggeredOracle rechecks intervening-if against resolutionEventData when provided', () => {
      const start = makeState();
      const abilities = [
        {
          id: 'if-resolution-trigger',
          sourceId: 'source-if-resolution',
          sourceName: 'Intervening If Resolution Source',
          controllerId: 'p1',
          keyword: TriggerKeyword.WHENEVER,
          event: TriggerEvent.ATTACKS,
          effect: 'Draw a card.',
          interveningIfClause: 'you control an artifact',
          hasInterveningIf: true,
        } as any,
      ];

      const result = processEventAndExecuteTriggeredOracle(
        start,
        TriggerEvent.ATTACKS,
        abilities,
        {
          sourceControllerId: 'p1',
          battlefield: [{ id: 'perm-a', controllerId: 'p1', types: ['Artifact'] }],
        },
        {
          resolutionEventData: {
            sourceControllerId: 'p1',
            battlefield: [{ id: 'perm-c', controllerId: 'p1', types: ['Creature'] }],
          },
        }
      );

      const p1 = result.state.players.find(p => p.id === 'p1') as any;
      expect(result.triggers).toHaveLength(1);
      expect(result.triggers[0]?.interveningIfWasTrueAtTrigger).toBe(true);
      expect(result.executions).toHaveLength(0);
      expect(p1.hand || []).toHaveLength(0);
      expect(result.log.some(x => x.includes('intervening-if false'))).toBe(true);
    });

    it('processEventAndExecuteTriggeredOracle does not trigger when intervening-if is false at trigger time', () => {
      const start = makeState();
      const abilities = [
        {
          id: 'if-trigger',
          sourceId: 'source-if',
          sourceName: 'Intervening If Source',
          controllerId: 'p1',
          keyword: TriggerKeyword.WHENEVER,
          event: TriggerEvent.ATTACKS,
          effect: 'Draw a card.',
          interveningIfClause: 'you control an artifact',
          hasInterveningIf: true,
        } as any,
      ];

      const result = processEventAndExecuteTriggeredOracle(
        start,
        TriggerEvent.ATTACKS,
        abilities,
        {
          sourceControllerId: 'p1',
          battlefield: [
            { id: 'perm-1', controllerId: 'p1', types: ['Creature'] },
          ],
        }
      );

      const p1 = result.state.players.find(p => p.id === 'p1') as any;
      expect(result.triggers).toHaveLength(0);
      expect(result.executions).toHaveLength(0);
      expect(p1.hand || []).toHaveLength(0);
    });

    it('processEventAndExecuteTriggeredOracle uses current-state-derived resolution data when explicit resolutionEventData is absent', () => {
      const start = makeState({
        battlefield: [] as any,
      });
      const abilities = [
        {
          id: 'if-default-resolution',
          sourceId: 'source-if-default-resolution',
          sourceName: 'Intervening If Default Resolution Source',
          controllerId: 'p1',
          keyword: TriggerKeyword.WHENEVER,
          event: TriggerEvent.ATTACKS,
          effect: 'Draw a card.',
          interveningIfClause: 'you control an artifact',
          hasInterveningIf: true,
        } as any,
      ];

      const result = processEventAndExecuteTriggeredOracle(
        start,
        TriggerEvent.ATTACKS,
        abilities,
        {
          sourceControllerId: 'p1',
          battlefield: [{ id: 'perm-a', controllerId: 'p1', types: ['Artifact'] }],
        }
      );

      const p1 = result.state.players.find(p => p.id === 'p1') as any;
      expect(result.triggers).toHaveLength(1);
      expect(result.executions).toHaveLength(0);
      expect(p1.hand || []).toHaveLength(0);
      expect(result.log.some(x => x.includes('intervening-if false'))).toBe(true);
    });

    it('processEventAndExecuteTriggeredOracle rechecks intervening-if from condition fallback when clause field is absent', () => {
      const start = makeState();
      const abilities = [
        {
          id: 'if-fallback-resolution',
          sourceId: 'source-if-fallback-resolution',
          sourceName: 'Intervening If Fallback Source',
          controllerId: 'p1',
          keyword: TriggerKeyword.WHENEVER,
          event: TriggerEvent.ATTACKS,
          effect: 'Draw a card.',
          condition: 'you control an artifact',
          hasInterveningIf: true,
        } as any,
      ];

      const result = processEventAndExecuteTriggeredOracle(
        start,
        TriggerEvent.ATTACKS,
        abilities,
        {
          sourceControllerId: 'p1',
          battlefield: [{ id: 'perm-a', controllerId: 'p1', types: ['Artifact'] }],
        },
        {
          resolutionEventData: {
            sourceControllerId: 'p1',
            battlefield: [{ id: 'perm-c', controllerId: 'p1', types: ['Creature'] }],
          },
        }
      );

      const p1 = result.state.players.find(p => p.id === 'p1') as any;
      expect(result.triggers).toHaveLength(1);
      expect(result.triggers[0]?.interveningIfClause).toBe('you control an artifact');
      expect(result.triggers[0]?.interveningIfWasTrueAtTrigger).toBe(true);
      expect(result.executions).toHaveLength(0);
      expect(p1.hand || []).toHaveLength(0);
      expect(result.log.some(x => x.includes('intervening-if false'))).toBe(true);
    });

    it('propagates trigger metadata onto ability stack objects', () => {
      const abilities = [
        {
          id: 'meta-trigger',
          sourceId: 'meta-source',
          sourceName: 'Meta Source',
          controllerId: 'p1',
          keyword: TriggerKeyword.WHENEVER,
          event: TriggerEvent.ATTACKS,
          effect: 'Draw a card.',
          interveningIfClause: 'you control an artifact',
          hasInterveningIf: true,
          triggerFilter: 'you',
        } as any,
      ];

      const instances = processEvent(TriggerEvent.ATTACKS, abilities, {
        sourceControllerId: 'p1',
        battlefield: [{ id: 'perm-a', controllerId: 'p1', types: ['Artifact'] }],
      });

      let queue = createEmptyTriggerQueue();
      for (const t of instances) queue = { triggers: [...queue.triggers, t] };
      const { stackObjects } = putTriggersOnStack(queue, 'p1');

      expect(stackObjects).toHaveLength(1);
      expect(stackObjects[0]?.spellId).toBe('meta-source');
      expect((stackObjects[0] as any).triggerMeta?.hasInterveningIf).toBe(true);
      expect((stackObjects[0] as any).triggerMeta?.interveningIfClause).toBe('you control an artifact');
      expect((stackObjects[0] as any).triggerMeta?.interveningIfWasTrueAtTrigger).toBe(true);
      expect((stackObjects[0] as any).triggerMeta?.triggerEventDataSnapshot?.sourceControllerId).toBe('p1');
    });

    it('putTriggersOnStack applies APNAP order across multiplayer turn order', () => {
      const queue = {
        triggers: [
          {
            id: 't-p3',
            abilityId: 'a-p3',
            sourceId: 'src-p3',
            sourceName: 'P3 Trigger',
            controllerId: 'p3',
            effect: 'Draw a card.',
            timestamp: 1000,
            hasTriggered: true,
            onStack: false,
          },
          {
            id: 't-p1',
            abilityId: 'a-p1',
            sourceId: 'src-p1',
            sourceName: 'P1 Trigger',
            controllerId: 'p1',
            effect: 'Draw a card.',
            timestamp: 1000,
            hasTriggered: true,
            onStack: false,
          },
          {
            id: 't-p2',
            abilityId: 'a-p2',
            sourceId: 'src-p2',
            sourceName: 'P2 Trigger',
            controllerId: 'p2',
            effect: 'Draw a card.',
            timestamp: 1000,
            hasTriggered: true,
            onStack: false,
          },
        ],
      } as any;

      const { stackObjects } = putTriggersOnStack(queue, 'p1', ['p1', 'p2', 'p3']);

      expect(stackObjects.map((obj: any) => obj.controllerId)).toEqual(['p1', 'p2', 'p3']);
    });

    it('putTriggersOnStack applies APNAP wrap-around when active player is late in turn order', () => {
      const queue = {
        triggers: [
          { id: 't-p1', abilityId: 'a-p1', sourceId: 's1', sourceName: 'P1 Trigger', controllerId: 'p1', effect: 'Draw a card.', timestamp: 1000, hasTriggered: true, onStack: false },
          { id: 't-p2', abilityId: 'a-p2', sourceId: 's2', sourceName: 'P2 Trigger', controllerId: 'p2', effect: 'Draw a card.', timestamp: 1000, hasTriggered: true, onStack: false },
          { id: 't-p3', abilityId: 'a-p3', sourceId: 's3', sourceName: 'P3 Trigger', controllerId: 'p3', effect: 'Draw a card.', timestamp: 1000, hasTriggered: true, onStack: false },
          { id: 't-p4', abilityId: 'a-p4', sourceId: 's4', sourceName: 'P4 Trigger', controllerId: 'p4', effect: 'Draw a card.', timestamp: 1000, hasTriggered: true, onStack: false },
        ],
      } as any;

      const { stackObjects } = putTriggersOnStack(queue, 'p3', ['p1', 'p2', 'p3', 'p4']);

      expect(stackObjects.map((obj: any) => obj.controllerId)).toEqual(['p3', 'p4', 'p1', 'p2']);
    });

    it('putTriggersOnStack falls back to active-first and timestamp order when active is missing from turn order', () => {
      const queue = {
        triggers: [
          { id: 't-p2-late', abilityId: 'a-p2-late', sourceId: 's2l', sourceName: 'P2 Late', controllerId: 'p2', effect: 'Draw a card.', timestamp: 2000, hasTriggered: true, onStack: false },
          { id: 't-p1', abilityId: 'a-p1', sourceId: 's1', sourceName: 'P1 Trigger', controllerId: 'p1', effect: 'Draw a card.', timestamp: 1500, hasTriggered: true, onStack: false },
          { id: 't-p2-early', abilityId: 'a-p2-early', sourceId: 's2e', sourceName: 'P2 Early', controllerId: 'p2', effect: 'Draw a card.', timestamp: 1000, hasTriggered: true, onStack: false },
        ],
      } as any;

      const { stackObjects } = putTriggersOnStack(queue, 'p1', ['p2', 'p3']);

      expect(stackObjects.map((obj: any) => obj.id)).toEqual(['t-p1', 't-p2-early', 't-p2-late']);
    });
  });

  describe('Resolution event data builder', () => {
    it('buildResolutionEventDataFromGameState derives controller turn/life/battlefield context', () => {
      const state = makeState({ turnPlayer: 'p1', turnStartHandSnapshot: { p1: ['opening1', 'opening2'] } } as any);
      const out = buildResolutionEventDataFromGameState(state, 'p1');

      expect(out.sourceControllerId).toBe('p1');
      expect(out.isYourTurn).toBe(true);
      expect(out.isOpponentsTurn).toBe(false);
      expect(out.lifeTotal).toBe(40);
      expect(Array.isArray(out.hand)).toBe(true);
      expect(out.handAtBeginningOfTurn).toEqual(['opening1', 'opening2']);
      expect(Array.isArray(out.battlefield)).toBe(true);
    });

    it('buildResolutionEventDataFromGameState normalizes whitespace-padded controller id', () => {
      const state = makeState({ turnPlayer: 'p1' } as any);
      const out = buildResolutionEventDataFromGameState(state, '  p1  ' as any);

      expect(out.sourceControllerId).toBe('p1');
      expect(out.isYourTurn).toBe(true);
      expect(out.isOpponentsTurn).toBe(false);
      expect(out.lifeTotal).toBe(40);
    });

    it('buildResolutionEventDataFromGameState keeps lifeTotal undefined for unknown controller without base fallback', () => {
      const state = makeState({ turnPlayer: 'p1' } as any);
      const out = buildResolutionEventDataFromGameState(state, 'ghost-player' as any);

      expect(out.sourceControllerId).toBe('ghost-player');
      expect(out.lifeTotal).toBeUndefined();
    });

    it('buildResolutionEventDataFromGameState keeps turn flags false for unknown controller without base fallback', () => {
      const state = makeState({ turnPlayer: 'p1' } as any);
      const out = buildResolutionEventDataFromGameState(state, 'ghost-player' as any);

      expect(out.isYourTurn).toBe(false);
      expect(out.isOpponentsTurn).toBe(false);
    });

    it('buildResolutionEventDataFromGameState preserves base turn flags when controller is unknown', () => {
      const state = makeState({ turnPlayer: 'p1' } as any);
      const out = buildResolutionEventDataFromGameState(state, 'ghost-player' as any, {
        isYourTurn: true,
        isOpponentsTurn: false,
      } as any);

      expect(out.isYourTurn).toBe(true);
      expect(out.isOpponentsTurn).toBe(false);
    });
  });

  describe('Intervening-if condition classes', () => {
    it('evaluateTriggerCondition supports tribal tap filters for creatures you control', () => {
      const merfolkYouControl = evaluateTriggerCondition(
        'a merfolk you control becomes tapped',
        'p1',
        {
          sourceControllerId: 'p1',
          permanentTypes: ['Creature'],
          creatureTypes: ['Merfolk', 'Wizard'],
        } as any
      );

      const nonMerfolk = evaluateTriggerCondition(
        'a merfolk you control becomes tapped',
        'p1',
        {
          sourceControllerId: 'p1',
          permanentTypes: ['Creature'],
          creatureTypes: ['Wizard'],
        } as any
      );

      const opposingMerfolk = evaluateTriggerCondition(
        'a merfolk you control becomes tapped',
        'p1',
        {
          sourceControllerId: 'p2',
          permanentTypes: ['Creature'],
          creatureTypes: ['Merfolk'],
        } as any
      );

      expect(merfolkYouControl).toBe(true);
      expect(nonMerfolk).toBe(false);
      expect(opposingMerfolk).toBe(false);
    });

    it('processEvent only triggers Judge of Currents for your tapped Merfolk', () => {
      const abilities = parseTriggeredAbilitiesFromText(
        'Whenever a Merfolk you control becomes tapped, you may gain 1 life.',
        'judge-1',
        'p1',
        'Judge of Currents'
      );

      const controlledMerfolk = processEvent(TriggerEvent.BECOMES_TAPPED, abilities, {
        sourceId: 'merfolk-1',
        sourceControllerId: 'p1',
        permanentTypes: ['Creature'],
        creatureTypes: ['Merfolk'],
      } as any);

      const opposingMerfolk = processEvent(TriggerEvent.BECOMES_TAPPED, abilities, {
        sourceId: 'merfolk-2',
        sourceControllerId: 'p2',
        permanentTypes: ['Creature'],
        creatureTypes: ['Merfolk'],
      } as any);

      const controlledNonMerfolk = processEvent(TriggerEvent.BECOMES_TAPPED, abilities, {
        sourceId: 'wizard-1',
        sourceControllerId: 'p1',
        permanentTypes: ['Creature'],
        creatureTypes: ['Wizard'],
      } as any);

      expect(controlledMerfolk).toHaveLength(1);
      expect(opposingMerfolk).toHaveLength(0);
      expect(controlledNonMerfolk).toHaveLength(0);
    });

    it('evaluateTriggerCondition supports controlled-creature dies filters with without-flying clauses', () => {
      const nonFlyingCreature = evaluateTriggerCondition(
        'a creature you control without flying dies',
        'p1',
        {
          sourceControllerId: 'p1',
          permanentTypes: ['Creature'],
          keywords: [],
        } as any
      );

      const flyingCreature = evaluateTriggerCondition(
        'a creature you control without flying dies',
        'p1',
        {
          sourceControllerId: 'p1',
          permanentTypes: ['Creature'],
          keywords: ['flying'],
        } as any
      );

      const opposingCreature = evaluateTriggerCondition(
        'a creature you control without flying dies',
        'p1',
        {
          sourceControllerId: 'p2',
          permanentTypes: ['Creature'],
          keywords: [],
        } as any
      );

      expect(nonFlyingCreature).toBe(true);
      expect(flyingCreature).toBe(false);
      expect(opposingCreature).toBe(false);
    });

    it('processEvent only triggers Luminous Broodmoth for your nonflying dying creature', () => {
      const abilities = parseTriggeredAbilitiesFromText(
        "Whenever a creature you control without flying dies, return it to the battlefield under its owner's control with a flying counter on it.",
        'broodmoth-1',
        'p1',
        'Luminous Broodmoth'
      );

      const controlledNonFlying = processEvent(TriggerEvent.CONTROLLED_CREATURE_DIED, abilities, {
        sourceId: 'bear-1',
        sourceControllerId: 'p1',
        targetPermanentId: 'bear-1',
        permanentTypes: ['Creature'],
        keywords: [],
      } as any);

      const controlledFlying = processEvent(TriggerEvent.CONTROLLED_CREATURE_DIED, abilities, {
        sourceId: 'spirit-1',
        sourceControllerId: 'p1',
        targetPermanentId: 'spirit-1',
        permanentTypes: ['Creature'],
        keywords: ['flying'],
      } as any);

      const opposingNonFlying = processEvent(TriggerEvent.CONTROLLED_CREATURE_DIED, abilities, {
        sourceId: 'bear-2',
        sourceControllerId: 'p2',
        targetPermanentId: 'bear-2',
        permanentTypes: ['Creature'],
        keywords: [],
      } as any);

      expect(controlledNonFlying).toHaveLength(1);
      expect(controlledFlying).toHaveLength(0);
      expect(opposingNonFlying).toHaveLength(0);
    });

    it('processEvent only triggers Edea for a creature you control but do not own', () => {
      const abilities = parseTriggeredAbilitiesFromText(
        "Whenever a creature you control but don't own dies, return it to the battlefield under its owner's control and you draw a card.",
        'edea-1',
        'p1',
        'Edea, Possessed Sorceress'
      );

      const borrowedCreature = processEvent(TriggerEvent.CONTROLLED_CREATURE_DIED, abilities, {
        sourceId: 'borrowed-creature',
        sourceControllerId: 'p1',
        sourceOwnerId: 'p2',
        targetPermanentId: 'borrowed-creature',
        permanentTypes: ['Creature'],
      } as any);

      const ownedCreature = processEvent(TriggerEvent.CONTROLLED_CREATURE_DIED, abilities, {
        sourceId: 'owned-creature',
        sourceControllerId: 'p1',
        sourceOwnerId: 'p1',
        targetPermanentId: 'owned-creature',
        permanentTypes: ['Creature'],
      } as any);

      const opposingCreature = processEvent(TriggerEvent.CONTROLLED_CREATURE_DIED, abilities, {
        sourceId: 'opposing-creature',
        sourceControllerId: 'p2',
        sourceOwnerId: 'p3',
        targetPermanentId: 'opposing-creature',
        permanentTypes: ['Creature'],
      } as any);

      expect(borrowedCreature).toHaveLength(1);
      expect(ownedCreature).toHaveLength(0);
      expect(opposingCreature).toHaveLength(0);
    });

    it('processEvent supports subtype and counter-qualified dies filters', () => {
      const marchesaAbilities = parseTriggeredAbilitiesFromText(
        'Whenever a creature you control with a +1/+1 counter on it dies, return that card to the battlefield under your control at the beginning of the next end step.',
        'marchesa',
        'p1',
        'Marchesa, the Black Rose'
      );
      const thunderboltsAbilities = parseTriggeredAbilitiesFromText(
        "Whenever a Villain you control dies, return it to the battlefield under its owner's control with a finality counter on it.",
        'thunderbolts',
        'p1',
        'Thunderbolts Conspiracy'
      );

      const marchesaMatch = processEvent(TriggerEvent.CONTROLLED_CREATURE_DIED, marchesaAbilities, {
        sourceId: 'counter-creature',
        sourceControllerId: 'p1',
        targetPermanentId: 'counter-creature',
        permanentTypes: ['Creature'],
        counters: { '+1/+1': 1 },
      } as any);
      const marchesaMiss = processEvent(TriggerEvent.CONTROLLED_CREATURE_DIED, marchesaAbilities, {
        sourceId: 'plain-creature',
        sourceControllerId: 'p1',
        targetPermanentId: 'plain-creature',
        permanentTypes: ['Creature'],
        counters: {},
      } as any);
      const thunderboltsMatch = processEvent(TriggerEvent.DIES, thunderboltsAbilities, {
        sourceId: 'villain-creature',
        sourceControllerId: 'p1',
        targetPermanentId: 'villain-creature',
        permanentTypes: ['Creature'],
        creatureTypes: ['Villain'],
      } as any);
      const thunderboltsMiss = processEvent(TriggerEvent.DIES, thunderboltsAbilities, {
        sourceId: 'hero-creature',
        sourceControllerId: 'p1',
        targetPermanentId: 'hero-creature',
        permanentTypes: ['Creature'],
        creatureTypes: ['Hero'],
      } as any);

      expect(marchesaMatch).toHaveLength(1);
      expect(marchesaMiss).toHaveLength(0);
      expect(thunderboltsMatch).toHaveLength(1);
      expect(thunderboltsMiss).toHaveLength(0);
    });

    it("processEvent supports comma-qualified non-Angel dies filters from Valkyrie's Call", () => {
      const abilities = parseTriggeredAbilitiesFromText(
        "Whenever a nontoken, non-Angel creature you control dies, return that card to the battlefield under its owner's control with a +1/+1 counter on it.",
        'valkyries-call',
        'p1',
        "Valkyrie's Call"
      );

      const validDeath = processEvent(TriggerEvent.DIES, abilities, {
        sourceId: 'bear',
        sourceControllerId: 'p1',
        sourceOwnerId: 'p1',
        targetPermanentId: 'bear',
        permanentTypes: ['Creature'],
        permanentName: 'Bear',
        isToken: false,
      } as any);

      const angelDeath = processEvent(TriggerEvent.DIES, abilities, {
        sourceId: 'angel',
        sourceControllerId: 'p1',
        sourceOwnerId: 'p1',
        targetPermanentId: 'angel',
        permanentTypes: ['Creature'],
        creatureTypes: ['Angel'],
        isToken: false,
      } as any);

      const tokenDeath = processEvent(TriggerEvent.DIES, abilities, {
        sourceId: 'token-bear',
        sourceControllerId: 'p1',
        sourceOwnerId: 'p1',
        targetPermanentId: 'token-bear',
        permanentTypes: ['Creature'],
        sourceIsToken: true,
      } as any);

      expect(validDeath).toHaveLength(1);
      expect(angelDeath).toHaveLength(0);
      expect(tokenDeath).toHaveLength(0);
    });

    it('processEvent supports face-down controlled-creature dies filters from Yarus', () => {
      const abilities = parseTriggeredAbilitiesFromText(
        "Whenever a face-down creature you control dies, return it to the battlefield face down under its owner's control if it's a permanent card, then turn it face up.",
        'yarus',
        'p1',
        'Yarus, Roar of the Old Gods'
      );

      const faceDownMatch = processEvent(TriggerEvent.CONTROLLED_CREATURE_DIED, abilities, {
        sourceId: 'morphed-creature',
        sourceControllerId: 'p1',
        sourceOwnerId: 'p2',
        targetPermanentId: 'morphed-creature',
        permanentTypes: ['Creature'],
        sourceIsFaceDown: true,
      } as any);

      const faceUpMiss = processEvent(TriggerEvent.CONTROLLED_CREATURE_DIED, abilities, {
        sourceId: 'face-up-creature',
        sourceControllerId: 'p1',
        sourceOwnerId: 'p2',
        targetPermanentId: 'face-up-creature',
        permanentTypes: ['Creature'],
        sourceIsFaceDown: false,
      } as any);

      expect(abilities[0]?.triggerFilter).toBe('a face-down creature you control dies');
      expect(faceDownMatch).toHaveLength(1);
      expect(faceUpMiss).toHaveLength(0);
    });

    it('processEvent supports one-or-more controlled die wording from Liesa, Forgotten Archangel', () => {
      const abilities = parseTriggeredAbilitiesFromText(
        "Whenever one or more nontoken creatures you control die, return those cards to their owner's hand at the beginning of the next end step.",
        'liesa',
        'p1',
        'Liesa, Forgotten Archangel'
      );

      const nontokenMatch = processEvent(TriggerEvent.DIES, abilities, {
        sourceId: 'dead-cleric',
        sourceControllerId: 'p1',
        sourceOwnerId: 'p1',
        targetPermanentId: 'dead-cleric',
        chosenObjectIds: ['dead-cleric'],
        permanentTypes: ['Creature'],
        sourceIsToken: false,
      } as any);
      const tokenMiss = processEvent(TriggerEvent.DIES, abilities, {
        sourceId: 'dead-token',
        sourceControllerId: 'p1',
        sourceOwnerId: 'p1',
        targetPermanentId: 'dead-token',
        chosenObjectIds: ['dead-token'],
        permanentTypes: ['Creature'],
        sourceIsToken: true,
      } as any);

      expect(nontokenMatch).toHaveLength(1);
      expect(tokenMiss).toHaveLength(0);
    });

    it('processEvent supports multicolored dies filters from Rienne, Angel of Rebirth', () => {
      const abilities = parseTriggeredAbilitiesFromText(
        "Whenever another multicolored creature you control dies, return it to its owner's hand at the beginning of the next end step.",
        'rienne',
        'p1',
        'Rienne, Angel of Rebirth'
      );

      const multicoloredMatch = processEvent(TriggerEvent.DIES, abilities, {
        sourceId: 'dead-knight',
        sourceControllerId: 'p1',
        sourceOwnerId: 'p2',
        targetPermanentId: 'dead-knight',
        chosenObjectIds: ['dead-knight'],
        permanentTypes: ['Creature'],
        colors: ['R', 'W'],
      } as any);
      const monocoloredMiss = processEvent(TriggerEvent.DIES, abilities, {
        sourceId: 'dead-soldier',
        sourceControllerId: 'p1',
        sourceOwnerId: 'p1',
        targetPermanentId: 'dead-soldier',
        chosenObjectIds: ['dead-soldier'],
        permanentTypes: ['Creature'],
        colors: ['W'],
      } as any);

      expect(multicoloredMatch).toHaveLength(1);
      expect(monocoloredMiss).toHaveLength(0);
    });

    it('processEvent supports owned-creature dies filters from Athreos, God of Passage', () => {
      const abilities = parseTriggeredAbilitiesFromText(
        'Whenever another creature you own dies, return it to your hand unless target opponent pays 3 life.',
        'athreos',
        'p1',
        'Athreos, God of Passage'
      );

      const ownedMatch = processEvent(TriggerEvent.DIES, abilities, {
        sourceId: 'dead-cleric',
        sourceControllerId: 'p2',
        sourceOwnerId: 'p1',
        targetPermanentId: 'dead-cleric',
        chosenObjectIds: ['dead-cleric'],
        permanentTypes: ['Creature'],
      } as any);
      const notOwnedMiss = processEvent(TriggerEvent.DIES, abilities, {
        sourceId: 'dead-borrowed',
        sourceControllerId: 'p1',
        sourceOwnerId: 'p2',
        targetPermanentId: 'dead-borrowed',
        chosenObjectIds: ['dead-borrowed'],
        permanentTypes: ['Creature'],
      } as any);

      expect(ownedMatch).toHaveLength(1);
      expect(notOwnedMiss).toHaveLength(0);
    });

    it('processEvent only triggers attached-host dies abilities for the source attachment', () => {
      const giftAbilities = parseTriggeredAbilitiesFromText(
        'When enchanted creature dies, return that card to the battlefield under its owner\'s control.',
        'gift-aura',
        'p1',
        'Gift of Immortality'
      );
      const orbAbilities = parseTriggeredAbilitiesFromText(
        "When equipped creature dies, return that card to the battlefield under your control at the beginning of the next end step.",
        'orb-equip',
        'p1',
        'Resurrection Orb'
      );

      const enchantedMatch = processEvent(TriggerEvent.DIES, giftAbilities, {
        sourceId: 'dead-bear',
        sourceControllerId: 'p1',
        targetPermanentId: 'dead-bear',
        permanentTypes: ['Creature'],
        attachedByPermanentIds: ['gift-aura'],
      } as any);
      const enchantedMiss = processEvent(TriggerEvent.DIES, giftAbilities, {
        sourceId: 'dead-bear',
        sourceControllerId: 'p1',
        targetPermanentId: 'dead-bear',
        permanentTypes: ['Creature'],
        attachedByPermanentIds: ['other-aura'],
      } as any);
      const equippedMatch = processEvent(TriggerEvent.DIES, orbAbilities, {
        sourceId: 'dead-knight',
        sourceControllerId: 'p1',
        targetPermanentId: 'dead-knight',
        permanentTypes: ['Creature'],
        attachedByPermanentIds: ['orb-equip'],
      } as any);

      expect(enchantedMatch).toHaveLength(1);
      expect(enchantedMiss).toHaveLength(0);
      expect(equippedMatch).toHaveLength(1);
    });

    it('processEvent supports damage-provenance dies filters from Dread Slaver and Soul Collector', () => {
      const dreadAbilities = parseTriggeredAbilitiesFromText(
        'Whenever a creature dealt damage by this creature this turn dies, return it to the battlefield under your control.',
        'dread-slaver',
        'p1',
        'Dread Slaver'
      );
      const soulAbilities = parseTriggeredAbilitiesFromText(
        'Whenever a creature dealt damage by this creature this turn dies, return that card to the battlefield under your control.',
        'soul-collector',
        'p1',
        'Soul Collector'
      );

      const dreadMatch = processEvent(TriggerEvent.DIES, dreadAbilities, {
        sourceId: 'dead-bear',
        sourceControllerId: 'p2',
        sourceOwnerId: 'p2',
        targetPermanentId: 'dead-bear',
        permanentTypes: ['Creature'],
        damagedByPermanentIds: ['dread-slaver'],
      } as any);
      const dreadMiss = processEvent(TriggerEvent.DIES, dreadAbilities, {
        sourceId: 'dead-bear',
        sourceControllerId: 'p2',
        sourceOwnerId: 'p2',
        targetPermanentId: 'dead-bear',
        permanentTypes: ['Creature'],
        damagedByPermanentIds: ['other-creature'],
      } as any);
      const soulMatch = processEvent(TriggerEvent.DIES, soulAbilities, {
        sourceId: 'dead-wolf',
        sourceControllerId: 'p2',
        sourceOwnerId: 'p2',
        targetPermanentId: 'dead-wolf',
        permanentTypes: ['Creature'],
        damagedByPermanentIds: ['soul-collector'],
      } as any);

      expect(dreadMatch).toHaveLength(1);
      expect(dreadMiss).toHaveLength(0);
      expect(soulMatch).toHaveLength(1);
    });

    it('processEvent supports equipped-creature damage provenance filters from Scythe of the Wretched', () => {
      const abilities = parseTriggeredAbilitiesFromText(
        'Whenever a creature dealt damage by equipped creature this turn dies, return that card to the battlefield under your control.',
        'scythe',
        'p1',
        'Scythe of the Wretched'
      );

      const match = processEvent(TriggerEvent.DIES, abilities, {
        sourceId: 'dead-knight',
        sourceControllerId: 'p2',
        sourceOwnerId: 'p2',
        targetPermanentId: 'dead-knight',
        permanentTypes: ['Creature'],
        damagedByPermanentIds: ['equipped-attacker'],
        sourceAttachedToPermanentIds: ['equipped-attacker'],
      } as any);
      const miss = processEvent(TriggerEvent.DIES, abilities, {
        sourceId: 'dead-knight',
        sourceControllerId: 'p2',
        sourceOwnerId: 'p2',
        targetPermanentId: 'dead-knight',
        permanentTypes: ['Creature'],
        damagedByPermanentIds: ['different-attacker'],
        sourceAttachedToPermanentIds: ['equipped-attacker'],
      } as any);

      expect(match).toHaveLength(1);
      expect(miss).toHaveLength(0);
    });

    it.each([
      {
        name: 'Endless Cockroaches',
        permanentId: 'cockroaches',
        text: 'When Endless Cockroaches is put into your graveyard from the battlefield, return Endless Cockroaches to your hand.',
        expectedFilter: 'this permanent is put into your graveyard from the battlefield',
      },
      {
        name: 'Mortus Strider',
        permanentId: 'mortus-strider',
        text: "When Mortus Strider dies, return it to its owner's hand.",
        expectedFilter: 'this permanent dies',
      },
      {
        name: 'Weatherseed Treefolk',
        permanentId: 'weatherseed-treefolk',
        text: "When Weatherseed Treefolk dies, return it to its owner's hand.",
        expectedFilter: 'this permanent dies',
      },
      {
        name: 'Shivan Phoenix',
        permanentId: 'shivan-phoenix',
        text: "When Shivan Phoenix is put into a graveyard from the battlefield, return Shivan Phoenix to its owner's hand.",
        expectedFilter: 'this permanent is put into a graveyard from the battlefield',
      },
      {
        name: 'Immortal Phoenix',
        permanentId: 'immortal-phoenix',
        text: "When Immortal Phoenix dies, return it to its owner's hand.",
        expectedFilter: 'this permanent dies',
      },
    ])('parses and matches self dies-to-hand triggers for $name', ({ name, permanentId, text, expectedFilter }) => {
      const abilities = parseTriggeredAbilitiesFromText(text, permanentId, 'p1', name);

      expect(abilities).toHaveLength(1);
      expect(abilities[0]?.event).toBe(TriggerEvent.DIES);
      expect(abilities[0]?.triggerFilter).toBe(expectedFilter);

      const match = processEvent(TriggerEvent.DIES, abilities, {
        sourceId: permanentId,
        sourceControllerId: 'p1',
        sourceOwnerId: 'p1',
        targetPermanentId: permanentId,
        permanentTypes: ['Creature'],
      } as any);

      expect(match).toHaveLength(1);
    });

    it("matches self Aura graveyard triggers like Fool's Demise only for the source permanent", () => {
      const abilities = parseTriggeredAbilitiesFromText(
        "When Fool's Demise is put into a graveyard from the battlefield, return Fool's Demise to its owner's hand.",
        'fools-demise',
        'p1',
        "Fool's Demise"
      );

      expect(abilities).toHaveLength(1);
      expect(abilities[0]?.event).toBe(TriggerEvent.DIES);
      expect(abilities[0]?.triggerFilter).toBe('this permanent is put into a graveyard from the battlefield');

      const match = processEvent(TriggerEvent.DIES, abilities, {
        sourceId: 'fools-demise',
        sourceControllerId: 'p1',
        sourceOwnerId: 'p1',
        targetPermanentId: 'fools-demise',
        permanentTypes: ['Enchantment'],
      } as any);
      const miss = processEvent(TriggerEvent.DIES, abilities, {
        sourceId: 'other-aura',
        sourceControllerId: 'p1',
        sourceOwnerId: 'p1',
        targetPermanentId: 'other-aura',
        permanentTypes: ['Enchantment'],
      } as any);

      expect(match).toHaveLength(1);
      expect(miss).toHaveLength(0);
    });

    it('evaluateTriggerCondition supports opponent control count thresholds for creatures', () => {
      const ok = evaluateTriggerCondition(
        'if an opponent controls 2 or more creatures',
        'p1',
        {
          sourceControllerId: 'p2',
          battlefield: [
            { id: 'o1', controllerId: 'p2', types: ['Creature'] },
            { id: 'o2', controllerId: 'p3', types: ['Creature'] },
          ],
        } as any
      );

      const fail = evaluateTriggerCondition(
        'if an opponent controls 3 or more creatures',
        'p1',
        {
          sourceControllerId: 'p2',
          battlefield: [
            { id: 'o1', controllerId: 'p2', types: ['Creature'] },
            { id: 'o2', controllerId: 'p3', types: ['Creature'] },
          ],
        } as any
      );

      expect(ok).toBe(true);
      expect(fail).toBe(false);
    });

    it('evaluateTriggerCondition supports hand-size checks at the beginning of this turn', () => {
      const noCardsOk = evaluateTriggerCondition(
        'if you had no cards in hand at the beginning of this turn',
        'p1',
        {
          sourceControllerId: 'p1',
          hand: ['drawnLater'],
          handAtBeginningOfTurn: [],
        } as any
      );

      const hadCardOk = evaluateTriggerCondition(
        'if you had a card in hand at the beginning of this turn',
        'p1',
        {
          sourceControllerId: 'p1',
          hand: [],
          handAtBeginningOfTurn: ['openingCard'],
        } as any
      );

      const hadCardFail = evaluateTriggerCondition(
        'if you had a card in hand at the beginning of this turn',
        'p1',
        {
          sourceControllerId: 'p1',
          hand: ['currentCard'],
          handAtBeginningOfTurn: [],
        } as any
      );

      expect(noCardsOk).toBe(true);
      expect(hadCardOk).toBe(true);
      expect(hadCardFail).toBe(false);
    });

    it('evaluateTriggerCondition supports opponent control checks for enchantments and permanents', () => {
      const enchantmentOk = evaluateTriggerCondition(
        'if an opponent controls an enchantment',
        'p1',
        {
          sourceControllerId: 'p2',
          battlefield: [
            { id: 'e1', controllerId: 'p2', types: ['Enchantment'] },
          ],
        } as any
      );

      const permanentCountOk = evaluateTriggerCondition(
        'if an opponent controls 2 or more permanents',
        'p1',
        {
          sourceControllerId: 'p2',
          battlefield: [
            { id: 'x1', controllerId: 'p2', types: ['Artifact'] },
            { id: 'x2', controllerId: 'p3', types: ['Creature'] },
          ],
        } as any
      );

      expect(enchantmentOk).toBe(true);
      expect(permanentCountOk).toBe(true);
    });

    it('evaluateTriggerCondition supports opponent land and planeswalker classes with thresholds', () => {
      const landOk = evaluateTriggerCondition(
        'if an opponent controls 2 or more lands',
        'p1',
        {
          sourceControllerId: 'p2',
          battlefield: [
            { id: 'l1', controllerId: 'p2', types: ['Land'] },
            { id: 'l2', controllerId: 'p3', types: ['Land'] },
          ],
        } as any
      );

      const planeswalkerPresenceOk = evaluateTriggerCondition(
        'if an opponent controls a planeswalker',
        'p1',
        {
          sourceControllerId: 'p2',
          battlefield: [
            { id: 'pw1', controllerId: 'p2', types: ['Planeswalker'] },
          ],
        } as any
      );

      const planeswalkerThresholdFail = evaluateTriggerCondition(
        'if an opponent controls 2 or more planeswalkers',
        'p1',
        {
          sourceControllerId: 'p2',
          battlefield: [
            { id: 'pw1', controllerId: 'p2', types: ['Planeswalker'] },
          ],
        } as any
      );

      expect(landOk).toBe(true);
      expect(planeswalkerPresenceOk).toBe(true);
      expect(planeswalkerThresholdFail).toBe(false);
    });
  });
});
