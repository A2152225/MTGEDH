import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { isTriggerEffectFullyIrWired } from '../src/state/modules/oracleIrTriggerLegacyRouting.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { getStackItems } from '../../rules-engine/src/stackOperations.js';

describe('Oracle IR Zada multi-copy spell', () => {
  afterEach(() => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    vi.unstubAllEnvs();
  });

  it('pushes one stack copy per other creature the spell could target', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const effectText =
      'copy that spell for each other creature you control that the spell could target.';
    expect(isTriggerEffectFullyIrWired(effectText, 'Zada, Hedron Grinder')).toBe(true);

    const gameId = 'test_oracle_ir_zada_multi_copy_spell';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    const triggeringStackId = 'stack_giant_growth_1';
    (game.state as any).battlefield = [
      { id: 'zada_1', controller: p1, card: { type_line: 'Legendary Creature — Goblin' } },
      { id: 'bear_1', controller: p1, card: { type_line: 'Creature — Bear' } },
      { id: 'bear_2', controller: p1, card: { type_line: 'Creature — Bear' } },
    ];
    (game.state as any).stack = [
      {
        id: triggeringStackId,
        type: 'spell',
        controller: p1,
        card: {
          id: 'giant_growth_card',
          name: 'Giant Growth',
          type_line: 'Instant',
          oracle_text: 'Target creature gets +3/+3 until end of turn.',
        },
        targets: ['zada_1'],
        copyRetargetValidTargets: [
          { id: 'zada_1', type: 'permanent' },
          { id: 'bear_1', type: 'permanent' },
          { id: 'bear_2', type: 'permanent' },
        ],
      },
    ];

    (game as any).gameId = gameId;
    (game as any).io = { to: () => ({ emit: vi.fn() }) };
    (game as any).bumpSeq = vi.fn();

    executeTriggerEffect(
      game as any,
      p1,
      'Zada, Hedron Grinder',
      effectText,
      {
        id: 'zada_trigger_1',
        permanentId: 'zada_1',
        source: 'zada_1',
        triggeringStackItemId: triggeringStackId,
        effectData: { triggeringStackItemId: triggeringStackId, casterId: p1 },
      },
    );

    const stackItems = getStackItems((game.state as any).stack);
    const copies = stackItems.filter((item: any) => item?.copiedFromStackItemId === triggeringStackId);
    expect(copies).toHaveLength(2);
    expect(copies.every((item: any) => item?.type === 'spell' && item?.copiedBySourceName === 'Zada, Hedron Grinder')).toBe(true);
    expect(stackItems.some((item: any) => item?.id === triggeringStackId)).toBe(true);
  });

  it('queues one optional retarget prompt per copy when copies may choose new targets', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const effectText =
      'copy that spell for each other creature you control that the spell could target. You may choose new targets for the copies.';
    expect(isTriggerEffectFullyIrWired(effectText, 'Zada, Hedron Grinder')).toBe(true);

    const gameId = 'test_oracle_ir_zada_multi_copy_retarget';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    const triggeringStackId = 'stack_giant_growth_retarget_1';
    (game.state as any).battlefield = [
      { id: 'zada_1', controller: p1, card: { type_line: 'Legendary Creature — Goblin' } },
      { id: 'bear_1', controller: p1, card: { type_line: 'Creature — Bear' } },
      { id: 'bear_2', controller: p1, card: { type_line: 'Creature — Bear' } },
    ];
    (game.state as any).stack = [
      {
        id: triggeringStackId,
        type: 'spell',
        controller: p1,
        card: {
          id: 'giant_growth_card',
          name: 'Giant Growth',
          type_line: 'Instant',
        },
        targets: ['zada_1'],
        copyRetargetValidTargets: [
          { id: 'zada_1', type: 'permanent' },
          { id: 'bear_1', type: 'permanent' },
          { id: 'bear_2', type: 'permanent' },
        ],
        copyRetargetMinTargets: 1,
        copyRetargetMaxTargets: 1,
      },
    ];

    (game as any).gameId = gameId;
    (game as any).io = { to: () => ({ emit: vi.fn() }) };
    (game as any).bumpSeq = vi.fn();
    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(
      game as any,
      p1,
      'Zada, Hedron Grinder',
      effectText,
      {
        id: 'zada_trigger_retarget_1',
        permanentId: 'zada_1',
        source: 'zada_1',
        triggeringStackItemId: triggeringStackId,
        effectData: { triggeringStackItemId: triggeringStackId, casterId: p1 },
      },
    );

    const copies = getStackItems((game.state as any).stack)
      .filter((item: any) => item?.copiedFromStackItemId === triggeringStackId);
    expect(copies).toHaveLength(2);

    const retargetSteps = ResolutionQueueManager
      .getStepsForPlayer(gameId, p1)
      .filter((step: any) => step?.retargetSpellCopy === true || step?.retargetSpellCopyTargetSelection === true);
    expect(retargetSteps).toHaveLength(2);
    expect(new Set(retargetSteps.map((step: any) => String(step?.retargetSpellCopyStackItemId || '')))).toEqual(
      new Set(copies.map((copy: any) => String(copy?.id || ''))),
    );
  });
});

describe('Oracle IR Ink-Treader multi-copy spell', () => {
  afterEach(() => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    vi.unstubAllEnvs();
  });

  it('counts other creatures any player controls that the spell could target', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const effectText = 'copy the spell for each other creature that spell could target.';
    expect(isTriggerEffectFullyIrWired(effectText, 'Ink-Treader Nephilim')).toBe(true);

    const gameId = 'test_oracle_ir_ink_treader_multi_copy_spell';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    const triggeringStackId = 'stack_shock_1';
    (game.state as any).battlefield = [
      { id: 'nephilim_1', controller: p1, card: { type_line: 'Creature — Nephilim' } },
      { id: 'bear_1', controller: p1, card: { type_line: 'Creature — Bear' } },
      { id: 'opp_bear', controller: 'p2', card: { type_line: 'Creature — Bear' } },
    ];
    (game.state as any).stack = [
      {
        id: triggeringStackId,
        type: 'spell',
        controller: 'p2',
        card: {
          id: 'shock_card',
          name: 'Shock',
          type_line: 'Instant',
        },
        targets: ['nephilim_1'],
        copyRetargetValidTargets: [
          { id: 'nephilim_1', type: 'permanent' },
          { id: 'bear_1', type: 'permanent' },
          { id: 'opp_bear', type: 'permanent' },
        ],
      },
    ];

    (game as any).gameId = gameId;
    (game as any).io = { to: () => ({ emit: vi.fn() }) };
    (game as any).bumpSeq = vi.fn();

    executeTriggerEffect(
      game as any,
      p1,
      'Ink-Treader Nephilim',
      effectText,
      {
        id: 'ink_trigger_1',
        permanentId: 'nephilim_1',
        source: 'nephilim_1',
        triggeringStackItemId: triggeringStackId,
        effectData: { triggeringStackItemId: triggeringStackId },
      },
    );

    const stackItems = getStackItems((game.state as any).stack);
    const copies = stackItems.filter((item: any) => item?.copiedFromStackItemId === triggeringStackId);
    expect(copies).toHaveLength(2);
    expect(copies.every((item: any) => item?.copiedBySourceName === 'Ink-Treader Nephilim')).toBe(true);
  });
});
