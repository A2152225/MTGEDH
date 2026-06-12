import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { collectOracleEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutorExecutionContext.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { getStackItems } from '../../rules-engine/src/stackOperations.js';

describe('oracle IR copy_spell stack push', () => {
  const gameId = 'test_oracle_ir_copy_spell_stack';

  afterEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    vi.unstubAllEnvs();
  });

  it('pushes targeted instant copies onto the stack under spell IR primary', () => {
    vi.stubEnv('ORACLE_IR_SPELL_PRIMARY', '1');

    const playerId = 'p1';
    const targetStackId = 'stack_opt_1';
    const vengeanceStackId = 'stack_vengeance_1';
    const oracleText =
      'Copy target instant or sorcery spell you control. If this spell was cast from a graveyard, copy that spell twice instead. You may choose new targets for the copies.\nFlashback {3}{R}{R}';

    const state: any = {
      players: [{ id: playerId, name: 'P1', hand: [], library: [], graveyard: [] }],
      stack: [
        {
          id: targetStackId,
          type: 'spell',
          controller: playerId,
          card: {
            id: 'opt_1',
            name: 'Opt',
            type_line: 'Instant',
            oracle_text: 'Draw a card.',
          },
          targets: [],
        },
        {
          id: vengeanceStackId,
          type: 'spell',
          controller: playerId,
          castFromGraveyard: true,
          card: {
            id: 'vengeance_1',
            name: 'Increasing Vengeance',
            type_line: 'Instant',
            castWithAbility: 'flashback',
          },
          targets: [targetStackId],
        },
      ],
      zones: { [playerId]: { hand: [], library: [], graveyard: [], exile: [] } },
    };

    const ctx: any = {
      gameId,
      state,
      libraries: { [playerId]: [] },
      bumpSeq: vi.fn(),
      io: { to: () => ({ emit: vi.fn() }) },
    };

    const steps = collectOracleEffectSteps(oracleText, 'Increasing Vengeance');
    expect(steps.some((step) => step.kind === 'copy_spell')).toBe(true);
    const irCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: vengeanceStackId,
      sourceName: 'Increasing Vengeance',
      sourceObjectType: 'spell',
      selectorContext: { targetSpellId: targetStackId, chosenObjectIds: [targetStackId] },
      targetSpellId: targetStackId,
      castFromZone: 'graveyard',
    });

    const result = applyOracleIRStepsOnServer(ctx, state, steps, irCtx, { allowOptional: true }, {
      controller: playerId,
      sourceItem: state.stack.find((item: any) => item.id === vengeanceStackId),
      oracleText,
    });

    expect(result.appliedSteps.some((step) => step.kind === 'copy_spell')).toBe(true);
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'server_stack_copy_required')).toBe(true);

    const stackItems = getStackItems(state.stack);
    const copies = stackItems.filter(
      (item: any) => item?.copiedFromStackItemId === targetStackId,
    );
    expect(copies).toHaveLength(2);
    expect(copies.every((item: any) => item?.isCopy === true && item?.copiedBySourceName === 'Increasing Vengeance')).toBe(true);
    expect(stackItems.some((item: any) => item?.id === targetStackId)).toBe(true);
  });

  it('queues retarget prompts when copy metadata and targets are present', () => {
    vi.stubEnv('ORACLE_IR_SPELL_PRIMARY', '1');

    const playerId = 'p1';
    const opponentId = 'p2';
    const targetStackId = 'stack_bolt_1';
    const forkStackId = 'stack_fork_1';
    const oracleText = 'Copy target instant or sorcery spell you control. You may choose new targets for the copy.';

    const state: any = {
      players: [
        { id: playerId, name: 'P1', hand: [], library: [], graveyard: [] },
        { id: opponentId, name: 'P2', hand: [], library: [], graveyard: [], life: 40 },
      ],
      stack: [
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
          targets: [opponentId],
        },
        {
          id: forkStackId,
          type: 'spell',
          controller: playerId,
          card: { id: 'fork_1', name: 'Fork', type_line: 'Instant' },
          targets: [targetStackId],
          copyRetargetValidTargets: [
            { id: playerId, name: 'P1', type: 'player' },
            { id: opponentId, name: 'P2', type: 'player' },
          ],
          copyRetargetMinTargets: 1,
          copyRetargetMaxTargets: 1,
          copyRetargetTargetDescription: 'any target',
        },
      ],
      zones: {
        [playerId]: { hand: [], library: [], graveyard: [], exile: [] },
        [opponentId]: { hand: [], library: [], graveyard: [], exile: [] },
      },
    };

    const ctx: any = {
      gameId,
      state,
      libraries: { [playerId]: [], [opponentId]: [] },
      bumpSeq: vi.fn(),
      io: { to: () => ({ emit: vi.fn() }) },
    };

    const steps = collectOracleEffectSteps(oracleText, 'Fork');
    expect(steps.some((step) => step.kind === 'copy_spell')).toBe(true);
    const irCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: forkStackId,
      sourceName: 'Fork',
      sourceObjectType: 'spell',
      selectorContext: { targetSpellId: targetStackId, chosenObjectIds: [targetStackId] },
      targetSpellId: targetStackId,
    });

    applyOracleIRStepsOnServer(ctx, state, steps, irCtx, { allowOptional: true }, {
      controller: playerId,
      sourceItem: state.stack.find((item: any) => item.id === forkStackId),
      oracleText,
    });

    const stackItems = getStackItems(state.stack);
    const copies = stackItems.filter(
      (item: any) => item?.copiedFromStackItemId === targetStackId,
    );
    expect(copies).toHaveLength(1);

    const retargetStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId)
      .find((step: any) => step?.retargetSpellCopy === true);
    expect(retargetStep).toBeDefined();
    expect(String((retargetStep as any)?.retargetSpellCopyStackItemId || '')).toBe(String(copies[0]?.id || ''));
  });

  it('queues direct retarget target selection when the copied spell has no current targets', () => {
    vi.stubEnv('ORACLE_IR_SPELL_PRIMARY', '1');

    const playerId = 'p1';
    const opponentId = 'p2';
    const targetStackId = 'stack_bolt_1';
    const forkStackId = 'stack_fork_1';
    const oracleText = 'Copy target instant or sorcery spell you control. You may choose new targets for the copy.';

    const state: any = {
      players: [
        { id: playerId, name: 'P1', hand: [], library: [], graveyard: [] },
        { id: opponentId, name: 'P2', hand: [], library: [], graveyard: [], life: 40 },
      ],
      stack: [
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
          targets: [],
        },
        {
          id: forkStackId,
          type: 'spell',
          controller: playerId,
          card: { id: 'fork_1', name: 'Fork', type_line: 'Instant' },
          targets: [targetStackId],
          copyRetargetValidTargets: [
            { id: playerId, name: 'P1', type: 'player' },
            { id: opponentId, name: 'P2', type: 'player' },
          ],
          copyRetargetMinTargets: 1,
          copyRetargetMaxTargets: 1,
          copyRetargetTargetDescription: 'any target',
        },
      ],
      zones: {
        [playerId]: { hand: [], library: [], graveyard: [], exile: [] },
        [opponentId]: { hand: [], library: [], graveyard: [], exile: [] },
      },
    };

    const ctx: any = {
      gameId,
      state,
      libraries: { [playerId]: [], [opponentId]: [] },
      bumpSeq: vi.fn(),
      io: { to: () => ({ emit: vi.fn() }) },
    };

    const steps = collectOracleEffectSteps(oracleText, 'Fork');
    const irCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: forkStackId,
      sourceName: 'Fork',
      sourceObjectType: 'spell',
      selectorContext: { targetSpellId: targetStackId, chosenObjectIds: [targetStackId] },
      targetSpellId: targetStackId,
    });

    applyOracleIRStepsOnServer(ctx, state, steps, irCtx, { allowOptional: true }, {
      controller: playerId,
      sourceItem: state.stack.find((item: any) => item.id === forkStackId),
      oracleText,
    });

    const retargetStep = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId)
      .find((step: any) => step?.retargetSpellCopyTargetSelection === true);
    expect(retargetStep).toBeDefined();
    expect((retargetStep as any)?.mandatory).toBe(false);
  });
});
