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

describe('Oracle IR gap batch 38 support (legal cards)', () => {
  it('parses level, speed, and aftermath-style riders', () => {
    const samples = [
      'increase your speed by 1',
      'level 2 equip abilities you activate cost {2} less to activate',
      'level 3 you may look at the top card of your library any time',
      'aftermath create a treasure token for each creature you controlled that dealt combat damage to a player this turn',
      'the monarch controls enchanted creature',
      'that spell gains rebound',
    ];
    for (const text of samples) {
      expect(collectUnknowns(parseOracleTextToIR(text, 'Test')), text).toEqual([]);
    }
  });

  it('parses nested quantity and copy-target fragments', () => {
    const samples = [
      "that creature's mana value",
      'the greatest power among creatures you control',
      'that many cards minus one',
      'for each other creature you control that the spell could target',
      'the copy targets the chosen creature',
      'a third of their life, rounded up',
    ];
    for (const text of samples) {
      expect(collectUnknowns(parseOracleTextToIR(text, 'Test')), text).toEqual([]);
    }
  });
});
