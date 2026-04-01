import { beforeEach, describe, expect, it } from 'vitest';

import { finalizePlayedLand } from '../src/socket/game-actions.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => {
        // no-op
      },
    }),
    emit: (_event: string, _payload: any) => {
      // no-op
    },
  } as any;
}

describe('Casal ETB library search', () => {
  const gameId = 'casal_etb_library_search';

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('builds the ETB search from the live library snapshot using Forest subtype filtering', () => {
    const playerId = 'p1';
    const casalCard = {
      id: 'casal_card',
      name: 'Casal, Lurkwood Pathfinder',
      type_line: 'Legendary Creature — Human Scout',
      oracle_text: 'When Casal enters, search your library for a Forest card, put it onto the battlefield tapped, then shuffle.',
    };

    const game: any = {
      state: {
        zones: {
          [playerId]: {
            hand: [],
            handCount: 0,
            graveyard: [],
            graveyardCount: 0,
            library: [],
            libraryCount: 0,
          },
        },
        battlefield: [
          {
            id: 'casal_perm',
            controller: playerId,
            owner: playerId,
            tapped: false,
            card: casalCard,
          },
        ],
      },
      libraries: new Map([
        [playerId, [
          {
            id: 'forest_dual',
            name: 'Temple Garden',
            type_line: 'Land — Forest Plains',
            oracle_text: '',
            image_uris: { normal: 'forest.png' },
          },
          {
            id: 'plains_only',
            name: 'Plains',
            type_line: 'Basic Land — Plains',
            oracle_text: '',
            image_uris: { normal: 'plains.png' },
          },
        ]],
      ]),
      seq: 0,
      bumpSeq: () => {
        game.seq += 1;
      },
    };

    finalizePlayedLand(createNoopIo(), game, gameId, playerId, 'casal_card', casalCard, 'hand');

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, playerId as any);
    const searchStep = steps.find((step: any) => step?.sourceName === 'Casal, Lurkwood Pathfinder') as any;

    expect(searchStep).toBeDefined();
    expect(searchStep.filter).toEqual({ subtypes: ['Forest'] });
    expect(Array.isArray(searchStep.availableCards)).toBe(true);
    expect(searchStep.availableCards).toHaveLength(1);
    expect(searchStep.availableCards[0]?.id).toBe('forest_dual');
  });
});