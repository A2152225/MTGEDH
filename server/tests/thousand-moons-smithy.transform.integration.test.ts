import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';

const gameId = 'test_thousand_moons_smithy_transform';
const playerId = 'p1' as PlayerID;

const SMITHY_EFFECT =
  'you may tap five untapped artifacts and/or creatures you control. If you do, transform Thousand Moons Smithy.';

const SMITHY_CARD = {
  name: 'Thousand Moons Smithy',
  layout: 'transform',
  type_line: 'Legendary Artifact',
  card_faces: [
    {
      name: 'Thousand Moons Smithy',
      type_line: 'Legendary Artifact',
    },
    {
      name: 'Barracks of the Thousand Moons',
      type_line: 'Legendary Artifact',
    },
  ],
};

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => undefined,
    }),
    emit: (_event: string, _payload: any) => undefined,
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])),
    },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;
  return { socket, handlers };
}

async function resetGame() {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try {
    await deleteGame(gameId);
  } catch {
    // test-only cleanup
  }
}

function setupSmithyBattlefield(game: any, tapTargetIds: string[]) {
  (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
  (game.state as any).battlefield = [
    {
      id: 'smithy_perm',
      controller: playerId,
      owner: playerId,
      tapped: false,
      transformed: false,
      card: { ...SMITHY_CARD },
    },
    ...tapTargetIds.map((id, index) => ({
      id,
      controller: playerId,
      owner: playerId,
      tapped: false,
      card: {
        id: `${id}_card`,
        name: `Sol Ring ${index + 1}`,
        type_line: 'Artifact',
      },
    })),
  ];
}

describe('Thousand Moons Smithy transform trigger resolution', () => {
  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
    await resetGame();
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    await resetGame();
  });

  it('transforms after accepting the trigger and tapping five artifacts/creatures', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    (game as any).gameId = gameId;
    games.set(gameId as any, game as any);

    const tapTargets = ['t1', 't2', 't3', 't4', 't5'];
    setupSmithyBattlefield(game, tapTargets);

    executeTriggerEffect(
      game as any,
      playerId,
      'Thousand Moons Smithy',
      SMITHY_EFFECT,
      {
        id: 'trigger-smithy',
        source: 'smithy_perm',
        permanentId: 'smithy_perm',
        mandatory: false,
        optionalTriggeredAbilityDecisionApplied: true,
      },
    );

    const tapStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (step) => step.type === ResolutionStepType.TAP_UNTAP_TARGET,
    );
    expect(tapStep).toBeDefined();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((tapStep as any).id),
      selections: { targetIds: tapTargets },
      cancelled: false,
    });

    const smithy = ((game.state as any).battlefield || []).find((perm: any) => perm?.id === 'smithy_perm');
    expect(smithy?.transformed).toBe(true);
    expect(String(smithy?.card?.name || '')).toBe('Barracks of the Thousand Moons');

    for (const targetId of tapTargets) {
      const permanent = ((game.state as any).battlefield || []).find((perm: any) => perm?.id === targetId);
      expect(permanent?.tapped).toBe(true);
    }

    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  });
});
