import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

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

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>, gameId?: string) {
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

describe('pay mana to look and choose card (integration)', () => {
  const gameId = 'test_pay_mana_to_look_and_choose_card';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('spends mana, looks at X cards, and moves one to hand with the rest randomized to the bottom', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1' as any;
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).manaPool = { [p1]: { colorless: 2, blue: 1 } };
    (game.state as any).zones = {
      [p1]: {
        library: [
          { id: 'top_1', name: 'Top One', type_line: 'Instant', zone: 'library' },
          { id: 'top_2', name: 'Top Two', type_line: 'Sorcery', zone: 'library' },
          { id: 'top_3', name: 'Top Three', type_line: 'Creature', zone: 'library' },
          { id: 'rest_1', name: 'Rest', type_line: 'Land', zone: 'library' },
        ],
        libraryCount: 4,
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
      },
    };

    const step = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: p1,
      description: 'Source: Pay any amount of mana',
      mandatory: true,
      sourceName: 'Source',
      options: [
        { id: '0', label: '0' },
        { id: '2', label: '2' },
      ],
      minSelections: 1,
      maxSelections: 1,
      payManaToLookAndChooseCardChoice: true,
      payManaToLookAndChooseCardController: p1,
      payManaToLookAndChooseCardSourceName: 'Source',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: '2' });

    let queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    expect((queue.steps[0] as any).chooseLookedAtCardsDestinationChoice).toBe(true);
    expect((game.state as any).manaPool[p1].colorless).toBe(0);

    await handlers['submitResolutionResponse']({ gameId, stepId: (queue.steps[0] as any).id, selections: 'top_2' });

    expect(((game.state as any).zones[p1].hand || []).map((c: any) => c.id)).toEqual(['top_2']);
    expect(((game.state as any).zones[p1].library || []).map((c: any) => c.id)).toContain('rest_1');
    expect(((game.state as any).zones[p1].library || []).map((c: any) => c.id)).toContain('top_1');
  });
});