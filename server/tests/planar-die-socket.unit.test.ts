import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { handleRollPlanarDieRequest } from '../src/socket/planarDieSocketHandlers.js';

/** `rollPlanarDie` socket event: seat checks, timing errors reach the caller, success posts to chat. */

// ensureGame caches by id, so every test gets its own game.
let GAME_ID = 'unit_planar_die_socket';
let counter = 0;

function setup() {
  GAME_ID = `unit_planar_die_socket_${++counter}`;
  createGameIfNotExists(GAME_ID, 'commander', 40);
  const game: any = ensureGame(GAME_ID)!;
  Object.assign(game.state, {
    players: [
      { id: 'p1', name: 'Alice', spectator: false },
      { id: 'p2', name: 'Bob', spectator: false },
      { id: 'p3', name: 'Watcher', spectator: true },
    ],
    houseRules: { enablePlanechase: true },
    turnPlayer: 'p1',
    priority: 'p1',
    phase: 'precombatMain',
    step: 'MAIN1',
    stack: [],
    turnNumber: 0,
    currentPlane: { id: 'plane-1', name: 'Plane 1', type_line: 'Plane — Test', oracle_text: '' },
    planarDeckFaceDown: [{ id: 'plane-2', name: 'Plane 2', type_line: 'Plane — Test', oracle_text: '' }],
  });
  return game;
}

function connect(playerId: string, extra: Record<string, unknown> = {}) {
  const errors: any[] = [];
  const chats: any[] = [];
  const socket: any = {
    data: { gameId: GAME_ID, playerId, ...extra },
    rooms: new Set([GAME_ID]),
    emit: (event: string, payload: any) => {
      if (event === 'error') errors.push(payload);
    },
  };
  const io: any = {
    to: () => ({ emit: (event: string, payload: any) => event === 'chat' && chats.push(payload) }),
    emit: () => {},
    sockets: { sockets: new Map() },
  };
  return { socket, io, errors, chats };
}

describe('rollPlanarDie socket handler', () => {
  beforeAll(async () => {
    await initDb();
  });

  afterEach(async () => {
    ResolutionQueueManager.removeQueue(GAME_ID);
    games.delete(GAME_ID as any);
    await deleteGame(GAME_ID);
  });

  it('rolls for the active player and announces the result in chat', async () => {
    const game = setup();
    const { socket, io, errors, chats } = connect('p1');
    handleRollPlanarDieRequest(io, socket, { gameId: GAME_ID });
    expect(errors).toEqual([]);
    expect(game.state.planarDieSpecialActionsThisTurn).toEqual({ p1: 1 });
    expect(chats).toHaveLength(1);
    expect(chats[0].message).toMatch(/^Alice rolled the planar die: /);
  });

  it('tells a player who is not the active player why they cannot roll', async () => {
    const game = setup();
    const { socket, io, errors, chats } = connect('p2');
    handleRollPlanarDieRequest(io, socket, { gameId: GAME_ID });
    expect(errors[0]?.message).toMatch(/active player/);
    expect(chats).toHaveLength(0);
    expect(game.state.planarDieSpecialActionsThisTurn).toBeUndefined();
  });

  it('refuses spectators, players outside the game room, and a second roll with no mana', async () => {
    const game = setup();

    const spectator = connect('p3');
    handleRollPlanarDieRequest(spectator.io, spectator.socket, { gameId: GAME_ID });
    expect(spectator.errors[0]?.code).toBe('NOT_AUTHORIZED');

    const outside = connect('p1');
    outside.socket.rooms = new Set();
    handleRollPlanarDieRequest(outside.io, outside.socket, { gameId: GAME_ID });
    expect(outside.errors[0]?.code).toBe('NOT_IN_GAME');

    const first = connect('p1');
    handleRollPlanarDieRequest(first.io, first.socket, { gameId: GAME_ID });
    expect(first.errors).toEqual([]);
    // Walking away may have changed the plane, but the stack is still empty and it is still p1's main phase.
    const second = connect('p1');
    handleRollPlanarDieRequest(second.io, second.socket, { gameId: GAME_ID });
    expect(second.errors[0]?.message).toMatch(/costs \{1\}/);
    expect(game.state.planarDieSpecialActionsThisTurn).toEqual({ p1: 1 });
  });
});
