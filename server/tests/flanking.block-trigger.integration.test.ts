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

function createFlankingAttacker(controller: string) {
  return {
    id: 'flanking_attacker',
    controller,
    owner: controller,
    tapped: false,
    summoningSickness: false,
    basePower: 2,
    baseToughness: 2,
    card: {
      id: 'flanking_attacker_card',
      name: 'Flanking Rider',
      type_line: 'Creature - Knight',
      oracle_text: 'Flanking',
      keywords: ['Flanking'],
      power: '2',
      toughness: '2',
    },
  };
}

function createPlainBlocker(controller: string) {
  return {
    id: 'plain_blocker',
    controller,
    owner: controller,
    tapped: false,
    summoningSickness: false,
    basePower: 2,
    baseToughness: 2,
    card: {
      id: 'plain_blocker_card',
      name: 'Plain Blocker',
      type_line: 'Creature - Soldier',
      oracle_text: '',
      power: '2',
      toughness: '2',
    },
  };
}

function createFlankingBlocker(controller: string) {
  return {
    id: 'flanking_blocker',
    controller,
    owner: controller,
    tapped: false,
    summoningSickness: false,
    basePower: 2,
    baseToughness: 2,
    card: {
      id: 'flanking_blocker_card',
      name: 'Flanking Blocker',
      type_line: 'Creature - Knight',
      oracle_text: 'Flanking',
      keywords: ['Flanking'],
      power: '2',
      toughness: '2',
    },
  };
}

describe('flanking block trigger automation', () => {
  const trackedGameIds = new Set<string>();
  const createGameId = () => `flanking_block_trigger_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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

  it('pushes and resolves a flanking trigger only for blockers without flanking', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    (game.state as any).battlefield = [
      createFlankingAttacker(attackingPlayerId),
      createPlainBlocker(defendingPlayerId),
      createFlankingBlocker(defendingPlayerId),
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const attackerSocket = createMockSocket(attackingPlayerId, emitted, gameId);
    const defenderSocket = createMockSocket(defendingPlayerId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket.socket, defenderSocket.socket]);
    registerCombatHandlers(io as any, attackerSocket.socket as any);
    registerCombatHandlers(io as any, defenderSocket.socket as any);

    await attackerSocket.handlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'flanking_attacker', targetPlayerId: defendingPlayerId }],
    });

    (game.state as any).step = 'declareBlockers';

    await defenderSocket.handlers.declareBlockers({
      gameId,
      blockers: [
        { blockerId: 'plain_blocker', attackerId: 'flanking_attacker' },
        { blockerId: 'flanking_blocker', attackerId: 'flanking_attacker' },
      ],
    });

    const stack = ((game.state as any).stack || []) as any[];
    const flankingTriggers = stack.filter((item: any) => item?.triggerType === 'flanking');
    expect(flankingTriggers).toHaveLength(1);
    expect(flankingTriggers[0]?.value?.blockingCreatureIds).toEqual(['plain_blocker']);

    const triggerEvent = getEvents(gameId).find((event) => {
      const payload = (event as any).payload || {};
      return event.type === 'pushTriggeredAbility' && payload.triggerType === 'flanking';
    });
    expect(triggerEvent).toBeTruthy();
    expect((triggerEvent as any)?.payload?.value?.blockingCreatureIds).toEqual(['plain_blocker']);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const battlefield = ((game.state as any).battlefield || []) as any[];
    const plainBlocker = battlefield.find((entry: any) => entry.id === 'plain_blocker');
    const flankingBlocker = battlefield.find((entry: any) => entry.id === 'flanking_blocker');

    expect(plainBlocker?.temporaryPowerBoost).toBe(-1);
    expect(plainBlocker?.temporaryToughnessBoost).toBe(-1);
    expect(getEffectivePower(plainBlocker)).toBe(1);
    expect(getEffectiveToughness(plainBlocker)).toBe(1);
    expect(flankingBlocker?.temporaryPowerBoost ?? 0).toBe(0);
    expect(flankingBlocker?.temporaryToughnessBoost ?? 0).toBe(0);
    expect(getEffectivePower(flankingBlocker)).toBe(2);
    expect(getEffectiveToughness(flankingBlocker)).toBe(2);
  });

  it('replays a persisted flanking trigger using the blocker snapshot from the stack item', () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackingPlayerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackingPlayerId, defendingPlayerId);

    const attacker = createFlankingAttacker(attackingPlayerId);
    (attacker as any).attacking = defendingPlayerId;
    (attacker as any).blockedBy = ['plain_blocker'];

    const plainBlocker = createPlainBlocker(defendingPlayerId);
    (plainBlocker as any).blocking = ['flanking_attacker'];

    (game.state as any).battlefield = [
      attacker,
      plainBlocker,
    ];

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'flanking_trigger_replay',
      sourceId: 'flanking_attacker',
      sourceName: 'Flanking Rider',
      controllerId: attackingPlayerId,
      description: 'Blocking creature without flanking gets -1/-1 until end of turn',
      triggerType: 'flanking',
      effect: 'Blocking creature without flanking gets -1/-1 until end of turn',
      mandatory: true,
      value: {
        blockingCreatureIds: ['plain_blocker'],
      },
      defendingPlayer: defendingPlayerId,
      triggeringPlayer: attackingPlayerId,
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const battlefield = ((game.state as any).battlefield || []) as any[];
    const replayedBlocker = battlefield.find((entry: any) => entry.id === 'plain_blocker');

    expect(replayedBlocker?.temporaryPowerBoost).toBe(-1);
    expect(replayedBlocker?.temporaryToughnessBoost).toBe(-1);
    expect(getEffectivePower(replayedBlocker)).toBe(1);
    expect(getEffectiveToughness(replayedBlocker)).toBe(1);
    expect(((game.state as any).stack || []).length).toBe(0);
  });
});