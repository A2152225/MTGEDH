import { afterEach, describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { reset, replay } from '../src/state/modules/applyEvent.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { resolveTopOfStack } from '../src/state/modules/stackResolveTopOfStackUtils.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

describe('Myrel soldier token replay / undo', () => {
  const previousPrimary = process.env.ORACLE_IR_TRIGGER_PRIMARY;

  afterEach(() => {
    if (previousPrimary === undefined) {
      delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    } else {
      process.env.ORACLE_IR_TRIGGER_PRIMARY = previousPrimary;
    }
  });

  it('does not duplicate soldier tokens after replay and post-replay stack resolution', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'myrel_token_replay_undo';
    ResolutionQueueManager.removeQueue(gameId);

    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    const myrelId = 'myrel_perm_1';
    (game.state as any).battlefield = [
      {
        id: myrelId,
        controller: p1,
        owner: p1,
        card: {
          name: 'Myrel, Shield of Argive',
          type_line: 'Legendary Creature — Human Soldier',
          oracle_text:
            'Whenever Myrel attacks, create X 1/1 colorless Soldier artifact creature tokens, where X is the number of Soldiers you control.',
        },
      },
    ];

    const ctx = game as any;
    ctx.gameId = gameId;

    const effectText =
      'Create X 1/1 colorless Soldier artifact creature tokens, where X is the number of Soldiers you control.';
    const triggerId = 'myrel_attack_trigger_replay';
    const triggerItem = {
      id: triggerId,
      permanentId: myrelId,
      source: myrelId,
      triggerType: 'attacks',
      description: effectText,
      effectData: {
        countType: 'soldiers',
        power: 1,
        toughness: 1,
        tokenType: 'Soldier',
        tokenTypes: ['Artifact', 'Creature', 'Soldier'],
      },
    };

    executeTriggerEffect(ctx, p1, 'Myrel, Shield of Argive', effectText, triggerItem);

    const soldierTokens = (game.state as any).battlefield.filter((perm: any) => perm.isToken);
    expect(soldierTokens).toHaveLength(1);
    const tokenId = String(soldierTokens[0]?.id || '');
    expect(tokenId).toBeTruthy();

    const replayEvents = [
      { type: 'join', playerId: p1, name: 'P1' },
      {
        type: 'pushTriggeredAbility',
        triggerId,
        sourceId: myrelId,
        sourceName: 'Myrel, Shield of Argive',
        controllerId: p1,
        description: effectText,
        triggerType: 'attacks',
        effect: effectText,
        permanentId: myrelId,
        effectData: triggerItem.effectData,
      },
      {
        type: 'executeEffect',
        effectType: 'createToken',
        controllerId: p1,
        tokenData: {
          id: tokenId,
          name: 'Soldier',
          typeLine: 'Artifact Creature — Soldier',
          power: 1,
          toughness: 1,
          colors: [],
          abilities: [],
          hasHaste: false,
        },
        oracleIrSourceId: myrelId,
        oracleIrSourceName: 'Myrel, Shield of Argive',
        oracleIrReplayMutation: true,
      },
    ];

    reset(ctx, true);
    replay(ctx, replayEvents as any);

    const tokensAfterReplay = (game.state as any).battlefield.filter((perm: any) => perm.isToken);
    expect(tokensAfterReplay).toHaveLength(1);
    expect((game.state as any).stack || []).toHaveLength(0);

    resolveTopOfStack(ctx);
    const tokensAfterResolve = (game.state as any).battlefield.filter((perm: any) => perm.isToken);
    expect(tokensAfterResolve).toHaveLength(1);

    reset(ctx, true);
    replay(ctx, replayEvents as any);
    const tokensAfterSecondReplay = (game.state as any).battlefield.filter((perm: any) => perm.isToken);
    expect(tokensAfterSecondReplay).toHaveLength(1);

    ResolutionQueueManager.removeQueue(gameId);
  });
});
