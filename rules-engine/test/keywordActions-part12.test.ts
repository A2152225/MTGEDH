import { describe, expect, it } from 'vitest';
import {
  bolster,
  canPopulate,
  completeBolster,
  completeMeld,
  completePopulate,
  createBolsterSummary,
  createDetainResult,
  createDetainedState,
  createManifestResult,
  createManifestedPermanent,
  createMeldResult,
  createMonstrosityResult,
  createPopulateResult,
  createSupportResult,
  createVoteWithMultipleVotes,
  detainPermanent,
  executePopulate,
  getVotesForChoice,
  hasVoteWinner,
  handleInvalidMeld,
  hasDetainRestrictions,
  isMeldedPermanent,
  manifest,
  MANIFEST_ONE_AT_A_TIME,
  meld,
  monstrosity,
  populate,
  recordVote,
  startVote,
  supportFromPermanent,
  supportFromSpell,
  tallyVotes,
  VOTING_REQUIRES_VOTE_KEYWORD,
} from '../src/keywordActions';

describe('Rule 701: Keyword Actions - Part 12 (part-5 focused action summaries)', () => {
  describe('Rule 701.35: Detain', () => {
    it('should apply detain restrictions until the detainer next gets a turn', () => {
      const state = createDetainedState('perm-1', 'p1', 'p2');

      expect(hasDetainRestrictions(state, 'p2')).toBe(true);
      expect(hasDetainRestrictions(state, 'p1')).toBe(false);
    });

    it('should summarize attack, block, and activation restrictions for a detained permanent', () => {
      const action = detainPermanent('perm-1', 'p1');
      const state = createDetainedState('perm-1', 'p1', 'p2');

      expect(createDetainResult(action, state, 'p2')).toEqual({
        permanentId: 'perm-1',
        detainerId: 'p1',
        detained: true,
        canAttack: false,
        canBlock: false,
        canActivateAbilities: false,
        expiresOnTurnOf: 'p1',
      });
    });
  });

  describe('Rule 701.36: Populate', () => {
    it('should summarize successful token copying and reject empty populate boards', () => {
      expect(canPopulate([])).toBe(false);
      expect(completePopulate('p1', 'token-1').chosenTokenId).toBe('token-1');
      expect(createPopulateResult('token-1', 'token-2')).toEqual({
        populated: true,
        originalTokenId: 'token-1',
        newTokenId: 'token-2',
        newToken: undefined,
      });
    });

    it('should create a copied creature token with the original battlefield stats', () => {
      const result = executePopulate([
        {
          id: 'token-1',
          controller: 'p1',
          owner: 'p1',
          tapped: false,
          summoningSickness: false,
          counters: {},
          attachments: [],
          modifiers: [],
          card: { id: 'token-1', name: 'Centaur', type_line: 'Token Creature - Centaur', colors: ['G'] },
          basePower: 3,
          baseToughness: 3,
          isToken: true,
        } as any,
      ], 'p1', 'token-1');

      expect(result.populated).toBe(true);
      expect(result.newToken?.basePower).toBe(3);
      expect(result.newToken?.isToken).toBe(true);
    });
  });

  describe('Rule 701.37: Monstrosity', () => {
    it('should summarize when monstrosity adds counters and when it is already spent', () => {
      expect(createMonstrosityResult(monstrosity('perm-1', 3), {
        permanentId: 'perm-1',
        isMonstrous: false,
        monstrosityX: 0,
      })).toEqual({
        permanentId: 'perm-1',
        becameMonstrous: true,
        alreadyMonstrous: false,
        countersAdded: 3,
        monstrosityX: 3,
      });

      expect(createMonstrosityResult(monstrosity('perm-1', 3), {
        permanentId: 'perm-1',
        isMonstrous: true,
        monstrosityX: 5,
      }).countersAdded).toBe(0);
    });
  });

  describe('Rule 701.38: Vote', () => {
    it('should summarize a vote winner and preserve multiple-vote totals', () => {
      const action = startVote(['p1', 'p2', 'p3'], ['grace', 'condemnation'], 'p2');
      const outcome = tallyVotes([
        createVoteWithMultipleVotes('p2', 'grace', 2),
        recordVote('p3', 'condemnation', 1),
        recordVote('p1', 'grace', 1),
      ]);

      expect(action.type).toBe('vote');
      expect(getVotesForChoice(outcome, 'grace')).toBe(3);
      expect(hasVoteWinner(outcome)).toBe(true);
      expect(VOTING_REQUIRES_VOTE_KEYWORD).toBe(true);
    });
  });

  describe('Rule 701.39: Bolster', () => {
    it('should summarize whether the chosen creature came from the least-toughness set', () => {
      expect(createBolsterSummary(
        completeBolster('p1', 2, 'creature-2'),
        ['creature-1', 'creature-2'],
      )).toEqual({
        playerId: 'p1',
        targetCreatureId: 'creature-2',
        amongLeastToughness: true,
        countersAdded: 2,
      });
      expect(bolster('p1', 2).type).toBe('bolster');
    });
  });

  describe('Rule 701.40: Manifest', () => {
    it('should summarize how many cards were manifested and whether any can turn face up later', () => {
      const action = manifest('p1', ['card-1', 'card-2']);
      const permanents = [
        createManifestedPermanent('perm-1', 'card-1', true, true),
        createManifestedPermanent('perm-2', 'card-2', false, false),
      ];

      expect(createManifestResult(action, permanents)).toEqual({
        playerId: 'p1',
        manifestedCount: 2,
        fromZone: 'library',
        oneAtATime: true,
        canAnyTurnFaceUp: true,
      });
      expect(MANIFEST_ONE_AT_A_TIME).toBe(true);
    });
  });

  describe('Rule 701.41: Support', () => {
    it('should summarize supported targets for both permanent and spell support', () => {
      expect(supportFromPermanent('perm-1', 2, ['creature-1', 'creature-2']).type).toBe('support');
      expect(supportFromSpell('spell-1', 1, ['creature-3']).sourceType).toBe('instant-sorcery');
      expect(Array.from(createSupportResult(['creature-1', 'creature-2']).countersAdded.entries())).toEqual([
        ['creature-1', 1],
        ['creature-2', 1],
      ]);
    });
  });

  describe('Rule 701.42: Meld', () => {
    it('should summarize successful melds and preserve invalid-meld fallback zones', () => {
      expect(meld('card-a', 'card-b').type).toBe('meld');
      expect(createMeldResult(true, 'brisela-1', 'card-a', 'card-b')).toEqual({
        melded: true,
        meldedPermanentId: 'brisela-1',
        componentCardIds: ['card-a', 'card-b'],
      });
      expect(completeMeld('card-a', 'card-b', 'brisela-1').meldedPermanentId).toBe('brisela-1');
      expect(handleInvalidMeld('graveyard', 'exile')).toEqual({
        cardAStaysIn: 'graveyard',
        cardBStaysIn: 'exile',
      });
      expect(isMeldedPermanent(2)).toBe(true);
    });
  });
});