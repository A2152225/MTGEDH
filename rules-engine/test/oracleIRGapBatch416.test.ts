import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.ts';

function findNestedModifyStep(steps: readonly any[]): any | undefined {
  for (const step of steps) {
    if (step?.kind === 'modify_graveyard_permissions') return step;
    if (step?.kind === 'conditional') {
      const nested = findNestedModifyStep(step.steps || []);
      if (nested) return nested;
    }
  }
  return undefined;
}

function findNestedGrantStep(steps: readonly any[]): any | undefined {
  for (const step of steps) {
    if (step?.kind === 'grant_graveyard_permission') return step;
    if (step?.kind === 'conditional') {
      const nested = findNestedGrantStep(step.steps || []);
      if (nested) return nested;
    }
  }
  return undefined;
}

describe('oracle IR gap batch416 — redundant graveyard modifier raw dedupe', () => {
  it('clears redundant modify raw when Broodship grant already embeds land sacrifice', () => {
    const ir = parseOracleTextToIR(
      'Once during each of your turns, you may cast a permanent spell from your graveyard by sacrificing a land in addition to paying its other costs.',
      'Exploration Broodship',
    );
    const modify = findNestedModifyStep(ir.abilities[0]?.steps || []);
    expect(modify?.additionalCost).toMatchObject({
      kind: 'sacrifice',
      count: 1,
      filterText: 'land',
    });
    expect(String(modify?.raw || '')).toBe('');
    expect(String(modify?.additionalCost?.raw || '')).toMatch(/sacrificing a land/i);
  });

  it('clears redundant modify raw when self-cast grant already embeds counter removal', () => {
    const ir = parseOracleTextToIR(
      'You may cast this card from your graveyard by removing six counters from among creatures you control in addition to paying its other costs.',
      'Quilled Greatwurm',
    );
    const modify = findNestedModifyStep(ir.abilities[0]?.steps || []);
    expect(modify?.additionalCost).toMatchObject({
      kind: 'remove_counter',
      count: 6,
      filterText: 'creatures you control',
    });
    expect(String(modify?.raw || '')).toBe('');
  });

  it('keeps modify raw when retrace reminder cost is not embedded in the grant line', () => {
    const ir = parseOracleTextToIR(
      'During your turn, nonland permanent cards in your graveyard have retrace. (You may cast permanent cards from your graveyard by discarding a land card in addition to paying their other costs.)',
      'Six',
    );
    const grant = findNestedGrantStep(ir.abilities[0]?.steps || []);
    const modify = findNestedModifyStep(ir.abilities[0]?.steps || []);
    expect(String(grant?.raw || '')).not.toMatch(/discarding a land/i);
    expect(String(modify?.raw || '')).toMatch(/discarding a land/i);
    expect(modify?.additionalCost).toMatchObject({
      kind: 'discard',
      count: 1,
      filterText: 'land',
    });
  });
});
