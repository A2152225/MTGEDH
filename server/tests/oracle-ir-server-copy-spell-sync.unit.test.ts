import { describe, expect, it, vi } from 'vitest';

import * as db from '../src/db/index.js';
import { queueCopySpellStackPushFromOracleIRResult } from '../src/state/modules/oracleIrServerCopySpellSync.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutorExecutionContext.js';
import { getStackItems } from '../../rules-engine/src/stackOperations.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';

describe('queueCopySpellStackPushFromOracleIRResult', () => {
  it('pushes deferred stack copies and preserves existing stack items', () => {
    const gameId = 'test_copy_spell_sync_unit';
    const playerId = 'p1';
    const targetStackId = 'stack_bolt_1';

    const state: any = {
      stack: {
        objects: [
          {
            id: targetStackId,
            type: 'spell',
            controller: playerId,
            card: {
              id: 'bolt_1',
              name: 'Lightning Bolt',
              type_line: 'Instant',
              oracle_text: 'Lightning Bolt deals 3 damage to any target.',
            },
            targets: [playerId],
          },
        ],
      },
    };

    const copyStep = {
      kind: 'copy_spell',
      subject: 'target_spell',
      allowNewTargets: true,
      raw: 'Copy target instant or sorcery spell you control. You may choose new targets for the copy.',
    } as const;

    const result: any = {
      appliedSteps: [copyStep],
      skippedSteps: [],
      automationGaps: [{
        reasonCode: 'server_stack_copy_required',
        stepKind: 'copy_spell',
        raw: copyStep.raw,
        metadata: { copyCount: 1 },
      }],
    };

    const irCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: 'stack_fork_1',
      sourceName: 'Fork',
      targetSpellId: targetStackId,
    });

    const ctx: any = {
      gameId,
      state: { seq: 0 },
      bumpSeq: vi.fn(),
      io: { to: () => ({ emit: vi.fn() }) },
    };

    const appendEventSpy = vi.spyOn(db, 'appendEvent').mockImplementation(() => undefined as any);

    const bridged = queueCopySpellStackPushFromOracleIRResult(ctx, state, result, {
      controller: playerId,
      sourceName: 'Fork',
      irCtx,
      sourceItem: {
        copyRetargetValidTargets: [{ id: playerId, name: 'P1', type: 'player' }],
        copyRetargetMinTargets: 1,
        copyRetargetMaxTargets: 1,
      },
    });

    expect(bridged).toBe(true);
    const stackItems = getStackItems(state.stack);
    expect(stackItems).toHaveLength(2);
    expect(stackItems.some((item: any) => item?.id === targetStackId)).toBe(true);
    expect(stackItems.filter((item: any) => item?.copiedFromStackItemId === targetStackId)).toHaveLength(1);
    expect(appendEventSpy).toHaveBeenCalledWith(
      gameId,
      0,
      'copyTriggeredSpellResolve',
      expect.objectContaining({
        sourceName: 'Fork',
        controllerId: playerId,
        triggeringStackItemId: targetStackId,
        copiedStackItemId: expect.any(String),
      }),
    );
    appendEventSpy.mockRestore();
  });

  it('pushes deferred ability copies onto the stack', () => {
    const gameId = 'test_copy_ability_sync_unit';
    const playerId = 'p1';
    const targetStackId = 'stack_ability_1';

    const state: any = {
      stack: [
        {
          id: targetStackId,
          type: 'ability',
          controller: playerId,
          sourceName: 'Trade Relay',
          card: { id: 'trade_relay_1', name: 'Trade Relay', type_line: 'Artifact' },
          abilityText: '{2}, {T}: Exchange control of two target permanents that share a card type.',
          targets: ['perm_a', 'perm_b'],
        },
      ],
    };

    const copyStep = {
      kind: 'copy_spell',
      subject: 'target_spell',
      target: { kind: 'raw', text: 'that ability' },
      allowNewTargets: true,
      raw: 'copy that ability. You may choose new targets for the copy.',
    } as const;

    const result: any = {
      appliedSteps: [copyStep],
      skippedSteps: [],
      automationGaps: [{
        reasonCode: 'server_stack_copy_required',
        stepKind: 'copy_spell',
        raw: copyStep.raw,
        metadata: { copyCount: 1 },
      }],
    };

    const irCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: 'rings_trigger_1',
      sourceName: 'Rings of Brighthearth',
      targetSpellId: targetStackId,
    });

    const ctx: any = {
      gameId,
      state: { seq: 0 },
      bumpSeq: vi.fn(),
      io: { to: () => ({ emit: vi.fn() }) },
    };

    const appendEventSpy = vi.spyOn(db, 'appendEvent').mockImplementation(() => undefined as any);

    const bridged = queueCopySpellStackPushFromOracleIRResult(ctx, state, result, {
      controller: playerId,
      sourceName: 'Rings of Brighthearth',
      irCtx,
      sourceItem: {
        id: 'rings_trigger_1',
        triggeringStackItemId: targetStackId,
      },
    });

    expect(bridged).toBe(true);
    const stackItems = getStackItems(state.stack);
    expect(stackItems).toHaveLength(2);
    const copy = stackItems.find((item: any) => item?.copiedFromStackItemId === targetStackId);
    expect(copy?.type).toBe('ability');
    expect(appendEventSpy).toHaveBeenCalledWith(
      gameId,
      0,
      'copyTriggeredAbilityResolve',
      expect.objectContaining({
        sourceName: 'Rings of Brighthearth',
        triggeringStackItemId: targetStackId,
      }),
    );
    appendEventSpy.mockRestore();
  });

  it('queues one retarget prompt per deferred copy when allowNewTargets is set', () => {
    const gameId = 'test_copy_spell_sync_multi_retarget';
    const playerId = 'p1';
    const targetStackId = 'stack_growth_1';

    const state: any = {
      stack: [
        {
          id: targetStackId,
          type: 'spell',
          controller: playerId,
          card: { id: 'growth_1', name: 'Giant Growth', type_line: 'Instant' },
          targets: ['zada_1'],
          copyRetargetValidTargets: [
            { id: 'zada_1', type: 'permanent' },
            { id: 'bear_1', type: 'permanent' },
            { id: 'bear_2', type: 'permanent' },
          ],
          copyRetargetMinTargets: 1,
          copyRetargetMaxTargets: 1,
        },
      ],
    };

    const copyStep = {
      kind: 'copy_spell',
      subject: 'target_spell',
      allowNewTargets: true,
      raw: 'copy that spell for each other creature you control that the spell could target. You may choose new targets for the copies.',
    } as const;

    const result: any = {
      appliedSteps: [copyStep],
      skippedSteps: [],
      automationGaps: [{
        reasonCode: 'server_stack_copy_required',
        stepKind: 'copy_spell',
        raw: copyStep.raw,
        metadata: { copyCount: 2 },
      }],
    };

    const irCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: 'zada_trigger_1',
      sourceName: 'Zada, Hedron Grinder',
      targetSpellId: targetStackId,
    });

    const ctx: any = {
      gameId,
      state: { seq: 0 },
      bumpSeq: vi.fn(),
      io: { to: () => ({ emit: vi.fn() }) },
    };

    ResolutionQueueManager.removeQueue(gameId);
    vi.spyOn(db, 'appendEvent').mockImplementation(() => undefined as any);

    const bridged = queueCopySpellStackPushFromOracleIRResult(ctx, state, result, {
      controller: playerId,
      sourceName: 'Zada, Hedron Grinder',
      irCtx,
      sourceItem: { triggeringStackItemId: targetStackId },
    });

    expect(bridged).toBe(true);
    const copies = getStackItems(state.stack).filter((item: any) => item?.copiedFromStackItemId === targetStackId);
    expect(copies).toHaveLength(2);

    const retargetSteps = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId)
      .filter((step: any) => step?.retargetSpellCopy === true || step?.retargetSpellCopyTargetSelection === true);
    expect(retargetSteps).toHaveLength(2);
    expect(new Set(retargetSteps.map((step: any) => String(step?.retargetSpellCopyStackItemId || '')))).toEqual(
      new Set(copies.map((copy: any) => String(copy?.id || ''))),
    );

    ResolutionQueueManager.removeQueue(gameId);
    vi.restoreAllMocks();
  });

  it('stamps optional this-spell copies for a later may-copy prompt instead of auto-pushing', () => {
    const gameId = 'test_optional_this_spell_copy_sync';
    const playerId = 'p1';
    const stackId = 'stack_sevinne_1';
    const state: any = {
      stack: [{
        id: stackId,
        type: 'spell',
        controller: playerId,
        castFromGraveyard: true,
        card: {
          id: 'sevinne_1',
          name: "Sevinne's Reclamation",
          type_line: 'Sorcery',
          oracle_text: 'Return target permanent card with mana value 3 or less from your graveyard to the battlefield. If this spell was cast from a graveyard, you may copy this spell and may choose a new target for the copy.',
        },
        targets: ['sevinne_target_1'],
      }],
    };
    const copyStep = {
      kind: 'copy_spell',
      subject: 'this_spell',
      optional: true,
      allowNewTargets: true,
      raw: 'you may copy this spell and may choose a new target for the copy',
    } as const;
    const result: any = {
      appliedSteps: [copyStep],
      skippedSteps: [],
      automationGaps: [{
        reasonCode: 'server_stack_copy_required',
        stepKind: 'copy_spell',
        raw: copyStep.raw,
        metadata: { copyCount: 1 },
      }],
    };
    const irCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: stackId,
      sourceName: "Sevinne's Reclamation",
    });
    const ctx: any = {
      gameId,
      state: { seq: 0 },
      bumpSeq: vi.fn(),
      io: { to: () => ({ emit: vi.fn() }) },
    };

    ResolutionQueueManager.removeQueue(gameId);
    const bridged = queueCopySpellStackPushFromOracleIRResult(ctx, state, result, {
      controller: playerId,
      sourceName: "Sevinne's Reclamation",
      irCtx,
      sourceItem: state.stack[0],
    });

    expect(bridged).toBe(true);
    expect(state.stack[0].oracleIrOptionalCopyThisSpell).toBe(true);
    expect(getStackItems(state.stack)).toHaveLength(1);
    expect(ResolutionQueueManager.getQueue(gameId).steps || []).toHaveLength(0);

    ResolutionQueueManager.removeQueue(gameId);
  });

  it('does not copy a leftover live spell when the bound this_spell id already left', () => {
    const gameId = 'test_this_spell_bound_id_left';
    const playerId = 'p1';
    const leftoverId = 'stack_warp_1';
    const state: any = {
      stack: [{
        id: leftoverId,
        type: 'spell',
        controller: playerId,
        card: {
          id: 'warp_1',
          name: 'Warp World',
          type_line: 'Sorcery',
          oracle_text: 'Each player shuffles all permanents they own into their library...',
        },
      }],
    };
    const copyStep = {
      kind: 'copy_spell',
      subject: 'this_spell',
      raw: 'Copy this spell.',
    } as const;
    const result: any = {
      appliedSteps: [copyStep],
      skippedSteps: [],
      automationGaps: [{
        reasonCode: 'server_stack_copy_required',
        stepKind: 'copy_spell',
        raw: copyStep.raw,
        metadata: { copyCount: 1 },
      }],
    };
    const irCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: 'gone_storm_1',
      sourceName: "Sevinne's Reclamation",
    });
    const ctx: any = {
      gameId,
      state: { seq: 0 },
      bumpSeq: vi.fn(),
      io: { to: () => ({ emit: vi.fn() }) },
    };

    const appendEventSpy = vi.spyOn(db, 'appendEvent').mockImplementation(() => undefined as any);
    const bridged = queueCopySpellStackPushFromOracleIRResult(ctx, state, result, {
      controller: playerId,
      sourceName: "Sevinne's Reclamation",
      irCtx,
      sourceItem: { id: 'gone_storm_1', sourceName: "Sevinne's Reclamation" },
    });
    appendEventSpy.mockRestore();

    expect(bridged).toBe(false);
    expect(getStackItems(state.stack)).toHaveLength(1);
    expect(getStackItems(state.stack)[0]?.id).toBe(leftoverId);
  });
});
