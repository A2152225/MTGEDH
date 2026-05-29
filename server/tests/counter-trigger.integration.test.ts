import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { updateCounters } from '../src/state/modules/counters_tokens.js';
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

describe('counter placed triggers (integration)', () => {
  const gameId = 'test_counter_trigger_simic_ascendancy';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('queues one-or-more +1/+1 counter triggers with that-many context', () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'simic_ascendancy_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'simic_ascendancy_card',
          name: 'Simic Ascendancy',
          type_line: 'Enchantment',
          oracle_text: '{1}{G}{U}: Put a +1/+1 counter on target creature you control.\nWhenever one or more +1/+1 counters are put on a creature you control, put that many growth counters on this enchantment.\nAt the beginning of your upkeep, if this enchantment has twenty or more growth counters on it, you win the game.',
          zone: 'battlefield',
        },
      },
      {
        id: 'bear_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'bear_card',
          name: 'Runeclaw Bear',
          type_line: 'Creature - Bear',
          oracle_text: '',
          power: '2',
          toughness: '2',
          zone: 'battlefield',
        },
      },
    ];
    (game.state as any).stack = [];

    updateCounters(game as any, 'bear_perm', { '+1/+1': 2 });

    const bear = (((game.state as any).battlefield || []) as any[]).find((perm: any) => perm?.id === 'bear_perm');
    expect(bear?.counters?.['+1/+1']).toBe(2);
    expect((game.state as any).plusOneCountersPutThisTurnByPermanentId?.bear_perm).toBe(1);

    const counterStackItems = (((game.state as any).stack || []) as any[]).filter((item: any) => item?.source === 'simic_ascendancy_perm');
    expect(counterStackItems).toHaveLength(1);
    expect(counterStackItems[0]).toEqual(expect.objectContaining({
      type: 'triggered_ability',
      triggerType: 'counters_put_on_creature_you_control',
      sourceName: 'Simic Ascendancy',
      triggeringPermanent: 'bear_perm',
      effect: 'put that many growth counters on this enchantment',
    }));
    expect(counterStackItems[0]?.effectData?.countersPlaced).toBe(2);
    expect(counterStackItems[0]?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'simic_ascendancy_perm',
      controller: p1,
      owner: p1,
      card: expect.objectContaining({
        name: 'Simic Ascendancy',
      }),
    }));

    const triggerEvents = getEvents(gameId).filter((event: any) =>
      event?.type === 'pushTriggeredAbility' && event?.payload?.sourceName === 'Simic Ascendancy'
    );
    expect(triggerEvents).toHaveLength(1);
    expect(triggerEvents[0]?.payload?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'simic_ascendancy_perm',
      controller: p1,
      owner: p1,
    }));

    game.resolveTopOfStack();

    const simic = (((game.state as any).battlefield || []) as any[]).find((perm: any) => perm?.id === 'simic_ascendancy_perm');
    expect(simic?.counters?.growth).toBe(2);
  });

  it('replays counter trigger source permanent snapshots', () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).stack = [];

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'counter_source_snapshot_replay_trigger',
      sourceId: 'simic_ascendancy_perm',
      sourceName: 'Simic Ascendancy',
      controllerId: p1,
      description: 'put that many growth counters on this enchantment',
      triggerType: 'counters_put_on_creature_you_control',
      effect: 'put that many growth counters on this enchantment',
      mandatory: true,
      triggeringPermanent: 'bear_perm',
      effectData: {
        targetPermanentId: 'bear_perm',
        targetPermanentName: 'Runeclaw Bear',
        countersPlaced: 2,
        counterType: '+1/+1',
      },
      sourcePermanentSnapshot: {
        id: 'simic_ascendancy_perm',
        controller: p1,
        owner: p1,
        card: {
          id: 'simic_ascendancy_card',
          name: 'Simic Ascendancy',
          type_line: 'Enchantment',
        },
      },
    } as any);

    const replayed = ((game.state as any).stack || []).find((item: any) => item?.id === 'counter_source_snapshot_replay_trigger');
    expect(replayed?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'simic_ascendancy_perm',
      controller: p1,
      owner: p1,
    }));
    expect(replayed?.effectData).toEqual(expect.objectContaining({
      targetPermanentId: 'bear_perm',
      countersPlaced: 2,
      counterType: '+1/+1',
    }));
  });
});