import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src';
import { initDb } from '../src/db/index.js';
import { processPendingLimDulsVault } from '../src/socket/resolution.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { resolveTopOfStack } from '../src/state/modules/stack.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const LIM_DULS_VAULT_ORACLE = "Look at the top five cards of your library. As many times as you choose, you may pay 1 life, put those cards on the bottom of your library in any order, then look at the top five cards of your library. Then shuffle and put the last cards you looked at this way on top in any order.";

function addPlayer(game: any, id: PlayerID, name: string) {
  game.applyEvent({ type: 'join', playerId: id, name });
}

function initZones(game: any, playerId: PlayerID) {
  (game.state as any).zones = {
    ...(game.state as any).zones,
    [playerId]: {
      hand: [],
      handCount: 0,
      library: [],
      libraryCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
    },
  };
}

function resetGame(gameId: string) {
  ResolutionQueueManager.removeQueue(gameId);
}

describe("Lim-Dul's Vault live/replay semantics", () => {
  beforeAll(async () => {
    await initDb();
  });

  beforeEach(() => {
    for (const gameId of [
      't_lim_duls_vault_live_init',
      't_lim_duls_vault_continue_replay',
      't_lim_duls_vault_resolve_replay',
    ]) {
      resetGame(gameId);
    }
  });

  it('resolving the spell queues the initial vault prompt directly without pending staging', () => {
    const gameId = 't_lim_duls_vault_live_init';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    initZones(game, p1);

    game.importDeckResolved(p1, [
      { id: 'a', name: 'A', zone: 'library' },
      { id: 'b', name: 'B', zone: 'library' },
      { id: 'c', name: 'C', zone: 'library' },
      { id: 'd', name: 'D', zone: 'library' },
      { id: 'e', name: 'E', zone: 'library' },
      { id: 'f', name: 'F', zone: 'library' },
    ] as any);

    (game.state as any).stack = [
      {
        id: 'vault_stack_1',
        cardId: 'vault_stack_1',
        type: 'spell',
        controller: p1,
        card: {
          id: 'vault_card_1',
          name: "Lim-Dûl's Vault",
          type_line: 'Instant',
          oracle_text: LIM_DULS_VAULT_ORACLE,
        },
      },
    ];

    resolveTopOfStack(game as any);

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.type).toBe(ResolutionStepType.LIM_DULS_VAULT);
    expect((steps[0] as any)?.cards?.map((card: any) => card.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect((steps[0] as any)?.effectId).toBeTruthy();
    expect((game.state as any).pendingLimDulsVault).toBeUndefined();
  });

  it('replays a continue decision by updating life/library and rebuilding the next vault prompt', () => {
    const gameId = 't_lim_duls_vault_continue_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    initZones(game, p1);

    (game.state as any).life = { [p1]: 40 };
    (game.state as any).pendingLimDulsVault = {
      [p1]: {
        effectId: 'vault_1',
        sourceName: "Lim-Dûl's Vault",
        totalLifePaid: 0,
        queued: true,
      },
    };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.LIM_DULS_VAULT,
      playerId: p1,
      description: "Lim-Dul's Vault",
      mandatory: true,
      effectId: 'vault_1',
      cards: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
        { id: 'c', name: 'C' },
        { id: 'd', name: 'D' },
        { id: 'e', name: 'E' },
      ],
      currentLife: 40,
      totalLifePaid: 0,
    } as any);

    game.applyEvent({
      type: 'limDulsVaultContinue',
      playerId: p1,
      effectId: 'vault_1',
      sourceName: "Lim-Dûl's Vault",
      lifePaid: 1,
      totalLifePaid: 1,
      lifeAfter: 39,
      libraryAfter: [
        { id: 'f', name: 'F', zone: 'library' },
        { id: 'g', name: 'G', zone: 'library' },
        { id: 'h', name: 'H', zone: 'library' },
        { id: 'i', name: 'I', zone: 'library' },
        { id: 'j', name: 'J', zone: 'library' },
        { id: 'e', name: 'E', zone: 'library' },
        { id: 'd', name: 'D', zone: 'library' },
        { id: 'c', name: 'C', zone: 'library' },
        { id: 'b', name: 'B', zone: 'library' },
        { id: 'a', name: 'A', zone: 'library' },
      ],
    } as any);

    expect((game.state as any).life[p1]).toBe(39);
    expect((game as any).libraries.get(p1)?.map((card: any) => card.id)).toEqual(['f', 'g', 'h', 'i', 'j', 'e', 'd', 'c', 'b', 'a']);
    expect((game.state as any).pendingLimDulsVault?.[p1]?.queued).toBe(false);
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, p1)).toHaveLength(0);

    processPendingLimDulsVault({} as any, game, gameId);

    const nextSteps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    expect(nextSteps).toHaveLength(1);
    expect((nextSteps[0] as any)?.cards?.map((card: any) => card.id)).toEqual(['f', 'g', 'h', 'i', 'j']);
    expect((game.state as any).pendingLimDulsVault?.[p1]?.queued).toBe(true);
  });

  it('replays the final resolve event by clearing the pending prompt and restoring the chosen top-five order', () => {
    const gameId = 't_lim_duls_vault_resolve_replay';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    addPlayer(game, p1, 'P1');
    initZones(game, p1);

    (game.state as any).pendingLimDulsVault = {
      [p1]: {
        effectId: 'vault_2',
        sourceName: "Lim-Dûl's Vault",
        totalLifePaid: 2,
        queued: true,
      },
    };

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.LIM_DULS_VAULT,
      playerId: p1,
      description: "Lim-Dul's Vault",
      mandatory: true,
      effectId: 'vault_2',
      cards: [
        { id: 'u', name: 'U' },
        { id: 'v', name: 'V' },
        { id: 'w', name: 'W' },
        { id: 'x', name: 'X' },
        { id: 'y', name: 'Y' },
      ],
      currentLife: 38,
      totalLifePaid: 2,
    } as any);

    game.applyEvent({
      type: 'limDulsVaultResolve',
      playerId: p1,
      effectId: 'vault_2',
      sourceName: "Lim-Dûl's Vault",
      totalLifePaid: 2,
      orderedTopIds: ['x', 'w', 'v', 'u', 'y'],
      libraryAfter: [
        { id: 'x', name: 'X', zone: 'library' },
        { id: 'w', name: 'W', zone: 'library' },
        { id: 'v', name: 'V', zone: 'library' },
        { id: 'u', name: 'U', zone: 'library' },
        { id: 'y', name: 'Y', zone: 'library' },
        { id: 'rest_1', name: 'Rest 1', zone: 'library' },
        { id: 'rest_2', name: 'Rest 2', zone: 'library' },
      ],
    } as any);

    expect((game as any).libraries.get(p1)?.map((card: any) => card.id)).toEqual(['x', 'w', 'v', 'u', 'y', 'rest_1', 'rest_2']);
    expect((game.state as any).pendingLimDulsVault).toBeUndefined();
    expect(ResolutionQueueManager.getStepsForPlayer(gameId, p1)).toHaveLength(0);
  });
});