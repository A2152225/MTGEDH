import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { registerCombatHandlers } from '../src/socket/combat.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
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

function createNoopIo() {
  return {
    to: (_room: string) => ({
      emit: (_event: string, _payload: any) => undefined,
    }),
    emit: (_event: string, _payload: any) => undefined,
  } as any;
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

function createAttacker(controller: string) {
  return {
    id: 'sole_attacker',
    controller,
    owner: controller,
    tapped: false,
    summoningSickness: false,
    basePower: 2,
    baseToughness: 2,
    card: {
      id: 'sole_attacker_card',
      name: 'Sole Attacker',
      type_line: 'Creature - Soldier',
      oracle_text: '',
      power: '2',
      toughness: '2',
    },
  };
}

function createExaltedSource(controller: string) {
  return {
    id: 'exalted_support',
    controller,
    owner: controller,
    tapped: false,
    summoningSickness: false,
    basePower: 1,
    baseToughness: 3,
    card: {
      id: 'exalted_support_card',
      name: 'Exalted Support',
      type_line: 'Creature - Cleric',
      oracle_text: 'Exalted',
      keywords: ['Exalted'],
      power: '1',
      toughness: '3',
    },
  };
}

describe('exalted attack trigger automation', () => {
  const trackedGameIds = new Set<string>();
  const createGameId = () => `exalted_attack_trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
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

  it('buffs the sole attacker instead of the nonattacking exalted source permanent', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    (game.state as any).battlefield = [
      createAttacker(attackingPlayerId),
      createExaltedSource(attackingPlayerId),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(attackingPlayerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerCombatHandlers(io as any, socket as any);

    await handlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'sole_attacker', targetPlayerId: defendingPlayerId }],
    });

    expect(((game.state as any).stack || []).some((item: any) => item?.triggerType === 'exalted')).toBe(true);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const battlefield = ((game.state as any).battlefield || []) as any[];
    const attacker = battlefield.find((entry: any) => entry.id === 'sole_attacker');
    const support = battlefield.find((entry: any) => entry.id === 'exalted_support');

    expect(attacker?.temporaryPowerBoost).toBe(1);
    expect(attacker?.temporaryToughnessBoost).toBe(1);
    expect(getEffectivePower(attacker)).toBe(3);
    expect(getEffectiveToughness(attacker)).toBe(3);
    expect(support?.temporaryPowerBoost ?? 0).toBe(0);
    expect(support?.temporaryToughnessBoost ?? 0).toBe(0);
    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
  });

  it('replays an exalted triggered ability by boosting the sole current attacker on stack resolution', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    const attacker = createAttacker(attackingPlayerId);
    (attacker as any).attacking = defendingPlayerId;

    (game.state as any).battlefield = [
      attacker,
      createExaltedSource(attackingPlayerId),
    ];

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'exalted_trigger_replay',
      sourceId: 'exalted_support',
      sourceName: 'Exalted Support',
      controllerId: attackingPlayerId,
      description: '+1/+1 to attacking creature (when attacking alone)',
      triggerType: 'exalted',
      effect: '+1/+1 to attacking creature (when attacking alone)',
      mandatory: true,
      defendingPlayer: defendingPlayerId,
      triggeringPlayer: attackingPlayerId,
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const battlefield = ((game.state as any).battlefield || []) as any[];
    const replayedAttacker = battlefield.find((entry: any) => entry.id === 'sole_attacker');
    const support = battlefield.find((entry: any) => entry.id === 'exalted_support');

    expect(replayedAttacker?.temporaryPowerBoost).toBe(1);
    expect(replayedAttacker?.temporaryToughnessBoost).toBe(1);
    expect(getEffectivePower(replayedAttacker)).toBe(3);
    expect(getEffectiveToughness(replayedAttacker)).toBe(3);
    expect(support?.temporaryPowerBoost ?? 0).toBe(0);
    expect(support?.temporaryToughnessBoost ?? 0).toBe(0);
    expect(((game.state as any).stack || []).length).toBe(0);
  });
});