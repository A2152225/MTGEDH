/**
 * Tests for Rule 701: Keyword Actions (Part 3)
 * 
 * Tests keyword actions from Rule 701.18 through 701.26:
 * - Play, Regenerate, Reveal, Sacrifice, Scry, Search, Shuffle, Surveil, Tap/Untap
 */

import { describe, it, expect } from 'vitest';
import {
  // Rule 701.18: Play
  playLand,
  playCard,
  canPlay,
  
  // Rule 701.19: Regenerate
  createRegenerationShield,
  useRegenerationShield,
  applyRegeneration,
  hasActiveShield,
  getNextActiveShield,
  
  // Rule 701.20: Reveal
  revealCards,
  createRevealResult,
  revealDoesNotMoveCard,
  
  // Rule 701.21: Sacrifice
  sacrificePermanent,
  canSacrifice,
  SACRIFICE_IS_NOT_DESTRUCTION,
  canBeSacrificed,
  
  // Rule 701.22: Scry
  scry,
  getActualScryCount,
  completeScry,
  shouldTriggerScry,
  
  // Rule 701.23: Search
  searchZone,
  failToFind,
  completeSearch,
  getSearchableZone,
  isPublicZone,
  
  // Rule 701.24: Shuffle
  shuffleLibrary,
  shouldShuffle,
  shuffleCardsIntoLibrary,
  canShuffleLibrary,
  
  // Rule 701.25: Surveil
  surveil,
  getActualSurveilCount,
  completeSurveil,
  shouldTriggerSurveil,
  
  // Rule 701.26: Tap/Untap
  tapPermanent,
  untapPermanent,
  canTap,
  canUntap,
  applyTapUntap,
  enterBattlefieldTapped,
  canUntapDuringUntapStep,
  TappedState,
} from '../src/keywordActions';

