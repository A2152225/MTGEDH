import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';

const controllerId = 'p1' as PlayerID;

function collectStepKinds(steps: any[]): string[] {
  const kinds: string[] = [];
  for (const step of steps) {
    kinds.push(String(step.kind || ''));
    if (Array.isArray(step.steps)) kinds.push(...collectStepKinds(step.steps));
    if (Array.isArray(step.modes)) {
      for (const mode of step.modes) {
        if (Array.isArray(mode.steps)) kinds.push(...collectStepKinds(mode.steps));
      }
    }
  }
  return kinds;
}

function expectNoTargetGaps(steps: any[], state: GameState, ctx: Record<string, unknown>) {
  const result = applyOracleIRStepsToGameState(state, steps, ctx as any, { allowOptional: true });
  expect(result.automationGaps?.some((gap) => gap.reasonCode === 'no_deterministic_target')).toBe(false);
  expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_target')).toBe(false);
  return result;
}

function expectNoObjectSelectorGaps(steps: any[], state: GameState, ctx: Record<string, unknown>) {
  const result = applyOracleIRStepsToGameState(state, steps, ctx as any, { allowOptional: true });
  expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_object_selector')).toBe(false);
  return result;
}

describe('Oracle IR gap batch 382 — parser prune + target clusters (Track E2)', () => {
  it('prunes saga lore sacrifice tails and alternate-cost sacrifice misparses', () => {
    const saga = parseOracleTextToIR(
      '(As this Saga enters and after your draw step, add a lore counter.)\nI, II — Put a +1/+1 counter on up to one target creature.\nIII — Put target creature on top of its owner\'s library.\n(Sacrifice after III.)',
      'Phyrexian Scriptures'
    );
    const allSteps = saga.abilities.flatMap((ability) => ability.steps || []);
    expect(allSteps.some((step) => step.kind === 'sacrifice' && /after iii/i.test(String(step.raw || '')))).toBe(
      false
    );

    const thunderclap = parseOracleTextToIR(
      "You may sacrifice a Mountain rather than pay this spell's mana cost.\nThunderclap deals 3 damage to target creature or player.",
      'Thunderclap'
    );
    const thunderSteps = thunderclap.abilities.flatMap((ability) => ability.steps || []);
    expect(thunderSteps.some((step) => step.kind === 'sacrifice')).toBe(false);
  });

  it('prunes flashback exile tails and parenthetical cant_block reminder fragments', () => {
    const flashback = parseOracleTextToIR(
      'Flashback {2}{U} (You may cast this card from your graveyard for its flashback cost. Then exile it.)',
      'Flashback'
    );
    const flashSteps = flashback.abilities.flatMap((ability) => ability.steps || []);
    expect(flashSteps.some((step) => step.kind === 'exile' && /then exile it/i.test(String(step.raw || '')))).toBe(
      false
    );

    const decayed = parseOracleTextToIR(
      'Create a 2/2 black Zombie creature token with decayed. (It can\'t block. When it attacks, sacrifice it at end of combat.)',
      'Rotten Reunion'
    );
    const decaySteps = decayed.abilities.flatMap((ability) => ability.steps || []);
    expect(decaySteps.some((step) => step.kind === 'cant_block' && /^\(it can't block/i.test(String(step.raw || '')))).toBe(
      false
    );
  });

  it('executes mass creatures-cant-block and destroy-the-rest target clusters', () => {
    const demoralize = parseOracleTextToIR(
      "All creatures lose all abilities until end of turn. Creatures can't block this turn.",
      'Demoralize'
    );
    const cantBlockStep = demoralize.abilities.flatMap((ability) => ability.steps || []).find((step) => step.kind === 'cant_block');
    expect(cantBlockStep).toBeTruthy();
    expectNoTargetGaps(
      [cantBlockStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-1', controller: controllerId, type_line: 'Creature — Human' },
          { id: 'bf-2', controller: 'p2', type_line: 'Creature — Elf' },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-source' }
    );

    const duneblast = parseOracleTextToIR(
      'Choose up to one creature. Destroy the rest.',
      'Duneblast'
    );
    const destroyStep = duneblast.abilities[0].steps?.find((step) => step.kind === 'destroy');
    expect(destroyStep).toBeTruthy();
    const destroyResult = expectNoTargetGaps(
      [destroyStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-kept', controller: controllerId, type_line: 'Creature — Human' },
          { id: 'bf-rest-1', controller: controllerId, type_line: 'Creature — Zombie' },
          { id: 'bf-rest-2', controller: 'p2', type_line: 'Creature — Elf' },
        ],
      } as GameState,
      {
        controllerId,
        sourceId: 'bf-source',
        selectorContext: { chosenObjectIds: ['bf-kept'] },
      }
    );
    expect((destroyResult.state?.battlefield || []).map((perm: any) => perm.id)).toEqual(['bf-kept']);
  });

  it('executes non-subtype cant_attack and mass unblock grant clusters', () => {
    const evilEye = parseOracleTextToIR(
      "Non-Eye creatures you control can't attack.",
      'Evil Eye of Orms-by-Gore'
    );
    const cantAttackStep = evilEye.abilities[0].steps?.find((step) => step.kind === 'cant_attack');
    expect(cantAttackStep).toBeTruthy();
    expectNoTargetGaps(
      [cantAttackStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-eye', controller: controllerId, type_line: 'Creature — Eye' },
          { id: 'bf-human', controller: controllerId, type_line: 'Creature — Human' },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-source' }
    );

    const veiling = parseOracleTextToIR(
      "Creatures can't be blocked this turn.",
      'Veiling Oddity'
    );
    const unblockStep = veiling.abilities[0].steps?.find((step) => step.kind === 'grant_temporary_ability');
    expect(unblockStep).toBeTruthy();
    expectNoTargetGaps(
      [unblockStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-1', controller: controllerId, type_line: 'Creature — Illusion' }],
      } as GameState,
      { controllerId, sourceId: 'bf-source' }
    );
  });
});
