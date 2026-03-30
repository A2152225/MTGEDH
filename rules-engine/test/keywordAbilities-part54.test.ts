import { describe, expect, it } from 'vitest';
import {
  createProvokeSummary,
  provoke,
  triggerProvoke,
} from '../src/keywordAbilities';

describe('Keyword Abilities - Part 54 (Part 22 summaries)', () => {
  describe('Provoke (702.39)', () => {
    it('should summarize the combat requirement created by a triggered provoke ability', () => {
      expect(createProvokeSummary(triggerProvoke(provoke('attacker-1'), 'blocker-1'))).toEqual({
        source: 'attacker-1',
        targetCreature: 'blocker-1',
        wasTriggered: true,
        mustBlock: true,
        untapTarget: true,
      });
    });

    it('should remain inert before provoke has triggered', () => {
      expect(createProvokeSummary(provoke('attacker-1'))).toEqual({
        source: 'attacker-1',
        targetCreature: undefined,
        wasTriggered: false,
        mustBlock: false,
        untapTarget: false,
      });
    });
  });
});