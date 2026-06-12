import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { createInitialGameState } from '../src/state/index.js';

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
    sockets: {
      sockets: new Map(),
    },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
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
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function toReplayEvents(gameId: string, startIndex = 0) {
  return getEvents(gameId)
    .slice(startIndex)
    .map((event: any) =>
      event?.payload && typeof event.payload === 'object'
        ? { type: event.type, ...(event.payload as Record<string, unknown>) }
        : { type: event.type },
    );
}

async function seedIncreasingVengeanceFlashbackGame(gameId: string) {
  await resetGame(gameId);
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  const playerId = 'p1';
  const targetStackId = 'stack_increasing_vengeance_target_1';
  const cardId = 'increasing_vengeance_1';
  const oracleText =
    'Copy target instant or sorcery spell you control. If this spell was cast from a graveyard, copy that spell twice instead. You may choose new targets for the copies.\nFlashback {3}{R}{R}';

  (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
  (game.state as any).life = { [playerId]: 40 };
  (game.state as any).zones = {
    [playerId]: {
      hand: [],
      handCount: 0,
      library: [],
      libraryCount: 0,
      graveyard: [
        {
          id: cardId,
          name: 'Increasing Vengeance',
          type_line: 'Instant',
          mana_cost: '{1}{R}',
          oracle_text: oracleText,
          zone: 'graveyard',
        },
      ],
      graveyardCount: 1,
      exile: [],
      exileCount: 0,
    },
  };
  (game.state as any).stack = [
    {
      id: targetStackId,
      type: 'spell',
      controller: playerId,
      card: {
        id: 'increasing_vengeance_target_1',
        name: 'Opt',
        type_line: 'Instant',
        oracle_text: 'Draw a card.',
        zone: 'stack',
      },
      targets: [],
    },
  ];
  (game.state as any).manaPool = {
    [playerId]: { white: 0, blue: 0, black: 0, red: 2, green: 0, colorless: 3 },
  };

  return { game, playerId, targetStackId, cardId };
}

describe('Oracle IR spell copy_spell replay integration', () => {
  const gameId = 'test_oracle_ir_spell_copy_spell_replay';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    await resetGame(gameId);
    await resetGame(`${gameId}_replay`);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    await resetGame(gameId);
    await resetGame(`${gameId}_replay`);
  });

  it('persists copyTriggeredSpellResolve events and replays flashback double copies', async () => {
    const { game, playerId, targetStackId, cardId } = await seedIncreasingVengeanceFlashbackGame(gameId);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const io = createMockIo(emitted);
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    registerInteractionHandlers(io as any, socket as any);

    const eventStart = getEvents(gameId).length;

    await handlers['activateGraveyardAbility']({
      gameId,
      cardId,
      abilityId: 'flashback',
      targets: [targetStackId],
    });

    game.resolveTopOfStack();

    const stack = (game.state as any).stack || [];
    const copiedSpells = stack.filter((item: any) => item?.copiedFromStackItemId === targetStackId);
    expect(copiedSpells).toHaveLength(2);
    expect(copiedSpells.every((item: any) => item?.isCopy === true && item?.copiedBySourceName === 'Increasing Vengeance')).toBe(true);

    const replayEvents = toReplayEvents(gameId, eventStart);
    const copyEvents = replayEvents.filter((event: any) => event.type === 'copyTriggeredSpellResolve');
    expect(copyEvents).toHaveLength(2);
    expect(copyEvents.every((event: any) => (
      event.sourceName === 'Increasing Vengeance'
      && event.controllerId === playerId
      && event.triggeringStackItemId === targetStackId
      && typeof event.copiedStackItemId === 'string'
      && event.copiedStackItemId.length > 0
    ))).toBe(true);

    const replayGameId = `${gameId}_replay`;
    const replaySeed = await seedIncreasingVengeanceFlashbackGame(replayGameId);
    const replayGame = replaySeed.game;

    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }

    replayGame.replay(replayEvents as any);

    const replayStack = (replayGame.state as any).stack || [];
    const replayCopies = replayStack.filter((item: any) => item?.copiedFromStackItemId === targetStackId);
    expect(replayCopies).toHaveLength(2);
    expect(replayCopies.every((item: any) => item?.isCopy === true && item?.copiedBySourceName === 'Increasing Vengeance')).toBe(true);
    expect(replayStack.some((item: any) => item?.id === targetStackId)).toBe(true);
  });
});
