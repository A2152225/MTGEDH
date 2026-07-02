import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerJoinHandlers } from '../src/socket/join.js';
import { initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import '../src/state/modules/priority.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

const playerId = 'p1' as PlayerID;
const player2Id = 'p2' as PlayerID;

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => {} }),
    emit: (_event: string, _payload: any) => {},
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({ emit: (event: string, payload: any) => emitted.push({ room, event, payload }) }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

async function resetSocketGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  try {
    await deleteGame(gameId);
  } catch {
    // test-only cleanup
  }
}

function queueStackSpell(
  game: any,
  card: {
    id: string;
    name: string;
    type_line: string;
    oracle_text: string;
    mana_cost: string;
  },
  stackId: string,
  controller: PlayerID = playerId,
) {
  (game.state as any).stack = [
    {
      id: stackId,
      type: 'spell',
      controller,
      card,
      targets: [],
    },
  ];
}

function setupTwoPlayerWheelGame(
  game: any,
  gameId: string,
  options: {
    p1Hand: Array<Record<string, unknown>>;
    p2Hand: Array<Record<string, unknown>>;
    p1Library: Array<Record<string, unknown>>;
    p2Library: Array<Record<string, unknown>>;
  },
) {
  (game as any).gameId = gameId;
  (game.state as any).players = [
    { id: playerId, name: 'P1', spectator: false, life: 40, seatToken: 'seat_p1' },
    { id: player2Id, name: 'P2', spectator: false, life: 40, seatToken: 'seat_p2' },
  ];
  (game.state as any).zones = {
    [playerId]: {
      hand: options.p1Hand.map((card) => ({ ...card, zone: 'hand' })),
      handCount: options.p1Hand.length,
      graveyard: [],
      graveyardCount: 0,
      library: options.p1Library.map((card) => ({ ...card, zone: 'library' })),
      libraryCount: options.p1Library.length,
    },
    [player2Id]: {
      hand: options.p2Hand.map((card) => ({ ...card, zone: 'hand' })),
      handCount: options.p2Hand.length,
      graveyard: [],
      graveyardCount: 0,
      library: options.p2Library.map((card) => ({ ...card, zone: 'library' })),
      libraryCount: options.p2Library.length,
    },
  };
  const p1 = (game.state as any).players.find((entry: any) => entry.id === playerId);
  const p2 = (game.state as any).players.find((entry: any) => entry.id === player2Id);
  p1.library = options.p1Library.map((card) => ({ ...card, zone: 'library' }));
  p2.library = options.p2Library.map((card) => ({ ...card, zone: 'library' }));
  game.libraries = new Map([
    [playerId, options.p1Library.map((card) => ({ ...card, zone: 'library' }))],
    [player2Id, options.p2Library.map((card) => ({ ...card, zone: 'library' }))],
  ]);
}

function setupTwoPlayerEchoGame(
  game: any,
  gameId: string,
  options: {
    p1Hand: Array<Record<string, unknown>>;
    p2Hand: Array<Record<string, unknown>>;
    p1Graveyard: Array<Record<string, unknown>>;
    p2Graveyard: Array<Record<string, unknown>>;
    p1Library: Array<Record<string, unknown>>;
    p2Library: Array<Record<string, unknown>>;
  },
) {
  (game as any).gameId = gameId;
  (game.state as any).players = [
    { id: playerId, name: 'P1', spectator: false, life: 40, seatToken: 'seat_p1' },
    { id: player2Id, name: 'P2', spectator: false, life: 40, seatToken: 'seat_p2' },
  ];
  (game.state as any).zones = {
    [playerId]: {
      hand: options.p1Hand.map((card) => ({ ...card, zone: 'hand' })),
      handCount: options.p1Hand.length,
      graveyard: options.p1Graveyard.map((card) => ({ ...card, zone: 'graveyard' })),
      graveyardCount: options.p1Graveyard.length,
      library: options.p1Library.map((card) => ({ ...card, zone: 'library' })),
      libraryCount: options.p1Library.length,
    },
    [player2Id]: {
      hand: options.p2Hand.map((card) => ({ ...card, zone: 'hand' })),
      handCount: options.p2Hand.length,
      graveyard: options.p2Graveyard.map((card) => ({ ...card, zone: 'graveyard' })),
      graveyardCount: options.p2Graveyard.length,
      library: options.p2Library.map((card) => ({ ...card, zone: 'library' })),
      libraryCount: options.p2Library.length,
    },
  };
  const p1 = (game.state as any).players.find((entry: any) => entry.id === playerId);
  const p2 = (game.state as any).players.find((entry: any) => entry.id === player2Id);
  p1.library = options.p1Library.map((card) => ({ ...card, zone: 'library' }));
  p2.library = options.p2Library.map((card) => ({ ...card, zone: 'library' }));
  game.libraries = new Map([
    [playerId, options.p1Library.map((card) => ({ ...card, zone: 'library' }))],
    [player2Id, options.p2Library.map((card) => ({ ...card, zone: 'library' }))],
  ]);
}

