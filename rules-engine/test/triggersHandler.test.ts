import { describe, it, expect } from 'vitest';
import type { GameState } from '../../shared/src';
import { buildResolutionEventDataFromGameState, TriggerEvent } from '../src/triggeredAbilities';
import {
  processTriggers,
  processTriggersAutoOracle,
  checkETBTriggers,
  checkBecomesBlockedTriggers,
  checkCombatDamageToPlayerTriggers,
  checkLandfallTriggers,
  checkSpellCastTriggers,
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

  it('finds Myriad as a synthesized attacks trigger on the battlefield', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'myriad-perm',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: {
            id: 'myriad-card',
            name: 'Blade Envoy',
            type_line: 'Creature - Human Warrior',
            oracle_text: 'Myriad',
          },
        } as any,
      ],
    });

    const abilities = findTriggeredAbilities(start);
    const myriadTrigger = abilities.find(ability => ability.sourceId === 'myriad-perm');

    expect(myriadTrigger).toBeTruthy();
    expect(myriadTrigger?.event).toBe(TriggerEvent.ATTACKS);
    expect(myriadTrigger?.effect).toContain('opponent other than defending player');
  });

  it('finds Annihilator as a synthesized attacks trigger on the battlefield', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'annihilator-perm',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: {
            id: 'annihilator-card',
            name: 'Void Colossus',
            type_line: 'Creature - Eldrazi',
            oracle_text: 'Annihilator 2',
          },
        } as any,
      ],
    });

    const abilities = findTriggeredAbilities(start);
    const annihilatorTrigger = abilities.find(ability => ability.sourceId === 'annihilator-perm');

    expect(annihilatorTrigger).toBeTruthy();
    expect(annihilatorTrigger?.event).toBe(TriggerEvent.ATTACKS);
    expect(annihilatorTrigger?.effect).toBe('Defending player sacrifices 2 permanents.');
  });

  it('finds Afterlife as a synthesized dies trigger on the battlefield', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'afterlife-perm',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: {
            id: 'afterlife-card',
            name: 'Imperious Oligarch',
            type_line: 'Creature - Human Cleric',
            oracle_text: 'Afterlife 2',
          },
        } as any,
      ],
    });

    const abilities = findTriggeredAbilities(start);
    const afterlifeTrigger = abilities.find(ability => ability.sourceId === 'afterlife-perm');

    expect(afterlifeTrigger).toBeTruthy();
    expect(afterlifeTrigger?.event).toBe(TriggerEvent.DIES);
    expect(afterlifeTrigger?.effect).toBe('Create 2 1/1 white and black Spirit creature tokens with flying.');
  });

  it('finds Afflict as a synthesized becomes-blocked trigger on the battlefield', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'afflict-perm',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: {
            id: 'afflict-card',
            name: 'Storm Fleet Sprinter',
            type_line: 'Creature - Orc Pirate',
            oracle_text: 'Afflict 2',
          },
        } as any,
      ],
    });

    const abilities = findTriggeredAbilities(start);
    const afflictTrigger = abilities.find(ability => ability.sourceId === 'afflict-perm');

    expect(afflictTrigger).toBeTruthy();
    expect(afflictTrigger?.event).toBe(TriggerEvent.BECOMES_BLOCKED);
    expect(afflictTrigger?.effect).toBe('Defending player loses 2 life.');
  });

  it('finds Renown as a synthesized combat-damage trigger on the battlefield', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'renown-perm',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: {
            id: 'renown-card',
            name: 'Topan Freeblade',
            type_line: 'Creature - Human Soldier',
            oracle_text: 'Renown 1',
          },
        } as any,
      ],
    });

    const abilities = findTriggeredAbilities(start);
    const renownTrigger = abilities.find(ability => ability.sourceId === 'renown-perm');

    expect(renownTrigger).toBeTruthy();
    expect(renownTrigger?.event).toBe(TriggerEvent.DEALS_COMBAT_DAMAGE_TO_PLAYER);
    expect(renownTrigger?.interveningIfClause).toBe("this creature isn't renowned");
    expect(renownTrigger?.effect).toBe('Put 1 +1/+1 counter on this creature. This creature becomes renowned.');
  });

  it('finds Ingest as a synthesized combat-damage trigger on the battlefield', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'ingest-perm',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: {
            id: 'ingest-card',
            name: 'Benthic Infiltrator',
            type_line: 'Creature - Eldrazi Drone',
            oracle_text: 'Ingest',
          },
        } as any,
      ],
    });

    const abilities = findTriggeredAbilities(start);
    const ingestTrigger = abilities.find(ability => ability.sourceId === 'ingest-perm');

    expect(ingestTrigger).toBeTruthy();
    expect(ingestTrigger?.event).toBe(TriggerEvent.DEALS_COMBAT_DAMAGE_TO_PLAYER);
    expect(ingestTrigger?.effect).toBe('That player exiles the top card of their library.');
  });

  it('finds Poisonous as a synthesized combat-damage trigger on the battlefield', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'poisonous-perm',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: {
            id: 'poisonous-card',
            name: 'Pit Scorpion',
            type_line: 'Creature - Scorpion',
            oracle_text: 'Poisonous 3',
          },
        } as any,
      ],
    });

    const abilities = findTriggeredAbilities(start);
    const poisonousTrigger = abilities.find(ability => ability.sourceId === 'poisonous-perm');

    expect(poisonousTrigger).toBeTruthy();
    expect(poisonousTrigger?.event).toBe(TriggerEvent.DEALS_COMBAT_DAMAGE_TO_PLAYER);
    expect(poisonousTrigger?.effect).toBe('That player gets 3 poison counters.');
  });

  it('finds Training as a synthesized attacks trigger on the battlefield', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'training-perm',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: {
            id: 'training-card',
            name: 'Hopeful Initiate',
            type_line: 'Creature - Human Warlock',
            oracle_text: 'Training',
          },
        } as any,
      ],
    });

    const abilities = findTriggeredAbilities(start);
    const trainingTrigger = abilities.find(ability => ability.sourceId === 'training-perm');

    expect(trainingTrigger).toBeTruthy();
    expect(trainingTrigger?.event).toBe(TriggerEvent.ATTACKS);
    expect(trainingTrigger?.effect).toBe('Put a +1/+1 counter on this creature.');
  });

  it('finds Mentor as a synthesized attacks trigger on the battlefield', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'mentor-perm',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: {
            id: 'mentor-card',
            name: 'Fresh-Faced Recruit',
            type_line: 'Creature - Human Soldier',
            oracle_text: 'Mentor',
          },
        } as any,
      ],
    });

    const abilities = findTriggeredAbilities(start);
    const mentorTrigger = abilities.find(ability => ability.sourceId === 'mentor-perm');

    expect(mentorTrigger).toBeTruthy();
    expect(mentorTrigger?.event).toBe(TriggerEvent.ATTACKS);
    expect(mentorTrigger?.effect).toBe("Put a +1/+1 counter on target attacking creature with power less than this creature's power.");
  });

  it('finds Battle cry as a synthesized attacks trigger on the battlefield', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'battle-cry-perm',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: {
            id: 'battle-cry-card',
            name: 'Signal Pest',
            type_line: 'Artifact Creature - Pest',
            oracle_text: 'Battle cry',
          },
        } as any,
      ],
    });

    const abilities = findTriggeredAbilities(start);
    const battleCryTrigger = abilities.find(ability => ability.sourceId === 'battle-cry-perm');

    expect(battleCryTrigger).toBeTruthy();
    expect(battleCryTrigger?.event).toBe(TriggerEvent.ATTACKS);
    expect(battleCryTrigger?.effect).toBe('Each other attacking creature gets +1/+0 until end of turn.');
  });

  it('finds Undying and Persist as synthesized dies triggers on the battlefield', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'undying-perm',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: {
            id: 'undying-card',
            name: 'Young Wolf',
            type_line: 'Creature - Wolf',
            oracle_text: 'Undying',
          },
        } as any,
        {
          id: 'persist-perm',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: {
            id: 'persist-card',
            name: 'Kitchen Finks',
            type_line: 'Creature - Ouphe',
            oracle_text: 'Persist',
          },
        } as any,
      ],
    });

    const abilities = findTriggeredAbilities(start);
    const undyingTrigger = abilities.find(ability => ability.sourceId === 'undying-perm');
    const persistTrigger = abilities.find(ability => ability.sourceId === 'persist-perm');

    expect(undyingTrigger?.event).toBe(TriggerEvent.DIES);
    expect(undyingTrigger?.interveningIfClause).toBe('it had no +1/+1 counters on it');
    expect(undyingTrigger?.effect).toBe(
      "Return this card to the battlefield under its owner's control with a +1/+1 counter on it."
    );
    expect(persistTrigger?.event).toBe(TriggerEvent.DIES);
    expect(persistTrigger?.interveningIfClause).toBe('it had no -1/-1 counters on it');
    expect(persistTrigger?.effect).toBe(
      "Return this card to the battlefield under its owner's control with a -1/-1 counter on it."
    );
  });

  it('finds Mobilize as a synthesized attacks trigger on the battlefield', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'mobilize-perm',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: {
            id: 'mobilize-card',
            name: 'Warhost Herald',
            type_line: 'Creature - Human Soldier',
            oracle_text: 'Mobilize 3',
          },
        } as any,
      ],
    });

    const abilities = findTriggeredAbilities(start);
    const mobilizeTrigger = abilities.find(ability => ability.sourceId === 'mobilize-perm');

    expect(mobilizeTrigger).toBeTruthy();
    expect(mobilizeTrigger?.event).toBe(TriggerEvent.ATTACKS);
    expect(mobilizeTrigger?.effect).toContain('Those tokens enter tapped and attacking');
  });

  it('finds Melee as a synthesized attacks trigger on the battlefield', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'melee-perm',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: {
            id: 'melee-card',
            name: 'Bloodboil Marauder',
            type_line: 'Creature - Human Berserker',
            oracle_text: 'Melee',
          },
        } as any,
      ],
    });

    const abilities = findTriggeredAbilities(start);
    const meleeTrigger = abilities.find(ability => ability.sourceId === 'melee-perm');

    expect(meleeTrigger).toBeTruthy();
    expect(meleeTrigger?.event).toBe(TriggerEvent.ATTACKS);
    expect(meleeTrigger?.effect).toBe(
      'This creature gets +X/+X until end of turn where X is the number of players being attacked.'
    );
  });

  it('finds Dethrone as a synthesized attacks trigger on the battlefield', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'dethrone-perm',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: {
            id: 'dethrone-card',
            name: 'Marchesa Initiate',
            type_line: 'Creature - Human Wizard',
            oracle_text: 'Dethrone',
          },
        } as any,
      ],
    });

    const abilities = findTriggeredAbilities(start);
    const dethroneTrigger = abilities.find(ability => ability.sourceId === 'dethrone-perm');

    expect(dethroneTrigger).toBeTruthy();
    expect(dethroneTrigger?.event).toBe(TriggerEvent.ATTACKS);
    expect(dethroneTrigger?.interveningIfClause).toBe(
      'defending player has the most life or is tied for the most life'
    );
    expect(dethroneTrigger?.effect).toBe('Put a +1/+1 counter on this creature.');
  });

  it('finds Exalted as a synthesized attacks-alone trigger on the battlefield', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'exalted-perm',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: {
            id: 'exalted-card',
            name: 'Akrasan Squire',
            type_line: 'Creature - Human Soldier',
            oracle_text: 'Exalted',
          },
        } as any,
      ],
    });

    const abilities = findTriggeredAbilities(start);
    const exaltedTrigger = abilities.find(ability => ability.sourceId === 'exalted-perm');

    expect(exaltedTrigger).toBeTruthy();
    expect(exaltedTrigger?.event).toBe(TriggerEvent.ATTACKS_ALONE);
    expect(exaltedTrigger?.effect).toBe('That creature gets +1/+1 until end of turn.');
  });

  it('finds Prowess as a synthesized noncreature-spell trigger on the battlefield', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'prowess-perm',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: {
            id: 'prowess-card',
            name: 'Stormchaser Adept',
            type_line: 'Creature - Human Monk',
            oracle_text: 'Prowess',
          },
        } as any,
      ],
    });

    const abilities = findTriggeredAbilities(start);
    const prowessTrigger = abilities.find(ability => ability.sourceId === 'prowess-perm');

    expect(prowessTrigger).toBeTruthy();
    expect(prowessTrigger?.event).toBe(TriggerEvent.NONCREATURE_SPELL_CAST);
    expect(prowessTrigger?.effect).toBe('This creature gets +1/+1 until end of turn.');
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

  it('processTriggersAutoOracle executes Myriad against each other opponent but not the defending player', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'myriad-perm',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          summoningSickness: false,
          power: 4,
          toughness: 4,
          basePower: 4,
          baseToughness: 4,
          card: {
            id: 'myriad-card',
            name: 'Blade Envoy',
            type_line: 'Creature - Human Warrior',
            oracle_text: 'Myriad',
            power: '4',
            toughness: '4',
          },
        } as any,
      ],
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
        { id: 'p3', name: 'P3', seat: 2, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
        { id: 'p4', name: 'P4', seat: 3, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
      ],
    });

    const abilities = findTriggeredAbilities(start).filter(ability => ability.sourceId === 'myriad-perm');
    const result = processTriggersAutoOracle(start, TriggerEvent.ATTACKS, abilities, {
      sourceId: 'myriad-perm',
      sourceControllerId: 'p1',
      targetOpponentId: 'p2',
      affectedOpponentIds: ['p2'],
    });
    const tokens = (result.state.battlefield as any[]).filter((perm: any) => perm.isToken);

    expect(result.triggersAdded).toBe(1);
    expect((result.oracleStepsApplied || 0) > 0).toBe(true);
    expect(tokens).toHaveLength(2);
    expect(tokens.map((token: any) => token.defendingPlayerId).sort()).toEqual(['p3', 'p4']);
  });

  it('processTriggersAutoOracle executes Annihilator against the defending player', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'annihilator-perm',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: {
            id: 'annihilator-card',
            name: 'Void Colossus',
            type_line: 'Creature - Eldrazi',
            oracle_text: 'Annihilator 2',
          },
        },
        {
          id: 'p2creature',
          controller: 'p2',
          owner: 'p2',
          card: {
            id: 'p2creature-card',
            name: 'Hill Giant',
            type_line: 'Creature - Giant',
          },
        },
        {
          id: 'p2artifact',
          controller: 'p2',
          owner: 'p2',
          card: {
            id: 'p2artifact-card',
            name: 'Sol Ring',
            type_line: 'Artifact',
          },
        },
      ] as any,
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
      ],
    });

    const abilities = findTriggeredAbilities(start).filter(ability => ability.sourceId === 'annihilator-perm');
    const result = processTriggersAutoOracle(start, TriggerEvent.ATTACKS, abilities, {
      sourceId: 'annihilator-perm',
      sourceControllerId: 'p1',
      targetOpponentId: 'p2',
      affectedOpponentIds: ['p2'],
    });
    const p2 = result.state.players.find(player => player.id === 'p2') as any;

    expect(result.triggersAdded).toBe(1);
    expect((result.oracleStepsApplied || 0) > 0).toBe(true);
    expect(result.state.battlefield).toHaveLength(1);
    expect((p2.graveyard || []).map((card: any) => card.id).sort()).toEqual(['p2artifact-card', 'p2creature-card']);
  });

  it('processTriggersAutoOracle executes Mobilize against the defending player', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'mobilize-perm',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          card: {
            id: 'mobilize-card',
            name: 'Warhost Herald',
            type_line: 'Creature - Human Soldier',
            oracle_text: 'Mobilize 3',
          },
        },
      ] as any,
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
      ],
    });

    const abilities = findTriggeredAbilities(start).filter(ability => ability.sourceId === 'mobilize-perm');
    const result = processTriggersAutoOracle(start, TriggerEvent.ATTACKS, abilities, {
      sourceId: 'mobilize-perm',
      sourceControllerId: 'p1',
      targetOpponentId: 'p2',
      affectedOpponentIds: ['p2'],
    });
    const tokens = (result.state.battlefield as any[]).filter((perm: any) => perm.isToken);

    expect(result.triggersAdded).toBe(1);
    expect((result.oracleStepsApplied || 0) > 0).toBe(true);
    expect(tokens).toHaveLength(3);
    expect(tokens.every((token: any) => token.defendingPlayerId === 'p2')).toBe(true);
  });

  it('processTriggersAutoOracle executes Melee using the current set of players being attacked', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'melee-source',
          controller: 'p1',
          owner: 'p1',
          tapped: true,
          attacking: 'p2',
          attackingPlayerId: 'p1',
          defendingPlayerId: 'p2',
          summoningSickness: false,
          power: 3,
          toughness: 3,
          basePower: 3,
          baseToughness: 3,
          card: {
            id: 'melee-source-card',
            name: 'Bloodboil Marauder',
            type_line: 'Creature - Human Berserker',
            oracle_text: 'Melee',
            power: '3',
            toughness: '3',
          },
        } as any,
        {
          id: 'other-attacker',
          controller: 'p1',
          owner: 'p1',
          tapped: true,
          attacking: 'p3',
          attackingPlayerId: 'p1',
          defendingPlayerId: 'p3',
          summoningSickness: false,
          power: 2,
          toughness: 2,
          basePower: 2,
          baseToughness: 2,
          card: {
            id: 'other-attacker-card',
            name: 'Support Raider',
            type_line: 'Creature - Human Warrior',
            oracle_text: '',
            power: '2',
            toughness: '2',
          },
        } as any,
      ] as any,
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
        { id: 'p3', name: 'P3', seat: 2, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
      ],
    });

    const abilities = findTriggeredAbilities(start).filter(ability => ability.sourceId === 'melee-source');
    const result = processTriggersAutoOracle(start, TriggerEvent.ATTACKS, abilities, {
      sourceId: 'melee-source',
      sourceControllerId: 'p1',
      targetOpponentId: 'p2',
      affectedOpponentIds: ['p2', 'p3'],
    });
    const source = (result.state.battlefield as any[]).find((perm: any) => perm.id === 'melee-source');
    const ptMod = (Array.isArray(source?.modifiers) ? source.modifiers : []).find((m: any) => m?.type === 'powerToughness');

    expect(result.triggersAdded).toBe(1);
    expect((result.oracleStepsApplied || 0) > 0).toBe(true);
    expect(ptMod?.power).toBe(2);
    expect(ptMod?.toughness).toBe(2);
  });

  it('processTriggersAutoOracle executes Dethrone when the defending player has the highest life total', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'dethrone-source',
          controller: 'p1',
          owner: 'p1',
          tapped: true,
          attacking: 'p2',
          attackingPlayerId: 'p1',
          defendingPlayerId: 'p2',
          summoningSickness: false,
          counters: {},
          card: {
            id: 'dethrone-source-card',
            name: 'Marchesa Initiate',
            type_line: 'Creature - Human Wizard',
            oracle_text: 'Dethrone',
            power: '2',
            toughness: '2',
          },
        } as any,
      ] as any,
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 30, hand: [], graveyard: [], library: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
        { id: 'p3', name: 'P3', seat: 2, life: 35, hand: [], graveyard: [], library: [], exile: [] } as any,
      ],
    });

    const abilities = findTriggeredAbilities(start).filter(ability => ability.sourceId === 'dethrone-source');
    const result = processTriggersAutoOracle(start, TriggerEvent.ATTACKS, abilities, {
      sourceId: 'dethrone-source',
      sourceControllerId: 'p1',
      targetOpponentId: 'p2',
      affectedOpponentIds: ['p2'],
    });
    const source = (result.state.battlefield as any[]).find((perm: any) => perm.id === 'dethrone-source');

    expect(result.triggersAdded).toBe(1);
    expect((result.oracleStepsApplied || 0) > 0).toBe(true);
    expect((source?.counters || {})['+1/+1']).toBe(1);
  });

  it('processTriggersAutoOracle executes Exalted on the lone attacker from event context', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'exalted-source',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          summoningSickness: false,
          power: 1,
          toughness: 1,
          basePower: 1,
          baseToughness: 1,
          card: {
            id: 'exalted-source-card',
            name: 'Akrasan Squire',
            type_line: 'Creature - Human Soldier',
            oracle_text: 'Exalted',
            power: '1',
            toughness: '1',
          },
        } as any,
        {
          id: 'solo-attacker',
          controller: 'p1',
          owner: 'p1',
          tapped: true,
          attacking: 'p2',
          attackingPlayerId: 'p1',
          defendingPlayerId: 'p2',
          summoningSickness: false,
          power: 2,
          toughness: 2,
          basePower: 2,
          baseToughness: 2,
          card: {
            id: 'solo-attacker-card',
            name: 'Lone Attacker',
            type_line: 'Creature - Soldier',
            oracle_text: '',
            power: '2',
            toughness: '2',
          },
        } as any,
      ] as any,
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
      ],
    });

    const abilities = findTriggeredAbilities(start).filter(ability => ability.sourceId === 'exalted-source');
    const result = processTriggersAutoOracle(start, TriggerEvent.ATTACKS_ALONE, abilities, {
      sourceId: 'solo-attacker',
      sourceControllerId: 'p1',
      targetPermanentId: 'solo-attacker',
      targetId: 'solo-attacker',
    });
    const attacker = (result.state.battlefield as any[]).find((perm: any) => perm.id === 'solo-attacker');

    expect(result.triggersAdded).toBe(1);
    expect((result.oracleStepsApplied || 0) > 0).toBe(true);
    expect(attacker?.power).toBe(3);
    expect(attacker?.toughness).toBe(3);
  });

  it('processTriggersAutoOracle executes Prowess on its source after a noncreature spell cast', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'prowess-source',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          summoningSickness: false,
          power: 2,
          toughness: 3,
          basePower: 2,
          baseToughness: 3,
          card: {
            id: 'prowess-source-card',
            name: 'Stormchaser Adept',
            type_line: 'Creature - Human Monk',
            oracle_text: 'Prowess',
            power: '2',
            toughness: '3',
          },
        } as any,
      ] as any,
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
      ],
    });

    const abilities = findTriggeredAbilities(start).filter(ability => ability.sourceId === 'prowess-source');
    const result = processTriggersAutoOracle(start, TriggerEvent.NONCREATURE_SPELL_CAST, abilities, {
      sourceControllerId: 'p1',
      spellType: 'Instant',
    });
    const creature = (result.state.battlefield as any[]).find((perm: any) => perm.id === 'prowess-source');
    const prowessModifier = (creature?.modifiers || []).find(
      (modifier: any) =>
        modifier?.type === 'powerToughness' &&
        modifier?.power === 1 &&
        modifier?.toughness === 1 &&
        modifier?.duration === 'end_of_turn'
    );

    expect(result.triggersAdded).toBe(1);
    expect((result.oracleStepsApplied || 0) > 0).toBe(true);
    expect(prowessModifier).toBeTruthy();
  });

  it('finds Storm as a synthesized cast trigger on a spell on the stack', () => {
    const start = makeState({
      stack: [
        {
          id: 'empty-the-warrens-spell',
          type: 'spell',
          controller: 'p1',
          card: {
            id: 'empty-the-warrens-card',
            name: 'Empty the Warrens',
            type_line: 'Sorcery',
            oracle_text: 'Create two 1/1 red Goblin creature tokens.\nStorm',
          },
        } as any,
      ],
    });

    const abilities = findTriggeredAbilities(start);
    const stormTrigger = abilities.find(ability => ability.sourceId === 'empty-the-warrens-spell');

    expect(stormTrigger).toBeTruthy();
    expect(stormTrigger?.event).toBe(TriggerEvent.SPELL_CAST);
    expect(stormTrigger?.triggerFilter).toBe('you cast this spell');
    expect(stormTrigger?.effect).toBe('Copy this spell for each spell cast before it this turn. You may choose new targets for the copies.');
  });

  it('checkSpellCastTriggers executes Storm once per spell cast before it this turn', () => {
    const start = makeState({
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
      ],
      stack: [
        {
          id: 'empty-the-warrens-spell',
          type: 'spell',
          controller: 'p1',
          card: {
            id: 'empty-the-warrens-card',
            name: 'Empty the Warrens',
            type_line: 'Sorcery',
            oracle_text: 'Create two 1/1 red Goblin creature tokens.\nStorm',
          },
        } as any,
      ],
      spellsCastThisTurn: { p1: 3 },
    } as any);

    const result = checkSpellCastTriggers(start, 'p1');
    const goblinCount = (result.state.battlefield as any[]).filter((perm: any) => perm?.card?.name === 'Goblin').length;

    expect(result.triggersAdded).toBe(1);
    expect(result.oracleExecutions).toBe(1);
    expect((result.oracleStepsApplied || 0) > 0).toBe(true);
    expect(goblinCount).toBe(4);
  });

  it('finds Cascade as a synthesized cast trigger on a spell on the stack', () => {
    const start = makeState({
      stack: [
        {
          id: 'bloodbraid-elf-spell',
          type: 'spell',
          controller: 'p1',
          card: {
            id: 'bloodbraid-elf-card',
            name: 'Bloodbraid Elf',
            type_line: 'Creature - Elf Berserker',
            mana_value: 4,
            oracle_text: 'Haste\nCascade',
          },
        } as any,
      ],
    });

    const abilities = findTriggeredAbilities(start);
    const cascadeTrigger = abilities.find(ability => ability.sourceId === 'bloodbraid-elf-spell');

    expect(cascadeTrigger).toBeTruthy();
    expect(cascadeTrigger?.event).toBe(TriggerEvent.SPELL_CAST);
    expect(cascadeTrigger?.triggerFilter).toBe('you cast this spell');
    expect(cascadeTrigger?.effect).toBe(
      "Exile cards from the top of your library until you exile a nonland card whose mana value is less than this spell's mana value. You may cast it without paying its mana cost. Put the exiled cards on the bottom of your library in a random order."
    );
  });

  it('checkSpellCastTriggers executes Cascade by revealing to a lower-mana nonland card and bottoming the revealed cards', () => {
    const start = makeState({
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          hand: [],
          graveyard: [],
          exile: [],
          library: [
            { id: 'land-hit', name: 'Forest', type_line: 'Basic Land - Forest' },
            { id: 'too-big', name: 'Colossal Dreadmaw', type_line: 'Creature - Dinosaur', mana_value: 6 },
            { id: 'cascade-hit', name: 'Lightning Bolt', type_line: 'Instant', mana_value: 1 },
            { id: 'after-hit', name: 'Island', type_line: 'Basic Land - Island' },
          ],
        } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
      ],
      stack: [
        {
          id: 'bloodbraid-elf-spell',
          type: 'spell',
          controller: 'p1',
          card: {
            id: 'bloodbraid-elf-card',
            name: 'Bloodbraid Elf',
            type_line: 'Creature - Elf Berserker',
            mana_value: 4,
            oracle_text: 'Haste\nCascade',
          },
        } as any,
      ],
    } as any);

    const result = checkSpellCastTriggers(start, 'p1');
    const p1 = result.state.players.find(p => p.id === 'p1') as any;

    expect(result.triggersAdded).toBe(1);
    expect(result.oracleExecutions).toBe(1);
    expect((result.oracleStepsApplied || 0) > 0).toBe(true);
    expect(p1.library.map((card: any) => card.id)).toEqual(['after-hit', 'land-hit', 'too-big', 'cascade-hit']);
    expect(p1.exile || []).toEqual([]);
  });

  it('processTriggersAutoOracle resolves Living weapon on self ETB by creating and attaching a Germ token', () => {
    const selfEtbState = makeState({
      battlefield: [
        {
          id: 'flayer-husk',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          summoningSick: false,
          counters: {},
          card: {
            id: 'flayer-husk-card',
            name: 'Flayer Husk',
            type_line: 'Artifact - Equipment',
            oracle_text: 'Living weapon',
          },
        } as any,
      ],
    });

    const livingWeaponAbilities = findTriggeredAbilities(selfEtbState).filter(ability => ability.sourceId === 'flayer-husk');
    const result = processTriggersAutoOracle(
      selfEtbState,
      TriggerEvent.ENTERS_BATTLEFIELD,
      livingWeaponAbilities,
      {
        sourceId: 'flayer-husk',
        sourceControllerId: 'p1',
        targetPermanentId: 'flayer-husk',
      }
    );

    const equipment = (result.state.battlefield as any[]).find((perm: any) => perm.id === 'flayer-husk');
    const germ = (result.state.battlefield as any[]).find((perm: any) => perm.id !== 'flayer-husk');

    expect(result.triggersAdded).toBe(1);
    expect(result.oracleExecutions).toBe(1);
    expect((result.oracleStepsApplied || 0) >= 2).toBe(true);
    expect(germ?.isToken).toBe(true);
    expect(germ?.basePower).toBe(0);
    expect(germ?.baseToughness).toBe(0);
    expect(germ?.card?.colors).toContain('B');
    expect(germ?.controller).toBe('p1');
    expect(equipment?.attachedTo).toBe(germ?.id);
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

  it('processTriggersAutoOracle resolves Afterlife by creating the Spirit tokens when the source dies', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'afterlife-perm',
          controller: 'p1',
          owner: 'p1',
          card: {
            id: 'afterlife-card',
            name: 'Imperious Oligarch',
            type_line: 'Creature - Human Cleric',
            oracle_text: 'Afterlife 2',
            power: '2',
            toughness: '1',
          },
        } as any,
      ],
    });

    const abilities = findTriggeredAbilities(start);
    const result = processTriggersAutoOracle(start, TriggerEvent.DIES, abilities, {
      sourceId: 'afterlife-perm',
      targetPermanentId: 'afterlife-perm',
      sourceControllerId: 'p1',
      sourceOwnerId: 'p1',
      permanentTypes: ['Creature'],
      creatureTypes: ['Human', 'Cleric'],
    });
    const tokens = (result.state.battlefield as any[]).filter((perm: any) => perm.isToken);

    expect(result.triggersAdded).toBe(1);
    expect((result.oracleStepsApplied || 0) > 0).toBe(true);
    expect(tokens).toHaveLength(2);
    expect(tokens.every((token: any) => (token.card?.colors || []).join(',') === 'W,B')).toBe(true);
    expect(tokens.every((token: any) => String(token.card?.oracle_text || '').includes('Flying'))).toBe(true);
  });

  it('checkBecomesBlockedTriggers resolves Afflict for the blocked attacker only', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'afflict-perm',
          controller: 'p1',
          owner: 'p1',
          tapped: true,
          card: {
            id: 'afflict-card',
            name: 'Storm Fleet Sprinter',
            type_line: 'Creature - Orc Pirate',
            oracle_text: 'Afflict 2',
            power: '3',
            toughness: '2',
          },
        } as any,
        {
          id: 'other-attacker',
          controller: 'p1',
          owner: 'p1',
          tapped: true,
          card: {
            id: 'other-attacker-card',
            name: 'Vanilla Attacker',
            type_line: 'Creature - Human Warrior',
            oracle_text: '',
            power: '2',
            toughness: '2',
          },
        } as any,
      ],
    });

    const result = checkBecomesBlockedTriggers(start, [
      { attackerId: 'afflict-perm', defendingPlayerId: 'p2' },
      { attackerId: 'other-attacker', defendingPlayerId: 'p3' },
    ]);
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.triggersAdded).toBe(1);
    expect((result.oracleStepsApplied || 0) > 0).toBe(true);
    expect(p2.life).toBe(38);
    expect(p3.life).toBe(40);
  });

  it('checkCombatDamageToPlayerTriggers resolves Renown once for the matching attacker and then stops', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'renown-perm',
          controller: 'p1',
          owner: 'p1',
          tapped: true,
          counters: {},
          power: 2,
          toughness: 2,
          basePower: 2,
          baseToughness: 2,
          card: {
            id: 'renown-card',
            name: 'Topan Freeblade',
            type_line: 'Creature - Human Soldier',
            oracle_text: 'Renown 1',
            power: '2',
            toughness: '2',
          },
        } as any,
      ],
    });

    const first = checkCombatDamageToPlayerTriggers(start, 'p1', [
      { attackerId: 'renown-perm', defendingPlayerId: 'p2', damage: 2 },
    ]);
    const firstSource = (first.state.battlefield as any[]).find((perm: any) => perm.id === 'renown-perm');

    expect(first.triggersAdded).toBe(1);
    expect((first.oracleStepsApplied || 0) > 0).toBe(true);
    expect((firstSource?.counters || {})['+1/+1']).toBe(1);
    expect(firstSource?.isRenowned).toBe(true);

    const second = checkCombatDamageToPlayerTriggers(first.state, 'p1', [
      { attackerId: 'renown-perm', defendingPlayerId: 'p2', damage: 2 },
    ]);
    const secondSource = (second.state.battlefield as any[]).find((perm: any) => perm.id === 'renown-perm');

    expect(second.triggersAdded).toBe(0);
    expect(second.oracleExecutions || 0).toBe(0);
    expect((secondSource?.counters || {})['+1/+1']).toBe(1);
    expect(secondSource?.isRenowned).toBe(true);
  });

  it('checkCombatDamageToPlayerTriggers resolves Ingest for the matching attacker only', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'ingest-perm',
          controller: 'p1',
          owner: 'p1',
          tapped: true,
          card: {
            id: 'ingest-card',
            name: 'Benthic Infiltrator',
            type_line: 'Creature - Eldrazi Drone',
            oracle_text: 'Ingest',
            power: '1',
            toughness: '4',
          },
        } as any,
        {
          id: 'other-attacker',
          controller: 'p1',
          owner: 'p1',
          tapped: true,
          card: {
            id: 'other-attacker-card',
            name: 'Other Creature',
            type_line: 'Creature - Eldrazi',
            oracle_text: '',
            power: '2',
            toughness: '2',
          },
        } as any,
      ],
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
          library: [{ id: 'p3c1' }],
          hand: [],
          graveyard: [],
          exile: [],
        } as any,
      ],
    });

    const result = checkCombatDamageToPlayerTriggers(start, 'p1', [
      { attackerId: 'ingest-perm', defendingPlayerId: 'p2', damage: 1 },
      { attackerId: 'other-attacker', defendingPlayerId: 'p3', damage: 2 },
    ]);
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.triggersAdded).toBe(1);
    expect((result.oracleStepsApplied || 0) > 0).toBe(true);
    expect((p2.library || []).map((card: any) => card.id)).toEqual(['p2c2']);
    expect((p2.exile || []).map((card: any) => card.id)).toEqual(['p2c1']);
    expect((p3.library || []).map((card: any) => card.id)).toEqual(['p3c1']);
  });

  it('checkCombatDamageToPlayerTriggers resolves Poisonous for the matching attacker only', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'poisonous-perm',
          controller: 'p1',
          owner: 'p1',
          tapped: true,
          card: {
            id: 'poisonous-card',
            name: 'Pit Scorpion',
            type_line: 'Creature - Scorpion',
            oracle_text: 'Poisonous 3',
            power: '1',
            toughness: '1',
          },
        } as any,
        {
          id: 'other-attacker',
          controller: 'p1',
          owner: 'p1',
          tapped: true,
          card: {
            id: 'other-attacker-card',
            name: 'Other Creature',
            type_line: 'Creature - Snake',
            oracle_text: '',
            power: '2',
            toughness: '2',
          },
        } as any,
      ],
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
          counters: {},
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
          counters: {},
        } as any,
        {
          id: 'p3',
          name: 'P3',
          seat: 2,
          life: 40,
          library: [{ id: 'p3c1' }],
          hand: [],
          graveyard: [],
          exile: [],
          counters: {},
        } as any,
      ],
    });

    const result = checkCombatDamageToPlayerTriggers(start, 'p1', [
      { attackerId: 'poisonous-perm', defendingPlayerId: 'p2', damage: 1 },
      { attackerId: 'other-attacker', defendingPlayerId: 'p3', damage: 2 },
    ]);
    const p2 = result.state.players.find(p => p.id === 'p2') as any;
    const p3 = result.state.players.find(p => p.id === 'p3') as any;

    expect(result.triggersAdded).toBe(1);
    expect((result.oracleStepsApplied || 0) > 0).toBe(true);
    expect(p2.poisonCounters).toBe(3);
    expect((p2.counters || {}).poison).toBe(3);
    expect(p3.poisonCounters || 0).toBe(0);
  });

  it('processTriggersAutoOracle executes Training only when a larger allied attacker is also attacking', () => {
    const withLargerAlly = makeState({
      battlefield: [
        {
          id: 'training-source',
          controller: 'p1',
          owner: 'p1',
          tapped: true,
          attacking: 'p2',
          attackingPlayerId: 'p1',
          defendingPlayerId: 'p2',
          summoningSickness: false,
          counters: {},
          power: 1,
          toughness: 1,
          basePower: 1,
          baseToughness: 1,
          card: {
            id: 'training-source-card',
            name: 'Hopeful Initiate',
            type_line: 'Creature - Human Warlock',
            oracle_text: 'Training',
            power: '1',
            toughness: '1',
          },
        } as any,
        {
          id: 'bigger-attacker',
          controller: 'p1',
          owner: 'p1',
          tapped: true,
          attacking: 'p3',
          attackingPlayerId: 'p1',
          defendingPlayerId: 'p3',
          summoningSickness: false,
          power: 3,
          toughness: 3,
          basePower: 3,
          baseToughness: 3,
          card: {
            id: 'bigger-attacker-card',
            name: 'Bigger Ally',
            type_line: 'Creature - Human Soldier',
            oracle_text: '',
            power: '3',
            toughness: '3',
          },
        } as any,
      ],
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
        { id: 'p3', name: 'P3', seat: 2, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
      ],
    });
    const withEqualAlly = makeState({
      ...withLargerAlly,
      battlefield: [
        withLargerAlly.battlefield?.[0] as any,
        {
          ...((withLargerAlly.battlefield?.[1] as any) || {}),
          id: 'equal-attacker',
          power: 1,
          toughness: 1,
          basePower: 1,
          baseToughness: 1,
          card: {
            ...((((withLargerAlly.battlefield?.[1] as any) || {}).card || {}) as any),
            id: 'equal-attacker-card',
            power: '1',
            toughness: '1',
          },
        } as any,
      ] as any,
    });

    const triggeringAbilities = findTriggeredAbilities(withLargerAlly).filter(ability => ability.sourceId === 'training-source');
    const success = processTriggersAutoOracle(
      withLargerAlly,
      TriggerEvent.ATTACKS,
      triggeringAbilities,
      buildResolutionEventDataFromGameState(withLargerAlly, 'p1', {
        sourceId: 'training-source',
        sourceControllerId: 'p1',
        targetOpponentId: 'p2',
        affectedOpponentIds: ['p2', 'p3'],
      })
    );
    const successSource = (success.state.battlefield as any[]).find((perm: any) => perm.id === 'training-source');

    expect(success.triggersAdded).toBe(1);
    expect((success.oracleStepsApplied || 0) > 0).toBe(true);
    expect((successSource?.counters || {})['+1/+1']).toBe(1);

    const blocked = processTriggersAutoOracle(
      withEqualAlly,
      TriggerEvent.ATTACKS,
      triggeringAbilities,
      buildResolutionEventDataFromGameState(withEqualAlly, 'p1', {
        sourceId: 'training-source',
        sourceControllerId: 'p1',
        targetOpponentId: 'p2',
        affectedOpponentIds: ['p2', 'p3'],
      })
    );
    const blockedSource = (blocked.state.battlefield as any[]).find((perm: any) => perm.id === 'training-source');

    expect(blocked.triggersAdded).toBe(0);
    expect(blocked.oracleExecutions || 0).toBe(0);
    expect((blockedSource?.counters || {})['+1/+1'] || 0).toBe(0);
  });

  it('processTriggersAutoOracle executes Mentor when exactly one smaller attacking creature is legal', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'mentor-source',
          controller: 'p1',
          owner: 'p1',
          tapped: true,
          attacking: 'p2',
          attackingPlayerId: 'p1',
          defendingPlayerId: 'p2',
          summoningSickness: false,
          counters: {},
          power: 3,
          toughness: 3,
          basePower: 3,
          baseToughness: 3,
          card: {
            id: 'mentor-source-card',
            name: 'Fresh-Faced Recruit',
            type_line: 'Creature - Human Soldier',
            oracle_text: 'Mentor',
            power: '3',
            toughness: '3',
          },
        } as any,
        {
          id: 'smaller-attacker',
          controller: 'p1',
          owner: 'p1',
          tapped: true,
          attacking: 'p2',
          attackingPlayerId: 'p1',
          defendingPlayerId: 'p2',
          summoningSickness: false,
          counters: {},
          power: 2,
          toughness: 2,
          basePower: 2,
          baseToughness: 2,
          card: {
            id: 'smaller-attacker-card',
            name: 'Smaller Ally',
            type_line: 'Creature - Human Soldier',
            oracle_text: '',
            power: '2',
            toughness: '2',
          },
        } as any,
      ],
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
      ],
    });

    const triggeringAbilities = findTriggeredAbilities(start).filter(ability => ability.sourceId === 'mentor-source');
    const result = processTriggersAutoOracle(
      start,
      TriggerEvent.ATTACKS,
      triggeringAbilities,
      buildResolutionEventDataFromGameState(start, 'p1', {
        sourceId: 'mentor-source',
        sourceControllerId: 'p1',
        targetOpponentId: 'p2',
        affectedOpponentIds: ['p2'],
      })
    );
    const smallerAttacker = (result.state.battlefield as any[]).find((perm: any) => perm.id === 'smaller-attacker');

    expect(result.triggersAdded).toBe(1);
    expect((result.oracleStepsApplied || 0) > 0).toBe(true);
    expect((smallerAttacker?.counters || {})['+1/+1']).toBe(1);
  });

  it('processTriggersAutoOracle executes Mentor for a chosen smaller attacker when multiple are legal', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'mentor-source',
          controller: 'p1',
          owner: 'p1',
          tapped: true,
          attacking: 'p2',
          attackingPlayerId: 'p1',
          defendingPlayerId: 'p2',
          summoningSickness: false,
          counters: {},
          power: 4,
          toughness: 4,
          basePower: 4,
          baseToughness: 4,
          card: {
            id: 'mentor-source-card',
            name: 'Fresh-Faced Recruit',
            type_line: 'Creature - Human Soldier',
            oracle_text: 'Mentor',
            power: '4',
            toughness: '4',
          },
        } as any,
        {
          id: 'first-smaller-attacker',
          controller: 'p1',
          owner: 'p1',
          tapped: true,
          attacking: 'p2',
          attackingPlayerId: 'p1',
          defendingPlayerId: 'p2',
          summoningSickness: false,
          counters: {},
          power: 2,
          toughness: 2,
          basePower: 2,
          baseToughness: 2,
          card: {
            id: 'first-smaller-attacker-card',
            name: 'First Smaller Ally',
            type_line: 'Creature - Human Soldier',
            oracle_text: '',
            power: '2',
            toughness: '2',
          },
        } as any,
        {
          id: 'second-smaller-attacker',
          controller: 'p1',
          owner: 'p1',
          tapped: true,
          attacking: 'p2',
          attackingPlayerId: 'p1',
          defendingPlayerId: 'p2',
          summoningSickness: false,
          counters: {},
          power: 1,
          toughness: 1,
          basePower: 1,
          baseToughness: 1,
          card: {
            id: 'second-smaller-attacker-card',
            name: 'Second Smaller Ally',
            type_line: 'Creature - Human Soldier',
            oracle_text: '',
            power: '1',
            toughness: '1',
          },
        } as any,
      ],
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
      ],
    });

    const triggeringAbilities = findTriggeredAbilities(start).filter(ability => ability.sourceId === 'mentor-source');
    const result = processTriggersAutoOracle(
      start,
      TriggerEvent.ATTACKS,
      triggeringAbilities,
      buildResolutionEventDataFromGameState(start, 'p1', {
        sourceId: 'mentor-source',
        sourceControllerId: 'p1',
        targetOpponentId: 'p2',
        targetCreatureId: 'second-smaller-attacker',
        chosenObjectIds: ['second-smaller-attacker'],
        affectedOpponentIds: ['p2'],
      })
    );
    const firstSmallerAttacker = (result.state.battlefield as any[]).find((perm: any) => perm.id === 'first-smaller-attacker');
    const secondSmallerAttacker = (result.state.battlefield as any[]).find((perm: any) => perm.id === 'second-smaller-attacker');

    expect(result.triggersAdded).toBe(1);
    expect((result.oracleStepsApplied || 0) > 0).toBe(true);
    expect((firstSmallerAttacker?.counters || {})['+1/+1'] || 0).toBe(0);
    expect((secondSmallerAttacker?.counters || {})['+1/+1']).toBe(1);
  });

  it('processTriggersAutoOracle executes Battle cry by buffing each other attacker', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'battle-cry-source',
          controller: 'p1',
          owner: 'p1',
          tapped: true,
          attacking: 'p2',
          attackingPlayerId: 'p1',
          defendingPlayerId: 'p2',
          summoningSickness: false,
          power: 1,
          toughness: 1,
          basePower: 1,
          baseToughness: 1,
          card: {
            id: 'battle-cry-source-card',
            name: 'Signal Pest',
            type_line: 'Artifact Creature - Pest',
            oracle_text: 'Battle cry',
            power: '1',
            toughness: '1',
          },
        } as any,
        {
          id: 'other-attacker',
          controller: 'p1',
          owner: 'p1',
          tapped: true,
          attacking: 'p2',
          attackingPlayerId: 'p1',
          defendingPlayerId: 'p2',
          summoningSickness: false,
          power: 2,
          toughness: 2,
          basePower: 2,
          baseToughness: 2,
          card: {
            id: 'other-attacker-card',
            name: 'Other Attacker',
            type_line: 'Creature - Human Soldier',
            oracle_text: '',
            power: '2',
            toughness: '2',
          },
        } as any,
        {
          id: 'non-attacker',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          summoningSickness: false,
          power: 2,
          toughness: 2,
          basePower: 2,
          baseToughness: 2,
          card: {
            id: 'non-attacker-card',
            name: 'Non Attacker',
            type_line: 'Creature - Human Soldier',
            oracle_text: '',
            power: '2',
            toughness: '2',
          },
        } as any,
      ],
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
      ],
    });

    const triggeringAbilities = findTriggeredAbilities(start).filter(ability => ability.sourceId === 'battle-cry-source');
    const result = processTriggersAutoOracle(
      start,
      TriggerEvent.ATTACKS,
      triggeringAbilities,
      buildResolutionEventDataFromGameState(start, 'p1', {
        sourceId: 'battle-cry-source',
        sourceControllerId: 'p1',
        targetOpponentId: 'p2',
        affectedOpponentIds: ['p2'],
      })
    );
    const otherAttacker = (result.state.battlefield as any[]).find((perm: any) => perm.id === 'other-attacker');
    const nonAttacker = (result.state.battlefield as any[]).find((perm: any) => perm.id === 'non-attacker');
    const otherAttackerModifier = (Array.isArray(otherAttacker?.modifiers) ? otherAttacker.modifiers : []).find(
      (modifier: any) => modifier?.type === 'powerToughness'
    );

    expect(result.triggersAdded).toBe(1);
    expect((result.oracleStepsApplied || 0) > 0).toBe(true);
    expect(otherAttackerModifier?.power).toBe(1);
    expect(otherAttackerModifier?.toughness).toBe(0);
    expect(Array.isArray(nonAttacker?.modifiers) ? nonAttacker.modifiers : []).toHaveLength(0);
  });

  it('processTriggersAutoOracle executes Battalion only when two other allied creatures are attacking', () => {
    const triggeringState = makeState({
      battlefield: [
        {
          id: 'battalion-source',
          controller: 'p1',
          owner: 'p1',
          tapped: true,
          attacking: 'p2',
          attackingPlayerId: 'p1',
          defendingPlayerId: 'p2',
          power: 2,
          toughness: 2,
          basePower: 2,
          baseToughness: 2,
          card: {
            id: 'battalion-source-card',
            name: 'Boros Elite',
            type_line: 'Creature - Human Soldier',
            oracle_text: 'Battalion — Whenever this and at least two other creatures attack, this creature gets +2/+2 until end of turn.',
            power: '2',
            toughness: '2',
          },
        } as any,
        {
          id: 'battalion-ally-1',
          controller: 'p1',
          owner: 'p1',
          tapped: true,
          attacking: 'p2',
          attackingPlayerId: 'p1',
          defendingPlayerId: 'p2',
          power: 2,
          toughness: 2,
          basePower: 2,
          baseToughness: 2,
          card: {
            id: 'battalion-ally-1-card',
            name: 'Ally One',
            type_line: 'Creature - Human Soldier',
            oracle_text: '',
            power: '2',
            toughness: '2',
          },
        } as any,
        {
          id: 'battalion-ally-2',
          controller: 'p1',
          owner: 'p1',
          tapped: true,
          attacking: 'p3',
          attackingPlayerId: 'p1',
          defendingPlayerId: 'p3',
          power: 1,
          toughness: 1,
          basePower: 1,
          baseToughness: 1,
          card: {
            id: 'battalion-ally-2-card',
            name: 'Ally Two',
            type_line: 'Creature - Human Soldier',
            oracle_text: '',
            power: '1',
            toughness: '1',
          },
        } as any,
      ],
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
        { id: 'p3', name: 'P3', seat: 2, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
      ],
    });
    const blockedState = makeState({
      ...triggeringState,
      battlefield: [
        triggeringState.battlefield?.[0] as any,
        triggeringState.battlefield?.[1] as any,
      ] as any,
    });

    const triggeringAbilities = findTriggeredAbilities(triggeringState).filter(ability => ability.sourceId === 'battalion-source');
    const triggered = processTriggersAutoOracle(
      triggeringState,
      TriggerEvent.ATTACKS,
      triggeringAbilities,
      buildResolutionEventDataFromGameState(triggeringState, 'p1', {
        sourceId: 'battalion-source',
        sourceControllerId: 'p1',
        affectedOpponentIds: ['p2', 'p3'],
      })
    );
    const triggeredSource = (triggered.state.battlefield as any[]).find((perm: any) => perm.id === 'battalion-source');
    const triggeredModifier = (Array.isArray(triggeredSource?.modifiers) ? triggeredSource.modifiers : []).find(
      (modifier: any) => modifier?.type === 'powerToughness'
    );

    expect(triggered.triggersAdded).toBe(1);
    expect((triggered.oracleStepsApplied || 0) > 0).toBe(true);
    expect(triggeredModifier?.power).toBe(2);
    expect(triggeredModifier?.toughness).toBe(2);

    const blocked = processTriggersAutoOracle(
      blockedState,
      TriggerEvent.ATTACKS,
      triggeringAbilities,
      buildResolutionEventDataFromGameState(blockedState, 'p1', {
        sourceId: 'battalion-source',
        sourceControllerId: 'p1',
        affectedOpponentIds: ['p2'],
      })
    );

    expect(blocked.triggersAdded).toBe(0);
    expect(blocked.oracleExecutions || 0).toBe(0);
  });

  it('processTriggersAutoOracle executes Heroic only when your spell targets the source creature', () => {
    const start = makeState({
      battlefield: [
        {
          id: 'heroic-source',
          controller: 'p1',
          owner: 'p1',
          counters: {},
          power: 1,
          toughness: 2,
          basePower: 1,
          baseToughness: 2,
          card: {
            id: 'heroic-source-card',
            name: 'Favored Hoplite',
            type_line: 'Creature - Human Soldier',
            oracle_text: 'Heroic — Whenever you cast a spell that targets this creature, put a +1/+1 counter on this creature.',
            power: '1',
            toughness: '2',
          },
        } as any,
        {
          id: 'other-creature',
          controller: 'p1',
          owner: 'p1',
          counters: {},
          power: 2,
          toughness: 2,
          basePower: 2,
          baseToughness: 2,
          card: {
            id: 'other-creature-card',
            name: 'Other Creature',
            type_line: 'Creature - Human Soldier',
            oracle_text: '',
            power: '2',
            toughness: '2',
          },
        } as any,
      ],
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
      ],
    });

    const triggeringAbilities = findTriggeredAbilities(start).filter(ability => ability.sourceId === 'heroic-source');
    const triggered = processTriggersAutoOracle(
      start,
      TriggerEvent.SPELL_CAST,
      triggeringAbilities,
      buildResolutionEventDataFromGameState(start, 'p1', {
        sourceId: 'guiding-spell',
        sourceControllerId: 'p1',
        targetPermanentId: 'heroic-source',
        chosenObjectIds: ['heroic-source'],
        spellType: 'instant',
      })
    );
    const heroicSource = (triggered.state.battlefield as any[]).find((perm: any) => perm.id === 'heroic-source');

    expect(triggered.triggersAdded).toBe(1);
    expect((triggered.oracleStepsApplied || 0) > 0).toBe(true);
    expect((heroicSource?.counters || {})['+1/+1']).toBe(1);

    const blocked = processTriggersAutoOracle(
      start,
      TriggerEvent.SPELL_CAST,
      triggeringAbilities,
      buildResolutionEventDataFromGameState(start, 'p1', {
        sourceId: 'guiding-spell',
        sourceControllerId: 'p1',
        targetPermanentId: 'other-creature',
        chosenObjectIds: ['other-creature'],
        spellType: 'instant',
      })
    );

    expect(blocked.triggersAdded).toBe(0);
    expect(blocked.oracleExecutions || 0).toBe(0);
  });

  it('processTriggersAutoOracle executes Constellation only when an enchantment enters under your control', () => {
    const triggeringState = makeState({
      battlefield: [
        {
          id: 'constellation-source',
          controller: 'p1',
          owner: 'p1',
          power: 2,
          toughness: 3,
          basePower: 2,
          baseToughness: 3,
          card: {
            id: 'constellation-source-card',
            name: 'Grim Guardian',
            type_line: 'Enchantment Creature - Zombie',
            oracle_text: 'Constellation — Whenever an enchantment enters the battlefield under your control, each opponent loses 1 life.',
            power: '2',
            toughness: '3',
          },
        } as any,
        {
          id: 'enchantment-entrant',
          controller: 'p1',
          owner: 'p1',
          card: {
            id: 'enchantment-entrant-card',
            name: 'Pacifism',
            type_line: 'Enchantment - Aura',
            oracle_text: '',
          },
        } as any,
      ],
      players: [
        { id: 'p1', name: 'P1', seat: 0, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
        { id: 'p2', name: 'P2', seat: 1, life: 40, hand: [], graveyard: [], library: [], exile: [] } as any,
      ],
    });
    const blockedState = makeState({
      ...triggeringState,
      battlefield: [
        triggeringState.battlefield?.[0] as any,
        {
          id: 'non-enchantment-entrant',
          controller: 'p1',
          owner: 'p1',
          card: {
            id: 'non-enchantment-entrant-card',
            name: 'Silvercoat Lion',
            type_line: 'Creature - Cat',
            oracle_text: '',
            power: '2',
            toughness: '2',
          },
        } as any,
      ] as any,
    });

    const triggeringAbilities = findTriggeredAbilities(triggeringState).filter(ability => ability.sourceId === 'constellation-source');
    const triggered = processTriggersAutoOracle(
      triggeringState,
      TriggerEvent.ENTERS_BATTLEFIELD,
      triggeringAbilities,
      buildResolutionEventDataFromGameState(triggeringState, 'p1', {
        sourceId: 'enchantment-entrant',
        targetPermanentId: 'enchantment-entrant',
        sourceControllerId: 'p1',
      })
    );
    const triggeredOpponent = triggered.state.players.find(player => player.id === 'p2') as any;

    expect(triggered.triggersAdded).toBe(1);
    expect((triggered.oracleStepsApplied || 0) > 0).toBe(true);
    expect(triggeredOpponent?.life).toBe(39);

    const blocked = processTriggersAutoOracle(
      blockedState,
      TriggerEvent.ENTERS_BATTLEFIELD,
      triggeringAbilities,
      buildResolutionEventDataFromGameState(blockedState, 'p1', {
        sourceId: 'non-enchantment-entrant',
        targetPermanentId: 'non-enchantment-entrant',
        sourceControllerId: 'p1',
      })
    );
    const blockedOpponent = blocked.state.players.find(player => player.id === 'p2') as any;

    expect(blocked.triggersAdded).toBe(0);
    expect(blocked.oracleExecutions || 0).toBe(0);
    expect(blockedOpponent?.life).toBe(40);
  });

  it('processTriggersAutoOracle resolves Evolve only for another creature with greater power or toughness', () => {
    const triggeringState = makeState({
      battlefield: [
        {
          id: 'evolve-source',
          controller: 'p1',
          owner: 'p1',
          counters: {},
          power: 1,
          toughness: 1,
          basePower: 1,
          baseToughness: 1,
          card: {
            id: 'evolve-source-card',
            name: 'Cloudfin Raptor',
            type_line: 'Creature - Bird Mutant',
            oracle_text: 'Flying\nEvolve',
            power: '1',
            toughness: '1',
          },
        } as any,
        {
          id: 'bigger-entrant',
          controller: 'p1',
          owner: 'p1',
          counters: {},
          power: 2,
          toughness: 1,
          basePower: 2,
          baseToughness: 1,
          card: {
            id: 'bigger-entrant-card',
            name: 'Crocanura',
            type_line: 'Creature - Crocodile Frog',
            oracle_text: '',
            power: '2',
            toughness: '1',
          },
        } as any,
      ],
    });
    const nonTriggeringState = makeState({
      battlefield: [
        triggeringState.battlefield?.[0] as any,
        {
          id: 'equal-entrant',
          controller: 'p1',
          owner: 'p1',
          counters: {},
          power: 1,
          toughness: 1,
          basePower: 1,
          baseToughness: 1,
          card: {
            id: 'equal-entrant-card',
            name: 'Adaptive Familiar',
            type_line: 'Creature - Beast',
            oracle_text: '',
            power: '1',
            toughness: '1',
          },
        } as any,
      ],
    });

    const triggeringAbilities = findTriggeredAbilities(triggeringState).filter(ability => ability.sourceId === 'evolve-source');
    const triggered = processTriggersAutoOracle(
      triggeringState,
      TriggerEvent.ENTERS_BATTLEFIELD,
      triggeringAbilities,
      buildResolutionEventDataFromGameState(triggeringState, 'p1', {
        sourceId: 'bigger-entrant',
        targetPermanentId: 'bigger-entrant',
        sourceControllerId: 'p1',
      })
    );
    const triggeredSource = (triggered.state.battlefield as any[]).find((perm: any) => perm.id === 'evolve-source');
    expect(triggered.triggersAdded).toBe(1);
    expect((triggered.oracleStepsApplied || 0) > 0).toBe(true);
    expect((triggeredSource?.counters || {})['+1/+1']).toBe(1);

    const blocked = processTriggersAutoOracle(
      nonTriggeringState,
      TriggerEvent.ENTERS_BATTLEFIELD,
      triggeringAbilities,
      buildResolutionEventDataFromGameState(nonTriggeringState, 'p1', {
        sourceId: 'equal-entrant',
        targetPermanentId: 'equal-entrant',
        sourceControllerId: 'p1',
      })
    );
    const blockedSource = (blocked.state.battlefield as any[]).find((perm: any) => perm.id === 'evolve-source');
    expect(blocked.triggersAdded).toBe(0);
    expect(blocked.oracleExecutions || 0).toBe(0);
    expect((blockedSource?.counters || {})['+1/+1'] || 0).toBe(0);

    const selfEnter = processTriggersAutoOracle(
      triggeringState,
      TriggerEvent.ENTERS_BATTLEFIELD,
      triggeringAbilities,
      buildResolutionEventDataFromGameState(triggeringState, 'p1', {
        sourceId: 'evolve-source',
        targetPermanentId: 'evolve-source',
        sourceControllerId: 'p1',
      })
    );
    expect(selfEnter.triggersAdded).toBe(0);
    expect(selfEnter.oracleExecutions || 0).toBe(0);
  });

  it('processTriggersAutoOracle resolves Exploit only when the source itself enters the battlefield', () => {
    const selfEtbState = makeState({
      battlefield: [
        {
          id: 'exploit-source',
          controller: 'p1',
          owner: 'p1',
          counters: {},
          power: 0,
          toughness: 4,
          basePower: 0,
          baseToughness: 4,
          card: {
            id: 'exploit-source-card',
            name: "Sidisi's Faithful",
            type_line: 'Creature - Naga Wizard',
            oracle_text: 'Exploit',
            power: '0',
            toughness: '4',
          },
        } as any,
      ],
    });
    const otherEtbState = makeState({
      battlefield: [
        selfEtbState.battlefield?.[0] as any,
        {
          id: 'other-entrant',
          controller: 'p1',
          owner: 'p1',
          counters: {},
          power: 2,
          toughness: 2,
          basePower: 2,
          baseToughness: 2,
          card: {
            id: 'other-entrant-card',
            name: 'Bear Cub',
            type_line: 'Creature - Bear',
            oracle_text: '',
            power: '2',
            toughness: '2',
          },
        } as any,
      ],
    });
    const exploitAbilities = findTriggeredAbilities(selfEtbState).filter(ability => ability.sourceId === 'exploit-source');

    const selfTriggered = processTriggersAutoOracle(
      selfEtbState,
      TriggerEvent.ENTERS_BATTLEFIELD,
      exploitAbilities,
      buildResolutionEventDataFromGameState(selfEtbState, 'p1', {
        sourceId: 'exploit-source',
        targetPermanentId: 'exploit-source',
        sourceControllerId: 'p1',
      }),
      { allowOptional: true }
    );
    const selfPlayer = selfTriggered.state.players.find((player: any) => player.id === 'p1') as any;
    expect(selfTriggered.triggersAdded).toBe(1);
    expect((selfTriggered.oracleStepsApplied || 0) > 0).toBe(true);
    expect((selfTriggered.state.battlefield as any[]).some((perm: any) => perm.id === 'exploit-source')).toBe(false);
    expect((selfPlayer.graveyard || []).some((card: any) => card.id === 'exploit-source-card' || card.id === 'exploit-source')).toBe(true);

    const otherTriggered = processTriggersAutoOracle(
      otherEtbState,
      TriggerEvent.ENTERS_BATTLEFIELD,
      exploitAbilities,
      buildResolutionEventDataFromGameState(otherEtbState, 'p1', {
        sourceId: 'other-entrant',
        targetPermanentId: 'other-entrant',
        sourceControllerId: 'p1',
      }),
      { allowOptional: true }
    );
    expect(otherTriggered.triggersAdded).toBe(0);
    expect(otherTriggered.oracleExecutions || 0).toBe(0);
  });

  it('processTriggersAutoOracle resolves Fabricate on self ETB and applies the counter branch when optional execution is enabled', () => {
    const selfEtbState = makeState({
      battlefield: [
        {
          id: 'fabricate-source',
          controller: 'p1',
          owner: 'p1',
          counters: {},
          power: 2,
          toughness: 3,
          basePower: 2,
          baseToughness: 3,
          card: {
            id: 'fabricate-source-card',
            name: 'Glint-Sleeve Artisan',
            type_line: 'Creature - Dwarf Artificer',
            oracle_text: 'Fabricate 2',
            power: '2',
            toughness: '3',
          },
        } as any,
      ],
    });
    const otherEtbState = makeState({
      battlefield: [
        selfEtbState.battlefield?.[0] as any,
        {
          id: 'other-entrant',
          controller: 'p1',
          owner: 'p1',
          counters: {},
          power: 2,
          toughness: 2,
          basePower: 2,
          baseToughness: 2,
          card: {
            id: 'other-entrant-card',
            name: 'Bear Cub',
            type_line: 'Creature - Bear',
            oracle_text: '',
            power: '2',
            toughness: '2',
          },
        } as any,
      ],
    });
    const fabricateAbilities = findTriggeredAbilities(selfEtbState).filter(ability => ability.sourceId === 'fabricate-source');

    const selfTriggered = processTriggersAutoOracle(
      selfEtbState,
      TriggerEvent.ENTERS_BATTLEFIELD,
      fabricateAbilities,
      buildResolutionEventDataFromGameState(selfEtbState, 'p1', {
        sourceId: 'fabricate-source',
        targetPermanentId: 'fabricate-source',
        sourceControllerId: 'p1',
      }),
      { allowOptional: true }
    );
    const fabricatedSource = (selfTriggered.state.battlefield as any[]).find((perm: any) => perm.id === 'fabricate-source');
    expect(selfTriggered.triggersAdded).toBe(1);
    expect((selfTriggered.oracleStepsApplied || 0) > 0).toBe(true);
    expect((fabricatedSource?.counters || {})['+1/+1'] || 0).toBe(2);
    expect((selfTriggered.state.battlefield as any[]).filter((perm: any) => perm?.card?.name === 'Servo').length).toBe(0);

    const otherTriggered = processTriggersAutoOracle(
      otherEtbState,
      TriggerEvent.ENTERS_BATTLEFIELD,
      fabricateAbilities,
      buildResolutionEventDataFromGameState(otherEtbState, 'p1', {
        sourceId: 'other-entrant',
        targetPermanentId: 'other-entrant',
        sourceControllerId: 'p1',
      }),
      { allowOptional: true }
    );
    expect(otherTriggered.triggersAdded).toBe(0);
    expect(otherTriggered.oracleExecutions || 0).toBe(0);
  });

  it('processTriggersAutoOracle resolves Undying only when the dying permanent had no +1/+1 counters', () => {
    const preDeath = makeState({
      battlefield: [
        {
          id: 'young-wolf',
          controller: 'p1',
          owner: 'p1',
          card: {
            id: 'young-wolf-card',
            name: 'Young Wolf',
            type_line: 'Creature - Wolf',
            oracle_text: 'Undying',
            power: '1',
            toughness: '1',
          },
        } as any,
      ],
    });
    const abilities = findTriggeredAbilities(preDeath).filter(ability => ability.sourceId === 'young-wolf');
    const postDeath = makeState({
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
              id: 'young-wolf',
              name: 'Young Wolf',
              type_line: 'Creature - Wolf',
              oracle_text: 'Undying',
              power: '1',
              toughness: '1',
              counters: {},
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
      battlefield: [],
    });

    const first = processTriggersAutoOracle(postDeath, TriggerEvent.DIES, abilities, {
      sourceId: 'young-wolf',
      sourceControllerId: 'p1',
      sourceOwnerId: 'p1',
      targetPermanentId: 'young-wolf',
      chosenObjectIds: ['young-wolf'],
      permanentTypes: ['Creature'],
      creatureTypes: ['Wolf'],
      counters: {},
    } as any);
    const returned = (first.state.battlefield || []).find(
      (perm: any) => String(perm?.card?.id || perm?.id || '') === 'young-wolf'
    ) as any;

    expect(first.triggersAdded).toBe(1);
    expect((first.oracleStepsApplied || 0) > 0).toBe(true);
    expect(returned?.controller).toBe('p1');
    expect(returned?.owner).toBe('p1');
    expect((returned?.counters || {})['+1/+1']).toBe(1);

    const blocked = processTriggersAutoOracle(postDeath, TriggerEvent.DIES, abilities, {
      sourceId: 'young-wolf',
      sourceControllerId: 'p1',
      sourceOwnerId: 'p1',
      targetPermanentId: 'young-wolf',
      chosenObjectIds: ['young-wolf'],
      permanentTypes: ['Creature'],
      creatureTypes: ['Wolf'],
      counters: { '+1/+1': 1 },
    } as any);

    expect(blocked.triggersAdded).toBe(0);
    expect(blocked.oracleExecutions || 0).toBe(0);
    expect(
      (blocked.state.battlefield || []).find(
        (perm: any) => String(perm?.card?.id || perm?.id || '') === 'young-wolf'
      )
    ).toBeUndefined();
  });

  it('processTriggersAutoOracle resolves Persist only when the dying permanent had no -1/-1 counters', () => {
    const preDeath = makeState({
      battlefield: [
        {
          id: 'kitchen-finks',
          controller: 'p1',
          owner: 'p1',
          card: {
            id: 'kitchen-finks-card',
            name: 'Kitchen Finks',
            type_line: 'Creature - Ouphe',
            oracle_text: 'Persist',
            power: '3',
            toughness: '2',
          },
        } as any,
      ],
    });
    const abilities = findTriggeredAbilities(preDeath).filter(ability => ability.sourceId === 'kitchen-finks');
    const postDeath = makeState({
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
              id: 'kitchen-finks',
              name: 'Kitchen Finks',
              type_line: 'Creature - Ouphe',
              oracle_text: 'Persist',
              power: '3',
              toughness: '2',
              counters: {},
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
      battlefield: [],
    });

    const first = processTriggersAutoOracle(postDeath, TriggerEvent.DIES, abilities, {
      sourceId: 'kitchen-finks',
      sourceControllerId: 'p1',
      sourceOwnerId: 'p1',
      targetPermanentId: 'kitchen-finks',
      chosenObjectIds: ['kitchen-finks'],
      permanentTypes: ['Creature'],
      creatureTypes: ['Ouphe'],
      counters: {},
    } as any);
    const returned = (first.state.battlefield || []).find(
      (perm: any) => String(perm?.card?.id || perm?.id || '') === 'kitchen-finks'
    ) as any;

    expect(first.triggersAdded).toBe(1);
    expect((first.oracleStepsApplied || 0) > 0).toBe(true);
    expect(returned?.controller).toBe('p1');
    expect(returned?.owner).toBe('p1');
    expect((returned?.counters || {})['-1/-1']).toBe(1);

    const blocked = processTriggersAutoOracle(postDeath, TriggerEvent.DIES, abilities, {
      sourceId: 'kitchen-finks',
      sourceControllerId: 'p1',
      sourceOwnerId: 'p1',
      targetPermanentId: 'kitchen-finks',
      chosenObjectIds: ['kitchen-finks'],
      permanentTypes: ['Creature'],
      creatureTypes: ['Ouphe'],
      counters: { '-1/-1': 1 },
    } as any);

    expect(blocked.triggersAdded).toBe(0);
    expect(blocked.oracleExecutions || 0).toBe(0);
    expect(
      (blocked.state.battlefield || []).find(
        (perm: any) => String(perm?.card?.id || perm?.id || '') === 'kitchen-finks'
      )
    ).toBeUndefined();
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
