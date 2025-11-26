/**
 * Tests for Rule 701: Keyword Actions (Part 5)
 * 
 * Tests keyword actions from Rule 701.35 through 701.42:
 * - Detain, Populate, Monstrosity, Vote, Bolster, Manifest, Support, Meld
 */

import { describe, it, expect } from 'vitest';
import {
  // Rule 701.35: Detain
  detainPermanent,
  createDetainedState,
  isDetained,
  canAttackIfDetained,
  canBlockIfDetained,
  canActivateAbilitiesIfDetained,
  
  // Rule 701.36: Populate
  populate,
  canPopulate,
  completePopulate,
  createPopulateResult,
  
  // Rule 701.37: Monstrosity
  monstrosity,
  applyMonstrosity,
  isMonstrous,
  canBecomeMonstrousAgain,
  getMonstrosityX,
  createMonstrousState,
  
  // Rule 701.38: Vote
  startVote,
  recordVote,
  createVoteWithMultipleVotes,
  tallyVotes,
  VOTING_REQUIRES_VOTE_KEYWORD,
  
  // Rule 701.39: Bolster
  bolster,
  completeBolster,
  findCreaturesWithLeastToughness,
  canBolster,
  createBolsterResult,
  
  // Rule 701.40: Manifest
  manifest,
  MANIFESTED_CHARACTERISTICS,
  canTurnManifestFaceUp,
  canTurnFaceUpWithMorph,
  canManifestedInstantSorceryTurnFaceUp,
  MANIFEST_ONE_AT_A_TIME,
  createManifestedPermanent,
  
  // Rule 701.41: Support
  supportFromPermanent,
  supportFromSpell,
  canTargetForSupport,
  getValidSupportTargets,
  createSupportResult,
  
  // Rule 701.42: Meld
  meld,
  completeMeld,
  canMeld,
  handleInvalidMeld,
  createMeldResult,
  isMeldedPermanent,
} from '../src/keywordActions';

