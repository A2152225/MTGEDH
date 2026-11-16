import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const JINNIE_ORACLE =
  "If you would create one or more tokens, you may instead create that many 2/2 green Cat creature tokens with haste or that many 3/1 green Dog creature tokens with vigilance.";

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createMockIo(emitted: any[], sockets: any[] = []) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: any[], gameId?: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => { handlers[event] = handler; },
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
  } as any;
  if (gameId) socket.rooms.add(gameId);
  return { socket, handlers };
}

function setupJinnie(game: any, p1: string) {
  (game as any).gameId = game.id || game.gameId;
  (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
  (game.state as any).battlefield = [
    {
      id: 'jinnie_1',
      controller: p1,
      owner: p1,
      tapped: false,
      counters: {},
      card: {
        id: 'jinnie_1',
        name: "Jinnie Fay, Jetmir's Second",
        type_line: 'Legendary Creature — Elf Druid',
        oracle_text: JINNIE_ORACLE,
        zone: 'battlefield',
      },
    },
  ];
}

describe('Jinnie Fay token identity choice (resolution queue integration)', () => {
  const tracked = new Set<string>();
  const createGameId = () => `test_jinnie_fay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => { await initDb(); });
  beforeEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });
  afterEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });

  it('queues a Cat / Dog / normal choice and creates that many 2/2 Cats with haste', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1';
    setupJinnie(game, p1);

    const { createToken } = await import('../src/state/modules/counters_tokens.js');
    const ctx: any = { state: game.state, bumpSeq: () => {}, gameId, libraries: (game as any).libraries || new Map() };
    const created = createToken(ctx, p1 as any, 'Soldier', 2, 1, 1, { colors: ['W'], typeLine: 'Token Creature — Soldier' }, false);
    expect(created).toEqual([]);

    const step = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.jinnieFayTokenChoice === true) as any;
    expect(step).toBeDefined();
    expect(step.type).toBe('option_choice');
    expect((step.options || []).map((o: any) => o.id)).toEqual(['face_0', 'face_1', 'normal']);

    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    registerResolutionHandlers(createMockIo(emitted, [socket]), socket);
    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: ['face_0'], cancelled: false });

    const tokens = ((game.state as any).battlefield || []).filter((p: any) => p?.isToken === true);
    expect(tokens).toHaveLength(2);
    expect(tokens.every((t: any) => t.card?.name === 'Cat')).toBe(true);
    expect(tokens.every((t: any) => String(t.card?.power) === '2' && String(t.basePower) === '2')).toBe(true);
    expect(tokens.every((t: any) => String(t.card?.toughness) === '2' && String(t.baseToughness) === '2')).toBe(true);
    expect(tokens.every((t: any) => /\bhaste\b/i.test(String(t.card?.oracle_text || t.card?.keywords?.join(' ') || '')))).toBe(true);
    expect(tokens.every((t: any) => t.summoningSickness === false)).toBe(true);
    expect(tokens.every((t: any) => (t.card?.colors || []).includes('G'))).toBe(true);
  });

  it('creates that many 3/1 Dogs with vigilance when that option is chosen', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1';
    setupJinnie(game, p1);

    const { createToken } = await import('../src/state/modules/counters_tokens.js');
    const ctx: any = { state: game.state, bumpSeq: () => {}, gameId };
    createToken(ctx, p1 as any, 'Soldier', 1, 1, 1, { colors: ['W'], typeLine: 'Token Creature — Soldier' }, false);
    const step = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.jinnieFayTokenChoice === true) as any;
    expect(step).toBeDefined();

    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    registerResolutionHandlers(createMockIo(emitted, [socket]), socket);
    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: ['face_1'] });

    const tokens = ((game.state as any).battlefield || []).filter((p: any) => p?.isToken === true);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].card?.name).toBe('Dog');
    expect(String(tokens[0].basePower)).toBe('3');
    expect(String(tokens[0].baseToughness)).toBe('1');
    expect(/\bvigilance\b/i.test(String(tokens[0].card?.oracle_text || tokens[0].card?.keywords?.join(' ') || ''))).toBe(true);
  });

  it('creates the original tokens when the player declines', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1';
    setupJinnie(game, p1);

    const { createToken } = await import('../src/state/modules/counters_tokens.js');
    const ctx: any = { state: game.state, bumpSeq: () => {}, gameId };
    createToken(ctx, p1 as any, 'Soldier', 2, 1, 1, { colors: ['W'], typeLine: 'Token Creature — Soldier' }, false);
    const step = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.jinnieFayTokenChoice === true) as any;
    expect(step).toBeDefined();

    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    registerResolutionHandlers(createMockIo(emitted, [socket]), socket);
    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: ['normal'] });

    const tokens = ((game.state as any).battlefield || []).filter((p: any) => p?.isToken === true);
    expect(tokens).toHaveLength(2);
    expect(tokens.every((t: any) => t.card?.name === 'Soldier')).toBe(true);
  });

  it('does not prompt when Jinnie Fay is not on the battlefield', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).battlefield = [];

    const { createToken } = await import('../src/state/modules/counters_tokens.js');
    const ctx: any = { state: game.state, bumpSeq: () => {}, gameId };
    const created = createToken(ctx, p1 as any, 'Soldier', 1, 1, 1, { colors: ['W'], typeLine: 'Token Creature — Soldier' }, false);
    expect(created).toHaveLength(1);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => s?.jinnieFayTokenChoice === true)).toBe(false);
  });
});
