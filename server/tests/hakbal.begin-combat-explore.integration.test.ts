import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { resolveTopOfStack } from '../src/state/modules/stack.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
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

describe('Hakbal of the Surging Soul beginning-of-combat explore', () => {
  const gameId = 'test_hakbal_begin_combat_explore';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('queues sequential explore decisions for each Merfolk you control', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';
    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).zones = {
      [p1]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 3 },
      [p2]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0 },
    };

    const hakbalId = 'hakbal_1';
    const otherMerfolkId = 'merfolk_2';
    (game.state as any).battlefield = [
      {
        id: hakbalId,
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'hakbal_card',
          name: 'Hakbal of the Surging Soul',
          type_line: 'Legendary Creature — Merfolk Scout',
          oracle_text: 'At the beginning of combat on your turn, each Merfolk you control explores.',
          power: '3',
          toughness: '3',
        },
      },
      {
        id: otherMerfolkId,
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: {
          id: 'other_merfolk_card',
          name: 'River Sneak',
          type_line: 'Creature — Merfolk Warrior',
          oracle_text: '',
          power: '1',
          toughness: '1',
        },
      },
    ];

    game.libraries.set(p1 as any, [
      { id: 'spell_top', name: 'Nonland Spell', type_line: 'Sorcery', oracle_text: '', zone: 'library' },
      { id: 'land_next', name: 'Island', type_line: 'Basic Land — Island', oracle_text: '', zone: 'library' },
      { id: 'spell_last', name: 'Another Spell', type_line: 'Instant', oracle_text: '', zone: 'library' },
    ] as any);

    (game.state as any).stack = [
      {
        id: 'hakbal_trigger',
        type: 'triggered_ability',
        controller: p1,
        source: hakbalId,
        sourceName: 'Hakbal of the Surging Soul',
        description: 'Each Merfolk you control explores.',
        effect: 'Each Merfolk you control explores.',
      },
    ];

    resolveTopOfStack(game as any);

    let queue = ResolutionQueueManager.getQueue(gameId);
    let step = queue.steps.find((s: any) => s.type === ResolutionStepType.EXPLORE_DECISION);
    expect(step).toBeDefined();
    expect((step as any).permanentId).toBe(hakbalId);
    expect((step as any).revealedCard?.id).toBe('spell_top');
    expect(Array.isArray((step as any).remainingPermanentIds)).toBe(true);
    expect((step as any).remainingPermanentIds).toEqual([otherMerfolkId]);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((step as any).id),
      selections: {
        permanentId: hakbalId,
        toGraveyard: true,
      },
    });

    const hakbal = ((game.state as any).battlefield || []).find((p: any) => p.id === hakbalId);
    expect(hakbal?.counters?.['+1/+1']).toBe(1);
    expect((game.state as any).zones[p1].graveyard.map((c: any) => c.id)).toContain('spell_top');

    queue = ResolutionQueueManager.getQueue(gameId);
    step = queue.steps.find((s: any) => s.type === ResolutionStepType.EXPLORE_DECISION);
    expect(step).toBeDefined();
    expect((step as any).permanentId).toBe(otherMerfolkId);
    expect((step as any).revealedCard?.id).toBe('land_next');
    expect((step as any).remainingPermanentIds || []).toEqual([]);
  });
});