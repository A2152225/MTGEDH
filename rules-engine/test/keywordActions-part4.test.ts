/**
 * Tests for Rule 701: Keyword Actions (Part 4)
 * 
 * Tests keyword actions from Rule 701.27 through 701.34:
 * - Transform, Convert, Fateseal, Clash, Planeswalk, Proliferate
 */

import { describe, it, expect } from 'vitest';
import {
  // Rule 701.27: Transform
  transformPermanent,
  canTransform,
  canTransformFromAbility,
  isTransformedPermanent,
  checkTransformIntoTrigger,
  TRANSFORM_IS_DIFFERENT_FROM_FACE_DOWN,
  
  // Rule 701.28: Convert
  convertPermanent,
  canConvert,
  canConvertFromAbility,
  canConvertWhenTransformPrevented,
  CONVERT_IS_DIFFERENT_FROM_FACE_DOWN,
  
  // Rule 701.29: Fateseal
  fateseal,
  completeFateseal,
  getActualFatesealCount,
  FATESEAL_TARGETS_OPPONENT_LIBRARY,
  
  // Rule 701.30: Clash
  clash,
  clashWithOpponent,
  completeClash,
  resolveClashes,
  wonClash,
  
  // Rule 701.31: Planeswalk
  canPlaneswalk,
  planeswalk,
  PlaneswalkCause,
  createPlaneswalkResult,
  
  // Rule 701.34: Proliferate
  proliferate,
  createProliferateTarget,
  handleTwoHeadedGiantPoison,
  canBeProliferateTarget,
  calculateProliferateCounters,
} from '../src/keywordActions';

