import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { createGameIfNotExists, deleteGame, initDb } from '../src/db/index.js';
import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import {
  initializePriorityResolutionHandler,
  registerResolutionHandlers,
} from '../src/socket/resolution.js';
import { handleAIResolutionStep } from '../src/socket/ai.js';
import { games } from '../src/socket/socket.js';
import { ensureGame } from '../src/socket/util.js';

const ORACLE_TEXT =
  'Starting with you, each player separates all permanents they control into three piles. Then each player chooses one of their piles at random and sacrifices those permanents. (Piles can be empty.)';

function createNoopIo() {
  return {
    to: () => ({ emit: () => undefined }),
    emit: () => undefined,
    sockets: { sockets: new Map() },
  } as any;
}

function createMockSocket(playerId: string, gameId: string) {
  const handlers: Record<string, Function> = {};
  const socket = {
    data: { playerId, spectator: false, gameId },
    rooms: new Set([gameId]),
    on: (event: string, handler: Function) => {
      handlers[event] = handler;
    },
    emit: () => undefined,
  } as any;
  return { socket, handlers };
}

async function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
  games.delete(gameId as any);
  await deleteGame(gameId);
}

describe('Whims of the Fates generic pile resolution', () => {
  const gameId = 'test_whims_of_the_fates';

  beforeAll(async () => {
    await initDb();
    initializePriorityResolutionHandler(createNoopIo());
  });

  beforeEach(async () => resetGame(gameId));
  afterEach(async () => resetGame(gameId));

  it('prompts each player for three piles, then randomly sacrifices one pile each', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId) as any;
    const p1 = 'p1';
    const p2 = 'p2';
    game.state.players = [
      { id: p1, name: 'P1', spectator: false, life: 40, graveyard: [] },
      { id: p2, name: 'P2', spectator: false, life: 40, graveyard: [] },
    ];
    game.state.zones = {
      [p1]: { graveyard: [] },
      [p2]: { graveyard: [] },
    };
    game.state.battlefield = [p1, p2].flatMap((playerId) =>
      [0, 1, 2].map((index) => ({
        id: `${playerId}_perm_${index}`,
        owner: playerId,
        controller: playerId,
        tapped: false,
        counters: {},
        card: {
          id: `${playerId}_card_${index}`,
          name: `${playerId} Permanent ${index}`,
          type_line: 'Artifact',
        },
      })),
    );
    game.gameId = gameId;
    game.rng = () => 0;

    const steps = parseOracleTextToIR(ORACLE_TEXT, 'Whims of the Fates').abilities[0].steps;
    applyOracleIRStepsOnServer(
      game,
      game.state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: p1,
        sourceId: 'whims_spell',
        sourceName: 'Whims of the Fates',
      }),
      { allowOptional: true, haltOnPlayerChoiceRequired: true },
      { controller: p1, sourceName: 'Whims of the Fates', sourceId: 'whims_spell' },
    );

    const firstStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (step: any) => step.type === ResolutionStepType.TWO_PILE_SPLIT,
    ) as any;
    expect(firstStep).toMatchObject({ playerId: p1, pileCount: 3, minPerPile: 0 });
    expect(firstStep.items).toHaveLength(3);

    const firstSocket = createMockSocket(p1, gameId);
    registerResolutionHandlers(createNoopIo(), firstSocket.socket);
    await firstSocket.handlers.submitResolutionResponse({
      gameId,
      stepId: firstStep.id,
      selections: {
        piles: [['p1_perm_0'], ['p1_perm_1'], ['p1_perm_2']],
      },
    });

    const secondStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (step: any) =>
        step.type === ResolutionStepType.TWO_PILE_SPLIT
        && step.playerId === p2,
    ) as any;
    expect(secondStep).toMatchObject({ playerId: p2, pileCount: 3 });
    expect(secondStep.items).toHaveLength(3);

    const secondSocket = createMockSocket(p2, gameId);
    registerResolutionHandlers(createNoopIo(), secondSocket.socket);
    await secondSocket.handlers.submitResolutionResponse({
      gameId,
      stepId: secondStep.id,
      selections: {
        piles: [['p2_perm_0'], ['p2_perm_1'], ['p2_perm_2']],
      },
    });

    expect(ResolutionQueueManager.getQueue(gameId).steps).toEqual([]);
    const remainingIds = game.state.battlefield.map((perm: any) => perm.id);
    expect(remainingIds).not.toContain('p1_perm_0');
    expect(remainingIds).not.toContain('p2_perm_0');
    expect(remainingIds).toEqual(expect.arrayContaining([
      'p1_perm_1',
      'p1_perm_2',
      'p2_perm_1',
      'p2_perm_2',
    ]));
  });

  it('advances the same sequential pile flow for AI choosers', async () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId) as any;
    game.state.players = [
      { id: 'ai1', name: 'AI 1', spectator: false, life: 40, graveyard: [] },
      { id: 'ai2', name: 'AI 2', spectator: false, life: 40, graveyard: [] },
    ];
    game.state.zones = { ai1: { graveyard: [] }, ai2: { graveyard: [] } };
    game.state.battlefield = ['ai1', 'ai2'].flatMap((playerId) =>
      [0, 1, 2].map((index) => ({
        id: `${playerId}_${index}`,
        owner: playerId,
        controller: playerId,
        counters: {},
        card: { id: `${playerId}_card_${index}`, name: `${playerId} ${index}`, type_line: 'Artifact' },
      })),
    );
    game.gameId = gameId;

    const steps = parseOracleTextToIR(ORACLE_TEXT, 'Whims of the Fates').abilities[0].steps;
    applyOracleIRStepsOnServer(
      game,
      game.state,
      steps,
      buildOracleIRExecutionContext({
        controllerId: 'ai1',
        sourceId: 'whims_spell',
        sourceName: 'Whims of the Fates',
      }),
      { allowOptional: true, haltOnPlayerChoiceRequired: true },
      { controller: 'ai1', sourceName: 'Whims of the Fates', sourceId: 'whims_spell' },
    );

    const firstStep = ResolutionQueueManager.getQueue(gameId).steps[0] as any;
    await handleAIResolutionStep(createNoopIo(), gameId, 'ai1' as any, firstStep);
    const secondStep = ResolutionQueueManager.getQueue(gameId).steps.find(
      (step: any) => step.playerId === 'ai2',
    ) as any;
    expect(secondStep).toBeDefined();

    await handleAIResolutionStep(createNoopIo(), gameId, 'ai2' as any, secondStep);
    expect(ResolutionQueueManager.getPendingSummary(gameId).hasPending).toBe(false);
    expect(game.state.battlefield).toHaveLength(4);
  });
});
