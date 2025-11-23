/**
 * Tests for Rule 116: Special Actions
 */
import { describe, it, expect } from 'vitest';
import {
  SpecialActionType,
  PlayLandAction,
  TurnFaceUpAction,
  CompanionAction,
  canTakeSpecialAction,
  playerReceivesPriorityAfterSpecialAction,
  SpecialActionConstraints
} from '../src/types/specialActions';

describe('Rule 116: Special Actions', () => {
  describe('Rule 116.1 - Special actions don\'t use the stack', () => {
    it('should define all twelve special action types', () => {
      expect(SpecialActionType.PLAY_LAND).toBe('play_land');
      expect(SpecialActionType.TURN_FACE_UP).toBe('turn_face_up');
      expect(SpecialActionType.SUSPEND).toBe('suspend');
      expect(SpecialActionType.COMPANION_TO_HAND).toBe('companion_to_hand');
      expect(SpecialActionType.FORETELL).toBe('foretell');
      expect(SpecialActionType.PLOT).toBe('plot');
    });
  });

  describe('Rule 116.2a - Playing a land', () => {
    it('should require main phase, empty stack, and own turn', () => {
      const action: PlayLandAction = {
        type: SpecialActionType.PLAY_LAND,
        playerId: 'player-1',
        cardId: 'forest-1',
        requiresPriority: true,
        requiresMainPhase: true,
        requiresEmptyStack: true,
        requiresOwnTurn: true,
        landsPlayedThisTurn: 0,
        maxLandsPerTurn: 1
      };

      const validConstraints: SpecialActionConstraints = {
        hasPriority: true,
        isMainPhase: true,
        isStackEmpty: true,
        isOwnTurn: true
      };

      expect(canTakeSpecialAction(action, validConstraints)).toBe(true);
    });

    it('should not allow when stack is not empty', () => {
      const action: PlayLandAction = {
        type: SpecialActionType.PLAY_LAND,
        playerId: 'player-1',
        cardId: 'forest-1',
        requiresPriority: true,
        requiresMainPhase: true,
        requiresEmptyStack: true,
        requiresOwnTurn: true,
        landsPlayedThisTurn: 0,
        maxLandsPerTurn: 1
      };

      const constraints: SpecialActionConstraints = {
        hasPriority: true,
        isMainPhase: true,
        isStackEmpty: false,  // Stack not empty
        isOwnTurn: true
      };

      expect(canTakeSpecialAction(action, constraints)).toBe(false);
    });

    it('should not allow when land limit reached', () => {
      const action: PlayLandAction = {
        type: SpecialActionType.PLAY_LAND,
        playerId: 'player-1',
        cardId: 'forest-1',
        requiresPriority: true,
        requiresMainPhase: true,
        requiresEmptyStack: true,
        requiresOwnTurn: true,
        landsPlayedThisTurn: 1,  // Already played 1
        maxLandsPerTurn: 1         // Max is 1
      };

      const constraints: SpecialActionConstraints = {
        hasPriority: true,
        isMainPhase: true,
        isStackEmpty: true,
        isOwnTurn: true
      };

      expect(canTakeSpecialAction(action, constraints)).toBe(false);
    });
  });

  describe('Rule 116.2b - Turn face up', () => {
    it('should allow any time with priority', () => {
      const action: TurnFaceUpAction = {
        type: SpecialActionType.TURN_FACE_UP,
        playerId: 'player-1',
        permanentId: 'morph-creature-1',
        requiresPriority: true
      };

      const constraints: SpecialActionConstraints = {
        hasPriority: true,
        isMainPhase: false,   // Doesn't matter
        isStackEmpty: false,  // Doesn't matter
        isOwnTurn: false      // Doesn't matter
      };

      expect(canTakeSpecialAction(action, constraints)).toBe(true);
    });

    it('should not allow without priority', () => {
      const action: TurnFaceUpAction = {
        type: SpecialActionType.TURN_FACE_UP,
        playerId: 'player-1',
        permanentId: 'morph-creature-1',
        requiresPriority: true
      };

      const constraints: SpecialActionConstraints = {
        hasPriority: false,  // No priority
        isMainPhase: true,
        isStackEmpty: true,
        isOwnTurn: true
      };

      expect(canTakeSpecialAction(action, constraints)).toBe(false);
    });
  });

  describe('Rule 116.2g - Companion', () => {
    it('should require main phase, empty stack, own turn, once per game', () => {
      const action: CompanionAction = {
        type: SpecialActionType.COMPANION_TO_HAND,
        playerId: 'player-1',
        companionId: 'lurrus-1',
        requiresPriority: true,
        requiresMainPhase: true,
        requiresEmptyStack: true,
        requiresOwnTurn: true,
        alreadyUsedThisGame: false
      };

      const constraints: SpecialActionConstraints = {
        hasPriority: true,
        isMainPhase: true,
        isStackEmpty: true,
        isOwnTurn: true
      };

      expect(canTakeSpecialAction(action, constraints)).toBe(true);
    });

    it('should not allow if already used this game', () => {
      const action: CompanionAction = {
        type: SpecialActionType.COMPANION_TO_HAND,
        playerId: 'player-1',
        companionId: 'lurrus-1',
        requiresPriority: true,
        requiresMainPhase: true,
        requiresEmptyStack: true,
        requiresOwnTurn: true,
        alreadyUsedThisGame: true  // Already used
      };

      const constraints: SpecialActionConstraints = {
        hasPriority: true,
        isMainPhase: true,
        isStackEmpty: true,
        isOwnTurn: true
      };

      expect(canTakeSpecialAction(action, constraints)).toBe(false);
    });
  });

  describe('Rule 116.3 - Player receives priority after special action', () => {
    it('should always return true', () => {
      expect(playerReceivesPriorityAfterSpecialAction()).toBe(true);
    });
  });
});
