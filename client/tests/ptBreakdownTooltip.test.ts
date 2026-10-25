import { describe, expect, it } from 'vitest';
import { conditionalPtBonusLines, variablePtLines } from '../src/components/PermanentRulesStatusBadges';
import { buildPTTooltip } from '../src/components/FreeField-handlers/freeFieldDisplayUtils';

describe('P/T tooltip provenance', () => {
  it('splits Variable lines from Conditional ones and dedupes counter sources', () => {
    const perm = { rulesStatus: { ptBreakdown: [{ kind: 'devotion', text: 'Power = devotion to green (3)' }, { kind: 'counters', sourceName: 'Sigil', text: 'Sigil: +1/+0 \u00d7 3 charge counters on Sigil = +3/+0' }] } };
    expect(variablePtLines(perm)).toEqual(['Power = devotion to green (3)']);
    expect(conditionalPtBonusLines(perm)).toEqual(['Sigil: +1/+0 \u00d7 3 charge counters on Sigil = +3/+0']);
    const tip = buildPTTooltip({ baseP: 3, baseT: 4, plusCounters: 0, minusCounters: 0, ptSources: [{ name: 'Sigil', power: 3, toughness: 0 }] as any,
      conditionalLines: conditionalPtBonusLines(perm), variableLines: variablePtLines(perm) })!;
    expect(tip).toMatch(/Variable:\n  Power = devotion to green \(3\)/);
    expect(tip.split('Sigil').length - 1).toBe(2); // only the counter line (names Sigil twice), no per-source duplicate
  });
});
