import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('oracle IR discard queue adapter', () => {
  it('queues discard selection prompts when hand size exceeds discard count', () => {
    const gameId = 'oracle_ir_discard_queue';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const handCards = [
      { id: 'card-1', name: 'Lightning Bolt', zone: 'hand' },
      { id: 'card-2', name: 'Counterspell', zone: 'hand' },
      { id: 'card-3', name: 'Forest', zone: 'hand' },
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

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'mind-rot-1',
      sourceName: 'Mind Rot',
    });

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      [
        {
          kind: 'discard',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 2 },
          raw: 'Discard two cards.',
        } as any,
      ],
      irCtx,
      { allowOptional: false },
      { controller: p1 },
    );

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const discardStep = steps.find((step) => step.type === ResolutionStepType.DISCARD_SELECTION);

    expect(discardStep).toBeTruthy();
    expect((discardStep as any)?.discardCount).toBe(2);
    expect((discardStep as any)?.hand).toHaveLength(3);
    expect((discardStep as any)?.sourceName).toBe('Mind Rot');
  });
});
