import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import '../src/state/modules/priority.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

async function resetGame(gameId: string) {
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('Kindred Discovery creature ETB', () => {
  const gameId = 'test_kindred_discovery_creature_etb';
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

  it('queues only one draw trigger when a matching creature enters', async () => {
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
        libraryCount: 20,
      },
    };
    (game.state as any).battlefield = [
      {
        id: 'kindred_perm',
        controller: playerId,
        owner: playerId,
        chosenCreatureType: 'Merfolk',
        card: {
          id: 'kindred_card',
          name: 'Kindred Discovery',
          type_line: 'Enchantment',
          oracle_text:
            'As this enchantment enters, choose a creature type.\nWhenever a creature you control of the chosen type enters or attacks, draw a card.',
        },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'merfolk_stack_1',
        type: 'spell',
        controller: playerId,
        card: {
          id: 'merfolk_card',
          name: 'Merfolk Looter',
          type_line: 'Creature — Merfolk',
          oracle_text: '{T}: Draw a card.',
          mana_cost: '{1}{U}',
        },
        targets: [],
      },
    ];

    resolveTopOfStack(game as any);

    const kindredTriggers = ((game.state as any).stack || []).filter(
      (item: any) => item?.type === 'triggered_ability' && item?.sourceName === 'Kindred Discovery',
    );

    expect(kindredTriggers).toHaveLength(1);
    expect(String(kindredTriggers[0]?.effect || '').replace(/\.$/, '')).toBe('draw a card');
    expect(kindredTriggers[0]?.triggerType).toBe('chosen_type_creature_etb_or_attack');
  });
});
