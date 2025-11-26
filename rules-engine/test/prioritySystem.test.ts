/**
 * Tests for priority system enhancements (Rule 117)
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PRIORITY_SETTINGS,
  DEFAULT_DRAW_STEP_TIMING,
  createPrioritySettings,
  checkAutoPass,
  passPriority,
  resetPriorityAfterAction,
  grantPriorityToActivePlayer,
  allPlayersPassed,
  handlePriorityPass,
  shouldDrawStepAutoProceed,
  createPriorityPrompt,
  createTriggerPrompt,
  NonActivePlayerPrompt,
  type PriorityState,
  type PlayerPrioritySettings,
} from '../src/prioritySystem';

describe('Priority System - Rule 117', () => {
  const createTestState = (overrides?: Partial<PriorityState>): PriorityState => ({
    currentPlayer: 'player1',
    activePlayer: 'player1',
    turnOrder: ['player1', 'player2', 'player3', 'player4'],
    passedThisRound: new Set(),
    stackSize: 0,
    playerSettings: new Map(),
    pendingTriggers: 0,
    waitingForResponse: false,
    ...overrides,
  });

  describe('createPrioritySettings', () => {
    it('creates settings with default values', () => {
      const settings = createPrioritySettings('player1');
      expect(settings.playerId).toBe('player1');
      expect(settings.autoPassWhenEmpty).toBe(true);
      expect(settings.autoPassOnOpponentTurn).toBe(false);
    });

    it('allows overriding default values', () => {
      const settings = createPrioritySettings('player1', {
        autoPassOnOpponentTurn: true,
        stopPhases: ['MAIN1'],
      });
      expect(settings.autoPassOnOpponentTurn).toBe(true);
      expect(settings.stopPhases).toEqual(['MAIN1']);
    });
  });

  describe('checkAutoPass', () => {
    it('does not auto-pass when pending triggers exist', () => {
      const state = createTestState({ pendingTriggers: 1 });
      const result = checkAutoPass(state, 'player1', 'BEGINNING', 'UPKEEP', true);
      expect(result.shouldAutoPass).toBe(false);
      expect(result.needsPrompt).toBe(true);
    });

    it('does not auto-pass when waiting for response', () => {
      const state = createTestState({ waitingForResponse: true });
      const result = checkAutoPass(state, 'player1', 'BEGINNING', 'UPKEEP', true);
      expect(result.shouldAutoPass).toBe(false);
    });

    it('auto-passes when no legal actions and setting enabled', () => {
      // Use non-active player so stop phases don't apply
      const state = createTestState({ activePlayer: 'player2' });
      const result = checkAutoPass(state, 'player1', 'COMBAT', 'COMBAT_DAMAGE', false);
      expect(result.shouldAutoPass).toBe(true);
      expect(result.reason).toContain('No legal actions');
    });

    it('respects stop phases for active player', () => {
      const state = createTestState();
      // Default stop phases include MAIN1
      const result = checkAutoPass(state, 'player1', 'PRECOMBAT_MAIN', 'MAIN1', true);
      expect(result.shouldAutoPass).toBe(false);
      expect(result.needsPrompt).toBe(true);
    });

    it('auto-passes during draw step for non-active players', () => {
      const state = createTestState({ activePlayer: 'player2' });
      const result = checkAutoPass(state, 'player1', 'BEGINNING', 'DRAW', true);
      expect(result.shouldAutoPass).toBe(true);
      expect(result.reason).toContain('draw step');
    });
  });

  describe('passPriority', () => {
    it('advances to next player in turn order', () => {
      const state = createTestState({ currentPlayer: 'player1' });
      const result = passPriority(state);
      expect(result.currentPlayer).toBe('player2');
    });

    it('wraps around to first player after last', () => {
      const state = createTestState({ currentPlayer: 'player4' });
      const result = passPriority(state);
      expect(result.currentPlayer).toBe('player1');
    });

    it('tracks which players have passed', () => {
      const state = createTestState({ currentPlayer: 'player1' });
      const result = passPriority(state);
      expect(result.passedThisRound.has('player1')).toBe(true);
      expect(result.passedThisRound.has('player2')).toBe(false);
    });
  });

  describe('resetPriorityAfterAction', () => {
    it('gives priority to acting player', () => {
      const state = createTestState({
        currentPlayer: 'player3',
        passedThisRound: new Set(['player1', 'player2']),
      });
      const result = resetPriorityAfterAction(state, 'player1');
      expect(result.currentPlayer).toBe('player1');
    });

    it('clears all passes', () => {
      const state = createTestState({
        passedThisRound: new Set(['player1', 'player2', 'player3']),
      });
      const result = resetPriorityAfterAction(state, 'player1');
      expect(result.passedThisRound.size).toBe(0);
    });
  });

  describe('grantPriorityToActivePlayer', () => {
    it('sets current player to active player', () => {
      const state = createTestState({
        activePlayer: 'player2',
        currentPlayer: 'player4',
      });
      const result = grantPriorityToActivePlayer(state);
      expect(result.currentPlayer).toBe('player2');
    });

    it('clears passes', () => {
      const state = createTestState({
        passedThisRound: new Set(['player1', 'player2']),
      });
      const result = grantPriorityToActivePlayer(state);
      expect(result.passedThisRound.size).toBe(0);
    });
  });

  describe('allPlayersPassed', () => {
    it('returns false when not all players passed', () => {
      const state = createTestState({
        passedThisRound: new Set(['player1', 'player2']),
      });
      expect(allPlayersPassed(state)).toBe(false);
    });

    it('returns true when all players passed', () => {
      const state = createTestState({
        passedThisRound: new Set(['player1', 'player2', 'player3', 'player4']),
      });
      expect(allPlayersPassed(state)).toBe(true);
    });
  });

  describe('handlePriorityPass', () => {
    it('rejects pass from player without priority', () => {
      const state = createTestState({ currentPlayer: 'player1' });
      const result = handlePriorityPass(state, 'player2');
      expect(result.logs[0]).toContain('does not have priority');
    });

    it('advances priority on valid pass', () => {
      const state = createTestState({ currentPlayer: 'player1' });
      const result = handlePriorityPass(state, 'player1');
      expect(result.nextState.currentPlayer).toBe('player2');
    });

    it('resolves stack when all pass with non-empty stack', () => {
      const state = createTestState({
        currentPlayer: 'player4',
        passedThisRound: new Set(['player1', 'player2', 'player3']),
        stackSize: 1,
      });
      const result = handlePriorityPass(state, 'player4');
      expect(result.shouldResolveStack).toBe(true);
      expect(result.shouldAdvanceStep).toBe(false);
    });

    it('advances step when all pass with empty stack', () => {
      const state = createTestState({
        currentPlayer: 'player4',
        passedThisRound: new Set(['player1', 'player2', 'player3']),
        stackSize: 0,
      });
      const result = handlePriorityPass(state, 'player4');
      expect(result.shouldResolveStack).toBe(false);
      expect(result.shouldAdvanceStep).toBe(true);
    });
  });

  describe('shouldDrawStepAutoProceed', () => {
    const timing = DEFAULT_DRAW_STEP_TIMING;

    it('does not proceed when pending triggers exist', () => {
      const state = createTestState({ pendingTriggers: 1 });
      const result = shouldDrawStepAutoProceed(state, timing, false, 2000);
      expect(result.shouldProceed).toBe(false);
      expect(result.reason).toContain('triggers');
    });

    it('waits for response window when draw triggers exist', () => {
      const state = createTestState();
      const result = shouldDrawStepAutoProceed(state, timing, true, 500); // Within window
      expect(result.shouldProceed).toBe(false);
      expect(result.reason).toContain('response window');
    });

    it('waits for active player to pass when required', () => {
      const state = createTestState();
      const result = shouldDrawStepAutoProceed(state, timing, false, 2000);
      expect(result.shouldProceed).toBe(false);
      expect(result.reason).toContain('Active player has not passed');
    });

    it('proceeds when all players have passed', () => {
      const state = createTestState({
        passedThisRound: new Set(['player1', 'player2', 'player3', 'player4']),
      });
      const result = shouldDrawStepAutoProceed(state, timing, false, 2000);
      expect(result.shouldProceed).toBe(true);
    });
  });

  describe('createPriorityPrompt', () => {
    it('creates prompt for active player', () => {
      const prompt = createPriorityPrompt('player1', 'Main phase', true);
      expect(prompt.playerId).toBe('player1');
      expect(prompt.type).toBe(NonActivePlayerPrompt.PRIORITY);
      expect(prompt.description).toContain('Your priority');
    });

    it('creates prompt for non-active player', () => {
      const prompt = createPriorityPrompt('player2', 'Spell cast', false);
      expect(prompt.description).toContain('Respond');
    });
  });

  describe('createTriggerPrompt', () => {
    it('creates trigger response prompt', () => {
      const prompt = createTriggerPrompt(
        'player1',
        'Smothering Tithe',
        'Pay {2} or opponent creates Treasure'
      );
      expect(prompt.type).toBe(NonActivePlayerPrompt.TRIGGER_RESPONSE);
      expect(prompt.description).toContain('Smothering Tithe');
      expect(prompt.mandatory).toBe(true);
    });
  });
});
