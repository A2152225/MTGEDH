import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createGameIfNotExists, deleteGame, getEvents, initDb } from '../src/db/index.js';
import GameManager from '../src/GameManager.js';
import { registerResolutionHandlers } from '../src/socket/resolution.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';
import { createInitialGameState } from '../src/state/index.js';
import { triggerETBEffectsForPermanent } from '../src/state/modules/triggerEtbPermanentEffects.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { assertNoReplayDivergence, toReplayEvents } from './helpers/replayDivergence.js';

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

describe('riot haste keyword prompt socket replay', () => {
  const gameId = 'test_riot_haste_keyword_socket_replay';
  const replayGameId = `${gameId}_replay`;
  const playerId = 'p1' as PlayerID;

  beforeAll(async () => {
    await initDb();
  });

  beforeEach(async () => {
    await resetGame(gameId);
    await resetGame(replayGameId);
  });

  afterEach(async () => {
    await resetGame(gameId);
    await resetGame(replayGameId);
  });

  it('persists resolveTopOfStackPrompt when riot is queued via ETB and replays the pending prompt', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40, isAI: false }];
    (game.state as any).life = { [playerId]: 40 };
    (game as any).gameId = gameId;

    const riotPermanent = {
      id: 'riot_perm_etb',
      controller: playerId,
      owner: playerId,
      summoningSickness: true,
      counters: {},
      card: {
        name: 'Riot Test Creature',
        type_line: 'Creature — Beast',
        oracle_text: 'Riot (This creature enters the battlefield with your choice of a +1/+1 counter or haste.)',
      },
    };
    (game.state as any).battlefield = [riotPermanent];

    const eventStart = getEvents(gameId).length;
    triggerETBEffectsForPermanent(game as any, riotPermanent, playerId);

    const promptEvents = toReplayEvents(gameId, eventStart);
    expect(promptEvents.some((event: any) => event.type === 'resolveTopOfStackPrompt')).toBe(true);
    const promptEvent = promptEvents.find((event: any) => event.type === 'resolveTopOfStackPrompt') as any;
    expect(promptEvent?.queuedResolutionStep?.type).toBe(ResolutionStepType.RIOT_CHOICE);
    expect(promptEvent?.queuedResolutionStep?.permanentId).toBe('riot_perm_etb');

    const replayGame = createInitialGameState(replayGameId);
    (replayGame.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (replayGame.state as any).life = { [playerId]: 40 };
    (replayGame.state as any).battlefield = [{
      id: 'riot_perm_etb',
      controller: playerId,
      owner: playerId,
      summoningSickness: true,
      counters: {},
      card: { name: 'Riot Test Creature', type_line: 'Creature — Beast' },
    }];
    replayGame.replay!(promptEvents as any);

    const restoredStep = ResolutionQueueManager.getStepsForPlayer(replayGameId, playerId)
      .find((step: any) => step?.type === ResolutionStepType.RIOT_CHOICE);
    expect(restoredStep).toBeDefined();
    expect((restoredStep as any)?.permanentId).toBe('riot_perm_etb');
    expect((restoredStep as any)?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'counter' }),
        expect.objectContaining({ id: 'haste' }),
      ]),
    );
  });

  it('persists keywordPromptResolve and replays haste without re-prompting', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    (game.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40, isAI: false }];
    (game.state as any).life = { [playerId]: 40 };
    (game.state as any).battlefield = [{
      id: 'riot_perm',
      controller: playerId,
      owner: playerId,
      summoningSickness: true,
      counters: {},
      card: {
        name: 'Riot Test Creature',
        type_line: 'Creature — Beast',
        oracle_text: 'Riot',
      },
    }];
    (game as any).gameId = gameId;

    const emitted: Array<{ room?: string; event: string; payload: any }> = [];
    const { socket, handlers } = createMockSocket(playerId, gameId, emitted);
    const io = createMockIo(emitted, [socket]);
    registerResolutionHandlers(io as any, socket as any);
    (game as any).io = io;

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.RIOT_CHOICE,
      playerId,
      description: 'Riot Test Creature: choose +1/+1 counter or haste',
      mandatory: true,
      sourceId: 'riot_perm',
      sourceName: 'Riot Test Creature',
      permanentId: 'riot_perm',
      options: [
        { id: 'counter', label: '+1/+1 counter' },
        { id: 'haste', label: 'Haste' },
      ],
      minSelections: 1,
      maxSelections: 1,
    } as any);

    const eventStart = getEvents(gameId).length;
    const step = ResolutionQueueManager.getStepsForPlayer(gameId, playerId)[0];
    await handlers['submitResolutionResponse']({
      gameId,
      stepId: String((step as any).id),
      selections: ['haste'],
      cancelled: false,
    });

    const livePermanent = (game.state as any).battlefield.find((entry: any) => entry?.id === 'riot_perm');
    expect(livePermanent?.grantedAbilities).toContain('Haste');
    expect(livePermanent?.summoningSickness).toBe(false);
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, playerId)).toEqual([]);

    const replayEvents = toReplayEvents(gameId, eventStart);
    expect(replayEvents.some((event: any) =>
      event.type === 'keywordPromptResolve'
      && event.keyword === 'riot'
      && event.choiceId === 'haste',
    )).toBe(true);

    const replayGame = createInitialGameState(replayGameId);
    (replayGame.state as any).players = [{ id: playerId, name: 'P1', spectator: false, life: 40 }];
    (replayGame.state as any).life = { [playerId]: 40 };
    (replayGame.state as any).battlefield = [{
      id: 'riot_perm',
      controller: playerId,
      owner: playerId,
      summoningSickness: true,
      counters: {},
      card: { name: 'Riot Test Creature', type_line: 'Creature — Beast' },
    }];
    replayGame.replay!(replayEvents as any);

    const replayPermanent = (replayGame.state as any).battlefield.find((entry: any) => entry?.id === 'riot_perm');
    expect(replayPermanent?.grantedAbilities).toContain('Haste');
    expect(replayPermanent?.summoningSickness).toBe(false);
    expect(ResolutionQueueManager.getStepsForPlayer(replayGameId, playerId)).toEqual([]);

    assertNoReplayDivergence(game, replayGame);
  });
});
