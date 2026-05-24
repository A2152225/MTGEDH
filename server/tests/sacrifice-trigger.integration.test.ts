import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { sacrificePermanent } from '../src/state/modules/upkeep-triggers.js';

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

describe('sacrifice triggers (integration)', () => {
  const gameId = 'test_sacrifice_trigger_mirkwood_bats';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('queues token sacrifice triggers with sacrificed permanent context', () => {
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
      {
        id: 'treasure_token_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        isToken: true,
        card: {
          id: 'treasure_card_1',
          name: 'Treasure',
          type_line: 'Token Artifact - Treasure',
          oracle_text: '{T}, Sacrifice this artifact: Add one mana of any color.',
          zone: 'battlefield',
        },
      },
    ];
    (game.state as any).stack = [];

    const sacrificedName = sacrificePermanent(game as any, 'treasure_token_1', p1);
    expect(sacrificedName).toBe('Treasure');

    expect((((game.state as any).battlefield || []) as any[]).some((perm: any) => perm?.id === 'treasure_token_1')).toBe(false);
    expect((game.state as any).permanentsSacrificedThisTurn?.[p1]).toBe(1);

    const sacrificeStackItems = (((game.state as any).stack || []) as any[]).filter((item: any) => item?.source === 'mirkwood_bats_perm');
    expect(sacrificeStackItems).toHaveLength(1);
    expect(sacrificeStackItems[0]).toEqual(expect.objectContaining({
      type: 'triggered_ability',
      triggerType: 'you_sacrifice',
      sourceName: 'Mirkwood Bats',
      triggeringPlayer: p1,
      effect: 'each opponent loses 1 life',
    }));
    expect(sacrificeStackItems[0]?.effectData?.sacrificedPermanentId).toBe('treasure_token_1');
    expect(sacrificeStackItems[0]?.effectData?.sacrificedPermanentWasToken).toBe(true);

    const triggerEvents = getEvents(gameId).filter((event: any) =>
      event?.type === 'pushTriggeredAbility' && event?.payload?.sourceName === 'Mirkwood Bats'
    );
    expect(triggerEvents).toHaveLength(1);

    game.resolveTopOfStack();

    expect((game.state.life as any)[p2]).toBe(39);
    expect((game.state as any).lifeLostThisTurn?.[p2]).toBe(1);
  });
});