/**
 * Section 5: Turn Structure (Rules 500-514)
 * Implements phases and steps of a Magic: The Gathering turn
 * Reference: MagicCompRules 20251114.txt
 */

/**
 * Rule 500.1 - Five phases in order
 */
export enum Phase {
  BEGINNING = 'beginning',
  PRECOMBAT_MAIN = 'precombat_main',
  COMBAT = 'combat',
  POSTCOMBAT_MAIN = 'postcombat_main',
  ENDING = 'ending'
}

/**
 * Rule 501.1, 502-504 - Beginning phase steps
 * Rule 506-511 - Combat phase steps
 * Rule 512.1, 513-514 - Ending phase steps
 */
export enum Step {
  // Beginning phase steps (Rule 501.1)
  UNTAP = 'untap',
  UPKEEP = 'upkeep',
  DRAW = 'draw',
  
  // Combat phase steps (Rule 506.1)
  BEGINNING_OF_COMBAT = 'beginning_of_combat',
  DECLARE_ATTACKERS = 'declare_attackers',
  DECLARE_BLOCKERS = 'declare_blockers',
  COMBAT_DAMAGE = 'combat_damage',
  END_OF_COMBAT = 'end_of_combat',
  
  // Ending phase steps (Rule 512.1)
  END = 'end',
  CLEANUP = 'cleanup'
}

/**
 * Rule 500.1 - Turn structure with phases and steps
 */
export interface TurnStructure {
  readonly turnNumber: number;
  readonly activePlayer: string;
  readonly currentPhase: Phase;
  readonly currentStep: Step | null; // null for main phases which have no steps
  readonly phaseStarted: boolean;
  readonly stepStarted: boolean;
}

/**
 * Rule 500.2 - Phase/step end conditions
 */
export interface PhaseStepEndCondition {
  readonly stackEmpty: boolean;
  readonly allPlayersPassed: boolean;
}

/**
 * Rule 502.1-502.3 - Untap step turn-based actions
 */
export interface UntapStepActions {
  readonly phasingCompleted: boolean; // Rule 502.1
  readonly dayNightChecked: boolean; // Rule 502.2
  readonly untapCompleted: boolean; // Rule 502.3
}

/**
 * Rule 504.1 - Draw step action
 */
export interface DrawStepAction {
  readonly cardDrawn: boolean;
}

/**
 * Rule 505.1 - Main phase identification
 */
export interface MainPhaseInfo {
  readonly isPrecombat: boolean; // Rule 505.1a
  readonly isPostcombat: boolean;
}

/**
 * Rule 514.1-514.2 - Cleanup step actions
 */
export interface CleanupStepActions {
  readonly handSizeChecked: boolean; // Rule 514.1
  readonly damageAndEffectsCleared: boolean; // Rule 514.2
}

/**
 * Rule 500.1 - Create initial turn structure
 */
export function createTurnStructure(turnNumber: number, activePlayer: string): TurnStructure {
  return {
    turnNumber,
    activePlayer,
    currentPhase: Phase.BEGINNING,
    currentStep: Step.UNTAP,
    phaseStarted: false,
    stepStarted: false
  };
}

/**
 * Rule 500.1 - Get steps for a phase
 */
export function getStepsForPhase(phase: Phase): Step[] {
  switch (phase) {
    case Phase.BEGINNING:
      // Rule 501.1
      return [Step.UNTAP, Step.UPKEEP, Step.DRAW];
    case Phase.COMBAT:
      // Rule 506.1
      return [
        Step.BEGINNING_OF_COMBAT,
        Step.DECLARE_ATTACKERS,
        Step.DECLARE_BLOCKERS,
        Step.COMBAT_DAMAGE,
        Step.END_OF_COMBAT
      ];
    case Phase.ENDING:
      // Rule 512.1
      return [Step.END, Step.CLEANUP];
    case Phase.PRECOMBAT_MAIN:
    case Phase.POSTCOMBAT_MAIN:
      // Rule 505 - Main phases have no steps
      return [];
    default:
      return [];
  }
}

/**
 * Rule 500.1 - Get next step in current phase
 */
export function getNextStep(currentPhase: Phase, currentStep: Step | null): Step | null {
  const steps = getStepsForPhase(currentPhase);
  
  if (steps.length === 0) {
    return null;
  }
  
  if (currentStep === null) {
    return steps[0];
  }
  
  const currentIndex = steps.indexOf(currentStep);
  if (currentIndex === -1 || currentIndex === steps.length - 1) {
    return null;
  }
  
  return steps[currentIndex + 1];
}

/**
 * Rule 500.1 - Get next phase in turn
 */
