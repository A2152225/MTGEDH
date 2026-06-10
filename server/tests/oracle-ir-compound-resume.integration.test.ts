import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  applyOracleIRStepsOnServer,
  resumeOracleIRRemainingStepsFromResolution,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('oracle IR compound step resume', () => {
  it('halts before draw and resumes remaining steps after discard is resolved', () => {
    const gameId = 'oracle_ir_discard_then_draw';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const handCards = [
      { id: 'card-1', name: 'Lightning Bolt', zone: 'hand' },
      { id: 'card-2', name: 'Counterspell', zone: 'hand' },
      { id: 'card-3', name: 'Forest', zone: 'hand' },
    ];
    const libraryCards = [
      { id: 'lib-1', name: 'Island', zone: 'library' },
      { id: 'lib-2', name: 'Mountain', zone: 'library' },
      { id: 'lib-3', name: 'Plains', zone: 'library' },
      { id: 'lib-4', name: 'Swamp', zone: 'library' },
      { id: 'lib-5', name: 'Wastes', zone: 'library' },
    ];

    (game.state as any).zones = {
      [p1]: {
        hand: handCards.map((card) => ({ ...card })),
        handCount: handCards.length,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.hand = handCards.map((card) => ({ ...card }));
    player.library = libraryCards.map((card) => ({ ...card }));

    const ctx = game as any;
    ctx.gameId = gameId;
    ctx.libraries = new Map([[p1, libraryCards.map((card) => ({ ...card }))]]);
    ResolutionQueueManager.removeQueue(gameId);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'mind-rot-1',
      sourceName: 'Mind Rot',
    });

    const firstPass = applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      [
        {
          kind: 'discard',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 2 },
          raw: 'Discard two cards.',
        } as any,
        {
          kind: 'draw',
          who: { kind: 'you' },
          amount: { kind: 'number', value: 2 },
          raw: 'Draw two cards.',
        } as any,
      ],
      irCtx,
      { allowOptional: false },
      { controller: p1 },
    );

    expect(firstPass.pendingContinuationSteps?.map((step) => step.kind)).toEqual(['draw']);
    expect(firstPass.appliedSteps.map((step) => step.kind)).toEqual([]);
    expect(player.hand).toHaveLength(3);
    expect(player.library).toHaveLength(5);

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    expect(steps.some((step) => step.type === ResolutionStepType.DISCARD_SELECTION)).toBe(true);
    expect(String((steps[0] as any)?.oracleIrResumeStepsJson || '')).toContain('draw');

    player.hand = player.hand.filter((card: any) => !['card-1', 'card-3'].includes(String(card.id)));
    player.graveyard = [
      { id: 'card-1', name: 'Lightning Bolt', zone: 'graveyard' },
      { id: 'card-3', name: 'Forest', zone: 'graveyard' },
    ];
    (game.state as any).zones[p1].hand = [...player.hand];
    (game.state as any).zones[p1].graveyard = [...player.graveyard];

    const resumed = resumeOracleIRRemainingStepsFromResolution(ctx, {
      controller: p1,
      sourceId: 'mind-rot-1',
      sourceName: 'Mind Rot',
      steps: firstPass.pendingContinuationSteps || [],
    });

    expect(resumed?.appliedSteps.map((step) => step.kind)).toEqual(['draw']);
    expect(player.hand).toHaveLength(3);
    expect(player.hand.map((card: any) => card.id)).toEqual(['card-2', 'lib-1', 'lib-2']);
    expect(player.library).toHaveLength(3);
  });
});
