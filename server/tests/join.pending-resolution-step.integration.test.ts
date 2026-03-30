import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerJoinHandlers } from '../src/socket/join.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    id: 'sock_join_pending_step',
    data: { spectator: false },
    rooms: new Set<string>(),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
    join: (room: string) => {
      socket.rooms.add(room);
    },
  } as any;
  return { socket, handlers };
}

describe('joinGame pending resolution step resend (integration)', () => {
  const gameId = 'test_join_pending_resolution_step';
  const playerId = 'p1';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
  });

  it('emits the next pending resolution step after join state', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      {
        id: playerId,
        name: 'P1',
        spectator: false,
        life: 40,
        seatToken: 'seat_p1',
      },
    ];

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.CREATURE_TYPE_CHOICE,
      playerId: playerId as any,
      description: 'Choose a creature type for Cavern of Souls',
      mandatory: true,
      sourceId: 'perm_cavern',
      sourceName: 'Cavern of Souls',
      permanentId: 'perm_cavern',
      cardName: 'Cavern of Souls',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(emitted);
    const io = createMockIo(emitted);

    registerJoinHandlers(io as any, socket as any);

    await handlers['joinGame']({ gameId, fixedPlayerId: playerId });

    const stateEventIndex = emitted.findIndex((entry) => entry.event === 'state');
    const promptEventIndex = emitted.findIndex((entry) => entry.event === 'resolutionStepPrompt');
    const promptEvent = emitted[promptEventIndex];

    expect(stateEventIndex).toBeGreaterThanOrEqual(0);
    expect(promptEventIndex).toBeGreaterThan(stateEventIndex);
    expect(promptEvent?.payload?.gameId).toBe(gameId);
    expect(promptEvent?.payload?.step?.type).toBe('creature_type_choice');
    expect(promptEvent?.payload?.step?.cardName).toBe('Cavern of Souls');
  });
});