export function getNextPhase(currentPhase: Phase): Phase | null {
  const phaseOrder = [
    Phase.BEGINNING,
    Phase.PRECOMBAT_MAIN,
    Phase.COMBAT,
    Phase.POSTCOMBAT_MAIN,
    Phase.ENDING
  ];
  
  const currentIndex = phaseOrder.indexOf(currentPhase);
  if (currentIndex === -1 || currentIndex === phaseOrder.length - 1) {
    return null;
  }
  
  return phaseOrder[currentIndex + 1];
}

/**
 * Rule 500.1 - Advance to next step or phase
 */
export function advanceTurn(turn: Readonly<TurnStructure>): TurnStructure {
  const nextStep = getNextStep(turn.currentPhase, turn.currentStep);
  
  if (nextStep !== null) {
    // Advance to next step in current phase
    return {
      ...turn,
      currentStep: nextStep,
      stepStarted: false
    };
  }
  
  // No more steps, advance to next phase
  const nextPhase = getNextPhase(turn.currentPhase);
  
  if (nextPhase !== null) {
    const steps = getStepsForPhase(nextPhase);
    return {
      ...turn,
      currentPhase: nextPhase,
      currentStep: steps.length > 0 ? steps[0] : null,
      phaseStarted: false,
      stepStarted: false
    };
  }
  
  // Turn is complete, start new turn
  return createTurnStructure(turn.turnNumber + 1, turn.activePlayer);
}

/**
 * Rule 500.2 - Check if phase/step should end
 */
export function shouldPhaseStepEnd(condition: PhaseStepEndCondition): boolean {
  return condition.stackEmpty && condition.allPlayersPassed;
}

/**
 * Rule 500.3 - Check if step receives priority
 * Untap step and some cleanup steps do not receive priority
 */
export function doesStepReceivePriority(step: Step): boolean {
  // Rule 502 - Untap step has no priority
  // Rule 514.3 - Cleanup step normally has no priority
  return step !== Step.UNTAP && step !== Step.CLEANUP;
}

/**
 * Rule 500.3 - Check if phase/step has specific actions
 */
export function hasSpecificActions(step: Step): boolean {
  // Only untap step and cleanup step have specific turn-based actions
  return step === Step.UNTAP || step === Step.CLEANUP;
}

/**
 * Rule 502.1-502.3 - Create initial untap step state
 */
export function createUntapStepActions(): UntapStepActions {
  return {
    phasingCompleted: false,
    dayNightChecked: false,
    untapCompleted: false
  };
}

/**
 * Rule 502.1 - Perform phasing
 */
export function performPhasing(actions: Readonly<UntapStepActions>): UntapStepActions {
  return {
    ...actions,
    phasingCompleted: true
  };
}

/**
 * Rule 502.2 - Check day/night
 */
export function checkDayNight(actions: Readonly<UntapStepActions>): UntapStepActions {
  return {
    ...actions,
    dayNightChecked: true
  };
}

/**
 * Rule 502.3 - Perform untap
 */
export function performUntap(actions: Readonly<UntapStepActions>): UntapStepActions {
  return {
    ...actions,
    untapCompleted: true
  };
}

/**
 * Rule 502.1-502.3 - Check if untap step is complete
 */
export function isUntapStepComplete(actions: UntapStepActions): boolean {
  return actions.phasingCompleted && actions.dayNightChecked && actions.untapCompleted;
}

/**
 * Rule 503.1 - Upkeep step has no turn-based actions, active player gets priority
 */
export function doesUpkeepHaveActions(): boolean {
  return false;
}

/**
 * Rule 504.1 - Create draw step action state
 */
export function createDrawStepAction(): DrawStepAction {
  return {
    cardDrawn: false
  };
}

/**
 * Rule 504.1 - Perform draw
 */
export function performDraw(action: Readonly<DrawStepAction>): DrawStepAction {
  return {
    ...action,
    cardDrawn: true
  };
}

/**
 * Rule 504.1 - Check if draw step action is complete
 */
export function isDrawStepComplete(action: DrawStepAction): boolean {
  return action.cardDrawn;
}

/**
 * Rule 505.1 - Check if main phase is precombat
 */
export function isPrecombatMainPhase(turn: TurnStructure): boolean {
  return turn.currentPhase === Phase.PRECOMBAT_MAIN;
}

/**
 * Rule 505.1 - Check if main phase is postcombat
 */
export function isPostcombatMainPhase(turn: TurnStructure): boolean {
  return turn.currentPhase === Phase.POSTCOMBAT_MAIN;
}

/**
 * Rule 505.1a - Get main phase info
 */
