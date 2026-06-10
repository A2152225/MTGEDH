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

describe('Oracle IR gap batch 53 compound discard and for-each effects', () => {
  it('clears discard/mill/life chains, for-each discards, and conditional pt tails', () => {
    const cards = [
      'Mind Drain',
      "Demogorgon's Clutches",
      'Stone Drake',
      'Mind Sludge',
      'Mind Burst',
      'Congregate',
      'Faerie Fencing',
      "Just a Li'l Guy",
      'Brutal Command',
    ];

    for (const name of cards) {
      const card = lookupLocalCardByNameSync(name);
      expect(card?.oracle_text, name).toBeTruthy();
      expect(collectUnknowns(parseOracleTextToIR(String(card!.oracle_text), name)), name).toEqual([]);
    }
  });
});
