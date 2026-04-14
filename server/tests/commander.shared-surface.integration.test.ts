import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { registerCommanderHandlers } from '../src/socket/commander.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: {
      sockets: new Map(),
    },
  } as any;
}

function createMockSocket(
  data: any,
  emitted: Array<{ room?: string; event: string; payload: any }>,
) {
  const handlers: Record<string, Function> = {};
  const socket = {
    id: 'sock_1',
    data,
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

const trackedGameIds: string[] = [];

function createTestGameId(label: string): string {
  const gameId = `test_commander_shared_surface_${label}_${Math.random().toString(36).slice(2, 10)}`;
  trackedGameIds.push(gameId);
  return gameId;
}

function createEmptyManaPool() {
  return { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
}

describe('commander shared-surface integration', () => {
  beforeAll(async () => {
    await initDb();
  });

  afterEach(() => {
    for (const gameId of trackedGameIds.splice(0)) {
      games.delete(gameId as any);
    }
  });

  it('casts a reduced-cost commander through the shared command-zone surface', async () => {
    const gameId = createTestGameId('reduced_cost');
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    Object.assign(game.state as any, {
      active: true,
      phase: 'main',
      step: 'MAIN1',
      turnPlayer: p1,
      priority: p1,
      players: [
        { id: p1, name: 'Player 1', spectator: false, life: 40 },
        { id: p2, name: 'Player 2', spectator: false, life: 40 },
      ],
      battlefield: [
        {
          id: 'mountain_1',
          controller: p1,
          tapped: false,
          card: {
            id: 'mountain_card_1',
            name: 'Mountain',
            type_line: 'Basic Land — Mountain',
            oracle_text: '{T}: Add {R}.',
          },
        },
        {
          id: 'ruby_medallion_1',
          controller: p1,
          tapped: false,
          card: {
            id: 'ruby_medallion_card',
            name: 'Ruby Medallion',
            type_line: 'Artifact',
            oracle_text: 'Red spells you cast cost {1} less to cast.',
          },
        },
      ],
      stack: [],
      zones: {
        [p1]: { hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0, libraryCount: 0 },
        [p2]: { hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0, libraryCount: 0 },
      },
      manaPool: {
        [p1]: createEmptyManaPool(),
        [p2]: createEmptyManaPool(),
      },
      commandZone: {
        [p1]: {
          commanderIds: ['cmd_red'],
          commanderNames: ['Red Commander'],
          commanderCards: [
            {
              id: 'cmd_red',
              name: 'Red Commander',
              type_line: 'Legendary Creature — Warrior',
              mana_cost: '{1}{R}',
              oracle_text: '',
            },
          ],
          inCommandZone: ['cmd_red'],
          taxById: { cmd_red: 0 },
        },
        [p2]: {
          commanderIds: [],
          commanderNames: [],
          commanderCards: [],
          inCommandZone: [],
          taxById: {},
        },
      },
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);
    registerCommanderHandlers(io as any, socket as any);

    await handlers['castCommander']({ gameId, commanderId: 'cmd_red' });

    const pendingCasts = Object.entries((game.state as any).pendingSpellCasts || {});
    expect(pendingCasts).toHaveLength(1);

    const [effectId, pendingCast] = pendingCasts[0] as [string, any];
    expect(pendingCast?.fromZone).toBe('command');

    await handlers['completeCastSpell']({
      gameId,
      cardId: 'cmd_red',
      effectId,
      payment: [{ permanentId: 'mountain_1', mana: 'R', count: 1 }],
    });

    expect(emitted.find((entry) => entry.event === 'error')).toBeUndefined();
    expect((game.state.stack || []).some((item: any) => String(item?.card?.id || '') === 'cmd_red')).toBe(true);
    expect(((game.state.commandZone as any)?.[p1]?.inCommandZone || [])).not.toContain('cmd_red');
    expect((game.state.commandZone as any)?.[p1]?.taxById?.cmd_red).toBe(2);
  });

  it('rejects non-flash commanders outside sorcery timing via the shared command-zone surface', async () => {
    const gameId = createTestGameId('timing');
    const p1 = 'p1';
    const p2 = 'p2';

    createGameIfNotExists(gameId, 'commander', 40, undefined, p1);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    Object.assign(game.state as any, {
      active: true,
      phase: 'combat',
      step: 'DECLARE_ATTACKERS',
      turnPlayer: p2,
      priority: p1,
      players: [
        { id: p1, name: 'Player 1', spectator: false, life: 40 },
        { id: p2, name: 'Player 2', spectator: false, life: 40 },
      ],
      battlefield: [],
      stack: [],
      zones: {
        [p1]: { hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0, libraryCount: 0 },
        [p2]: { hand: [], graveyard: [], exile: [], library: [], handCount: 0, graveyardCount: 0, exileCount: 0, libraryCount: 0 },
      },
      manaPool: {
        [p1]: createEmptyManaPool(),
        [p2]: createEmptyManaPool(),
      },
      commandZone: {
        [p1]: {
          commanderIds: ['cmd_sorcery'],
          commanderNames: ['Sorcery Commander'],
          commanderCards: [
            {
              id: 'cmd_sorcery',
              name: 'Sorcery Commander',
              type_line: 'Legendary Creature — Warrior',
              mana_cost: '{1}{R}',
              oracle_text: '',
            },
          ],
          inCommandZone: ['cmd_sorcery'],
          taxById: { cmd_sorcery: 0 },
        },
        [p2]: {
          commanderIds: [],
          commanderNames: [],
          commanderCards: [],
          inCommandZone: [],
          taxById: {},
        },
      },
    });

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket({ playerId: p1, spectator: false, gameId }, emitted);
    socket.rooms.add(gameId);

    const io = createMockIo(emitted);
    registerGameActions(io as any, socket as any);
    registerCommanderHandlers(io as any, socket as any);

    await handlers['castCommander']({ gameId, commanderId: 'cmd_sorcery' });

    const err = emitted.find((entry) => entry.event === 'error');
    expect(err?.payload?.code).toBe('SORCERY_TIMING');
  });
});