import { describe, it, expect } from 'vitest';
import { getEffectiveColors } from '../src/state/modules/effectiveColors.js';
import { hasSelfAllColorsCDA } from '../src/state/modules/selfAllColorsCDA.js';

describe('Batch 14 - "~ is all colors"', () => {
  it('Sphinx of the Guildpact is all five colours', () => {
    const card = { name: 'Sphinx of the Guildpact', colors: [], oracle_text: 'Sphinx of the Guildpact is all colors.\nFlying\nHexproof from monocolored' };
    expect(hasSelfAllColorsCDA(card)).toBe(true);
    expect(getEffectiveColors({ card } as any).sort()).toEqual(['B', 'G', 'R', 'U', 'W']);
  });
  it('ignores tokens-that-are-all-colors text and face-down stubs', () => {
    expect(hasSelfAllColorsCDA({ name: 'X', oracle_text: "Create a 1/1 Human Wizard creature token that's all colors." })).toBe(false);
    expect(hasSelfAllColorsCDA({ name: '', isFaceDownStub: true, oracle_text: '' })).toBe(false);
  });
});