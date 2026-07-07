import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { registerInteractionHandlers } from '../src/socket/interaction.js';
import { initializePriorityResolutionHandler, registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { createInitialGameState } from '../src/state/index.js';
import { queueSelfETBTriggersForPermanent } from '../src/state/modules/triggerEtbEntryEffects.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { getStackItems } from '../../rules-engine/src/stackOperations.js';
import { assertNoReplayDivergence, toReplayEvents } from './helpers/replayDivergence.js';

function createNoopIo() {
  return {
    to: (_room: string) => ({ emit: (_event: string, _payload: any) => undefined }),
    emit: (_event: string, _payload: any) => undefined,
    sockets: { sockets: new Map() },
  } as any;
}

function createMockIo(emitted: Array<{ room?: string; event: string; payload: any }>, sockets: any[] = []) {
  return {
    to: (room: string) => ({
      emit: (event: string, payload: any) => emitted.push({ room, event, payload }),
    }),
    emit: (event: string, payload: any) => emitted.push({ event, payload }),
    sockets: { sockets: new Map(sockets.map((socket, index) => [`s_${index}`, socket])) },
  } as any;
}

function createMockSocket(playerId: string, gameId: string, emitted: Array<{ room?: string; event: string; payload: any }>) {
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

function seedVengefulAncestorBoard(game: any, playerId: PlayerID, opponentId: PlayerID) {
  const vengefulOracleText =
    'Flying\nWhenever this creature enters or attacks, goad target creature. (Until your next turn, that creature attacks each combat if able and attacks a player other than you if able.)\nWhenever a goaded creature attacks, it deals 1 damage to its controller.';

  (game.state as any).players = [
    { id: playerId, name: 'P1', spectator: false, life: 40, isAI: false },
    { id: opponentId, name: 'P2', spectator: false, life: 40, isAI: false },
  ];
  (game.state as any).startingLife = 40;
  (game.state as any).life = { [playerId]: 40, [opponentId]: 40 };
  (game.state as any).phase = 'main1';
  (game.state as any).step = 'MAIN1';
  (game.state as any).turnPlayer = playerId;
  (game.state as any).turnNumber = 4;
  (game.state as any).priority = playerId;
  (game.state as any).stack = [];
  (game.state as any).battlefield = [
    {
      id: 'opponent_creature',
      controller: opponentId,
      owner: opponentId,
      tapped: false,
      counters: {},
      card: { id: 'bear_card', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
    },
  ];
  (game.state as any).zones = {
    [playerId]: { hand: [], graveyard: [], handCount: 0, graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
    [opponentId]: { hand: [], graveyard: [], handCount: 0, graveyardCount: 0, exile: [], exileCount: 0, library: [], libraryCount: 0 },
  };

  return {
    sourcePermanent: {
      id: 'ancestor_perm',
      controller: playerId,
      owner: playerId,
      tapped: false,
      summoningSickness: true,
      counters: {},
      card: {
        id: 'ancestor_card',
        name: 'Vengeful Ancestor',
        type_line: 'Creature — Spirit',
        oracle_text: vengefulOracleText,
        power: '3',
        toughness: '4',
      },
    },
  };
}

describe('Vengeful Ancestor goad ETB replay integration', () => {
  const gameId = 'test_vengeful_ancestor_goad_replay';
  const replayGameId = `${gameId}_replay`;
  const playerId = 'p1' as PlayerID;
  const opponentId = 'p2' as PlayerID;

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo() as any);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  beforeEach(async () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';
    await resetGame(gameId);
    await resetGame(replayGameId);
  });

  afterEach(async () => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    await resetGame(gameId);
    await resetGame(replayGameId);
  });

  it('persists target choice and goad mutation, then replays without re-prompting', { timeout: 60_000 }, async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const { sourcePermanent } = seedVengefulAncestorBoard(game, playerId, opponentId);
    (game.state as any).battlefield.push(sourcePermanent);
    (game as any).gameId = gameId;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerInteractionHandlers(io as any, socket as any);
    registerResolutionHandlers(io as any, socket as any);
    (game as any).io = io;

    const eventStart = getEvents(gameId).length;

    queueSelfETBTriggersForPermanent(game as any, sourcePermanent, playerId);

    const triggerItem = getStackItems((game.state as any).stack)
      .find((item: any) => item?.type === 'triggered_ability' && item?.sourceName === 'Vengeful Ancestor');
    expect(triggerItem).toBeDefined();
    expect(triggerItem?.needsTargetSelection || triggerItem?.requiresTarget).toBeTruthy();

    game.resolveTopOfStack();

    const targetStep = ResolutionQueueManager.getStepsForPlayer(gameId, playerId)
      .find((step: any) => step?.type === ResolutionStepType.TARGET_SELECTION);
    expect(targetStep).toBeDefined();

    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((targetStep as any).id),
      selections: ['opponent_creature'],
      cancelled: false,
    });

    game.resolveTopOfStack();

    const liveTarget = (game.state as any).battlefield.find((entry: any) => entry?.id === 'opponent_creature');
    expect(Array.isArray(liveTarget?.goadedBy) ? liveTarget.goadedBy.includes(playerId) : false).toBe(true);
    expect(liveTarget?.goadedUntil?.[playerId]).toBe(5);
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, playerId)).toEqual([]);

    const replayEvents = toReplayEvents(gameId, eventStart);
    expect(replayEvents.map((event: any) => event.type)).toEqual(
      expect.arrayContaining([
        'pushTriggeredAbility',
        'resolveTopOfStackPrompt',
        'assignTriggeredAbilityTargets',
        'goadPermanent',
      ]),
    );
    expect(replayEvents.some((event: any) =>
      event.type === 'assignTriggeredAbilityTargets'
      && event.targets?.includes('opponent_creature'),
    )).toBe(true);
    expect(replayEvents.some((event: any) =>
      event.type === 'goadPermanent'
      && event.permanentId === 'opponent_creature'
      && event.goaderId === playerId,
    )).toBe(true);

    const replayGame = createInitialGameState(replayGameId);
    const replaySeed = seedVengefulAncestorBoard(replayGame, playerId, opponentId);
    (replayGame.state as any).battlefield.push(replaySeed.sourcePermanent);

    if (typeof replayGame.replay !== 'function') {
      throw new Error('replayGame.replay is not available');
    }

    replayGame.replay(replayEvents as any);

    const replayTarget = (replayGame.state as any).battlefield.find((entry: any) => entry?.id === 'opponent_creature');
    expect(Array.isArray(replayTarget?.goadedBy) ? replayTarget.goadedBy.includes(playerId) : false).toBe(true);
    expect(replayTarget?.goadedUntil?.[playerId]).toBe(5);
    expect(ResolutionQueueManager.getStepsForPlayer(replayGameId, playerId)).toEqual([]);
    expect(ResolutionQueueManager.getStepsForPlayer(replayGameId, playerId)
      .some((step: any) => step?.type === ResolutionStepType.TARGET_SELECTION)).toBe(false);

    assertNoReplayDivergence(game, replayGame);
  });
});
