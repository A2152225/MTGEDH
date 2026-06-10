import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { buildDiscardSelectionOptions } from '../../rules-engine/src/oracleIRExecutorPlayerStepHandlers.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('oracle IR any-number discard queue adapter', () => {
  it('queues variable-count discard selection for creature cards', () => {
    const gameId = 'oracle_ir_any_number_discard_queue';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const handCards = [
      { id: 'bear-1', name: 'Grizzly Bears', type_line: 'Creature — Bear', zone: 'hand' },
      { id: 'bolt-1', name: 'Lightning Bolt', type_line: 'Instant', zone: 'hand' },
      { id: 'elf-1', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid', zone: 'hand' },
    ];

    (game.state as any).zones = {
      [p1]: {
        hand: handCards,
        handCount: handCards.length,
        graveyard: [],
        graveyardCount: 0,
      },
    };
    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.hand = handCards.map((card) => ({ ...card }));

    const step = {
      kind: 'discard',
      who: { kind: 'you' },
      amount: { kind: 'any_number' },
      target: { kind: 'raw', text: 'creature cards' },
      optional: true,
      raw: 'You may discard any number of creature cards.',
    } as any;

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'wildfire-1',
      sourceName: 'Wildfire',
    });

    const built = buildDiscardSelectionOptions(game.state as any, step, irCtx);
    expect(built?.anyNumberDiscard).toBe(true);
    expect(built?.options.map((option) => option.id)).toEqual(['bear-1', 'elf-1']);

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    applyOracleIRStepsOnServer(ctx, game.state as any, [step], irCtx, { allowOptional: false }, { controller: p1 });

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const discardStep = steps.find((entry) => entry.type === ResolutionStepType.DISCARD_SELECTION);

    expect(discardStep).toBeTruthy();
    expect((discardStep as any)?.anyNumberDiscard).toBe(true);
    expect((discardStep as any)?.minDiscardCount).toBe(0);
    expect((discardStep as any)?.maxDiscardCount).toBe(2);
    expect((discardStep as any)?.hand).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'bear-1' }),
        expect.objectContaining({ id: 'elf-1' }),
      ])
    );
  });
});
