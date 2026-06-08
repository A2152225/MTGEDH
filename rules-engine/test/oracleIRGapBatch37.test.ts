import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';

function collectUnknowns(value: unknown): string[] {
  const unknowns: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if ((node as { kind?: string }).kind === 'unknown') {
      unknowns.push(String((node as { raw?: string }).raw ?? ''));
      return;
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

describe('Oracle IR gap batch 37 support (legal cards)', () => {
  it('parses energy, endure, and unless-discard riders', () => {
    const samples = [
      'you get six {e}',
      'you get an amount of {e} equal to the amount of mana spent to cast that spell',
      'this permanent endures 2',
      'two cards unless you discard an artifact card',
      'two cards unless you discard a pirate card',
      'a card or pay {2}',
    ];
    for (const text of samples) {
      expect(collectUnknowns(parseOracleTextToIR(text, 'Test')), text).toEqual([]);
    }
  });

  it('parses legal-card trigger fragments from batch 37 probes', () => {
    const samples = [
      'you gain 2 life for each gate you control',
      'you gain 2 life for each creature you control with flying',
      'target opponent discards a card for each zubera that died this turn',
      'transform up to one target incubator token you control',
      'draw x cards, where x is the number of page counters on this artifact',
      'bushido 2',
      'crew 3 you',
    ];
    for (const text of samples) {
      expect(collectUnknowns(parseOracleTextToIR(text, 'Test')), text).toEqual([]);
    }
  });
});
