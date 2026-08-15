import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyOracleIRStepsOnServer } from '../src/state/modules/oracleIrServerZoneSync.js';
import { collectSpellResolutionEffectSteps } from '../src/state/modules/trigger-runtime-wiring.js';
import { isSpellEffectFullyIrWired } from '../src/state/modules/oracleIrSpellLegacyRouting.js';
import { buildOracleIRExecutionContext } from '../../rules-engine/src/oracleIRExecutorExecutionContext.js';
import { ResolutionQueueManager } from '../src/state/resolution/index.js';
import { getStackItems } from '../../rules-engine/src/stackOperations.js';

const CHEFS_KISS_TEXT =
  "Gain control of target spell that targets only a single permanent or player. Copy it, then reselect the targets at random for the spell and the copy. The new targets can't be you or a permanent you control.";

describe("oracle IR Chef's Kiss stack control and random retarget", () => {
  const gameId = 'test_oracle_ir_chefs_kiss';

  afterEach(() => {
    ResolutionQueueManager.removeQueue(gameId);
    vi.unstubAllEnvs();
  });

  it('gains control of the targeted spell, copies it, and retargets both away from you', () => {
    vi.stubEnv('ORACLE_IR_SPELL_PRIMARY', '1');

    expect(isSpellEffectFullyIrWired(CHEFS_KISS_TEXT, "Chef's Kiss")).toBe(true);

    const playerId = 'p1';
    const opponentId = 'p2';
    const targetStackId = 'stack_bolt_1';
    const chefsKissStackId = 'stack_chefs_kiss_1';

    const state: any = {
      players: [
        { id: playerId, name: 'P1', hand: [], library: [], graveyard: [], life: 40 },
        { id: opponentId, name: 'P2', hand: [], library: [], graveyard: [], life: 40 },
      ],
      battlefield: [
        {
          id: 'perm_you_1',
          controller: playerId,
          owner: playerId,
          card: { name: 'Your Bear', type_line: 'Creature — Bear' },
        },
        {
          id: 'perm_opp_1',
          controller: opponentId,
          owner: opponentId,
          card: { name: 'Opp Bear', type_line: 'Creature — Bear' },
        },
      ],
      stack: [
        {
          id: targetStackId,
          type: 'spell',
          controller: opponentId,
          card: {
            id: 'bolt_1',
            name: 'Lightning Bolt',
            type_line: 'Instant',
            oracle_text: 'Lightning Bolt deals 3 damage to any target.',
          },
          targets: [{ id: playerId, type: 'player' }],
          copyRetargetValidTargets: [
            { id: playerId, name: 'P1', type: 'player' },
            { id: opponentId, name: 'P2', type: 'player' },
            { id: 'perm_you_1', name: 'Your Bear', type: 'permanent' },
            { id: 'perm_opp_1', name: 'Opp Bear', type: 'permanent' },
          ],
        },
        {
          id: chefsKissStackId,
          type: 'spell',
          controller: playerId,
          card: { id: 'chefs_kiss_1', name: "Chef's Kiss", type_line: 'Instant' },
          targets: [targetStackId],
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

    const steps = collectSpellResolutionEffectSteps(CHEFS_KISS_TEXT, "Chef's Kiss");
    expect(steps.map((step) => step.kind)).toEqual(['gain_control', 'copy_spell', 'change_target']);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: chefsKissStackId,
      sourceName: "Chef's Kiss",
      sourceObjectType: 'spell',
      selectorContext: { targetSpellId: targetStackId, chosenObjectIds: [targetStackId] },
      targetSpellId: targetStackId,
    });

    const result = applyOracleIRStepsOnServer(ctx, state, steps, irCtx, { allowOptional: true }, {
      controller: playerId,
      sourceItem: state.stack.find((item: any) => item.id === chefsKissStackId),
      oracleText: CHEFS_KISS_TEXT,
    });

    expect(result.appliedSteps.some((step) => step.kind === 'gain_control')).toBe(true);
    expect(result.appliedSteps.some((step) => step.kind === 'copy_spell')).toBe(true);
    expect(result.appliedSteps.some((step) => step.kind === 'change_target')).toBe(true);
    expect(result.skippedSteps).toEqual([]);

    const stackItems = getStackItems(state.stack);
    const original = stackItems.find((item: any) => item?.id === targetStackId);
    const copies = stackItems.filter((item: any) => item?.copiedFromStackItemId === targetStackId);

    expect(original?.controller).toBe(playerId);
    expect(copies).toHaveLength(1);
    expect(copies[0]?.controller).toBe(playerId);

    const forbidden = new Set([playerId, 'perm_you_1']);
    const originalTargetId = String(
      (Array.isArray(original?.targets) ? original.targets[0] : original?.targets)?.id
      || original?.targets?.[0]
      || '',
    );
    const copyTargetId = String(
      (Array.isArray(copies[0]?.targets) ? copies[0].targets[0] : copies[0]?.targets)?.id
      || copies[0]?.targets?.[0]
      || '',
    );
    expect(forbidden.has(originalTargetId)).toBe(false);
    expect(forbidden.has(copyTargetId)).toBe(false);

    const retargetPrompt = ResolutionQueueManager
      .getStepsForPlayer(gameId, playerId)
      .find((step: any) => step?.retargetSpellCopy === true);
    expect(retargetPrompt).toBeUndefined();
  });
});
