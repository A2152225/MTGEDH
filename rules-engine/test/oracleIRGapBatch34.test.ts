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

describe('Oracle IR gap batch 34 support', () => {
  it('parses nested life and damage reference amounts', () => {
    const pest = parseOracleTextToIR(
      'if you would gain life, you gain that much life plus 1 instead',
      'Pest Rescuer'
    );
    const goblin = parseOracleTextToIR(
      'if a source you control would deal damage to an opponent this turn, it deals double that damage to that player instead',
      'Goblin Goliath'
    );
    const shadow = parseOracleTextToIR(
      'each opponent loses life equal to the mana value of the sacrificed permanent',
      'Shadow, Mysterious Assassin'
    );

    expect(collectUnknowns(pest)).toEqual([]);
    expect(collectUnknowns(goblin)).toEqual([]);
    expect(collectUnknowns(shadow)).toEqual([]);
  });

  it('lowers spellbook, transform, and observer-style residual riders', () => {
    const samples = [
      "draft a card from this artifact's spellbook",
      'transform this equipment',
      "the exiled card's owner seeks a nonland card with lesser mana value than the exiled card",
      'you choose one of those cards and exile it',
      "until end of turn, that creature's controller may play that card and they may spend mana as though it were mana of any color to cast that spell",
    ];
    for (const text of samples) {
      expect(collectUnknowns(parseOracleTextToIR(text, 'Test')), text).toEqual([]);
    }
  });
});
