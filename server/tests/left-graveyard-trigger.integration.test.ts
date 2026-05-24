import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { recordCardLeftGraveyardThisTurn } from '../src/state/modules/turn-tracking.js';

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

describe('left-graveyard triggers (integration)', () => {
  const gameId = 'test_left_graveyard_trigger_syr_konrad';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('queues Syr Konrad-style triggers with left-graveyard card context', () => {
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
        id: 'syr_konrad_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'syr_konrad_card',
          name: 'Syr Konrad, the Grim',
          type_line: 'Legendary Creature - Human Knight',
          oracle_text:
            'Whenever another creature dies, or a creature card is put into a graveyard from anywhere other than the battlefield, or a creature card leaves your graveyard, Syr Konrad deals 1 damage to each opponent.\n{1}{B}: Each player mills a card.',
          power: '5',
          toughness: '4',
          zone: 'battlefield',
        },
      },
    ];
    (game.state as any).stack = [];

    const returningCreature = {
      id: 'returning_creature',
      name: 'Reassembling Skeleton',
      type_line: 'Creature - Skeleton Warrior',
      oracle_text: '',
      zone: 'battlefield',
    };

    recordCardLeftGraveyardThisTurn(game as any, p1, returningCreature);

    const stackItems = ((game.state as any).stack || []) as any[];
    expect(stackItems).toHaveLength(1);
    expect(stackItems[0]).toEqual(expect.objectContaining({
      type: 'triggered_ability',
      triggerType: 'card_left_graveyard',
      sourceName: 'Syr Konrad, the Grim',
      effect: 'Syr Konrad deals 1 damage to each opponent',
    }));
    expect(stackItems[0]?.effectData).toEqual(expect.objectContaining({
      leftGraveyardCardId: 'returning_creature',
      leftGraveyardCardName: 'Reassembling Skeleton',
      leftGraveyardOwner: p1,
      leftGraveyardCardTypeLine: 'Creature - Skeleton Warrior',
      fromZone: 'graveyard',
      toZone: 'unknown',
    }));

    const triggerEvents = getEvents(gameId).filter((event: any) =>
      event?.type === 'pushTriggeredAbility' && event?.payload?.sourceName === 'Syr Konrad, the Grim'
    );
    expect(triggerEvents).toHaveLength(1);

    game.resolveTopOfStack();

    expect((game.state as any).life[p1]).toBe(40);
    expect((game.state as any).life[p2]).toBe(39);
  });

  it('does not rediscover live left-graveyard triggers while replaying', () => {
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game as any).isReplaying = true;
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).battlefield = [
      {
        id: 'syr_konrad_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'syr_konrad_card',
          name: 'Syr Konrad, the Grim',
          type_line: 'Legendary Creature - Human Knight',
          oracle_text:
            'Whenever another creature dies, or a creature card is put into a graveyard from anywhere other than the battlefield, or a creature card leaves your graveyard, Syr Konrad deals 1 damage to each opponent.',
        },
      },
    ];
    (game.state as any).stack = [];

    recordCardLeftGraveyardThisTurn(game as any, p1, {
      id: 'replayed_returning_creature',
      name: 'Reassembling Skeleton',
      type_line: 'Creature - Skeleton Warrior',
      oracle_text: '',
      zone: 'battlefield',
    });

    expect((game.state as any).stack).toEqual([]);
    expect(getEvents(gameId).filter((event: any) => event?.type === 'pushTriggeredAbility')).toEqual([]);
  });
});