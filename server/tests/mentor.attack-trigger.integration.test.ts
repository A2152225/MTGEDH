import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { registerCombatHandlers } from '../src/socket/combat.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

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

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  GameManager.deleteGame(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

function seedCombatGame(gameId: string, playerId: string, opponentId: string) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  (game as any).gameId = gameId;
  (game.state as any).players = [
    { id: playerId, name: 'P1', spectator: false, life: 40, isAI: false },
    { id: opponentId, name: 'P2', spectator: false, life: 40, isAI: false },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
  (game.state as any).phase = 'combat';
  (game.state as any).step = 'declareAttackers';
  (game.state as any).turnPlayer = playerId;
  (game.state as any).activePlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).stack = [];
  (game.state as any).battlefield = [];
  (game.state as any).zones = {
    [playerId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
    [opponentId]: { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
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
      type_line: 'Creature — Soldier',
      oracle_text: oracleText,
      power: String(basePower),
      toughness: String(baseToughness),
    },
  };
}

describe('mentor attack trigger automation', () => {
  const trackedGameIds = new Set<string>();

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

  it('pushes a mentor trigger on live declare attackers and resolves through the queue', async () => {
    const gameId = `mentor_attack_trigger_${Date.now()}`;
    trackedGameIds.add(gameId);
    const playerId = 'p1' as PlayerID;
    const opponentId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, playerId, opponentId);

    const mentorPermanent = createCreature(
      'mentor_perm',
      playerId,
      'Mentor Test Creature',
      'Mentor (Whenever this creature attacks, put a +1/+1 counter on target attacking creature with lesser power.)',
      3,
      3
    );
    const smallerAttacker = createCreature('mentee_small', playerId, 'Small Attacker', '', 2, 2);
    const equalAttacker = createCreature('mentee_equal', playerId, 'Equal Attacker', '', 3, 3);

    (game.state as any).battlefield.push(mentorPermanent, smallerAttacker, equalAttacker);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerCombatHandlers(io as any, socket as any);

    await handlers.declareAttackers({
      gameId,
      attackers: [
        { creatureId: 'mentor_perm', targetPlayerId: opponentId },
        { creatureId: 'mentee_small', targetPlayerId: opponentId },
        { creatureId: 'mentee_equal', targetPlayerId: opponentId },
      ],
    });

    const stack = ((game.state as any).stack || []) as any[];
    const mentorTrigger = stack.find((item: any) => item?.source === 'mentor_perm');
    expect(mentorTrigger?.triggerType).toBe('mentor');

    const triggerEvent = getEvents(gameId).find((event) => {
      const payload = (event as any).payload || {};
      return event.type === 'pushTriggeredAbility' && payload.triggerType === 'mentor';
    });
    expect(triggerEvent).toBeTruthy();

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find(
      (entry: any) => entry?.type === ResolutionStepType.MENTOR_TARGET
    ) as any;
    expect(step).toBeDefined();
    expect((step.targets || []).map((target: any) => target.id)).toEqual(['mentee_small']);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(step.id),
      selections: ['mentee_small'],
    });

    const updatedPermanent = ((game.state as any).battlefield || []).find((entry: any) => entry?.id === 'mentee_small');
    expect(updatedPermanent?.counters?.['+1/+1']).toBe(1);
    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
  });

  it('replays a persisted mentor trigger into a mentor target queue step', async () => {
    const gameId = `mentor_attack_trigger_replay_${Date.now()}`;
    trackedGameIds.add(gameId);
    const playerId = 'p1' as PlayerID;
    const opponentId = 'p2' as PlayerID;
    const game = seedCombatGame(gameId, playerId, opponentId);

    const mentorPermanent = createCreature(
      'mentor_perm',
      playerId,
      'Mentor Test Creature',
      'Mentor (Whenever this creature attacks, put a +1/+1 counter on target attacking creature with lesser power.)',
      3,
      3
    );
    const smallerAttacker = createCreature('mentee_small', playerId, 'Small Attacker', '', 2, 2);
    (mentorPermanent as any).attacking = opponentId;
    (smallerAttacker as any).attacking = opponentId;

    (game.state as any).battlefield.push(mentorPermanent, smallerAttacker);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    game.applyEvent({
      type: 'pushTriggeredAbility',
      triggerId: 'mentor_trigger_replay',
      sourceId: 'mentor_perm',
      sourceName: 'Mentor Test Creature',
      controllerId: playerId,
      description: 'Put a +1/+1 counter on target attacking creature with lesser power',
      triggerType: 'mentor',
      effect: 'Put a +1/+1 counter on target attacking creature with lesser power',
      mandatory: true,
      defendingPlayer: opponentId,
      triggeringPlayer: playerId,
    } as any);

    game.applyEvent({ type: 'resolveTopOfStack' } as any);

    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find(
      (entry: any) => entry?.type === ResolutionStepType.MENTOR_TARGET
    ) as any;
    expect(step).toBeDefined();
    expect((step.targets || []).map((target: any) => target.id)).toEqual(['mentee_small']);

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(step.id),
      selections: ['mentee_small'],
    });

    const updatedPermanent = ((game.state as any).battlefield || []).find((entry: any) => entry?.id === 'mentee_small');
    expect(updatedPermanent?.counters?.['+1/+1']).toBe(1);
  });
});