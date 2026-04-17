import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { movePermanentToGraveyard } from '../src/state/modules/counters_tokens.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers, sanitizeStepForClient } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

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
      sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])),
    },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>, gameId: string) {
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
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function seedGame(gameId: string, playerId: string, opponentId: string) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  (game as any).gameId = gameId;
  (game.state as any).players = [
    { id: playerId, name: 'P1', spectator: false, life: 40, isAI: false },
    { id: opponentId, name: 'P2', spectator: false, life: 40, isAI: false },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
  (game.state as any).phase = 'main1';
  (game.state as any).step = 'MAIN1';
  (game.state as any).turnPlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).stack = [];
  (game.state as any).battlefield = [];
  (game.state as any).zones = {
    [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
    [opponentId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
  };

  return game;
}

describe('modular choice keyword automation (integration)', () => {
  const gameId = 'modular_choice_keyword_integration';
  const playerId = 'p1' as PlayerID;
  const opponentId = 'p2' as PlayerID;

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('queues a modular choice step from a death trigger using the dying permanent snapshot', () => {
    const game = seedGame(gameId, playerId, opponentId);
    const modularPermanent = {
      id: 'modular_source',
      controller: playerId,
      owner: playerId,
      power: 1,
      toughness: 1,
      counters: { '+1/+1': 3 },
      card: {
        id: 'modular_card',
        name: 'Arcbound Testling',
        type_line: 'Artifact Creature — Construct',
        oracle_text: 'Modular 1 (This creature enters the battlefield with a +1/+1 counter on it. When it dies, you may put its +1/+1 counters on target artifact creature.)',
        power: '1',
        toughness: '1',
      },
    };
    const artifactTarget = {
      id: 'artifact_target',
      controller: playerId,
      owner: playerId,
      power: 2,
      toughness: 2,
      counters: {},
      card: {
        id: 'artifact_target_card',
        name: 'Clockwork Friend',
        type_line: 'Artifact Creature — Construct',
        power: '2',
        toughness: '2',
      },
    };
    const nonArtifactTarget = {
      id: 'non_artifact_target',
      controller: playerId,
      owner: playerId,
      power: 2,
      toughness: 2,
      counters: {},
      card: {
        id: 'non_artifact_target_card',
        name: 'Bear Cub',
        type_line: 'Creature — Bear',
        power: '2',
        toughness: '2',
      },
    };

    (game.state as any).battlefield.push(modularPermanent, artifactTarget, nonArtifactTarget);

    expect(movePermanentToGraveyard(game as any, 'modular_source')).toBe(true);

    const pushEvent = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'pushTriggeredAbility') as any;
    expect(pushEvent?.payload?.sourcePermanentSnapshot?.id).toBe('modular_source');
    expect(pushEvent?.payload?.dyingCreature?.id).toBe('modular_source');

    expect(((game.state as any).stack || []).length).toBe(1);
    game.resolveTopOfStack();

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find(
      (entry: any) => entry?.type === ResolutionStepType.MODULAR_CHOICE
    ) as any;

    expect(step).toBeDefined();
    expect(step.value).toBe(3);
    expect(Array.isArray((game.state as any).pendingKeywordChoice) ? (game.state as any).pendingKeywordChoice : []).toHaveLength(0);
    expect((step.targets || []).map((target: any) => target.id)).toEqual(['artifact_target']);

    const sanitized = sanitizeStepForClient(gameId, step as any);
    expect(sanitized.type).toBe('modular_choice');
    expect(sanitized.value).toBe(3);
    expect((sanitized.targets || []).map((target: any) => target.id)).toEqual(['artifact_target']);
  });

  it('applies the selected modular target through submitResolutionResponse', async () => {
    const game = seedGame(gameId, playerId, opponentId);
    const modularPermanent = {
      id: 'modular_source',
      controller: playerId,
      owner: playerId,
      power: 1,
      toughness: 1,
      counters: { '+1/+1': 3 },
      card: {
        id: 'modular_card',
        name: 'Arcbound Testling',
        type_line: 'Artifact Creature — Construct',
        oracle_text: 'Modular 1 (This creature enters the battlefield with a +1/+1 counter on it. When it dies, you may put its +1/+1 counters on target artifact creature.)',
        power: '1',
        toughness: '1',
      },
    };
    const artifactTarget = {
      id: 'artifact_target',
      controller: playerId,
      owner: playerId,
      power: 2,
      toughness: 2,
      counters: {},
      card: {
        id: 'artifact_target_card',
        name: 'Clockwork Friend',
        type_line: 'Artifact Creature — Construct',
        power: '2',
        toughness: '2',
      },
    };

    (game.state as any).battlefield.push(modularPermanent, artifactTarget);

    expect(movePermanentToGraveyard(game as any, 'modular_source')).toBe(true);
    game.resolveTopOfStack();

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find(
      (entry: any) => entry?.type === ResolutionStepType.MODULAR_CHOICE
    ) as any;
    expect(step).toBeDefined();

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(step.id),
      selections: ['artifact_target'],
    });

    const updatedPermanent = ((game.state as any).battlefield || []).find((entry: any) => entry?.id === 'artifact_target');
    expect(updatedPermanent?.counters?.['+1/+1']).toBe(3);
    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
  });
});