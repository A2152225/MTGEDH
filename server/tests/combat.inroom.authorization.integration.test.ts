import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, createGameIfNotExists } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerCombatHandlers } from '../src/socket/combat.js';
import { games } from '../src/socket/socket.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
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

describe('combat in-room authorization (integration)', () => {
  const gameId = 'test_combat_inroom_auth';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    games.delete(gameId as any);
  });

  it('blocks declareAttackers when socket is not in the game room', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId }, emitted);
    // Intentionally do NOT join the room.

    const io = createMockIo(emitted);
    registerCombatHandlers(io as any, socket as any);

    await handlers['declareAttackers']({ gameId, attackers: [] });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('NOT_IN_GAME');

    const anyBroadcast = emitted.find(e => e.room === gameId && e.event === 'chat');
    expect(anyBroadcast).toBeUndefined();
  });

  it('does not throw when payload is missing (crash-safety)', async () => {
    const p1 = 'p1';
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId }, emitted);
    const io = createMockIo(emitted);
    registerCombatHandlers(io as any, socket as any);

    await expect(Promise.resolve().then(() => handlers['declareAttackers'](undefined as any))).resolves.toBeUndefined();
    await expect(Promise.resolve().then(() => handlers['declareBlockers'](undefined as any))).resolves.toBeUndefined();
    await expect(Promise.resolve().then(() => handlers['skipDeclareAttackers'](undefined as any))).resolves.toBeUndefined();
    await expect(Promise.resolve().then(() => handlers['skipDeclareBlockers'](undefined as any))).resolves.toBeUndefined();
    await expect(Promise.resolve().then(() => handlers['applyCombatControl'](undefined as any))).resolves.toBeUndefined();
    await expect(Promise.resolve().then(() => handlers['declareControlledAttackers'](undefined as any))).resolves.toBeUndefined();
    await expect(Promise.resolve().then(() => handlers['declareControlledBlockers'](undefined as any))).resolves.toBeUndefined();
    await expect(Promise.resolve().then(() => handlers['clearCombatControl'](undefined as any))).resolves.toBeUndefined();
  });

  it('blocks applyCombatControl when socket is not in the game room', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId }, emitted);
    // Intentionally do NOT join the room.

    const io = createMockIo(emitted);
    registerCombatHandlers(io as any, socket as any);

    await handlers['applyCombatControl']({
      gameId,
      sourceId: 'master-warcraft',
      sourceName: 'Master Warcraft',
      controlsAttackers: true,
      controlsBlockers: true,
    });

    const err = emitted.find(e => e.event === 'error');
    expect(err?.payload?.code).toBe('NOT_IN_GAME');
  });

  it('rejects malformed controlled declaration payloads without throwing', async () => {
    const p1 = 'p1';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerCombatHandlers(io as any, socket as any);

    await expect(Promise.resolve().then(() => handlers['declareControlledAttackers']({ gameId, attackers: {} as any }))).resolves.toBeUndefined();
    await expect(Promise.resolve().then(() => handlers['declareControlledBlockers']({ gameId, blockers: {} as any }))).resolves.toBeUndefined();

    const attackerErr = emitted.find(e => e.event === 'error' && e.payload?.code === 'CONTROLLED_ATTACKERS_ERROR');
    expect(attackerErr).toBeDefined();

    const blockerErr = emitted.find(e => e.event === 'error' && e.payload?.code === 'CONTROLLED_BLOCKERS_ERROR');
    expect(blockerErr).toBeDefined();
  });

  it('allows combat controller to emit attacker preview during controlled attackers', async () => {
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = p1;
    (game.state as any).step = 'declare_attackers';
    (game.state as any).battlefield = [
      {
        id: 'c1',
        controller: p1,
        card: { name: 'Test Creature', type_line: 'Creature — Bear', oracle_text: '' },
        tapped: false,
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p2, spectator: false, gameId }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerCombatHandlers(io as any, socket as any);

    await handlers['applyCombatControl']({
      gameId,
      sourceId: 'master-warcraft',
      sourceName: 'Master Warcraft',
      controlsAttackers: true,
      controlsBlockers: false,
    });

    await handlers['combatPreviewAttackers']({
      gameId,
      targets: { c1: p1 },
    });

    const preview = emitted.find(e => e.room === gameId && e.event === 'combatPreviewAttackers');
    expect(preview).toBeDefined();
    expect(preview?.payload?.attackerPlayerId).toBe(p1);
    expect(preview?.payload?.targets?.c1).toBe(p1);
  });

  it('ignores attacker preview from non-turn non-controller players', async () => {
    const p1 = 'p1';
    const p2 = 'p2';
    const p3 = 'p3';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
      { id: p3, name: 'P3', spectator: false, life: 40 },
    ];
    (game.state as any).turnPlayer = p1;
    (game.state as any).step = 'declare_attackers';
    (game.state as any).battlefield = [
      {
        id: 'c1',
        controller: p1,
        card: { name: 'Test Creature', type_line: 'Creature — Bear', oracle_text: '' },
        tapped: false,
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p3, spectator: false, gameId }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerCombatHandlers(io as any, socket as any);

    await handlers['combatPreviewAttackers']({
      gameId,
      targets: { c1: p2 },
    });

    const preview = emitted.find(e => e.room === gameId && e.event === 'combatPreviewAttackers');
    expect(preview).toBeUndefined();
  });
});
