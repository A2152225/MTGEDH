import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { parseTargetRequirements } from '../src/rules-engine/targeting.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  applyOracleIRStepsOnServer,
  maybeApplyOracleIrChoiceStepFromResolution,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

const HIDEOUT_CONNIVE =
  '{3}, {T}: Target Villain you control connives. Activate only as a sorcery. (Draw a card, then discard a card. If you discarded a nonland card, put a +1/+1 counter on that creature.)';

describe('Villainous Hideout activated connive', () => {
  it('treats Target Villain you control as a creature-type target', () => {
    const reqs = parseTargetRequirements(HIDEOUT_CONNIVE);
    expect(reqs.needsTargets).toBe(true);
    expect(reqs.targetTypes.map((t) => String(t).toLowerCase())).toContain('villain');
    expect(reqs.targetControllerConstraint).toBe('you');
  });

  it('queues a discard selection for the activated connive step', () => {
    const gameId = 'oracle_ir_villainous_hideout_connive';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    (game.state as any).battlefield = [
      {
        id: 'villain-1',
        controller: p1,
        owner: p1,
        card: { id: 'villain-card', name: 'Audit Villain', type_line: 'Creature — Human Villain' },
        counters: {},
      },
    ];

    const player = (game.state as any).players.find((entry: any) => entry.id === p1);
    player.hand = [{ id: 'hand-1', name: 'Existing Card', type_line: 'Instant', zone: 'hand' }];
    player.library = [{ id: 'drawn-1', name: 'Drawn Card', type_line: 'Instant', zone: 'library' }];

    const ctx = game as any;
    ctx.gameId = gameId;
    ctx.libraries = new Map([[p1, player.library.map((card: any) => ({ ...card }))]]);
    ResolutionQueueManager.removeQueue(gameId);

    const ir = parseOracleTextToIR(HIDEOUT_CONNIVE, 'Villainous Hideout');
    const steps = ir.abilities
      .filter((ability) => ability.type === 'activated')
      .flatMap((ability) => ability.steps || []);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.kind).toBe('connive');

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'hideout-1',
      sourceName: 'Villainous Hideout',
      targetPermanentId: 'villain-1',
      targetCreatureId: 'villain-1',
      selectorContext: { chosenObjectIds: ['villain-1'] },
    });

    applyOracleIRStepsOnServer(ctx, game.state as any, steps as any, irCtx, { allowOptional: false }, { controller: p1 });

    const discardStep = ResolutionQueueManager.getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.DISCARD_SELECTION);
    expect(discardStep).toBeTruthy();
    expect((discardStep as any)?.discardCount).toBe(1);
    expect((discardStep as any)?.reason).toBe('connive');

    const completedStep = ResolutionQueueManager.completeStep(gameId, String(discardStep!.id), {
      stepId: String(discardStep!.id),
      playerId: p1,
      selections: ['hand-1'],
      cancelled: false,
      timestamp: Date.now(),
    });

    const resumed = maybeApplyOracleIrChoiceStepFromResolution(ctx, completedStep, completedStep!.response!);
    expect(resumed?.appliedSteps?.some((step) => step.kind === 'connive')).toBe(true);

    const villain = (game.state as any).battlefield.find((perm: any) => perm.id === 'villain-1');
    expect(villain?.counters?.['+1/+1']).toBe(1);
  });
});
