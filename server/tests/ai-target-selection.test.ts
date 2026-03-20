import { describe, expect, it } from 'vitest';
import type { PlayerID, TargetRef } from '../../shared/src';
import type { SpellSpec } from '../src/rules-engine/targeting.js';
import { chooseAITargetsForSpell } from '../src/socket/ai.js';

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

describe('AI target selection', () => {
  it('prioritizes combo-enabling opponent permanents over larger generic threats', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [
          createPlayer(playerId, 'AI'),
          createPlayer('opp1', 'Combo Opponent'),
          createPlayer('opp2', 'Big Creature Opponent'),
        ],
        zones: {
          [playerId]: {
            hand: [
              {
                id: 'spell1',
                name: 'Beast Within',
                type_line: 'Instant',
                oracle_text: 'Destroy target permanent. Its controller creates a 3/3 green Beast creature token.',
                mana_cost: '{2}{G}',
              },
            ],
          },
        },
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
      },
    } as any;

    const spellSpec: SpellSpec = {
      op: 'DESTROY_TARGET',
      filter: 'PERMANENT',
      minTargets: 1,
      maxTargets: 1,
    };

    const validTargets: TargetRef[] = [
      { kind: 'permanent', id: 'scepter' },
      { kind: 'permanent', id: 'beater' },
    ];

    const selected = chooseAITargetsForSpell(game, playerId, game.state.zones[playerId].hand[0], spellSpec, validTargets);

    expect(selected).toEqual([{ kind: 'permanent', id: 'scepter' }]);
  });

  it('prioritizes own ETB value permanents for flicker effects', () => {
    const playerId = 'ai1' as PlayerID;
    const game = {
      state: {
        players: [
          createPlayer(playerId, 'AI'),
          createPlayer('opp1', 'Opponent'),
        ],
        zones: {
          [playerId]: {
            hand: [
              {
                id: 'spell2',
                name: 'Cloudshift',
                type_line: 'Instant',
                oracle_text: 'Exile target creature you control, then return that card to the battlefield under your control.',
                mana_cost: '{W}',
              },
            ],
          },
        },
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
      },
    } as any;

    const spellSpec: SpellSpec = {
      op: 'FLICKER_TARGET',
      filter: 'CREATURE',
      minTargets: 1,
      maxTargets: 1,
      controllerOnly: true,
    };

    const validTargets: TargetRef[] = [
      { kind: 'permanent', id: 'solemn' },
      { kind: 'permanent', id: 'bear' },
    ];

    const selected = chooseAITargetsForSpell(game, playerId, game.state.zones[playerId].hand[0], spellSpec, validTargets);

    expect(selected).toEqual([{ kind: 'permanent', id: 'solemn' }]);
  });
});
