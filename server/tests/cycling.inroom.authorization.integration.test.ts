import { describe, it, expect, beforeAll } from 'vitest';
import { initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(data: any, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data,
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

describe('cycling in-room authorization (integration)', () => {
  const gameId = 'test_cycling_inroom_auth';

  beforeAll(async () => {
    await initDb();
  });

  it('blocks activateCycling when socket is not in the game room', async () => {
    const p1 = 'p1';

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId }, emitted);

    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateCycling']({ gameId, cardId: 'card_1' });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('NOT_IN_GAME');

    const chat = emitted.find(e => e.event === 'chat');
    expect(chat).toBeUndefined();
  });
});
