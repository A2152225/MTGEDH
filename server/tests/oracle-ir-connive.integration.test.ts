import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  applyOracleIRStepsOnServer,
  maybeApplyOracleIrChoiceStepFromResolution,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('oracle IR connive queue adapter', () => {
  it('queues discard selection when connive requires a discard choice after drawing', () => {
    const gameId = 'oracle_ir_connive_queue';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    (game.state as any).battlefield = [
      {
        id: 'creature-1',
        controller: p1,
        owner: p1,
        card: { id: 'creature-card', name: 'Conniver', type_line: 'Creature — Human' },
        counters: {},
      },
    ];

    (game.state as any).zones = {
      [p1]: {
        hand: [
          { id: 'hand-1', name: 'Existing Card', zone: 'hand' },
        ],
        handCount: 1,
        graveyard: [],
        graveyardCount: 0,
      },
    };

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.hand = [
      { id: 'hand-1', name: 'Existing Card', type_line: 'Instant', zone: 'hand' },
    ];
    player.library = [
      { id: 'drawn-1', name: 'Drawn Card', type_line: 'Instant', zone: 'library' },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);
    ResolutionQueueManager.removeQueue(gameId);

    const conniveStep = {
      kind: 'connive',
      target: { kind: 'raw', text: 'this creature' },
      amount: { kind: 'number', value: 1 },
      raw: 'This creature connives.',
    } as const;

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'connive-source-1',
      sourceName: 'Connive Source',
      targetPermanentId: 'creature-1',
    });

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      [conniveStep as any],
      irCtx,
      { allowOptional: false },
      { controller: p1 },
    );

    const playerAfterDraw = (game.state as any).players.find((entry: any) => entry.id === p1);
    expect((playerAfterDraw?.hand || []).map((card: any) => card.id).sort()).toEqual(['drawn-1', 'hand-1']);

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const discardStep = steps.find((step) => step.type === ResolutionStepType.DISCARD_SELECTION);
    expect(discardStep).toBeTruthy();
    expect((discardStep as any)?.discardCount).toBe(1);
    expect((discardStep as any)?.hand).toHaveLength(2);
    expect(String((discardStep as any)?.oracleIrChoiceStepJson || '')).toContain('connive');

    const completedStep = ResolutionQueueManager.completeStep(gameId, String(discardStep!.id), {
      stepId: String(discardStep!.id),
      playerId: p1,
      selections: ['hand-1'],
      cancelled: false,
      timestamp: Date.now(),
    });

    const resumed = maybeApplyOracleIrChoiceStepFromResolution(ctx, completedStep, completedStep!.response!);
    expect(resumed?.appliedSteps?.some((step) => step.kind === 'connive')).toBe(true);

    const creature = (game.state as any).battlefield.find((perm: any) => perm.id === 'creature-1');
    expect(creature?.counters?.['+1/+1']).toBe(1);
    const playerAfterDiscard = (game.state as any).players.find((entry: any) => entry.id === p1);
    expect((playerAfterDiscard?.hand || []).map((card: any) => card.id)).toEqual(['drawn-1']);
  });
});
