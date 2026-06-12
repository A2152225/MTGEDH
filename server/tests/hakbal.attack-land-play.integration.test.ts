import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: () => undefined }),
    emit: () => undefined,
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((s, idx) => [`s_${idx}`, s])) },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>([gameId]),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('Hakbal attack trigger land play or draw', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
  });

  afterEach(async () => {
    ResolutionQueueManager.removeQueue('test_hakbal_attack_land_play_play');
    ResolutionQueueManager.removeQueue('test_hakbal_attack_land_play_draw');
    games.delete('test_hakbal_attack_land_play_play' as any);
    games.delete('test_hakbal_attack_land_play_draw' as any);
    await deleteGame('test_hakbal_attack_land_play_play');
    await deleteGame('test_hakbal_attack_land_play_draw');
  });

  function seedGame(gameId: string) {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(gameId as any, game as any);

    const p1 = 'p1' as PlayerID;
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    return { game, p1 };
  }

  it('queues land play choice instead of auto-drawing when a land is in hand', async () => {
    const gameId = 'test_hakbal_attack_land_play_play';
    const { game, p1 } = seedGame(gameId);
    game.importDeckResolved(p1, [
      { id: 'drawn_1', name: 'Extra Card', type_line: 'Instant', zone: 'library' },
    ] as any);

    const ctx = game as any;
    ctx.state.zones[p1].hand = [
      {
        id: 'tower_1',
        name: 'Command Tower',
        type_line: 'Land',
        zone: 'hand',
      },
    ];
    ctx.state.zones[p1].handCount = 1;

    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(
      ctx,
      p1,
      'Hakbal of the Surging Soul',
      "you may put a land card from your hand onto the battlefield. If you don't, draw a card",
      {
        id: 'hakbal_attack_trigger',
        type: 'triggered_ability',
        controller: p1,
        triggerType: 'attacks',
        sourceId: 'hakbal_1',
        permanentId: 'hakbal_1',
      },
    );

    expect((ctx.state.zones[p1].hand || []).map((card: any) => card?.name)).toEqual(['Command Tower']);

    const queueSteps = ResolutionQueueManager.getQueue(gameId).steps;
    const landStep = queueSteps.find((step) => step.type === ResolutionStepType.KYNAIOS_CHOICE) as any;
    expect(landStep, `queue step types: ${queueSteps.map((s) => s.type).join(', ')}`).toBeDefined();
    expect(String(landStep?.description || '')).toMatch(/put a land card from your hand onto the battlefield/i);
    expect((landStep?.landPlayOrFallbackOptions || [])).toEqual(['play_land', 'draw_card']);
    expect((landStep?.landPlayOrFallbackLandsInHand || []).map((card: any) => card.id)).toEqual(['tower_1']);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, gameId, emitted);
    registerResolutionHandlers(createMockIo(emitted, [socket]) as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(landStep.id),
      selections: { choice: 'play_land', landCardId: 'tower_1' },
    });

    const battlefield = (ctx.state as any).battlefield || [];
    expect(battlefield.some((permanent: any) => permanent?.card?.name === 'Command Tower')).toBe(true);
    expect((ctx.state.zones[p1].hand || []).map((card: any) => card?.id)).toEqual([]);
  });

  it('draws a card when the controller chooses not to play a land', async () => {
    const gameId = 'test_hakbal_attack_land_play_draw';
    const { game, p1 } = seedGame(gameId);
    game.importDeckResolved(p1, [
      { id: 'drawn_1', name: 'Island', type_line: 'Basic Land — Island', zone: 'library' },
    ] as any);

    const ctx = game as any;
    ctx.state.zones[p1].hand = [
      {
        id: 'tower_1',
        name: 'Command Tower',
        type_line: 'Land',
        zone: 'hand',
      },
    ];
    ctx.state.zones[p1].handCount = 1;

    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(
      ctx,
      p1,
      'Hakbal of the Surging Soul',
      "you may put a land card from your hand onto the battlefield. If you don't, draw a card",
      {
        id: 'hakbal_attack_trigger_draw',
        type: 'triggered_ability',
        controller: p1,
        triggerType: 'attacks',
        sourceId: 'hakbal_1',
        permanentId: 'hakbal_1',
      },
    );

    const queueSteps = ResolutionQueueManager.getQueue(gameId).steps;
    const landStep = queueSteps.find((step) => step.type === ResolutionStepType.KYNAIOS_CHOICE) as any;
    expect(landStep, `queue step types: ${queueSteps.map((s) => s.type).join(', ')}`).toBeDefined();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, gameId, emitted);
    registerResolutionHandlers(createMockIo(emitted, [socket]) as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(landStep.id),
      selections: { choice: 'draw_card' },
    });

    expect((ctx.state.zones[p1].hand || []).map((card: any) => card?.name)).toEqual(['Command Tower', 'Island']);
    expect(((ctx.state as any).battlefield || []).some((permanent: any) => permanent?.card?.name === 'Command Tower')).toBe(false);
  });
});
