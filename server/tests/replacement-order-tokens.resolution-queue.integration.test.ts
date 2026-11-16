import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const JINNIE_ORACLE =
  "If you would create one or more tokens, you may instead create that many 2/2 green Cat creature tokens with haste or that many 3/1 green Dog creature tokens with vigilance.";
const MIRROR_ORACLE =
  "As long as this Equipment is attached to a creature, the first time you would create one or more tokens each turn, you may instead create that many tokens that are copies of equipped creature. Equip {2}";

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

function setupTokens(game: any, p1: string, opts: { jinnie?: boolean; mirrormind?: boolean }) {
  (game as any).gameId = game.id || game.gameId;
  (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
  const battlefield: any[] = [];
  if (opts.mirrormind) {
    battlefield.push({
      id: 'creature_1',
      controller: p1,
      owner: p1,
      tapped: false,
      counters: {},
      card: { id: 'creature_1', name: 'Elvish Visionary', type_line: 'Creature — Elf Shaman', oracle_text: 'When Elvish Visionary enters the battlefield, draw a card.', power: '1', toughness: '1', zone: 'battlefield' },
    });
    battlefield.push({
      id: 'crown_1',
      controller: p1,
      owner: p1,
      attachedTo: 'creature_1',
      tapped: false,
      counters: {},
      card: { id: 'crown_1', name: 'Mirrormind Crown', type_line: 'Artifact — Equipment', oracle_text: MIRROR_ORACLE, zone: 'battlefield' },
    });
  }
  if (opts.jinnie) {
    battlefield.push({
      id: 'jinnie_1',
      controller: p1,
      owner: p1,
      tapped: false,
      counters: {},
      card: { id: 'jinnie_1', name: "Jinnie Fay, Jetmir's Second", type_line: 'Legendary Creature — Elf Druid', oracle_text: JINNIE_ORACLE, zone: 'battlefield' },
    });
  }
  (game.state as any).battlefield = battlefield;
}

describe('CR 616.1 replacement order on token creation (Jinnie vs copy-equipped)', () => {
  const tracked = new Set<string>();
  const createGameId = () => `test_repl_order_tok_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => { await initDb(); });
  beforeEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });
  afterEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });

  it('auto-picks when only Jinnie applies (no order prompt)', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    setupTokens(game, 'p1', { jinnie: true });
    const { createToken } = await import('../src/state/modules/counters_tokens.js');
    const created = createToken({ state: game.state, bumpSeq: () => {}, gameId } as any, 'p1' as any, 'Soldier', 1, 1, 1, { colors: ['W'], typeLine: 'Token Creature — Soldier' }, false);
    expect(created).toEqual([]);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => s?.replacementOrderChoice === true)).toBe(false);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => s?.jinnieFayTokenChoice === true)).toBe(true);
  });

  it('auto-picks when only the equipped-copy replacement applies (no order prompt)', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    setupTokens(game, 'p1', { mirrormind: true });
    const { createToken } = await import('../src/state/modules/counters_tokens.js');
    const created = createToken({ state: game.state, bumpSeq: () => {}, gameId } as any, 'p1' as any, 'Soldier', 1, 1, 1, { colors: ['W'], typeLine: 'Token Creature — Soldier' }, false);
    expect(created).toEqual([]);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => s?.replacementOrderChoice === true)).toBe(false);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => s?.mirrormindCrownTokenReplacementChoice === true)).toBe(true);
  });

  it('queues an order prompt when both apply, and choosing Jinnie first leads to the Cat/Dog choice', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1';
    setupTokens(game, p1, { jinnie: true, mirrormind: true });
    const { createToken } = await import('../src/state/modules/counters_tokens.js');
    createToken({ state: game.state, bumpSeq: () => {}, gameId } as any, p1 as any, 'Soldier', 2, 1, 1, { colors: ['W'], typeLine: 'Token Creature — Soldier' }, false);

    const order = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.replacementOrderChoice === true) as any;
    expect(order).toBeDefined();
    const effectIds = (order.replacementOrderCandidates || []).map((c: any) => c.effectId).sort();
    expect(effectIds).toEqual(['optional-copy-equipped-first-tokens-this-turn', 'optional-token-identity-choice'].sort());

    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    registerResolutionHandlers(createMockIo(emitted, [socket]), socket);
    const jinnieId = (order.replacementOrderCandidates || []).find((c: any) => c.effectId === 'optional-token-identity-choice').id;
    await handlers['submitResolutionResponse']({ gameId, stepId: order.id, selections: [jinnieId] });

    const jinnie = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.jinnieFayTokenChoice === true) as any;
    expect(jinnie).toBeDefined();
    await handlers['submitResolutionResponse']({ gameId, stepId: jinnie.id, selections: ['face_0'] });

    const tokens = ((game.state as any).battlefield || []).filter((p: any) => p?.isToken === true);
    // After Jinnie, the equipped-copy replacement may still apply to the resulting tokens.
    const copyStep = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.mirrormindCrownTokenReplacementChoice === true) as any;
    if (copyStep) {
      await handlers['submitResolutionResponse']({ gameId, stepId: copyStep.id, selections: ['normal'] });
    }
    const after = ((game.state as any).battlefield || []).filter((p: any) => p?.isToken === true);
    expect(after).toHaveLength(2);
    expect(after.every((t: any) => t.card?.name === 'Cat')).toBe(true);
  });

  it('lets the equipped-copy replacement apply first, then Jinnie can still replace the resulting event', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    (game as any).gameId = gameId;
    const p1 = 'p1';
    setupTokens(game, p1, { jinnie: true, mirrormind: true });
    const { createToken } = await import('../src/state/modules/counters_tokens.js');
    createToken({ state: game.state, bumpSeq: () => {}, gameId } as any, p1 as any, 'Soldier', 1, 1, 1, { colors: ['W'], typeLine: 'Token Creature — Soldier' }, false);

    const order = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.replacementOrderChoice === true) as any;
    expect(order).toBeDefined();
    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    registerResolutionHandlers(createMockIo(emitted, [socket]), socket);
    const copyId = (order.replacementOrderCandidates || []).find((c: any) => c.effectId === 'optional-copy-equipped-first-tokens-this-turn').id;
    await handlers['submitResolutionResponse']({ gameId, stepId: order.id, selections: [copyId] });

    const copyStep = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.mirrormindCrownTokenReplacementChoice === true) as any;
    expect(copyStep).toBeDefined();
    await handlers['submitResolutionResponse']({ gameId, stepId: copyStep.id, selections: ['normal'] });

    const jinnie = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.jinnieFayTokenChoice === true) as any;
    expect(jinnie).toBeDefined();
    await handlers['submitResolutionResponse']({ gameId, stepId: jinnie.id, selections: ['normal'] });
    const tokens = ((game.state as any).battlefield || []).filter((p: any) => p?.isToken === true);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].card?.name).toBe('Soldier');
  });
});
