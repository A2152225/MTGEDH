import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createInitialGameState } from '../src/state/gameState.js';
import {
  applyOracleIRStepsOnServer,
  resumeOracleIRStepWithChoiceFromResolution,
} from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('oracle IR sacrifice queue adapter', () => {
  it('queues sacrifice target selection when multiple creatures exist', () => {
    const gameId = 'oracle_ir_sacrifice_queue';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    (game.state as any).battlefield = [
      {
        id: 'bear-1',
        controller: p1,
        owner: p1,
        card: { id: 'bear-card', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
      },
      {
        id: 'elf-1',
        controller: p1,
        owner: p1,
        card: { id: 'elf-card', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid' },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'village-rites-1',
      sourceName: 'Village Rites',
    });

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      [
        {
          kind: 'sacrifice',
          who: { kind: 'you' },
          what: { kind: 'raw', text: 'a creature' },
          raw: 'Sacrifice a creature.',
        } as any,
      ],
      irCtx,
      { allowOptional: false },
      { controller: p1 },
    );

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const sacrificeStep = steps.find((step) => step.type === ResolutionStepType.TARGET_SELECTION);

    expect(sacrificeStep).toBeTruthy();
    expect((sacrificeStep as any)?.validTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'bear-1' }),
        expect.objectContaining({ id: 'elf-1' }),
      ])
    );
    expect(String((sacrificeStep as any)?.oracleIrChoiceStepJson || '')).toContain('sacrifice');

    const resumed = resumeOracleIRStepWithChoiceFromResolution(ctx, {
      controller: p1,
      sourceId: 'village-rites-1',
      sourceName: 'Village Rites',
      steps: [
        {
          kind: 'sacrifice',
          who: { kind: 'you' },
          what: { kind: 'raw', text: 'a creature' },
          raw: 'Sacrifice a creature.',
        } as any,
      ],
      chosenObjectIds: ['bear-1'],
    });

    expect(resumed?.appliedSteps.map((step) => step.kind)).toEqual(['sacrifice']);
    expect((game.state as any).battlefield.map((perm: any) => perm.id)).toEqual(['elf-1']);
  });
});
