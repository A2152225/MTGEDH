import { describe, expect, it } from 'vitest';
import {
  counterAbility,
  createCounterSummary,
  createDiscardSummary,
  createVoteSummary,
  discardChosen,
  recordVote,
  startVote,
  tallyVotes,
} from '../src/keywordActions';

describe('Rule 701: Keyword Actions - Part 21 (remaining core summaries)', () => {
  describe('Rule 701.6: Counter', () => {
    it('should summarize the target and final destination of a countered ability', () => {
      expect(createCounterSummary(counterAbility('ability-1'))).toEqual({
        targetId: 'ability-1',
        targetType: 'ability',
        countered: true,
        costsRefunded: false,
        destination: 'ceases-to-exist',
      });
    });
  });

  describe('Rule 701.9: Discard', () => {
    it('should summarize discard destination visibility and whether the mode required a choice', () => {
      expect(createDiscardSummary(discardChosen('p1', 'p2', 'card-1'), 'hidden-zone', false)).toEqual({
        playerId: 'p1',
        mode: 'opponent-choice',
        cardId: 'card-1',
        discarded: true,
        destination: 'hidden-zone',
        revealed: false,
        characteristicsDefined: false,
        requiresChoice: true,
      });
    });
  });

  describe('Rule 701.38: Vote', () => {
    it('should summarize voter counts, total votes, and the winning choice', () => {
      const action = startVote(['p1', 'p2', 'p3'], ['grace', 'condemnation'], 'p2');
      const outcome = tallyVotes([
        recordVote('p2', 'grace', 2),
        recordVote('p3', 'condemnation', 1),
        recordVote('p1', 'grace', 1),
      ]);

      expect(createVoteSummary(action, outcome)).toEqual({
        startingVoter: 'p2',
        voterCount: 3,
        choiceCount: 2,
        totalVotes: 4,
        winner: 'grace',
        hasWinner: true,
      });
    });
  });
});