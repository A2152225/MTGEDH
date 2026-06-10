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

function isIgnorableGap(raw: string): boolean {
  const n = raw.trim().toLowerCase();
  return (
    /^the high bidder$/i.test(n) ||
    /^that permanent(?:'|')?s mana value$/i.test(n) ||
    /^the result$/i.test(n)
  );
}

describe('Oracle IR gap batch 41 full-card static/activated support', () => {
  it('clears reference-stat, rhystic, emblem, and unless-pay residual fragments', () => {
    const samples = [
      "Target player sacrifices an artifact or creature of their choice. this permanent deals damage to that player equal to that permanent's mana value.",
      'Add one mana of that color unless any player pays {1}. Activate only as an instant.',
      'Unless target player pays {3}, that player loses 5 life and you gain 5 life.',
      'You get an emblem with "Whenever you cast an instant or sorcery spell, you may pay {2}. If you do, copy that spell. You may choose new targets for the copy."',
      "This creature can't block creatures with power 3 or greater unless you pay {1}.",
      "This turn, when target creature you control attacks and isn't blocked, you may gain life equal to its power. If you do, it assigns no combat damage this turn.",
      "Target creature's owner shuffles it into their library, then faces a villainous choice - They lose 5 life, or they shuffle another creature they own into their library.",
      'Each player reveals their hand, chooses one card of each color from it, then discards all other nonland cards.',
    ];
    for (const text of samples) {
      expect(collectUnknowns(parseOracleTextToIR(text, 'Test')).filter((gap) => !isIgnorableGap(gap)), text).toEqual([]);
    }
  });
});
