import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
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

function buildReflectionsCard() {
  return {
    id: 'reflections_of_littjara_card',
    name: 'Reflections of Littjara',
    type_line: 'Enchantment',
    oracle_text:
      'As Reflections of Littjara enters the battlefield, choose a creature type. Whenever you cast a spell of the chosen type, copy that spell. (A copy of a permanent spell becomes a token.)',
  };
}

function buildWizardSpell() {
  return {
    id: 'wizard_spell_1',
    name: 'Arcane Apprentice',
    mana_cost: '',
    manaCost: '{0}',
    type_line: 'Creature — Wizard',
    oracle_text: '',
    power: '2',
    toughness: '2',
  };
}

function seedSpellCopyTriggerGame(game: any) {
  (game.state as any).players = [
    { id: 'p1', name: 'P1', spectator: false, life: 40 },
    { id: 'p2', name: 'P2', spectator: false, life: 40 },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { p1: 40, p2: 40 };
  (game.state as any).phase = 'main1';
  (game.state as any).step = 'MAIN1';
  (game.state as any).priority = 'p1';
  (game.state as any).activePlayer = 'p1';
  (game.state as any).turnPlayer = 'p1';
  (game.state as any).turnNumber = 3;
  (game.state as any).stack = [];
  (game.state as any).battlefield = [
    {
      id: 'reflections_perm_1',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      chosenCreatureType: 'Wizard',
      card: { ...buildReflectionsCard(), zone: 'battlefield' },
    },
  ];
  (game.state as any).manaPool = {
    p1: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
  };
  (game.state as any).zones = {
    p1: {
      hand: [buildWizardSpell()],
      handCount: 1,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
      library: [],
      libraryCount: 0,
    },
    p2: {
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
}

describe('Oracle IR trigger copy_spell replay integration', () => {
  const gameId = 'test_oracle_ir_trigger_copy_spell_replay';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    await resetGame(gameId);
    await resetGame(`${gameId}_replay`);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    await resetGame(gameId);
    await resetGame(`${gameId}_replay`);
  });

  it('persists copyTriggeredSpellResolve events and replays IR stack copies', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    seedSpellCopyTriggerGame(game);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);
    const eventStart = getEvents(gameId).length;

    await handlers['castSpellFromHand']({
      gameId,
      cardId: 'wizard_spell_1',
      targets: [],
    });

    expect((game.state as any).stack).toHaveLength(2);
    const originalSpell = ((game.state as any).stack || []).find((item: any) => !item?.copiedFromStackItemId);
    const copiedSpell = ((game.state as any).stack || []).find((item: any) => item?.copiedFromStackItemId);
    expect(originalSpell).toBeDefined();
    expect(copiedSpell).toBeDefined();
    expect(copiedSpell?.copiedFromStackItemId).toBe(originalSpell?.id);
    expect(copiedSpell?.isCopy).toBe(true);
    expect(copiedSpell?.copiedBySourceName).toBe('Reflections of Littjara');

    const replayEvents = toReplayEvents(gameId, eventStart);
    const copyEvents = replayEvents.filter((event: any) => event.type === 'copyTriggeredSpellResolve');
    expect(copyEvents).toHaveLength(1);
    expect(copyEvents[0]).toEqual(
      expect.objectContaining({
        type: 'copyTriggeredSpellResolve',
        sourceName: 'Reflections of Littjara',
        controllerId: 'p1',
        triggeringStackItemId: originalSpell?.id,
        copiedStackItemId: copiedSpell?.id,
      }),
    );

    const replayGameId = `${gameId}_replay`;
    const replayGame = createInitialGameState(replayGameId);
    seedSpellCopyTriggerGame(replayGame);

    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }

    replayGame.replay(replayEvents as any);

    expect((replayGame.state as any).stack).toHaveLength(2);
    const replayOriginalSpell = ((replayGame.state as any).stack || []).find((item: any) => !item?.copiedFromStackItemId);
    const replayCopiedSpell = ((replayGame.state as any).stack || []).find((item: any) => item?.copiedFromStackItemId);
    expect(replayCopiedSpell?.copiedFromStackItemId).toBe(replayOriginalSpell?.id);
    expect(replayCopiedSpell?.copiedBySourceName).toBe('Reflections of Littjara');
    expect(replayCopiedSpell?.isCopy).toBe(true);
  });
});
