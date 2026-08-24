import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import '../src/state/modules/priority.js';

const throneOracle =
  'Ward {2}\n' +
  'As this creature enters, choose a creature type.\n' +
  'This creature is the chosen type in addition to its other types.\n' +
  'If a triggered ability of another creature you control of the chosen type triggers, it triggers an additional time.';

const kumenaOracle =
  '{T}: Put a +1/+1 counter on target Merfolk you control.\n' +
  '{T}: Tap three untapped Merfolk you control. Draw a card.';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
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
  await deleteGame(gameId);
}

function seedTribalBoard(game: any, playerId: PlayerID) {
  (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
  (game.state as any).turnPlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).phase = 'main';
  (game.state as any).step = 'precombat_main';
  (game.state as any).battlefield = [
    {
      id: 'kumena_1',
      controller: playerId,
      owner: playerId,
      tapped: false,
      summoningSickness: false,
      counters: {},
      card: {
        id: 'kumena_card',
        name: 'Kumena, Tyrant of Orazca',
        type_line: 'Legendary Creature — Merfolk Druid',
        oracle_text: kumenaOracle,
      },
    },
    {
      id: 'roaming_throne_1',
      controller: playerId,
      owner: playerId,
      chosenCreatureType: 'Merfolk',
      tapped: false,
      counters: {},
      card: {
        id: 'throne_card',
        name: 'Roaming Throne',
        type_line: 'Artifact Creature — Golem',
        oracle_text: throneOracle,
      },
    },
    {
      id: 'soldier_1',
      controller: playerId,
      owner: playerId,
      tapped: false,
      counters: {},
      card: {
        id: 'soldier_card',
        name: 'Soldier Token',
        type_line: 'Creature — Soldier',
        oracle_text: '',
      },
    },
  ];
  (game.state as any).zones = {
    [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0 },
  };
}

describe('Roaming Throne + Kumena tribal socket integration', () => {
  const gameId = 'roaming_throne_kumena_tribal_socket';
  const playerId = 'p1' as PlayerID;

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler({
      to: () => ({ emit: () => undefined }),
      emit: () => undefined,
      sockets: { sockets: new Map() },
    } as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    seedTribalBoard(game, playerId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('lets Kumena +1/+1 target Roaming Throne when throne chose Merfolk', async () => {
    const game = ensureGame(gameId)!;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers.activateBattlefieldAbility({
      gameId,
      permanentId: 'kumena_1',
      abilityId: 'kumena_1-ability-0',
    });

    const counterStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId)
      .find((step) => step.type === ResolutionStepType.COUNTER_TARGET);
    expect(counterStep).toBeTruthy();

    const validTargetIds = ((counterStep as any)?.validTargets || []).map((entry: any) => entry.id);
    expect(validTargetIds).toContain('roaming_throne_1');

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(counterStep!.id),
      selections: ['roaming_throne_1'],
      cancelled: false,
    });

    const refreshed = games.get(gameId)!;
    // COUNTER_TARGET puts the add-counter ability on the stack so opponents can
    // respond (see gwafa-bribery-counter). Solo tests still need to resolve it.
    refreshed.resolveTopOfStack();
    const throne = refreshed.state.battlefield.find((perm: any) => perm.id === 'roaming_throne_1');
    expect(throne?.counters?.['+1+1']).toBe(1);
    expect(refreshed.state.battlefield.find((perm: any) => perm.id === 'kumena_1')?.tapped).toBe(true);
  });
});
