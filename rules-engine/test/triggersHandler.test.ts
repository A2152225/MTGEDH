import { describe, it, expect } from 'vitest';
import type { GameState } from '../../shared/src';
import { TriggerEvent } from '../src/triggeredAbilities';
import {
  processTriggers,
  processTriggersAutoOracle,
  checkETBTriggers,
  checkCombatDamageToPlayerTriggers,
  checkLandfallTriggers,
  checkTribalCastTriggers,
  checkDrawTriggers,
  findTriggeredAbilities,
} from '../src/actions/triggersHandler';
import { makeMerfolkIterationState } from './helpers/merfolkIterationFixture';

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
    activePlayerIndex: 0 as any,
    ...overrides,
  } as any;
}

describe('triggersHandler Oracle automation', () => {
  it('finds beginning-of-combat triggers from emblems controlled by a player', () => {
    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [],
          exile: [],
          emblems: [
            {
              id: 'liliana-emblem',
              name: 'Liliana, Waker of the Dead Emblem',
              owner: 'p1',
              controller: 'p1',
              abilities: [
                'At the beginning of combat on your turn, put target creature card from a graveyard onto the battlefield under your control.',
              ],
            },
          ],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const abilities = findTriggeredAbilities(start);
    const emblemTrigger = abilities.find(ability => ability.sourceId === 'liliana-emblem');

    expect(emblemTrigger).toBeTruthy();
    expect(emblemTrigger?.event).toBe(TriggerEvent.BEGINNING_OF_COMBAT);
    expect(emblemTrigger?.controllerId).toBe('p1');
    expect(emblemTrigger?.effect).toContain('put target creature card from a graveyard onto the battlefield under your control');
  });

  it('finds graveyard-active triggers on cards sitting in graveyards', () => {
    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [
            {
              id: 'shade',
              name: 'Skyclave Shade',
              type_line: 'Creature - Shade',
              oracle_text:
                "Landfall - Whenever a land you control enters, if this card is in your graveyard and it's your turn, you may cast it from your graveyard this turn.",
            },
            {
              id: 'amalgam',
              name: 'Prized Amalgam',
              type_line: 'Creature - Zombie',
              oracle_text:
                'Whenever a creature enters, if it entered from your graveyard or you cast it from your graveyard, return this card from your graveyard to the battlefield tapped at the beginning of the next end step.',
            },
          ],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const abilities = findTriggeredAbilities(start);

    expect(abilities.some(ability => ability.sourceId === 'shade' && ability.event === TriggerEvent.LANDFALL)).toBe(true);
    expect(abilities.some(ability => ability.sourceId === 'amalgam' && ability.event === TriggerEvent.ENTERS_BATTLEFIELD)).toBe(true);
  });

  it('checkLandfallTriggers discovers Skyclave Shade in the graveyard and queues its optional landfall trigger', () => {
    const start = makeState({
      turnNumber: 11 as any,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [
            {
              id: 'shade',
              name: 'Skyclave Shade',
              type_line: 'Creature - Shade',
              oracle_text:
                "Landfall - Whenever a land you control enters, if this card is in your graveyard and it's your turn, you may cast it from your graveyard this turn.",
            },
          ],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = checkLandfallTriggers(start, 'p1');

    expect(result.triggersAdded).toBeGreaterThan(0);
    expect((result.state.stack || []).length).toBeGreaterThan(0);
    expect(result.logs.some(entry => entry.includes('Skyclave Shade triggered ability processed'))).toBe(true);
  });

  it('checkETBTriggers queues graveyard-provenance ETB triggers for Rocket-Powered Goblin Glider and Prized Amalgam', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'rocket-perm',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          castFromZone: 'graveyard',
          card: {
            id: 'rocket-card',
            name: 'Rocket-Powered Goblin Glider',
            type_line: 'Artifact - Equipment',
            oracle_text:
              'When this Equipment enters, if it was cast from your graveyard, attach it to target creature you control.',
            castFromZone: 'graveyard',
          },
        },
        {
          id: 'reanimated-bear',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          enteredFromZone: 'graveyard',
          card: {
            id: 'bear-card',
            name: 'Reanimated Bear',
            type_line: 'Creature - Bear',
            enteredFromZone: 'graveyard',
          },
        },
      ] as any,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }],
          hand: [],
          graveyard: [
            {
              id: 'amalgam',
              name: 'Prized Amalgam',
              type_line: 'Creature - Zombie',
              oracle_text:
                'Whenever a creature enters, if it entered from your graveyard or you cast it from your graveyard, return this card from your graveyard to the battlefield tapped at the beginning of the next end step.',
            },
          ],
          exile: [],
        } as any,
        {
          id: 'p2',
          name: 'P2',
          seat: 1,
          life: 40,
          library: [{ id: 'p2c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const rocketResult = checkETBTriggers(start, 'rocket-perm', 'p1');
    const prizedResult = checkETBTriggers(start, 'reanimated-bear', 'p1');

    expect(rocketResult.triggersAdded).toBeGreaterThan(0);
    expect((rocketResult.state.stack || []).length).toBeGreaterThan(0);
    expect(prizedResult.triggersAdded).toBeGreaterThan(0);
    expect((prizedResult.state.stack || []).length).toBeGreaterThan(0);
  });

  it('keeps legacy behavior when autoExecuteOracle is disabled', () => {
    const start = makeState();
    const abilities = [
      {
        id: 'a1',
        sourceId: 'src1',
        sourceName: 'Test Trigger',
        controllerId: 'p1',
        keyword: 'whenever',
        event: TriggerEvent.ATTACKS,
        effect: 'Target opponent loses 1 life.',
      } as any,
    ];

    const result = processTriggers(start, TriggerEvent.ATTACKS, abilities, { targetOpponentId: 'p3' });
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.triggersAdded).toBe(1);
    expect(result.oracleStepsApplied).toBe(0);
    expect(p3.life).toBe(40);
    expect((result.state.stack || []).length).toBe(1);
  });

  it('auto-executes target_opponent effect when autoExecuteOracle is enabled', () => {
    const start = makeState();
    const abilities = [
      {
        id: 'a2',
        sourceId: 'src2',
        sourceName: 'Test Trigger',
        controllerId: 'p1',
        keyword: 'whenever',
        event: TriggerEvent.ATTACKS,
        effect: 'Target opponent loses 1 life.',
      } as any,
    ];

    const result = processTriggers(
      start,
      TriggerEvent.ATTACKS,
      abilities,
      { targetOpponentId: 'p3' },
      { autoExecuteOracle: true }
    );
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.triggersAdded).toBe(1);
    expect((result.oracleStepsApplied || 0) > 0).toBe(true);
    expect(result.oracleExecutions).toBe(1);
    expect(result.oracleStepsSkipped).toBe(0);
    expect(p2.life).toBe(40);
    expect(p3.life).toBe(39);
    expect((result.state.stack || []).length).toBe(1);
  });

  it('reports skipped oracle steps for unsupported deterministic trigger execution', () => {
    const start = makeState();
    const abilities = [
      {
        id: 'a2-skip',
        sourceId: 'src2-skip',
        sourceName: 'Skip Trigger',
        controllerId: 'p1',
        keyword: 'whenever',
        event: TriggerEvent.ATTACKS,
        effect: 'Target player loses 1 life.',
      } as any,
    ];

    const result = processTriggers(
      start,
      TriggerEvent.ATTACKS,
      abilities,
      undefined,
      { autoExecuteOracle: true }
    );

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.triggersAdded).toBe(1);
    expect(result.oracleExecutions).toBe(1);
    expect(result.oracleStepsApplied).toBe(0);
    expect((result.oracleStepsSkipped || 0) > 0).toBe(true);
    expect((result.oracleAutomationGaps || 0) > 0).toBe(true);
    expect(p1.life).toBe(40);
    expect(p2.life).toBe(40);
    expect(p3.life).toBe(40);
    expect(((result.state as any).oracleAutomationGaps || []).length > 0).toBe(true);
    expect(result.logs.some(x => x.includes('[triggers] Oracle auto-execution: executions=1'))).toBe(true);
  });

  it('processTriggersAutoOracle resolves relational each_of_those_opponents from event data', () => {
    const start = makeState();
    const abilities = [
      {
        id: 'a3',
        sourceId: 'breeches-1',
        sourceName: 'Breeches, Brazen Plunderer',
        controllerId: 'p1',
        keyword: 'whenever',
        event: TriggerEvent.DEALS_COMBAT_DAMAGE_TO_PLAYER,
        effect:
          "Exile the top card of each of those opponents' libraries. You may play those cards this turn, and you may spend mana as though it were mana of any color to cast those spells.",
      } as any,
    ];

    const result = processTriggersAutoOracle(start, TriggerEvent.DEALS_COMBAT_DAMAGE_TO_PLAYER, abilities, {
      opponentsDealtDamageIds: ['p2'],
    });

    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.triggersAdded).toBe(1);
    expect((result.oracleStepsApplied || 0) > 0).toBe(true);
    expect(p2.library.map((c: any) => c.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((c: any) => c.id)).toEqual(['p2c1']);
    expect(p3.library.map((c: any) => c.id)).toEqual(['p3c1', 'p3c2']);
    expect(p3.exile || []).toHaveLength(0);
  });

  it('processTriggers uses resolutionEventData to recheck intervening-if during auto Oracle execution', () => {
    const start = makeState();
    const abilities = [
      {
        id: 'a4',
        sourceId: 'if-src',
        sourceName: 'If Source',
        controllerId: 'p1',
        keyword: 'whenever',
        event: TriggerEvent.ATTACKS,
        effect: 'Draw a card.',
        interveningIfClause: 'you control an artifact',
        hasInterveningIf: true,
      } as any,
    ];

    const result = processTriggers(
      start,
      TriggerEvent.ATTACKS,
      abilities,
      {
        sourceControllerId: 'p1',
        battlefield: [{ id: 'a', controllerId: 'p1', types: ['Artifact'] }],
      },
      {
        autoExecuteOracle: true,
        resolutionEventData: {
          sourceControllerId: 'p1',
          battlefield: [{ id: 'c', controllerId: 'p1', types: ['Creature'] }],
        },
      }
    );

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(result.triggersAdded).toBe(1);
    expect(result.oracleStepsApplied).toBe(0);
    expect(p1.hand || []).toHaveLength(0);
    expect(result.logs.some(x => x.includes('intervening-if false'))).toBe(true);
  });

  it('processTriggers rechecks intervening-if from condition fallback when clause field is absent', () => {
    const start = makeState();
    const abilities = [
      {
        id: 'a4b',
        sourceId: 'if-src-b',
        sourceName: 'If Source Fallback',
        controllerId: 'p1',
        keyword: 'whenever',
        event: TriggerEvent.ATTACKS,
        effect: 'Draw a card.',
        condition: 'you control an artifact',
        hasInterveningIf: true,
      } as any,
    ];

    const result = processTriggers(
      start,
      TriggerEvent.ATTACKS,
      abilities,
      {
        sourceControllerId: 'p1',
        battlefield: [{ id: 'a', controllerId: 'p1', types: ['Artifact'] }],
      },
      {
        autoExecuteOracle: true,
        resolutionEventData: {
          sourceControllerId: 'p1',
          battlefield: [{ id: 'c', controllerId: 'p1', types: ['Creature'] }],
        },
      }
    );

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    expect(result.triggersAdded).toBe(1);
    expect(result.oracleStepsApplied).toBe(0);
    expect(p1.hand || []).toHaveLength(0);
    expect(result.logs.some(x => x.includes('intervening-if false'))).toBe(true);
  });

  it('checkCombatDamageToPlayerTriggers derives opponentsDealtDamageIds from assignments', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'breeches-1',
          controller: 'p1',
          card: {
            name: 'Breeches, Brazen Plunderer',
            oracle_text:
              'Whenever this creature deals combat damage to a player, each of those opponents loses 1 life.',
          },
        } as any,
      ],
    });

    const result = checkCombatDamageToPlayerTriggers(start, 'p1', [
      { attackerId: 'a1', defendingPlayerId: 'p2', damage: 2 },
      { attackerId: 'a2', defendingPlayerId: 'p3', damage: 3 },
    ]);

    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.triggersAdded).toBe(1);
    expect((result.oracleStepsApplied || 0) > 0).toBe(true);
    expect(p2.life).toBe(39);
    expect(p3.life).toBe(39);
  });

  it('processTriggersAutoOracle resolves Luminous Broodmoth for a controlled nonflying creature that died', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'broodmoth-1',
          controller: 'p1',
          owner: 'p1',
          card: {
            id: 'broodmoth-card',
            name: 'Luminous Broodmoth',
            type_line: 'Creature - Insect',
            oracle_text:
              "Flying\nWhenever a creature you control without flying dies, return it to the battlefield under its owner's control with a flying counter on it.",
            power: '3',
            toughness: '4',
          },
        } as any,
      ],
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [{ id: 'p1c1' }, { id: 'p1c2' }],
          hand: [],
          graveyard: [{ id: 'bear-1', name: 'Test Bear', type_line: 'Creature - Bear', power: '2', toughness: '2' }],
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
    });

    const abilities = findTriggeredAbilities(start).filter(
      ability => ability.event === TriggerEvent.CONTROLLED_CREATURE_DIED
    );

    const result = processTriggersAutoOracle(
      start,
      TriggerEvent.CONTROLLED_CREATURE_DIED,
      abilities,
      {
        sourceId: 'bear-1',
        sourceControllerId: 'p1',
        targetPermanentId: 'bear-1',
        chosenObjectIds: ['bear-1'],
        permanentTypes: ['Creature'],
        keywords: [],
      } as any
    );

    const player1 = result.state.players.find(p => p.id === 'p1') as any;
    const returned = (result.state.battlefield || []).find(
      (perm: any) => String(perm?.card?.id || perm?.id || '') === 'bear-1'
    ) as any;

    expect(result.triggersAdded).toBe(1);
    expect((result.oracleStepsApplied || 0) > 0).toBe(true);
    expect((player1.graveyard || []).map((card: any) => card.id)).toEqual([]);
    expect(returned?.controller).toBe('p1');
    expect(returned?.owner).toBe('p1');
    expect(returned?.counters?.flying).toBe(1);
  });

  it('checkDrawTriggers binds "that player" to the drawing opponent in opponent-draw context', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'draw-trigger-1',
          controller: 'p1',
          card: {
            name: 'Draw Trigger Source',
            oracle_text: 'Whenever an opponent draws a card, that player loses 1 life.',
          },
        } as any,
      ],
    });

    const result = checkDrawTriggers(start, 'p2', true);

    const p1 = result.state.players.find(p => p.id === 'p1') as any;
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.triggersAdded).toBe(1);
    expect((result.oracleStepsApplied || 0) > 0).toBe(true);
    expect(p1.life).toBe(40);
    expect(p2.life).toBe(39);
    expect(p3.life).toBe(40);
  });

  it('processTriggers auto-executes Merrow Reejerey untap when trigger context provides target permanent and choice', () => {
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
        keyword: 'whenever',
        event: TriggerEvent.CREATURE_SPELL_CAST,
        effect: 'You may tap or untap target permanent.',
      } as any,
    ];

    const result = processTriggers(
      start,
      TriggerEvent.CREATURE_SPELL_CAST,
      abilities,
      {
        sourceControllerId: 'p1',
        targetPermanentId: 'nykthos-shrine-to-nyx',
        tapOrUntapChoice: 'untap',
      },
      {
        autoExecuteOracle: true,
        allowOptional: true,
      }
    );

    const nykthos = result.state.battlefield.find((perm: any) => perm.id === 'nykthos-shrine-to-nyx') as any;

    expect(result.triggersAdded).toBe(1);
    expect((result.oracleStepsApplied || 0) > 0).toBe(true);
    expect(nykthos.tapped).toBe(false);
  });

  it('checkTribalCastTriggers uses the merfolk iteration fixture to stack Deeproot Waters token doublers', () => {
    const start = makeMerfolkIterationState();
    const startingTokenCount = ((start.battlefield || []) as any[]).filter((perm: any) => perm?.isToken).length;

    const result = checkTribalCastTriggers(
      start,
      {
        name: 'Summon the School',
        type_line: 'Kindred Sorcery — Merfolk',
        oracle_text:
          'Create two 1/1 blue Merfolk Wizard creature tokens. Tap four untapped Merfolk you control: Return this card from your graveyard to your hand.',
      } as any,
      'p1'
    );

    const createdTokens = ((result.state as any).battlefield || []).filter((perm: any) => perm?.isToken);

    expect(result.triggersAdded).toBe(2);
    expect(createdTokens.length - startingTokenCount).toBe(4);
    expect(createdTokens).toHaveLength(4);
    expect(result.logs.some(x => x.includes('Deeproot Waters triggered from casting Summon the School'))).toBe(true);
    expect(result.logs.some(x => x.includes('Merrow Reejerey triggered from casting Summon the School'))).toBe(true);
    expect((result.oracleStepsSkipped || 0) > 0).toBe(true);
  });
});
