import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import '../src/state/modules/priority.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>, gameId?: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;

  if (gameId) socket.rooms.add(gameId);
  return { socket, handlers };
}

describe('tap/untap follow-up prompt persistence', () => {
  const gameId = 'test_tap_untap_choice_persistence';
  const playerId = 'p1';

  async function resetGame(gameId: string) {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  }

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('persists the queued tap-or-untap decision after target selection', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).battlefield = [
      {
        id: 'target_perm_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: { id: 'target_card_1', name: 'Test Relic', type_line: 'Artifact', oracle_text: '' },
      },
    ];

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: playerId as any,
      description: 'Merrow Reejerey: Tap or untap target permanent',
      mandatory: true,
      sourceId: 'trigger_merrow_1',
      sourceName: 'Merrow Reejerey',
      validTargets: [
        {
          id: 'target_perm_1',
          label: 'Test Relic',
          description: 'Artifact',
        },
      ],
      targetTypes: ['permanent'],
      minTargets: 1,
      maxTargets: 1,
      action: 'tap_or_untap_target',
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    const targetStep = queue.steps.find((entry: any) => entry.type === 'target_selection') as any;
    expect(targetStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(targetStep.id),
      selections: ['target_perm_1'],
    });

    const queueAfter = ResolutionQueueManager.getQueue(gameId);
    const decisionStep = queueAfter.steps.find((entry: any) => (entry as any).action === 'tap_or_untap_decision') as any;
    expect(decisionStep).toBeDefined();
    expect(decisionStep.targetId).toBe('target_perm_1');

    const persistedEvent = [...getEvents(gameId)].reverse().find(
      (event: any) => event.type === 'targetSelectionTapUntapPrompt'
    ) as any;
    expect(persistedEvent?.payload?.queuedResolutionStep?.type).toBe('option_choice');
    expect(persistedEvent?.payload?.queuedResolutionStep?.action).toBe('tap_or_untap_decision');
    expect(persistedEvent?.payload?.queuedResolutionStep?.targetId).toBe('target_perm_1');
    expect(String(persistedEvent?.payload?.queuedResolutionStep?.id || '')).toBe(String(decisionStep.id || ''));
  });
});