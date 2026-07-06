import { describe, expect, it } from 'vitest';

import { applyOracleIRStepsToGameState, buildOracleIRExecutionContext } from '../src/oracleIRExecutor';
import { parseOracleTextToIR } from '../src/oracleIRParser';

const DESCENT_RIDER =
  'For each creature destroyed this way, its controller creates a 4/4 red Dragon creature token with flying.';
const DESCENT_FULL =
  'Destroy any number of target creatures. For each creature destroyed this way, its controller creates a 4/4 red Dragon creature token with flying.';

function makeFourPlayerState() {
  return {
    players: [
      { id: 'p_caster', seat: 0 },
      { id: 'p_victim', seat: 1 },
      { id: 'p_other1', seat: 2 },
      { id: 'p_other2', seat: 3 },
    ],
    battlefield: [],
  } as any;
}

describe('for-each destroyed this way per-controller token rider', () => {
  it('parses its controller as controller_of_referenced_object with x amount', () => {
    const steps = parseOracleTextToIR(DESCENT_RIDER, 'Descent of the Dragons').abilities[0]?.steps ?? [];
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({
      kind: 'create_token',
      who: { kind: 'controller_of_referenced_object' },
      amount: { kind: 'x' },
      token: expect.stringContaining('4/4 red Dragon'),
    });
  });

  it('creates one Dragon per destroyed creature when targetPermanentId binds the first of many targets', () => {
    const steps = parseOracleTextToIR(DESCENT_RIDER, 'Descent of the Dragons').abilities[0]?.steps ?? [];
    const start = makeFourPlayerState();
    const ctx = buildOracleIRExecutionContext(
      {
        controllerId: 'p_caster',
        sourceName: 'Descent of the Dragons',
        targetPermanentId: 'c1',
        selectorContext: {
          chosenObjectIds: ['c1', 'c2', 'c3'],
          targetPermanentId: 'c1',
        },
        lastMovedCards: [
          { id: 'c1', controller: 'p_victim', owner: 'p_victim', card: { name: 'A', type_line: 'Creature' } },
          { id: 'c2', controller: 'p_other1', owner: 'p_other1', card: { name: 'B', type_line: 'Creature' } },
          { id: 'c3', controller: 'p_victim', owner: 'p_victim', card: { name: 'C', type_line: 'Creature' } },
        ],
      },
      {
        chosenObjectIds: ['c1', 'c2', 'c3'],
        targetPermanentId: 'c1',
      },
    );

    const result = applyOracleIRStepsToGameState(start, steps, ctx, { allowOptional: true });

    const dragons = (result.state.battlefield || []).filter((perm: any) =>
      String(perm.card?.name || '').includes('Dragon'),
    );
    expect(dragons).toHaveLength(3);
    expect(dragons.filter((perm: any) => perm.controller === 'p_victim')).toHaveLength(2);
    expect(dragons.filter((perm: any) => perm.controller === 'p_other1')).toHaveLength(1);
  });

  it('creates one Dragon per destroyed creature for each distinct controller in multiplayer', () => {
    const steps = parseOracleTextToIR(DESCENT_RIDER, 'Descent of the Dragons').abilities[0]?.steps ?? [];
    const start = makeFourPlayerState();
    const ctx = buildOracleIRExecutionContext(
      {
        controllerId: 'p_caster',
        sourceName: 'Descent of the Dragons',
        lastMovedCards: [
          { id: 'c1', controller: 'p_victim', owner: 'p_victim', card: { name: 'A', type_line: 'Creature' } },
          { id: 'c2', controller: 'p_other1', owner: 'p_other1', card: { name: 'B', type_line: 'Creature' } },
          { id: 'c3', controller: 'p_victim', owner: 'p_victim', card: { name: 'C', type_line: 'Creature' } },
        ],
      },
      {},
    );

    const result = applyOracleIRStepsToGameState(start, steps, ctx, { allowOptional: true });

    expect(result.appliedSteps.map((step) => step.kind)).toEqual(['create_token']);
    const dragons = (result.state.battlefield || []).filter((perm: any) =>
      String(perm.card?.name || '').includes('Dragon'),
    );
    expect(dragons).toHaveLength(3);
    expect(dragons.filter((perm: any) => perm.controller === 'p_victim')).toHaveLength(2);
    expect(dragons.filter((perm: any) => perm.controller === 'p_other1')).toHaveLength(1);
    expect(dragons.some((perm: any) => perm.controller === 'p_caster')).toBe(false);
  });

  it('runs destroy then per-controller Dragon tokens for the full Descent spell text', () => {
    const steps = parseOracleTextToIR(DESCENT_FULL, 'Descent of the Dragons').abilities[0]?.steps ?? [];
    expect(steps.map((step) => step.kind)).toEqual(['destroy', 'create_token']);
    expect(steps[1]).toMatchObject({
      who: { kind: 'controller_of_referenced_object' },
    });

    const start = makeFourPlayerState();
    start.battlefield = [
      { id: 'c1', controller: 'p_victim', owner: 'p_victim', card: { name: 'A', type_line: 'Creature' } },
      { id: 'c2', controller: 'p_other1', owner: 'p_other1', card: { name: 'B', type_line: 'Creature' } },
    ];

    const result = applyOracleIRStepsToGameState(
      start,
      steps,
      buildOracleIRExecutionContext(
        {
          controllerId: 'p_caster',
          sourceName: 'Descent of the Dragons',
          selectorContext: { chosenObjectIds: ['c1', 'c2'] },
        },
        { chosenObjectIds: ['c1', 'c2'] },
      ),
      { allowOptional: true },
    );

    const dragons = (result.state.battlefield || []).filter((perm: any) =>
      String(perm.card?.name || '').includes('Dragon'),
    );
    expect(dragons).toHaveLength(2);
    expect(dragons.filter((perm: any) => perm.controller === 'p_victim')).toHaveLength(1);
    expect(dragons.filter((perm: any) => perm.controller === 'p_other1')).toHaveLength(1);
  });
});
