import { afterEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

describe('Rupture Spire unless-you-pay under IR trigger primary', () => {
  const previousPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousPrimary;
    }
    ResolutionQueueManager.clearAllSteps('oracle_ir_rupture_spire');
  });

  it('queues an unless-pays-mana prompt instead of silently no-opping', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'oracle_ir_rupture_spire';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    (game.state as any).battlefield.push({
      id: 'spire-1',
      controller: p1,
      owner: p1,
      tapped: true,
      card: {
        id: 'spire-card',
        name: 'Rupture Spire',
        type_line: 'Land',
        oracle_text:
          'This land enters tapped.\nWhen this land enters, sacrifice it unless you pay {1}.\n{T}: Add one mana of any color.',
      },
    });

    const ctx = game as any;
    ctx.gameId = gameId;
    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(
      ctx,
      p1,
      'Rupture Spire',
      'sacrifice it unless you pay {1}.',
      {
        type: 'triggered_ability',
        controller: p1,
        source: 'spire-1',
        permanentId: 'spire-1',
        id: 'spire-etb',
      },
    );

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const unlessPayStep = steps.find((step) => (step as any)?.oracleIrUnlessPayChoice === true);

    expect(unlessPayStep).toBeTruthy();
    expect((unlessPayStep as any)?.oracleIrUnlessPayKind).toBe('mana');
    expect((unlessPayStep as any)?.optionalPaymentManaCost).toBe('{1}');
    expect((game.state as any).battlefield.some((perm: any) => perm.id === 'spire-1')).toBe(true);
  });
});
