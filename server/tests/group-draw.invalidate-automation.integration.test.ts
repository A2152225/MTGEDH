import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
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
    sockets: {
      sockets: new Map(),
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
      sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])),
    },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

describe('Group draw automation invalidation (integration)', () => {
  const gameId = 'test_group_draw_invalidate_automation';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('clears skip-to-phase and auto-pass-for-turn after Temple Bell changes a player hand', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40, isAI: false },
      { id: p2, name: 'P2', spectator: false, life: 40, isAI: false },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40 };

    const deck1 = Array.from({ length: 20 }, (_, index) => ({
      id: `p1_card_${index}`,
      name: `P1 Card ${index}`,
      type_line: 'Instant',
      oracle_text: '',
      mana_cost: '{1}{U}',
    }));
    const deck2 = Array.from({ length: 20 }, (_, index) => ({
      id: `p2_card_${index}`,
      name: `P2 Card ${index}`,
      type_line: 'Instant',
      oracle_text: '',
      mana_cost: '{1}{U}',
    }));

    game.importDeckResolved(p1, deck1 as any);
    game.importDeckResolved(p2, deck2 as any);
    game.drawCards(p1, 7);
    game.drawCards(p2, 7);

    (game.state as any).battlefield = [
      {
        id: 'temple_bell_perm',
        controller: p2,
        owner: p2,
        tapped: false,
        counters: {},
        card: {
          id: 'temple_bell_card',
          name: 'Temple Bell',
          type_line: 'Artifact',
          oracle_text: '{T}: Each player draws a card.',
        },
      },
    ];

    (game.state as any).turnPlayer = p2;
    (game.state as any).priority = p2;
    (game.state as any).phase = 'ending';
    (game.state as any).step = 'END';
    (game.state as any).autoPassPlayers = new Set([p1]);
    (game.state as any).autoPassForTurn = { [p1]: true };
    (game.state as any).justSkippedToPhase = {
      playerId: p1,
      phase: 'precombatMain',
      step: 'MAIN1',
    };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.ACTIVATED_ABILITY,
      playerId: p2 as any,
      description: 'Resolve Temple Bell',
      mandatory: true,
      sourceId: 'temple_bell_perm',
      sourceName: 'Temple Bell',
      permanentId: 'temple_bell_perm',
      permanentName: 'Temple Bell',
      abilityType: 'group_draw',
      abilityDescription: 'Each player draws a card',
      abilityData: {
        groupDrawEffect: {
          affectedPlayers: 'all',
          drawAmount: 1,
          cardName: 'Temple Bell',
          cost: '{T}',
        },
      },
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p2, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find((queuedStep: any) => queuedStep.type === 'activated_ability');
    expect(step).toBeDefined();

    expect((game.state as any).zones[p1].handCount).toBe(7);
    expect((game.state as any).autoPassPlayers.has(p1)).toBe(true);
    expect((game.state as any).autoPassForTurn[p1]).toBe(true);
    expect((game.state as any).justSkippedToPhase?.playerId).toBe(p1);

    await handlers['submitResolutionResponse']({ gameId, stepId: String((step as any).id), selections: [] });

    expect((game.state as any).zones[p1].handCount).toBe(8);
    expect((game.state as any).zones[p2].handCount).toBe(8);
    expect((game.state as any).autoPassPlayers.has(p1)).toBe(true);
    expect((game.state as any).autoPassForTurn?.[p1]).toBeUndefined();
    expect((game.state as any).justSkippedToPhase).toBeUndefined();

    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.some((queuedStep: any) => String(queuedStep.id) === String((step as any).id))).toBe(false);
  });
});
