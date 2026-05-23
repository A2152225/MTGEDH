import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => undefined }),
    emit: (_event: string, _payload: any) => undefined,
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

describe('suspend and morph prompt replay persistence', () => {
  const suspendGameId = 'test_suspend_cast_prompt_replay';
  const suspendReplayGameId = 'test_suspend_cast_prompt_replay_rehydrated';
  const morphGameId = 'test_morph_turn_face_up_prompt_replay';
  const morphReplayGameId = 'test_morph_turn_face_up_prompt_replay_rehydrated';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise(resolve => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(suspendGameId);
    await resetGame(suspendReplayGameId);
    await resetGame(morphGameId);
    await resetGame(morphReplayGameId);
  });

  afterEach(async () => {
    await resetGame(suspendGameId);
    await resetGame(suspendReplayGameId);
    await resetGame(morphGameId);
    await resetGame(morphReplayGameId);
  });

  it('persists suspendCard outcomes from suspend prompts and replays the suspended card move', async () => {
    createGameIfNotExists(suspendGameId, 'commander', 40);
    const game = ensureGame(suspendGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const riftBolt = {
      id: 'rift_bolt_1',
      name: 'Rift Bolt',
      type_line: 'Sorcery',
      oracle_text: 'Suspend 1-{R}',
      zone: 'hand',
    };

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).zones = {
      [p1]: {
        hand: [{ ...riftBolt }],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        libraryCount: 0,
      },
    };

    ResolutionQueueManager.addStep(suspendGameId, {
      type: ResolutionStepType.SUSPEND_CAST,
      playerId: p1 as any,
      description: 'Suspend Rift Bolt',
      mandatory: true,
      card: { ...riftBolt },
      suspendCost: '{R}',
      timeCounters: 1,
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(suspendGameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(suspendGameId);
    const step = queue.steps.find((entry: any) => entry.type === ResolutionStepType.SUSPEND_CAST);
    expect(step).toBeDefined();

    await handlers['submitResolutionResponse']({ gameId: suspendGameId, stepId: String((step as any).id) });

    const persisted = [...getEvents(suspendGameId)].reverse().find((event: any) => event.type === 'suspendCard') as any;
    expect(persisted).toBeDefined();
    expect(persisted.payload?.playerId).toBe(p1);
    expect(persisted.payload?.cardId).toBe('rift_bolt_1');
    expect(persisted.payload?.card).toMatchObject({
      id: 'rift_bolt_1',
      isSuspended: true,
      timeCounters: 1,
      suspendedBy: p1,
      zone: 'exile',
    });

    const replayGame = createInitialGameState(suspendReplayGameId);
    (replayGame.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (replayGame.state as any).zones = {
      [p1]: {
        hand: [{ ...riftBolt }],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        libraryCount: 0,
      },
    };

    replayGame.applyEvent({ type: 'suspendCard', ...(persisted.payload || {}) } as any);

    const replayZones = (replayGame.state as any).zones[p1];
    expect((replayZones.hand || []).some((card: any) => String(card?.id || '') === 'rift_bolt_1')).toBe(false);
    expect(replayZones.exile).toHaveLength(1);
    expect(replayZones.exile[0]).toMatchObject({
      id: 'rift_bolt_1',
      isSuspended: true,
      timeCounters: 1,
      suspendedBy: p1,
      zone: 'exile',
    });
  });

  it('persists morphTurnFaceUp outcomes from morph prompts and replays the face-up permanent state', async () => {
    createGameIfNotExists(morphGameId, 'commander', 40);
    const game = ensureGame(morphGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const actualCard = {
      id: 'willbender_card',
      name: 'Willbender',
      type_line: 'Creature - Human Wizard',
      power: '1',
      toughness: '2',
      zone: 'battlefield',
    };
    const faceDownPermanent = {
      id: 'willbender_perm',
      controller: p1,
      owner: p1,
      tapped: false,
      isFaceDown: true,
      faceDownType: 'morph',
      morphCost: '{1}{U}',
      canTurnFaceUp: true,
      basePower: 2,
      baseToughness: 2,
      card: {
        name: 'Face-down Creature',
        type_line: 'Creature',
        zone: 'battlefield',
        power: '2',
        toughness: '2',
      },
      faceUpCard: { ...actualCard },
    };

    (game.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).battlefield = [{ ...faceDownPermanent, faceUpCard: { ...actualCard }, card: { ...(faceDownPermanent.card as any) } }];

    ResolutionQueueManager.addStep(morphGameId, {
      type: ResolutionStepType.MORPH_TURN_FACE_UP,
      playerId: p1 as any,
      description: 'Turn Willbender face-up',
      mandatory: true,
      permanentId: 'willbender_perm',
      morphCost: '{1}{U}',
      actualCard: { ...actualCard },
      canAfford: true,
    } as any);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(morphGameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    const queue = ResolutionQueueManager.getQueue(morphGameId);
    const step = queue.steps.find((entry: any) => entry.type === ResolutionStepType.MORPH_TURN_FACE_UP);
    expect(step).toBeDefined();

    await handlers['submitResolutionResponse']({ gameId: morphGameId, stepId: String((step as any).id) });

    const persisted = [...getEvents(morphGameId)].reverse().find((event: any) => event.type === 'morphTurnFaceUp') as any;
    expect(persisted).toBeDefined();
    expect(persisted.payload?.playerId).toBe(p1);
    expect(persisted.payload?.permanentId).toBe('willbender_perm');
    expect(persisted.payload?.actualCard).toMatchObject({
      id: 'willbender_card',
      name: 'Willbender',
      type_line: 'Creature - Human Wizard',
      power: '1',
      toughness: '2',
      zone: 'battlefield',
    });

    const replayGame = createInitialGameState(morphReplayGameId);
    (replayGame.state as any).players = [{ id: p1, name: 'P1', spectator: false, life: 40 }];
    (replayGame.state as any).battlefield = [{ ...faceDownPermanent, faceUpCard: { ...actualCard }, card: { ...(faceDownPermanent.card as any) } }];

    replayGame.applyEvent({ type: 'morphTurnFaceUp', ...(persisted.payload || {}) } as any);

    const permanent = ((replayGame.state as any).battlefield || [])[0] as any;
    expect(permanent?.isFaceDown).toBe(false);
    expect(permanent?.card).toMatchObject({
      id: 'willbender_card',
      name: 'Willbender',
      type_line: 'Creature - Human Wizard',
      power: '1',
      toughness: '2',
      zone: 'battlefield',
    });
    expect(permanent?.basePower).toBe(1);
    expect(permanent?.baseToughness).toBe(2);
    expect(permanent?.faceDownType).toBeUndefined();
    expect(permanent?.morphCost).toBeUndefined();
    expect(permanent?.faceUpCard).toBeUndefined();
    expect(permanent?.canTurnFaceUp).toBeUndefined();
  });
});