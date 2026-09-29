import { describe, expect, it } from 'vitest';
import { applyOracleIRStepsToGameState } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { applyTemporarySetBasePowerToughness } from '../src/oracleIRExecutorCreatureStepUtils';
import { describeSetterOrdering, nextEffectTimestamp } from '../src/oracleIRExecutorEffectTimestamps';
import { calculateEffectivePT } from '../src/staticAbilitiesEvaluation';

function stepsOf(text: string): any[] {
  return parseOracleTextToIR(text, 'Test').abilities.flatMap((ability: any) => ability.steps);
}

function bear(id = 'bear', controller = 'p1') {
  return {
    id,
    controller,
    owner: controller,
    counters: {},
    card: { name: id, type_line: 'Creature - Bear', power: '2', toughness: '2', oracle_text: '' },
  };
}

function baseState(battlefield: any[], turnNumber = 4): any {
  return { players: [{ id: 'p1', life: 40 }, { id: 'p2', life: 40 }], life: { p1: 40, p2: 40 }, battlefield, turnNumber };
}

describe('item 2: pumps lasting longer than end of turn parse with their own duration', () => {
  it('"gets +2/+2 until your next turn" is modify_pt until_next_turn', () => {
    const steps = stepsOf('Target creature gets +2/+2 until your next turn.');
    expect(steps[0]).toMatchObject({ kind: 'modify_pt', power: 2, toughness: 2, duration: 'until_next_turn' });
  });

  it('"gets +2/+2 until end of combat" is modify_pt end_of_combat (was unparsed)', () => {
    const steps = stepsOf('Target creature gets +2/+2 until end of combat.');
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ kind: 'modify_pt', power: 2, toughness: 2, duration: 'end_of_combat' });
  });

  it('"Creatures you control get +1/+1 until your next turn" is not a permanent static', () => {
    const steps = stepsOf('Creatures you control get +1/+1 until your next turn.');
    expect(steps[0]).toMatchObject({ kind: 'grant_static_ability', power: 1, toughness: 1, duration: 'until_next_turn' });
    const prefix = stepsOf('Until your next turn, creatures you control get +1/+1.');
    expect(prefix[0]).toMatchObject({ kind: 'grant_static_ability', power: 1, toughness: 1, duration: 'until_next_turn' });
  });

  it('"Creatures you control get +1/+1 until end of combat" carries end_of_combat', () => {
    const steps = stepsOf('Creatures you control get +1/+1 until end of combat.');
    expect(steps[0]).toMatchObject({ kind: 'grant_static_ability', power: 1, toughness: 1, duration: 'end_of_combat' });
  });

  it('a permanent "gets +1/+1" static keeps the static duration', () => {
    const steps = stepsOf('Creatures you control get +1/+1.');
    expect(steps[0]).toMatchObject({ kind: 'grant_static_ability', duration: 'static' });
  });

  it('compound pump + keyword with an end-of-combat duration is never a permanent +N/+N static', () => {
    const steps = stepsOf('Creatures you control get +1/+1 and gain vigilance until end of combat.');
    const permanentPump = steps.find((step: any) => step.kind === 'grant_static_ability' && step.duration === 'static' && step.power === 1);
    expect(permanentPump).toBeUndefined();
  });
});

