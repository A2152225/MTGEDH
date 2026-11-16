import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

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

const ESIX_ORACLE =
  'The first time you would create one or more tokens during each of your turns, you may instead choose a creature other than Esix, Fractal Bloom and create that many tokens that are copies of that creature.';
const MIRROR_ORACLE =
  'As long as this Equipment is attached to a creature, the first time you would create one or more tokens each turn, you may instead create that many tokens that are copies of equipped creature. Equip {2}';

describe('CR 616.1 replacement order: Esix first-tokens vs Mirrormind Crown', () => {
  const tracked = new Set<string>();
  const createGameId = () => `test_esix_mirror_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => { await initDb(); });
  beforeEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });
  afterEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });

  function setup(game: any, p1: string, opts: { esix?: boolean; mirrormind?: boolean }) {
    (game as any).gameId = game.id || game.gameId;
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = p1;
    const battlefield: any[] = [];
    battlefield.push({
      id: 'bear_1',
      controller: p1,
      owner: p1,
      tapped: false,
      counters: {},
      card: { id: 'bear_1', name: 'Grizzly Bears', type_line: 'Creature — Bear', oracle_text: '', power: '2', toughness: '2', zone: 'battlefield' },
    });
    if (opts.mirrormind) {
      battlefield.push({
        id: 'crown_1',
        controller: p1,
        owner: p1,
        attachedTo: 'bear_1',
        tapped: false,
        counters: {},
        card: { id: 'crown_1', name: 'Mirrormind Crown', type_line: 'Artifact — Equipment', oracle_text: MIRROR_ORACLE, zone: 'battlefield' },
      });
    }
    if (opts.esix) {
      battlefield.push({
        id: 'esix_1',
        controller: p1,
        owner: p1,
        tapped: false,
        counters: {},
        card: { id: 'esix_1', name: 'Esix, Fractal Bloom', type_line: 'Legendary Creature — Fractal', oracle_text: ESIX_ORACLE, power: '4', toughness: '4', zone: 'battlefield' },
      });
    }
    (game.state as any).battlefield = battlefield;
  }

  it('auto-picks Esix when it is the only first-token replacement (no order prompt)', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    setup(game, 'p1', { esix: true });
    const { createToken } = await import('../src/state/modules/counters_tokens.js');
    const created = createToken({ state: game.state, bumpSeq: () => {}, gameId } as any, 'p1' as any, 'Soldier', 1, 1, 1, { colors: ['W'], typeLine: 'Token Creature — Soldier' }, false);
    expect(created).toEqual([]);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => s?.replacementOrderChoice === true)).toBe(false);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => s?.esixFirstTokensChoice === true)).toBe(true);
  });

  it('queues a CR 616.1 order prompt when Esix and Mirrormind both apply, and choosing Esix first queues the Esix copy choice', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    const p1 = 'p1';
    setup(game, p1, { esix: true, mirrormind: true });
    const { createToken } = await import('../src/state/modules/counters_tokens.js');
    createToken({ state: game.state, bumpSeq: () => {}, gameId } as any, p1 as any, 'Soldier', 2, 1, 1, { colors: ['W'], typeLine: 'Token Creature — Soldier' }, false);

    const order = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.replacementOrderChoice === true) as any;
    expect(order).toBeDefined();
    const effectIds = (order.replacementOrderCandidates || []).map((c: any) => c.effectId).sort();
    expect(effectIds).toEqual(['optional-copy-equipped-first-tokens-this-turn', 'optional-esix-first-tokens-this-turn'].sort());

    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    registerResolutionHandlers(createMockIo(emitted, [socket]), socket);
    const esixId = (order.replacementOrderCandidates || []).find((c: any) => c.effectId === 'optional-esix-first-tokens-this-turn').id;
    await handlers['submitResolutionResponse']({ gameId, stepId: order.id, selections: [esixId] });

    const esixStep = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.esixFirstTokensChoice === true) as any;
    expect(esixStep).toBeDefined();
    await handlers['submitResolutionResponse']({ gameId, stepId: esixStep.id, selections: ['bear_1'] });
    const tokens = ((game.state as any).battlefield || []).filter((p: any) => p?.isToken === true);
    expect(tokens.length).toBe(2);
    expect(tokens.every((t: any) => String(t.card?.name || '') === 'Grizzly Bears')).toBe(true);
  });

  it('lets Mirrormind apply first from the order prompt', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    const p1 = 'p1';
    setup(game, p1, { esix: true, mirrormind: true });
    const { createToken } = await import('../src/state/modules/counters_tokens.js');
    createToken({ state: game.state, bumpSeq: () => {}, gameId } as any, p1 as any, 'Soldier', 1, 1, 1, { colors: ['W'], typeLine: 'Token Creature — Soldier' }, false);

    const order = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.replacementOrderChoice === true) as any;
    expect(order).toBeDefined();
    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    registerResolutionHandlers(createMockIo(emitted, [socket]), socket);
    const crownId = (order.replacementOrderCandidates || []).find((c: any) => c.effectId === 'optional-copy-equipped-first-tokens-this-turn').id;
    await handlers['submitResolutionResponse']({ gameId, stepId: order.id, selections: [crownId] });

    const crownStep = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.mirrormindCrownTokenReplacementChoice === true) as any;
    expect(crownStep).toBeDefined();
    await handlers['submitResolutionResponse']({ gameId, stepId: crownStep.id, selections: ['replace'] });
    const tokens = ((game.state as any).battlefield || []).filter((p: any) => p?.isToken === true);
    expect(tokens.length).toBe(1);
    expect(tokens[0].card?.name).toBe('Grizzly Bears');
  });
});
