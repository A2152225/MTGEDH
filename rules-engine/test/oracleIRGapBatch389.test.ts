import { describe, expect, it } from 'vitest';
import type { GameState, PlayerID } from '../../shared/src';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';

const controllerId = 'p1' as PlayerID;

function expectNoTargetGaps(steps: any[], state: GameState, ctx: Record<string, unknown>) {
  const result = applyOracleIRStepsToGameState(state, steps, ctx as any, { allowOptional: true });
  expect(result.automationGaps?.some((gap) => gap.reasonCode === 'no_deterministic_target')).toBe(false);
  expect(result.automationGaps?.some((gap) => gap.reasonCode === 'unsupported_target')).toBe(false);
  return result;
}

function flattenSteps(steps: any[]): any[] {
  return steps.flatMap((step) =>
    step?.kind === 'conditional' && Array.isArray(step.steps) ? flattenSteps(step.steps) : [step]
  );
}

describe('Oracle IR gap batch 389 — target clusters (Track E2 mega-batch)', () => {
  it('executes cant restrictions, grants, and animate clusters', () => {
    const bedlam = parseOracleTextToIR("Creatures can't block.", 'Bedlam');
    const cantBlockStep = bedlam.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'cant_block');
    expect(cantBlockStep).toBeTruthy();
    expectNoTargetGaps(
      [cantBlockStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-creature', controller: 'p2', type_line: 'Creature — Human' }],
      } as GameState,
      { controllerId, sourceId: 'bf-src' }
    );

    const lightOfDay = parseOracleTextToIR("Black creatures can't attack.", 'Light of Day');
    const cantAttackStep = lightOfDay.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'cant_attack');
    expect(cantAttackStep).toBeTruthy();
    expectNoTargetGaps(
      [cantAttackStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-black', controller: 'p2', type_line: 'Creature — Zombie', colors: ['B'] }],
      } as GameState,
      { controllerId, sourceId: 'bf-src' }
    );

    const tetsuko = parseOracleTextToIR(
      "Creatures you control with power or toughness 1 or less can't be blocked.",
      'Tetsuko Umezawa, Fugitive'
    );
    const grantStep = tetsuko.abilities.flatMap((a) => flattenSteps(a.steps || [])).find((s) => s.kind === 'grant_temporary_ability');
    expect(grantStep).toBeTruthy();
    expectNoTargetGaps(
      [grantStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-small', controller: controllerId, type_line: 'Creature — Human', power: 1, toughness: 1 }],
      } as GameState,
      { controllerId, sourceId: 'bf-src' }
    );
  });

  it('executes destroy, exile, sacrifice, and copy clusters', () => {
    const curtains = parseOracleTextToIR('Destroy two target creatures.', "Curtains' Call");
    const destroyStep = curtains.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'destroy');
    expect(destroyStep).toBeTruthy();
    expectNoTargetGaps(
      [destroyStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-a', controller: 'p2', type_line: 'Creature — Zombie' },
          { id: 'bf-b', controller: 'p2', type_line: 'Creature — Human' },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-src', selectorContext: { chosenObjectIds: ['bf-a', 'bf-b'] } }
    );

    const divergent = parseOracleTextToIR('Exile two target creatures.', 'Divergent Transformations');
    const exileStep = divergent.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'exile');
    expect(exileStep).toBeTruthy();
    expectNoTargetGaps(
      [exileStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-x', controller: 'p2', type_line: 'Creature — Elf' },
          { id: 'bf-y', controller: 'p2', type_line: 'Creature — Goblin' },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-src', selectorContext: { chosenObjectIds: ['bf-x', 'bf-y'] } }
    );

    const szats = parseOracleTextToIR(
      'Each opponent sacrifices a creature they control with the greatest power.',
      "Szat's Will"
    );
    const sacrificeStep = szats.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'sacrifice');
    expect(sacrificeStep).toBeTruthy();
    expectNoTargetGaps(
      [sacrificeStep!],
      {
        players: [{ id: controllerId }, { id: 'p2' }],
        battlefield: [{ id: 'bf-opp', controller: 'p2', type_line: 'Creature — Demon', power: 6 }],
      } as GameState,
      { controllerId, sourceId: 'bf-src' }
    );

    const fleeting = parseOracleTextToIR(
      'Until end of turn, it becomes a copy of up to one other target creature.',
      'Fleeting Reflection'
    );
    const copyStep = fleeting.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'copy_permanent');
    expect(copyStep).toBeTruthy();
    expectNoTargetGaps(
      [copyStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-self', controller: controllerId, type_line: 'Creature — Shapeshifter' },
          { id: 'bf-ref', controller: controllerId, type_line: 'Creature — Elf' },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-self', selectorContext: { chosenObjectIds: ['bf-ref'] } }
    );
  });

  it('executes remove_counter, force_block, prevent, and modify_pt clusters', () => {
    const hex = parseOracleTextToIR('Remove up to X counters from target permanent.', 'Hex Parasite');
    const removeStep = hex.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'remove_counter');
    expect(removeStep).toBeTruthy();
    expectNoTargetGaps(
      [removeStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-target', controller: 'p2', type_line: 'Creature — Human', counters: { '+1/+1': 2 } }],
      } as GameState,
      { controllerId, sourceId: 'bf-src', xValue: 2, selectorContext: { chosenObjectIds: ['bf-target'] } }
    );

    const hustle = parseOracleTextToIR('Target creature attacks or blocks this turn if able.', 'Hustle // Bustle');
    const forceStep = hustle.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'force_block');
    expect(forceStep).toBeTruthy();
    expectNoTargetGaps(
      [forceStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [{ id: 'bf-target', controller: 'p2', type_line: 'Creature — Human' }],
      } as GameState,
      { controllerId, sourceId: 'bf-src', selectorContext: { chosenObjectIds: ['bf-target'] } }
    );

    const grace = parseOracleTextToIR(
      'Prevent the next 3 damage that would be dealt to any target this turn by a source of your choice.',
      'Healing Grace'
    );
    const preventStep = grace.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'prevent_damage');
    expect(preventStep).toBeTruthy();
    expectNoTargetGaps(
      [preventStep!],
      { players: [{ id: controllerId }] } as GameState,
      { controllerId, sourceId: 'bf-src' }
    );

    const sierra = parseOracleTextToIR(
      'Target creature you control gets +X/+X until end of turn, where X is the number of quest counters on this permanent.',
      "Sierra, Nuka's Biggest Fan"
    );
    const modifyStep = sierra.abilities.flatMap((a) => a.steps || []).find((s) => s.kind === 'modify_pt');
    expect(modifyStep).toBeTruthy();
    expectNoTargetGaps(
      [modifyStep!],
      {
        players: [{ id: controllerId }],
        battlefield: [
          { id: 'bf-src', controller: controllerId, type_line: 'Artifact', counters: { quest: 3 } },
          { id: 'bf-target', controller: controllerId, type_line: 'Creature — Human' },
        ],
      } as GameState,
      { controllerId, sourceId: 'bf-src', targetCreatureId: 'bf-target', selectorContext: { chosenObjectIds: ['bf-target'] } }
    );
  });
});
