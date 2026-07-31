/**
 * Ashnod's Altar is a mana ability: after paying the sacrifice cost, mana is
 * added immediately and the ability must not go on the stack (CR 605).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createNoopIo() {
  return {
    to: () => ({ emit: () => {} }),
    emit: () => {},
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((s, idx) => [`s_${idx}`, s])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
    rooms: { has: () => true, add: () => {}, delete: () => {} } as any,
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

describe("Ashnod's Altar mana ability (no stack)", () => {
  const gameId = 'test_ashnods_altar_mana_no_stack';
  const playerId = 'p1';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
  });

  beforeEach(async () => {
    await resetGame(gameId);
    createGameIfNotExists(gameId, 'commander', 40);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('adds {C}{C} immediately after sacrifice and does not put the ability on the stack', async () => {
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'altar_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'altar_card',
          name: "Ashnod's Altar",
          type_line: 'Artifact',
          oracle_text: 'Sacrifice a creature: Add {C}{C}.',
        },
      },
      {
        id: 'bear_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        summoningSickness: false,
        isToken: true,
        card: {
          id: 'bear_card',
          name: 'Merfolk Token',
          type_line: 'Creature — Merfolk',
          oracle_text: '',
          power: '1',
          toughness: '1',
          isToken: true,
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: { hand: [], graveyard: [], library: [], exile: [] },
    };

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    const io = createMockIo(emitted, [socket]);

    registerResolutionHandlers(io as any, socket as any);
    registerInteractionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({
      gameId,
      permanentId: 'altar_1',
      abilityId: 'ability-0',
    });

    const sacStep = ResolutionQueueManager
      .getQueue(gameId)
      .steps
      .find((s: any) => s.sacrificeAbilityAsCost === true) as any;
    expect(sacStep).toBeDefined();

    emitted.length = 0;
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(sacStep.id),
      selections: ['bear_1'],
    });

    expect(((game.state as any).stack || [])).toHaveLength(0);
    expect(((game.state as any).manaPool?.[playerId]?.colorless) || 0).toBe(2);
    expect(((game.state as any).battlefield || []).map((p: any) => p.id)).not.toContain('bear_1');
  });
});
