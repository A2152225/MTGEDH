import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
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
    rooms: { has: (_room: string) => true, add: (_room: string) => {}, delete: (_room: string) => {} } as any,
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
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('ETB triggered target selection (integration)', () => {
  const gameId = 'test_etb_triggered_target_selection';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('queues a mixed TARGET_SELECTION prompt for ETB any-target triggers', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).battlefield = [
      {
        id: 'source_perm',
        controller: p1,
        owner: p1,
        card: { name: 'Spark Adept', type_line: 'Creature - Elemental' },
      },
      {
        id: 'artifact_1',
        controller: p2,
        owner: p2,
        card: { name: 'Target Relic', type_line: 'Artifact' },
      },
      {
        id: 'creature_1',
        controller: p2,
        owner: p2,
        card: { name: 'Target Bear', type_line: 'Creature - Bear' },
      },
      {
        id: 'walker_1',
        controller: p2,
        owner: p2,
        card: { name: 'Target Walker', type_line: 'Planeswalker' },
      },
    ];
    (game.state as any).stack = [
      {
        id: 'trigger_1',
        type: 'triggered_ability',
        controller: p1,
        source: 'source_perm',
        permanentId: 'source_perm',
        sourceName: 'Spark Adept',
        description: 'When Spark Adept enters the battlefield, it deals 2 damage to any target.',
        effect: 'When Spark Adept enters the battlefield, it deals 2 damage to any target.',
        triggerType: 'etb',
        mandatory: true,
        requiresTarget: true,
        targetType: 'any',
        needsTargetSelection: true,
      },
    ];

    game.resolveTopOfStack();

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    const step = queue.steps[0] as any;
    expect(step.type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect(step.targetedTriggeredAbility).toBe(true);
    expect(step.targetDescription).toBe('any target');
    expect(step.validTargets.map((target: any) => target.id).sort()).toEqual([
      'creature_1',
      'p1',
      'p2',
      'source_perm',
      'walker_1',
    ].sort());
  });

  it('resolves player-target ETB graveyard exile through generic TARGET_SELECTION', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).battlefield = [
      {
        id: 'bog_1',
        controller: p1,
        owner: p1,
        card: { name: 'Bojuka Bog', type_line: 'Land' },
      },
    ];
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, libraryCount: 0 },
      [p2]: {
        hand: [], handCount: 0, graveyard: [{ id: 'dead_1', name: 'Dead Card', type_line: 'Creature', zone: 'graveyard' }], graveyardCount: 1,
        exile: [], exileCount: 0, libraryCount: 0,
      },
    };
    (game.state as any).stack = [
      {
        id: 'trigger_bog_1',
        type: 'triggered_ability',
        controller: p1,
        source: 'bog_1',
        permanentId: 'bog_1',
        sourceName: 'Bojuka Bog',
        description: 'When Bojuka Bog enters the battlefield, exile all cards from target player\'s graveyard.',
        effect: 'When Bojuka Bog enters the battlefield, exile all cards from target player\'s graveyard.',
        triggerType: 'etb',
        mandatory: true,
        requiresTarget: true,
        targetType: 'player',
        needsTargetSelection: true,
      },
    ];

    game.resolveTopOfStack();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    const step = queue.steps[0] as any;
    expect(step.type).toBe(ResolutionStepType.TARGET_SELECTION);
    expect(step.validTargets.map((target: any) => target.id).sort()).toEqual([p1, p2].sort());

    await handlers['submitResolutionResponse']({ gameId, stepId: String(step.id), selections: [p2] });

    expect(((game.state as any).zones[p2].graveyard || []).length).toBe(0);
    expect(((game.state as any).zones[p2].exile || []).map((card: any) => card.id)).toEqual(['dead_1']);
  });
});