import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { resumeEffectProgramResolution } from '../src/state/effects/effectProgramResolutionService.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { triggerPermanentTargetedTriggersFromAbility } from '../src/state/modules/triggers/targeted.js';
import { processTargetedTriggersForSpellTargets } from '../src/socket/game-actions.js';
import { getStackItems } from '../../rules-engine/src/stackOperations.js';

describe('Oracle IR Agrus targeted trigger runtime', () => {
  afterEach(() => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    vi.unstubAllEnvs();
    ResolutionQueueManager.removeQueue('test_oracle_ir_agrus_targeted_trigger');
  });

  it('queues Agrus when a single-target ability targets it, then IR multi-copies after optional pay', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'test_oracle_ir_agrus_targeted_trigger';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    const agrusOracleText =
      'Whenever Agrus Kos becomes the target of an ability that targets only it, you may pay {1}{R/W}. If you do, copy that ability for each other creature you control that ability could target.';
    const triggeringStackId = 'stack_shock_trooper_targeted_1';

    (game.state as any).manaPool = {
      [p1]: { white: 1, blue: 0, black: 0, red: 0, green: 0, colorless: 1 },
    };
    (game.state as any).battlefield = [
      {
        id: 'agrus_1',
        controller: p1,
        card: {
          name: 'Agrus Kos, Eternal Soldier',
          type_line: 'Legendary Creature — Soldier',
          oracle_text: agrusOracleText,
        },
      },
      { id: 'bear_1', controller: p1, card: { type_line: 'Creature — Bear' } },
      { id: 'bear_2', controller: p1, card: { type_line: 'Creature — Bear' } },
      {
        id: 'shock_trooper_1',
        controller: p1,
        card: { name: 'Shock Trooper', type_line: 'Creature — Human Soldier' },
      },
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

    const targetedTriggers = triggerPermanentTargetedTriggersFromAbility(game as any, {
      activatedBy: p1,
      sourcePermanentId: 'shock_trooper_1',
      stackItemId: triggeringStackId,
      targetIds: ['agrus_1'],
    });

    expect(targetedTriggers).toHaveLength(1);
    expect(targetedTriggers[0]?.triggerType).toBe('targeted');
    expect(targetedTriggers[0]?.sourceName).toBe('Agrus Kos, Eternal Soldier');
    expect(String(targetedTriggers[0]?.description || '')).toContain('copy that ability');

    const stackItems = getStackItems((game.state as any).stack);
    const agrusTrigger = stackItems.find((item: any) => item?.triggerType === 'targeted');
    expect(agrusTrigger).toBeDefined();
    expect(agrusTrigger?.triggeringStackItemId).toBe(triggeringStackId);

    ResolutionQueueManager.removeQueue(gameId);
    executeTriggerEffect(
      game as any,
      p1,
      'Agrus Kos, Eternal Soldier',
      String(agrusTrigger?.description || ''),
      {
        id: String(agrusTrigger?.id || 'agrus_trigger_runtime_1'),
        permanentId: 'agrus_1',
        source: 'agrus_1',
        triggeringStackItemId: triggeringStackId,
        effectData: { triggeringStackItemId: triggeringStackId },
      },
    );

    const payStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.OPTION_CHOICE && (step as any)?.effectProgramPrompt === true);
    expect(payStep).toBeDefined();

    resumeEffectProgramResolution({
      game,
      gameId,
      step: payStep!,
      response: { selections: ['yes'] },
      persistPrompt: false,
    });

    const copies = getStackItems((game.state as any).stack)
      .filter((item: any) => item?.copiedFromStackItemId === triggeringStackId);
    expect(copies).toHaveLength(2);
    expect(copies.every((item: any) => item?.copiedBySourceName === 'Agrus Kos, Eternal Soldier')).toBe(true);
  });

  it('queues Tar Pit Warrior when a spell targets it via processTargetedTriggersForSpellTargets', () => {
    const gameId = 'test_oracle_ir_tar_pit_warrior_spell_targeted';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    const tarPitOracleText = 'When this creature becomes the target of a spell or ability, sacrifice it.';
    const spellStackId = 'stack_giant_growth_1';

    (game.state as any).battlefield = [
      {
        id: 'tar_pit_1',
        controller: p1,
        card: {
          name: 'Tar Pit Warrior',
          type_line: 'Creature — Warrior',
          oracle_text: tarPitOracleText,
        },
      },
    ];
    (game.state as any).stack = [
      {
        id: spellStackId,
        type: 'spell',
        controller: p1,
        sourceName: 'Giant Growth',
        targets: ['tar_pit_1'],
      },
    ];

    (game as any).gameId = gameId;
    (game as any).io = { to: () => ({ emit: vi.fn() }) };

    processTargetedTriggersForSpellTargets(game, p1, ['tar_pit_1'], gameId, spellStackId);

    const stackItems = getStackItems((game.state as any).stack);
    const tarPitTrigger = stackItems.find((item: any) => item?.triggerType === 'targeted');
    expect(tarPitTrigger).toBeDefined();
    expect(tarPitTrigger?.sourceName).toBe('Tar Pit Warrior');
    expect(String(tarPitTrigger?.description || '')).toMatch(/sacrifice it/i);
    expect(tarPitTrigger?.triggeringPlayer).toBe(p1);
    expect(tarPitTrigger?.triggeringStackItemId).toBe(spellStackId);

    ResolutionQueueManager.removeQueue(gameId);
  });
});
