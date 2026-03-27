import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { initDb, createGameIfNotExists, getEvents } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { ensureGame } from '../src/socket/util.js';
import { registerCombatHandlers } from '../src/socket/combat.js';
import { games } from '../src/socket/socket.js';
import type { PlayerID } from '../../shared/src';

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

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false },
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

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

describe('combat trigger persistence', () => {
  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    games.clear();
  });

  it('persists attack trigger stack pushes as pushTriggeredAbility events', async () => {
    const gameId = `test_combat_trigger_persistence_${Date.now()}`;
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const p2 = 'p2';

    (game.state as any).players = [
      { id: p1, name: 'P1', spectator: false, life: 40 },
      { id: p2, name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).startingLife = 40;
    (game.state as any).life = { [p1]: 40, [p2]: 40 };
    (game.state as any).turnPlayer = p1;
    (game.state as any).step = 'declareAttackers';
    (game.state as any).phase = 'combat';
    (game.state as any).priority = p1;
    (game.state as any).zones = {
      [p1]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
      [p2]: { hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, exileCount: 0 },
    };
    (game.state as any).battlefield = [
      {
        id: 'attacker_1',
        controller: p1,
        owner: p1,
        basePower: 2,
        baseToughness: 2,
        tapped: false,
        summoningSickness: false,
        card: {
          id: 'attacker_card_1',
          name: 'Signal Scout',
          type_line: 'Creature — Scout',
          oracle_text: 'Whenever ~ attacks, draw a card.',
        },
      },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(p1, emitted);
    socket.rooms.add(gameId);
    (socket.data as any).gameId = gameId;

    const io = createMockIo(emitted, [socket]);
    registerCombatHandlers(io as any, socket as any);

    await handlers['declareAttackers']({
      gameId,
      attackers: [{ creatureId: 'attacker_1', targetPlayerId: p2 }],
    });

    const stack = (game.state as any).stack || [];
    expect(stack.some((item: any) => item?.type === 'triggered_ability' && String(item?.sourceName || '') === 'Signal Scout')).toBe(true);

    const events = getEvents(gameId);
    const triggerEvent = events.find((event) => event.type === 'pushTriggeredAbility');
    expect(triggerEvent).toBeTruthy();
    expect((triggerEvent as any).payload).toMatchObject({
      sourceName: 'Signal Scout',
      controllerId: p1,
      description: 'draw a card.',
      effect: 'draw a card.',
      triggerType: 'attacks',
      triggeringPlayer: p1,
    });
  });

  it('replays persisted combat trigger metadata including value and defending player', () => {
    const game = createInitialGameState('t_combat_trigger_replay');
    const p1 = 'p1' as PlayerID;

    addPlayer(game, p1, 'P1');

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'combat_trigger_1',
      sourceId: 'attacker_1',
      sourceName: 'Signal Scout',
      controllerId: p1,
      description: 'Signal Scout gets +2/+0 until end of turn.',
      triggerType: 'attacks',
      effect: 'Signal Scout gets +2/+0 until end of turn.',
      mandatory: true,
      value: 2,
      targetPlayer: 'p2',
      defendingPlayer: 'p2',
      triggeringPlayer: p1,
    } as any);

    const stack = (game.state as any).stack || [];
    expect(stack).toHaveLength(1);
    expect(stack[0]).toMatchObject({
      id: 'combat_trigger_1',
      sourceName: 'Signal Scout',
      value: 2,
      targetPlayer: 'p2',
      defendingPlayer: 'p2',
      triggeringPlayer: p1,
    });
  });
});
