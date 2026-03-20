import { describe, expect, it } from 'vitest';
import type { PlayerID } from '../../shared/src';
import { chooseAILibrarySearchCards, chooseAIGraveyardSelectionIds } from '../src/socket/ai.js';

function createPlayer(id: string, name: string, life = 40) {
  return { id, name, life } as any;
}

describe('AI card pool selection', () => {
  it('prefers combo-aligned cards during library search', () => {
    const playerId = 'ai1' as PlayerID;
    const dramaticReversal = {
      id: 'dramatic',
      name: 'Dramatic Reversal',
      type_line: 'Instant',
      oracle_text: 'Untap all nonland permanents you control.',
      mana_cost: '{1}{U}',
      cmc: 2,
    };
    const isochronScepter = {
      id: 'scepter',
      name: 'Isochron Scepter',
      type_line: 'Artifact',
      oracle_text: 'Imprint — When Isochron Scepter enters the battlefield, you may exile an instant card with mana value 2 or less from your hand.',
      mana_cost: '{2}',
      cmc: 2,
    };
    const bears = {
      id: 'bears',
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      oracle_text: '',
      mana_cost: '{1}{G}',
      cmc: 2,
      power: '2',
      toughness: '2',
    };

    const game = {
      state: {
        players: [createPlayer(playerId, 'AI'), createPlayer('opp1', 'Opponent')],
        battlefield: [],
        zones: {
          [playerId]: {
            hand: [dramaticReversal],
            library: [isochronScepter, bears],
            graveyard: [],
            exile: [],
          },
        },
        commandZone: {
          [playerId]: [],
        },
      },
    } as any;

    const selected = chooseAILibrarySearchCards(game, playerId, [isochronScepter, bears], {
      minSelections: 1,
      maxSelections: 1,
      destination: 'hand',
    });

    expect(selected).toEqual(['scepter']);
  });

  it('prefers higher-value graveyard cards for reanimation-style selection', () => {
    const playerId = 'ai1' as PlayerID;
    const solemn = {
      id: 'solemn',
      name: 'Solemn Simulacrum',
      type_line: 'Artifact Creature — Golem',
      oracle_text: 'When Solemn Simulacrum enters the battlefield, you may search your library for a basic land card, put that card onto the battlefield tapped, then shuffle. When Solemn Simulacrum dies, you may draw a card.',
      mana_cost: '{4}',
      cmc: 4,
      power: '2',
      toughness: '2',
    };
    const bears = {
      id: 'bears',
      name: 'Grizzly Bears',
      type_line: 'Creature — Bear',
      oracle_text: '',
      mana_cost: '{1}{G}',
      cmc: 2,
      power: '2',
      toughness: '2',
    };

    const game = {
      state: {
        players: [createPlayer(playerId, 'AI'), createPlayer('opp1', 'Opponent')],
        battlefield: [],
        zones: {
          [playerId]: {
            hand: [],
            library: [],
            graveyard: [solemn, bears],
            exile: [],
          },
        },
        commandZone: {
          [playerId]: [],
        },
      },
    } as any;

    const step = {
      playerId,
      targetPlayerId: playerId,
      minTargets: 1,
      maxTargets: 1,
      destination: 'battlefield',
      validTargets: [
        { id: 'solemn', name: 'Solemn Simulacrum', typeLine: solemn.type_line },
        { id: 'bears', name: 'Grizzly Bears', typeLine: bears.type_line },
      ],
    };

    const selected = chooseAIGraveyardSelectionIds(game, playerId, step);

    expect(selected).toEqual(['solemn']);
  });

  it('prefers expendable graveyard cards for exile-style costs', () => {
    const playerId = 'ai1' as PlayerID;
    const comboPiece = {
      id: 'scepter',
      name: 'Isochron Scepter',
      type_line: 'Artifact',
      oracle_text: 'Imprint — When Isochron Scepter enters the battlefield, you may exile an instant card with mana value 2 or less from your hand.',
      mana_cost: '{2}',
      cmc: 2,
    };
    const filler = {
      id: 'filler',
      name: 'Runeclaw Bear',
      type_line: 'Creature — Bear',
      oracle_text: '',
      mana_cost: '{1}{G}',
      cmc: 2,
      power: '2',
      toughness: '2',
    };

    const game = {
      state: {
        players: [createPlayer(playerId, 'AI'), createPlayer('opp1', 'Opponent')],
        battlefield: [],
        zones: {
          [playerId]: {
            hand: [
              {
                id: 'dramatic',
                name: 'Dramatic Reversal',
                type_line: 'Instant',
                oracle_text: 'Untap all nonland permanents you control.',
                mana_cost: '{1}{U}',
                cmc: 2,
              },
            ],
            library: [],
            graveyard: [comboPiece, filler],
            exile: [],
          },
        },
        commandZone: {
          [playerId]: [],
        },
      },
    } as any;

    const step = {
      playerId,
      targetPlayerId: playerId,
      minTargets: 1,
      maxTargets: 1,
      destination: 'exile',
      validTargets: [
        { id: 'scepter', name: 'Isochron Scepter', typeLine: comboPiece.type_line },
        { id: 'filler', name: 'Runeclaw Bear', typeLine: filler.type_line },
      ],
    };

    const selected = chooseAIGraveyardSelectionIds(game, playerId, step);

    expect(selected).toEqual(['filler']);
  });
});