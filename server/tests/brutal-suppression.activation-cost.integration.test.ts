import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

const BRUTAL = 'Activated abilities of nontoken Rebels cost an additional "Sacrifice a land" to activate.';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>(),
    on: (event: string, fn: Function) => { handlers[event] = fn; },
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
  } as any;
  return { socket, handlers };
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('Brutal Suppression additional sacrifice-a-land activation cost', () => {
  const gameId = 'test_brutal_suppression_activation_cost';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  beforeEach(async () => { await resetGame(gameId); });
  afterEach(async () => { await resetGame(gameId); });

  it('queues the existing sacrifice-a-land prompt for a nontoken Rebel activation', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).step = 'MAIN1';
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'suppression_1',
        controller: p1,
        owner: p1,
        card: { name: 'Brutal Suppression', type_line: 'Enchantment', oracle_text: BRUTAL },
      },
      {
        id: 'rebel_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: {
          name: 'Defiant Rebel',
          type_line: 'Creature — Human Rebel',
          oracle_text: '{T}: Draw a card.',
        },
      },
      {
        id: 'land_1',
        controller: p1,
        owner: p1,
        tapped: false,
        card: { name: 'Forest', type_line: 'Basic Land — Forest' },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'rebel_1', abilityId: 'rebel_1-ability-0' });

    const error = emitted.find((entry) => entry.event === 'error');
    expect(error).toBeUndefined();
    const sacStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step?.sacrificeAbilityAsCost === true || String(step?.sacrificeType || '') === 'land'
    ) as any;
    expect(sacStep).toBeDefined();
    expect(String(sacStep.sacrificeType || '')).toBe('land');
    const targetIds = (sacStep.availableTargets || sacStep.validTargets || []).map((target: any) => String(target.id || target));
    expect(targetIds).toContain('land_1');
    expect(((game.state as any).stack || []).length).toBe(0);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(sacStep.id),
      selections: ['land_1'],
    });

    expect(((game.state as any).stack || []).length).toBe(1);
    const lands = ((game.state as any).battlefield || []).filter((permanent: any) => String(permanent.id) === 'land_1');
    expect(lands).toHaveLength(0);
  });

  it('does not add the extra cost when the Rebel is a token', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = p1;
    (game.state as any).priority = p1;
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'suppression_1',
        controller: p1,
        owner: p1,
        card: { name: 'Brutal Suppression', type_line: 'Enchantment', oracle_text: BRUTAL },
      },
      {
        id: 'rebel_token_1',
        controller: p1,
        owner: p1,
        tapped: false,
        isToken: true,
        token: true,
        card: {
          name: 'Rebel Token',
          type_line: 'Creature — Human Rebel',
          oracle_text: '{T}: Draw a card.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'rebel_token_1', abilityId: 'rebel_token_1-ability-0' });

    const sacStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step?.sacrificeAbilityAsCost === true || String(step?.sacrificeType || '') === 'land'
    );
    expect(sacStep).toBeUndefined();
    expect(((game.state as any).stack || []).length).toBe(1);
  });
});
