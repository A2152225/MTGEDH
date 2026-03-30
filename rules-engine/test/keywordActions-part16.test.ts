import { describe, expect, it } from 'vitest';
import {
  canConvertWhenTransformPrevented,
  canTap,
  clashWithOpponent,
  completeClash,
  completeFateseal,
  convertPermanent,
  createClashSummary,
  createConvertResult,
  createFatesealResult,
  createProliferateResult,
  createProliferateTarget,
  createTapUntapResult,
  createTransformResult,
  fateseal,
  FATESEAL_TARGETS_OPPONENT_LIBRARY,
  getHighestClashManaValue,
  handleTwoHeadedGiantPoison,
  hasUniqueClashWinner,
  proliferate,
  tapPermanent,
  transformPermanent,
  TRANSFORM_IS_DIFFERENT_FROM_FACE_DOWN,
  untapPermanent,
} from '../src/keywordActions';

describe('Rule 701: Keyword Actions - Part 16 (part-4 focused state summaries)', () => {
  describe('Rule 701.26: Tap and Untap', () => {
    it('should summarize whether a tap or untap action actually changes the permanent state', () => {
      expect(canTap({ permanentId: 'perm-1', tapped: false })).toBe(true);
      expect(createTapUntapResult(tapPermanent('perm-1'), { permanentId: 'perm-1', tapped: false })).toEqual({
        permanentId: 'perm-1',
        action: 'tap',
        changed: true,
        tapped: true,
        duringUntapStepAllowed: true,
      });
      expect(createTapUntapResult(untapPermanent('perm-1'), { permanentId: 'perm-1', tapped: true }, true).duringUntapStepAllowed).toBe(false);
    });
  });

  describe('Rule 701.27: Transform', () => {
    it('should summarize legal transforms and whether ability timing still permits them', () => {
      expect(TRANSFORM_IS_DIFFERENT_FROM_FACE_DOWN).toBe(true);
      expect(createTransformResult(
        transformPermanent('perm-1', 'front'),
        { isDoubleFaced: true },
        100,
        50,
      )).toEqual({
        permanentId: 'perm-1',
        fromFace: 'front',
        toFace: 'back',
        legal: true,
        transformedPermanent: true,
        fromAbilityAllowed: true,
      });
    });
  });

  describe('Rule 701.28: Convert', () => {
    it('should summarize conversion legality and transform-prevention carryover', () => {
      expect(canConvertWhenTransformPrevented(false)).toBe(false);
      expect(createConvertResult(
        convertPermanent('perm-1', 'back'),
        { isDoubleFaced: true },
        true,
        100,
        25,
      )).toEqual({
        permanentId: 'perm-1',
        fromFace: 'back',
        toFace: 'front',
        legal: true,
        fromAbilityAllowed: true,
        transformPreventionBlocksConvert: false,
      });
    });
  });

  describe('Rule 701.29: Fateseal', () => {
    it('should summarize opponent-library fateseal choices with capped counts', () => {
      const action = completeFateseal('p1', 'p2', 3, ['card-1'], ['card-2', 'card-3']);

      expect(fateseal('p1', 'p2', 3).type).toBe('fateseal');
      expect(createFatesealResult(action, 2)).toEqual({
        playerId: 'p1',
        opponentId: 'p2',
        requestedCount: 3,
        actualCount: 2,
        topCount: 1,
        bottomCount: 2,
        targetsOpponentLibrary: true,
      });
      expect(FATESEAL_TARGETS_OPPONENT_LIBRARY).toBe(true);
    });
  });

  describe('Rule 701.30: Clash', () => {
    it('should summarize revealed-card clash decisions and unique winners', () => {
      const action = completeClash('p1', 'card-1', true, 'p2');
      const clashes = [
        { manaValue: 5 },
        { manaValue: 3 },
      ];

      expect(getHighestClashManaValue(clashes)).toBe(5);
      expect(hasUniqueClashWinner(clashes)).toBe(true);
      expect(createClashSummary(action, clashes)).toEqual({
        playerId: 'p1',
        opponentId: 'p2',
        revealedCard: 'card-1',
        putOnBottom: true,
        highestManaValue: 5,
        uniqueWinner: true,
      });
      expect(clashWithOpponent('p1', 'p2').opponentId).toBe('p2');
    });
  });

  describe('Rule 701.34: Proliferate', () => {
    it('should summarize mixed proliferate targets and preserve Two-Headed Giant poison limits', () => {
      const targets = [
        createProliferateTarget('perm-1', 'permanent', new Map([['+1/+1', 2], ['shield', 1]])),
        createProliferateTarget('p1', 'player', new Map([['poison', 3]])),
        createProliferateTarget('p2', 'player', new Map([['poison', 1]])),
      ];
      const adjusted = handleTwoHeadedGiantPoison(targets, new Map([
        ['p1', 'team-1'],
        ['p2', 'team-1'],
      ]));

      expect(createProliferateResult(proliferate('p0', adjusted))).toEqual({
        playerId: 'p0',
        targetCount: 3,
        permanentTargetCount: 1,
        playerTargetCount: 2,
        totalCounterTypesAdded: 3,
      });
    });
  });
});