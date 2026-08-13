import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { startOracleEffectProgramOnServer } from '../src/state/modules/oracleIrEffectProgramServer.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const modalSteps = [
  {
    kind: 'choose_mode',
    minModes: 1,
    maxModes: 1,
    modes: [
      {
        label: 'Draw',
        raw: 'Draw a card.',
        steps: [
          {
            kind: 'draw',
            who: { kind: 'you' },
            amount: { kind: 'number', value: 1 },
            raw: 'Draw a card.',
          },
        ],
      },
      {
        label: 'Gain',
        raw: 'You gain 2 life.',
        steps: [
          {
            kind: 'gain_life',
            who: { kind: 'you' },
            amount: { kind: 'number', value: 2 },
            raw: 'You gain 2 life.',
          },
        ],
      },
    ],
    raw: 'Choose one — Draw a card. You gain 2 life.',
  },
] as const;

const gameId = 'test_oracle_ir_choose_mode_ep_socket';
const playerId = 'p1' as PlayerID;

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

async function resetGame(targetGameId: string) {
  ResolutionQueueManager.removeQueue(targetGameId);
  games.delete(targetGameId as any);
  try {
    await deleteGame(targetGameId);
  } catch {
    // test-only cleanup
  }
}

describe('oracle IR choose_mode Effect Program socket submit resume (Layer 3)', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;
    await resetGame(gameId);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    delete process.env.ORACLE_IR_SPELL_LEGACY;
    await resetGame(gameId);
  });

  it('submitResolutionResponse completes draw mode through Effect Program MODE_SELECTION', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId) ?? createInitialGameState(gameId);
    games.set(gameId as any, game as any);

    (game as any).gameId = gameId;
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 1 },
    };
    const player = (game.state as any).players.find((entry: any) => entry.id === playerId);
    player.library = [{ id: 'drawn-card', name: 'Drawn Card', zone: 'library' }];
    (game as any).libraries = new Map([[playerId, player.library.map((card: any) => ({ ...card }))]]);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: 'modal-spell-socket-1',
      sourceName: 'Modal Spell',
      sourceObjectType: 'spell',
    });

    const started = startOracleEffectProgramOnServer(game as any, {
      controller: playerId,
      sourceName: 'Modal Spell',
      sourceId: 'modal-spell-socket-1',
      steps: modalSteps as any,
      irCtx,
      executionOptions: { allowOptional: true },
      programIdPrefix: 'spell:modal-spell-socket-1',
      metadata: { family: 'spell_resolution' },
    });
    expect(started.handled).toBe(true);

    const modeStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId)
      .find((step) => step.type === ResolutionStepType.MODE_SELECTION);
    expect(modeStep).toBeTruthy();
    expect((modeStep as any)?.effectProgramPrompt).toBe(true);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    registerResolutionHandlers(createMockIo(emitted, [socket]) as any, socket as any);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(modeStep!.id),
      selections: [{ id: 'Draw', label: 'Draw' }],
      cancelled: false,
    });

    const handIds = ((game.state as any).zones?.[playerId]?.hand || player.hand || [])
      .map((card: any) => card.id);
    expect(handIds).toEqual(['drawn-card']);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  }, 20000);

  it('queues Season {P} budget on Effect Program MODE_SELECTION', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId) ?? createInitialGameState(gameId);
    games.set(gameId as any, game as any);
    (game as any).gameId = gameId;
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = { [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, libraryCount: 0 } };

    const irCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: 'season-gathering-1',
      sourceName: 'Season of Gathering',
      sourceObjectType: 'spell',
    });

    const started = startOracleEffectProgramOnServer(game as any, {
      controller: playerId,
      sourceName: 'Season of Gathering',
      sourceId: 'season-gathering-1',
      steps: [
        {
          kind: 'choose_mode',
          minModes: 0,
          maxModes: 5,
          canRepeatModes: true,
          pBudget: 5,
          modes: [
            { label: 'Mode 1', raw: '{P} — Draw a card.', pCost: 1, steps: [{ kind: 'draw', who: { kind: 'you' }, amount: { kind: 'number', value: 1 }, raw: 'Draw a card.' }] },
            { label: 'Mode 2', raw: '{P}{P} — You gain 2 life.', pCost: 2, steps: [{ kind: 'gain_life', who: { kind: 'you' }, amount: { kind: 'number', value: 2 }, raw: 'You gain 2 life.' }] },
            { label: 'Mode 3', raw: '{P}{P}{P} — You gain 5 life.', pCost: 3, steps: [{ kind: 'gain_life', who: { kind: 'you' }, amount: { kind: 'number', value: 5 }, raw: 'You gain 5 life.' }] },
          ],
          raw: 'Choose up to five {P} worth of modes.',
        } as any,
      ],
      irCtx,
      executionOptions: { allowOptional: true },
      programIdPrefix: 'spell:season-gathering-1',
      metadata: { family: 'spell_resolution' },
    });
    expect(started.handled).toBe(true);

    const modeStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId)
      .find((step) => step.type === ResolutionStepType.MODE_SELECTION) as any;
    expect(modeStep).toBeTruthy();
    expect(modeStep.pBudget).toBe(5);
    expect(modeStep.canRepeatModes).toBe(true);
    expect(modeStep.allowDuplicates).toBe(true);
    expect(modeStep.modes.map((mode: any) => mode.pCost)).toEqual([1, 2, 3]);
  }, 20000);
});
