import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildEffectProgramFromOracleIR } from '../../rules-engine/src/effectProgram.js';
import { createOracleIREffectProgramHandlers } from '../../rules-engine/src/effectProgramOracleRunner.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { startEffectProgramResolution } from '../src/state/effects/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(data: any, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { spectator: false, ...data },
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
  try {
    await deleteGame(gameId);
  } catch {
    // Ignore cleanup failures for test-only game ids.
  }
}

describe('effect-program graveyard permission bridge (integration)', () => {
  const gameId = 'test_effect_program_graveyard_permission_bridge';
  const playerId = 'p1';
  const opponentId = 'p2';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('lets a resolved Gaea\'s Will-style effect program enable both graveyard land plays and spell casts', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const forest = {
      id: 'forest_1',
      name: 'Forest',
      type_line: 'Basic Land — Forest',
      oracle_text: '{T}: Add {G}.',
      image_uris: { small: 'https://example.com/forest.jpg' },
    };
    const consider = {
      id: 'consider_1',
      name: 'Consider',
      mana_cost: '{U}',
      manaCost: '{U}',
      type_line: 'Instant',
      oracle_text: 'Draw a card.',
      image_uris: { small: 'https://example.com/consider.jpg' },
    };

    (game.state as any).players = [
      {
        id: playerId,
        name: 'P1',
        spectator: false,
        life: 40,
        hand: [],
        library: [],
        graveyard: [forest, consider],
        exile: [],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 0 },
      },
      {
        id: opponentId,
        name: 'P2',
        spectator: false,
        life: 40,
        hand: [],
        library: [],
        graveyard: [],
        exile: [],
        battlefield: [],
        commandZone: [],
        counters: {},
        manaPool: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnNumber = 4;
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [];
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 1, black: 0, red: 0, green: 0, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).landsPlayedThisTurn = { [playerId]: 0, [opponentId]: 0 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [forest, consider],
        graveyardCount: 2,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
      [opponentId]: {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    };
    (game as any).libraries = new Map<string, any[]>([
      [playerId, []],
      [opponentId, []],
    ]);

    const ir = parseOracleTextToIR(
      'Until end of turn, you may play lands and cast spells from your graveyard.',
      "Gaea's Will",
    );
    const program = buildEffectProgramFromOracleIR({
      id: 'gaea-will-program',
      controllerId: playerId,
      sourceId: 'gaea_will_1',
      sourceName: "Gaea's Will",
      steps: ir.abilities.flatMap((ability: any) => ability.steps || []),
    });

    const started = startEffectProgramResolution({
      game,
      gameId,
      program,
      handlers: createOracleIREffectProgramHandlers({
        controllerId: playerId,
        sourceId: 'gaea_will_1',
        sourceName: "Gaea's Will",
      }) as any,
      persistPrompt: false,
    });

    expect(started.status).toBe('completed');
    expect((game.state as any).playableFromGraveyard?.[playerId]?.forest_1).toBe(4);
    expect((game.state as any).playableFromGraveyard?.[playerId]?.consider_1).toBe(4);
    expect((game.state as any).graveyardCastingPermissions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        playerId,
        permission: 'play',
        sourceZone: 'graveyard',
        sourceId: 'gaea_will_1',
        sourceName: "Gaea's Will",
        cardFilter: { qualifier: 'lands' },
        duration: 'this_turn',
      }),
      expect.objectContaining({
        playerId,
        permission: 'cast',
        sourceZone: 'graveyard',
        sourceId: 'gaea_will_1',
        sourceName: "Gaea's Will",
        cardFilter: { qualifier: 'spells' },
        duration: 'this_turn',
      }),
    ]));

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId, gameId }, emitted);
    socket.rooms.add(gameId);
    const io = createMockIo(emitted);

    registerGameActions(io as any, socket as any);

    await handlers['playLand']({ gameId, cardId: 'forest_1', fromZone: 'graveyard' });
    await handlers['requestCastSpell']({ gameId, cardId: 'consider_1', fromZone: 'graveyard' });

    const errorCodes = emitted
      .filter((entry) => entry.event === 'error')
      .map((entry) => entry.payload?.code);
    expect(errorCodes).not.toContain('NO_PERMISSION');

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.some((permanent: any) => permanent?.card?.id === 'forest_1')).toBe(true);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps.some((step: any) => step.cardId === 'consider_1')).toBe(true);
  });
});