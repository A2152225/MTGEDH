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

describe('Oracle IR gap batch 40 support', () => {
  it('clears final legal trigger quantity and selector fragments', () => {
    const samples = [
      'sacrifice this token: draw a card.") {2}, Sacrifice another creature or a Blood token: Each opponent loses 2 life and you gain 2 life.',
      'draw a card. crew 3 you may cast this card from your graveyard as long as you control three or more tapped pirates and/or vehicles.',
      '5, or 6, create two 0/1 colorless eldrazi spawn creature tokens with "Sacrifice this token: Add {C}."',
    ];
    for (const text of samples) {
      expect(collectUnknowns(parseOracleTextToIR(text, 'Test')), text).toEqual([]);
    }
  });
});
