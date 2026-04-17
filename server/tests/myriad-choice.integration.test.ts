import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import GameManager from '../src/GameManager.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { chooseAIOptionSelectionsForStep } from '../src/socket/ai.js';
import { registerCombatHandlers } from '../src/socket/combat.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { applyEvent } from '../src/state/modules/applyEvent';
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

function seedCombatGame(gameId: string, playerId: string, defendingPlayerId: string, otherOpponentIds: string[] = []) {
  createGameIfNotExists(gameId, 'commander', 40);
  const game = ensureGame(gameId);
  if (!game) throw new Error('ensureGame returned undefined');

  const allPlayerIds = [playerId, defendingPlayerId, ...otherOpponentIds];
  (game as any).gameId = gameId;
  (game.state as any).players = allPlayerIds.map((id, index) => ({
    id,
    name: `P${index + 1}`,
    spectator: false,
    life: 40,
  }));
  (game.state as any).life = Object.fromEntries(allPlayerIds.map((id) => [id, 40]));
  (game.state as any).turnPlayer = playerId;
  (game.state as any).activePlayer = playerId;
  (game.state as any).priority = playerId;
  (game.state as any).phase = 'combat';
  (game.state as any).step = 'declareAttackers';
  (game.state as any).turn = 1;
  (game.state as any).turnNumber = 1;
  (game.state as any).stack = [];
  (game.state as any).battlefield = [];
  (game.state as any).pendingExileAtEndOfCombat = [];
  (game.state as any).tokensCreatedThisTurn = { [playerId]: 0 };
  (game.state as any).tokenCreatedThisTurn = { [playerId]: 0 };
  (game.state as any).createdTokenThisTurn = { [playerId]: 0 };
  (game.state as any).zones = Object.fromEntries(
    allPlayerIds.map((id) => [
      id,
      {
        hand: [],
        handCount: 0,
        graveyard: [],
        graveyardCount: 0,
        exile: [],
        exileCount: 0,
        library: [],
        libraryCount: 0,
      },
    ]),
  );

  return game;
}

function createMyriadAttacker(playerId: string) {
  return {
    id: 'myriad_attacker',
    controller: playerId,
    owner: playerId,
    tapped: false,
    counters: {},
    summoningSickness: false,
    basePower: 3,
    baseToughness: 3,
    card: {
      id: 'myriad_attacker_card',
      name: 'Myriad Attacker',
      type_line: 'Creature - Warrior',
      oracle_text:
        "Myriad (Whenever this creature attacks, for each opponent other than defending player, you may create a token that's a copy of this creature that's tapped and attacking that player. Exile the tokens at end of combat.)",
      keywords: ['Myriad'],
      power: '3',
      toughness: '3',
    },
  };
}

function findMyriadStep(gameId: string, playerId: PlayerID): any {
  const queue = ResolutionQueueManager.getQueue(gameId) as any;
  const activeStep = queue?.activeStep;
  if (
    activeStep &&
    String(activeStep?.playerId || '') === String(playerId) &&
    activeStep?.type === ResolutionStepType.OPTION_CHOICE &&
    activeStep?.myriadChoice === true
  ) {
    return activeStep;
  }

  return ResolutionQueueManager.getStepsForPlayer(gameId, playerId).find(
    (entry: any) => entry?.type === ResolutionStepType.OPTION_CHOICE && entry?.myriadChoice === true,
  );
}

function resolveUntilMyriadStep(game: any, gameId: string, playerId: PlayerID, maxResolutions = 4) {
  for (let attempt = 0; attempt < maxResolutions; attempt++) {
    if (findMyriadStep(gameId, playerId)) {
      return;
    }

    const stack = Array.isArray((game.state as any).stack) ? (game.state as any).stack : [];
    if (stack.length === 0) {
      return;
    }

    game.applyEvent({ type: 'resolveTopOfStack' });
  }
}

