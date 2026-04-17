import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { registerCombatHandlers } from '../src/socket/combat.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
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

function seedCombatGame(gameId: string, attackerId: string, defendingPlayerId: string) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  (game as any).gameId = gameId;
  (game.state as any).players = [
    { id: attackerId, name: 'Attacker', spectator: false, life: 40 },
    { id: defendingPlayerId, name: 'Defender', spectator: false, life: 40 },
  ];
  (game.state as any).life = { [attackerId]: 40, [defendingPlayerId]: 40 };
  (game.state as any).turnPlayer = attackerId;
  (game.state as any).activePlayer = attackerId;
  (game.state as any).priority = attackerId;
  (game.state as any).phase = 'combat';
  (game.state as any).step = 'declareAttackers';
  (game.state as any).turn = 1;
  (game.state as any).turnNumber = 1;
  (game.state as any).stack = [];
  (game.state as any).battlefield = [];
  (game.state as any).zones = {
    [attackerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
    [defendingPlayerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
  };

  return game;
}

function createAnnihilatorAttacker(playerId: string) {
  return {
    id: 'annihilator_attacker',
    controller: playerId,
    owner: playerId,
    tapped: false,
    counters: {},
    summoningSickness: false,
    basePower: 7,
    baseToughness: 7,
    card: {
      id: 'annihilator_attacker_card',
      name: 'Annihilator Attacker',
      type_line: 'Creature - Eldrazi',
      oracle_text: 'Annihilator 2',
      keywords: ['Annihilator'],
      power: '7',
      toughness: '7',
    },
  };
}

function findAnnihilatorStep(gameId: string, playerId: PlayerID): any {
  const queue = ResolutionQueueManager.getQueue(gameId) as any;
  const activeStep = queue?.activeStep;
  if (
    activeStep &&
    String(activeStep?.playerId || '') === String(playerId) &&
    activeStep?.type === ResolutionStepType.TARGET_SELECTION &&
    activeStep?.annihilatorChoice === true
  ) {
    return activeStep;
  }

  return ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find(
    (entry: any) => entry?.type === ResolutionStepType.TARGET_SELECTION && entry?.annihilatorChoice === true,
  );
}

function resolveUntilAnnihilatorStep(game: any, gameId: string, playerId: PlayerID, maxResolutions = 4) {
  for (let attempt = 0; attempt < maxResolutions; attempt++) {
    if (findAnnihilatorStep(gameId, playerId)) {
      return;
    }

    const stack = Array.isArray((game.state as any).stack) ? (game.state as any).stack : [];
    if (stack.length === 0) {
      return;
    }

    game.applyEvent({ type: 'resolveTopOfStack' });
  }
}

describe('annihilator keyword automation (integration)', () => {
  const trackedGameIds = new Set<string>();
  const createGameId = () => `annihilator_choice_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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

  it('queues Annihilator through the shared target-selection flow for the defending player', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      createAnnihilatorAttacker(attackerId),
      { id: 'def_land', controller: defenderId, owner: defenderId, card: { name: 'Defender Land', type_line: 'Land' } },
      { id: 'def_relic', controller: defenderId, owner: defenderId, card: { name: 'Defender Relic', type_line: 'Artifact' } },
      { id: 'def_guard', controller: defenderId, owner: defenderId, basePower: 2, baseToughness: 2, card: { name: 'Defender Guard', type_line: 'Creature - Soldier', power: '2', toughness: '2' } },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: attackerSocket, handlers: attackerHandlers } = createMockSocket(attackerId, emitted, gameId);
    const { socket: defenderSocket } = createMockSocket(defenderId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket, defenderSocket]);
    registerResolutionHandlers(io as any, attackerSocket as any);
    registerResolutionHandlers(io as any, defenderSocket as any);
    registerCombatHandlers(io as any, attackerSocket as any);

    await attackerHandlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'annihilator_attacker', targetPlayerId: defenderId }],
    });

    expect(((game.state as any).stack || []).some((item: any) => item?.triggerType === 'annihilator')).toBe(true);
    resolveUntilAnnihilatorStep(game, gameId, defenderId);

    const step = findAnnihilatorStep(gameId, defenderId) as any;
    expect(step).toBeDefined();
    expect(step.minTargets).toBe(2);
    expect(step.maxTargets).toBe(2);
    expect((step.validTargets || []).map((entry: any) => entry.id)).toEqual(['def_land', 'def_relic', 'def_guard']);
    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
  });

  it('sacrifices the selected permanents and persists a replay-safe resolve event', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      createAnnihilatorAttacker(attackerId),
      { id: 'def_land', controller: defenderId, owner: defenderId, card: { name: 'Defender Land', type_line: 'Land' } },
      { id: 'def_relic', controller: defenderId, owner: defenderId, card: { name: 'Defender Relic', type_line: 'Artifact' } },
      { id: 'def_guard', controller: defenderId, owner: defenderId, basePower: 2, baseToughness: 2, card: { name: 'Defender Guard', type_line: 'Creature - Soldier', power: '2', toughness: '2' } },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: attackerSocket, handlers: attackerHandlers } = createMockSocket(attackerId, emitted, gameId);
    const { socket: defenderSocket, handlers: defenderHandlers } = createMockSocket(defenderId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket, defenderSocket]);
    registerResolutionHandlers(io as any, attackerSocket as any);
    registerResolutionHandlers(io as any, defenderSocket as any);
    registerCombatHandlers(io as any, attackerSocket as any);

    await attackerHandlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'annihilator_attacker', targetPlayerId: defenderId }],
    });

    resolveUntilAnnihilatorStep(game, gameId, defenderId);

    const step = findAnnihilatorStep(gameId, defenderId) as any;
    expect(step).toBeDefined();

    const eventStart = getEvents(gameId).length;
    await defenderHandlers.submitResolutionResponse({
      gameId,
      stepId: String(step.id),
      selections: ['def_land', 'def_relic'],
    });

    expect(((game.state as any).battlefield || []).map((perm: any) => perm.id)).toEqual([
      'annihilator_attacker',
      'def_guard',
    ]);
    expect((((game.state as any).zones?.[defenderId]?.graveyard) || []).map((card: any) => card.name)).toEqual([
      'Defender Land',
      'Defender Relic',
    ]);

    const resolveEvent = getEvents(gameId)
      .slice(eventStart)
      .find((event: any) => event?.type === 'sacrificeSelectionResolve') as any;
    expect(resolveEvent).toBeDefined();
    expect(resolveEvent.payload).toEqual({
      resolvedStepId: step.id,
      playerId: defenderId,
      sourceId: 'annihilator_attacker',
      sourceName: 'Annihilator Attacker',
      permanentType: 'permanent',
      permanentIds: ['def_land', 'def_relic'],
      reason: "Annihilator Attacker's Annihilator 2 triggered",
    });
    expect(findAnnihilatorStep(gameId, defenderId)).toBeUndefined();
    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
  });

  it('caps the required sacrifice count to the permanents the defending player actually controls', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const attackerId = 'p1' as PlayerID;
    const defenderId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, attackerId, defenderId);

    (game.state as any).battlefield = [
      createAnnihilatorAttacker(attackerId),
      { id: 'def_only', controller: defenderId, owner: defenderId, card: { name: 'Only Permanent', type_line: 'Artifact' } },
    ];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket: attackerSocket, handlers: attackerHandlers } = createMockSocket(attackerId, emitted, gameId);
    const { socket: defenderSocket } = createMockSocket(defenderId, emitted, gameId);
    const io = createMockIo(emitted, [attackerSocket, defenderSocket]);
    registerResolutionHandlers(io as any, attackerSocket as any);
    registerResolutionHandlers(io as any, defenderSocket as any);
    registerCombatHandlers(io as any, attackerSocket as any);

    await attackerHandlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'annihilator_attacker', targetPlayerId: defenderId }],
    });

    resolveUntilAnnihilatorStep(game, gameId, defenderId);

    const step = findAnnihilatorStep(gameId, defenderId) as any;
    expect(step).toBeDefined();
    expect(step.minTargets).toBe(1);
    expect(step.maxTargets).toBe(1);
    expect((step.validTargets || []).map((entry: any) => entry.id)).toEqual(['def_only']);
    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
  });
});