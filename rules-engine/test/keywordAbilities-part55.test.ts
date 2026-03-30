import { describe, expect, it } from 'vitest';
import {
  createInfectSummary,
  infect,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 55 (remaining legacy summaries)', () => {
  describe('Infect (702.90)', () => {
    it('should summarize player poison and creature counter conversion from the same damage amount', () => {
      expect(createInfectSummary(infect('phyrexian-crusader'), 3)).toEqual({
        source: 'phyrexian-crusader',
        damage: 3,
        poisonCountersToPlayer: 3,
        minusOneMinusOneCountersToCreature: 3,
      });
    });
  });
});