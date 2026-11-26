import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { inferTriggeredAbilityTargetMetadata } from '../src/state/modules/inferTriggeredAbilityTargetMetadata.js';
import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('oracle IR effects lane round 4 (server)', () => {
  it('queues a proliferate prompt for a parsed bare "Proliferate." step (no who selector)', () => {
    const gameId = 'oracle_ir_round4_bare_proliferate';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    (game.state as any).battlefield = [
      { id: 'bear-1', controller: p1, owner: p1, card: { id: 'bear-card', name: 'Grizzly Bears', type_line: 'Creature - Bear' }, counters: { '+1/+1': 1 } },
      { id: 'elf-1', controller: p1, owner: p1, card: { id: 'elf-card', name: 'Llanowar Elves', type_line: 'Creature - Elf Druid' }, counters: { '+1/+1': 2 } },
    ];
    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const steps = parseOracleTextToIR('Proliferate.', 'Steady Progress').abilities.flatMap((ability: any) => ability.steps || []);
    expect(steps).toEqual([expect.objectContaining({ kind: 'proliferate' })]);
    expect((steps[0] as any).who).toBeUndefined();

    const irCtx = buildOracleIRExecutionContext({ controllerId: p1, sourceId: 'steady-progress', sourceName: 'Steady Progress' });
    applyOracleIRStepsOnServer(ctx, game.state as any, steps as any, irCtx, { allowOptional: false }, { controller: p1 });

    const queued = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const proliferateStep = queued.find((step) => step.type === ResolutionStepType.PROLIFERATE);
    expect(proliferateStep).toBeTruthy();
    expect((proliferateStep as any)?.availableTargets).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bear-1' }),
      expect.objectContaining({ id: 'elf-1' }),
    ]));
    ResolutionQueueManager.removeQueue(gameId);
  });

  it('infers a creature target for color/status-qualified creature targets (Chime of Night)', () => {
    for (const text of [
      'destroy target nonblack creature.',
      'destroy target tapped creature.',
      'destroy target nonartifact, nonblack creature.',
      'target white or blue creature gets -2/-2 until end of turn.',
    ]) {
      const meta = inferTriggeredAbilityTargetMetadata(text);
      expect(meta.requiresTarget, text).toBe(true);
      expect(meta.targetType, text).toBe('creature');
    }
  });
});
