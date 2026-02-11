import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => {
        // no-op
      },
    }),
    emit: (_event: string, _payload: any) => {
      // no-op
    },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((s, idx) => [`s_${idx}`, s])),
    },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
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

describe('Discard + sacrifice as activation cost via Resolution Queue (integration)', () => {
  const gameId = 'test_discard_and_sacrifice_activation_cost_resolution_queue';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('enqueues DISCARD_SELECTION, then TARGET_SELECTION for sacrifice, then resumes activation', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;

    (game.state as any).battlefield = [
      {
        id: 'src_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Test Engine',
          type_line: 'Artifact',
          oracle_text: 'Discard a card, Sacrifice a creature: Draw a card.',
          image_uris: { small: 'https://example.com/engine.jpg' },
        },
      },
      {
        id: 'cre_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Test Creature',
          type_line: 'Creature — Bear',
          oracle_text: '',
        },
      },
    ];

    (game.state as any).zones = {
      [p1]: {
        hand: [
          {
            id: 'h_1',
            name: 'Hand Card',
            type_line: 'Instant',
            mana_cost: '{U}',
            zone: 'hand',
          },
        ],
        graveyard: [],
        exile: [],
        handCount: 1,
        graveyardCount: 0,
        exileCount: 0,
      },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    expect(typeof handlers['activateBattlefieldAbility']).toBe('function');
    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'src_1', abilityId: 'src_1-ability-0' });

    let queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(1);

    const discardStep = queue.steps[0] as any;
    expect(discardStep.type).toBe('discard_selection');
    expect(discardStep.playerId).toBe(p1);
    expect(discardStep.discardAbilityAsCost).toBe(true);
    expect(discardStep.discardAndSacrificeAbilityAsCost).toBe(true);
    expect(discardStep.discardCount).toBe(1);

    expect(typeof handlers['submitResolutionResponse']).toBe('function');
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: discardStep.id,
      selections: ['h_1'],
    });

    const zonesAfterDiscard = (game.state as any).zones?.[p1];
    expect((zonesAfterDiscard.hand as any[]).some((c: any) => c && c.id === 'h_1')).toBe(false);
    expect((zonesAfterDiscard.graveyard as any[]).some((c: any) => c && c.id === 'h_1')).toBe(true);

    queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.length).toBe(1);

    const sacStep = queue.steps[0] as any;
    expect(sacStep.type).toBe('target_selection');
    expect(sacStep.sacrificeAbilityAsCost).toBe(true);
    expect(sacStep.discardAndSacrificeAbilityAsCost).toBe(true);
    expect(sacStep.minTargets).toBe(1);
    expect(sacStep.maxTargets).toBe(1);

    expect(Array.isArray(sacStep.validTargets)).toBe(true);
    expect((sacStep.validTargets as any[]).some((t: any) => String(t?.id) === 'cre_1')).toBe(true);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: sacStep.id,
      selections: ['cre_1'],
    });

    const battlefield = (game.state as any).battlefield || [];
    expect((battlefield as any[]).some((p: any) => p && String(p.id) === 'cre_1')).toBe(false);

    const stack = (game.state as any).stack || [];
    expect(stack.length).toBe(1);
    expect(String(stack[0].type)).toBe('ability');
    expect(String(stack[0].source)).toBe('src_1');
    expect(String(stack[0].description || '').toLowerCase()).toContain('draw a card');

    expect(emitted.some((e) => e.room === gameId && e.event === 'stackUpdate')).toBe(true);
  });
});
