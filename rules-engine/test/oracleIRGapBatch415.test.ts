import { describe, expect, it } from 'vitest';
import { applyModifyGraveyardPermissionsStep, applyGrantGraveyardPermissionStep } from '../src/oracleIRExecutorPlayerStepHandlers.ts';
import { oracleGraveyardAdditionalCostToSerializable } from '../src/graveyardPermissionAdditionalCost.ts';
import { parseOracleTextToIR } from '../src/oracleIRParser.ts';

const BROODSHIP_EFFECT =
  'Once during each of your turns, you may cast a permanent spell from your graveyard by sacrificing a land in addition to paying its other costs.';

describe('oracle IR gap batch415 — structured graveyard permission additionalCost', () => {
  it('serializes sacrifice additional costs for first-class permissions', () => {
    expect(
      oracleGraveyardAdditionalCostToSerializable({
        kind: 'sacrifice',
        count: 1,
        filterText: 'land',
        raw: 'sacrificing a land',
      }),
    ).toEqual({
      type: 'sacrifice',
      amount: 1,
      filter: 'land',
    });
  });

  it('persists structured additionalCost on Broodship granted permissions', () => {
    const ir = parseOracleTextToIR(BROODSHIP_EFFECT, 'Exploration Broodship');
    const conditional = ir.abilities[0]?.steps?.[0] as any;
    const grantStep = conditional?.steps?.[0];
    const modifyStep = conditional?.steps?.[1];
    expect(modifyStep?.additionalCost).toMatchObject({
      kind: 'sacrifice',
      count: 1,
      filterText: 'land',
    });

    const baseState = {
      turnNumber: 1,
      players: [
        {
          id: 'p1',
          name: 'P1',
          seat: 0,
          life: 40,
          library: [],
          hand: [],
          graveyard: [{ id: 'mind_stone_1', name: 'Mind Stone', type_line: 'Artifact', mana_cost: '{2}' }],
          exile: [],
        } as any,
      ],
    } as any;

    const grantResult = applyGrantGraveyardPermissionStep(baseState, grantStep, {
      controllerId: 'p1',
      sourceId: 'broodship_1',
      sourceName: 'Exploration Broodship',
    } as any);
    expect(grantResult.applied).toBe(true);

    const modifyResult = applyModifyGraveyardPermissionsStep(
      grantResult.state as any,
      modifyStep,
      {
        lastGrantedGraveyardCards: [{ id: 'mind_stone_1', name: 'Mind Stone', type_line: 'Artifact', mana_cost: '{2}' }],
        lastGrantedGraveyardPermissionIds: grantResult.lastGrantedGraveyardPermissionIds,
      },
    );
    expect(modifyResult.applied).toBe(true);

    const permission = ((modifyResult.state as any).graveyardCastingPermissions || [])[0] as any;
    expect(permission?.additionalCost).toEqual({
      type: 'sacrifice',
      amount: 1,
      filter: 'land',
    });
  });
});
