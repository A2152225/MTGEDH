import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb, truncateEventsForUndo } from '../src/db/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { updateCounters } from '../src/state/modules/counters_tokens.js';
import { removeFadeCounter, removeTimeCounter } from '../src/state/modules/upkeep-triggers.js';
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

describe('counter-removed triggers (integration)', () => {
  const gameId = 'test_counter_removed_trigger_regenerations_restored';
  const replayGameId = `${gameId}_replay`;

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
    await resetGame(replayGameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
    await resetGame(replayGameId);
  });

  it('queues self counter-removal triggers with removed-counter context', () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'regenerations_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: { time: 12 },
        card: {
          id: 'regenerations_card',
          name: 'Regenerations Restored',
          type_line: 'Enchantment',
          oracle_text: 'Vanishing 12 (This enchantment enters with twelve time counters on it. At the beginning of your upkeep, remove a time counter from it. When the last is removed, sacrifice it.)\nWhenever one or more time counters are removed from this enchantment, scry 1 and you gain 1 life. Then if this enchantment has no time counters on it, exile it. When you do, take an extra turn after this one.',
          zone: 'battlefield',
        },
      },
    ];
    (game.state as any).stack = [];

    updateCounters(game as any, 'regenerations_perm', { time: -1 });

    expect(((game.state as any).battlefield?.[0]?.counters || {}).time).toBe(11);

    const stackItems = ((game.state as any).stack || []) as any[];
    expect(stackItems).toHaveLength(1);
    expect(stackItems[0]).toEqual(expect.objectContaining({
      type: 'triggered_ability',
      triggerType: 'counters_removed_from_self',
      sourceName: 'Regenerations Restored',
      triggeringPermanent: 'regenerations_perm',
      effect: 'scry 1 and you gain 1 life. Then if this enchantment has no time counters on it, exile it. When you do, take an extra turn after this one.',
    }));
    expect(stackItems[0]?.effectData).toEqual(expect.objectContaining({
      targetPermanentId: 'regenerations_perm',
      targetPermanentName: 'Regenerations Restored',
      targetPermanentController: p1,
      targetPermanentTypeLine: 'Enchantment',
      countersRemoved: 1,
      counterType: 'time',
    }));
    expect(stackItems[0]?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'regenerations_perm',
      controller: p1,
      owner: p1,
      counters: expect.objectContaining({ time: 11 }),
      card: expect.objectContaining({
        name: 'Regenerations Restored',
      }),
    }));

    const triggerEvents = getEvents(gameId).filter((event: any) =>
      event?.type === 'pushTriggeredAbility' && event?.payload?.sourceName === 'Regenerations Restored'
    );
    expect(triggerEvents).toHaveLength(1);
    expect(triggerEvents[0]?.payload?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'regenerations_perm',
      controller: p1,
      owner: p1,
    }));

    game.resolveTopOfStack();

    expect((game.state.life as any)[p1]).toBe(41);
    expect(((game.state as any).battlefield || []).map((permanent: any) => permanent.id)).toEqual(['regenerations_perm']);
    expect(((game.state as any).stack || [])).toHaveLength(0);
  });

  it('exiles the source and pushes a replay-safe extra-turn follow-up when the last tracked counter is gone', () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'regenerations_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: { time: 1 },
        card: {
          id: 'regenerations_card',
          name: 'Regenerations Restored',
          type_line: 'Enchantment',
          oracle_text: 'Vanishing 12 (This enchantment enters with twelve time counters on it. At the beginning of your upkeep, remove a time counter from it. When the last is removed, sacrifice it.)\nWhenever one or more time counters are removed from this enchantment, scry 1 and you gain 1 life. Then if this enchantment has no time counters on it, exile it. When you do, take an extra turn after this one.',
          zone: 'battlefield',
        },
      },
    ];
    (game.state as any).stack = [];
    const eventStart = getEvents(gameId).length;

    updateCounters(game as any, 'regenerations_perm', { time: -1 });

    const initialTrigger = ((game.state as any).stack || [])[0] as any;
    expect(initialTrigger).toMatchObject({
      sourceName: 'Regenerations Restored',
      description: 'scry 1 and you gain 1 life. Then if this enchantment has no time counters on it, exile it. When you do, take an extra turn after this one.',
      effectData: {
        targetPermanentId: 'regenerations_perm',
        countersRemoved: 1,
        counterType: 'time',
      },
    });

    game.resolveTopOfStack();

    expect((game.state.life as any)[p1]).toBe(41);
    expect(((game.state as any).battlefield || [])).toHaveLength(0);
    expect(((game.state as any).zones.p1.exile || []).map((card: any) => card.id)).toEqual(['regenerations_card']);

    const followupTrigger = ((game.state as any).stack || [])[0] as any;
    expect(followupTrigger).toMatchObject({
      type: 'triggered_ability',
      triggerType: 'reflexive_battlefield_self_exile',
      source: 'regenerations_perm',
      permanentId: 'regenerations_perm',
      sourceName: 'Regenerations Restored',
      description: 'take an extra turn after this one.',
      effectData: {
        exiledPermanentId: 'regenerations_perm',
        exiledCardId: 'regenerations_card',
        exiledCardOwnerId: p1,
        conditionCounterType: 'time',
      },
    });

    const newEvents = getEvents(gameId).slice(eventStart);
    const exileEventIndex = newEvents.findIndex((event: any) => event.type === 'exilePermanent' && event.payload?.reason === 'reflexive_conditional_battlefield_self_exile');
    const followupPushEventIndex = newEvents.findIndex((event: any) => event.type === 'pushTriggeredAbility' && event.payload?.triggerType === 'reflexive_battlefield_self_exile');
    expect(exileEventIndex).toBeGreaterThanOrEqual(0);
    expect(followupPushEventIndex).toBeGreaterThan(exileEventIndex);

    const exileEvent = newEvents[exileEventIndex] as any;
    const pushEvent = newEvents[followupPushEventIndex] as any;
    expect(exileEvent.payload).toMatchObject({
      permanentId: 'regenerations_perm',
      sourcePermanentId: 'regenerations_perm',
      sourceName: 'Regenerations Restored',
    });
    expect(pushEvent.payload).toMatchObject({
      triggerId: followupTrigger.id,
      sourceId: 'regenerations_perm',
      permanentId: 'regenerations_perm',
      sourceName: 'Regenerations Restored',
      description: 'take an extra turn after this one.',
      triggerType: 'reflexive_battlefield_self_exile',
    });

    game.resolveTopOfStack();
    expect(((game.state as any).extraTurns || [])).toEqual([
      expect.objectContaining({ playerId: p1, source: 'Regenerations Restored' }),
    ]);

    createGameIfNotExists(replayGameId, 'commander', 40, undefined, p1);
    const replayGame = ensureGame(replayGameId);
    if (!replayGame) throw new Error('ensureGame returned undefined');
    (replayGame.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
    ];
    (replayGame.state as any).life = { [p1]: 40 };
    (replayGame.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
    };
    (replayGame.state as any).battlefield = [
      {
        id: 'regenerations_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'regenerations_card',
          name: 'Regenerations Restored',
          type_line: 'Enchantment',
          oracle_text: 'Whenever one or more time counters are removed from this enchantment, scry 1 and you gain 1 life. Then if this enchantment has no time counters on it, exile it. When you do, take an extra turn after this one.',
          zone: 'battlefield',
        },
      },
    ];
    (replayGame.state as any).stack = [];

    replayGame.applyEvent({ type: 'exilePermanent', ...(exileEvent.payload || {}) } as any);
    replayGame.applyEvent({ type: 'pushTriggeredAbility', ...(pushEvent.payload || {}) } as any);

    expect(((replayGame.state as any).battlefield || [])).toHaveLength(0);
    expect(((replayGame.state as any).zones.p1.exile || []).map((card: any) => card.id)).toEqual(['regenerations_card']);
    expect(((replayGame.state as any).stack || [])[0]).toMatchObject({
      id: followupTrigger.id,
      sourceName: 'Regenerations Restored',
      triggerType: 'reflexive_battlefield_self_exile',
      description: 'take an extra turn after this one.',
    });

    replayGame.resolveTopOfStack();
    expect(((replayGame.state as any).extraTurns || [])).toEqual([
      expect.objectContaining({ playerId: p1, source: 'Regenerations Restored' }),
    ]);
  });

  it('queues self counter-removal triggers from removeTimeCounter', () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).battlefield = [
      {
        id: 'vanishing_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: { time: 2 },
        card: {
          id: 'vanishing_card',
          name: 'Vanishing Test',
          type_line: 'Enchantment',
          oracle_text: 'Whenever one or more time counters are removed from this enchantment, you gain 1 life.',
        },
      },
    ];
    (game.state as any).stack = [];

    const hasCountersRemaining = removeTimeCounter(game as any, 'vanishing_perm');

    expect(hasCountersRemaining).toBe(true);
    expect(((game.state as any).battlefield?.[0]?.counters || {}).time).toBe(1);

    const stackItems = ((game.state as any).stack || []) as any[];
    expect(stackItems).toHaveLength(1);
    expect(stackItems[0]).toEqual(expect.objectContaining({
      type: 'triggered_ability',
      triggerType: 'counters_removed_from_self',
      sourceName: 'Vanishing Test',
      triggeringPermanent: 'vanishing_perm',
      effect: 'you gain 1 life',
    }));
    expect(stackItems[0]?.effectData).toEqual(expect.objectContaining({
      countersRemoved: 1,
      counterType: 'time',
    }));
  });

  it('queues self counter-removal triggers from removeFadeCounter', () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).battlefield = [
      {
        id: 'fading_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: { fade: 2 },
        card: {
          id: 'fading_card',
          name: 'Fading Test',
          type_line: 'Enchantment',
          oracle_text: 'Whenever one or more fade counters are removed from this enchantment, you gain 1 life.',
        },
      },
    ];
    (game.state as any).stack = [];

    const hasCountersRemaining = removeFadeCounter(game as any, 'fading_perm');

    expect(hasCountersRemaining).toBe(true);
    expect(((game.state as any).battlefield?.[0]?.counters || {}).fade).toBe(1);

    const stackItems = ((game.state as any).stack || []) as any[];
    expect(stackItems).toHaveLength(1);
    expect(stackItems[0]).toEqual(expect.objectContaining({
      type: 'triggered_ability',
      triggerType: 'counters_removed_from_self',
      sourceName: 'Fading Test',
      triggeringPermanent: 'fading_perm',
      effect: 'you gain 1 life',
    }));
    expect(stackItems[0]?.effectData).toEqual(expect.objectContaining({
      countersRemoved: 1,
      counterType: 'fade',
    }));
  });
});