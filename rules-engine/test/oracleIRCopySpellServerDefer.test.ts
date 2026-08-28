import { describe, expect, it } from 'vitest';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { buildOracleIRExecutionContext } from '../src/oracleIRExecutorExecutionContext';
import { parseOracleTextToIR } from '../src/oracleIRParser';

describe('copy_spell server defer', () => {
  it('records server_stack_copy_required when deferStackSpellCopiesToServer is set', () => {
    const playerId = 'p1';
    const targetStackId = 'stack_opt_1';
    const forkStackId = 'stack_fork_1';
    const oracleText = 'Copy target instant or sorcery spell you control. You may choose new targets for the copy.';

    const state: any = {
      players: [{ id: playerId, hand: [], library: [], graveyard: [] }],
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
        },
        {
          id: forkStackId,
          type: 'spell',
          controller: playerId,
          card: { id: 'fork_1', name: 'Fork', type_line: 'Instant' },
          targets: [targetStackId],
        },
      ],
    };

    const steps = parseOracleTextToIR(oracleText, 'Fork').abilities.flatMap(
      (ability) => ability.steps || [],
    );
    expect(steps.some((step) => step.kind === 'copy_spell')).toBe(true);

    const irCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: forkStackId,
      sourceName: 'Fork',
      sourceObjectType: 'spell',
      targetSpellId: targetStackId,
      selectorContext: { targetSpellId: targetStackId },
      deferStackSpellCopiesToServer: true,
    });

    const result = applyOracleIRStepsToGameState(state, steps, irCtx, { allowOptional: true });
    expect(result.appliedSteps.some((step) => step.kind === 'copy_spell')).toBe(true);
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'server_stack_copy_required')).toBe(true);
  });

  it("defers optional this-spell copies for Sevinne's Reclamation instead of replaying the return", () => {
    const playerId = 'p1';
    const oracleText =
      'Return target permanent card with mana value 3 or less from your graveyard to the battlefield. If this spell was cast from a graveyard, you may copy this spell and may choose a new target for the copy.';
    const steps = parseOracleTextToIR(oracleText, "Sevinne's Reclamation").abilities.flatMap(
      (ability) => ability.steps || [],
    );

    const state: any = {
      players: [{
        id: playerId,
        hand: [],
        library: [],
        graveyard: [
          { id: 'target-a', name: "Wayfarer's Bauble", type_line: 'Artifact', mana_value: 1 },
          { id: 'target-b', name: 'Mind Stone', type_line: 'Artifact', mana_value: 2 },
        ],
      }],
      battlefield: [],
      stack: [],
    };

    const irCtx = buildOracleIRExecutionContext({
      controllerId: playerId,
      sourceId: 'stack_sevinne',
      sourceName: "Sevinne's Reclamation",
      sourceObjectType: 'spell',
      castFromZone: 'graveyard',
      targetPermanentId: 'target-a',
      deferStackSpellCopiesToServer: true,
      selectorContext: { targetPermanentId: 'target-a', chosenObjectIds: ['target-a'] },
    });

    const result = applyOracleIRStepsToGameState(state, steps, irCtx, { allowOptional: true });
    expect(result.appliedSteps.some((step) => step.kind === 'move_zone')).toBe(true);
    expect(result.appliedSteps.some((step) => step.kind === 'copy_spell')).toBe(true);
    expect(result.automationGaps.some((gap) => gap.reasonCode === 'server_stack_copy_required')).toBe(true);
    expect(((result.state.battlefield || []) as any[]).map((perm: any) => perm.card?.id)).toEqual(['target-a']);
  });
});
