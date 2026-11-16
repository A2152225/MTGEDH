import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import type { PlayerID } from '../../shared/src/index.js';
import '../src/state/modules/priority.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
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
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('Eldrazi on-cast triggers (integration)', () => {
  const gameId = 'test_eldrazi_cast_triggers';
  const trackedGameIds = new Set<string>();

  function trackGameId(trackedGameId: string) {
    trackedGameIds.add(trackedGameId);
    ResolutionQueueManager.removeQueue(trackedGameId);
    games.delete(trackedGameId as any);
    return trackedGameId;
  }

  async function resetTrackedGames() {
    for (const trackedGameId of trackedGameIds) {
      await resetGame(trackedGameId);
    }
    trackedGameIds.clear();
  }

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    trackedGameIds.clear();
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetTrackedGames();
    await resetGame(gameId);
  });

  it('Thrumming Stone grants ripple: casting a spell queues a ripple trigger that prompts for same-name cards', async () => {
    const persistentGameId = trackGameId(`${gameId}_ripple`);
    createGameIfNotExists(persistentGameId, 'commander', 40);
    const game = ensureGame(persistentGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const library = [
      { id: 'lib_1', name: 'Island', type_line: 'Basic Land — Island', zone: 'library' },
      { id: 'lib_2', name: 'Divination', type_line: 'Sorcery', mana_cost: '{2}{U}', oracle_text: 'Draw two cards.', zone: 'library' },
      { id: 'lib_3', name: 'Mountain', type_line: 'Basic Land — Mountain', zone: 'library' },
      { id: 'lib_4', name: 'Plains', type_line: 'Basic Land — Plains', zone: 'library' },
      { id: 'lib_5', name: 'Swamp', type_line: 'Basic Land — Swamp', zone: 'library' },
    ];
    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).battlefield = [{
      id: 'stone', controller: playerId, owner: playerId, tapped: false, counters: {},
      card: {
        id: 'stone_c', name: 'Thrumming Stone', type_line: 'Legendary Artifact',
        oracle_text: 'Spells you cast have ripple 4. (Whenever you cast a spell, you may reveal the top four cards of your library. You may cast spells with the same name as that spell from among the revealed cards without paying their mana costs. Put the rest on the bottom of your library.)',
      },
    }];
    (game.state as any).zones = {
      [playerId]: {
        hand: [{ id: 'div_hand', name: 'Divination', type_line: 'Sorcery', mana_cost: '{2}{U}', oracle_text: 'Draw two cards.' }],
        handCount: 1,
        library: library.map((c) => ({ ...c })),
        libraryCount: library.length,
        graveyard: [], graveyardCount: 0, exile: [], exileCount: 0,
      },
    };
    (game.state as any).manaPool = { [playerId]: { white: 0, blue: 3, black: 0, red: 0, green: 0, colorless: 0 } };
    (game.state as any).stack = [];
    (game as any).libraries = (game as any).libraries || new Map();
    (game as any).libraries.set(playerId, library.map((c) => ({ ...c })));

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, persistentGameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerGameActions(io as any, socket as any);

    await handlers['castSpellFromHand']({ gameId: persistentGameId, cardId: 'div_hand' });

    const stack = (game.state as any).stack || [];
    const triggers = stack.filter((item: any) => item.type === 'triggered_ability');
    expect(triggers).toHaveLength(1);
    expect(triggers[0].triggerType).toBe('ripple');
    expect(triggers[0].effectData.rippleCount).toBe(4);
    expect(stack.filter((item: any) => item.type === 'spell')).toHaveLength(1);
    // The persisted event carries the ripple payload for replay.
    const persisted = getEvents(persistentGameId).filter((ev: any) => ev?.type === 'pushTriggeredAbility');
    expect(persisted.some((ev: any) => ev?.payload?.triggerType === 'ripple' && ev?.payload?.effectData?.rippleCount === 4)).toBe(true);

    // Resolving the trigger reveals the top four; Divination (same name) is offered for a free cast.
    game.resolveTopOfStack();
    const steps = ResolutionQueueManager.getQueue(persistentGameId).steps as any[];
    const castStep = steps.find((s: any) => s.castRevealedFromLibraryChoice === true);
    const mayStep = steps.find((s: any) => /ripple|reveal the top/i.test(String(s?.description || '')) && !s.castRevealedFromLibraryChoice);
    expect(Boolean(castStep) || Boolean(mayStep)).toBe(true);
  });
});