function setupSinglePlayerLibraryGame(game: any, gameId: string, library: Array<Record<string, unknown>>) {
  (game as any).gameId = gameId;
  (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40, seatToken: 'seat_p1' }];
  (game.state as any).zones = {
    [playerId]: {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      library: library.map((card) => ({ ...card, zone: 'library' })),
      libraryCount: library.length,
    },
  };
  const player = (game.state as any).players[0];
  player.library = library.map((card) => ({ ...card, zone: 'library' }));
  game.libraries = new Map([[playerId, library.map((card) => ({ ...card, zone: 'library' }))]]);
}

async function joinAndReadZones(gameId: string, joiningPlayerId: PlayerID, game: any) {
  const joinEmitted: Array<{ room?: string; event: string; payload: any }> = [];
  const joinHandlers: Record<string, (payload: any) => Promise<void> | void> = {};
  const joinSocket = {
    id: `sock_${joiningPlayerId}`,
    data: { spectator: false },
    rooms: new Set<string>(),
    on: (event: string, handler: (payload: any) => Promise<void> | void) => {
      joinHandlers[event] = handler;
    },
    emit: (event: string, payload: any) => joinEmitted.push({ event, payload }),
    join: (room: string) => joinSocket.rooms.add(room),
  };
  const joinIo = createMockIo(joinEmitted, [joinSocket]);
  registerJoinHandlers(joinIo as any, joinSocket as any);
  await joinHandlers.joinGame({ gameId, fixedPlayerId: joiningPlayerId });

  const stateEvent = joinEmitted.find((entry) => entry.event === 'state');
  expect(stateEvent).toBeDefined();
  const zones = stateEvent?.payload?.zones || (game.state as any).zones;
  return zones;
}

