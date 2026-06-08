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

describe('Oracle IR gap batch 31 support', () => {
  it('parses unless-discard and double-that reference amounts', () => {
    const scholar = parseOracleTextToIR(
      'discard two cards unless you discard an instant or sorcery card or a creature card with flying',
      'Steamcore Scholar'
    );
    const doubleThat = parseOracleTextToIR(
      'damage to an opponent this turn, it deals double that damage to you',
      'Test'
    );

    expect(collectUnknowns(scholar)).toEqual([]);
    expect(collectUnknowns(doubleThat)).toEqual([]);
    expect(scholar.abilities[0]?.steps[0]).toMatchObject({
      kind: 'discard',
      amount: {
        kind: 'reference_amount',
        raw: 'two cards unless you discard an instant or sorcery card or a creature card with flying',
      },
    });
    expect(doubleThat.abilities[0]?.steps[0]).toMatchObject({
      kind: 'deal_damage',
      amount: { kind: 'reference_amount', raw: 'double that' },
    });
  });

  it('parses lesson, equipment-mv, and exiled-owner references', () => {
    const samples = [
      'a card unless there are three or more lesson cards in your graveyard',
      'the greatest mana value among equipment attached to it',
      "the exiled card's owner may cast it",
    ];
    for (const text of samples) {
      expect(collectUnknowns(parseOracleTextToIR(text, 'Test')), text).toEqual([]);
    }
  });

  it('lowers werewolf, marina, and gitrog residual riders', () => {
    const samples = [
      "until end of turn, this creature has base power and toughness 5/3, gains trample, and isn't a human",
      "you have no maximum hand size and don't lose the game for having 0 or less life",
      'horror of zhava is untapped, any opponent may sacrifice a nontoken creature',
      'you may choose a creature card from among them',
      'it perpetually gains double team',
    ];
    for (const text of samples) {
      expect(collectUnknowns(parseOracleTextToIR(text, 'Test')), text).toEqual([]);
    }
  });
});
