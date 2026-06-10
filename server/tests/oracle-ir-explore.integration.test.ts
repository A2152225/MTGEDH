import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import {
  applyOracleIRStepsToGameState,
  buildOracleIRExecutionContext,
} from '../../rules-engine/src/oracleIRExecutor.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('oracle IR explore queue adapter', () => {
  it('queues explore decisions for nonland reveals', () => {
    const gameId = 'oracle_ir_explore_queue';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    (game.state as any).battlefield = [
      {
        id: 'explorer-1',
        controller: p1,
        owner: p1,
        card: { id: 'explorer-card', name: 'Merfolk Explorer', type_line: 'Creature — Merfolk' },
        counters: {},
      },
    ];

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.library = [
      { id: 'bolt-1', name: 'Lightning Bolt', type_line: 'Instant', cmc: 1 },
      { id: 'forest-1', name: 'Forest', type_line: 'Basic Land — Forest', cmc: 0 },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);
    ResolutionQueueManager.removeQueue(gameId);

    const exploreStep = {
      kind: 'explore',
      target: { kind: 'raw', text: 'this creature' },
      raw: 'This creature explores.',
    } as const;

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'explore-source-1',
      sourceName: 'Explore Source',
      targetPermanentId: 'explorer-1',
    });

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      [exploreStep as any],
      irCtx,
      { allowOptional: false },
      { controller: p1 },
    );

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const exploreDecision = steps.find((step) => step.type === ResolutionStepType.EXPLORE_DECISION);

    expect(exploreDecision).toBeTruthy();
    expect((exploreDecision as any)?.permanentId).toBe('explorer-1');
    expect((exploreDecision as any)?.isLand).toBe(false);
    expect((exploreDecision as any)?.revealedCard?.name).toBe('Lightning Bolt');
  });

  it('applies nonland explore when graveyard choice is bound', () => {
    const p1 = 'p1' as PlayerID;
    const state = {
      id: 'game1',
      format: 'commander',
      players: [
        {
          id: p1,
          name: 'P1',
          seat: 0,
          library: [{ id: 'bolt-1', name: 'Lightning Bolt', type_line: 'Instant' }],
          hand: [],
          graveyard: [],
        },
      ],
      battlefield: [
        {
          id: 'explorer-1',
          controller: p1,
          owner: p1,
          card: { name: 'Merfolk Explorer', type_line: 'Creature — Merfolk' },
          counters: {},
        },
      ],
      stack: [],
      commandZone: {},
      life: {},
      turnPlayer: p1,
      priority: p1,
      phase: 'main1',
      active: true,
    } as any;

    const result = applyOracleIRStepsToGameState(
      state,
      [
        {
          kind: 'explore',
          target: { kind: 'raw', text: 'this creature' },
          raw: 'This creature explores.',
        } as any,
      ],
      buildOracleIRExecutionContext({
        controllerId: p1,
        targetPermanentId: 'explorer-1',
        selectorContext: { exploreToGraveyard: true },
      }),
      { allowOptional: false },
    );

    expect(result.appliedSteps.map((step) => step.kind)).toEqual(['explore']);
    const player = result.state.players?.find((entry: any) => entry.id === p1) as any;
    expect(player.library).toHaveLength(0);
    expect(player.graveyard).toHaveLength(1);
    expect((result.state.battlefield || [])[0]?.counters?.['+1/+1']).toBe(1);
  });
});
