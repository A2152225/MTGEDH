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

describe('Oracle IR gap batch 35 support', () => {
  it('parses nested power reference quantities', () => {
    const samples = [
      "each opponent loses x life, where x is this creature's power",
      'put a +1/+1 counter on this creature for each +1/+1 counter on target creature with power less than this permanent\'s power',
    ];
    for (const text of samples) {
      expect(collectUnknowns(parseOracleTextToIR(text, 'Test')), text).toEqual([]);
    }
  });

  it('lowers batch-35 residual trigger riders', () => {
    const samples = [
      'x life and you gain x',
      'until end of turn, that player can\'t cast spells, you may look at the top card of their library any time, you may play the top card of their library, and you may spend mana as though it were mana of any color to cast spells this way',
      'storied matriarch, return up to one target goblin card from your graveyard to your hand',
      'return up to one target vampire card from your graveyard to your hand',
      'bert, and william die, if they were a creature, return them to the battlefield',
      'vehicles you control have crew 1',
      'you may move all counters from this permanent onto target creature',
      'you may draw x cards, where x is the number of shrines you control',
      'this creature isn\'t a creature until end of turn',
      'you may have that opponent gain control of this permanent until end of combat',
      'then conjure two cards named mishra\'s foundry onto the battlefield tapped',
      'you may copy it, except the copy is a 1/1 spirit in addition to its other types',
      'you may reveal a permanent card from among them and put it into your hand. put the rest on the bottom of your library in any order',
      'they\'re an artifact',
      'the next time you would set a scheme in motion, set three schemes in motion instead',
      'you may copy this permanent and may choose a new target for the copy',
    ];
    for (const text of samples) {
      expect(collectUnknowns(parseOracleTextToIR(text, 'Test')), text).toEqual([]);
    }
  });
});
