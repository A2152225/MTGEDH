/**
 * Tests for trigger parsing from oracle text
 */
import { describe, it, expect } from 'vitest';
import type { GameState } from '../../shared/src';
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
  buildTriggerEventDataFromPayloads,
  buildStackTriggerMetaFromEventData,
  buildOracleIRExecutionEventHintFromTriggerData,
  executeTriggeredAbilityEffectWithOracleIR,
  processEventAndExecuteTriggeredOracle,
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
      expect(eventData.targetOpponentId).toBe('p2');
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

    it('builds stack trigger meta snapshot from normalized event data', () => {
      const meta = buildStackTriggerMetaFromEventData(
        'Target opponent loses 1 life.',
        'src-1',
        'p1',
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
      expect((stackObjects[0] as any).triggerMeta?.hasInterveningIf).toBe(true);
      expect((stackObjects[0] as any).triggerMeta?.interveningIfClause).toBe('you control an artifact');
      expect((stackObjects[0] as any).triggerMeta?.interveningIfWasTrueAtTrigger).toBe(true);
      expect((stackObjects[0] as any).triggerMeta?.triggerEventDataSnapshot?.sourceControllerId).toBe('p1');
    });
  });

  describe('Resolution event data builder', () => {
    it('buildResolutionEventDataFromGameState derives controller turn/life/battlefield context', () => {
      const state = makeState({ turnPlayer: 'p1' } as any);
      const out = buildResolutionEventDataFromGameState(state, 'p1');

      expect(out.sourceControllerId).toBe('p1');
      expect(out.isYourTurn).toBe(true);
      expect(out.isOpponentsTurn).toBe(false);
      expect(out.lifeTotal).toBe(40);
      expect(Array.isArray(out.battlefield)).toBe(true);
    });
  });
});
