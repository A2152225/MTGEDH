/**
 * Tests for Section 5: Turn Structure (Rules 500-514)
 */

import { describe, it, expect } from 'vitest';
import {
  Phase,
  Step,
  createTurnStructure,
  getStepsForPhase,
  getNextStep,
  getNextPhase,
  advanceTurn,
  shouldPhaseStepEnd,
  doesStepReceivePriority,
  hasSpecificActions,
  createUntapStepActions,
  performPhasing,
  checkDayNight,
  performUntap,
  isUntapStepComplete,
  doesUpkeepHaveActions,
  createDrawStepAction,
  performDraw,
  isDrawStepComplete,
  isPrecombatMainPhase,
  isPostcombatMainPhase,
  getMainPhaseInfo,
  doesEndStepHaveActions,
  createCleanupStepActions,
  performHandSizeCheck,
  clearDamageAndEffects,
  isCleanupStepComplete,
  shouldCleanupGrantPriority,
  needsAdditionalCleanupStep,
  addExtraTurn,
  createSkipInfo,
  skipStep,
  skipPhase,
  skipTurn,
  shouldSkipStep,
  shouldSkipPhase
} from '../src/types/turnStructure';

describe('Turn Structure - Rule 500', () => {
  describe('Rule 500.1 - Five phases', () => {
    it('creates turn structure with correct initial phase', () => {
      const turn = createTurnStructure(1, 'player1');
      expect(turn.turnNumber).toBe(1);
      expect(turn.activePlayer).toBe('player1');
      expect(turn.currentPhase).toBe(Phase.BEGINNING);
      expect(turn.currentStep).toBe(Step.UNTAP);
    });

    it('gets correct steps for beginning phase', () => {
      const steps = getStepsForPhase(Phase.BEGINNING);
      expect(steps).toEqual([Step.UNTAP, Step.UPKEEP, Step.DRAW]);
    });

    it('gets correct steps for combat phase', () => {
      const steps = getStepsForPhase(Phase.COMBAT);
      expect(steps).toEqual([
        Step.BEGINNING_OF_COMBAT,
        Step.DECLARE_ATTACKERS,
        Step.DECLARE_BLOCKERS,
        Step.COMBAT_DAMAGE,
        Step.END_OF_COMBAT
      ]);
    });

    it('gets correct steps for ending phase', () => {
      const steps = getStepsForPhase(Phase.ENDING);
      expect(steps).toEqual([Step.END, Step.CLEANUP]);
    });

    it('gets no steps for main phases', () => {
      expect(getStepsForPhase(Phase.PRECOMBAT_MAIN)).toEqual([]);
      expect(getStepsForPhase(Phase.POSTCOMBAT_MAIN)).toEqual([]);
    });
  });

  describe('Rule 500.1 - Phase and step progression', () => {
    it('advances through beginning phase steps', () => {
      let turn = createTurnStructure(1, 'player1');
      
      // Start at untap
      expect(turn.currentStep).toBe(Step.UNTAP);
      
      // Advance to upkeep
      turn = advanceTurn(turn);
      expect(turn.currentPhase).toBe(Phase.BEGINNING);
      expect(turn.currentStep).toBe(Step.UPKEEP);
      
      // Advance to draw
      turn = advanceTurn(turn);
      expect(turn.currentPhase).toBe(Phase.BEGINNING);
      expect(turn.currentStep).toBe(Step.DRAW);
      
      // Advance to precombat main (no steps)
      turn = advanceTurn(turn);
      expect(turn.currentPhase).toBe(Phase.PRECOMBAT_MAIN);
      expect(turn.currentStep).toBeNull();
    });

    it('advances through all phases in order', () => {
      let turn = createTurnStructure(1, 'player1');
      
      // Skip through all steps to test phase progression
      while (turn.currentPhase !== Phase.POSTCOMBAT_MAIN && turn.turnNumber === 1) {
        turn = advanceTurn(turn);
      }
      
      // Should be at postcombat main of turn 1
      expect(turn.currentPhase).toBe(Phase.POSTCOMBAT_MAIN);
      expect(turn.turnNumber).toBe(1);
    });

    it('starts new turn after ending phase completes', () => {
      let turn = createTurnStructure(1, 'player1');
      
      // Advance through entire turn
      while (turn.turnNumber === 1) {
        turn = advanceTurn(turn);
      }
      
      // Should be at turn 2, beginning phase
      expect(turn.turnNumber).toBe(2);
      expect(turn.currentPhase).toBe(Phase.BEGINNING);
      expect(turn.currentStep).toBe(Step.UNTAP);
    });
  });

  describe('Rule 500.2 - Phase/step end conditions', () => {
    it('phase should end when stack empty and all players passed', () => {
      expect(shouldPhaseStepEnd({ stackEmpty: true, allPlayersPassed: true })).toBe(true);
    });

    it('phase should not end when stack not empty', () => {
      expect(shouldPhaseStepEnd({ stackEmpty: false, allPlayersPassed: true })).toBe(false);
    });

    it('phase should not end when not all players passed', () => {
      expect(shouldPhaseStepEnd({ stackEmpty: true, allPlayersPassed: false })).toBe(false);
    });
  });

  describe('Rule 500.3 - Steps that receive priority', () => {
    it('untap step does not receive priority', () => {
      expect(doesStepReceivePriority(Step.UNTAP)).toBe(false);
    });

    it('cleanup step does not receive priority normally', () => {
      expect(doesStepReceivePriority(Step.CLEANUP)).toBe(false);
    });

    it('other steps receive priority', () => {
      expect(doesStepReceivePriority(Step.UPKEEP)).toBe(true);
      expect(doesStepReceivePriority(Step.DRAW)).toBe(true);
      expect(doesStepReceivePriority(Step.BEGINNING_OF_COMBAT)).toBe(true);
      expect(doesStepReceivePriority(Step.END)).toBe(true);
    });
  });
});