describe('Rule 701: Keyword Actions - Part 3', () => {
  describe('Rule 701.18: Play', () => {
    it('should play a land (Rule 701.18a)', () => {
      const action = playLand('land1', 'player1');
      
      expect(action.type).toBe('play');
      expect(action.playType).toBe('land');
      expect(action.cardId).toBe('land1');
      expect(action.playerId).toBe('player1');
      expect(action.fromZone).toBe('hand');
    });
    
    it('should play a card (Rule 701.18b)', () => {
      const landAction = playCard('card1', 'player1', 'land');
      const spellAction = playCard('card2', 'player1', 'spell');
      
      expect(landAction.playType).toBe('land');
      expect(spellAction.playType).toBe('spell');
    });
    
    it('should validate land play requirements', () => {
      // Can play: main phase, priority, empty stack, haven't played land
      expect(canPlay('land', true, true, true, 0, 0)).toBe(true);
      
      // Can't play: not main phase
      expect(canPlay('land', true, false, true, 0, 0)).toBe(false);
      
      // Can't play: already played land
      expect(canPlay('land', true, true, true, 1, 0)).toBe(false);
      
      // Can play: additional land play available
      expect(canPlay('land', true, true, true, 1, 1)).toBe(true);
      
      // Spell: just needs priority
      expect(canPlay('spell', true, false, false, 0, 0)).toBe(true);
      expect(canPlay('spell', false, true, true, 0, 0)).toBe(false);
    });
  });
  
  describe('Rule 701.19: Regenerate', () => {
    it('should create regeneration shield (Rule 701.19a)', () => {
      const shield = createRegenerationShield('permanent1');
      
      expect(shield.permanentId).toBe('permanent1');
      expect(shield.active).toBe(true);
    });
    
    it('should use regeneration shield (Rule 701.19b)', () => {
      const shield = createRegenerationShield('permanent1');
      const used = useRegenerationShield(shield);
      
      expect(used.active).toBe(false);
    });
    
    it('should apply regeneration effects (Rule 701.19c)', () => {
      const resultAttacking = applyRegeneration(true);
      const resultNotAttacking = applyRegeneration(false);
      
      expect(resultAttacking.regenerated).toBe(true);
      expect(resultAttacking.damageRemoved).toBe(true);
      expect(resultAttacking.tapped).toBe(true);
      expect(resultAttacking.removedFromCombat).toBe(true);
      
      expect(resultNotAttacking.removedFromCombat).toBe(false);
    });
    
    it('should handle multiple shields (Rule 701.19d)', () => {
      const shield1 = createRegenerationShield('perm1');
      const shield2 = createRegenerationShield('perm1');
      const usedShield1 = useRegenerationShield(shield1);
      
      expect(hasActiveShield([shield1, shield2])).toBe(true);
      expect(hasActiveShield([usedShield1, shield2])).toBe(true);
      expect(hasActiveShield([usedShield1, useRegenerationShield(shield2)])).toBe(false);
      
      const nextShield = getNextActiveShield([usedShield1, shield2]);
      expect(nextShield).toBe(shield2);
    });
  });
  
  describe('Rule 701.20: Reveal', () => {
    it('should reveal cards (Rule 701.20a)', () => {
      const action = revealCards('player1', ['card1', 'card2'], 'hand');
      
      expect(action.type).toBe('reveal');
      expect(action.playerId).toBe('player1');
      expect(action.cardIds).toEqual(['card1', 'card2']);
      expect(action.fromZone).toBe('hand');
    });
    
    it('should maintain library order (Rule 701.20b)', () => {
      const fromLibrary = createRevealResult(['card1', 'card2'], 'library');
      const fromHand = createRevealResult(['card3'], 'hand');
      
      expect(fromLibrary.maintainOrder).toBe(true);
      expect(fromLibrary.remainInZone).toBe(true);
      expect(fromHand.maintainOrder).toBe(false);
      expect(fromHand.remainInZone).toBe(false);
    });
    
    it('should not move card (Rule 701.20c)', () => {
      expect(revealDoesNotMoveCard()).toBe(true);
    });
  });
  
  describe('Rule 701.21: Sacrifice', () => {
    it('should sacrifice a permanent (Rule 701.21a)', () => {
      const action = sacrificePermanent('permanent1', 'player1');
      
      expect(action.type).toBe('sacrifice');
      expect(action.permanentId).toBe('permanent1');
      expect(action.controllerId).toBe('player1');
    });
    
    it('should only sacrifice controlled permanents (Rule 701.21b)', () => {
      const controlled = { id: 'perm1', controllerId: 'player1' };
      const notControlled = { id: 'perm2', controllerId: 'player2' };
      
      expect(canSacrifice(controlled, 'player1')).toBe(true);
      expect(canSacrifice(notControlled, 'player1')).toBe(false);
      expect(canSacrifice(null, 'player1')).toBe(false);
    });
    
    it('should not be destruction (Rule 701.21c)', () => {
      expect(SACRIFICE_IS_NOT_DESTRUCTION).toBe(true);
    });
    
    it('should ignore indestructible (Rule 701.21d)', () => {
      expect(canBeSacrificed(true)).toBe(true);
      expect(canBeSacrificed(false)).toBe(true);
    });
  });
  
  describe('Rule 701.22: Scry', () => {
    it('should scry N cards (Rule 701.22a)', () => {
      const action = scry('player1', 3);
      
      expect(action.type).toBe('scry');
      expect(action.playerId).toBe('player1');
      expect(action.count).toBe(3);
    });
    
    it('should limit scry to library size (Rule 701.22b)', () => {
      expect(getActualScryCount(10, 5)).toBe(5);
      expect(getActualScryCount(10, 15)).toBe(10);
    });
    
    it('should complete scry with decisions', () => {
      const completed = completeScry('player1', 3, ['card1'], ['card2', 'card3']);
      
      expect(completed.topCards).toEqual(['card1']);
      expect(completed.bottomCards).toEqual(['card2', 'card3']);
    });
    
    it('should not trigger on scry 0 (Rule 701.22c)', () => {
      expect(shouldTriggerScry(0)).toBe(false);
      expect(shouldTriggerScry(1)).toBe(true);
    });
    
    it('should validate scry decisions', () => {
      expect(() => completeScry('player1', 3, ['card1'], ['card2'])).toThrow();
    });
  });
  
  describe('Rule 701.23: Search', () => {
    it('should search a zone (Rule 701.23a)', () => {
      const action = searchZone('player1', 'library', {
        cardType: 'land',
        maxResults: 1,
      });
      
      expect(action.type).toBe('search');
      expect(action.playerId).toBe('player1');
      expect(action.zone).toBe('library');
      expect(action.criteria.cardType).toBe('land');
    });
    
    it('should allow fail to find (Rule 701.23b)', () => {
      const search = searchZone('player1', 'library', { cardType: 'land' });
      const failed = failToFind(search);
      
      expect(failed.failToFind).toBe(true);
      expect(failed.foundCardIds).toEqual([]);
    });
    
    it('should complete search', () => {
      const search = searchZone('player1', 'library', { cardType: 'land' });
      const completed = completeSearch(search, ['land1', 'land2']);
      
      expect(completed.foundCardIds).toEqual(['land1', 'land2']);
    });
    
    it('should handle merged permanent zones (Rule 701.23d)', () => {
      expect(getSearchableZone('library', false)).toBe('library');
      expect(getSearchableZone('library', true, 'controller-library')).toBe('controller-library');
    });
    
    it('should identify public zones (Rule 701.23e)', () => {
      expect(isPublicZone('graveyard')).toBe(true);
      expect(isPublicZone('battlefield')).toBe(true);
      expect(isPublicZone('hand')).toBe(false);
      expect(isPublicZone('library')).toBe(false);
    });
  });
  
  describe('Rule 701.24: Shuffle', () => {
    it('should shuffle library (Rule 701.24a)', () => {
      const action = shuffleLibrary('player1');
      
      expect(action.type).toBe('shuffle');
      expect(action.playerId).toBe('player1');
      expect(action.zone).toBe('library');
    });
    
    it('should shuffle even if cards already in library (Rule 701.24b)', () => {
      expect(shouldShuffle(['card1'], ['card1'])).toBe(true);
      expect(shouldShuffle(['card1', 'card2'], [])).toBe(true);
    });
    
    it('should shuffle cards into library (Rule 701.24c)', () => {
      const action = shuffleCardsIntoLibrary('player1', ['card1', 'card2'], 'graveyard');
      
      expect(action.type).toBe('shuffle');
    });
    
    it('should validate library exists (Rule 701.24d)', () => {
      expect(canShuffleLibrary(true)).toBe(true);
      expect(canShuffleLibrary(false)).toBe(false);
    });
  });
  
  describe('Rule 701.25: Surveil', () => {
    it('should surveil N cards (Rule 701.25a)', () => {
      const action = surveil('player1', 2);
      
      expect(action.type).toBe('surveil');
      expect(action.playerId).toBe('player1');
      expect(action.count).toBe(2);
    });
    
    it('should limit surveil to library size (Rule 701.25b)', () => {
      expect(getActualSurveilCount(10, 5)).toBe(5);
      expect(getActualSurveilCount(10, 15)).toBe(10);
    });
    
    it('should complete surveil with decisions', () => {
      const completed = completeSurveil('player1', 3, ['card1'], ['card2', 'card3']);
      
      expect(completed.toGraveyard).toEqual(['card1']);
      expect(completed.toTop).toEqual(['card2', 'card3']);
    });
    
    it('should not trigger on surveil 0 (Rule 701.25c)', () => {
      expect(shouldTriggerSurveil(0)).toBe(false);
      expect(shouldTriggerSurveil(1)).toBe(true);
    });
    
    it('should validate surveil decisions', () => {
      expect(() => completeSurveil('player1', 3, ['card1'], ['card2'])).toThrow();
    });
  });
  
  describe('Rule 701.26: Tap and Untap', () => {
    it('should tap a permanent (Rule 701.26a)', () => {
      const action = tapPermanent('permanent1');
      
      expect(action.type).toBe('tap-untap');
      expect(action.action).toBe('tap');
      expect(action.permanentId).toBe('permanent1');
    });
    
    it('should untap a permanent (Rule 701.26b)', () => {
      const action = untapPermanent('permanent1');
      
      expect(action.type).toBe('tap-untap');
      expect(action.action).toBe('untap');
    });
    
    it('should only tap untapped permanents (Rule 701.26c)', () => {
      const untapped: TappedState = { permanentId: 'perm1', tapped: false };
      const tapped: TappedState = { permanentId: 'perm2', tapped: true };
      
      expect(canTap(untapped)).toBe(true);
      expect(canTap(tapped)).toBe(false);
      
      expect(canUntap(tapped)).toBe(true);
      expect(canUntap(untapped)).toBe(false);
    });
    
    it('should apply tap/untap correctly', () => {
      const untapped: TappedState = { permanentId: 'perm1', tapped: false };
      const tapped: TappedState = { permanentId: 'perm2', tapped: true };
      
      const afterTap = applyTapUntap(untapped, 'tap');
      expect(afterTap.tapped).toBe(true);
      
      const afterUntap = applyTapUntap(tapped, 'untap');
      expect(afterUntap.tapped).toBe(false);
      
      // No change if already in desired state
      const noChange1 = applyTapUntap(tapped, 'tap');
      expect(noChange1.tapped).toBe(true);
      
      const noChange2 = applyTapUntap(untapped, 'untap');
      expect(noChange2.tapped).toBe(false);
    });
    
    it('should enter battlefield tapped (Rule 701.26d)', () => {
      const state = enterBattlefieldTapped('permanent1');
      
      expect(state.tapped).toBe(true);
    });
    
    it('should handle "doesn\'t untap" effects (Rule 701.26e)', () => {
      const state: TappedState = { permanentId: 'perm1', tapped: true };
      
      expect(canUntapDuringUntapStep(state, false)).toBe(true);
      expect(canUntapDuringUntapStep(state, true)).toBe(false);
    });
  });
});
