/**
 * Focused tests for utility and multiplayer-oriented keyword actions.
 */

import { describe, expect, it } from 'vitest';
import {
  CAN_CHOOSE_ILLEGAL_OPTION,
  chooseVillainousOption,
  clash,
  clashWithOpponent,
  completeVillainousChoice,
  createTimeTravelResult,
  faceMultipleTimes,
  faceVillainousChoice,
  getChosenVillainousOptionText,
  getHighestClashManaValue,
  getNetTimeTravelCounterChange,
  getTimeTravelCounterResult,
  getVotesForChoice,
  getVillainousOptions,
  getVotingOrder,
  hasUniqueClashWinner,
  hasVoteWinner,
  isValidTimeTravelSelection,
  isValidVillainousOption,
  isValidVoteChoice,
  processInAPNAPOrder,
  recordVote,
  resolveClashes,
  startVote,
  tallyVotes,
  timeTravel,
  canTimeTravel,
  VOTING_REQUIRES_VOTE_KEYWORD,
} from '../src/keywordActions';

describe('Rule 701: Utility Keyword Actions', () => {
  describe('Clash helpers', () => {
    it('should safely summarize empty clashes and distinguish ties from unique winners', () => {
      expect(getHighestClashManaValue([])).toBe(0);
      expect(hasUniqueClashWinner([])).toBe(false);
      expect(resolveClashes([])).toEqual([]);

      const tie = resolveClashes([
        { playerId: 'p1', revealedCard: 'c1', manaValue: 4, putOnBottom: false },
        { playerId: 'p2', revealedCard: 'c2', manaValue: 4, putOnBottom: true },
      ]);

      expect(tie.every((result) => result.wonClash === false)).toBe(true);

      const unique = resolveClashes([
        { playerId: 'p1', revealedCard: 'c1', manaValue: 5, putOnBottom: false },
        { playerId: 'p2', revealedCard: 'c2', manaValue: 3, putOnBottom: true },
      ]);

      expect(unique[0].wonClash).toBe(true);
      expect(unique[1].wonClash).toBe(false);
      expect(clash('p1').type).toBe('clash');
      expect(clashWithOpponent('p1', 'p2').opponentId).toBe('p2');
    });
  });

  describe('Vote helpers', () => {
    it('should derive voting order, validate choices, and expose winner helpers', () => {
      const action = startVote(['p1', 'p2', 'p3'], ['grace', 'condemnation'], 'p2');
      const order = getVotingOrder(action.voters, 'p2');
      const outcome = tallyVotes([
        recordVote('p2', 'grace', 1),
        recordVote('p3', 'grace', 1),
        recordVote('p1', 'condemnation', 1),
      ]);

      expect(order).toEqual(['p2', 'p3', 'p1']);
      expect(isValidVoteChoice('grace', action.choices)).toBe(true);
      expect(isValidVoteChoice('bribery', action.choices)).toBe(false);
      expect(getVotesForChoice(outcome, 'grace')).toBe(2);
      expect(hasVoteWinner(outcome)).toBe(true);
      expect(VOTING_REQUIRES_VOTE_KEYWORD).toBe(true);
    });
  });

  describe('Villainous Choice helpers', () => {
    it('should select and expose the chosen villainous branch and preserve APNAP order', () => {
      const action = faceVillainousChoice('p2', 'You draw a card.', 'That player loses 3 life.');
      const chosen = chooseVillainousOption(action, 'B');
      const completed = completeVillainousChoice('p2', 'You draw a card.', 'That player loses 3 life.', 'A');

      expect(isValidVillainousOption('A')).toBe(true);
      expect(isValidVillainousOption('C')).toBe(false);
      expect(getVillainousOptions(action)).toEqual(['You draw a card.', 'That player loses 3 life.']);
      expect(getChosenVillainousOptionText(chosen)).toBe('That player loses 3 life.');
      expect(getChosenVillainousOptionText(completed)).toBe('You draw a card.');
      expect(faceMultipleTimes(3)).toBe(3);
      expect(processInAPNAPOrder(['p3', 'pX', 'p1'], ['p1', 'p2', 'p3'])).toEqual(['p1', 'p3', 'pX']);
      expect(CAN_CHOOSE_ILLEGAL_OPTION).toBe(true);
    });
  });

  describe('Time Travel helpers', () => {
    it('should validate eligible objects and clamp counter removal at zero', () => {
      const action = timeTravel('p1', [
        { objectId: 'perm-1', addCounter: false },
        { objectId: 'suspend-1', addCounter: true },
      ]);

      expect(canTimeTravel({ isPermanent: true, isControlled: true, hasTimeCounters: true })).toBe(true);
      expect(canTimeTravel({ isSuspended: true, isOwned: true, hasTimeCounters: true })).toBe(true);
      expect(canTimeTravel({ isSuspended: true, isControlled: false, isOwned: false, hasTimeCounters: true })).toBe(false);
      expect(getTimeTravelCounterResult(0, false)).toBe(0);
      expect(getTimeTravelCounterResult(2, false)).toBe(1);
      expect(createTimeTravelResult('perm-1', 0, false).newCounters).toBe(0);
      expect(isValidTimeTravelSelection(action.chosenObjects, ['perm-1', 'suspend-1'])).toBe(true);
      expect(isValidTimeTravelSelection([{ objectId: 'perm-1', addCounter: true }, { objectId: 'perm-1', addCounter: false }], ['perm-1'])).toBe(false);
      expect(getNetTimeTravelCounterChange(action.chosenObjects)).toBe(0);
    });
  });
});