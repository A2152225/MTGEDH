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

describe('Oracle IR gap batch 42 residual clusters', () => {
  it('clears gift, draw/lose, discard-quote, visit, teamwork, and quoted static grants', () => {
    const samples = [
      'Gift a card (You may promise an opponent a gift as you cast this spell. If you do, they draw a card before its other effects.)\nWildfire Howl deals 3 damage to any target.',
      'Target player discards two cards. You draw two cards, lose 2 life.',
      'Other blue creatures you control have "Whenever this creature becomes tapped, draw a card, then discard a card."',
      "Visit — Choose one.\n• Create a 1/1 red Balloon creature token with flying.\n• Sacrifice a Balloon. If you do, target creature gains flying until end of turn.",
      'Teamwork 4 (As an additional cost to cast this spell, you may tap any number of creatures you control with total power 4 or more.)\nDraw three cards.',
      'Target player discards X cards at random.',
    ];

    for (const text of samples) {
      expect(collectUnknowns(parseOracleTextToIR(text, 'Test')), text).toEqual([]);
    }
  });
});
