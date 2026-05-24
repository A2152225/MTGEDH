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

describe('mill triggers (integration)', () => {
  const gameId = 'test_mill_trigger_zellix';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('fires one-or-more typed mill triggers once per mill event', () => {
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
        libraryCount: 0,
      },
      [p2]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        libraryCount: 3,
      },
    };
    game.libraries.set(p2 as any, [
      { id: 'mill_creature_1', name: 'Merfolk Looter', type_line: 'Creature - Merfolk Rogue', oracle_text: '', zone: 'library' },
      { id: 'mill_spell_1', name: 'Ponder', type_line: 'Sorcery', oracle_text: '', zone: 'library' },
      { id: 'mill_creature_2', name: 'Sage Owl', type_line: 'Creature - Bird', oracle_text: '', zone: 'library' },
    ] as any);
    (game.state as any).battlefield = [
      {
        id: 'zellix_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        summoningSickness: false,
        card: {
          id: 'zellix_card',
          name: 'Zellix, Sanity Flayer',
          type_line: 'Legendary Creature - Horror',
          oracle_text: 'Hive Mind - Whenever a player mills one or more creature cards, you create a 1/1 black Horror creature token.\n{1}, {T}: Target player mills three cards.\nChoose a Background',
          power: '2',
          toughness: '3',
          zone: 'battlefield',
        },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'mill_spell_ability',
        type: 'ability',
        controller: p1,
        source: 'test_mill_source',
        sourceName: 'Mill Probe',
        description: 'Target player mills three cards.',
        targets: [p2],
      },
    ];

    game.resolveTopOfStack();

    const p2Zones = (game.state as any).zones?.[p2];
    expect((p2Zones?.graveyard || []).map((card: any) => card.id)).toEqual(['mill_creature_1', 'mill_spell_1', 'mill_creature_2']);
    expect(p2Zones?.libraryCount).toBe(0);

    const zellixTriggers = (((game.state as any).stack || []) as any[]).filter((item: any) => item?.source === 'zellix_perm');
    expect(zellixTriggers).toHaveLength(1);
    expect(zellixTriggers[0]).toEqual(expect.objectContaining({
      effect: 'you create a 1/1 black Horror creature token',
      triggerType: 'player_mills',
      triggeringPlayer: p2,
      targetPlayer: p2,
    }));
    expect(zellixTriggers[0]?.effectData?.milledCardsCount).toBe(2);

    const triggerEvents = getEvents(gameId).filter((event: any) =>
      event?.type === 'pushTriggeredAbility' && event?.payload?.sourceName === 'Zellix, Sanity Flayer'
    );
    expect(triggerEvents).toHaveLength(1);

    game.resolveTopOfStack();

    const horrors = (((game.state as any).battlefield || []) as any[]).filter((permanent: any) =>
      String(permanent?.controller || '') === p1
      && String(permanent?.card?.name || '').toLowerCase().includes('horror')
      && String(permanent?.card?.type_line || '').toLowerCase().includes('creature')
    );
    expect(horrors).toHaveLength(1);
  });
});