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
});