import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb, truncateEventsForUndo } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { queueLifeLossTriggers } from '../src/state/modules/triggers/life-loss.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(),
    },
  } as any;
}

function createMockSocket(
  data: { playerId: string; spectator?: boolean; gameId?: string },
  emitted: Array<{ room?: string; event: string; payload: any }>,
) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { spectator: false, ...data },
    rooms: new Set<string>(),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  try {
    truncateEventsForUndo(gameId, 0);
  } catch {
    // ignore
  }
  await deleteGame(gameId);
}

describe('life-loss triggers (integration)', () => {
  const gameId = 'test_life_loss_trigger_exquisite_blood';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('queues opponent life-loss triggers with that-much context', async () => {
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
        id: 'exquisite_blood_perm',
        controller: p1,
        owner: p1,
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

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, gameId }, emitted);
    socket.rooms.add(gameId);
    registerGameActions(createMockIo(emitted), socket as any);

    await handlers.adjustLife({ gameId, delta: -4, targetPlayerId: p2 });

    expect((game.state.life as any)[p2]).toBe(36);
    expect((game.state as any).lifeLostThisTurn?.[p2]).toBe(4);

    const lifeLossStackItems = (((game.state as any).stack || []) as any[]).filter((item: any) => item?.source === 'exquisite_blood_perm');
    expect(lifeLossStackItems).toHaveLength(1);
    expect(lifeLossStackItems[0]).toEqual(expect.objectContaining({
      type: 'triggered_ability',
      triggerType: 'opponent_loses_life',
      sourceName: 'Exquisite Blood',
      triggeringPlayer: p2,
      effect: 'you gain that much life',
    }));
    expect(lifeLossStackItems[0]?.effectData?.lifeLost).toBe(4);
    expect(lifeLossStackItems[0]?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'exquisite_blood_perm',
      controller: p1,
      owner: p1,
      card: expect.objectContaining({
        name: 'Exquisite Blood',
      }),
    }));

    const triggerEvents = getEvents(gameId).filter((event: any) =>
      event?.type === 'pushTriggeredAbility' && event?.payload?.sourceName === 'Exquisite Blood'
    );
    expect(triggerEvents).toHaveLength(1);
    expect(triggerEvents[0]?.payload?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'exquisite_blood_perm',
      controller: p1,
      owner: p1,
    }));

    game.resolveTopOfStack();

    expect((game.state.life as any)[p1]).toBe(44);
  });

  it('replays life-loss trigger source permanent snapshots', () => {
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
      triggerId: 'life_loss_source_snapshot_replay_trigger',
      sourceId: 'exquisite_blood_perm',
      sourceName: 'Exquisite Blood',
      controllerId: p1,
      description: 'you gain that much life',
      triggerType: 'opponent_loses_life',
      effect: 'you gain that much life',
      mandatory: true,
      targetPlayer: p2,
      triggeringPlayer: p2,
      effectData: {
        losingPlayerId: p2,
        lifeLost: 4,
      },
      sourcePermanentSnapshot: {
        id: 'exquisite_blood_perm',
        controller: p1,
        owner: p1,
        card: {
          id: 'exquisite_blood_card',
          name: 'Exquisite Blood',
          type_line: 'Enchantment',
        },
      },
    } as any);

    const replayed = ((game.state as any).stack || []).find((item: any) => item?.id === 'life_loss_source_snapshot_replay_trigger');
    expect(replayed?.sourcePermanentSnapshot).toEqual(expect.objectContaining({
      id: 'exquisite_blood_perm',
      controller: p1,
      owner: p1,
    }));
    expect(replayed?.effectData).toEqual(expect.objectContaining({
      losingPlayerId: p2,
      lifeLost: 4,
    }));
  });

  it('queues simultaneous life-loss triggers in APNAP order', () => {
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
    (game.state as any).activePlayer = p2;
    (game.state as any).life = { [p1]: 39, [p2]: 40, [p3]: 40 };
    (game.state as any).battlefield = [
      {
        id: 'p3_life_loss_trigger_perm',
        controller: p3,
        owner: p3,
        tapped: false,
        counters: {},
        card: {
          id: 'p3_life_loss_trigger_card',
          name: 'P3 Life Loss Trigger',
          type_line: 'Enchantment',
          oracle_text: 'Whenever a player loses life, you gain 1 life.',
        },
      },
      {
        id: 'p2_life_loss_trigger_perm',
        controller: p2,
        owner: p2,
        tapped: false,
        counters: {},
        card: {
          id: 'p2_life_loss_trigger_card',
          name: 'P2 Life Loss Trigger',
          type_line: 'Enchantment',
          oracle_text: 'Whenever a player loses life, you gain 1 life.',
        },
      },
    ];
    (game.state as any).stack = [];

    queueLifeLossTriggers(game as any, p1, 1, undefined, { trackLifeLost: false });

    expect(((game.state as any).stack || []).map((item: any) => item.sourceName)).toEqual([
      'P2 Life Loss Trigger',
      'P3 Life Loss Trigger',
    ]);
  });

  it('queues supported targeted life-loss triggers for target selection', () => {
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game as any).gameId = gameId;
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 40, [p2]: 39 };
    (game.state as any).battlefield = [
      {
        id: 'targeted_life_loss_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'targeted_life_loss_card',
          name: 'Targeted Life Loss Trigger',
          type_line: 'Enchantment',
          oracle_text: 'Whenever a player loses life, target player loses 1 life and you gain 1 life.',
        },
      },
    ];
    (game.state as any).stack = [];

    queueLifeLossTriggers(game as any, p2, 1, undefined, { trackLifeLost: false });

    const stackItems = ((game.state as any).stack || []) as any[];
    expect(stackItems).toHaveLength(1);
    expect(stackItems[0]).toEqual(expect.objectContaining({
      sourceName: 'Targeted Life Loss Trigger',
      effect: 'target player loses 1 life and you gain 1 life',
      requiresTarget: true,
      needsTargetSelection: true,
      targetType: 'player',
    }));

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect(queue.steps[0]).toEqual(expect.objectContaining({
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: p1,
      targetedTriggeredAbility: true,
      targetTypes: ['player'],
    }));
  });

  it('does not rediscover live life-loss triggers while replaying', () => {
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
    (game.state as any).lifeLostThisTurn = {};
    (game.state as any).battlefield = [
      {
        id: 'exquisite_blood_replay_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'exquisite_blood_replay_card',
          name: 'Exquisite Blood',
          type_line: 'Enchantment',
          oracle_text: 'Whenever an opponent loses life, you gain that much life.',
        },
      },
    ];
    (game.state as any).stack = [];

    const queued = queueLifeLossTriggers(game as any, p2, 3);

    expect(queued).toEqual([]);
    expect((game.state as any).stack).toEqual([]);
    expect((game.state as any).lifeLostThisTurn).toEqual({});
  });

  it('rechecks intervening-if conditions when generic life-loss triggers resolve', () => {
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 40, [p2]: 39 };
    (game.state as any).battlefield = [
      {
        id: 'intervening_life_loss_perm',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'intervening_life_loss_card',
          name: 'Intervening Life Loss Trigger',
          type_line: 'Enchantment',
          oracle_text: 'Whenever a player loses life, if you have 40 or more life, you gain 1 life.',
        },
      },
    ];
    (game.state as any).stack = [];

    queueLifeLossTriggers(game as any, p2, 1, undefined, { trackLifeLost: false });
    expect(((game.state as any).stack || [])).toHaveLength(1);

    (game.state as any).life[p1] = 39;
    game.resolveTopOfStack();

    expect((game.state as any).life[p1]).toBe(39);
    expect(((game.state as any).stack || [])).toEqual([]);
  });
});