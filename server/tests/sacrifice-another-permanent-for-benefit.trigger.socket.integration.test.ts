import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const irPrimaryGameId = 'test_sacrifice_benefit_trigger_socket_ir_primary';
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

function createMockSocket(pid: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId: pid, spectator: false, gameId },
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

describe('sacrifice another permanent for benefit trigger socket (Layer 3 IR primary)', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
    await resetGame(irPrimaryGameId);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    await resetGame(irPrimaryGameId);
  });

  it('executeTriggerEffect queues Effect Program may-choice and declining skips the sacrifice', async () => {
    createGameIfNotExists(irPrimaryGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(irPrimaryGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(irPrimaryGameId as any, game as any);

    (game as any).gameId = irPrimaryGameId;
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).battlefield = [
      {
        id: 'source_perm',
        controller: playerId,
        owner: playerId,
        card: { name: 'Source Walker', type_line: 'Creature' },
      },
      {
        id: 'other_perm',
        controller: playerId,
        owner: playerId,
        card: { name: 'Treasure Token', type_line: 'Artifact' },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        library: [{ id: 'lib_1', name: 'Library Top', type_line: 'Instant' }],
        libraryCount: 1,
      },
    };
    (game.state as any).players[0].library = [{ id: 'lib_1', name: 'Library Top', type_line: 'Instant' }];
    (game as any).libraries = new Map([[playerId, [{ id: 'lib_1', name: 'Library Top', type_line: 'Instant' }]]]);

    executeTriggerEffect(
      game as any,
      playerId,
      'Source Walker',
      'You may sacrifice another permanent. If you do, you gain three life and draw a card.',
      { id: 'trigger-1', source: 'source_perm' },
    );

    const choiceStep = ResolutionQueueManager.getQueue(irPrimaryGameId).steps.find(
      (step) => step.type === ResolutionStepType.OPTION_CHOICE,
    ) as any;
    expect(choiceStep).toBeTruthy();
    expect(choiceStep.mandatory).toBe(false);
    expect(choiceStep.effectProgramPrompt).toBe(true);
    expect(choiceStep.sacrificeAnotherPermanentForBenefitChoice).not.toBe(true);
    expect(String(choiceStep.description || '').toLowerCase()).toContain('sacrifice another permanent');
    expect((choiceStep.options || choiceStep.choiceEvent?.options || []).map((option: any) => option.id)).toEqual(
      expect.arrayContaining(['yes', 'no']),
    );

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, irPrimaryGameId, emitted);
    registerResolutionHandlers(createMockIo(emitted, [socket]) as any, socket as any);

    await handlers.submitResolutionResponse({
      gameId: irPrimaryGameId,
      stepId: String(choiceStep!.id),
      selections: 'no',
      cancelled: false,
    });

    expect(((game.state as any).battlefield || []).map((permanent: any) => permanent.id)).toEqual(['source_perm', 'other_perm']);
    expect((game.state as any).life[playerId]).toBe(40);
    expect(ResolutionQueueManager.getQueue(irPrimaryGameId).steps).toHaveLength(0);
  }, 20000);
});
