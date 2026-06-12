import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { collectTriggerExecutionSteps } from '../src/state/modules/oracleIrTriggerExecutionHelpers.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { getStackItems } from '../../rules-engine/src/stackOperations.js';

describe('Oracle IR trigger copy_spell ability stack push', () => {
  afterEach(() => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    vi.unstubAllEnvs();
  });

  it('copies the triggering activated ability onto the stack under trigger IR primary', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'test_trigger_copy_ability_stack';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    const ringsPermanentId = 'rings_1';
    const triggeringStackId = 'stack_trade_relay_ability_1';
    const effectText = 'copy that ability. You may choose new targets for the copy.';

    const steps = collectTriggerExecutionSteps(effectText, 'Rings of Brighthearth');
    expect(steps.some((step) => step.kind === 'copy_spell')).toBe(true);

    (game.state as any).stack = [
      {
        id: triggeringStackId,
        type: 'ability',
        controller: p1,
        source: 'trade_relay_1',
        sourceName: 'Trade Relay',
        card: {
          id: 'trade_relay_card_1',
          name: 'Trade Relay',
          type_line: 'Artifact',
        },
        abilityText: '{2}, {T}: Exchange control of two target permanents that share a card type.',
        targets: ['player_relic_1', 'opponent_relic_1'],
        copyRetargetValidTargets: [
          { id: 'player_relic_1', name: 'Player Relic', type: 'permanent' },
          { id: 'opponent_relic_1', name: 'Opponent Relic', type: 'permanent' },
          { id: 'player_bear_1', name: 'Player Bear', type: 'permanent' },
          { id: 'opponent_bear_1', name: 'Opponent Bear', type: 'permanent' },
        ],
        copyRetargetMinTargets: 2,
        copyRetargetMaxTargets: 2,
      },
    ];
    (game.state as any).battlefield = [
      {
        id: ringsPermanentId,
        controller: p1,
        card: {
          name: 'Rings of Brighthearth',
          type_line: 'Legendary Artifact',
        },
      },
    ];

    (game as any).gameId = gameId;
    (game as any).io = { to: () => ({ emit: vi.fn() }) };
    (game as any).bumpSeq = vi.fn();

    executeTriggerEffect(
      game as any,
      p1,
      'Rings of Brighthearth',
      effectText,
      {
        id: 'rings_trigger_1',
        permanentId: ringsPermanentId,
        source: ringsPermanentId,
        triggeringStackItemId: triggeringStackId,
        triggeringPlayer: p1,
        effectData: {
          triggeringStackItemId: triggeringStackId,
        },
      },
    );

    const stackItems = getStackItems((game.state as any).stack);
    const copies = stackItems.filter(
      (item: any) => item?.copiedFromStackItemId === triggeringStackId,
    );
    expect(copies).toHaveLength(1);
    expect(copies[0]?.type).toBe('ability');
    expect(copies[0]?.isCopy).toBe(true);
    expect(copies[0]?.copiedBySourceName).toBe('Rings of Brighthearth');
    expect(stackItems.some((item: any) => item?.id === triggeringStackId)).toBe(true);
  });

  it('queues direct retarget target selection when the copied ability has no current targets', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'test_trigger_copy_ability_zero_target_retarget';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    const ringsPermanentId = 'rings_1';
    const triggeringStackId = 'stack_lightning_rod_ability_1';
    const effectText = 'copy that ability. You may choose new targets for the copy.';

    (game.state as any).stack = [
      {
        id: triggeringStackId,
        type: 'ability',
        controller: p1,
        source: 'lightning_rod_1',
        sourceName: 'Lightning Rod',
        card: { id: 'lightning_rod_card_1', name: 'Lightning Rod', type_line: 'Artifact' },
        abilityText: '{1}: Lightning Rod deals 1 damage to any target.',
        targets: [],
        copyRetargetValidTargets: [
          { id: 'p1', name: 'P1', type: 'player' },
          { id: 'p2', name: 'P2', type: 'player' },
        ],
        copyRetargetMinTargets: 1,
        copyRetargetMaxTargets: 1,
        copyRetargetTargetDescription: 'any target',
      },
    ];
    (game.state as any).battlefield = [
      {
        id: ringsPermanentId,
        controller: p1,
        card: { name: 'Rings of Brighthearth', type_line: 'Legendary Artifact' },
      },
    ];

    (game as any).gameId = gameId;
    (game as any).io = { to: () => ({ emit: vi.fn() }) };
    (game as any).bumpSeq = vi.fn();
    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(
      game as any,
      p1,
      'Rings of Brighthearth',
      effectText,
      {
        id: 'rings_trigger_zero_target_1',
        permanentId: ringsPermanentId,
        source: ringsPermanentId,
        triggeringStackItemId: triggeringStackId,
        effectData: { triggeringStackItemId: triggeringStackId },
      },
    );

    const copies = getStackItems((game.state as any).stack)
      .filter((item: any) => item?.copiedFromStackItemId === triggeringStackId);
    expect(copies).toHaveLength(1);

    const retargetStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, p1)
      .find((step: any) => step?.retargetAbilityCopyTargetSelection === true);
    expect(retargetStep).toBeDefined();
    expect((retargetStep as any)?.mandatory).toBe(false);
    expect(String((retargetStep as any)?.retargetAbilityCopyStackItemId || '')).toBe(String(copies[0]?.id || ''));
  });
});
