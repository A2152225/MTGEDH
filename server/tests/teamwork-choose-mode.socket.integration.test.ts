import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { requestCastSpellForSocket } from '../src/socket/game-actions.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const GO_NUTS_ORACLE =
  'Teamwork 3 (As an additional cost to cast this spell, you may tap any number of creatures you control with total power 3 or more.)\n' +
  'Choose one. If this spell was cast using teamwork, choose both instead.\n' +
  '• Draw three cards.\n' +
  '• Go Nuts! deals 3 damage to each opponent.';

function buildGoNutsCard() {
  return {
    id: 'go_nuts_raw',
    name: 'Go Nuts!',
    type_line: 'Sorcery',
    mana_cost: '{2}{R}',
    cmc: 3,
    oracle_text: GO_NUTS_ORACLE,
    colors: ['R'],
    color_identity: ['R'],
  };
}

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

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try {
    await deleteGame(gameId);
  } catch {
    // test-only cleanup
  }
}

function seedTeamworkCastGame(gameId: string, playerId: string) {
  createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');
  games.set(gameId as any, game as any);

  Object.assign(game.state as any, {
    id: gameId,
    players: [
      { id: playerId, name: 'P1', spectator: false, life: 40, isAI: false },
      { id: 'p2', name: 'P2', spectator: false, life: 40, isAI: false },
    ],
    startingLife: 40,
    life: { [playerId]: 40, p2: 40 },
    phase: 'main1',
    step: 'MAIN1',
    turnPlayer: playerId,
    activePlayer: playerId,
    turnNumber: 3,
    priority: playerId,
    stack: [],
    battlefield: [
      {
        id: 'creature_a',
        controller: playerId,
        owner: playerId,
        tapped: false,
        basePower: 2,
        baseToughness: 2,
        card: { id: 'c_a', name: 'Bear A', type_line: 'Creature — Bear', power: '2', toughness: '2' },
      },
      {
        id: 'creature_b',
        controller: playerId,
        owner: playerId,
        tapped: false,
        basePower: 2,
        baseToughness: 2,
        card: { id: 'c_b', name: 'Bear B', type_line: 'Creature — Bear', power: '2', toughness: '2' },
      },
    ],
    manaPool: {
      [playerId]: { W: 0, U: 0, B: 0, R: 3, G: 0, C: 0, white: 0, blue: 0, black: 0, red: 3, green: 0, colorless: 0 },
      p2: { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    },
    zones: {
      [playerId]: {
        hand: [buildGoNutsCard()],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [{ id: 'lib_1', name: 'Island', type_line: 'Basic Land — Island' }],
        libraryCount: 1,
      },
      p2: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    },
  });

  return game;
}

async function completeTeamworkCastFlow(
  gameId: string,
  playerId: string,
  handlers: Record<string, Function>,
  io: any,
  socket: any,
  teamworkCreatureIds: string[] | null,
) {
  await requestCastSpellForSocket(io, socket, { gameId, cardId: 'go_nuts_raw' });

  let teamworkStep = ResolutionQueueManager
    .getStepsForPlayer(gameId, playerId as any)
    .find((step: any) => step.type === ResolutionStepType.ADDITIONAL_COST_PAYMENT && step.costType === 'teamwork') as any;

  if (teamworkStep) {
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(teamworkStep.id),
      selections: teamworkCreatureIds ?? [],
      cancelled: teamworkCreatureIds === null,
    });
  }

  const paymentStep = ResolutionQueueManager
    .getStepsForPlayer(gameId, playerId as any)
    .find((step: any) => step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.spellPaymentRequired === true) as any;

  if (paymentStep) {
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(paymentStep.id),
      selections: { payment: [] },
      cancelled: false,
    });
  }
}

describe('teamwork choose-both socket integration', () => {
  const gameId = 'test_teamwork_choose_mode_socket';
  const playerId = 'p1';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('queues MODE_SELECTION with maxModes=2 after paying teamwork and resolving the spell', async () => {
    const game = seedTeamworkCastGame(gameId, playerId);
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await completeTeamworkCastFlow(gameId, playerId, handlers, io, socket, ['creature_a', 'creature_b']);

    const stackItem = ((game.state as any).stack || [])[0] as any;
    expect(stackItem).toBeTruthy();
    expect(stackItem.teamworkWasPaid).toBe(true);

    game.resolveTopOfStack();

    const modeStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId as any)
      .find((step: any) => step.type === ResolutionStepType.MODE_SELECTION) as any;
    expect(modeStep).toBeTruthy();
    expect(Number(modeStep.maxModes)).toBe(2);
    expect(modeStep.teamworkChooseBoth).toBe(true);
    expect(modeStep.teamworkWasPaid).toBe(true);
  }, 15000);

  it('queues MODE_SELECTION with maxModes=1 when teamwork is declined', async () => {
    const game = seedTeamworkCastGame(gameId, playerId);
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await completeTeamworkCastFlow(gameId, playerId, handlers, io, socket, []);

    const stackItem = ((game.state as any).stack || [])[0] as any;
    expect(stackItem).toBeTruthy();
    expect(stackItem.teamworkWasPaid).toBe(false);

    game.resolveTopOfStack();

    const modeStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId as any)
      .find((step: any) => step.type === ResolutionStepType.MODE_SELECTION) as any;
    expect(modeStep).toBeTruthy();
    expect(Number(modeStep.maxModes)).toBe(1);
  });
});

describe('teamwork choose-both spell IR primary (Effect Program)', () => {
  const gameId = 'test_teamwork_choose_mode_spell_primary';
  const playerId = 'p1';
  const previousPrimary = process.env.ORACLE_IR_SPELL_PRIMARY;

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    await resetGame(gameId);
  });

  afterEach(async () => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_SPELL_PRIMARY;
    } else {
      process.env.ORACLE_IR_SPELL_PRIMARY = previousPrimary;
    }
    await resetGame(gameId);
  });

  it('queues Effect Program MODE_SELECTION with maxModes=2 when teamworkWasPaid', async () => {
    const game = seedTeamworkCastGame(gameId, playerId);
    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await completeTeamworkCastFlow(gameId, playerId, handlers, io, socket, ['creature_a', 'creature_b']);

    const stackItem = ((game.state as any).stack || [])[0] as any;
    expect(stackItem).toBeTruthy();
    expect(stackItem.teamworkWasPaid).toBe(true);

    game.resolveTopOfStack();

    const modeStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId as any)
      .find((step: any) => step.type === ResolutionStepType.MODE_SELECTION) as any;
    expect(modeStep).toBeTruthy();
    expect(modeStep.effectProgramPrompt).toBe(true);
    expect(Number(modeStep.maxModes)).toBe(2);
    expect(modeStep.teamworkChooseBoth).toBe(true);
    expect(modeStep.teamworkWasPaid).toBe(true);
    expect(((game.state as any).stack || []).length).toBeGreaterThan(0);
  }, 15000);
});
