import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { calculateMaxLandsPerTurn } from '../src/state/modules/game-state-effects.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const BROODSHIP_ORACLE =
  "Station (Tap another creature you control: Put charge counters equal to its power on this Spacecraft. Station only as a sorcery. It's an artifact creature at 8+.)\n" +
  '3+ | You may play an additional land on each of your turns.\n' +
  '8+ | Flying\n' +
  'Once during each of your turns, you may cast a permanent spell from your graveyard by sacrificing a land in addition to paying its other costs.';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ event: string; payload: any }>) {
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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('Station multi-threshold activated ability indexing (integration)', () => {
  const gameId = 'test_station_multi_threshold';

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

  it('blocks Exploration Broodship graveyard-cast ability when charge counters are below 8+', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'precombat_main';
    (game.state as any).battlefield = [
      {
        id: 'broodship_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: { charge: 7 },
        card: {
          id: 'broodship_card_1',
          name: 'Exploration Broodship',
          type_line: 'Artifact — Spacecraft',
          oracle_text: BROODSHIP_ORACLE,
        },
      },
    ];

    const emitted: Array<{ event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    registerInteractionHandlers(createNoopIo() as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'broodship_1',
      abilityId: 'broodship_1-ability-0',
    });

    const error = emitted.find((entry) => entry.event === 'error');
    expect(error?.payload?.code).toBe('ACTIVATION_CONDITION_NOT_MET');
    expect(String(error?.payload?.message || '')).toMatch(/8\+ charge counters/i);
  });

  it('does not block Exploration Broodship graveyard-cast ability when charge counters meet 8+', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).phase = 'precombat_main';
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'broodship_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: { charge: 8 },
        card: {
          id: 'broodship_card_1',
          name: 'Exploration Broodship',
          type_line: 'Artifact — Spacecraft',
          oracle_text: BROODSHIP_ORACLE,
        },
      },
    ];

    const emitted: Array<{ event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.rooms.add(gameId);
    registerInteractionHandlers(createNoopIo() as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'broodship_1',
      abilityId: 'broodship_1-ability-0',
    });

    const thresholdError = emitted.find(
      (entry) => entry.event === 'error' && entry.payload?.code === 'ACTIVATION_CONDITION_NOT_MET',
    );
    expect(thresholdError).toBeUndefined();
  });

  it('grants Exploration Broodship additional land plays only at 3+ charge counters', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const broodshipPermanent = {
      id: 'broodship_1',
      controller: playerId,
      owner: playerId,
      tapped: false,
      counters: { charge: 8 },
      card: {
        id: 'broodship_card_1',
        name: 'Exploration Broodship',
        type_line: 'Artifact — Spacecraft',
        oracle_text: BROODSHIP_ORACLE,
      },
    };

    const belowThresholdCtx = { state: { battlefield: [{ ...broodshipPermanent, counters: { charge: 2 } }] } } as any;
    expect(calculateMaxLandsPerTurn(belowThresholdCtx, playerId)).toBe(1);

    const atThresholdCtx = { state: { battlefield: [broodshipPermanent] } } as any;
    expect(calculateMaxLandsPerTurn(atThresholdCtx, playerId)).toBe(2);
  });
});
