import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame, transformDbEventsForReplay } from '../src/socket/util.js';
import { addGraveyardCastingPermission } from '../src/state/modules/graveyard-permissions.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { ResolutionStepType } from '../src/state/resolution/types.js';
import { games } from '../src/socket/socket.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId: undefined },
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
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  try {
    await deleteGame(gameId);
  } catch {
    // Ignore cleanup failures for test-only game ids.
  }
}

describe('playLand graveyard permission windows (integration)', () => {
  const gameId = 'test_play_land_graveyard_permission_window';
  const replayGameId = `${gameId}_replay`;
  const playerId = 'p1';
  const opponentId = 'p2';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
    await resetGame(replayGameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
    await resetGame(replayGameId);
  });

  it('allows subtype-limited graveyard land replay through the live playLand handler', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40, isAI: false },
      { id: opponentId, name: 'P2', spectator: false, life: 40, isAI: false },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'titania_1',
        controller: playerId,
        tapped: false,
        card: {
          id: 'titania_card_1',
          name: "Titania, Nature's Force",
          type_line: 'Legendary Creature — Elemental',
          oracle_text: 'You may play Forests from your graveyard.',
        },
      },
    ];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).landsPlayedThisTurn = { [playerId]: 0, [opponentId]: 0 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'forest_1',
            name: 'Forest',
            type_line: 'Basic Land — Forest',
            oracle_text: '{T}: Add {G}.',
            image_uris: { small: 'https://example.com/forest.jpg' },
          },
          {
            id: 'wasteland_1',
            name: 'Wasteland',
            type_line: 'Land',
            oracle_text: '{T}: Add {C}.',
            image_uris: { small: 'https://example.com/wasteland.jpg' },
          },
        ],
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

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.data.gameId = gameId;
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerGameActions(io as any, socket as any);

    await handlers['playLand']({ gameId, cardId: 'forest_1', fromZone: 'graveyard' });

    const errorCodes = emitted
      .filter((entry) => entry.event === 'error')
      .map((entry) => entry.payload?.code);
    expect(errorCodes).not.toContain('NO_PERMISSION');

    const battlefield = (game.state as any).battlefield || [];
    const graveyard = (game.state as any).zones?.[playerId]?.graveyard || [];
    expect(battlefield.some((permanent: any) => permanent?.card?.name === 'Forest')).toBe(true);
    expect(graveyard.some((card: any) => card?.id === 'forest_1')).toBe(false);
    expect(graveyard.some((card: any) => card?.id === 'wasteland_1')).toBe(true);
  });

  it('requires Hazezon to replay only Desert lands from the graveyard', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40, isAI: false },
      { id: opponentId, name: 'P2', spectator: false, life: 40, isAI: false },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'hazezon_1',
        controller: playerId,
        tapped: false,
        card: {
          id: 'hazezon_card_1',
          name: 'Hazezon, Shaper of Sand',
          type_line: 'Legendary Creature — Human Warrior',
          oracle_text: "Desertwalk (This creature can't be blocked as long as defending player controls a Desert.)\nYou may play Desert lands from your graveyard.\nWhenever a Desert you control enters, create two 1/1 red, green, and white Sand Warrior creature tokens.",
        },
      },
    ];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).landsPlayedThisTurn = { [playerId]: 0, [opponentId]: 0 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'forest_1',
            name: 'Forest',
            type_line: 'Basic Land — Forest',
            oracle_text: '{T}: Add {G}.',
            image_uris: { small: 'https://example.com/forest.jpg' },
          },
          {
            id: 'desert_1',
            name: 'Scavenger Grounds',
            type_line: 'Land — Desert',
            oracle_text: '{T}: Add {C}.',
            image_uris: { small: 'https://example.com/scavenger-grounds.jpg' },
          },
        ],
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

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.data.gameId = gameId;
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerGameActions(io as any, socket as any);

    await handlers['playLand']({ gameId, cardId: 'forest_1', fromZone: 'graveyard' });

    const firstErrorCodes = emitted
      .filter((entry) => entry.event === 'error')
      .map((entry) => entry.payload?.code);
    expect(firstErrorCodes).toContain('NO_PERMISSION');
    expect((game.state as any).landsPlayedThisTurn?.[playerId]).toBe(0);

    await handlers['playLand']({ gameId, cardId: 'desert_1', fromZone: 'graveyard' });

    const battlefield = (game.state as any).battlefield || [];
    const graveyard = (game.state as any).zones?.[playerId]?.graveyard || [];
    expect(battlefield.some((permanent: any) => permanent?.card?.id === 'desert_1')).toBe(true);
    expect(graveyard.some((card: any) => card?.id === 'desert_1')).toBe(false);
    expect(graveyard.some((card: any) => card?.id === 'forest_1')).toBe(true);
  });

  it('requires The Eighth Doctor to replay only historic lands from the graveyard', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40, isAI: false },
      { id: opponentId, name: 'P2', spectator: false, life: 40, isAI: false },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'eighth_doctor_1',
        controller: playerId,
        tapped: false,
        card: {
          id: 'eighth_doctor_card_1',
          name: 'The Eighth Doctor',
          type_line: 'Legendary Creature — Time Lord Doctor',
          oracle_text: 'When The Eighth Doctor enters, mill three cards.\nOnce during each of your turns, you may play a historic land or cast a historic permanent spell from your graveyard. If you do, it gains "If this permanent would leave the battlefield, exile it instead of putting it anywhere else."',
        },
      },
    ];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).landsPlayedThisTurn = { [playerId]: 0, [opponentId]: 0 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'forest_1',
            name: 'Forest',
            type_line: 'Basic Land — Forest',
            oracle_text: '{T}: Add {G}.',
            image_uris: { small: 'https://example.com/forest.jpg' },
          },
          {
            id: 'eiganjo_1',
            name: 'Eiganjo, Seat of the Empire',
            type_line: 'Legendary Land',
            oracle_text: '{T}: Add {W}.',
            image_uris: { small: 'https://example.com/eiganjo.jpg' },
          },
        ],
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

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.data.gameId = gameId;
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerGameActions(io as any, socket as any);

    await handlers['playLand']({ gameId, cardId: 'forest_1', fromZone: 'graveyard' });

    const firstErrorCodes = emitted
      .filter((entry) => entry.event === 'error')
      .map((entry) => entry.payload?.code);
    expect(firstErrorCodes).toContain('NO_PERMISSION');
    expect((game.state as any).landsPlayedThisTurn?.[playerId]).toBe(0);

    await handlers['playLand']({ gameId, cardId: 'eiganjo_1', fromZone: 'graveyard' });

    const battlefield = (game.state as any).battlefield || [];
    const graveyard = (game.state as any).zones?.[playerId]?.graveyard || [];
    expect(battlefield.some((permanent: any) => permanent?.card?.id === 'eiganjo_1')).toBe(true);
    expect(graveyard.some((card: any) => card?.id === 'eiganjo_1')).toBe(false);
    expect(graveyard.some((card: any) => card?.id === 'forest_1')).toBe(true);
  });

  it('allows graveyard lands marked playable by effect-program permissions through the live playLand handler', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40, isAI: false },
      { id: opponentId, name: 'P2', spectator: false, life: 40, isAI: false },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).turnNumber = 4;
    (game.state as any).stack = [];
    (game.state as any).battlefield = [];
    (game.state as any).playableFromGraveyard = {
      [playerId]: { forest_1: 4 },
    };
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).landsPlayedThisTurn = { [playerId]: 0, [opponentId]: 0 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'forest_1',
            name: 'Forest',
            type_line: 'Basic Land — Forest',
            oracle_text: '{T}: Add {G}.',
            canBePlayedBy: playerId,
            playableUntilTurn: 4,
            image_uris: { small: 'https://example.com/forest.jpg' },
          },
        ],
        graveyardCount: 1,
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

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.data.gameId = gameId;
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerGameActions(io as any, socket as any);

    await handlers['playLand']({ gameId, cardId: 'forest_1', fromZone: 'graveyard' });

    const errorCodes = emitted
      .filter((entry) => entry.event === 'error')
      .map((entry) => entry.payload?.code);
    expect(errorCodes).not.toContain('NO_PERMISSION');

    const battlefield = (game.state as any).battlefield || [];
    const graveyard = (game.state as any).zones?.[playerId]?.graveyard || [];
    expect(battlefield.some((permanent: any) => permanent?.card?.name === 'Forest')).toBe(true);
    expect(graveyard.some((card: any) => card?.id === 'forest_1')).toBe(false);
  });

  it('rejects graveyard land plays outside the normal land timing window', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40, isAI: false },
      { id: opponentId, name: 'P2', spectator: false, life: 40, isAI: false },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnNumber = 4;
    (game.state as any).phase = 'combat';
    (game.state as any).step = 'COMBAT';
    (game.state as any).turnPlayer = opponentId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [
      {
        id: 'stack_spell_1',
        type: 'spell',
        controller: opponentId,
        card: { id: 'shock_1', name: 'Shock', type_line: 'Instant' },
      },
    ];
    (game.state as any).battlefield = [
      {
        id: 'crucible_1',
        controller: playerId,
        tapped: false,
        card: {
          id: 'crucible_card_1',
          name: 'Crucible of Worlds',
          type_line: 'Artifact',
          oracle_text: 'You may play lands from your graveyard.',
        },
      },
    ];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).landsPlayedThisTurn = { [playerId]: 0, [opponentId]: 0 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'forest_1',
            name: 'Forest',
            type_line: 'Basic Land — Forest',
            oracle_text: '{T}: Add {G}.',
            image_uris: { small: 'https://example.com/forest.jpg' },
          },
        ],
        graveyardCount: 1,
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

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.data.gameId = gameId;
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerGameActions(io as any, socket as any);

    await handlers['playLand']({ gameId, cardId: 'forest_1', fromZone: 'graveyard' });

    const errorCodes = emitted
      .filter((entry) => entry.event === 'error')
      .map((entry) => entry.payload?.code);
    expect(errorCodes).toContain('NO_PERMISSION');

    const battlefield = (game.state as any).battlefield || [];
    const graveyard = (game.state as any).zones?.[playerId]?.graveyard || [];
    expect(battlefield.some((permanent: any) => permanent?.card?.id === 'forest_1')).toBe(false);
    expect(graveyard.some((card: any) => card?.id === 'forest_1')).toBe(true);
  });

  it('respects additional land-play effects when playing lands from graveyard', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40, isAI: false },
      { id: opponentId, name: 'P2', spectator: false, life: 40, isAI: false },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'crucible_1',
        controller: playerId,
        tapped: false,
        card: {
          id: 'crucible_card_1',
          name: 'Crucible of Worlds',
          type_line: 'Artifact',
          oracle_text: 'You may play lands from your graveyard.',
        },
      },
      {
        id: 'exploration_1',
        controller: playerId,
        tapped: false,
        card: {
          id: 'exploration_card_1',
          name: 'Exploration',
          type_line: 'Enchantment',
          oracle_text: 'You may play an additional land on each of your turns.',
        },
      },
    ];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).landsPlayedThisTurn = { [playerId]: 1, [opponentId]: 0 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'forest_1',
            name: 'Forest',
            type_line: 'Basic Land — Forest',
            oracle_text: '{T}: Add {G}.',
            image_uris: { small: 'https://example.com/forest.jpg' },
          },
        ],
        graveyardCount: 1,
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

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.data.gameId = gameId;
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerGameActions(io as any, socket as any);

    await handlers['playLand']({ gameId, cardId: 'forest_1', fromZone: 'graveyard' });

    const errorCodes = emitted
      .filter((entry) => entry.event === 'error')
      .map((entry) => entry.payload?.code);
    expect(errorCodes).not.toContain('LAND_LIMIT_REACHED');
    expect(errorCodes).not.toContain('NO_PERMISSION');
    expect((game.state as any).landsPlayedThisTurn?.[playerId]).toBe(2);

    const battlefield = (game.state as any).battlefield || [];
    const graveyard = (game.state as any).zones?.[playerId]?.graveyard || [];
    expect(battlefield.some((permanent: any) => permanent?.card?.id === 'forest_1')).toBe(true);
    expect(graveyard.some((card: any) => card?.id === 'forest_1')).toBe(false);
  });

  it('requires Glacierwood Siege to choose Sultai before granting graveyard land plays', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40, isAI: false },
      { id: opponentId, name: 'P2', spectator: false, life: 40, isAI: false },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'glacierwood_siege_1',
        controller: playerId,
        tapped: false,
        card: {
          id: 'glacierwood_siege_card_1',
          name: 'Glacierwood Siege',
          type_line: 'Enchantment',
          oracle_text: 'As this enchantment enters, choose Temur or Sultai.\n• Temur — Whenever you cast an instant or sorcery spell, target player mills four cards.\n• Sultai — You may play lands from your graveyard.',
        },
      },
    ];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).landsPlayedThisTurn = { [playerId]: 0, [opponentId]: 0 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'forest_1',
            name: 'Forest',
            type_line: 'Basic Land — Forest',
            oracle_text: '{T}: Add {G}.',
            image_uris: { small: 'https://example.com/forest.jpg' },
          },
        ],
        graveyardCount: 1,
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

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.data.gameId = gameId;
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    const modalStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MODAL_CHOICE,
      playerId,
      description: 'Glacierwood Siege: Choose one',
      mandatory: true,
      sourceId: 'glacierwood_siege_1',
      sourceName: 'Glacierwood Siege',
      options: [
        { id: 'option_1', label: 'Temur', description: 'Temur' },
        { id: 'option_2', label: 'Sultai', description: 'Sultai' },
      ],
      minSelections: 1,
      maxSelections: 1,
      triggerData: {
        triggerType: 'etb_modal_choice',
        sourceName: 'Glacierwood Siege',
        sourceId: 'glacierwood_siege_1',
        modalTrigger: true,
        controllerId: playerId,
        mandatory: true,
      },
    } as any);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((modalStep as any).id),
      selections: ['option_1'],
    });

    const siegePermanent = ((game.state as any).battlefield || []).find((entry: any) => entry?.id === 'glacierwood_siege_1');
    expect(siegePermanent?.selectedMode?.label).toBe('Temur');

    await handlers['playLand']({ gameId, cardId: 'forest_1', fromZone: 'graveyard' });

    const errorCodes = emitted
      .filter((entry) => entry.event === 'error')
      .map((entry) => entry.payload?.code);
    expect(errorCodes).toContain('NO_PERMISSION');

    const battlefield = (game.state as any).battlefield || [];
    const graveyard = (game.state as any).zones?.[playerId]?.graveyard || [];
    expect(battlefield.some((permanent: any) => permanent?.card?.id === 'forest_1')).toBe(false);
    expect(graveyard.some((card: any) => card?.id === 'forest_1')).toBe(true);
  });

  it('persists Glacierwood Siege mode choices so Sultai grants graveyard land plays', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40, isAI: false },
      { id: opponentId, name: 'P2', spectator: false, life: 40, isAI: false },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).battlefield = [
      {
        id: 'glacierwood_siege_1',
        controller: playerId,
        tapped: false,
        card: {
          id: 'glacierwood_siege_card_1',
          name: 'Glacierwood Siege',
          type_line: 'Enchantment',
          oracle_text: 'As this enchantment enters, choose Temur or Sultai.\n• Temur — Whenever you cast an instant or sorcery spell, target player mills four cards.\n• Sultai — You may play lands from your graveyard.',
        },
      },
    ];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).landsPlayedThisTurn = { [playerId]: 0, [opponentId]: 0 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'forest_1',
            name: 'Forest',
            type_line: 'Basic Land — Forest',
            oracle_text: '{T}: Add {G}.',
            image_uris: { small: 'https://example.com/forest.jpg' },
          },
        ],
        graveyardCount: 1,
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

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.data.gameId = gameId;
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerGameActions(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    const modalStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.MODAL_CHOICE,
      playerId,
      description: 'Glacierwood Siege: Choose one',
      mandatory: true,
      sourceId: 'glacierwood_siege_1',
      sourceName: 'Glacierwood Siege',
      options: [
        { id: 'option_1', label: 'Temur', description: 'Temur' },
        { id: 'option_2', label: 'Sultai', description: 'Sultai' },
      ],
      minSelections: 1,
      maxSelections: 1,
      triggerData: {
        triggerType: 'etb_modal_choice',
        sourceName: 'Glacierwood Siege',
        sourceId: 'glacierwood_siege_1',
        modalTrigger: true,
        controllerId: playerId,
        mandatory: true,
      },
    } as any);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((modalStep as any).id),
      selections: ['option_2'],
    });

    const selectedModeEvent = [...getEvents(gameId)].reverse().find((event: any) => event?.type === 'setPermanentSelectedMode') as any;
    expect(selectedModeEvent?.payload).toEqual(expect.objectContaining({
      permanentId: 'glacierwood_siege_1',
      selectedMode: expect.objectContaining({ label: 'Sultai' }),
    }));

    createGameIfNotExists(replayGameId, 'commander', 40, undefined, playerId);
    const replayGame = ensureGame(replayGameId);
    if (!replayGame) throw new Error('ensureGame returned undefined for replay game');

    (replayGame.state as any).battlefield = [
      {
        id: 'glacierwood_siege_1',
        controller: playerId,
        tapped: false,
        card: {
          id: 'glacierwood_siege_card_1',
          name: 'Glacierwood Siege',
          type_line: 'Enchantment',
          oracle_text: 'As this enchantment enters, choose Temur or Sultai.\n• Temur — Whenever you cast an instant or sorcery spell, target player mills four cards.\n• Sultai — You may play lands from your graveyard.',
        },
      },
    ];

    replayGame.replay!(transformDbEventsForReplay([selectedModeEvent] as any));

    const replaySiege = ((replayGame.state as any).battlefield || []).find((entry: any) => entry?.id === 'glacierwood_siege_1');
    expect(replaySiege?.selectedMode?.label).toBe('Sultai');

    await handlers['playLand']({ gameId, cardId: 'forest_1', fromZone: 'graveyard' });

    const errorCodes = emitted
      .filter((entry) => entry.event === 'error')
      .map((entry) => entry.payload?.code);
    expect(errorCodes).not.toContain('NO_PERMISSION');

    const battlefield = (game.state as any).battlefield || [];
    const graveyard = (game.state as any).zones?.[playerId]?.graveyard || [];
    expect(battlefield.some((permanent: any) => permanent?.card?.id === 'forest_1')).toBe(true);
    expect(graveyard.some((card: any) => card?.id === 'forest_1')).toBe(false);
  });

  it('persists and replays graveyard land permission metadata on playLand events', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40, isAI: false },
      { id: opponentId, name: 'P2', spectator: false, life: 40, isAI: false },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnNumber = 4;
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).battlefield = [];
    const landPermission = addGraveyardCastingPermission((game.state as any), {
      id: 'gaea_will_land_permission_1',
      playerId,
      permission: 'play',
      sourceId: 'gaea_will_1',
      sourceName: "Gaea's Will",
      cardFilter: { qualifier: 'lands' },
      costMode: 'normal',
      duration: 'this_turn',
      turnApplied: 4,
    });
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).landsPlayedThisTurn = { [playerId]: 0, [opponentId]: 0 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'forest_1',
            name: 'Forest',
            type_line: 'Basic Land — Forest',
            oracle_text: '{T}: Add {G}.',
            image_uris: { small: 'https://example.com/forest.jpg' },
          },
        ],
        graveyardCount: 1,
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

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted);
    socket.data.gameId = gameId;
    socket.rooms.add(gameId);
    const io = createMockIo(emitted, [socket]);

    registerGameActions(io as any, socket as any);

    await handlers['playLand']({ gameId, cardId: 'forest_1', fromZone: 'graveyard' });

    const persistedPlayLandEvent = [...getEvents(gameId)].reverse().find((event: any) => event?.type === 'playLand') as any;
    expect(persistedPlayLandEvent?.payload).toEqual(expect.objectContaining({
      playerId,
      cardId: 'forest_1',
      fromZone: 'graveyard',
      graveyardPermissionId: landPermission.id,
      graveyardPermissionSourceName: "Gaea's Will",
    }));
    expect(persistedPlayLandEvent?.payload?.card).toEqual(expect.objectContaining({
      id: 'forest_1',
      graveyardPermissionId: landPermission.id,
      graveyardPermissionSourceName: "Gaea's Will",
    }));

    createGameIfNotExists(replayGameId, 'commander', 40, undefined, playerId);
    const replayGame = ensureGame(replayGameId);
    if (!replayGame) throw new Error('ensureGame returned undefined for replay game');

    replayGame.replay!(transformDbEventsForReplay([persistedPlayLandEvent] as any));

    const replayPermanent = (((replayGame.state as any).battlefield || []) as any[]).find((entry: any) =>
      String(entry?.controller || '') === playerId && String(entry?.card?.id || '') === 'forest_1'
    );

    expect(replayPermanent).toBeDefined();
    expect(replayPermanent?.card?.graveyardPermissionId).toBe(landPermission.id);
    expect(replayPermanent?.card?.graveyardPermissionSourceName).toBe("Gaea's Will");
    expect((replayGame.state as any).playedLandFromGraveyardThisTurn?.[playerId]).toBe(true);
  });
});