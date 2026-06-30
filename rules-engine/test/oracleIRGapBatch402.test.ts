import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser.ts';

function collectSteps(value: unknown): any[] {
  const steps: any[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (typeof (node as any).kind === 'string') steps.push(node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const child of Object.values(node)) walk(child);
  };
  walk(value);
  return steps;
}

describe('oracle IR gap batch402 — Squad token metadata with Flash', () => {
  it('surfaces squad copy token on ETB trigger when Flash precedes Squad', () => {
    const oracle =
      'Flash\nSquad {2} (As an additional cost to cast this spell, you may pay {2} any number of times. When this creature enters, create that many tokens that are copies of it.)\nBenediction of the Omnissiah - When this creature enters, draw a card.';

    const ir = parseOracleTextToIR(oracle, 'Sicarian Infiltrator');
    const steps = collectSteps(ir.abilities);

    expect(steps.some((step) => step.kind === 'create_token')).toBe(true);
    expect(steps).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'create_token', token: 'copy of it' })])
    );

    const drawAbility = ir.abilities.find((ability) => /Benediction of the Omnissiah/i.test(ability.text || ''));
    expect(drawAbility?.steps.some((step) => step.kind === 'draw')).toBe(true);
    expect(collectSteps(drawAbility?.steps).some((step) => step.kind === 'create_token')).toBe(true);
  });
});
