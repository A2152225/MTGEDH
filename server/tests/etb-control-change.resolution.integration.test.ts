import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { triggerETBEffectsForPermanent } from '../src/state/modules/stack.js';
import { setPermanentPrepared } from '../src/state/modules/prepared.js';
import { games } from '../src/socket/socket.js';
import { registerResolutionHandlers, initializePriorityResolutionHandler } from '../src/socket/resolution.js';
import { ensureGame } from '../src/socket/util.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => undefined }),
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

function createMockSocket(playerId: string, emitted: Array<{ room?: string; event: string; payload: any }>, gameId?: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set<string>(),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: (event: string, payload: any) => {
      emitted.push({ event, payload });
    },
  } as any;

  if (gameId) {
    socket.rooms.add(gameId);
  }

  return { socket, handlers };
}

function buildPreparedEtbControlCard() {
  return {
    id: 'prepared_etb_control_card',
    name: 'Prepared Envoy // Timely Deflection',
    layout: 'prepare',
    mana_cost: '{2}{U} // {1}{U}',
    type_line: 'Creature — Human Advisor // Instant',
    colors: ['U'],
    color_identity: ['U'],
    card_faces: [
      {
        name: 'Prepared Envoy',
        mana_cost: '{2}{U}',
        type_line: 'Creature — Human Advisor',
        oracle_text: "This creature enters prepared. (While it's prepared, you may cast a copy of its spell. Doing so unprepares it.)",
        power: '2',
        toughness: '3',
      },
      {
        name: 'Timely Deflection',
        mana_cost: '{1}{U}',
        type_line: 'Instant',
        oracle_text: 'Return target attacking creature to its owner\'s hand.',
      },
    ],
  };
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('etb control change via resolution queue (integration)', () => {
  const gameId = 'test_etb_control_change_resolution_prepared';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    await resetGame(gameId);
    await resetGame(`${gameId}_replay`);
  });

  afterEach(async () => {
    await resetGame(gameId);
    await resetGame(`${gameId}_replay`);
  });

  it('enforces opponent-only ETB control change selection and replays prepared migration', async () => {
    const preparedCard = buildPreparedEtbControlCard();
    const frontFace = preparedCard.card_faces[0];

    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: 'p1', name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).turnOrder = ['p1', 'p2'];
    (game.state as any).turnPlayer = 'p1';
    (game.state as any).turnDirection = 1;
    (game.state as any).turnNumber = 5;
    (game.state as any).life = { p1: 40, p2: 40 };
    (game.state as any).zones = {
      p1: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
      p2: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };

    const permanent = {
      id: 'perm_prepared_etb_control',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      counters: {},
      summoningSickness: false,
      card: {
        ...preparedCard,
        name: frontFace.name,
        mana_cost: frontFace.mana_cost,
        type_line: frontFace.type_line,
        oracle_text: frontFace.oracle_text,
        zone: 'battlefield',
      },
      pendingControlChange: {
        type: 'enters_under_opponent_control',
        originalOwner: 'p1',
      },
    } as any;
    (game.state as any).battlefield = [permanent];
    setPermanentPrepared((game.state as any), permanent);

    triggerETBEffectsForPermanent(game as any, permanent, 'p1' as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    const step = queue.steps[0] as any;
    expect(step.type).toBe(ResolutionStepType.PLAYER_CHOICE);
    expect(step.opponentOnly).toBe(true);
    expect(step.permanentId).toBe('perm_prepared_etb_control');
    expect(step.players).toEqual([
      expect.objectContaining({ id: 'p2', isOpponent: true, isSelf: false }),
    ]);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: ['p1'] });

    const invalidSelection = emitted.find((entry) => entry.event === 'error');
    expect(invalidSelection?.payload).toMatchObject({ code: 'INVALID_SELECTION' });
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(1);
    expect((game.state as any).battlefield[0].controller).toBe('p1');

    emitted.length = 0;
    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: ['p2'] });

    const updatedPermanent = (game.state as any).battlefield[0];
    expect(updatedPermanent.controller).toBe('p2');
    expect(updatedPermanent.pendingControlChange).toBeUndefined();
    expect((game.state as any).zones.p1.exile).toHaveLength(0);
    expect((game.state as any).zones.p2.exile).toHaveLength(1);
    expect((game.state as any).zones.p2.exile[0]).toMatchObject({
      canBePlayedBy: 'p2',
      preparedSourcePermanentId: 'perm_prepared_etb_control',
    });
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);

    const persisted = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'playerSelection') as any;
    expect(persisted).toBeDefined();
    expect(persisted.payload).toMatchObject({
      choosingPlayerId: 'p1',
      selectedPlayerId: 'p2',
      effectType: 'control_change',
      permanentId: 'perm_prepared_etb_control',
    });

    const replayGame = createInitialGameState(`${gameId}_replay`);
    (replayGame.state as any).players = [
      { id: 'p1', name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (replayGame.state as any).turnOrder = ['p1', 'p2'];
    (replayGame.state as any).turnPlayer = 'p1';
    (replayGame.state as any).turnDirection = 1;
    (replayGame.state as any).turnNumber = 5;
    (replayGame.state as any).zones = {
      p1: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
      p2: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };

    const replayPermanent = {
      id: 'perm_prepared_etb_control',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      counters: {},
      summoningSickness: false,
      card: {
        ...preparedCard,
        name: frontFace.name,
        mana_cost: frontFace.mana_cost,
        type_line: frontFace.type_line,
        oracle_text: frontFace.oracle_text,
        zone: 'battlefield',
      },
      pendingControlChange: {
        type: 'enters_under_opponent_control',
        originalOwner: 'p1',
      },
    } as any;
    (replayGame.state as any).battlefield = [replayPermanent];
    setPermanentPrepared((replayGame.state as any), replayPermanent);

    replayGame.applyEvent({
      type: 'playerSelection',
      ...((persisted as any).payload || {}),
    } as any);

    const replayUpdatedPermanent = (replayGame.state as any).battlefield[0];
    expect(replayUpdatedPermanent.controller).toBe('p2');
    expect(replayUpdatedPermanent.pendingControlChange).toBeUndefined();
    expect((replayGame.state as any).zones.p1.exile).toHaveLength(0);
    expect((replayGame.state as any).zones.p2.exile).toHaveLength(1);
    expect((replayGame.state as any).zones.p2.exile[0]).toMatchObject({
      canBePlayedBy: 'p2',
      preparedSourcePermanentId: 'perm_prepared_etb_control',
    });
  });

  it('queues and resolves mandatory opponent_gains ETB control changes', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [
      { id: 'p1', name: 'P1', spectator: false, life: 40 },
      { id: 'p2', name: 'P2', spectator: false, life: 40 },
    ];
    (game.state as any).turnOrder = ['p1', 'p2'];
    (game.state as any).turnPlayer = 'p1';
    (game.state as any).turnDirection = 1;
    (game.state as any).turnNumber = 5;
    (game.state as any).life = { p1: 40, p2: 40 };
    (game.state as any).zones = {
      p1: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
      p2: { hand: [], handCount: 0, library: [], libraryCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 },
    };
    const permanent = {
      id: 'perm_mandatory_etb_control',
      controller: 'p1',
      owner: 'p1',
      tapped: false,
      counters: {},
      summoningSickness: false,
      card: {
        id: 'akroan_horse_test',
        name: 'Akroan Horse',
        type_line: 'Artifact Creature — Horse',
        oracle_text: 'When Akroan Horse enters the battlefield, an opponent gains control of it.',
        zone: 'battlefield',
      },
      pendingControlChange: {
        type: 'opponent_gains',
        originalOwner: 'p1',
      },
    } as any;
    (game.state as any).battlefield = [permanent];

    triggerETBEffectsForPermanent(game as any, permanent, 'p1' as any);

    const queue = ResolutionQueueManager.getQueue(gameId);
    expect(queue.steps).toHaveLength(1);
    const step = queue.steps[0] as any;
    expect(step.type).toBe(ResolutionStepType.PLAYER_CHOICE);
    expect(step.mandatory).toBe(true);
    expect(step.opponentOnly).toBe(true);
    expect(step.players).toEqual([
      expect.objectContaining({ id: 'p2' }),
    ]);

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket('p1', emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);

    await handlers['submitResolutionResponse']({ gameId, stepId: step.id, selections: ['p2'] });

    expect((game.state as any).battlefield[0].controller).toBe('p2');
    expect((game.state as any).battlefield[0].pendingControlChange).toBeUndefined();
    expect(ResolutionQueueManager.getQueue(gameId).steps).toHaveLength(0);

    const persisted = [...getEvents(gameId)].reverse().find((event: any) => event.type === 'playerSelection') as any;
    expect(persisted?.payload).toMatchObject({
      choosingPlayerId: 'p1',
      selectedPlayerId: 'p2',
      effectType: 'control_change',
      permanentId: 'perm_mandatory_etb_control',
    });
  });
});