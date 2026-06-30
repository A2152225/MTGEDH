import { describe, expect, it } from 'vitest';
import { applyModifyGraveyardPermissionsStep, applyGrantGraveyardPermissionStep } from '../src/oracleIRExecutorPlayerStepHandlers.ts';
import { mergeGrantedGraveyardPermissionSourceText } from '../src/oracleIRExecutorPlayerStepHandlers.ts';
import { parseOracleTextToIR } from '../src/oracleIRParser.ts';

const BROODSHIP_EFFECT =
  'Once during each of your turns, you may cast a permanent spell from your graveyard by sacrificing a land in addition to paying its other costs.';

describe('oracle IR gap batch414 — graveyard permission sourceText dedupe', () => {
  it('does not duplicate land-sacrifice tails when merging modifier text', () => {
    const grantText =
      'Once during each of your turns, you may cast a permanent spell from your graveyard by sacrificing a land in addition to paying its other costs.';
    const merged = mergeGrantedGraveyardPermissionSourceText(grantText, 'sacrificing a land');
    expect(merged).toBe(grantText);
    expect(merged.toLowerCase()).not.toMatch(/sacrificing a land[\s\S]*sacrificing a land/);
  });

  it('keeps unrelated modifier tails that are not already present', () => {
    const grantText = 'Until end of turn, you may cast spells from your graveyard.';
    const modifierText =
      'You may cast them without paying their mana costs. If a spell cast this way would be put into your graveyard, exile it instead.';
    expect(mergeGrantedGraveyardPermissionSourceText(grantText, modifierText)).toBe(
      `${grantText} ${modifierText}`,
    );
  });

  it('records Broodship granted permissions without duplicated sacrifice text', () => {
    const ir = parseOracleTextToIR(BROODSHIP_EFFECT, 'Exploration Broodship');
    const conditional = ir.abilities[0]?.steps?.[0] as any;
    const grantStep = conditional?.steps?.[0];
    const modifyStep = conditional?.steps?.[1];
    expect(grantStep?.kind).toBe('grant_graveyard_permission');
    expect(modifyStep?.kind).toBe('modify_graveyard_permissions');

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
    expect(String(permission?.sourceText || '')).toMatch(/sacrificing a land in addition to paying its other costs/i);
    expect(String(permission?.sourceText || '').toLowerCase()).not.toMatch(/sacrificing a land[\s\S]*sacrificing a land/);
  });
});
