import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import { filterLibraryCardsForSearch } from '../src/socket/library-search.js';
import '../src/state/modules/priority.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

const growingRitesCard = {
  id: 'growing_rites_1',
  name: 'Growing Rites of Itlimoc // Itlimoc, Cradle of the Sun',
  type_line: 'Legendary Enchantment // Legendary Land',
  layout: 'transform',
  card_faces: [
    { name: 'Growing Rites of Itlimoc', type_line: 'Legendary Enchantment' },
    { name: 'Itlimoc, Cradle of the Sun', type_line: 'Legendary Land' },
  ],
  oracle_text: 'When Growing Rites of Itlimoc enters the battlefield, look at the top four cards of your library.',
  image_uris: { normal: 'growing-rites.png' },
};

describe('basic land library search filtering', () => {
  const gameId = 'test_basic_land_library_search';
  const playerId = 'p1';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('filterLibraryCardsForSearch excludes DFC enchantments and non-basic lands', () => {
    const library = [
      { id: 'forest_a', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '' },
      growingRitesCard,
      { id: 'breeding_pool', name: 'Breeding Pool', type_line: 'Land — Forest Island', oracle_text: '' },
      { id: 'pang_1', name: 'Panglacial Wurm', type_line: 'Creature — Wurm', oracle_text: "While you're searching your library, you may cast this card from your library.", image_uris: {} },
    ];
    const filter = { supertypes: ['basic'], types: ['land'] };

    expect(filterLibraryCardsForSearch(library, filter).map((card) => card.id)).toEqual(['forest_a']);
  });

  it("queues Kodama's Reach with only basic land cards available", async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = gameId;

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 4,
      },
    };
    (game as any).libraries = new Map([
      [playerId, [
        { id: 'forest_a', name: 'Forest', type_line: 'Basic Land — Forest', oracle_text: '', image_uris: { normal: 'forest.png' } },
        { id: 'plains_b', name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '', image_uris: { normal: 'plains.png' } },
        growingRitesCard,
        { id: 'pang_1', name: 'Panglacial Wurm', type_line: 'Creature — Wurm', oracle_text: "While you're searching your library, you may cast this card from your library.", image_uris: { normal: 'pang.png' } },
      ]],
    ]);
    (game.state as any).stack = [
      {
        id: 'kodamas_reach_stack_1',
        type: 'spell',
        controller: playerId,
        card: {
          id: 'kodamas_reach_1',
          name: "Kodama's Reach",
          type_line: 'Sorcery',
          oracle_text: "Search your library for up to two basic land cards, put one onto the battlefield tapped and the other into your hand, then shuffle.",
          mana_cost: '{2}{G}',
        },
        targets: [],
      },
    ];

    resolveTopOfStack(game as any);

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find((entry) => entry.type === ResolutionStepType.LIBRARY_SEARCH) as any;
    expect(step).toBeDefined();
    expect(step.filter).toEqual({ supertypes: ['basic'], types: ['land'] });
    expect(step.splitDestination).toBe(true);
    expect((step.availableCards || []).map((card: any) => card.id)).toEqual(['forest_a', 'plains_b']);
  });
});
