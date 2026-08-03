import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { initDb, createGameIfNotExists, deleteGame } from '../src/db/index.js';
import { ensureGame } from '../src/socket/util.js';
import { games } from '../src/socket/socket.js';
import { ResolutionQueueManager, ResolutionStepStatus } from '../src/state/resolution/index.js';
import { tryQueueMoxDiamondBeforeStackResolve } from '../src/state/modules/mox-diamond-choice.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';

async function resetGame(gameId: string) {
  games.delete(gameId as any);
  await deleteGame(gameId);
  ResolutionQueueManager.removeQueue(gameId);
}

describe('Mox Diamond replacement on stack resolve', () => {
  const gameId = `test_mox_diamond_defer_${Date.now()}`;

  beforeAll(async () => {
    await initDb();
  });

  afterEach(async () => {
    await resetGame(gameId);
  });

  it('defers ETB and offers lands in hand (including City of Brass)', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const landId = 'city_of_brass_1';
    const moxStackId = 'mox_stack_1';

    (game.state as any).id = gameId;
    (game as any).gameId = gameId;
    (game.state as any).zones = {
      [p1]: {
        hand: [
          {
            id: landId,
            name: 'City of Brass',
            type_line: 'Land',
          },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
      },
    };
    (game.state as any).stack = [
      {
        id: moxStackId,
        type: 'spell',
        controller: p1,
        card: {
          id: 'mox_card_1',
          name: 'Mox Diamond',
          type_line: 'Artifact',
          oracle_text:
            "If this artifact would enter, you may discard a land card instead. If you do, put this artifact onto the battlefield. If you don't, put it into its owner's graveyard.\n{T}: Add one mana of any color.",
        },
      },
    ];
    (game.state as any).battlefield = [];

    expect(tryQueueMoxDiamondBeforeStackResolve(game)).toBe(true);

    const ctx = {
      gameId,
      state: game.state,
      bumpSeq: () => game.bumpSeq?.(),
    } as any;

    resolveTopOfStack(ctx);

    expect((game.state as any).stack).toHaveLength(1);
    expect((game.state as any).battlefield).toHaveLength(0);

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1 as any);
    const moxStep = steps.find((s: any) => s.moxDiamondChoice === true) as any;
    expect(moxStep).toBeTruthy();
    expect(moxStep.options?.some((o: any) => o.id === landId)).toBe(true);
  });

  it('does not queue a second discard-land prompt when Smart Pass re-resolves', () => {
    createGameIfNotExists(gameId, 'commander', 40);
    const game = ensureGame(gameId);
    if (!game) throw new Error('ensureGame returned undefined');

    const p1 = 'p1';
    const landId = 'city_of_brass_1';
    const moxStackId = 'mox_stack_1';

    (game.state as any).id = gameId;
    (game as any).gameId = gameId;
    (game.state as any).zones = {
      [p1]: {
        hand: [{ id: landId, name: 'City of Brass', type_line: 'Land' }],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
      },
    };
    (game.state as any).stack = [
      {
        id: moxStackId,
        type: 'spell',
        controller: p1,
        card: {
          id: 'mox_card_1',
          name: 'Mox Diamond',
          type_line: 'Artifact',
          oracle_text:
            "If this artifact would enter, you may discard a land card instead. If you do, put this artifact onto the battlefield. If you don't, put it into its owner's graveyard.\n{T}: Add one mana of any color.",
        },
      },
    ];
    (game.state as any).battlefield = [];

    expect(tryQueueMoxDiamondBeforeStackResolve(game)).toBe(true);

    const firstSteps = ResolutionQueueManager.getQueue(gameId).steps.filter(
      (s: any) => s.moxDiamondChoice === true,
    );
    expect(firstSteps).toHaveLength(1);

    // Simulate client activating the prompt (ACTIVE status) then Smart Pass
    // attempting to resolve the still-deferred stack object again.
    ResolutionQueueManager.activateStep(gameId, String(firstSteps[0].id));
    expect(firstSteps[0].status).toBe(ResolutionStepStatus.ACTIVE);

    const ctx = {
      gameId,
      state: game.state,
      bumpSeq: () => game.bumpSeq?.(),
    } as any;

    expect(tryQueueMoxDiamondBeforeStackResolve(game)).toBe(true);
    resolveTopOfStack(ctx);
    expect(tryQueueMoxDiamondBeforeStackResolve(game)).toBe(true);

    const moxSteps = ResolutionQueueManager.getQueue(gameId).steps.filter(
      (s: any) => s.moxDiamondChoice === true,
    );
    expect(moxSteps).toHaveLength(1);
    expect((game.state as any).stack).toHaveLength(1);
    expect((game.state as any).stack[0].wouldEnterDiscardLandDeferred).toBe(true);
    expect((game.state as any).battlefield).toHaveLength(0);
  });
});