describe('item 2: executor records long-lasting pumps with expiry data', () => {
  it('until_next_turn pump stores duration, controller expiry and the turn it was applied', () => {
    const steps = stepsOf('Target creature gets -3/-0 until your next turn.');
    const result: any = applyOracleIRStepsToGameState(baseState([bear()], 7), steps as any, {
      controllerId: 'p1', sourceId: 'src', sourceName: 'Src', targetCreatureId: 'bear', targetPermanentId: 'bear',
      selectorContext: { targetCreatureId: 'bear', targetPermanentId: 'bear', chosenObjectIds: ['bear'] },
    } as any);
    const modifier = result.state.battlefield[0].modifiers.find((m: any) => m.type === 'powerToughness');
    expect(modifier).toMatchObject({ power: -3, toughness: 0, duration: 'until_next_turn', expiresOnControllerTurn: 'p1', turnApplied: 7 });
  });

  it('end_of_combat pump stores the end_of_combat duration', () => {
    const steps = stepsOf('Target creature gets +2/+2 until end of combat.');
    const result: any = applyOracleIRStepsToGameState(baseState([bear()], 7), steps as any, {
      controllerId: 'p1', sourceId: 'src', sourceName: 'Src', targetCreatureId: 'bear', targetPermanentId: 'bear',
      selectorContext: { targetCreatureId: 'bear', targetPermanentId: 'bear', chosenObjectIds: ['bear'] },
    } as any);
    const modifier = result.state.battlefield[0].modifiers.find((m: any) => m.type === 'powerToughness');
    expect(modifier).toMatchObject({ power: 2, toughness: 2, duration: 'end_of_combat', turnApplied: 7 });
  });

  it('a static-duration team pump records an until_next_turn modifier with controller expiry', () => {
    const steps = stepsOf('Creatures you control get +1/+1 until your next turn.');
    const result: any = applyOracleIRStepsToGameState(baseState([bear('a'), bear('b')], 5), steps as any, {
      controllerId: 'p1', sourceId: 'src', sourceName: 'Src',
    } as any);
    const modifiers = result.state.battlefield.flatMap((perm: any) => perm.modifiers || []).filter((m: any) => m.type === 'powerToughness');
    expect(modifiers.length).toBe(2);
    for (const modifier of modifiers) {
      expect(modifier).toMatchObject({ duration: 'until_next_turn', expiresOnControllerTurn: 'p1', turnApplied: 5 });
    }
  });
});

describe('item 3: "becomes an X/Y" setters get timestamps', () => {
  it('each setter gets a strictly higher timestamp than the previous one', () => {
    const ctx: any = { controllerId: 'p1', sourceId: 'src' };
    let state: any = baseState([bear('a'), bear('b')]);
    state = applyTemporarySetBasePowerToughness(state, 'a', ctx, 1, 1);
    state = applyTemporarySetBasePowerToughness(state, 'b', ctx, 4, 4);
    state = applyTemporarySetBasePowerToughness(state, 'a', ctx, 0, 5);
    const setters = state.battlefield.flatMap((perm: any) => perm.modifiers || []).filter((m: any) => m.type === 'setPowerToughness');
    const stamps = setters.map((m: any) => m.timestamp);
    expect(new Set(stamps).size).toBe(3);
    expect(stamps.every((value: unknown) => typeof value === 'number')).toBe(true);
    const onA = state.battlefield.find((perm: any) => perm.id === 'a').modifiers.filter((m: any) => m.type === 'setPowerToughness');
    expect(onA[1].timestamp).toBeGreaterThan(onA[0].timestamp);
    expect(onA[0]).toMatchObject({ battlefieldPosition: 2, battlefieldAnchorId: 'b' });
  });

  it('nextEffectTimestamp is one more than the highest modifier timestamp', () => {
    expect(nextEffectTimestamp(baseState([bear()]))).toBe(1);
    const state = baseState([{ ...bear(), modifiers: [{ type: 'setPowerToughness', timestamp: 41 }] }]);
    expect(nextEffectTimestamp(state)).toBe(42);
    expect(describeSetterOrdering(state)).toMatchObject({ timestamp: 42, battlefieldPosition: 1, battlefieldAnchorId: 'bear' });
  });

  it('rules-engine static evaluation lets the highest timestamp win over array order', () => {
    const permanent: any = {
      ...bear(),
      modifiers: [
        { type: 'setPowerToughness', setPower: 7, setToughness: 7, timestamp: 9 },
        { type: 'setPowerToughness', setPower: 1, setToughness: 1, timestamp: 3 },
      ],
    };
    const result: any = calculateEffectivePT(permanent, [permanent] as any, []);
    expect(result.power).toBe(7);
    expect(result.toughness).toBe(7);
  });
});