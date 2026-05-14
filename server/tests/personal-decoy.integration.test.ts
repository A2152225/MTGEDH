import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { registerCombatHandlers } from '../src/socket/combat.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { movePermanentToHand } from '../src/state/modules/zones.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

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
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('Personal Decoy (integration)', () => {
  const gameId = 'test_personal_decoy_integration';

  beforeAll(async () => {
    await initDb();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('enters with loyalty equal to its controller life total and exiles instead of leaving the battlefield normally', () => {
    const game = createInitialGameState(gameId);
    const playerId = 'p1';
    const opponentId = 'p2';
    game.applyEvent({ type: 'join', playerId, name: 'P1' } as any);
    game.applyEvent({ type: 'join', playerId: opponentId, name: 'P2' } as any);
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 37, [opponentId]: 40 };
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
      [opponentId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };
    (game.state as any).battlefield = [];
    game.applyEvent({
      type: 'pushStack',
      item: {
        id: 'personal_decoy_spell_1',
        controller: playerId,
        source: 'hand',
        card: {
          id: 'personal_decoy_card_1',
          name: 'Personal Decoy',
          type_line: 'Planeswalker - Duck',
          mana_cost: '{5}{W}{U}',
          oracle_text: "Personal Decoy enters with a number of loyalty counters on it equal to your life total. If it would leave the battlefield, exile it instead of putting it anywhere else. You can't be attacked.\n+1: You gain 1 life.\n−4: Draw a card.",
          loyalty: '*',
        },
        targets: [],
      },
    } as any);

    game.resolveTopOfStack();

    const personalDecoy = ((game.state as any).battlefield || []).find(
      (permanent: any) => String(permanent?.card?.name || '') === 'Personal Decoy'
    ) as any;
    expect(personalDecoy).toBeDefined();
    expect(Number(personalDecoy?.counters?.loyalty || 0)).toBe(37);
    expect(Number(personalDecoy?.loyalty || 0)).toBe(37);
    expect(Number(personalDecoy?.baseLoyalty || 0)).toBe(37);
    expect(String(personalDecoy?.leaveBattlefieldReplacementDestination || '')).toBe('exile');
    expect(String(personalDecoy?.card?.leaveBattlefieldReplacementDestination || '')).toBe('exile');

    expect(movePermanentToHand(game as any, String(personalDecoy.id || ''))).toBe(true);
    expect((((game.state as any).zones?.[playerId]?.hand || []) as any[]).map((card: any) => String(card?.id || ''))).not.toContain('personal_decoy_card_1');
    expect((((game.state as any).zones?.[playerId]?.exile || []) as any[]).map((card: any) => String(card?.id || ''))).toContain('personal_decoy_card_1');
  });

  it('prevents opponents from declaring attacks against its controller', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const playerId = 'p1';
    const opponentId = 'p2';
    (game.state as any).players = [
      { id: playerId, name: 'P1', spectator: false, life: 40 },
      { id: opponentId, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
    (game.state as any).turn = 3;
    (game.state as any).turnPlayer = opponentId;
    (game.state as any).activePlayer = opponentId;
    (game.state as any).step = 'declareAttackers';
    (game.state as any).phase = 'combat';
    (game.state as any).manaPool = {
      [playerId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
      [opponentId]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 },
    };
    (game.state as any).zones = {
      [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
      [opponentId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'personal_decoy_perm_1',
        controller: playerId,
        owner: playerId,
        tapped: false,
        counters: { loyalty: 40 },
        loyalty: 40,
        baseLoyalty: 40,
        leaveBattlefieldReplacementDestination: 'exile',
        card: {
          id: 'personal_decoy_card_1',
          name: 'Personal Decoy',
          type_line: 'Planeswalker - Duck',
          oracle_text: "Personal Decoy enters with a number of loyalty counters on it equal to your life total. If it would leave the battlefield, exile it instead of putting it anywhere else. You can't be attacked.\n+1: You gain 1 life.\n−4: Draw a card.",
          loyalty: '*',
          leaveBattlefieldReplacementDestination: 'exile',
        },
      },
      {
        id: 'attacker_1',
        controller: opponentId,
        owner: opponentId,
        tapped: false,
        summoningSickness: false,
        counters: {},
        basePower: 2,
        baseToughness: 2,
        card: {
          id: 'attacker_card_1',
          name: 'Runeclaw Bear',
          type_line: 'Creature - Bear',
          power: '2',
          toughness: '2',
          oracle_text: '',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(opponentId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerCombatHandlers(io as any, socket as any);

    await handlers['declareAttackers']({
      gameId,
      attackers: [{ creatureId: 'attacker_1', targetPlayerId: playerId }],
    });

    const errorEvent = emitted.find((entry) => entry.event === 'error');
    expect(errorEvent).toBeDefined();
    expect(String(errorEvent?.payload?.message || '').toLowerCase()).toContain("can't be attacked");
    expect(((game.state as any).battlefield || []).find((permanent: any) => String(permanent?.id || '') === 'attacker_1')?.attacking).toBeFalsy();
  });
});