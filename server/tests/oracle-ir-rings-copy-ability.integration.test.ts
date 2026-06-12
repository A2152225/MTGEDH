import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PlayerID } from '../../shared/src/index.js';
import { createInitialGameState } from '../src/state/gameState.js';
import { executeTriggerEffect } from '../src/state/modules/stackExecuteTriggerEffectUtils.js';
import { resumeEffectProgramResolution } from '../src/state/effects/effectProgramResolutionService.js';
import { ResolutionQueueManager, ResolutionStepType } from '../src/state/resolution/index.js';
import { getStackItems } from '../../rules-engine/src/stackOperations.js';

describe('Oracle IR Rings optional-pay copy ability', () => {
  afterEach(() => {
    delete process.env.ORACLE_IR_TRIGGER_PRIMARY;
    vi.unstubAllEnvs();
  });

  function seedRingsCopyBoard(game: ReturnType<typeof createInitialGameState>, p1: PlayerID) {
    const ringsPermanentId = 'rings_1';
    const triggeringStackId = 'stack_trade_relay_ability_1';
    const effectText =
      'You may pay {2}. If you do, copy that ability. You may choose new targets for the copy.';

    (game.state as any).manaPool = {
      [p1]: { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 4 },
    };
    (game.state as any).stack = [
      {
        id: triggeringStackId,
        type: 'ability',
        controller: p1,
        source: 'trade_relay_1',
        sourceName: 'Trade Relay',
        card: { id: 'trade_relay_card_1', name: 'Trade Relay', type_line: 'Artifact' },
        abilityText: '{2}, {T}: Exchange control of two target permanents that share a card type.',
        targets: ['player_relic_1', 'opponent_relic_1'],
      },
    ];
    (game.state as any).battlefield = [
      {
        id: ringsPermanentId,
        controller: p1,
        card: { name: 'Rings of Brighthearth', type_line: 'Legendary Artifact' },
      },
    ];

    return { ringsPermanentId, triggeringStackId, effectText };
  }

  it('queues Effect Program optional pay and pushes ability copy after paying', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'test_oracle_ir_rings_copy_ability';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    const { ringsPermanentId, triggeringStackId, effectText } = seedRingsCopyBoard(game, p1);

    (game as any).gameId = gameId;
    (game as any).io = { to: () => ({ emit: vi.fn() }) };
    (game as any).bumpSeq = vi.fn();
    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(game as any, p1, 'Rings of Brighthearth', effectText, {
      id: 'rings_trigger_1',
      permanentId: ringsPermanentId,
      source: ringsPermanentId,
      triggeringStackItemId: triggeringStackId,
      effectData: { triggeringStackItemId: triggeringStackId },
    });

    const payStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.OPTION_CHOICE && (step as any)?.effectProgramPrompt === true);

    expect(payStep).toBeDefined();
    expect(String((payStep as any)?.description || '')).toContain('pay {2}');
    expect((payStep as any)?.pendingOptionalPaymentCallbackId).toBeUndefined();
    expect(getStackItems((game.state as any).stack)).toHaveLength(1);

    const resumed = resumeEffectProgramResolution({
      game,
      gameId,
      step: payStep!,
      response: { selections: ['yes'] },
      persistPrompt: false,
    });
    expect(resumed.status).toBe('completed');

    const copies = getStackItems((game.state as any).stack)
      .filter((item: any) => item?.copiedFromStackItemId === triggeringStackId);
    expect(copies).toHaveLength(1);
    expect(copies[0]?.type).toBe('ability');
    expect(copies[0]?.copiedBySourceName).toBe('Rings of Brighthearth');
  });

  it('declines optional pay without pushing an ability copy', () => {
    process.env.ORACLE_IR_TRIGGER_PRIMARY = '1';

    const gameId = 'test_oracle_ir_rings_copy_ability_decline';
    const game = createInitialGameState(gameId);
    const p1 = 'p1' as PlayerID;
    game.applyEvent({ type: 'join', playerId: p1, name: 'P1' } as any);

    const { ringsPermanentId, triggeringStackId, effectText } = seedRingsCopyBoard(game, p1);

    (game as any).gameId = gameId;
    (game as any).io = { to: () => ({ emit: vi.fn() }) };
    (game as any).bumpSeq = vi.fn();
    ResolutionQueueManager.removeQueue(gameId);

    executeTriggerEffect(game as any, p1, 'Rings of Brighthearth', effectText, {
      id: 'rings_trigger_decline_1',
      permanentId: ringsPermanentId,
      source: ringsPermanentId,
      triggeringStackItemId: triggeringStackId,
      effectData: { triggeringStackItemId: triggeringStackId },
    });

    const payStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, p1)
      .find((step) => step.type === ResolutionStepType.OPTION_CHOICE && (step as any)?.effectProgramPrompt === true);
    expect(payStep).toBeDefined();

    const resumed = resumeEffectProgramResolution({
      game,
      gameId,
      step: payStep!,
      response: { selections: ['no'] },
      persistPrompt: false,
    });
    expect(resumed.status).toBe('completed');

    const stackItems = getStackItems((game.state as any).stack);
    expect(stackItems).toHaveLength(1);
    expect(stackItems.some((item: any) => item?.copiedFromStackItemId === triggeringStackId)).toBe(false);
    expect(Number((game.state as any).manaPool?.[p1]?.colorless || 0)).toBe(4);
  });
});
