import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { ensureGame, transformDbEventsForReplay } from '../src/socket/util.js';
import { movePermanentToGraveyard } from '../src/state/modules/counters_tokens.js';
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

  it('allows the remaining generic graveyard land replay cards through the live playLand handler', async () => {
    const replaySources = [
      {
        name: 'Ramunap Excavator',
        typeLine: 'Creature — Snake Cleric',
        oracleText: 'You may play lands from your graveyard.',
      },
      {
        name: 'Conduit of Worlds',
        typeLine: 'Artifact',
        oracleText: 'You may play lands from your graveyard.\n{T}: Choose target nonland permanent card in your graveyard. If you haven\'t cast a spell this turn, you may cast that card. If you do, you can\'t cast additional spells this turn. Activate only as a sorcery.',
      },
      {
        name: 'Ancient Greenwarden',
        typeLine: 'Creature — Elemental',
        oracleText: 'Reach (This creature can block creatures with flying.)\nYou may play lands from your graveyard.\nIf a land entering causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time.',
      },
      {
        name: 'Perennial Behemoth',
        typeLine: 'Artifact Creature — Beast',
        oracleText: 'You may play lands from your graveyard.\nUnearth {G}{G} ({G}{G}: Return this card from your graveyard to the battlefield. It gains haste. Exile it at the beginning of the next end step or if it would leave the battlefield. Unearth only as a sorcery.)',
      },
      {
        name: 'Szarel, Genesis Shepherd',
        typeLine: 'Legendary Creature — Insect Druid',
        oracleText: 'Flying\nYou may play lands from your graveyard.\nWhenever you sacrifice another nontoken permanent during your turn, put a number of +1/+1 counters equal to Szarel\'s power on up to one other target creature.',
      },
    ];

    for (const [index, source] of replaySources.entries()) {
      const caseGameId = `${gameId}_generic_${index}`;
      await resetGame(caseGameId);

      try {
        createGameIfNotExists(caseGameId, 'commander', 40, undefined, playerId);
        const game = ensureGame(caseGameId);
        if (!game) throw new Error(`ensureGame returned undefined for ${source.name}`);

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
            id: `generic_source_${index}`,
            controller: playerId,
            tapped: false,
            card: {
              id: `generic_source_card_${index}`,
              name: source.name,
              type_line: source.typeLine,
              oracle_text: source.oracleText,
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
                id: `forest_${index}`,
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
        socket.data.gameId = caseGameId;
        socket.rooms.add(caseGameId);
        const io = createMockIo(emitted, [socket]);

        registerGameActions(io as any, socket as any);

        await handlers['playLand']({ gameId: caseGameId, cardId: `forest_${index}`, fromZone: 'graveyard' });

        const errorCodes = emitted
          .filter((entry) => entry.event === 'error')
          .map((entry) => entry.payload?.code);
        if (errorCodes.includes('NO_PERMISSION')) {
          throw new Error(`${source.name} unexpectedly failed graveyard land replay: ${JSON.stringify(errorCodes)}`);
        }

        const battlefield = (game.state as any).battlefield || [];
        const graveyard = (game.state as any).zones?.[playerId]?.graveyard || [];
        expect(battlefield.some((permanent: any) => permanent?.card?.id === `forest_${index}`)).toBe(true);
        expect(graveyard.some((card: any) => card?.id === `forest_${index}`)).toBe(false);
      } finally {
        await resetGame(caseGameId);
      }
    }
  });

  it('uses Icetill Explorer to take a legal second graveyard land play', async () => {
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
        id: 'icetill_1',
        controller: playerId,
        tapped: false,
        card: {
          id: 'icetill_card_1',
          name: 'Icetill Explorer',
          type_line: 'Creature — Insect Scout',
          oracle_text: 'You may play an additional land on each of your turns.\nYou may play lands from your graveyard.\nLandfall — Whenever a land you control enters, mill a card.',
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

  it('allows Oscorp Industries to be replayed from graveyard after a same-turn discard and applies its graveyard-entry life loss', async () => {
    createGameIfNotExists(gameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const oscorpIndustries = {
      id: 'oscorp_1',
      name: 'Oscorp Industries',
      type_line: 'Land',
      oracle_text: 'This land enters tapped.\nWhen this land enters from a graveyard, you lose 2 life.\n{T}: Add {U}, {B}, or {R}.\nMayhem (You may play this card from your graveyard if you discarded it this turn. Timing rules still apply.)',
      image_uris: { small: 'https://example.com/oscorp.jpg' },
    };

    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40, isAI: false },
      { id: opponentId, name: 'P2', spectator: false, life: 40, isAI: false },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turnNumber = 1;
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).turnPlayer = playerId;
    (game.state as any).activePlayer = playerId;
    (game.state as any).priority = playerId;
    (game.state as any).stack = [];
    (game.state as any).battlefield = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).landsPlayedThisTurn = { [playerId]: 0, [opponentId]: 0 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [oscorpIndustries],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
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

    const discardStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.DISCARD_SELECTION,
      playerId,
      description: 'Discard a card.',
      mandatory: true,
      hand: [oscorpIndustries],
      discardCount: 1,
      destination: 'graveyard',
    } as any);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(discardStep.id),
      selections: ['oscorp_1'],
      cancelled: false,
    });

    const graveyardAfterDiscard = (((game.state as any).zones?.[playerId]?.graveyard) || []) as any[];
    const discardedOscorp = graveyardAfterDiscard.find((card: any) => String(card?.id || '') === 'oscorp_1');
    expect(discardedOscorp?.discardedByPlayerId).toBe(playerId);
    expect(discardedOscorp?.discardedOnTurn).toBe(1);

    await handlers['playLand']({ gameId, cardId: 'oscorp_1', fromZone: 'graveyard' });

    const errorCodes = emitted
      .filter((entry) => entry.event === 'error')
      .map((entry) => entry.payload?.code);
    expect(errorCodes).not.toContain('NO_PERMISSION');

    let safety = 0;
    while ((((game.state as any).stack || []) as any[]).length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    const battlefield = (((game.state as any).battlefield) || []) as any[];
    const graveyard = (((game.state as any).zones?.[playerId]?.graveyard) || []) as any[];
    const oscorpPermanent = battlefield.find((permanent: any) => String(permanent?.card?.id || '') === 'oscorp_1');

    expect(oscorpPermanent).toBeDefined();
    expect(oscorpPermanent?.enteredFromZone).toBe('graveyard');
    expect(oscorpPermanent?.enteredFromGraveyard).toBe(true);
    expect(Boolean(oscorpPermanent?.tapped)).toBe(true);
    expect(graveyard.some((card: any) => String(card?.id || '') === 'oscorp_1')).toBe(false);
    expect((game.state as any).life?.[playerId]).toBe(38);
  });

  it('allows a Wrenn and Realmbreaker emblem to replay lands from the graveyard', async () => {
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
    (game.state as any).battlefield = [];
    (game.state as any).stack = [];
    (game.state as any).emblems = [
      {
        id: 'wrenn_emblem_1',
        controller: playerId,
        sourceName: 'Wrenn and Realmbreaker Emblem',
        effect: 'You may play lands and cast permanent spells from your graveyard.',
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

    const errors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    expect(errors).not.toContain('NO_PERMISSION');

    const battlefield = (game.state as any).battlefield || [];
    const graveyard = (game.state as any).zones?.[playerId]?.graveyard || [];
    expect(battlefield.some((permanent: any) => permanent?.card?.id === 'forest_1')).toBe(true);
    expect(graveyard.some((card: any) => card?.id === 'forest_1')).toBe(false);
  });

  it('gives Serra Paragon lands the exile-and-gain-life rider when replayed from the graveyard', async () => {
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
    (game.state as any).battlefield = [
      {
        id: 'serra_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'serra_card_1',
          name: 'Serra Paragon',
          type_line: 'Creature — Angel',
          oracle_text: 'Flying\nOnce during each of your turns, you may play a land from your graveyard or cast a permanent spell with mana value 3 or less from your graveyard. If you do, it gains "When this permanent is put into a graveyard from the battlefield, exile it and you gain 2 life."',
          power: '3',
          toughness: '4',
        },
      },
    ];
    (game.state as any).stack = [];
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
            id: 'plains_1',
            name: 'Plains',
            type_line: 'Basic Land — Plains',
            oracle_text: '{T}: Add {W}.',
            image_uris: { small: 'https://example.com/plains.jpg' },
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

    await handlers['playLand']({ gameId, cardId: 'plains_1', fromZone: 'graveyard' });

    const errors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    expect(errors).not.toContain('NO_PERMISSION');

    const plainsPermanent = (((game.state as any).battlefield || []) as any[]).find(
      (permanent: any) => permanent?.card?.id === 'plains_1'
    );
    expect(plainsPermanent).toBeDefined();
    expect(plainsPermanent?.card?.leaveBattlefieldReplacementDestination).toBe('exile');
    expect(plainsPermanent?.card?.leaveBattlefieldReplacementLifeGain).toBe(2);

    expect(movePermanentToGraveyard(game as any, String(plainsPermanent.id))).toBe(true);

    const graveyardIds = ((((game.state as any).zones?.[playerId]?.graveyard) || []) as any[]).map((card: any) => card.id);
    const exileIds = ((((game.state as any).zones?.[playerId]?.exile) || []) as any[]).map((card: any) => card.id);

    expect(graveyardIds).not.toContain('plains_1');
    expect(exileIds).toContain('plains_1');
    expect((game.state as any).life?.[playerId]).toBe(42);
    expect(((game.state as any).players || []).find((player: any) => player?.id === playerId)?.life).toBe(42);
  });

  it('allows Zask to replay lands from the graveyard through the live playLand handler', async () => {
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
    (game.state as any).battlefield = [
      {
        id: 'zask_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'zask_card_1',
          name: 'Zask, Skittering Swarmlord',
          type_line: 'Legendary Creature — Insect',
          oracle_text: 'You may play lands and cast Insect spells from your graveyard.\nWhenever another Insect you control dies, put it on the bottom of its owner\'s library, then mill two cards.\n{1}{B/G}: Target Insect gets +1/+0 and gains deathtouch until end of turn.',
          power: '5',
          toughness: '5',
        },
      },
    ];
    (game.state as any).stack = [];
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

    const errors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    expect(errors).not.toContain('NO_PERMISSION');

    const battlefield = (game.state as any).battlefield || [];
    const graveyard = (game.state as any).zones?.[playerId]?.graveyard || [];
    expect(battlefield.some((permanent: any) => permanent?.card?.id === 'forest_1')).toBe(true);
    expect(graveyard.some((card: any) => card?.id === 'forest_1')).toBe(false);
  });

  it('lets Kethis activate into a temporary legendary graveyard land window', async () => {
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
    (game.state as any).battlefield = [
      {
        id: 'kethis_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'kethis_card_1',
          name: 'Kethis, the Hidden Hand',
          type_line: 'Legendary Creature — Elf Advisor',
          oracle_text: 'Legendary spells you cast cost {1} less to cast.\nExile two legendary cards from your graveyard: Until end of turn, each legendary card in your graveyard gains "You may play this card from your graveyard."',
          power: '3',
          toughness: '4',
        },
      },
    ];
    (game.state as any).stack = [];
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
            id: 'eiganjo_1',
            name: 'Eiganjo Castle',
            type_line: 'Legendary Land',
            oracle_text: '{T}: Add {W}.',
            image_uris: { small: 'https://example.com/eiganjo.jpg' },
          },
          {
            id: 'mox_amber_1',
            name: 'Mox Amber',
            type_line: 'Legendary Artifact',
            oracle_text: '{T}: Add one mana of any color among legendary creatures and planeswalkers you control.',
            image_uris: { small: 'https://example.com/mox-amber.jpg' },
          },
          {
            id: 'teferi_1',
            name: 'Teferi, Temporal Pilgrim',
            type_line: 'Legendary Planeswalker — Teferi',
            oracle_text: '',
            image_uris: { small: 'https://example.com/teferi.jpg' },
          },
          {
            id: 'forest_1',
            name: 'Forest',
            type_line: 'Basic Land — Forest',
            oracle_text: '{T}: Add {G}.',
            image_uris: { small: 'https://example.com/forest.jpg' },
          },
        ],
        graveyardCount: 4,
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
    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'kethis_1', abilityId: 'kethis_1-ability-0' });

    const costStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.type === ResolutionStepType.GRAVEYARD_SELECTION && step.graveyardExileAbilityAsCost === true
    ) as any;

    expect(costStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(costStep.id),
      selections: ['mox_amber_1', 'teferi_1'],
      cancelled: false,
    });

    let safety = 0;
    while (((game.state as any).stack || []).length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    const emittedCountBeforeForestAttempt = emitted.length;
    await handlers['playLand']({ gameId, cardId: 'forest_1', fromZone: 'graveyard' });
    const forestAttemptErrors = emitted
      .slice(emittedCountBeforeForestAttempt)
      .filter((entry) => entry.event === 'error')
      .map((entry) => entry.payload?.code);
    expect(forestAttemptErrors).toContain('NO_PERMISSION');

    const emittedCountBeforeEiganjoAttempt = emitted.length;
    await handlers['playLand']({ gameId, cardId: 'eiganjo_1', fromZone: 'graveyard' });
    const eiganjoAttemptErrors = emitted
      .slice(emittedCountBeforeEiganjoAttempt)
      .filter((entry) => entry.event === 'error')
      .map((entry) => entry.payload?.code);
    expect(eiganjoAttemptErrors).not.toContain('NO_PERMISSION');

    const battlefield = (game.state as any).battlefield || [];
    const graveyard = (game.state as any).zones?.[playerId]?.graveyard || [];
    const exile = (game.state as any).zones?.[playerId]?.exile || [];

    expect(battlefield.some((permanent: any) => permanent?.card?.id === 'eiganjo_1')).toBe(true);
    expect(graveyard.some((card: any) => card?.id === 'eiganjo_1')).toBe(false);
    expect(exile.some((card: any) => card?.id === 'mox_amber_1')).toBe(true);
    expect(exile.some((card: any) => card?.id === 'teferi_1')).toBe(true);
  });

  it('lets Horde of Notions target and play an Elemental land from the graveyard', async () => {
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
    (game.state as any).battlefield = [
      {
        id: 'horde_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        card: {
          id: 'horde_card_1',
          name: 'Horde of Notions',
          type_line: 'Legendary Creature — Elemental',
          oracle_text: 'Vigilance, trample, haste\n{W}{U}{B}{R}{G}: You may play target Elemental card from your graveyard without paying its mana cost.',
          power: '5',
          toughness: '5',
        },
      },
    ];
    (game.state as any).stack = [];
    (game.state as any).manaPool = {
      [playerId]: { white: 1, blue: 1, black: 1, red: 1, green: 1, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).landsPlayedThisTurn = { [playerId]: 0, [opponentId]: 0 };
    (game.state as any).zones = {
      [playerId]: {
        hand: [],
        handCount: 0,
        graveyard: [
          {
            id: 'elemental_land_1',
            name: 'Smoldering Monolith',
            type_line: 'Land — Elemental',
            oracle_text: '{T}: Add {R}.',
            image_uris: { small: 'https://example.com/elemental-land.jpg' },
          },
          {
            id: 'forest_1',
            name: 'Forest',
            type_line: 'Basic Land — Forest',
            oracle_text: '{T}: Add {G}.',
            image_uris: { small: 'https://example.com/forest.jpg' },
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
    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['activateBattlefieldAbility']({ gameId, permanentId: 'horde_1', abilityId: 'horde_1-ability-0' });

    const paymentStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.type === ResolutionStepType.MANA_PAYMENT_CHOICE && step.activationPaymentChoice === true
    ) as any;
    if (paymentStep) {
      await handlers['submitResolutionResponse']({
        gameId,
        stepId: String(paymentStep.id),
        selections: {
          payment: [
            { permanentId: '__pool__:white', mana: 'W', count: 1 },
            { permanentId: '__pool__:blue', mana: 'U', count: 1 },
            { permanentId: '__pool__:black', mana: 'B', count: 1 },
            { permanentId: '__pool__:red', mana: 'R', count: 1 },
            { permanentId: '__pool__:green', mana: 'G', count: 1 },
          ],
        },
        cancelled: false,
      });
    }

    const targetStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.battlefieldAbilityTargetSelection === true && Array.isArray(step.validTargets)
    ) as any;
    expect(targetStep).toBeDefined();
    expect((targetStep.validTargets || []).map((target: any) => target?.id)).toEqual(['elemental_land_1']);

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(targetStep.id),
      selections: ['elemental_land_1'],
      cancelled: false,
    });

    let safety = 0;
    while (((game.state as any).stack || []).length > 0 && safety++ < 10) {
      (game as any).resolveTopOfStack();
    }

    const promptStep = ResolutionQueueManager.getQueue(gameId).steps.find((step: any) =>
      step.type === ResolutionStepType.OPTION_CHOICE && step.playFromGraveyardCardId === 'elemental_land_1'
    ) as any;
    expect(promptStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String(promptStep.id),
      selections: ['play'],
      cancelled: false,
    });

    const errors = emitted.filter((entry) => entry.event === 'error').map((entry) => entry.payload?.code);
    const battlefield = (game.state as any).battlefield || [];
    const graveyard = (game.state as any).zones?.[playerId]?.graveyard || [];

    expect(errors).not.toContain('NO_PERMISSION');
    expect(battlefield.some((permanent: any) => permanent?.card?.id === 'elemental_land_1')).toBe(true);
    expect(graveyard.some((card: any) => card?.id === 'elemental_land_1')).toBe(false);
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
    if (!landPermission) throw new Error('Expected land permission to be created');
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