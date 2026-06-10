import { describe, expect, it } from 'vitest';
import { parseOracleTextToIR } from '../src/oracleIRParser';

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

describe('Oracle IR gap batch 48 compound draw clauses', () => {
  it('clears draw-then-discard grants, draw-untap-discard, draw-instead-if, draw+buff, and additional-for-each draw', () => {
    const samples = [
      'Other blue creatures you control have "Whenever this creature becomes tapped, draw a card, then discard a card."',
      'Draw three cards, untap up to two lands, then discard a card.',
      'If an opponent has more cards in hand than you, draw two cards. Draw three cards instead if that opponent has at least four more cards in hand than you.',
      'Choose exactly two creatures you control. You draw X cards and the chosen creatures get +X/+X until end of turn, where X is the number of creatures you control.',
      "Draw a card and an additional card for each of Contortionist's folds",
    ];

    for (const text of samples) {
      expect(collectUnknowns(parseOracleTextToIR(text, 'Test')), text).toEqual([]);
    }
  });
});
