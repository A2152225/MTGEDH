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

import { applyOnCastKeywordsAfterSpellStacked } from '../src/state/modules/onCastKeywordsAfterStack.js';
import { hasTwelfthDoctorDemonstrateGrant } from '../src/state/modules/twelfthDoctorDemonstrate.js';

const DOCTOR_ORACLE =
  'The first spell you cast from anywhere other than your hand each turn has demonstrate. (When you cast that spell, you may copy it. If you do, choose an opponent to also copy it. A copy of a permanent spell becomes a token.) Whenever you copy a spell, put a +1/+1 counter on The Twelfth Doctor.';

describe('The Twelfth Doctor grants demonstrate to the first off-hand spell each turn', () => {
  const tracked = new Set<string>();
  const createGameId = () => `test_twelfth_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => { await initDb(); });
  beforeEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });
  afterEach(async () => { for (const id of tracked) await resetGame(id); tracked.clear(); });

  function setup(game: any, p1: string, p2: string) {
    (game as any).gameId = game.id || game.gameId;
    (game.state as any).players = [
      { id: p1, name: 'P1', life: 40 },
      { id: p2, name: 'P2', life: 40 },
    ];
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).battlefield = [{
      id: 'doctor_1',
      controller: p1,
      owner: p1,
      card: { name: 'The Twelfth Doctor', type_line: 'Legendary Creature — Time Lord Doctor', oracle_text: DOCTOR_ORACLE, power: '4', toughness: '4' },
    }];
    (game.state as any).stack = [];
    expect(hasTwelfthDoctorDemonstrateGrant(game.state, p1)).toBe(true);
  }

  it('queues the existing demonstrate prompt when the first exile-cast spell is stacked, and accept copies for both players', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    const p1 = 'p1'; const p2 = 'p2';
    setup(game, p1, p2);

    const shock: any = {
      id: 'stack_shock_1',
      controller: p1,
      fromZone: 'exile',
      sourceZone: 'exile',
      card: { id: 'shock_1', name: 'Shock', type_line: 'Instant', oracle_text: 'Shock deals 2 damage to any target.', mana_cost: '{R}', colors: ['R'] },
    };
    (game.state as any).stack = [shock];
    applyOnCastKeywordsAfterSpellStacked({ game, gameId, playerId: p1, stackItem: shock });
    expect(shock.grantedDemonstrate).toBe(true);

    const step = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.demonstratePrompt === true) as any;
    expect(step).toBeDefined();
    expect(step.type).toBe('option_choice');
    expect(step.playerId).toBe(p1);
    expect((step.options || []).some((o: any) => o.id === 'opponent:p2')).toBe(true);

    const emitted: any[] = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    registerResolutionHandlers(createMockIo(emitted, [socket]), socket);
    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: ['opponent:p2'] });

    const stack = (game.state as any).stack || [];
    expect(stack.length).toBeGreaterThanOrEqual(3);
    expect(shock.demonstratePaid).toBe(true);
    expect(String(shock.demonstrateOpponentId)).toBe(p2);
  });

  it('does not grant demonstrate to a from-hand spell, or to a second off-hand spell the same turn', async () => {
    const gameId = createGameId(); tracked.add(gameId);
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId)!;
    const p1 = 'p1'; const p2 = 'p2';
    setup(game, p1, p2);

    const fromHand: any = {
      id: 'stack_bolt',
      controller: p1,
      fromZone: 'hand',
      card: { id: 'bolt_1', name: 'Lightning Bolt', type_line: 'Instant', oracle_text: 'Lightning Bolt deals 3 damage to any target.', mana_cost: '{R}' },
    };
    (game.state as any).stack = [fromHand];
    applyOnCastKeywordsAfterSpellStacked({ game, gameId, playerId: p1, stackItem: fromHand });
    expect(fromHand.grantedDemonstrate).not.toBe(true);
    expect(ResolutionQueueManager.getQueue(gameId).steps.some((s: any) => s?.demonstratePrompt === true)).toBe(false);

    const firstExile: any = {
      id: 'stack_shock_a',
      controller: p1,
      fromZone: 'exile',
      card: { id: 'shock_a', name: 'Shock', type_line: 'Instant', oracle_text: 'Shock deals 2 damage to any target.' },
    };
    (game.state as any).stack = [firstExile];
    applyOnCastKeywordsAfterSpellStacked({ game, gameId, playerId: p1, stackItem: firstExile });
    const firstStep = ResolutionQueueManager.getQueue(gameId).steps.find((s: any) => s?.demonstratePrompt === true) as any;
    expect(firstStep).toBeDefined();

    const secondExile: any = {
      id: 'stack_shock_b',
      controller: p1,
      fromZone: 'exile',
      card: { id: 'shock_b', name: 'Shock', type_line: 'Instant', oracle_text: 'Shock deals 2 damage to any target.' },
    };
    (game.state as any).stack = [firstExile, secondExile];
    applyOnCastKeywordsAfterSpellStacked({ game, gameId, playerId: p1, stackItem: secondExile });
    const demoSteps = ResolutionQueueManager.getQueue(gameId).steps.filter((s: any) => s?.demonstratePrompt === true);
    expect(demoSteps).toHaveLength(1);
    expect(secondExile.grantedDemonstrate).not.toBe(true);
  });
});
