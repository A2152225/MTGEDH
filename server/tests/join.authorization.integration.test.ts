import { describe, it, expect, beforeAll } from 'vitest';
import { initDb } from '../src/db/index.js';
import { registerJoinHandlers } from '../src/socket/join.js';

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
    id: 'sock_join_auth',
    data: { spectator: false, ...data },
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

describe('joinGame authorization boundary (integration)', () => {
  beforeAll(async () => {
    await initDb();
  });

  it('does not throw when payload is missing and emits MISSING_GAME_ID', async () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({}, emitted);
    const io = createMockIo(emitted);

    registerJoinHandlers(io as any, socket as any);

    await expect(Promise.resolve().then(() => handlers['joinGame'](undefined as any))).resolves.toBeUndefined();

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('MISSING_GAME_ID');
  });
});
