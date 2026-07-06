import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { movePermanentToGraveyard } from '../src/state/modules/counters_tokens.js';
import { getDeathTriggers } from '../src/state/modules/triggered-abilities.js';

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

describe('Zulaport Cutthroat death trigger', () => {
  const zulaportCard = {
    id: 'zulaport_card_1',
    name: 'Zulaport Cutthroat',
    type_line: 'Creature — Human Rogue Ally',
    oracle_text: 'Whenever Zulaport Cutthroat or another creature you control dies, each opponent loses 1 life and you gain 1 life.',
  };

  it('collects Zulaport trigger even when the dying creature is no longer on the battlefield', () => {
    const zulaport = {
      id: 'zulaport_perm_1',
      controller: 'p1',
      owner: 'p1',
      card: zulaportCard,
    };

    const ctx = {
      state: {
        battlefield: [],
        stack: [],
        players: [{ id: 'p1' }, { id: 'p2' }],
        zones: { p1: { hand: [], graveyard: [], handCount: 0, graveyardCount: 0 } },
      },
      bumpSeq: () => {},
    };

    const triggers = getDeathTriggers(ctx as any, zulaport, 'p1');
    expect(triggers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: expect.objectContaining({
          permanentId: 'zulaport_perm_1',
          cardName: 'Zulaport Cutthroat',
          controllerId: 'p1',
        }),
        effect: expect.stringMatching(/each opponent loses 1 life/i),
      }),
    ]));
  });

  it('pushes Zulaport onto the stack when it dies in combat cleanup', () => {
    const zulaport = {
      id: 'zulaport_perm_1',
      controller: 'p1',
      owner: 'p1',
      markedDamage: 3,
      card: zulaportCard,
    };

    const ctx = {
      gameId: 'zulaport_death_trigger_test',
      state: {
        battlefield: [zulaport],
        stack: [],
        players: [{ id: 'p1' }, { id: 'p2' }],
        zones: {
          p1: { hand: [], graveyard: [], handCount: 0, graveyardCount: 0 },
        },
      },
      bumpSeq: () => {},
    };

    const moved = movePermanentToGraveyard(ctx as any, 'zulaport_perm_1', true);
    expect(moved).toBe(true);
    expect((ctx.state as any).battlefield).toHaveLength(0);
    expect((ctx.state as any).stack?.some((item: any) =>
      String(item?.sourceName || '').includes('Zulaport Cutthroat')
    )).toBe(true);
  });
});

describe('Zulaport Cutthroat death trigger (integration)', () => {
  const gameId = 'test_zulaport_death_trigger_integration';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('resolves life loss and life gain when Zulaport dies', () => {
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
        id: 'zulaport_perm_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'zulaport_card_1',
          name: 'Zulaport Cutthroat',
          type_line: 'Creature — Human Rogue Ally',
          oracle_text: 'Whenever Zulaport Cutthroat or another creature you control dies, each opponent loses 1 life and you gain 1 life.',
          power: '1',
          toughness: '1',
          zone: 'battlefield',
        },
      },
    ];
    (game.state as any).stack = [];

    const moved = movePermanentToGraveyard(game as any, 'zulaport_perm_1', true);
    expect(moved).toBe(true);

    const stackItems = ((game.state as any).stack || []).filter((item: any) =>
      String(item?.sourceName || '').includes('Zulaport Cutthroat')
    );
    expect(stackItems).toHaveLength(1);

    game.resolveTopOfStack();

    expect((game.state.life as any)[p1]).toBe(41);
    expect((game.state.life as any)[p2]).toBe(39);
  });
});
