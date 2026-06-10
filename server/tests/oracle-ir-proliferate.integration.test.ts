import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutor.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('oracle IR proliferate queue adapter', () => {
  it('queues proliferate selection prompts when multiple eligible targets exist', () => {
    const gameId = 'oracle_ir_proliferate_queue';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    (game.state as any).battlefield = [
      {
        id: 'bear-1',
        controller: p1,
        owner: p1,
        card: { id: 'bear-card', name: 'Grizzly Bears', type_line: 'Creature — Bear' },
        counters: { '+1/+1': 1 },
      },
      {
        id: 'elf-1',
        controller: p1,
        owner: p1,
        card: { id: 'elf-card', name: 'Llanowar Elves', type_line: 'Creature — Elf Druid' },
        counters: { '+1/+1': 2 },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: p1,
      sourceId: 'proliferate-source-1',
      sourceName: 'Proliferate Source',
    });

    applyOracleIRStepsOnServer(
      ctx,
      game.state as any,
      [
        {
          kind: 'proliferate',
          who: { kind: 'you' },
          raw: 'Proliferate.',
        } as any,
      ],
      irCtx,
      { allowOptional: false },
      { controller: p1 },
    );

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const proliferateStep = steps.find((step) => step.type === ResolutionStepType.PROLIFERATE);

    expect(proliferateStep).toBeTruthy();
    expect((proliferateStep as any)?.availableTargets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'bear-1', counters: { '+1/+1': 1 } }),
        expect.objectContaining({ id: 'elf-1', counters: { '+1/+1': 2 } }),
      ])
    );
    expect((proliferateStep as any)?.sourceName).toBe('Proliferate Source');
  });
});
