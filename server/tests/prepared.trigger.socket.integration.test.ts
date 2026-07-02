import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

function buildPreparedConditionalCard(frontName: string, frontOracleText: string) {
  return {
    id: `${frontName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_raw`,
    name: `${frontName} // Study Break`,
    layout: 'prepare',
    mana_cost: '{2}{U} // {1}{U}',
    type_line: 'Creature — Wizard // Instant',
    colors: ['U'],
    color_identity: ['U'],
    card_faces: [
      {
        name: frontName,
        mana_cost: '{2}{U}',
        type_line: 'Creature — Wizard',
        oracle_text: frontOracleText,
        power: '2',
        toughness: '3',
      },
      {
        name: 'Study Break',
        mana_cost: '{1}{U}',
        type_line: 'Instant',
        oracle_text: 'Draw a card.',
      },
    ],
    power: '2',
    toughness: '3',
  };
}

function createPreparedSourcePermanent(permanentId: string, controller: string, card: any) {
  const frontFace = card.card_faces[0];
  return {
    id: permanentId,
    controller,
    owner: controller,
    tapped: false,
    counters: {},
    basePower: Number(frontFace.power || 0),
    baseToughness: Number(frontFace.toughness || 0),
    card: {
      ...card,
      name: frontFace.name,
      mana_cost: frontFace.mana_cost,
      type_line: frontFace.type_line,
      oracle_text: frontFace.oracle_text,
      zone: 'battlefield',
    },
  };
}

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try {
    await deleteGame(gameId);
  } catch {
    // test-only cleanup
  }
}

describe('prepared trigger socket integration (Layer 3)', () => {
  const gameId = 'test_prepared_trigger_socket';
  const playerId = 'p1';
  const previousTriggerPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    delete process.env.ORACLE_IR_TRIGGER_LEGACY;
    await resetGame(gameId);
  });

  afterEach(async () => {
    if (previousTriggerPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousTriggerPrimary;
    }
    await resetGame(gameId);
  });

  it('resolves prepared ETB trigger on stack and exiles spell face under trigger IR primary', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(gameId as any, game as any);

    const card = buildPreparedConditionalCard(
      'Scheming Silvertongue',
      "At the beginning of your second main phase, if you gained 2 or more life this turn, this creature becomes prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
    );
    const sourcePermanent = createPreparedSourcePermanent('perm_prepared_socket', playerId, card);

    Object.assign(game.state as any, {
      players: [{ id: playerId, name: 'P1', spectator: false, life: 40 }],
      life: { [playerId]: 40 },
      lifeGainedThisTurn: { [playerId]: 2 },
      turnPlayer: playerId,
      priority: playerId,
      phase: 'postcombat_main',
      stack: [
        {
          id: 'prepared_trigger_stack',
          type: 'triggered_ability',
          controller: playerId,
          owner: playerId,
          source: sourcePermanent.id,
          sourceName: 'Scheming Silvertongue',
          effect: "At the beginning of your second main phase, if you gained 2 or more life this turn, this creature becomes prepared.",
          effectText: "At the beginning of your second main phase, if you gained 2 or more life this turn, this creature becomes prepared.",
          targets: [],
        },
      ],
      battlefield: [sourcePermanent],
      zones: {
        [playerId]: {
          hand: [],
          handCount: 0,
          graveyard: [],
          graveyardCount: 0,
          exile: [],
          exileCount: 0,
        },
      },
    });

    registerResolutionHandlers(createNoopIo(), { data: { playerId, gameId }, rooms: new Set([gameId]), on: () => {}, emit: () => {} } as any);
    resolveTopOfStack(game as any);

    const updatedPermanent = ((game.state as any).battlefield || []).find((entry: any) => entry?.id === sourcePermanent.id);
    expect(updatedPermanent?.prepared).toBe(true);
    expect((game.state as any).zones[playerId].exile).toHaveLength(1);
    expect((game.state as any).zones[playerId].exile[0].name).toBe('Study Break');
    expect((game.state as any).stack || []).toHaveLength(0);
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);
  }, 15000);
});
