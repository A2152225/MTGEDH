import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { resumeEffectProgramResolution } from '../src/state/effects/effectProgramResolutionService.js';
import { isTriggerEffectFullyIrWired } from '../src/state/modules/oracleIrTriggerLegacyRouting.js';
import { detectTargetedTriggers } from '../src/state/modules/triggered-abilities.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { getStackItems } from '../../rules-engine/src/stackOperations.js';

describe('Oracle IR Agrus multi-copy ability', () => {
  const agrusOracleText =
    'Whenever Agrus Kos becomes the target of an ability that targets only it, you may pay {1}{R/W}. If you do, copy that ability for each other creature you control that ability could target.';

  afterEach(() => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    vi.unstubAllEnvs();
  });

  it('pushes one stack copy per other creature the ability could target', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const effectText =
      'copy that ability for each other creature you control that ability could target.';
    const fullEffectText =
      'you may pay {1}{R/W}. If you do, copy that ability for each other creature you control that ability could target.';
    expect(isTriggerEffectFullyIrWired(effectText, 'Agrus Kos, Eternal Soldier')).toBe(true);
    expect(isTriggerEffectFullyIrWired(fullEffectText, 'Agrus Kos, Eternal Soldier')).toBe(true);

    const gameId = 'test_oracle_ir_agrus_multi_copy_ability';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    const triggeringStackId = 'stack_target_creature_ability_1';
    (game.state as any).battlefield = [
      { id: 'agrus_1', controller: p1, card: { type_line: 'Legendary Creature — Soldier' } },
      { id: 'bear_1', controller: p1, card: { type_line: 'Creature — Bear' } },
      { id: 'bear_2', controller: p1, card: { type_line: 'Creature — Bear' } },
    ];
    (game.state as any).stack = [
      {
        id: triggeringStackId,
        type: 'ability',
        controller: p1,
        source: 'shock_trooper_1',
        sourceName: 'Shock Trooper',
        abilityText: '{R}: Target creature gets +1/+0 until end of turn.',
        targets: ['agrus_1'],
        copyRetargetValidTargets: [
          { id: 'agrus_1', type: 'permanent' },
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
      'Agrus Kos, Eternal Soldier',
      effectText,
      {
        id: 'agrus_trigger_1',
        permanentId: 'agrus_1',
        source: 'agrus_1',
        triggeringStackItemId: triggeringStackId,
        effectData: { triggeringStackItemId: triggeringStackId },
      },
    );

    const stackItems = getStackItems((game.state as any).stack);
    const copies = stackItems.filter((item: any) => item?.copiedFromStackItemId === triggeringStackId);
    expect(copies).toHaveLength(2);
    expect(copies.every((item: any) => item?.copiedBySourceName === 'Agrus Kos, Eternal Soldier')).toBe(true);
    expect(stackItems.some((item: any) => item?.id === triggeringStackId)).toBe(true);
  });

  it('detects the targeted trigger and wires the full optional-pay multi-copy effect clause', () => {
    const permanent = { id: 'agrus_1', controller: 'p1' };
    const triggers = detectTargetedTriggers(
      { name: 'Agrus Kos, Eternal Soldier', oracle_text: agrusOracleText },
      permanent,
    );
    expect(triggers).toHaveLength(1);
    expect(triggers[0]?.triggerType).toBe('targeted');
    expect(isTriggerEffectFullyIrWired(String(triggers[0]?.effect || ''), 'Agrus Kos, Eternal Soldier')).toBe(true);
  });

  it('queues one optional retarget prompt per ability copy when copies may choose new targets', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const effectText =
      'copy that ability for each other creature you control that ability could target. You may choose new targets for the copies.';
    expect(isTriggerEffectFullyIrWired(effectText, 'Agrus Kos, Eternal Soldier')).toBe(true);

    const gameId = 'test_oracle_ir_agrus_multi_copy_ability_retarget';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    const triggeringStackId = 'stack_target_creature_ability_retarget_1';
    (game.state as any).battlefield = [
      { id: 'agrus_1', controller: p1, card: { type_line: 'Legendary Creature — Soldier' } },
      { id: 'bear_1', controller: p1, card: { type_line: 'Creature — Bear' } },
      { id: 'bear_2', controller: p1, card: { type_line: 'Creature — Bear' } },
    ];
    (game.state as any).stack = [
      {
        id: triggeringStackId,
        type: 'ability',
        controller: p1,
        source: 'shock_trooper_1',
        sourceName: 'Shock Trooper',
        abilityText: '{R}: Target creature gets +1/+0 until end of turn.',
        targets: ['agrus_1'],
        copyRetargetValidTargets: [
          { id: 'agrus_1', type: 'permanent' },
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
      'Agrus Kos, Eternal Soldier',
      effectText,
      {
        id: 'agrus_trigger_retarget_1',
        permanentId: 'agrus_1',
        source: 'agrus_1',
        triggeringStackItemId: triggeringStackId,
        effectData: { triggeringStackItemId: triggeringStackId },
      },
    );

    const copies = getStackItems((game.state as any).stack)
      .filter((item: any) => item?.copiedFromStackItemId === triggeringStackId);
    expect(copies).toHaveLength(2);

    const retargetSteps = ResolutionQueueManager
      .getStepsForPlayer(gameId, p1)
      .filter((step: any) => step?.retargetAbilityCopy === true || step?.retargetAbilityCopyTargetSelection === true);
    expect(retargetSteps).toHaveLength(2);
    expect(new Set(retargetSteps.map((step: any) => String(step?.retargetAbilityCopyStackItemId || '')))).toEqual(
      new Set(copies.map((copy: any) => String(copy?.id || ''))),
    );
  });
});