describe('Rule 502 - Untap Step', () => {
  it('performs phasing action', () => {
    let actions = createUntapStepActions();
    expect(actions.phasingCompleted).toBe(false);
    
    actions = performPhasing(actions);
    expect(actions.phasingCompleted).toBe(true);
  });

  it('checks day/night', () => {
    let actions = createUntapStepActions();
    expect(actions.dayNightChecked).toBe(false);
    
    actions = checkDayNight(actions);
    expect(actions.dayNightChecked).toBe(true);
  });

  it('performs untap', () => {
    let actions = createUntapStepActions();
    expect(actions.untapCompleted).toBe(false);
    
    actions = performUntap(actions);
    expect(actions.untapCompleted).toBe(true);
  });

  it('completes all untap step actions in order', () => {
    let actions = createUntapStepActions();
    expect(isUntapStepComplete(actions)).toBe(false);
    
    actions = performPhasing(actions);
    expect(isUntapStepComplete(actions)).toBe(false);
    
    actions = checkDayNight(actions);
    expect(isUntapStepComplete(actions)).toBe(false);
    
    actions = performUntap(actions);
    expect(isUntapStepComplete(actions)).toBe(true);
  });
});

describe('Rule 503 - Upkeep Step', () => {
  it('has no turn-based actions', () => {
    expect(doesUpkeepHaveActions()).toBe(false);
  });
});

describe('Rule 504 - Draw Step', () => {
  it('performs draw action', () => {
    let action = createDrawStepAction();
    expect(action.cardDrawn).toBe(false);
    expect(isDrawStepComplete(action)).toBe(false);
    
    action = performDraw(action);
    expect(action.cardDrawn).toBe(true);
    expect(isDrawStepComplete(action)).toBe(true);
  });
});

describe('Rule 505 - Main Phase', () => {
  it('identifies precombat main phase', () => {
    const turn = {
      turnNumber: 1,
      activePlayer: 'player1',
      currentPhase: Phase.PRECOMBAT_MAIN,
      currentStep: null,
      phaseStarted: true,
      stepStarted: false
    };
    
    expect(isPrecombatMainPhase(turn)).toBe(true);
    expect(isPostcombatMainPhase(turn)).toBe(false);
  });

  it('identifies postcombat main phase', () => {
    const turn = {
      turnNumber: 1,
      activePlayer: 'player1',
      currentPhase: Phase.POSTCOMBAT_MAIN,
      currentStep: null,
      phaseStarted: true,
      stepStarted: false
    };
    
    expect(isPrecombatMainPhase(turn)).toBe(false);
    expect(isPostcombatMainPhase(turn)).toBe(true);
  });

  it('gets main phase info for precombat', () => {
    const turn = {
      turnNumber: 1,
      activePlayer: 'player1',
      currentPhase: Phase.PRECOMBAT_MAIN,
      currentStep: null,
      phaseStarted: true,
      stepStarted: false
    };
    
    const info = getMainPhaseInfo(turn);
    expect(info).not.toBeNull();
    expect(info?.isPrecombat).toBe(true);
    expect(info?.isPostcombat).toBe(false);
  });

  it('gets main phase info for postcombat', () => {
    const turn = {
      turnNumber: 1,
      activePlayer: 'player1',
      currentPhase: Phase.POSTCOMBAT_MAIN,
      currentStep: null,
      phaseStarted: true,
      stepStarted: false
    };
    
    const info = getMainPhaseInfo(turn);
    expect(info).not.toBeNull();
    expect(info?.isPrecombat).toBe(false);
    expect(info?.isPostcombat).toBe(true);
  });

  it('returns null for non-main phases', () => {
    const turn = {
      turnNumber: 1,
      activePlayer: 'player1',
      currentPhase: Phase.COMBAT,
      currentStep: Step.DECLARE_ATTACKERS,
      phaseStarted: true,
      stepStarted: true
    };
    
    expect(getMainPhaseInfo(turn)).toBeNull();
  });
});

