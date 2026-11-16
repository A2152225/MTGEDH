import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerApplyOnServer.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';

const SQUIRREL = "As this creature enters, roll a six-sided die twice. Its base power becomes the first result and its base toughness becomes the second result.\nIf you would roll one or more six-sided dice, instead roll them and you may exchange one result with this creature's base power or base toughness.";

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


describe('Vedalken Squirrel-Whacker IR die-roll exchange hook', () => {
  const gameId = 'test_vedalken_squirrel_whacker_dice_exchange_ir';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  beforeEach(async () => { await resetGame(gameId); });
  afterEach(async () => { await resetGame(gameId); });

  it('queues the exchange OPTION_CHOICE after an IR roll_die step', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = gameId;
    const p1 = 'p1';
    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).battlefield = [{
      id: 'whacker_1',
      controller: p1,
      owner: p1,
      basePower: 2,
      baseToughness: 3,
      card: {
        name: 'Vedalken Squirrel-Whacker',
        type_line: 'Creature — Vedalken Guest',
        oracle_text: SQUIRREL,
        power: '2',
        toughness: '3',
      },
    }];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'roll_src_1',
      sourceName: 'Die Roll',
      dieRollResult: 6,
    });
    applyOracleIRStepsOnServer(
      game as any,
      game.state as any,
      [{ kind: 'roll_die', who: { kind: 'you' }, sides: 6, raw: 'roll a d6' } as any],
      irCtx,
      {},
      { controller: p1 },
    );

    expect(Number((game.state as any).lastDieRoll?.result)).toBe(6);
    const step = ResolutionQueueManager.getQueue(gameId).steps.find((queued: any) => queued?.diceExchangeBasePT === true) as any;
    expect(step).toBeDefined();
    expect(step.type).toBe('option_choice');

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(step.id),
      selections: ['exchange-power'],
    });

    const whacker = ((game.state as any).battlefield || []).find((permanent: any) => permanent.id === 'whacker_1');
    expect(Number(whacker.basePower)).toBe(6);
    expect(Number(whacker.baseToughness)).toBe(3);
    expect(Number((game.state as any).lastDieRoll?.result)).toBe(2);
  });
});
