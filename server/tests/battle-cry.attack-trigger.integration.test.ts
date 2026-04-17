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
      type_line: 'Creature - Soldier',
      oracle_text: oracleText,
      power: String(basePower),
      toughness: String(baseToughness),
    },
  };
}

describe('battle cry attack trigger automation', () => {
  const trackedGameIds = new Set<string>();
  const createGameId = () => `battle_cry_attack_trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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

  it('pushes a battle cry trigger and buffs only the other attackers on resolution', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    (game.state as any).battlefield = [
      createCreature('battle_cry_attacker', attackingPlayerId, 'Battle Cry Attacker', 'Battle cry', 2, 2),
      createCreature('other_attacker', attackingPlayerId, 'Other Attacker', '', 2, 2),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const attackerSocket = createMockSocket(attackingPlayerId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket.socket]);
    registerCombatHandlers(io as any, attackerSocket.socket as any);

    await attackerSocket.handlers.declareAttackers({
      gameId,
      attackers: [
        { creatureId: 'battle_cry_attacker', targetPlayerId: defendingPlayerId },
        { creatureId: 'other_attacker', targetPlayerId: defendingPlayerId },
      ],
    });

    const stack = ((game.state as any).stack || []) as any[];
    const trigger = stack.find((item: any) => item?.source === 'battle_cry_attacker');
    expect(trigger?.triggerType).toBe('battle_cry');

    const triggerEvent = getEvents(gameId).find((event) => {
      const payload = (event as any).payload || {};
      return event.type === 'pushTriggeredAbility' && payload.triggerType === 'battle_cry';
    });
    expect(triggerEvent).toBeTruthy();

    const beforeResolveOther = ((game.state as any).battlefield || []).find((entry: any) => entry.id === 'other_attacker');
    expect(beforeResolveOther?.temporaryPowerBoost).toBeUndefined();

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const battlefield = ((game.state as any).battlefield || []) as any[];
    const sourceAttacker = battlefield.find((entry: any) => entry.id === 'battle_cry_attacker');
    const otherAttacker = battlefield.find((entry: any) => entry.id === 'other_attacker');

    expect(sourceAttacker?.temporaryPowerBoost ?? 0).toBe(0);
    expect(otherAttacker?.temporaryPowerBoost).toBe(1);
    expect(otherAttacker?.temporaryToughnessBoost).toBe(0);
    expect(getEffectivePower(otherAttacker)).toBe(3);
    expect(getEffectiveToughness(otherAttacker)).toBe(2);
    expect(Array.isArray(otherAttacker?.modifiers) ? otherAttacker.modifiers : []).toHaveLength(0);
  });

  it('replays a persisted battle cry trigger by buffing the other current attackers', () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    const sourceAttacker = createCreature('battle_cry_attacker', attackingPlayerId, 'Battle Cry Attacker', 'Battle cry', 2, 2);
    const otherAttacker = createCreature('other_attacker', attackingPlayerId, 'Other Attacker', '', 2, 2);
    (sourceAttacker as any).attacking = defendingPlayerId;
    (otherAttacker as any).attacking = defendingPlayerId;

    (game.state as any).battlefield = [sourceAttacker, otherAttacker];

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'battle_cry_trigger_replay',
      sourceId: 'battle_cry_attacker',
      sourceName: 'Battle Cry Attacker',
      controllerId: attackingPlayerId,
      description: 'Each other attacking creature gets +1/+0 until end of turn',
      triggerType: 'battle_cry',
      effect: 'Each other attacking creature gets +1/+0 until end of turn',
      mandatory: true,
      defendingPlayer: defendingPlayerId,
      triggeringPlayer: attackingPlayerId,
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const battlefield = ((game.state as any).battlefield || []) as any[];
    const replayedSource = battlefield.find((entry: any) => entry.id === 'battle_cry_attacker');
    const replayedOther = battlefield.find((entry: any) => entry.id === 'other_attacker');

    expect(replayedSource?.temporaryPowerBoost ?? 0).toBe(0);
    expect(replayedOther?.temporaryPowerBoost).toBe(1);
    expect(replayedOther?.temporaryToughnessBoost).toBe(0);
    expect(getEffectivePower(replayedOther)).toBe(3);
    expect(getEffectiveToughness(replayedOther)).toBe(2);
    expect(((game.state as any).stack || []).length).toBe(0);
  });
});