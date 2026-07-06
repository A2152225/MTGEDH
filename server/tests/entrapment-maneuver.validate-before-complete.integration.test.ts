import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { games } from '../src/socket/socket.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => {
        // no-op
      },
    }),
    emit: (_event: string, _payload: any) => {
      // no-op
    },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((s, idx) => [`s_${idx}`, s])),
    },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>([gameId]),
    on: (ev: string, fn: Function) => {
      handlers[ev] = fn;
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
  await deleteGame(gameId);
}

describe('Entrapment Maneuver oracle IR sacrifice validate-before-complete (integration)', () => {
  const gameId = 'test_entrapment_maneuver_validate_before_complete';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('does not consume the sacrifice step on invalid selection, then resolves soldiers once valid', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const targetPlayerId = 'p1';
    const casterId = 'p2';

    (game.state as any).players = [
      { id: targetPlayerId, name: 'P1', spectator: false, life: 40 },
      { id: casterId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [targetPlayerId]: 40, [casterId]: 40 };

    const creatureId = 'atk1';
    (game.state as any).battlefield = [
      {
        id: creatureId,
        controller: targetPlayerId,
        owner: targetPlayerId,
        tapped: true,
        attacking: casterId,
        counters: {},
        card: {
          id: creatureId,
          name: 'Attacking Bear',
          type_line: 'Creature — Bear',
          power: '2',
          toughness: '2',
        },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const oracleText =
      "Target player sacrifices an attacking creature of their choice. You create X 1/1 white Soldier creature tokens, where X is that creature's toughness.";
    const steps = parseOracleTextToIR(oracleText, 'Entrapment Maneuver').abilities[0].steps;

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      steps,
      buildOracleIRExecutionContext({
        controllerId: casterId,
        sourceId: 'spell1',
        sourceName: 'Entrapment Maneuver',
        targetPlayerId,
        selectorContext: { targetPlayerId, chosenObjectIds: [targetPlayerId] },
      }),
      { allowOptional: true, haltOnPlayerChoiceRequired: true },
      { controller: casterId, sourceName: 'Entrapment Maneuver', sourceId: 'spell1' },
    );

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(targetPlayerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find(
      (entry: any) =>
        entry.type === ResolutionStepType.TARGET_SELECTION
        && String(entry.oracleIrChoiceStepJson || '').includes('sacrifice'),
    );
    expect(step).toBeDefined();

    const stepId = String((step as any).id);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId,
      selections: ['not_a_real_creature'],
    });

    const err = emitted.find((entry) => entry.event === 'error');
    expect(err?.payload?.code).toBe('INVALID_SELECTION');

    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfter.steps.some((entry: any) => String(entry.id) === stepId)).toBe(true);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId,
      selections: [creatureId],
    });

    const queueAfterOk = ResolutionQueueManager.getQueue(gameId);
    expect(queueAfterOk.steps.some((entry: any) => String(entry.id) === stepId)).toBe(false);

    const battlefieldAfter = (game.state as any).battlefield as any[];
    expect(battlefieldAfter.some((perm) => String(perm?.id) === creatureId)).toBe(false);

    const soldierTokens = battlefieldAfter.filter(
      (perm) => /soldier/i.test(String(perm?.card?.name || perm?.name || '')) && perm?.controller === casterId,
    );
    expect(soldierTokens.length).toBe(2);
  });
});
