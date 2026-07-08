import { describe, expect, it } from 'vitest';
import { lookupLocalCardByNameSync } from '../../server/src/services/localCardLookup.js';
import {
  parseActivatedAbilityCostReducerSpecsFromOracleText,
} from '../src/activatedAbilityCostReductionOracle';
import { parseOracleTextToIR } from '../src/oracleIRParser';

function collectStaticActivationReductionGrants(oracleText: string, cardName: string) {
  const ir = parseOracleTextToIR(oracleText, cardName);
  return (ir.abilities || []).flatMap((ability) => [...(ability.steps || [])])
    .filter((step) => step.kind === 'grant_static_ability')
    .flatMap((step) => Array.isArray((step as { effectText?: readonly string[] }).effectText)
      ? ((step as { effectText?: readonly string[] }).effectText || [])
      : [])
    .filter((line) => /less to activate/i.test(String(line || '')));
}

describe('activated ability cost reduction oracle parsing', () => {
  it('parses known reducers from local oracle text', () => {
    const cases = [
      {
        name: 'Training Grounds',
        expectReduction: 2,
        expectCreature: true,
        expectMinimum: 1,
      },
      {
        name: 'Heartstone',
        expectReduction: 1,
        expectCreature: true,
        expectAnyController: true,
      },
      {
        name: 'Zirda, the Dawnwaker',
        expectReduction: 2,
        expectExcludesMana: true,
        expectMinimum: 1,
      },
      {
        name: 'Convergence of Dominion',
        expectReduction: 2,
        expectGraveyard: true,
        expectCommander: true,
        expectMinimum: 1,
      },
      {
        name: 'Blossoming Tortoise',
        expectReduction: 1,
        expectLand: true,
      },
      {
        name: 'Mutagen Man, Living Ooze',
        expectReduction: 1,
        expectArtifactToken: true,
      },
    ] as const;

    for (const testCase of cases) {
      const card = lookupLocalCardByNameSync(testCase.name);
      expect(card?.oracle_text, testCase.name).toBeTruthy();
      const specs = parseActivatedAbilityCostReducerSpecsFromOracleText(
        String(card?.oracle_text || ''),
        testCase.name,
      );
      expect(specs.length, testCase.name).toBeGreaterThan(0);
      const spec = specs[0];
      expect(spec.genericReduction, testCase.name).toBe(testCase.expectReduction);
      if ('expectCreature' in testCase && testCase.expectCreature) {
        expect(spec.sourceTypes).toContain('creature');
      }
      if ('expectLand' in testCase && testCase.expectLand) {
        expect(spec.sourceTypes).toContain('land');
      }
      if ('expectArtifactToken' in testCase && testCase.expectArtifactToken) {
        expect(spec.sourceTypes).toContain('artifact');
        expect(spec.sourceMustBeToken).toBe(true);
      }
      if ('expectGraveyard' in testCase && testCase.expectGraveyard) {
        expect(spec.sourceZone).toBe('graveyard');
      }
      if ('expectCommander' in testCase && testCase.expectCommander) {
        expect(spec.requiresCommander).toBe(true);
      }
      if ('expectExcludesMana' in testCase && testCase.expectExcludesMana) {
        expect(spec.excludesManaAbilities).toBe(true);
      }
      if ('expectAnyController' in testCase && testCase.expectAnyController) {
        expect(spec.reducerControllerScope).toBe('any');
      }
      if ('expectMinimum' in testCase && testCase.expectMinimum !== undefined) {
        expect(spec.minimumTotalMana).toBe(testCase.expectMinimum);
      }
    }
  });

  it('parses activation cost reduction grant_static_ability IR for gap cards', () => {
    const cases = [
      'Zirda, the Dawnwaker',
      'Blossoming Tortoise',
      'Mutagen Man, Living Ooze',
    ] as const;

    for (const name of cases) {
      const card = lookupLocalCardByNameSync(name);
      const oracleText = String(card?.oracle_text || '');
      const grants = collectStaticActivationReductionGrants(oracleText, name);
      expect(grants.length, name).toBeGreaterThan(0);
    }
  });
});
