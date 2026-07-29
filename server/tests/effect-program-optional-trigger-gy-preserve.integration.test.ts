import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => {},
    }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('effect program optional trigger graveyard preservation', () => {
  const gameId = 'test_effect_program_gy_preserve';
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

  it('does not wipe zones.graveyard when deferring an optional trigger with stale empty player.graveyard', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const summon = {
      id: 'summon_the_school_1',
      name: 'Summon the School',
      type_line: 'Kindred Sorcery — Merfolk',
      oracle_text: 'Create two 1/1 blue Merfolk Wizard creature tokens.',
      zone: 'graveyard',
    };
    const fierce = {
      id: 'fierce_1',
      name: 'Fierce Guardianship',
      type_line: 'Instant',
      oracle_text: 'Counter target noncreature spell.',
      zone: 'graveyard',
    };

    (game.state as any).players = [
      {
        id: playerId,
        name: 'P1',
        spectator: false,
        life: 40,
        // Stale dual representation that historically wiped zones on Effect Program sync.
        graveyard: [],
        hand: [],
        library: [],
        exile: [],
      },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        library: [],
        libraryCount: 0,
        graveyard: [fierce, summon],
        graveyardCount: 2,
        exile: [],
        exileCount: 0,
      },
    };
    (game as any).libraries = new Map([[playerId, []]]);
    (game.state as any).battlefield = [
      {
        id: 'aura_shards_1',
        controller: playerId,
        owner: playerId,
        card: {
          id: 'aura_shards_card',
          name: 'Aura Shards',
          type_line: 'Enchantment',
          oracle_text: 'Whenever a creature enters the battlefield under your control, you may destroy target artifact or enchantment.',
        },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'trigger_aura_shards_1',
        type: 'triggered_ability',
        controller: playerId,
        source: 'aura_shards_1',
        sourceName: 'Aura Shards',
        description: 'you may destroy target artifact or enchantment.',
        effect: 'you may destroy target artifact or enchantment.',
        triggerType: 'creature_etb',
        mandatory: false,
        card: {
          id: 'aura_shards_card',
          name: 'Aura Shards',
          type_line: 'Enchantment',
          oracle_text: 'Whenever a creature enters the battlefield under your control, you may destroy target artifact or enchantment.',
        },
      },
    ];

    game.resolveTopOfStack();

    const gy = (game.state as any).zones?.[playerId]?.graveyard || [];
    expect(gy.map((c: any) => c.name)).toEqual(
      expect.arrayContaining(['Summon the School', 'Fierce Guardianship']),
    );
    expect(gy.some((c: any) => c.id === 'summon_the_school_1')).toBe(true);
  });
});
