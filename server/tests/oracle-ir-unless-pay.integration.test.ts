import { describe, expect, it } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stack.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';

describe('oracle IR unless-pay queue adapter', () => {
  it('queues sacrifice-unless-pay upkeep prompts for Phantasmal Forces style text', () => {
    const gameId = 'oracle_ir_phantasmal_upkeep';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);

    (game.state as any).battlefield.push({
      id: 'forces-self',
      controller: p1,
      owner: p1,
      card: {
        id: 'forces-card',
        name: 'Phantasmal Forces',
        type_line: 'Creature — Illusion',
      },
    });

    const ctx = game as any;
    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(
      ctx,
      p1,
      'Phantasmal Forces',
      'At the beginning of your upkeep, sacrifice this creature unless you pay {U}.',
      {
        type: 'triggered_ability',
        controller: p1,
        source: 'forces-self',
        permanentId: 'forces-self',
        id: 'forces-upkeep-trigger',
      },
    );

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p1);
    const unlessPayStep = steps.find(
      (step) =>
        step.type === ResolutionStepType.MANA_PAYMENT_CHOICE &&
        (step as any)?.sacrificeUnlessPayChoice === true,
    );

    expect(unlessPayStep).toBeTruthy();
    expect((unlessPayStep as any)?.manaCost).toBe('{U}');
    expect((unlessPayStep as any)?.permanentId).toBe('forces-self');
  });

  it('queues unless-pays-mana prompts for Force Spike style text', () => {
    const gameId = 'oracle_ir_force_spike';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    const p2 = 'p2' as PlayerID;

    game.applyEvent!({ type: 'join', playerId: p1, name: 'P1' } as any);
    game.applyEvent!({ type: 'join', playerId: p2, name: 'P2' } as any);

    (game.state as any).stack = [
      {
        id: 'spell-1',
        type: 'spell',
        controller: p2,
        owner: p2,
        card: { id: 'spell-card-1', name: 'Cultivate', type_line: 'Sorcery' },
      },
    ];
    (game.state as any).manaPool = {
      p2: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };

    const ctx = game as any;
    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(
      ctx,
      p1,
      'Force Spike',
      'Counter target spell unless its controller pays {1}.',
      {
        type: 'triggered_ability',
        controller: p1,
        source: 'spike-source',
        id: 'spike-trigger',
        targets: [{ id: 'spell-1', kind: 'stack' }],
      },
    );

    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, p2);
    const unlessPayStep = steps.find((step) => (step as any)?.oracleIrUnlessPayChoice === true);

    expect(unlessPayStep).toBeTruthy();
    expect((unlessPayStep as any)?.optionalPaymentManaCost).toBe('{1}');
    expect((unlessPayStep as any)?.oracleIrUnlessPayKind).toBe('mana');
  });
});
