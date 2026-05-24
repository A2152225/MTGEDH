import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { createToken } from '../src/state/modules/counters_tokens.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try {
    truncateEventsForUndo(gameId, 0);
  } catch {
    // ignore
  }
  await deleteGame(gameId);
}

describe('token-created triggers (integration)', () => {
  const gameId = 'test_token_created_trigger';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('queues and persists Mirkwood Bats-style triggers when a token is created', () => {
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'mirkwood_bats_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'mirkwood_bats_card',
          name: 'Mirkwood Bats',
          type_line: 'Creature - Bat',
          oracle_text: 'Flying\nWhenever you create or sacrifice a token, each opponent loses 1 life.',
          power: '2',
          toughness: '3',
          zone: 'battlefield',
        },
      },
    ];

    const createdIds = createToken(game as any, p1 as any, 'Treasure', 1, undefined, undefined, {
      typeLine: 'Token Artifact - Treasure',
      abilities: ['{T}, Sacrifice this artifact: Add one mana of any color.'],
    });

    expect(createdIds).toHaveLength(1);
    expect((game.state as any).tokensCreatedThisTurn?.[p1]).toBe(1);

    const queued = ((game.state as any).stack || []).find((item: any) => item?.sourceName === 'Mirkwood Bats');
    expect(queued).toEqual(expect.objectContaining({
      type: 'triggered_ability',
      triggerType: 'token_created',
      source: 'mirkwood_bats_perm',
      triggeringPlayer: p1,
      effect: 'each opponent loses 1 life',
    }));
    expect(queued?.effectData).toEqual(expect.objectContaining({
      tokenControllerId: p1,
      createdTokenId: createdIds[0],
      tokensCreated: 1,
      tokenName: 'Treasure',
      tokenTypeLine: 'Token Artifact - Treasure',
    }));

    const triggerEvents = getEvents(gameId).filter((event: any) =>
      event?.type === 'pushTriggeredAbility' && event?.payload?.sourceName === 'Mirkwood Bats'
    );
    expect(triggerEvents).toHaveLength(1);
    expect(triggerEvents[0]?.payload?.effectData?.createdTokenIds).toEqual(createdIds);

    game.resolveTopOfStack();

    expect((game.state.life as any)[p2]).toBe(39);
    expect((game.state as any).lifeLostThisTurn?.[p2]).toBe(1);
  });
});