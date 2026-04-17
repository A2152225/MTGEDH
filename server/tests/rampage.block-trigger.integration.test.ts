import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerCombatHandlers } from '../src/socket/combat.js';
import { games } from '../src/socket/socket.js';
import { ensureGame, getEffectivePower, getEffectiveToughness } from '../src/socket/util.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import type { PlayerID } from '../../shared/src/index.js';

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
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

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>, gameId: string) {
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

function seedCombatGame(gameId: string, attackingPlayerId: string, defendingPlayerId: string) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  (game as any).gameId = gameId;
  (game.state as any).players = [
    { id: attackingPlayerId, name: 'Attacker', spectator: false, life: 40 },
    { id: defendingPlayerId, name: 'Defender', spectator: false, life: 40 },
  ];
  (game.state as any).life = { [attackingPlayerId]: 40, [defendingPlayerId]: 40 };
  (game.state as any).turnPlayer = attackingPlayerId;
  (game.state as any).activePlayer = attackingPlayerId;
  (game.state as any).priority = attackingPlayerId;
  (game.state as any).phase = 'combat';
  (game.state as any).step = 'declareAttackers';
  (game.state as any).turn = 1;
  (game.state as any).turnNumber = 1;
  (game.state as any).stack = [];
  (game.state as any).battlefield = [];
  (game.state as any).zones = {
    [attackingPlayerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
    [defendingPlayerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
  };

  return game;
}

function createCreature(id: string, controller: string, name: string, oracleText: string, basePower: number, baseToughness: number) {
  return {
    id,
    controller,
    owner: controller,
    tapped: false,
    summoningSickness: false,
    counters: {},
    basePower,
    baseToughness,
    card: {
      id: `${id}_card`,
      name,
      type_line: 'Creature - Beast',
      oracle_text: oracleText,
      power: String(basePower),
      toughness: String(baseToughness),
    },
  };
}

describe('rampage block trigger automation', () => {
  const trackedGameIds = new Set<string>();
  const createGameId = () => `rampage_block_trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    for (const gameId of trackedGameIds) {
      await resetGame(gameId);
    }
    trackedGameIds.clear();
  });

  afterEach(async () => {
    for (const gameId of trackedGameIds) {
      await resetGame(gameId);
    }
    trackedGameIds.clear();
  });

  it('pushes a rampage trigger and scales the bonus by extra blockers on resolution', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    (game.state as any).battlefield = [
      createCreature('rampage_attacker', attackingPlayerId, 'Rampage Attacker', 'Rampage 2', 2, 2),
      createCreature('blocker_one', defendingPlayerId, 'Blocker One', '', 2, 2),
      createCreature('blocker_two', defendingPlayerId, 'Blocker Two', '', 2, 2),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const attackerSocket = createMockSocket(attackingPlayerId, emitted, gameId);
    const defenderSocket = createMockSocket(defendingPlayerId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket.socket, defenderSocket.socket]);
    registerCombatHandlers(io as any, attackerSocket.socket as any);
    registerCombatHandlers(io as any, defenderSocket.socket as any);

    await attackerSocket.handlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'rampage_attacker', targetPlayerId: defendingPlayerId }],
    });

    (game.state as any).step = 'declareBlockers';

    await defenderSocket.handlers.declareBlockers({
      gameId,
      blockers: [
        { blockerId: 'blocker_one', attackerId: 'rampage_attacker' },
        { blockerId: 'blocker_two', attackerId: 'rampage_attacker' },
      ],
    });

    const stack = ((game.state as any).stack || []) as any[];
    const trigger = stack.find((item: any) => item?.source === 'rampage_attacker');
    expect(trigger?.triggerType).toBe('rampage');
    expect(trigger?.value?.blockingCreatureIds).toEqual(['blocker_one', 'blocker_two']);

    const triggerEvent = getEvents(gameId).find((event) => {
      const payload = (event as any).payload || {};
      return event.type === 'pushTriggeredAbility' && payload.triggerType === 'rampage';
    });
    expect(triggerEvent).toBeTruthy();

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const attacker = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'rampage_attacker');
    expect(attacker?.temporaryPowerBoost).toBe(2);
    expect(attacker?.temporaryToughnessBoost).toBe(2);
    expect(getEffectivePower(attacker)).toBe(4);
    expect(getEffectiveToughness(attacker)).toBe(4);
  });

  it('replays a persisted rampage trigger using the blocker snapshot on the stack item', () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    const attacker = createCreature('rampage_attacker', attackingPlayerId, 'Rampage Attacker', 'Rampage 2', 2, 2);
    (attacker as any).attacking = defendingPlayerId;
    (attacker as any).blockedBy = ['blocker_one', 'blocker_two'];

    const blockerOne = createCreature('blocker_one', defendingPlayerId, 'Blocker One', '', 2, 2);
    (blockerOne as any).blocking = ['rampage_attacker'];
    const blockerTwo = createCreature('blocker_two', defendingPlayerId, 'Blocker Two', '', 2, 2);
    (blockerTwo as any).blocking = ['rampage_attacker'];

    (game.state as any).battlefield = [attacker, blockerOne, blockerTwo];

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'rampage_trigger_replay',
      sourceId: 'rampage_attacker',
      sourceName: 'Rampage Attacker',
      controllerId: attackingPlayerId,
      description: '+2/+2 for each creature blocking beyond the first',
      triggerType: 'rampage',
      effect: '+2/+2 for each creature blocking beyond the first',
      mandatory: true,
      value: {
        blockingCreatureIds: ['blocker_one', 'blocker_two'],
      },
      defendingPlayer: defendingPlayerId,
      triggeringPlayer: attackingPlayerId,
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const replayedAttacker = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'rampage_attacker');
    expect(replayedAttacker?.temporaryPowerBoost).toBe(2);
    expect(replayedAttacker?.temporaryToughnessBoost).toBe(2);
    expect(getEffectivePower(replayedAttacker)).toBe(4);
    expect(getEffectiveToughness(replayedAttacker)).toBe(4);
    expect(((game.state as any).stack || []).length).toBe(0);
  });
});