import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { queueLibrarySearchTriggers } from '../src/state/modules/triggers/search.js';
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

describe('library-search triggers (integration)', () => {
  const gameId = 'test_library_search_trigger_ob_nixilis';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('queues opponent library-search triggers with searching-player context', async () => {
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
        id: 'ob_perm',
        controller: p2,
        owner: p2,
        tapped: false,
        counters: {},
        card: {
          id: 'ob_card',
          name: 'Ob Nixilis, Unshackled',
          type_line: 'Legendary Creature - Demon',
          oracle_text: 'Flying, trample\nWhenever an opponent searches their library, that player sacrifices a creature of their choice and loses 10 life.\nWhenever another creature dies, put a +1/+1 counter on Ob Nixilis.',
          power: '4',
          toughness: '4',
          zone: 'battlefield',
        },
      },
    ];
    (game.state as any).stack = [];

    queueLibrarySearchTriggers(game as any, p1, { sourceName: 'Evolving Wilds', searchedLibraryOwnerId: p1 });

    const stackItems = ((game.state as any).stack || []) as any[];
    expect(stackItems).toHaveLength(1);
    expect(stackItems[0]).toEqual(expect.objectContaining({
      type: 'triggered_ability',
      triggerType: 'opponent_searches_library',
      sourceName: 'Ob Nixilis, Unshackled',
      triggeringPlayer: p1,
      targetPlayer: p1,
      effect: 'that player sacrifices a creature of their choice and loses 10 life',
    }));
    expect(stackItems[0]?.effectData).toEqual(expect.objectContaining({
      searchingPlayerId: p1,
      searchedLibraryOwnerId: p1,
      searchSourceName: 'Evolving Wilds',
    }));
    expect(stackItems[0]?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'ob_perm',
      controller: p2,
      owner: p2,
      card: expect.objectContaining({
        name: 'Ob Nixilis, Unshackled',
      }),
    }));

    const triggerEvents = getEvents(gameId).filter((event: any) =>
      event?.type === 'pushTriggeredAbility' && event?.payload?.sourceName === 'Ob Nixilis, Unshackled'
    );
    expect(triggerEvents).toHaveLength(1);
    expect(triggerEvents[0]?.payload?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'ob_perm',
      controller: p2,
      owner: p2,
    }));

    game.resolveTopOfStack();

    expect((game.state.life as any)[p1]).toBe(30);
    expect((game.state as any).lifeLostThisTurn?.[p1]).toBe(10);
  });

  it('replays library-search trigger source permanent snapshots', () => {
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).stack = [];

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'library_search_source_snapshot_replay_trigger',
      sourceId: 'ob_perm',
      sourceName: 'Ob Nixilis, Unshackled',
      controllerId: p2,
      description: 'that player sacrifices a creature of their choice and loses 10 life',
      triggerType: 'opponent_searches_library',
      effect: 'that player sacrifices a creature of their choice and loses 10 life',
      mandatory: true,
      targetPlayer: p1,
      triggeringPlayer: p1,
      effectData: {
        searchingPlayerId: p1,
        searchedLibraryOwnerId: p1,
        searchSourceName: 'Evolving Wilds',
      },
      sourcePermanentSnapshot: {
        id: 'ob_perm',
        controller: p2,
        owner: p2,
        card: {
          id: 'ob_card',
          name: 'Ob Nixilis, Unshackled',
          type_line: 'Legendary Creature - Demon',
        },
      },
    } as any);

    const replayed = ((game.state as any).stack || []).find((item: any) => item?.id === 'library_search_source_snapshot_replay_trigger');
    expect(replayed?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'ob_perm',
      controller: p2,
      owner: p2,
    }));
    expect(replayed?.effectData).toEqual(expect.objectContaining({
      searchingPlayerId: p1,
      searchedLibraryOwnerId: p1,
    }));
  });

  it('queues simultaneous library-search triggers in APNAP order', async () => {
    const p1 = 'p1';
    const p2 = 'p2';
    const p3 = 'p3';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
      { id: p3, name: 'P3', spectator: false, life: 40 },
    ];
    (game.state as any).activePlayer = p3;
    (game.state as any).turnPlayer = p3;
    (game.state as any).life = { [p1]: 40, [p2]: 40, [p3]: 40 };
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
      [p3]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'p1_search_trigger_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'p1_search_trigger_card',
          name: 'P1 Search Trigger',
          type_line: 'Enchantment',
          oracle_text: 'Whenever an opponent searches their library, that player loses 1 life.',
        },
      },
      {
        id: 'p3_search_trigger_perm',
        controller: p3,
        owner: p3,
        tapped: false,
        counters: {},
        card: {
          id: 'p3_search_trigger_card',
          name: 'P3 Search Trigger',
          type_line: 'Enchantment',
          oracle_text: 'Whenever an opponent searches their library, that player loses 1 life.',
        },
      },
    ];
    (game.state as any).stack = [];

    queueLibrarySearchTriggers(game as any, p2, { sourceName: 'Fabled Passage', searchedLibraryOwnerId: p2 });

    expect(((game.state as any).stack || []).map((item: any) => item.sourceName)).toEqual([
      'P3 Search Trigger',
      'P1 Search Trigger',
    ]);

    const triggerEvents = getEvents(gameId).filter((event: any) =>
      event?.type === 'pushTriggeredAbility' && (
        event?.payload?.sourceName === 'P1 Search Trigger' ||
        event?.payload?.sourceName === 'P3 Search Trigger'
      )
    );
    expect(triggerEvents.map((event: any) => event?.payload?.sourceName)).toEqual([
      'P3 Search Trigger',
      'P1 Search Trigger',
    ]);
  });
});