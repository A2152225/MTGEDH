import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { queueLifePaymentTriggers } from '../src/state/modules/triggers/pay-life.js';
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

describe('pay-life triggers (integration)', () => {
  const gameId = 'test_pay_life_trigger_font_of_agonies';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('queues pay-life triggers with payment amount context', async () => {
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 37 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 37, [p2]: 40 };
    (game.state as any).lifeLostThisTurn = { [p1]: 3 };
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'font_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'font_card',
          name: 'Font of Agonies',
          type_line: 'Enchantment',
          oracle_text: 'Whenever you pay life, put that many blood counters on this enchantment.\n{1}{B}, Remove four blood counters from this enchantment: Destroy target creature.',
          zone: 'battlefield',
        },
      },
      {
        id: 'exquisite_blood_perm',
        controller: p2,
        owner: p2,
        tapped: false,
        counters: {},
        card: {
          id: 'exquisite_blood_card',
          name: 'Exquisite Blood',
          type_line: 'Enchantment',
          oracle_text: 'Whenever an opponent loses life, you gain that much life.',
          zone: 'battlefield',
        },
      },
    ];
    (game.state as any).stack = [];

    queueLifePaymentTriggers(game as any, p1, 3, { sourceName: 'Force of Will' });

    expect((game.state as any).lifeLostThisTurn?.[p1]).toBe(3);

    const stackItems = ((game.state as any).stack || []) as any[];
    const fontTrigger = stackItems.find((item: any) => item?.source === 'font_perm');
    expect(fontTrigger).toEqual(expect.objectContaining({
      type: 'triggered_ability',
      triggerType: 'you_pay_life',
      sourceName: 'Font of Agonies',
      triggeringPlayer: p1,
      effect: 'put that many blood counters on this enchantment',
    }));
    expect(fontTrigger?.effectData).toEqual(expect.objectContaining({
      payingPlayerId: p1,
      lifePaid: 3,
      amount: 3,
      paymentSourceName: 'Force of Will',
    }));
    expect(fontTrigger?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'font_perm',
      controller: p1,
      owner: p1,
      card: expect.objectContaining({
        name: 'Font of Agonies',
      }),
    }));

    const lifeLossTrigger = stackItems.find((item: any) => item?.source === 'exquisite_blood_perm');
    expect(lifeLossTrigger?.effectData).toEqual(expect.objectContaining({
      losingPlayerId: p1,
      lifeLost: 3,
      wasLifePayment: true,
      paymentSourceName: 'Force of Will',
    }));
    expect(lifeLossTrigger?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'exquisite_blood_perm',
      controller: p2,
      owner: p2,
      card: expect.objectContaining({
        name: 'Exquisite Blood',
      }),
    }));

    const triggerEvents = getEvents(gameId).filter((event: any) => event?.type === 'pushTriggeredAbility');
    expect(triggerEvents.map((event: any) => event?.payload?.sourceName).sort()).toEqual(['Exquisite Blood', 'Font of Agonies']);
    const fontEvent = triggerEvents.find((event: any) => event?.payload?.sourceName === 'Font of Agonies');
    expect(fontEvent?.payload?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'font_perm',
      controller: p1,
      owner: p1,
    }));
    const exquisiteBloodEvent = triggerEvents.find((event: any) => event?.payload?.sourceName === 'Exquisite Blood');
    expect(exquisiteBloodEvent?.payload?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'exquisite_blood_perm',
      controller: p2,
      owner: p2,
    }));

    const fontStackIndex = ((game.state as any).stack || []).findIndex((item: any) => item?.source === 'font_perm');
    const [fontStackItem] = ((game.state as any).stack as any[]).splice(fontStackIndex, 1);
    (game.state as any).stack.push(fontStackItem);

    game.resolveTopOfStack();

    const font = (((game.state as any).battlefield || []) as any[]).find((permanent: any) => permanent?.id === 'font_perm');
    expect(font?.counters?.blood).toBe(3);
  });
});