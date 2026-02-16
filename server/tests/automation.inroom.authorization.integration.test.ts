import { describe, it, expect, beforeEach } from 'vitest';
import { registerAutomationHandlers } from '../src/socket/automation.js';
import { games } from '../src/socket/socket.js';

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
    games.delete(gameId as any);
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

  it('does not throw when payload is missing (crash-safety)', async () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: 'p1', spectator: false, gameId }, emitted);

    const io = createMockIo(emitted);
    registerAutomationHandlers(io as any, socket as any);

    await expect(Promise.resolve().then(() => handlers['submitDecision'](undefined as any))).resolves.toBeUndefined();
    await expect(Promise.resolve().then(() => handlers['castSpell'](undefined as any))).resolves.toBeUndefined();
    await expect(Promise.resolve().then(() => handlers['activateAbility'](undefined as any))).resolves.toBeUndefined();
    await expect(Promise.resolve().then(() => handlers['mulliganDecision'](undefined as any))).resolves.toBeUndefined();
    await expect(Promise.resolve().then(() => handlers['mulliganBottomCards'](undefined as any))).resolves.toBeUndefined();
    expect(() => handlers['setAutoPass'](undefined as any)).not.toThrow();
    expect(() => handlers['setAutoPassForTurn'](undefined as any)).not.toThrow();
    expect(() => handlers['claimPriority'](undefined as any)).not.toThrow();
    expect(() => handlers['checkCanRespond'](undefined as any)).not.toThrow();
    expect(() => handlers['setStop'](undefined as any)).not.toThrow();
    expect(() => handlers['yieldToTriggerSource'](undefined as any)).not.toThrow();
    expect(() => handlers['unyieldToTriggerSource'](undefined as any)).not.toThrow();
    expect(() => handlers['ignoreCardForAutoPass'](undefined as any)).not.toThrow();
    expect(() => handlers['unignoreCardForAutoPass'](undefined as any)).not.toThrow();
    expect(() => handlers['clearIgnoredCards'](undefined as any)).not.toThrow();
  });

  it('rejects malformed phase/source/card identifiers when in-room and seated', async () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: 'p1', spectator: false, gameId }, emitted);
    socket.rooms.add(gameId);

    games.set(gameId as any, {
      state: {
        players: [{ id: 'p1', spectator: false, isSpectator: false }],
        battlefield: [],
      },
      bumpSeq: () => {},
    } as any);

    const io = createMockIo(emitted);
    registerAutomationHandlers(io as any, socket as any);

    handlers['setStop']({ gameId, phase: { bad: true }, enabled: true });
    handlers['yieldToTriggerSource']({ gameId, sourceId: { bad: true } });
    handlers['ignoreCardForAutoPass']({ gameId, cardId: { bad: true }, cardName: 'Test' });
    handlers['unignoreCardForAutoPass']({ gameId, cardId: { bad: true } });

    const invalidPayloadErrors = emitted.filter(e => e.event === 'error' && e.payload?.code === 'INVALID_PAYLOAD');
    expect(invalidPayloadErrors.length).toBeGreaterThanOrEqual(4);
  });

  it('rejects malformed cast/activate/mulligan payloads in-room', async () => {
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: 'p1', spectator: false, gameId }, emitted);
    socket.rooms.add(gameId);

    games.set(gameId as any, {
      state: {
        players: [{ id: 'p1', spectator: false, isSpectator: false }],
        battlefield: [],
      },
      bumpSeq: () => {},
    } as any);

    const io = createMockIo(emitted);
    registerAutomationHandlers(io as any, socket as any);

    await handlers['castSpell']({ gameId });
    await handlers['activateAbility']({ gameId, permanentId: 'perm_1' });
    await handlers['mulliganDecision']({ gameId });
    await handlers['mulliganBottomCards']({ gameId, cardIds: 'not-array' as any });

    const invalidPayloadErrors = emitted.filter(e => e.event === 'error' && e.payload?.code === 'INVALID_PAYLOAD');
    expect(invalidPayloadErrors.length).toBeGreaterThanOrEqual(4);
  });
});
