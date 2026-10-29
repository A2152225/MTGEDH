import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { chooseAITargetSelectionsForChoiceStep } from '../src/socket/ai.js';

function createPlayer(id: string, name: string, life = 40) {
  return { id, name, life } as any;
}

function createPermanent(id: string, controller: string, card: any) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    summoningSickness: false,
    counters: {},
    card,
  } as any;
}

describe('AI choice target selection', () => {
  it('selects independently from every required controller group', () => {
    const playerId = 'ai1' as PlayerID;
    const battlefield = [
      createPermanent('own_rock', playerId, { name: 'Mana Rock', type_line: 'Artifact' }),
      createPermanent('opp_small', 'opp1', { name: 'Small Bear', type_line: 'Creature', power: '2', toughness: '2' }),
      createPermanent('opp_large', 'opp1', { name: 'Large Threat', type_line: 'Creature', power: '8', toughness: '8' }),
    ];
    const game = {
      state: {
        players: [createPlayer(playerId, 'AI'), createPlayer('opp1', 'Opponent')],
        battlefield,
        zones: { [playerId]: { hand: [] } },
      },
    } as any;
    const groups = [
      {
        playerId,
        minTargets: 1,
        maxTargets: 1,
        targets: [{ id: 'own_rock', label: 'Mana Rock', type: 'permanent', controller: playerId }],
      },
      {
        playerId: 'opp1',
        minTargets: 1,
        maxTargets: 1,
        targets: [
          { id: 'opp_small', label: 'Small Bear', type: 'permanent', controller: 'opp1' },
          { id: 'opp_large', label: 'Large Threat', type: 'permanent', controller: 'opp1' },
        ],
      },
    ];
    const selections = chooseAITargetSelectionsForChoiceStep(game, playerId, {
      sourceName: 'Grouped Removal',
      description: 'Destroy each target permanent.',
      minTargets: 2,
      maxTargets: 2,
      validTargets: groups.flatMap((group) => group.targets),
      targetGrouping: {
        groupBy: 'controller',
        groupPlayers: 'each_player',
        minTargetsPerGroup: 1,
        maxTargetsPerGroup: 1,
        groups,
      },
    });

    expect(selections).toEqual(['own_rock', 'opp_large']);
  });

  it('prefers hostile combo-engine targets during target selection steps', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [
          createPlayer(playerId, 'AI'),
          createPlayer('opp1', 'Combo Opponent'),
          createPlayer('opp2', 'Big Creature Opponent'),
        ],
        battlefield: [
          createPermanent('scepter', 'opp1', {
            id: 'c1',
            name: 'Isochron Scepter',
            type_line: 'Artifact',
            oracle_text: 'Imprint — When Isochron Scepter enters the battlefield, you may exile an instant card with mana value 2 or less from your hand.',
          }),
          createPermanent('beater', 'opp2', {
            id: 'c2',
            name: 'Ancient Brontodon',
            type_line: 'Creature — Dinosaur',
            oracle_text: '',
            power: '9',
            toughness: '9',
          }),
        ],
        zones: {
          [playerId]: {
            hand: [],
          },
        },
      },
    } as any;

    const step = {
      id: 'target-step-1',
      type: 'target_selection',
      playerId,
      sourceName: 'Beast Within',
      description: 'Choose target permanent.',
      minTargets: 1,
      maxTargets: 1,
      validTargets: [
        { id: 'scepter', label: 'Isochron Scepter' },
        { id: 'beater', label: 'Ancient Brontodon' },
      ],
      spellCastContext: {
        cardId: 'spell1',
        cardName: 'Beast Within',
        manaCost: '{2}{G}',
        playerId,
        effectId: 'effect1',
        oracleText: 'Destroy target permanent. Its controller creates a 3/3 green Beast creature token.',
      },
    } as any;

    const selections = chooseAITargetSelectionsForChoiceStep(game, playerId, step);

    expect(selections).toEqual(['scepter']);
  });

  it('prefers own ETB value targets for beneficial target selection steps', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [
          createPlayer(playerId, 'AI'),
          createPlayer('opp1', 'Opponent'),
        ],
        battlefield: [
          createPermanent('solemn', playerId, {
            id: 'c3',
            name: 'Solemn Simulacrum',
            type_line: 'Artifact Creature — Golem',
            oracle_text: 'When Solemn Simulacrum enters the battlefield, you may search your library for a basic land card, put that card onto the battlefield tapped, then shuffle. When Solemn Simulacrum dies, you may draw a card.',
            power: '2',
            toughness: '2',
          }),
          createPermanent('bear', playerId, {
            id: 'c4',
            name: 'Grizzly Bears',
            type_line: 'Creature — Bear',
            oracle_text: '',
            power: '2',
            toughness: '2',
          }),
        ],
        zones: {
          [playerId]: {
            hand: [],
          },
        },
      },
    } as any;

    const step = {
      id: 'target-step-2',
      type: 'target_selection',
      playerId,
      sourceName: 'Cloudshift',
      description: 'Choose target creature you control.',
      minTargets: 1,
      maxTargets: 1,
      validTargets: [
        { id: 'solemn', label: 'Solemn Simulacrum' },
        { id: 'bear', label: 'Grizzly Bears' },
      ],
      spellCastContext: {
        cardId: 'spell2',
        cardName: 'Cloudshift',
        manaCost: '{W}',
        playerId,
        effectId: 'effect2',
        oracleText: 'Exile target creature you control, then return that card to the battlefield under your control.',
      },
    } as any;

    const selections = chooseAITargetSelectionsForChoiceStep(game, playerId, step);

    expect(selections).toEqual(['solemn']);
  });

  it('prefers higher-impact opposing spells on the stack during target selection steps', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [
          createPlayer(playerId, 'AI'),
          createPlayer('opp1', 'Opponent'),
        ],
        battlefield: [],
        stack: [
          {
            id: 'divination_stack',
            controller: 'opp1',
            type: 'spell',
            card: {
              id: 'divination_card',
              name: 'Divination',
              type_line: 'Sorcery',
              oracle_text: 'Draw two cards.',
              mana_cost: '{2}{U}',
            },
          },
          {
            id: 'tutor_stack',
            controller: 'opp1',
            type: 'spell',
            card: {
              id: 'tutor_card',
              name: 'Demonic Tutor',
              type_line: 'Sorcery',
              oracle_text: 'Search your library for a card, put that card into your hand, then shuffle.',
              mana_cost: '{1}{B}',
            },
          },
        ],
        zones: {
          [playerId]: {
            hand: [],
          },
        },
      },
    } as any;

    const step = {
      id: 'target-step-3',
      type: 'target_selection',
      playerId,
      sourceName: 'Counterspell',
      description: 'Choose target spell.',
      minTargets: 1,
      maxTargets: 1,
      validTargets: [
        { id: 'divination_stack', label: 'Divination', description: 'stack' },
        { id: 'tutor_stack', label: 'Demonic Tutor', description: 'stack' },
      ],
      spellCastContext: {
        cardId: 'counterspell_card',
        cardName: 'Counterspell',
        manaCost: '{U}{U}',
        playerId,
        effectId: 'effect3',
        oracleText: 'Counter target spell.',
      },
    } as any;

    const selections = chooseAITargetSelectionsForChoiceStep(game, playerId, step);

    expect(selections).toEqual(['tutor_stack']);
  });

  it('prefers stronger graveyard reanimation targets during target selection steps', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [
          createPlayer(playerId, 'AI'),
          createPlayer('opp1', 'Opponent'),
        ],
        battlefield: [],
        zones: {
          [playerId]: {
            hand: [],
            graveyard: [
              {
                id: 'solemn_gy',
                name: 'Solemn Simulacrum',
                type_line: 'Artifact Creature — Golem',
                oracle_text: 'When Solemn Simulacrum enters the battlefield, you may search your library for a basic land card, put that card onto the battlefield tapped, then shuffle. When Solemn Simulacrum dies, you may draw a card.',
                mana_cost: '{4}',
                cmc: 4,
              },
              {
                id: 'bear_gy',
                name: 'Grizzly Bears',
                type_line: 'Creature — Bear',
                oracle_text: '',
                mana_cost: '{1}{G}',
                cmc: 2,
              },
            ],
          },
        },
      },
    } as any;

    const step = {
      id: 'target-step-4',
      type: 'target_selection',
      playerId,
      sourceName: 'Reanimate Lesson',
      description: 'Choose target creature card in your graveyard.',
      minTargets: 1,
      maxTargets: 1,
      validTargets: [
        { id: 'bear_gy', label: 'Grizzly Bears', description: 'graveyard_card' },
        { id: 'solemn_gy', label: 'Solemn Simulacrum', description: 'graveyard_card' },
      ],
      spellCastContext: {
        cardId: 'reanimate_lesson_card',
        cardName: 'Reanimate Lesson',
        manaCost: '{3}{W}',
        playerId,
        effectId: 'effect4',
        oracleText: 'Return target creature card from your graveyard to the battlefield.',
      },
    } as any;

    const selections = chooseAITargetSelectionsForChoiceStep(game, playerId, step);

    expect(selections).toEqual(['solemn_gy']);
  });

  it('prefers exiling stronger opposing graveyard cards during target selection steps', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [
          createPlayer(playerId, 'AI'),
          createPlayer('opp1', 'Opponent'),
        ],
        battlefield: [],
        zones: {
          [playerId]: {
            hand: [],
            graveyard: [
              {
                id: 'small_self_gy',
                name: 'Minor Lesson',
                type_line: 'Sorcery',
                oracle_text: 'Draw a card.',
                mana_cost: '{U}',
                cmc: 1,
              },
            ],
          },
          opp1: {
            graveyard: [
              {
                id: 'tutor_gy',
                name: 'Demonic Tutor',
                type_line: 'Sorcery',
                oracle_text: 'Search your library for a card, put that card into your hand, then shuffle.',
                mana_cost: '{1}{B}',
                cmc: 2,
              },
              {
                id: 'bear_opp_gy',
                name: 'Grizzly Bears',
                type_line: 'Creature — Bear',
                oracle_text: '',
                mana_cost: '{1}{G}',
                cmc: 2,
              },
            ],
          },
        },
      },
    } as any;

    const step = {
      id: 'target-step-5',
      type: 'target_selection',
      playerId,
      sourceName: 'Soul Lantern',
      description: 'Choose target card in a graveyard.',
      minTargets: 1,
      maxTargets: 1,
      validTargets: [
        { id: 'small_self_gy', label: 'Minor Lesson', description: 'graveyard_card' },
        { id: 'bear_opp_gy', label: 'Grizzly Bears', description: 'graveyard_card' },
        { id: 'tutor_gy', label: 'Demonic Tutor', description: 'graveyard_card' },
      ],
      spellCastContext: {
        cardId: 'soul_lantern_card',
        cardName: 'Soul Lantern',
        manaCost: '{1}',
        playerId,
        effectId: 'effect5',
        oracleText: 'Exile target card from a graveyard.',
      },
    } as any;

    const selections = chooseAITargetSelectionsForChoiceStep(game, playerId, step);

    expect(selections).toEqual(['tutor_gy']);
  });

  it('does not damage its own player when the source also puts a counter', () => {
    const playerId = 'ai1' as PlayerID;
    const game = damageChoiceGame(playerId, [
      createPermanent('flaming', playerId, {
        name: 'Flaming Tyrannosaurus',
        type_line: 'Creature — Dinosaur',
        oracle_text: 'Menace\nParadox — Whenever you cast a spell from anywhere other than your hand, this creature deals 3 damage to any target. Then put a +1/+1 counter on this creature.\nWhen this creature dies, it deals damage equal to its power to each opponent.',
        power: '4',
        toughness: '4',
      }),
      createPermanent('opp_creature', 'opp1', {
        name: 'Hill Giant',
        type_line: 'Creature — Giant',
        oracle_text: '',
        power: '3',
        toughness: '3',
      }),
    ]);
    const selections = chooseAITargetSelectionsForChoiceStep(game, playerId, damageStep('flaming', 'Flaming Tyrannosaurus', [
      { id: playerId, label: 'AI' },
      { id: 'opp1', label: 'Opponent' },
      { id: 'opp_creature', label: 'Hill Giant' },
    ], {
      description: 'Whenever you cast a spell from anywhere other than your hand, this creature deals 3 damage to any target. Then put a +1/+1 counter on this creature.',
    }));
    expect(selections).toEqual(['opp_creature']);
  });

  it('does not aim damage-received triggers at its own player', () => {
    const playerId = 'ai1' as PlayerID;
    const game = damageChoiceGame(playerId, [
      createPermanent('pantlaza', playerId, {
        name: 'Pantlaza, Sun-Favored',
        type_line: 'Legendary Creature — Dinosaur',
        oracle_text: 'Whenever Pantlaza, Sun-Favored or another Dinosaur you control enters, you may discover X, where X is that creature\'s toughness. Do this only once each turn.',
        power: '4',
        toughness: '4',
      }),
      createPermanent('opp_creature', 'opp1', {
        name: 'Hill Giant',
        type_line: 'Creature — Giant',
        oracle_text: '',
        power: '3',
        toughness: '3',
      }),
    ]);
    const selections = chooseAITargetSelectionsForChoiceStep(game, playerId, damageStep('pantlaza', 'Pantlaza, Sun-Favored', [
      { id: playerId, label: 'AI' },
      { id: 'opp1', label: 'Opponent' },
      { id: 'opp_creature', label: 'Hill Giant' },
    ], {
      description: 'Pantlaza, Sun-Favored was dealt 5 damage. Choose a target to deal 5 damage to.',
      damageReceivedTrigger: true,
      damageTrigger: { damageAmount: 5 },
    }));
    expect(selections).toEqual(['opp_creature']);
  });

  it('deals non-lethal damage to its own creature when that damage triggers an ability', () => {
    const playerId = 'ai1' as PlayerID;
    const game = damageChoiceGame(playerId, [
      createPermanent('enrage', playerId, {
        name: 'Ripjaw Raptor',
        type_line: 'Creature — Dinosaur',
        oracle_text: 'Enrage — Whenever this creature is dealt damage, draw a card.',
        power: '4',
        toughness: '5',
      }),
      createPermanent('vanilla', playerId, {
        name: 'Grizzly Bears',
        type_line: 'Creature — Bear',
        oracle_text: '',
        power: '2',
        toughness: '2',
      }),
    ]);
    const selections = chooseAITargetSelectionsForChoiceStep(game, playerId, damageStep('ping', 'Ping', [
      { id: playerId, label: 'AI' },
      { id: 'opp1', label: 'Opponent' },
      { id: 'enrage', label: 'Ripjaw Raptor' },
      { id: 'vanilla', label: 'Grizzly Bears' },
    ], {
      description: 'Choose a target to deal 1 damage to.',
    }));
    expect(selections).toEqual(['enrage']);
  });

  it('does not kill its own dealt-damage creature when another target exists', () => {
    const playerId = 'ai1' as PlayerID;
    const game = damageChoiceGame(playerId, [
      createPermanent('enrage', playerId, {
        name: 'Ripjaw Raptor',
        type_line: 'Creature — Dinosaur',
        oracle_text: 'Enrage — Whenever this creature is dealt damage, draw a card.',
        power: '2',
        toughness: '2',
      }),
    ]);
    const selections = chooseAITargetSelectionsForChoiceStep(game, playerId, damageStep('blaze', 'Blaze', [
      { id: playerId, label: 'AI' },
      { id: 'opp1', label: 'Opponent' },
      { id: 'enrage', label: 'Ripjaw Raptor' },
    ], {
      description: 'Choose a target to deal 5 damage to.',
    }));
    expect(selections).toEqual(['opp1']);
  });

  it('trades a one-shot creature when the trigger kills a threat the ping cannot', () => {
    const playerId = 'ai1' as PlayerID;
    const game = damageChoiceGame(playerId, [
      createPermanent('enrage', playerId, {
        name: 'Glass Fighter',
        type_line: 'Creature — Dinosaur',
        oracle_text: 'Whenever this creature is dealt damage, it deals damage equal to its power to any target.',
        power: '6',
        toughness: '1',
      }),
      createPermanent('threat', 'opp1', {
        name: 'Hill Giant',
        type_line: 'Creature — Giant',
        oracle_text: '',
        power: '6',
        toughness: '6',
      }),
    ]);
    const selections = chooseAITargetSelectionsForChoiceStep(game, playerId, damageStep('ping', 'Ping', [
      { id: playerId, label: 'AI' },
      { id: 'opp1', label: 'Opponent' },
      { id: 'enrage', label: 'Glass Fighter' },
      { id: 'threat', label: 'Hill Giant' },
    ], {
      description: 'Choose a target to deal 1 damage to.',
    }));
    expect(selections).toEqual(['enrage']);
  });

  it('keeps a reusable creature when this damage already answers the threat', () => {
    const playerId = 'ai1' as PlayerID;
    const game = damageChoiceGame(playerId, [
      createPermanent('enrage', playerId, {
        name: 'Reusable Fighter',
        type_line: 'Creature — Dinosaur',
        oracle_text: 'Whenever this creature is dealt damage, it deals damage equal to its power to any target.',
        power: '5',
        toughness: '5',
      }),
      createPermanent('threat', 'opp1', {
        name: 'Hill Giant',
        type_line: 'Creature — Giant',
        oracle_text: '',
        power: '4',
        toughness: '4',
      }),
    ]);
    const selections = chooseAITargetSelectionsForChoiceStep(game, playerId, damageStep('blaze', 'Blaze', [
      { id: playerId, label: 'AI' },
      { id: 'opp1', label: 'Opponent' },
      { id: 'enrage', label: 'Reusable Fighter' },
      { id: 'threat', label: 'Hill Giant' },
    ], {
      description: 'Choose a target to deal 5 damage to.',
    }));
    expect(selections).toEqual(['threat']);
  });

  it('triggers a dealt-damage ability on another creature you control without killing the recipient', () => {
    const playerId = 'ai1' as PlayerID;
    const game = damageChoiceGame(playerId, [
      createPermanent('watcher', playerId, {
        name: 'Damage Watcher',
        type_line: 'Creature — Dinosaur',
        oracle_text: 'Whenever a Dinosaur you control is dealt damage, draw a card.',
        power: '3',
        toughness: '3',
      }),
      createPermanent('dino', playerId, {
        name: 'Young Dinosaur',
        type_line: 'Creature — Dinosaur',
        oracle_text: '',
        power: '4',
        toughness: '4',
      }),
    ]);
    const selections = chooseAITargetSelectionsForChoiceStep(game, playerId, damageStep('ping', 'Ping', [
      { id: 'opp1', label: 'Opponent' },
      { id: 'dino', label: 'Young Dinosaur' },
      { id: 'watcher', label: 'Damage Watcher' },
    ], {
      description: 'Choose a target to deal 1 damage to.',
    }));
    expect(selections).toEqual(['dino']);
  });

  it('damages itself when that damage creates tokens and another permanent gains life as creatures enter', () => {
    const playerId = 'ai1' as PlayerID;
    const game = damageChoiceGame(playerId, [
      createPermanent('darien', playerId, {
        name: 'Darien, King of Kjeldor',
        type_line: 'Legendary Creature — Human Soldier',
        oracle_text: "Whenever you're dealt damage, you may create that many 1/1 white Soldier creature tokens.",
        power: '3',
        toughness: '3',
      }),
      createPermanent('warden', playerId, {
        name: 'Soul Warden',
        type_line: 'Creature — Human Cleric',
        oracle_text: 'Whenever another creature enters, you gain 1 life.',
        power: '1',
        toughness: '1',
      }),
    ]);
    const selections = chooseAITargetSelectionsForChoiceStep(game, playerId, damageStep('ping', 'Ping', [
      { id: playerId, label: 'AI' },
      { id: 'opp1', label: 'Opponent' },
    ], {
      description: 'Choose a target to deal 3 damage to.',
    }));
    expect(selections).toEqual([playerId]);
  });
});

function damageChoiceGame(playerId: string, battlefield: any[]) {
  return {
    state: {
      players: [
        createPlayer(playerId, 'AI', 40),
        createPlayer('opp1', 'Opponent', 40),
      ],
      battlefield,
      zones: { [playerId]: { hand: [] } },
    },
  } as any;
}

function damageStep(sourceId: string, sourceName: string, validTargets: any[], extra: Record<string, unknown> = {}) {
  return {
    id: `damage-${sourceId}`,
    type: 'target_selection',
    playerId: 'ai1',
    sourceId,
    sourceName,
    minTargets: 1,
    maxTargets: 1,
    validTargets,
    ...extra,
  };
}