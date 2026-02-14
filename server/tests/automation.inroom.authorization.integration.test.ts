import { describe, it, expect, beforeEach } from 'vitest';
import { registerAutomationHandlers } from '../src/socket/automation.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      adapter: { rooms: new Map() },
      sockets: new Map(),
    },
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

describe('automation in-room authorization (integration)', () => {
  const gameId = 'test_automation_inroom_auth';

  beforeEach(() => {
    // no shared global state needed for the guard-only tests
  });

  it('blocks castSpell when socket is not in the game room (guard triggers before game lookup)', async () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: 'p1', spectator: false, gameId }, emitted);
    // Intentionally do NOT join the room.

    const io = createMockIo(emitted);
    registerAutomationHandlers(io as any, socket as any);

    await handlers['castSpell']({ gameId, cardId: 'c1', targets: [], modes: [], xValue: 0, manaPayment: [] });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('NOT_IN_GAME');
  });
});