describe('myriad keyword automation (integration)', () => {
  const trackedGameIds = new Set<string>();
  const createGameId = () => `myriad_choice_keyword_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

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

  it('queues Myriad through the shared option-choice flow for other opponents', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const playerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const opponentA = 'p3' as PlayerID;
    const opponentB = 'p4' as PlayerID;
    const game = seedCombatGame(gameId, playerId, defendingPlayerId, [opponentA, opponentB]);

    (game.state as any).battlefield = [createMyriadAttacker(playerId)];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerCombatHandlers(io as any, socket as any);

    await handlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'myriad_attacker', targetPlayerId: defendingPlayerId }],
    });

    expect(((game.state as any).stack || []).some((item: any) => item?.triggerType === 'myriad')).toBe(true);
    resolveUntilMyriadStep(game, gameId, playerId);

    const step = findMyriadStep(gameId, playerId) as any;

    expect(step).toBeDefined();
    expect((step.options || []).map((entry: any) => entry.id)).toEqual([opponentA, opponentB]);
    expect(step.minSelections).toBe(0);
    expect(step.maxSelections).toBe(2);
    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
  });

  it('creates tapped attacking copies for the selected Myriad opponents and schedules end-of-combat exile', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const playerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const opponentA = 'p3' as PlayerID;
    const opponentB = 'p4' as PlayerID;
    const game = seedCombatGame(gameId, playerId, defendingPlayerId, [opponentA, opponentB]);

    (game.state as any).battlefield = [createMyriadAttacker(playerId)];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerCombatHandlers(io as any, socket as any);

    await handlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'myriad_attacker', targetPlayerId: defendingPlayerId }],
    });

    expect(((game.state as any).stack || []).some((item: any) => item?.triggerType === 'myriad')).toBe(true);
    resolveUntilMyriadStep(game, gameId, playerId);

    const step = findMyriadStep(gameId, playerId) as any;
    expect(step).toBeDefined();

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(step.id),
      selections: [opponentA, opponentB],
    });

    const battlefield = ((game.state as any).battlefield || []) as any[];
    const tokens = battlefield.filter((permanent: any) => permanent?.isToken === true);
    const delayed = ((game.state as any).pendingExileAtEndOfCombat || []) as any[];

    expect(tokens).toHaveLength(2);
    expect(tokens.map((permanent: any) => permanent.attacking).sort()).toEqual([opponentA, opponentB]);
    expect(tokens.every((permanent: any) => permanent.tapped)).toBe(true);
    expect(tokens.every((permanent: any) => permanent.card?.name === 'Myriad Attacker')).toBe(true);
    expect(delayed).toHaveLength(2);
    expect(delayed.map((entry: any) => entry.permanentId)).toEqual(tokens.map((permanent: any) => permanent.id));
    expect(delayed.every((entry: any) => entry.fireAtTurnNumber === 1)).toBe(true);
    expect((game.state as any).tokensCreatedThisTurn?.[playerId]).toBe(2);
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, playerId).some((entry: any) => entry?.myriadChoice === true)).toBe(false);
    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
  });

  it('allows declining Myriad by submitting no selections', async () => {
    const gameId = createGameId();
    trackedGameIds.add(gameId);
    const playerId = 'p1' as PlayerID;
    const defendingPlayerId = 'p2' as PlayerID;
    const opponentA = 'p3' as PlayerID;
    const opponentB = 'p4' as PlayerID;
    const game = seedCombatGame(gameId, playerId, defendingPlayerId, [opponentA, opponentB]);

    (game.state as any).battlefield = [createMyriadAttacker(playerId)];

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, emitted, gameId);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    registerCombatHandlers(io as any, socket as any);

    await handlers.declareAttackers({
      gameId,
      attackers: [{ creatureId: 'myriad_attacker', targetPlayerId: defendingPlayerId }],
    });

    expect(((game.state as any).stack || []).some((item: any) => item?.triggerType === 'myriad')).toBe(true);
    resolveUntilMyriadStep(game, gameId, playerId);

    const step = findMyriadStep(gameId, playerId) as any;
    expect(step).toBeDefined();

    await handlers.submitResolutionResponse({
      gameId,
      stepId: String(step.id),
      selections: [],
    });

    const battlefield = ((game.state as any).battlefield || []) as any[];
    const tokens = battlefield.filter((permanent: any) => permanent?.isToken === true);
    const delayed = ((game.state as any).pendingExileAtEndOfCombat || []) as any[];

    expect(tokens).toHaveLength(0);
    expect(delayed).toHaveLength(0);
    expect((game.state as any).tokensCreatedThisTurn?.[playerId]).toBe(0);
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, playerId).some((entry: any) => entry?.myriadChoice === true)).toBe(false);
    expect(emitted.some((entry) => entry.event === 'error')).toBe(false);
  });
});

describe('myriad replay and AI helpers', () => {
  it('replays myriadChoice by rebuilding the selected token copies from the saved source snapshot', () => {
    const ctx: any = {
      state: {
        players: [
          { id: 'p1', name: 'P1', spectator: false, life: 40 },
          { id: 'p2', name: 'P2', spectator: false, life: 40 },
          { id: 'p3', name: 'P3', spectator: false, life: 40 },
        ],
        battlefield: [],
        stack: [],
        zones: {},
        phase: 'combat',
        step: 'declareAttackers',
        turn: 1,
        turnNumber: 1,
        pendingExileAtEndOfCombat: [],
        tokensCreatedThisTurn: { p1: 0 },
        tokenCreatedThisTurn: { p1: 0 },
        createdTokenThisTurn: { p1: 0 },
      },
      bumpSeq() {},
    };

    applyEvent(ctx, {
      type: 'myriadChoice',
      playerId: 'p1',
      permanentId: 'myriad_attacker',
      sourceName: 'Myriad Attacker',
      sourcePermanentSnapshot: createMyriadAttacker('p1'),
      selectedOpponentIds: ['p2', 'p3'],
      createdPermanentIds: ['myriad_live_token_1', 'myriad_live_token_2'],
    } as any);

    const battlefield = (ctx.state.battlefield || []) as any[];
    const delayed = (ctx.state.pendingExileAtEndOfCombat || []) as any[];

    expect(battlefield.map((permanent: any) => permanent.id)).toEqual(['myriad_live_token_1', 'myriad_live_token_2']);
    expect(battlefield.map((permanent: any) => permanent.attacking).sort()).toEqual(['p2', 'p3']);
    expect(battlefield.every((permanent: any) => permanent.isToken === true)).toBe(true);
    expect(delayed.map((entry: any) => entry.permanentId)).toEqual(['myriad_live_token_1', 'myriad_live_token_2']);
    expect(ctx.state.tokensCreatedThisTurn?.p1).toBe(2);
  });

  it('AI selects every available opponent for Myriad option-choice prompts', () => {
    const decision = chooseAIOptionSelectionsForStep(
      { state: {} },
      'p1' as PlayerID,
      {
        myriadChoice: true,
        options: [
          { id: 'p2', label: 'P2' },
          { id: 'p3', label: 'P3' },
        ],
        minSelections: 0,
        maxSelections: 2,
      },
    );

    expect(decision).toEqual({
      selections: ['p2', 'p3'],
      cancelled: false,
    });
  });
});