describe('Rule 701: Keyword Actions - Part 4', () => {
  describe('Rule 701.27: Transform', () => {
    it('should transform a permanent (Rule 701.27a)', () => {
      const action = transformPermanent('creature1', 'front');
      
      expect(action.type).toBe('transform');
      expect(action.permanentId).toBe('creature1');
      expect(action.fromFace).toBe('front');
      expect(action.toFace).toBe('back');
    });
    
    it('should transform from back to front', () => {
      const action = transformPermanent('creature1', 'back');
      
      expect(action.fromFace).toBe('back');
      expect(action.toFace).toBe('front');
    });
    
    it('should be different from face down (Rule 701.27b)', () => {
      expect(TRANSFORM_IS_DIFFERENT_FROM_FACE_DOWN).toBe(true);
    });
    
    it('should only transform double-faced permanents (Rule 701.27c)', () => {
      expect(canTransform({ isDoubleFaced: true })).toBe(true);
      expect(canTransform({ isDoubleFaced: false })).toBe(false);
    });
    
    it('should not transform into instant/sorcery face (Rule 701.27d)', () => {
      expect(canTransform({ isDoubleFaced: true, isInstantOrSorcery: true })).toBe(false);
      expect(canTransform({ isDoubleFaced: true, isInstantOrSorcery: false })).toBe(true);
    });
    
    it('should only transform once per ability (Rule 701.27f)', () => {
      expect(canTransformFromAbility('perm1', 100, null)).toBe(true);
      expect(canTransformFromAbility('perm1', 100, 50)).toBe(true);
      expect(canTransformFromAbility('perm1', 100, 150)).toBe(false);
    });
    
    it('should identify transformed permanents (Rule 701.27g)', () => {
      expect(isTransformedPermanent({
        isDoubleFaced: true,
        currentFace: 'back',
      })).toBe(true);
      
      expect(isTransformedPermanent({
        isDoubleFaced: true,
        currentFace: 'front',
      })).toBe(false);
      
      expect(isTransformedPermanent({
        isDoubleFaced: true,
        currentFace: 'back',
        isMelded: true,
      })).toBe(false);
    });
    
    it('should check transform into triggers (Rule 701.27e)', () => {
      expect(checkTransformIntoTrigger('perm1', 'back', true)).toBe(true);
      expect(checkTransformIntoTrigger('perm1', 'back', false)).toBe(false);
    });
  });
  
  describe('Rule 701.28: Convert', () => {
    it('should convert a permanent (Rule 701.28a)', () => {
      const action = convertPermanent('creature1', 'front');
      
      expect(action.type).toBe('convert');
      expect(action.permanentId).toBe('creature1');
      expect(action.fromFace).toBe('front');
      expect(action.toFace).toBe('back');
    });
    
    it('should be different from face down (Rule 701.28b)', () => {
      expect(CONVERT_IS_DIFFERENT_FROM_FACE_DOWN).toBe(true);
    });
    
    it('should only convert double-faced permanents (Rule 701.28c)', () => {
      expect(canConvert({ isDoubleFaced: true })).toBe(true);
      expect(canConvert({ isDoubleFaced: false })).toBe(false);
    });
    
    it('should not convert into instant/sorcery face (Rule 701.28d)', () => {
      expect(canConvert({ isDoubleFaced: true, isInstantOrSorcery: true })).toBe(false);
    });
    
    it('should only convert once per ability (Rule 701.28e)', () => {
      expect(canConvertFromAbility('perm1', 100, null)).toBe(true);
      expect(canConvertFromAbility('perm1', 100, 50)).toBe(true);
      expect(canConvertFromAbility('perm1', 100, 150)).toBe(false);
    });
    
    it('should not convert when transform is prevented (Rule 701.28f)', () => {
      expect(canConvertWhenTransformPrevented(true)).toBe(true);
      expect(canConvertWhenTransformPrevented(false)).toBe(false);
    });
  });
  
  describe('Rule 701.29: Fateseal', () => {
    it('should fateseal opponent library (Rule 701.29a)', () => {
      const action = fateseal('player1', 'player2', 3);
      
      expect(action.type).toBe('fateseal');
      expect(action.playerId).toBe('player1');
      expect(action.opponentId).toBe('player2');
      expect(action.count).toBe(3);
    });
    
    it('should complete fateseal with decisions', () => {
      const completed = completeFateseal(
        'player1',
        'player2',
        3,
        ['card1'],
        ['card2', 'card3']
      );
      
      expect(completed.topCards).toEqual(['card1']);
      expect(completed.bottomCards).toEqual(['card2', 'card3']);
    });
    
    it('should validate fateseal decisions', () => {
      expect(() => completeFateseal('p1', 'p2', 3, ['c1'], ['c2'])).toThrow();
    });
    
    it('should limit fateseal to library size', () => {
      expect(getActualFatesealCount(10, 5)).toBe(5);
      expect(getActualFatesealCount(10, 15)).toBe(10);
    });
    
    it('should target opponent library', () => {
      expect(FATESEAL_TARGETS_OPPONENT_LIBRARY).toBe(true);
    });
  });
  
  describe('Rule 701.30: Clash', () => {
    it('should clash (Rule 701.30a)', () => {
      const action = clash('player1');
      
      expect(action.type).toBe('clash');
      expect(action.playerId).toBe('player1');
    });
    
    it('should clash with opponent (Rule 701.30b)', () => {
      const action = clashWithOpponent('player1', 'player2');
      
      expect(action.type).toBe('clash');
      expect(action.playerId).toBe('player1');
      expect(action.opponentId).toBe('player2');
    });
    
    it('should complete clash with decision', () => {
      const completed = completeClash('player1', 'card1', true);
      
      expect(completed.revealedCard).toBe('card1');
      expect(completed.putOnBottom).toBe(true);
    });
    
    it('should resolve clashes correctly (Rule 701.30c)', () => {
      const results = resolveClashes([
        { playerId: 'p1', revealedCard: 'c1', manaValue: 5, putOnBottom: false },
        { playerId: 'p2', revealedCard: 'c2', manaValue: 3, putOnBottom: true },
      ]);
      
      expect(results[0].wonClash).toBe(true);
      expect(results[1].wonClash).toBe(false);
    });
    
    it('should determine clash winner (Rule 701.30d)', () => {
      expect(wonClash(5, [3, 2])).toBe(true);
      expect(wonClash(3, [5, 2])).toBe(false);
      expect(wonClash(3, [3, 2])).toBe(false); // Tie doesn't win
      expect(wonClash(5, [])).toBe(true); // Solo clash
    });
  });
  
  describe('Rule 701.31: Planeswalk', () => {
    it('should only planeswalk in Planechase game (Rule 701.31a)', () => {
      expect(canPlaneswalk(true, true)).toBe(true);
      expect(canPlaneswalk(false, true)).toBe(false);
      expect(canPlaneswalk(true, false)).toBe(false);
    });
    
    it('should planeswalk (Rule 701.31b)', () => {
      const action = planeswalk('player1', 'plane1', 'plane2');
      
      expect(action.type).toBe('planeswalk');
      expect(action.playerId).toBe('player1');
      expect(action.fromPlane).toBe('plane1');
      expect(action.toPlane).toBe('plane2');
    });
    
    it('should create planeswalk result (Rule 701.31d)', () => {
      const result = createPlaneswalkResult(
        'plane2',
        'plane1',
        PlaneswalkCause.PLANESWALKING_ABILITY
      );
      
      expect(result.planeswalkedTo).toBe('plane2');
      expect(result.planeswalkedFrom).toBe('plane1');
      expect(result.cause).toBe(PlaneswalkCause.PLANESWALKING_ABILITY);
    });
    
    it('should handle various planeswalk causes (Rule 701.31c)', () => {
      const causes = [
        PlaneswalkCause.PLANESWALKING_ABILITY,
        PlaneswalkCause.OWNER_LEAVES,
        PlaneswalkCause.PHENOMENON_TRIGGER,
        PlaneswalkCause.ABILITY_INSTRUCTION,
      ];
      
      expect(causes).toHaveLength(4);
    });
  });
  
  describe('Rule 701.34: Proliferate', () => {
    it('should proliferate (Rule 701.34a)', () => {
      const target = createProliferateTarget(
        'creature1',
        'permanent',
        new Map([
          ['+1/+1', 2],
          ['vigilance', 1],
        ])
      );
      
      const action = proliferate('player1', [target]);
      
      expect(action.type).toBe('proliferate');
      expect(action.playerId).toBe('player1');
      expect(action.targets).toHaveLength(1);
    });
    
    it('should add one of each counter type', () => {
      const target = createProliferateTarget(
        'perm1',
        'permanent',
        new Map([
          ['+1/+1', 3],
          ['-1/-1', 1],
        ])
      );
      
      expect(target.countersToAdd.get('+1/+1')).toBe(1);
      expect(target.countersToAdd.get('-1/-1')).toBe(1);
    });
    
    it('should handle Two-Headed Giant poison (Rule 701.34b)', () => {
      const targets = [
        createProliferateTarget('p1', 'player', new Map([['poison', 5]])),
        createProliferateTarget('p2', 'player', new Map([['poison', 3]])),
      ];
      
      const teams = new Map([
        ['p1', 'team1'],
        ['p2', 'team1'],
      ]);
      
      const result = handleTwoHeadedGiantPoison(targets, teams);
      
      // Only one player on team gets poison
      const poisonGivenCount = result.filter(
        t => t.countersToAdd.has('poison')
      ).length;
      expect(poisonGivenCount).toBe(1);
    });
    
    it('should check if target can be proliferated', () => {
      expect(canBeProliferateTarget(new Map([['+1/+1', 1]]))).toBe(true);
      expect(canBeProliferateTarget(new Map([['+1/+1', 0]]))).toBe(false);
      expect(canBeProliferateTarget(new Map())).toBe(false);
    });
    
    it('should calculate proliferate counters', () => {
      const counters = calculateProliferateCounters(
        new Map([
          ['+1/+1', 3],
          ['poison', 2],
          ['loyalty', 0], // Zero counters don't proliferate
        ])
      );
      
      expect(counters.get('+1/+1')).toBe(1);
      expect(counters.get('poison')).toBe(1);
      expect(counters.has('loyalty')).toBe(false);
    });
  });
});
