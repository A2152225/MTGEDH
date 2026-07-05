import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const irPrimaryGameId = 'test_optional_discard_trigger_socket_ir_primary';
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

describe('optional discard-then-draw trigger socket (Layer 3 IR primary)', () => {
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

  it('executeTriggerEffect queues IR option_choice and submitResolutionResponse declines cleanly', async () => {
    createGameIfNotExists(irPrimaryGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(irPrimaryGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(irPrimaryGameId as any, game as any);

    (game as any).gameId = irPrimaryGameId;
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [playerId]: {
        hand: [{ id: 'card_1', name: 'Card One', type_line: 'Instant' }],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        libraryCount: 1,
      },
    };
    const player = (game.state as any).players[0];
    player.library = [{ id: 'lib_1', name: 'Library Top', type_line: 'Instant', zone: 'library' }];
    (game as any).libraries = new Map([[playerId, [{ id: 'lib_1', name: 'Library Top', type_line: 'Instant' }]]]);

    executeTriggerEffect(
      game as any,
      playerId,
      'Rummage Source',
      'You may discard a card. If you do, draw a card.',
      { id: 'trigger-1', source: 'source-1' },
    );

    const choiceStep = ResolutionQueueManager.getQueue(irPrimaryGameId).steps.find(
      (step) => step.type === ResolutionStepType.OPTION_CHOICE,
    ) as any;
    expect(choiceStep).toBeTruthy();
    expect(choiceStep.mandatory).toBe(false);
    expect(String(choiceStep.description || '').toLowerCase()).toContain('discard');
    expect((choiceStep.options || choiceStep.choiceEvent?.options || []).map((option: any) => option.id)).toEqual(
      expect.arrayContaining(['yes', 'no']),
    );
    expect(choiceStep.optionalDiscardThenDrawChoice).not.toBe(true);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, irPrimaryGameId, emitted);
    registerResolutionHandlers(createMockIo(emitted, [socket]) as any, socket as any);

    await handlers.submitResolutionResponse({
      gameId: irPrimaryGameId,
      stepId: String(choiceStep!.id),
      selections: 'no',
      cancelled: false,
    });

    expect(((game.state as any).zones[playerId].hand || []).map((card: any) => card.id)).toEqual(['card_1']);
    expect(ResolutionQueueManager.getQueue(irPrimaryGameId).steps).toHaveLength(0);
  }, 20000);
});
