import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb, truncateEventsForUndo } from '../src/db/index.js';
import '../src/state/modules/priority.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
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

describe('draw triggers (integration)', () => {
  const gameId = 'test_draw_trigger_psychosis';
  const smotheringTitheApnapGameId = 'test_draw_trigger_smothering_tithe_apnap';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
    await resetGame(smotheringTitheApnapGameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
    await resetGame(smotheringTitheApnapGameId);
  });

  it('pushes generic draw triggers from game.drawCards and resolves Psychosis Crawler life loss', () => {
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
      [p1]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        libraryCount: 2,
      },
      [p2]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        libraryCount: 0,
      },
    };
    game.libraries.set(p1 as any, [
      { id: 'draw_card_1', name: 'Opt', type_line: 'Instant', oracle_text: 'Scry 1. Draw a card.' },
      { id: 'draw_card_2', name: 'Ponder', type_line: 'Sorcery', oracle_text: 'Look at the top three cards of your library, then draw a card.' },
    ] as any);
    (game.state as any).battlefield = [
      {
        id: 'psychosis_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        summoningSickness: false,
        card: {
          id: 'psychosis_card',
          name: 'Psychosis Crawler',
          type_line: 'Artifact Creature - Horror',
          oracle_text: 'Whenever you draw a card, each opponent loses 1 life.',
          power: '0',
          toughness: '0',
          zone: 'battlefield',
        },
      },
    ];

    (game as any).drawCards(p1, 2);

    const p1Zones = (game.state as any).zones?.[p1];
    expect((p1Zones?.hand || []).map((card: any) => card.id)).toEqual(['draw_card_1', 'draw_card_2']);

    const stack = (((game.state as any).stack || []) as any[]).filter((item: any) => item?.source === 'psychosis_perm');
    expect(stack).toHaveLength(2);
    expect(stack[0]).toEqual(expect.objectContaining({
      effect: 'each opponent loses 1 life.',
      triggerType: 'you_draw',
      triggeringPlayer: p1,
    }));
    expect(stack[0]?.card?.name).toBe('Psychosis Crawler');
    expect(stack[0]?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'psychosis_perm',
      controller: p1,
      card: expect.objectContaining({ name: 'Psychosis Crawler' }),
    }));

    const triggerEvents = getEvents(gameId).filter((event: any) => event?.type === 'pushTriggeredAbility' && event?.payload?.sourceName === 'Psychosis Crawler');
    expect(triggerEvents).toHaveLength(2);
    expect(triggerEvents[0]?.payload?.card?.name).toBe('Psychosis Crawler');
    expect(triggerEvents[0]?.payload?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'psychosis_perm',
      controller: p1,
      card: expect.objectContaining({ name: 'Psychosis Crawler' }),
    }));
    expect(triggerEvents[0]?.payload).toMatchObject({
      sourceId: 'psychosis_perm',
      permanentId: 'psychosis_perm',
      targetPlayer: p1,
      triggeringPlayer: p1,
    });

    (game.state as any).stack = [];
    for (const triggerEvent of triggerEvents) {
      game.applyEvent({ type: 'pushTriggeredAbility', ...(triggerEvent?.payload || {}) } as any);
    }

    const replayedStack = (((game.state as any).stack || []) as any[]).filter((item: any) => item?.source === 'psychosis_perm');
    expect(replayedStack).toHaveLength(2);
    expect(replayedStack[0]).toEqual(expect.objectContaining({
      source: 'psychosis_perm',
      permanentId: 'psychosis_perm',
      targetPlayer: p1,
      triggeringPlayer: p1,
    }));

    game.resolveTopOfStack();
    game.resolveTopOfStack();

    expect((game.state as any).life?.[p2]).toBe(38);
    expect((game.state as any).life?.[p1]).toBe(40);
  });

  it('orders simultaneous Smothering Tithe triggers by APNAP before stack push', () => {
    const p1 = 'p1';
    const p2 = 'p2';
    const p3 = 'p3';

    createGameIfNotExists(smotheringTitheApnapGameId, 'commander', 40, undefined, p1);
    const game = ensureGame(smotheringTitheApnapGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'Drawer', spectator: false, life: 40 },
      { id: p2, name: 'Tithe P2', spectator: false, life: 40 },
      { id: p3, name: 'Tithe P3', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 40, [p2]: 40, [p3]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).activePlayer = p3;
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 1 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
      [p3]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'smothering_tithe_p2',
        controller: p2,
        owner: p2,
        tapped: false,
        card: {
          id: 'smothering_tithe_p2_card',
          name: 'Smothering Tithe',
          type_line: 'Enchantment',
          oracle_text: 'Whenever an opponent draws a card, that player may pay {2}. If the player doesn\'t, you create a Treasure token.',
        },
      },
      {
        id: 'smothering_tithe_p3',
        controller: p3,
        owner: p3,
        tapped: false,
        card: {
          id: 'smothering_tithe_p3_card',
          name: 'Smothering Tithe',
          type_line: 'Enchantment',
          oracle_text: 'Whenever an opponent draws a card, that player may pay {2}. If the player doesn\'t, you create a Treasure token.',
        },
      },
    ];
    game.libraries.set(p1 as any, [
      { id: 'draw_card_apnap_1', name: 'Plains', type_line: 'Basic Land — Plains', oracle_text: '' },
    ] as any);

    (game as any).drawCards(p1, 1);

    const titheStack = (((game.state as any).stack || []) as any[]).filter(
      (item: any) => item?.type === 'triggered_ability' && item?.sourceName === 'Smothering Tithe'
    );
    expect(titheStack.map((item: any) => item.controller)).toEqual([p3, p2]);

    const titheEvents = getEvents(smotheringTitheApnapGameId).filter(
      (event: any) => event?.type === 'pushTriggeredAbility' && event?.payload?.sourceName === 'Smothering Tithe'
    );
    expect(titheEvents.map((event: any) => event?.payload?.controllerId)).toEqual([p3, p2]);
    expect(titheEvents.map((event: any) => event?.payload?.permanentId)).toEqual(['smothering_tithe_p3', 'smothering_tithe_p2']);
    expect(titheEvents.map((event: any) => event?.payload?.targetPlayer)).toEqual([p1, p1]);

    (game.state as any).stack = [];
    for (const titheEvent of titheEvents) {
      game.applyEvent({ type: 'pushTriggeredAbility', ...(titheEvent?.payload || {}) } as any);
    }

    const replayedTitheStack = (((game.state as any).stack || []) as any[]).filter(
      (item: any) => item?.type === 'triggered_ability' && item?.sourceName === 'Smothering Tithe'
    );
    expect(replayedTitheStack.map((item: any) => item?.controller)).toEqual([p3, p2]);
    expect(replayedTitheStack.map((item: any) => item?.permanentId)).toEqual(['smothering_tithe_p3', 'smothering_tithe_p2']);
    expect(replayedTitheStack.map((item: any) => item?.targetPlayer)).toEqual([p1, p1]);
  });
});