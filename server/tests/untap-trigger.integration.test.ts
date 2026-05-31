import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { queueBecomesUntappedTriggers } from '../src/state/modules/triggers/tap-untap.js';

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

describe('becomes-untapped triggers (integration)', () => {
  const gameId = 'test_untap_trigger_mesmeric_orb';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it("queues Mesmeric Orb-style triggers with untapped permanent context", () => {
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
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 1 },
    };
    game.libraries.set(p2 as any, [
      { id: 'milled_card', name: 'Ponder', type_line: 'Sorcery', oracle_text: '', zone: 'library' },
    ] as any);

    const untappedPermanent = {
      id: 'elves_perm',
      controller: p2,
      owner: p2,
      tapped: false,
      counters: {},
      card: {
        id: 'elves_card',
        name: 'Llanowar Elves',
        type_line: 'Creature - Elf Druid',
        oracle_text: '{T}: Add {G}.',
        power: '1',
        toughness: '1',
        zone: 'battlefield',
      },
    };

    (game.state as any).battlefield = [
      {
        id: 'orb_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'orb_card',
          name: 'Mesmeric Orb',
          type_line: 'Artifact',
          oracle_text: "Whenever a permanent becomes untapped, that permanent's controller mills a card.",
          zone: 'battlefield',
        },
      },
      untappedPermanent,
    ];
    (game.state as any).stack = [];

    queueBecomesUntappedTriggers(game as any, untappedPermanent);

    const stackItems = ((game.state as any).stack || []) as any[];
    expect(stackItems).toHaveLength(1);
    expect(stackItems[0]).toEqual(expect.objectContaining({
      type: 'triggered_ability',
      triggerType: 'untap',
      sourceName: 'Mesmeric Orb',
      triggeringPermanentId: 'elves_perm',
      effect: "that permanent's controller mills a card",
    }));
    expect(stackItems[0]?.effectData).toEqual(expect.objectContaining({
      untappedPermanentId: 'elves_perm',
      untappedPermanentName: 'Llanowar Elves',
      untappedPermanentController: p2,
      untappedPermanentTypeLine: 'Creature - Elf Druid',
    }));
    expect(stackItems[0]?.card?.name).toBe('Mesmeric Orb');
    expect(stackItems[0]?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'orb_perm',
      controller: p1,
      card: expect.objectContaining({ name: 'Mesmeric Orb' }),
    }));

    const triggerEvents = getEvents(gameId).filter((event: any) =>
      event?.type === 'pushTriggeredAbility' && event?.payload?.sourceName === 'Mesmeric Orb'
    );
    expect(triggerEvents).toHaveLength(1);
    expect(triggerEvents[0]?.payload?.card?.name).toBe('Mesmeric Orb');
    expect(triggerEvents[0]?.payload?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'orb_perm',
      controller: p1,
      card: expect.objectContaining({ name: 'Mesmeric Orb' }),
    }));

    (game.state as any).stack = [];
    game.applyEvent({ type: 'pushTriggeredAbility', ...(triggerEvents[0]?.payload || {}) } as any);
    const replayedOrbTrigger = (((game.state as any).stack || []) as any[]).find((item: any) => item?.source === 'orb_perm');
    expect(replayedOrbTrigger?.sourcePermanentSnapshot?.card?.name).toBe('Mesmeric Orb');
    expect(replayedOrbTrigger?.effectData?.untappedPermanentId).toBe('elves_perm');

    game.resolveTopOfStack();

    const p2Zones = (game.state as any).zones?.[p2];
    expect((p2Zones?.graveyard || []).map((card: any) => card.id)).toEqual(['milled_card']);
    expect(p2Zones?.libraryCount).toBe(0);
  });
});