export function getMainPhaseInfo(turn: TurnStructure): MainPhaseInfo | null {
  if (turn.currentPhase === Phase.PRECOMBAT_MAIN) {
    return {
      isPrecombat: true,
      isPostcombat: false
    };
  }
  
  if (turn.currentPhase === Phase.POSTCOMBAT_MAIN) {
    return {
      isPrecombat: false,
      isPostcombat: true
    };
  }
  
  return null;
}

/**
 * Rule 513.1 - End step has no turn-based actions, active player gets priority
 */
export function doesEndStepHaveActions(): boolean {
  return false;
}

/**
 * Rule 514.1-514.2 - Create cleanup step actions state
 */
export function createCleanupStepActions(): CleanupStepActions {
  return {
    handSizeChecked: false,
    damageAndEffectsCleared: false
  };
}

/**
 * Rule 514.1 - Perform hand size check and discard
 */
export function performHandSizeCheck(actions: Readonly<CleanupStepActions>): CleanupStepActions {
  return {
    ...actions,
    handSizeChecked: true
  };
}

/**
 * Rule 514.2 - Clear damage and end-of-turn effects
 */
export function clearDamageAndEffects(actions: Readonly<CleanupStepActions>): CleanupStepActions {
  return {
    ...actions,
    damageAndEffectsCleared: true
  };
}

/**
 * Rule 514.1-514.2 - Check if cleanup step actions are complete
 */
export function isCleanupStepComplete(actions: CleanupStepActions): boolean {
  return actions.handSizeChecked && actions.damageAndEffectsCleared;
}

/**
 * Rule 514.3 - Check if cleanup step should grant priority
 * Normally no, but if state-based actions or triggers occur, then yes
 */
export function shouldCleanupGrantPriority(
  stateBasedActionsPending: boolean,
  triggersWaiting: boolean
): boolean {
  return stateBasedActionsPending || triggersWaiting;
}

/**
 * Rule 514.3a - Additional cleanup step needed
 */
export function needsAdditionalCleanupStep(
  stateBasedActionsPending: boolean,
  triggersWaiting: boolean
): boolean {
  return shouldCleanupGrantPriority(stateBasedActionsPending, triggersWaiting);
}

/**
 * Rule 500.7 - Extra turn tracking
 */
export interface ExtraTurn {
  readonly playerId: string;
  readonly afterTurnNumber: number;
}

/**
 * Rule 500.7 - Add extra turn (most recent is taken first)
 */
export function addExtraTurn(
  extraTurns: readonly ExtraTurn[],
  playerId: string,
  afterTurnNumber: number
): ExtraTurn[] {
  // Most recently created turn will be taken first
  return [{ playerId, afterTurnNumber }, ...extraTurns];
}

/**
 * Rule 500.8 - Extra phase tracking
 */
export interface ExtraPhase {
  readonly phase: Phase;
  readonly afterPhase: Phase;
}

/**
 * Rule 500.9 - Extra step tracking
 */
export interface ExtraStep {
  readonly step: Step;
  readonly afterStep: Step | null;
  readonly beforeStep: Step | null;
}

/**
 * Rule 500.11 - Skip tracking for steps/phases
 */
export interface SkipInfo {
  readonly skipNextStep: Step | null;
  readonly skipNextPhase: Phase | null;
  readonly skipTurn: boolean;
}

/**
 * Rule 500.11 - Create initial skip info
 */
export function createSkipInfo(): SkipInfo {
  return {
    skipNextStep: null,
    skipNextPhase: null,
    skipTurn: false
  };
}

/**
 * Rule 500.11 - Mark step to skip
 */
export function skipStep(info: Readonly<SkipInfo>, step: Step): SkipInfo {
  return {
    ...info,
    skipNextStep: step
  };
}

/**
 * Rule 500.11 - Mark phase to skip
 */
export function skipPhase(info: Readonly<SkipInfo>, phase: Phase): SkipInfo {
  return {
    ...info,
    skipNextPhase: phase
  };
}

/**
 * Rule 500.11 - Mark turn to skip
 */
export function skipTurn(info: Readonly<SkipInfo>): SkipInfo {
  return {
    ...info,
    skipTurn: true
  };
}

/**
 * Rule 500.11 - Check if current step should be skipped
 */
export function shouldSkipStep(info: SkipInfo, currentStep: Step): boolean {
  return info.skipNextStep === currentStep;
}

/**
 * Rule 500.11 - Check if current phase should be skipped
 */
export function shouldSkipPhase(info: SkipInfo, currentPhase: Phase): boolean {
  return info.skipNextPhase === currentPhase;
}
