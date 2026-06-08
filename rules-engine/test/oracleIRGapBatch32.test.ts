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

describe('Oracle IR gap batch 32 support', () => {
  it('prunes parenthetical reminder fragments', () => {
    const samples = [
      "(it has menace and can't block.)",
      '(to forage, exile three cards from your graveyard or sacrifice a food.)',
      '(put a +1/+1 counter on it or create a 1/1 white spirit creature token.)',
    ];
    for (const text of samples) {
      expect(collectUnknowns(parseOracleTextToIR(text, 'Test')), text).toEqual([]);
    }
  });

  it('parses bounty rewards and planeswalk phenomenon tails', () => {
    expect(collectUnknowns(parseOracleTextToIR('rewards', 'Bounty'))).toEqual([]);
    expect(collectUnknowns(parseOracleTextToIR('then planeswalk away from this phenomenon.)', 'Test'))).toEqual([]);
  });

  it('parses eluge cost reduction and sunbird reveal-cast compound', () => {
    const eluge = parseOracleTextToIR(
      'the first instant or sorcery spell you cast each turn costs {u} (or {1}) less to cast for each land you control',
      'Eluge, the Shoreless Sea'
    );
    const sunbird = parseOracleTextToIR(
      'you may cast a spell with mana value x or less from among cards revealed this way without paying its mana cost. put the rest on the bottom of your library in a random order',
      "Sunbird's Invocation"
    );

    expect(collectUnknowns(eluge)).toEqual([]);
    expect(collectUnknowns(sunbird)).toEqual([]);
    expect(sunbird.abilities[0]?.steps.length).toBeGreaterThanOrEqual(1);
  });
});
