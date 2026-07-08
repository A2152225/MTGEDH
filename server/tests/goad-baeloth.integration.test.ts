import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, initDb } from '../src/db/index.js';
import { resetIntegrationGame } from './helpers/integrationGameReset.js';
import { registerGameActions } from '../src/socket/game-actions.js';
import { ensureGame } from '../src/socket/util.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { getCurrentGoaders } from '../src/state/modules/goad-effects.js';
import type { PlayerID } from '../../shared/src';

const BAELOTH_ORACLE =
  "Creatures your opponents control with power less than Baeloth Barrityl, Entertainer's power are goaded.\nWhenever a goaded attacking or blocking creature dies, you create a Treasure token.";

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, gameId, spectator: false },
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
  await resetIntegrationGame(gameId);
}

describe('Baeloth static goad (integration)', () => {
  const skipGameId = 'test_baeloth_static_goad_skip_combat';
  const deathGameId = 'test_baeloth_goaded_death_treasure';

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(skipGameId);
    await resetGame(deathGameId);
  });

  afterEach(async () => {
    await resetGame(skipGameId);
    await resetGame(deathGameId);
  });

  it('blocks skipToPhase past declare attackers when the active player controls a statically goaded creature that can attack', async () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    createGameIfNotExists(skipGameId, 'commander', 40, undefined, p2);
    const game = ensureGame(skipGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).turn = 3;
    (game.state as any).turnPlayer = p2;
    (game.state as any).priority = p2;
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p2]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'baeloth_1',
        controller: p1,
        owner: p1,
        basePower: 4,
        tapped: false,
        card: {
          name: 'Baeloth Barrityl, Entertainer',
          type_line: 'Legendary Creature — Elf Shaman',
          oracle_text: BAELOTH_ORACLE,
          power: '4',
          toughness: '5',
        },
      },
      {
        id: 'goblin_1',
        controller: p2,
        owner: p2,
        basePower: 2,
        tapped: false,
        enteredThisTurn: false,
        summoningSickness: false,
        card: {
          name: 'Goblin Guide',
          type_line: 'Creature — Goblin Scout',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
    ];

    const battlefield = (game.state as any).battlefield;
    expect(getCurrentGoaders(battlefield[1], battlefield, 3)).toEqual([p1]);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p2, skipGameId, emitted);
    registerGameActions(createMockIo(emitted), socket as any);

    await handlers['skipToPhase']({
      gameId: skipGameId,
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
    });

    const err = emitted.find((entry) => entry.event === 'error');
    expect(err?.payload?.code).toBe('SKIP_TO_PHASE');
    expect(String(err?.payload?.message || '')).toMatch(/goaded/i);
    expect(String((game.state as any).step || '')).toBe('MAIN1');
  });

  it('allows skipToPhase when opponent creatures are not statically goaded', async () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    createGameIfNotExists(skipGameId, 'commander', 40, undefined, p2);
    const game = ensureGame(skipGameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).turn = 3;
    (game.state as any).turnPlayer = p2;
    (game.state as any).priority = p2;
    (game.state as any).phase = 'precombatMain';
    (game.state as any).step = 'MAIN1';
    (game.state as any).stack = [];
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p2]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'baeloth_1',
        controller: p1,
        owner: p1,
        basePower: 4,
        tapped: false,
        card: {
          name: 'Baeloth Barrityl, Entertainer',
          type_line: 'Legendary Creature — Elf Shaman',
          oracle_text: BAELOTH_ORACLE,
          power: '4',
          toughness: '5',
        },
      },
      {
        id: 'behemoth_1',
        controller: p2,
        owner: p2,
        basePower: 5,
        tapped: false,
        enteredThisTurn: false,
        summoningSickness: false,
        card: {
          name: 'Craterhoof Behemoth',
          type_line: 'Legendary Creature — Beast',
          oracle_text: '',
          power: '5',
          toughness: '5',
        },
      },
    ];

    const battlefield = (game.state as any).battlefield;
    expect(getCurrentGoaders(battlefield[1], battlefield, 3)).toEqual([]);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p2, skipGameId, emitted);
    registerGameActions(createMockIo(emitted), socket as any);

    await handlers['skipToPhase']({
      gameId: skipGameId,
      targetPhase: 'postcombatMain',
      targetStep: 'MAIN2',
    });

    const err = emitted.find((entry) => entry.event === 'error' && /goaded/i.test(String(entry.payload?.message || '')));
    expect(err).toBeUndefined();
  });

  it('queues and resolves Baeloth treasure when a goaded attacking creature dies', () => {
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    const game = createInitialGameState(deathGameId);
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    (game.state as any).turn = 3;
    (game.state as any).battlefield = [
      {
        id: 'baeloth_1',
        controller: p1,
        owner: p1,
        basePower: 4,
        card: {
          name: 'Baeloth Barrityl, Entertainer',
          type_line: 'Legendary Creature — Elf Shaman',
          oracle_text: BAELOTH_ORACLE,
          power: '4',
          toughness: '5',
        },
      },
      {
        id: 'goblin_1',
        controller: p2,
        owner: p2,
        basePower: 2,
        attacking: p1,
        card: {
          name: 'Goblin Guide',
          type_line: 'Creature — Goblin Scout',
          oracle_text: '',
          power: '2',
          toughness: '2',
        },
      },
    ];
    (game.state as any).stack = [];

    const battlefieldBefore = (game.state as any).battlefield.length;
    game.movePermanentToGraveyard('goblin_1', true);

    const stack = (game.state as any).stack || [];
    expect(stack.some((item: any) =>
      item?.type === 'triggered_ability' &&
      item?.sourceName === 'Baeloth Barrityl, Entertainer' &&
      /create a treasure token/i.test(String(item?.effect || item?.description || '')),
    )).toBe(true);

    game.resolveTopOfStack();

    const battlefield = (game.state as any).battlefield || [];
    expect(battlefield.length).toBe(battlefieldBefore);
    expect(battlefield.some((perm: any) =>
      perm?.controller === p1 &&
      perm?.isToken === true &&
      /treasure/i.test(String(perm?.card?.name || '')),
    )).toBe(true);
  });
});
