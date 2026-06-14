import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';

function collectUnknowns(value: unknown): unknown[] {
  const unknowns: unknown[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if ((node as any).kind === 'unknown') unknowns.push((node as any).raw ?? node);
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const child of Object.values(node)) walk(child);
  };
  walk(value);
  return unknowns;
}

describe('Oracle IR gap batch 224 support', () => {
  it('preserves enters-tapped replacement abilities without executable steps', () => {
    const moss = parseOracleTextToIR('This artifact enters tapped.', 'Moss Diamond');
    expect(moss.abilities[0]).toMatchObject({
      type: 'replacement',
      effectText: 'tapped',
      steps: [],
    });

    const fastland = parseOracleTextToIR(
      'This land enters tapped unless you control two or fewer other lands.',
      'Concealed Courtyard'
    );
    expect(fastland.abilities[0]).toMatchObject({
      type: 'replacement',
      effectText: 'tapped unless you control two or fewer other lands',
      steps: [],
    });

    const slowland = parseOracleTextToIR(
      'This land enters the battlefield tapped unless you control two or more other lands.',
      'Furycalm Snarl'
    );
    expect(slowland.abilities[0]).toMatchObject({
      type: 'replacement',
      effectText: 'tapped unless you control two or more other lands',
      steps: [],
    });
  });

  it('prunes standalone that much trigger tail fragments', () => {
    const ir = parseOracleTextToIR('that much', 'Gap Probe');
    expect(collectUnknowns(ir)).toEqual([]);
    expect(ir.abilities).toEqual([]);
  });

  it('parses bare Devoid as a structured keyword grant', () => {
    const ir = parseOracleTextToIR('Devoid', 'Void Grafter');
    expect(collectUnknowns(ir)).toEqual([]);
    expect(ir.abilities[0]?.steps[0]).toMatchObject({
      kind: 'grant_static_ability',
      abilities: ['devoid'],
    });
  });
});
