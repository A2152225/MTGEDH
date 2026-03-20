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
});