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
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>, gameId?: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>(),
    on: (event: string, fn: Function) => { handlers[event] = fn; },
    emit: (event: string, payload: any) => { emitted.push({ event, payload }); },
  } as any;
  if (gameId) socket.rooms.add(gameId);
  return { socket, handlers };
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}


describe('Brutal Suppression additional land sacrifice follow-up', () => {
  const gameId = 'test_brutal_suppression_additional_land_followup';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  beforeEach(async () => { await resetGame(gameId); });
  afterEach(async () => { await resetGame(gameId); });

  it('queues a second sacrifice-a-land prompt after a printed creature sacrifice is paid', async () => {
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
          name: 'Defiant Recruiter',
          type_line: 'Creature — Human Rebel',
          oracle_text: 'Sacrifice a creature: Draw a card.',
        },
      },
      {
        id: 'goat_1',
        controller: p1,
        owner: p1,
        card: { name: 'Goat', type_line: 'Creature — Goat' },
      },
      {
        id: 'land_1',
        controller: p1,
        owner: p1,
        card: { name: 'Forest', type_line: 'Basic Land — Forest' },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'rebel_1', abilityId: 'rebel_1-ability-0' });

    const error = emitted.find((entry) => entry.event === 'error');
    expect(error).toBeUndefined();
    const firstStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step?.sacrificeAbilityAsCost === true
    ) as any;
    expect(firstStep).toBeDefined();
    expect(String(firstStep.sacrificeType || '')).toBe('creature');
    expect(firstStep.additionalLandSacrifice).toBe(true);
    expect(((game.state as any).stack || []).length).toBe(0);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(firstStep.id),
      selections: ['goat_1'],
    });

    expect(((game.state as any).battlefield || []).some((permanent: any) => permanent.id === 'goat_1')).toBe(false);
    expect(((game.state as any).stack || []).length).toBe(0);

    const landStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step?.sacrificeAbilityAsCost === true && String(step?.sacrificeType || '') === 'land'
    ) as any;
    expect(landStep).toBeDefined();
    const landIds = (landStep.validTargets || landStep.availableTargets || []).map((target: any) => String(target.id || target));
    expect(landIds).toContain('land_1');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(landStep.id),
      selections: ['land_1'],
    });

    expect(((game.state as any).battlefield || []).some((permanent: any) => permanent.id === 'land_1')).toBe(false);
    expect(((game.state as any).stack || []).length).toBe(1);
  });
});
