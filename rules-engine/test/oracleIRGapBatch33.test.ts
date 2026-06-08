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

describe('Oracle IR gap batch 33 support', () => {
  it('lowers cast-later-from-exile and energy-counter reminder riders', () => {
    const samples = [
      'you may cast the artifact later from exile.)',
      'you may cast the enchantment later from exile.)',
      'you get {e} (an energy counter) for each creature you control',
    ];
    for (const text of samples) {
      expect(collectUnknowns(parseOracleTextToIR(text, 'Test')), text).toEqual([]);
    }
  });

  it('lowers life-replacement and offering follow-up riders', () => {
    const samples = [
      'that much life plus 1 instead',
      'then the owner of each permanent chosen this way shuffles',
      'that player puts the rest on the bottom of their library in a random order',
      'when the last is removed, you may cast it without paying its mana cost',
      'unicorn, or horse creature spell, copy it',
    ];
    for (const text of samples) {
      expect(collectUnknowns(parseOracleTextToIR(text, 'Test')), text).toEqual([]);
    }
  });
});