describe('oracle IR wheel reconnect E2E (Layer 3)', () => {
  const reforgeJoinGameId = 'test_oracle_ir_reforge_join';
  const windfallJoinGameId = 'test_oracle_ir_windfall_join';
  const echoJoinGameId = 'test_oracle_ir_echo_join';
  const bigScoreJoinGameId = 'test_oracle_ir_big_score_join';
  const inspiringCallJoinGameId = 'test_oracle_ir_inspiring_call_join';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_SPELL_PRIMARY = '1';
    delete process.env.ORACLE_IR_SPELL_LEGACY;
    await resetSocketGame(reforgeJoinGameId);
    await resetSocketGame(windfallJoinGameId);
    await resetSocketGame(echoJoinGameId);
    await resetSocketGame(bigScoreJoinGameId);
    await resetSocketGame(inspiringCallJoinGameId);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_SPELL_PRIMARY;
    delete process.env.ORACLE_IR_SPELL_LEGACY;
    await resetSocketGame(reforgeJoinGameId);
    await resetSocketGame(windfallJoinGameId);
    await resetSocketGame(echoJoinGameId);
    await resetSocketGame(bigScoreJoinGameId);
    await resetSocketGame(inspiringCallJoinGameId);
  });

  it('joinGame emits correct zones after Reforge the Soul fully resolves', async () => {
    const p1Hand = [
      { id: 'p1_hand_1', name: 'Opt', type_line: 'Instant' },
      { id: 'p1_hand_2', name: 'Bolt', type_line: 'Instant' },
    ];
    const p2Hand = Array.from({ length: 4 }, (_, index) => ({
      id: `p2_hand_${index}`,
      name: `P2 Hand ${index}`,
      type_line: 'Instant',
    }));
    const p1Library = Array.from({ length: 10 }, (_, index) => ({
      id: `p1_lib_${index}`,
      name: `P1 Library ${index}`,
      type_line: 'Instant',
    }));
    const p2Library = Array.from({ length: 10 }, (_, index) => ({
      id: `p2_lib_${index}`,
      name: `P2 Library ${index}`,
      type_line: 'Instant',
    }));

    createGameIfNotExists(reforgeJoinGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(reforgeJoinGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(reforgeJoinGameId as any, game as any);
    setupTwoPlayerWheelGame(game, reforgeJoinGameId, { p1Hand, p2Hand, p1Library, p2Library });

    queueStackSpell(game, {
      id: 'reforge_join_1',
      name: 'Reforge the Soul',
      type_line: 'Sorcery',
      oracle_text: 'Each player discards their hand, then draws seven cards.',
      mana_cost: '{4}{R}{R}',
    }, 'reforge_stack_join_1');

    resolveTopOfStack(game as any);
    expect((game.state as any).zones?.[playerId]?.hand).toHaveLength(7);
    expect((game.state as any).stack || []).toHaveLength(0);

    const zones = await joinAndReadZones(reforgeJoinGameId, playerId, game);
    expect(zones?.[playerId]?.hand || []).toHaveLength(7);
    expect(zones?.[player2Id]?.hand || []).toHaveLength(7);
    expect(zones?.[playerId]?.graveyard?.map((entry: any) => entry.id))
      .toEqual(expect.arrayContaining(['p1_hand_1', 'p1_hand_2', 'reforge_join_1']));
  }, 15000);

  it('joinGame emits correct zones after Windfall fully resolves', async () => {
    const p1Hand = Array.from({ length: 3 }, (_, index) => ({
      id: `p1_hand_${index}`,
      name: `P1 Hand ${index}`,
      type_line: 'Instant',
    }));
    const p2Hand = Array.from({ length: 5 }, (_, index) => ({
      id: `p2_hand_${index}`,
      name: `P2 Hand ${index}`,
      type_line: 'Instant',
    }));
    const p1Library = Array.from({ length: 10 }, (_, index) => ({
      id: `p1_lib_${index}`,
      name: `P1 Library ${index}`,
      type_line: 'Instant',
    }));
    const p2Library = Array.from({ length: 10 }, (_, index) => ({
      id: `p2_lib_${index}`,
      name: `P2 Library ${index}`,
      type_line: 'Instant',
    }));

    createGameIfNotExists(windfallJoinGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(windfallJoinGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(windfallJoinGameId as any, game as any);
    setupTwoPlayerWheelGame(game, windfallJoinGameId, { p1Hand, p2Hand, p1Library, p2Library });

    queueStackSpell(game, {
      id: 'windfall_join_1',
      name: 'Windfall',
      type_line: 'Instant',
      oracle_text: 'Each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way.',
      mana_cost: '{2}{U}{U}',
    }, 'windfall_stack_join_1');

    resolveTopOfStack(game as any);

    const zones = await joinAndReadZones(windfallJoinGameId, playerId, game);
    expect(zones?.[playerId]?.hand || []).toHaveLength(5);
    expect(zones?.[player2Id]?.hand || []).toHaveLength(5);
  });

  it('joinGame emits correct zones after Echo of Eons fully resolves', async () => {
    const p1Hand = [{ id: 'p1_hand_1', name: 'Opt', type_line: 'Instant' }];
    const p2Hand = [{ id: 'p2_hand_1', name: 'Bolt', type_line: 'Instant' }];
    const p1Graveyard = [{ id: 'p1_gy_1', name: 'Shock', type_line: 'Instant' }];
    const p2Graveyard = [{ id: 'p2_gy_1', name: 'Counterspell', type_line: 'Instant' }];
    const p1Library = Array.from({ length: 10 }, (_, index) => ({
      id: `p1_lib_${index}`,
      name: `P1 Library ${index}`,
      type_line: 'Instant',
    }));
    const p2Library = Array.from({ length: 10 }, (_, index) => ({
      id: `p2_lib_${index}`,
      name: `P2 Library ${index}`,
      type_line: 'Instant',
    }));

    createGameIfNotExists(echoJoinGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(echoJoinGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(echoJoinGameId as any, game as any);
    setupTwoPlayerEchoGame(game, echoJoinGameId, {
      p1Hand,
      p2Hand,
      p1Graveyard,
      p2Graveyard,
      p1Library,
      p2Library,
    });

    queueStackSpell(game, {
      id: 'echo_join_1',
      name: 'Echo of Eons',
      type_line: 'Sorcery',
      oracle_text: 'Each player shuffles their hand and graveyard into their library, then draws seven cards.',
      mana_cost: '{4}{U}{U}',
    }, 'echo_stack_join_1');

    resolveTopOfStack(game as any);

    const zones = await joinAndReadZones(echoJoinGameId, playerId, game);
    expect(zones?.[playerId]?.hand || []).toHaveLength(7);
    expect(zones?.[player2Id]?.hand || []).toHaveLength(7);
    expect(zones?.[player2Id]?.graveyard || []).toHaveLength(0);
  });

  it('joinGame emits correct zones after Big Score fully resolves', async () => {
    const library = [
      { id: 'draw-1', name: 'Forest', type_line: 'Basic Land — Forest' },
      { id: 'draw-2', name: 'Island', type_line: 'Basic Land — Island' },
      { id: 'draw-3', name: 'Mountain', type_line: 'Basic Land — Mountain' },
      { id: 'bottom', name: 'Plains', type_line: 'Basic Land — Plains' },
    ];

    createGameIfNotExists(bigScoreJoinGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(bigScoreJoinGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(bigScoreJoinGameId as any, game as any);
    setupSinglePlayerLibraryGame(game, bigScoreJoinGameId, library);

    queueStackSpell(game, {
      id: 'big_score_join_1',
      name: 'Big Score',
      type_line: 'Sorcery',
      oracle_text: 'Draw three cards, then create two Treasure tokens.',
      mana_cost: '{4}{R}',
    }, 'big_score_stack_join_1');

    resolveTopOfStack(game as any);

    const zones = await joinAndReadZones(bigScoreJoinGameId, playerId, game);
    expect(zones?.[playerId]?.hand || []).toHaveLength(3);
    const treasureTokens = ((game.state as any).battlefield || []).filter(
      (entry: any) => String(entry?.name || entry?.card?.name || '').includes('Treasure'),
    );
    expect(treasureTokens.length).toBe(2);
  });

  it('joinGame emits correct zones after Inspiring Call fully resolves', async () => {
    const library = [
      { id: 'draw-1', name: 'Forest', type_line: 'Basic Land — Forest' },
      { id: 'draw-2', name: 'Island', type_line: 'Basic Land — Island' },
      { id: 'bottom', name: 'Mountain', type_line: 'Basic Land — Mountain' },
    ];

    createGameIfNotExists(inspiringCallJoinGameId, 'commander', 40, undefined, playerId);
    const game = ensureGame(inspiringCallJoinGameId);
    if (!game) throw new Error('ensureGame returned undefined');
    games.set(inspiringCallJoinGameId as any, game as any);
    setupSinglePlayerLibraryGame(game, inspiringCallJoinGameId, library);
    (game.state as any).battlefield = [
      {
        id: 'c1',
        controller: playerId,
        card: { name: 'Merfolk', type_line: 'Creature — Merfolk' },
        counters: { '+1/+1': 1 },
      },
      {
        id: 'c2',
        controller: playerId,
        card: { name: 'Elf', type_line: 'Creature — Elf' },
        counters: { '+1/+1': 2 },
      },
    ];

    queueStackSpell(game, {
      id: 'inspiring_call_join_1',
      name: 'Inspiring Call',
      type_line: 'Instant',
      oracle_text: 'Draw a card for each creature you control with a +1/+1 counter on it, then creatures you control with a +1/+1 counter on it gain indestructible until end of turn.',
      mana_cost: '{2}{G}',
    }, 'inspiring_call_stack_join_1');

    resolveTopOfStack(game as any);

    const zones = await joinAndReadZones(inspiringCallJoinGameId, playerId, game);
    expect(zones?.[playerId]?.hand || []).toHaveLength(2);
  });
});
