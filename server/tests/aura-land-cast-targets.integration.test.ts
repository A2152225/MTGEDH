import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { ResolutionStepType } from '../src/state/resolution/types.js';
import '../src/state/modules/priority.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ event: string; payload: any }>, gameId: string) {
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

describe('requestCastSpell Aura land targeting', () => {
  const gameId = 'test_aura_land_cast_targets';
  const playerId = 'p1';

  async function resetGame() {
    ResolutionQueueManager.removeQueue(gameId);
    games.delete(gameId as any);
    await deleteGame(gameId);
  }

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame();
  });

  afterEach(async () => {
    await resetGame();
  });

  it('queues Enchant land Aura targeting with min/max 1 so hosts are selectable', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).priority = playerId;
    (game.state as any).turnPlayer = playerId;
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'forest_1',
        controller: playerId,
        owner: playerId,
        card: {
          id: 'forest_card',
          name: 'Forest',
          type_line: 'Basic Land — Forest',
          oracle_text: '{T}: Add {G}.',
        },
      },
    ];
    (game.state as any).zones = {
      [playerId]: {
        hand: [{
          id: 'fertile_1',
          name: "Fertile Ground",
          type_line: 'Enchantment — Aura',
          mana_cost: '{1}{G}',
          oracle_text:
            'Enchant land\nWhenever enchanted land is tapped for mana, its controller adds one mana of any color.',
        }],
        handCount: 1,
        library: [],
        libraryCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
      },
    };

    const emitted: Array<{ event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    registerGameActions(createNoopIo() as any, socket);

    await handlers['requestCastSpell']({ gameId, cardId: 'fertile_1' });

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, playerId as any);
    const targetStep = steps.find((step: any) => step.type === ResolutionStepType.TARGET_SELECTION);
    expect(targetStep).toBeTruthy();
    expect(targetStep?.minTargets).toBe(1);
    expect(targetStep?.maxTargets).toBe(1);
    expect(String((targetStep as any)?.targetDescription || '')).toMatch(/enchant land/i);
    expect((targetStep as any)?.targetTypes).toEqual(['aura_target']);

    const validIds = ((targetStep as any)?.validTargets || []).map((t: any) => String(t.id));
    expect(validIds).toContain('forest_1');
    const forestTarget = ((targetStep as any)?.validTargets || []).find((t: any) => t.id === 'forest_1');
    expect(String(forestTarget?.typeLine || '').toLowerCase()).toContain('land');
  });
});