describe('Rule 701: Keyword Actions - Part 5', () => {
  describe('Rule 701.35: Detain', () => {
    it('should detain a permanent (Rule 701.35a)', () => {
      const action = detainPermanent('creature1', 'player1');
      
      expect(action.type).toBe('detain');
      expect(action.permanentId).toBe('creature1');
      expect(action.detainerId).toBe('player1');
    });
    
    it('should create detained state', () => {
      const state = createDetainedState('creature1', 'player1', 'player2');
      
      expect(state.permanentId).toBe('creature1');
      expect(state.detainedBy).toBe('player1');
      expect(state.expiresOnTurnOf).toBe('player1');
    });
    
    it('should check if detained until detainer next turn', () => {
      const state = createDetainedState('creature1', 'player1', 'player2');
      
      expect(isDetained(state, 'player2')).toBe(true); // Not detainer's turn
      expect(isDetained(state, 'player1')).toBe(false); // Detainer's turn - expires
    });
    
    it('should prevent attack, block, and activated abilities', () => {
      expect(canAttackIfDetained(true)).toBe(false);
      expect(canAttackIfDetained(false)).toBe(true);
      
      expect(canBlockIfDetained(true)).toBe(false);
      expect(canBlockIfDetained(false)).toBe(true);
      
      expect(canActivateAbilitiesIfDetained(true)).toBe(false);
      expect(canActivateAbilitiesIfDetained(false)).toBe(true);
    });
  });
  
  describe('Rule 701.36: Populate', () => {
    it('should populate (Rule 701.36a)', () => {
      const action = populate('player1', 'token1');
      
      expect(action.type).toBe('populate');
      expect(action.playerId).toBe('player1');
      expect(action.chosenTokenId).toBe('token1');
    });
    
    it('should require creature tokens (Rule 701.36b)', () => {
      expect(canPopulate(['token1', 'token2'])).toBe(true);
      expect(canPopulate([])).toBe(false);
    });
    
    it('should complete populate with chosen token', () => {
      const completed = completePopulate('player1', 'token1');
      
      expect(completed.chosenTokenId).toBe('token1');
    });
    
    it('should create populate result', () => {
      const result = createPopulateResult('token1', 'token2');
      
      expect(result.populated).toBe(true);
      expect(result.originalTokenId).toBe('token1');
      expect(result.newTokenId).toBe('token2');
    });
  });
  
  describe('Rule 701.37: Monstrosity', () => {
    it('should perform monstrosity N (Rule 701.37a)', () => {
      const action = monstrosity('creature1', 3);
      
      expect(action.type).toBe('monstrosity');
      expect(action.permanentId).toBe('creature1');
      expect(action.n).toBe(3);
    });
    
    it('should become monstrous only once (Rule 701.37a)', () => {
      const initial = createMonstrousState('creature1');
      const afterFirst = applyMonstrosity(initial, 3);
      const afterSecond = applyMonstrosity(afterFirst, 5);
      
      expect(isMonstrous(afterFirst)).toBe(true);
      expect(getMonstrosityX(afterFirst)).toBe(3);
      
      // Second monstrosity has no effect
      expect(isMonstrous(afterSecond)).toBe(true);
      expect(getMonstrosityX(afterSecond)).toBe(3); // Still 3, not 5
    });
    
    it('should stay monstrous until leaves battlefield (Rule 701.37b)', () => {
      const state = createMonstrousState('creature1');
      const monstrous = applyMonstrosity(state, 2);
      
      expect(canBecomeMonstrousAgain(monstrous)).toBe(false);
    });
    
    it('should track X value (Rule 701.37c)', () => {
      const state = createMonstrousState('creature1');
      const monstrous = applyMonstrosity(state, 4);
      
      expect(getMonstrosityX(monstrous)).toBe(4);
    });
  });
  
  describe('Rule 701.38: Vote', () => {
    it('should start a vote (Rule 701.38a)', () => {
      const action = startVote(
        ['player1', 'player2', 'player3'],
        ['option A', 'option B'],
        'player1'
      );
      
      expect(action.type).toBe('vote');
      expect(action.voters).toHaveLength(3);
      expect(action.choices).toHaveLength(2);
      expect(action.startingVoter).toBe('player1');
    });
    
    it('should record votes', () => {
      const vote = recordVote('player1', 'option A', 1);
      
      expect(vote.playerId).toBe('player1');
      expect(vote.choice).toBe('option A');
      expect(vote.voteCount).toBe(1);
    });
    
    it('should handle multiple votes (Rule 701.38d)', () => {
      const multiVote = createVoteWithMultipleVotes('player1', 'option B', 3);
      
      expect(multiVote.voteCount).toBe(3);
    });
    
    it('should tally votes correctly', () => {
      const votes = [
        recordVote('p1', 'A', 1),
        recordVote('p2', 'B', 1),
        recordVote('p3', 'A', 2), // Has 2 votes
      ];
      
      const outcome = tallyVotes(votes);
      
      expect(outcome.winner).toBe('A'); // 3 votes vs 1
      expect(outcome.voteCounts.get('A')).toBe(3);
      expect(outcome.voteCounts.get('B')).toBe(1);
    });
    
    it('should handle ties', () => {
      const votes = [
        recordVote('p1', 'A', 2),
        recordVote('p2', 'B', 2),
      ];
      
      const outcome = tallyVotes(votes);
      
      expect(outcome.winner).toBeNull(); // Tie
    });
    
    it('should only refer to actual votes (Rule 701.38c)', () => {
      expect(VOTING_REQUIRES_VOTE_KEYWORD).toBe(true);
    });
  });
  
  describe('Rule 701.39: Bolster', () => {
    it('should bolster N (Rule 701.39a)', () => {
      const action = bolster('player1', 2);
      
      expect(action.type).toBe('bolster');
      expect(action.playerId).toBe('player1');
      expect(action.n).toBe(2);
    });
    
    it('should find creatures with least toughness', () => {
      const creatures = [
        { id: 'c1', toughness: 3 },
        { id: 'c2', toughness: 1 },
        { id: 'c3', toughness: 2 },
        { id: 'c4', toughness: 1 },
      ];
      
      const leastTough = findCreaturesWithLeastToughness(creatures);
      
      expect(leastTough).toEqual(['c2', 'c4']); // Both have toughness 1
    });
    
    it('should complete bolster with chosen creature', () => {
      const completed = completeBolster('player1', 3, 'creature1');
      
      expect(completed.targetCreatureId).toBe('creature1');
      expect(completed.n).toBe(3);
    });
    
    it('should require controlled creatures', () => {
      expect(canBolster(['c1', 'c2'])).toBe(true);
      expect(canBolster([])).toBe(false);
    });
    
    it('should create bolster result', () => {
      const result = createBolsterResult('creature1', 2);
      
      expect(result.bolstered).toBe(true);
      expect(result.countersAdded).toBe(2);
    });
  });
  
  describe('Rule 701.40: Manifest', () => {
    it('should manifest cards (Rule 701.40a)', () => {
      const action = manifest('player1', ['card1', 'card2'], 'library');
      
      expect(action.type).toBe('manifest');
      expect(action.playerId).toBe('player1');
      expect(action.cardIds).toEqual(['card1', 'card2']);
      expect(action.fromZone).toBe('library');
    });
    
    it('should have correct manifested characteristics', () => {
      expect(MANIFESTED_CHARACTERISTICS.power).toBe(2);
      expect(MANIFESTED_CHARACTERISTICS.toughness).toBe(2);
      expect(MANIFESTED_CHARACTERISTICS.types).toEqual(['Creature']);
      expect(MANIFESTED_CHARACTERISTICS.name).toBe('');
    });
    
    it('should only turn face up if creature with mana cost (Rule 701.40b)', () => {
      expect(canTurnManifestFaceUp({ isCreature: true, hasManaCost: true })).toBe(true);
      expect(canTurnManifestFaceUp({ isCreature: true, hasManaCost: false })).toBe(false);
      expect(canTurnManifestFaceUp({ isCreature: false, hasManaCost: true })).toBe(false);
    });
    
    it('should turn face up with morph or disguise (Rules 701.40c-d)', () => {
      expect(canTurnFaceUpWithMorph(true)).toBe(true);
      expect(canTurnFaceUpWithMorph(false)).toBe(false);
    });
    
    it('should manifest one at a time (Rule 701.40e)', () => {
      expect(MANIFEST_ONE_AT_A_TIME).toBe(true);
    });
    
    it('should not turn face up if instant/sorcery (Rule 701.40g)', () => {
      expect(canManifestedInstantSorceryTurnFaceUp(true)).toBe(false);
      expect(canManifestedInstantSorceryTurnFaceUp(false)).toBe(true);
    });
    
    it('should create manifested permanent state', () => {
      const manifested = createManifestedPermanent('perm1', 'card1', true, true);
      
      expect(manifested.isFaceDown).toBe(true);
      expect(manifested.canTurnFaceUp).toBe(true);
    });
  });
  
  describe('Rule 701.41: Support', () => {
    it('should support from permanent (Rule 701.41a)', () => {
      const action = supportFromPermanent('creature1', 2, ['c2', 'c3']);
      
      expect(action.type).toBe('support');
      expect(action.sourceType).toBe('permanent');
      expect(action.n).toBe(2);
      expect(action.targetCreatureIds).toEqual(['c2', 'c3']);
    });
    
    it('should support from spell', () => {
      const action = supportFromSpell('spell1', 3, ['c1', 'c2', 'c3']);
      
      expect(action.sourceType).toBe('instant-sorcery');
    });
    
    it('should not target self for permanent support', () => {
      expect(canTargetForSupport('c1', 'permanent', 'c1')).toBe(false);
      expect(canTargetForSupport('c1', 'permanent', 'c2')).toBe(true);
    });
    
    it('should allow self-target for spell support', () => {
      expect(canTargetForSupport('spell1', 'instant-sorcery', 'c1')).toBe(true);
    });
    
    it('should get valid support targets', () => {
      const targets = getValidSupportTargets(
        'c1',
        'permanent',
        ['c1', 'c2', 'c3', 'c4'],
        2
      );
      
      expect(targets).not.toContain('c1'); // Self excluded
      expect(targets).toHaveLength(2); // Up to N
    });
    
    it('should create support result', () => {
      const result = createSupportResult(['c1', 'c2']);
      
      expect(result.countersAdded.get('c1')).toBe(1);
      expect(result.countersAdded.get('c2')).toBe(1);
    });
  });
  
  describe('Rule 701.42: Meld', () => {
    it('should meld cards (Rule 701.42a)', () => {
      const action = meld('card1', 'card2');
      
      expect(action.type).toBe('meld');
      expect(action.cardAId).toBe('card1');
      expect(action.cardBId).toBe('card2');
    });
    
    it('should complete meld with resulting permanent', () => {
      const completed = completeMeld('card1', 'card2', 'melded1');
      
      expect(completed.meldedPermanentId).toBe('melded1');
    });
    
    it('should only meld valid pairs (Rule 701.42b)', () => {
      const validCardA = { isMeldCard: true, isToken: false, meldPairName: 'pair1' };
      const validCardB = { isMeldCard: true, isToken: false, meldPairName: 'pair1' };
      const token = { isMeldCard: true, isToken: true, meldPairName: 'pair1' };
      const differentPair = { isMeldCard: true, isToken: false, meldPairName: 'pair2' };
      
      expect(canMeld(validCardA, validCardB)).toBe(true);
      expect(canMeld(validCardA, token)).toBe(false); // Can't meld tokens
      expect(canMeld(validCardA, differentPair)).toBe(false); // Different pairs
    });
    
    it('should handle invalid meld (Rule 701.42c)', () => {
      const result = handleInvalidMeld('exile', 'graveyard');
      
      expect(result.cardAStaysIn).toBe('exile');
      expect(result.cardBStaysIn).toBe('graveyard');
    });
    
    it('should create meld result', () => {
      const result = createMeldResult(true, 'melded1', 'card1', 'card2');
      
      expect(result.melded).toBe(true);
      expect(result.meldedPermanentId).toBe('melded1');
      expect(result.componentCardIds).toEqual(['card1', 'card2']);
    });
    
    it('should identify melded permanents', () => {
      expect(isMeldedPermanent(2)).toBe(true);
      expect(isMeldedPermanent(1)).toBe(false);
    });
  });
});
