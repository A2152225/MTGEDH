import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';
import { lookupLocalCardByNameSync } from '../../server/src/services/localCardLookup.ts';

function collectUnknowns(value: unknown): string[] {
  const unknowns: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if ((node as { kind?: string }).kind === 'unknown') {
      unknowns.push(String((node as { raw?: string }).raw ?? ''));
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'raw' || key === 'text' || key === 'effectText') continue;
      walk(child);
    }
  };
  walk(value);
  return unknowns.filter(Boolean);
}

describe('Oracle IR gap batch 49 comma-chained draw effects', () => {
  it('clears draw-comma-lose, villainous choice draw, and compound cant-branch chains', () => {
    const robot = lookupLocalCardByNameSync('Robot Domination');
    const davros = lookupLocalCardByNameSync('Davros, Dalek Creator');
    const doom = lookupLocalCardByNameSync('Doom Foretold');

    for (const [name, text] of [
      ['Robot Domination', robot?.oracle_text],
      ['Davros, Dalek Creator', davros?.oracle_text],
      ['Doom Foretold', doom?.oracle_text],
    ] as const) {
      expect(text, name).toBeTruthy();
      expect(collectUnknowns(parseOracleTextToIR(String(text), name)), name).toEqual([]);
    }
  });
});