describe('Rule 513 - End Step', () => {
  it('has no turn-based actions', () => {
    expect(doesEndStepHaveActions()).toBe(false);
  });
});

describe('Rule 514 - Cleanup Step', () => {
  it('performs hand size check', () => {
    let actions = createCleanupStepActions();
    expect(actions.handSizeChecked).toBe(false);
    
    actions = performHandSizeCheck(actions);
    expect(actions.handSizeChecked).toBe(true);
  });

  it('clears damage and effects', () => {
    let actions = createCleanupStepActions();
    expect(actions.damageAndEffectsCleared).toBe(false);
    
    actions = clearDamageAndEffects(actions);
    expect(actions.damageAndEffectsCleared).toBe(true);
  });

  it('completes all cleanup actions', () => {
    let actions = createCleanupStepActions();
    expect(isCleanupStepComplete(actions)).toBe(false);
    
    actions = performHandSizeCheck(actions);
    expect(isCleanupStepComplete(actions)).toBe(false);
    
    actions = clearDamageAndEffects(actions);
    expect(isCleanupStepComplete(actions)).toBe(true);
  });

  it('normally does not grant priority', () => {
    expect(shouldCleanupGrantPriority(false, false)).toBe(false);
  });

  it('grants priority if state-based actions pending', () => {
    expect(shouldCleanupGrantPriority(true, false)).toBe(true);
  });

  it('grants priority if triggers waiting', () => {
    expect(shouldCleanupGrantPriority(false, true)).toBe(true);
  });

  it('needs additional cleanup step if priority granted', () => {
    expect(needsAdditionalCleanupStep(true, false)).toBe(true);
    expect(needsAdditionalCleanupStep(false, true)).toBe(true);
    expect(needsAdditionalCleanupStep(false, false)).toBe(false);
  });
});

describe('Rule 500.7 - Extra Turns', () => {
  it('adds extra turn after specified turn', () => {
    const extraTurns = addExtraTurn([], 'player1', 5);
    expect(extraTurns).toHaveLength(1);
    expect(extraTurns[0].playerId).toBe('player1');
    expect(extraTurns[0].afterTurnNumber).toBe(5);
  });

  it('adds most recent extra turn first (LIFO)', () => {
    let extraTurns = addExtraTurn([], 'player1', 5);
    extraTurns = addExtraTurn(extraTurns, 'player2', 5);
    extraTurns = addExtraTurn(extraTurns, 'player3', 5);
    
    // Most recent should be first
    expect(extraTurns[0].playerId).toBe('player3');
    expect(extraTurns[1].playerId).toBe('player2');
    expect(extraTurns[2].playerId).toBe('player1');
  });
});

describe('Rule 500.11 - Skipping Steps/Phases/Turns', () => {
  it('creates initial skip info with nothing skipped', () => {
    const info = createSkipInfo();
    expect(info.skipNextStep).toBeNull();
    expect(info.skipNextPhase).toBeNull();
    expect(info.skipTurn).toBe(false);
  });

  it('marks step to skip', () => {
    let info = createSkipInfo();
    info = skipStep(info, Step.DRAW);
    expect(info.skipNextStep).toBe(Step.DRAW);
  });

  it('marks phase to skip', () => {
    let info = createSkipInfo();
    info = skipPhase(info, Phase.COMBAT);
    expect(info.skipNextPhase).toBe(Phase.COMBAT);
  });

  it('marks turn to skip', () => {
    let info = createSkipInfo();
    info = skipTurn(info);
    expect(info.skipTurn).toBe(true);
  });

  it('checks if step should be skipped', () => {
    let info = createSkipInfo();
    info = skipStep(info, Step.COMBAT_DAMAGE);
    
    expect(shouldSkipStep(info, Step.COMBAT_DAMAGE)).toBe(true);
    expect(shouldSkipStep(info, Step.DRAW)).toBe(false);
  });

  it('checks if phase should be skipped', () => {
    let info = createSkipInfo();
    info = skipPhase(info, Phase.COMBAT);
    
    expect(shouldSkipPhase(info, Phase.COMBAT)).toBe(true);
    expect(shouldSkipPhase(info, Phase.ENDING)).toBe(false);
  });
});
