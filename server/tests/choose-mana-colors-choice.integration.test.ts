import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createMockIo(
  emitted: Array<{ room?: string; event: string; payload: any }>,
  sockets: any[] = []
) {
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

function createMockSocket(
  playerId: string,
  emitted: Array<{ room?: string; event: string; payload: any }>,
  gameId?: string
) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>(),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;

  if (gameId) socket.rooms.add(gameId);
  return { socket, handlers };
}

describe('choose mana colors choice (integration)', () => {
  const gameId = 'test_choose_mana_colors_choice';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('adds ten mana of one chosen color', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Source: Choose a color to add ten mana',
      mandatory: true,
      sourceName: 'Source',
      options: [
        { id: 'white', label: 'White' },
        { id: 'blue', label: 'Blue' },
        { id: 'black', label: 'Black' },
        { id: 'red', label: 'Red' },
        { id: 'green', label: 'Green' },
      ],
      minSelections: 1,
      maxSelections: 1,
      chooseManaColorsChoice: true,
      chooseManaColorsController: p1,
      chooseManaColorsSourceName: 'Source',
      chooseManaColorsSourceId: 'source_perm',
      chooseManaColorsRestriction: 'unrestricted',
      chooseManaColorsSelectionsTotal: 1,
      chooseManaColorsAmountPerSelection: 10,
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: 'red' });

    expect(Number((game.state as any).manaPool?.[p1]?.red || 0)).toBe(10);
  });

  it('queues a second unrestricted mana color choice and merges duplicate colors', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];

    const firstStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Source: Choose a color for the first mana',
      mandatory: true,
      sourceName: 'Source',
      options: [
        { id: 'white', label: 'White' },
        { id: 'blue', label: 'Blue' },
        { id: 'black', label: 'Black' },
        { id: 'red', label: 'Red' },
        { id: 'green', label: 'Green' },
      ],
      minSelections: 1,
      maxSelections: 1,
      chooseManaColorsChoice: true,
      chooseManaColorsController: p1,
      chooseManaColorsSourceName: 'Source',
      chooseManaColorsSourceId: 'source_perm',
      chooseManaColorsRestriction: 'unrestricted',
      chooseManaColorsSelectionsTotal: 2,
      chooseManaColorsAmountPerSelection: 1,
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: firstStep.id, selections: 'green' });

    let queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any).chooseManaColorsChosen).toEqual(['green']);

    await handlers['submitResolutionResponse']({ gameId, stepId: (queue.steps[0] as any).id, selections: 'green' });

    expect(Number((game.state as any).manaPool?.[p1]?.green || 0)).toBe(2);
  });

  it('adds restricted mana when configured with a casting restriction', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];

    const firstStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Source: Choose a color for the first mana (spend only to cast Dragon spells)',
      mandatory: true,
      sourceName: 'Source',
      options: [
        { id: 'white', label: 'White' },
        { id: 'blue', label: 'Blue' },
        { id: 'black', label: 'Black' },
        { id: 'red', label: 'Red' },
        { id: 'green', label: 'Green' },
      ],
      minSelections: 1,
      maxSelections: 1,
      chooseManaColorsChoice: true,
      chooseManaColorsController: p1,
      chooseManaColorsSourceName: 'Source',
      chooseManaColorsSourceId: 'source_perm',
      chooseManaColorsRestriction: 'dragon_spells',
      chooseManaColorsSelectionsTotal: 2,
      chooseManaColorsAmountPerSelection: 1,
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: firstStep.id, selections: 'blue' });
    const queue = ResolutionQueueManager.getQueue(gameId);
    await handlers['submitResolutionResponse']({ gameId, stepId: (queue.steps[0] as any).id, selections: 'red' });

    const restricted = ((game.state as any).manaPool?.[p1]?.restricted || []) as any[];
    expect(restricted).toHaveLength(2);
    expect(restricted.map((entry) => entry.type)).toEqual(['blue', 'red']);
    expect(restricted.every((entry) => entry.restriction === 'dragon_spells')).toBe(true);
  });
});